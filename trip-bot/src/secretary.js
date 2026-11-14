// Personal secretary: calendar, reminders, translations, letters, morning brief, phone-calendar feed.
// Messages reach here from flow.js after the router (gemini.routeMessage) decides what they are for.

import {
  MIN, HOUR, DAY, one, all, run, claim, sendOrRelease, logEvent, esc, fmtLocal, hmLocal, localToUtc, localISODate, tz,
  setMode, strings, dayStart, addDaysISO, dayLabel, getTrip, isUser, userIds,
} from './util.js';
import { send, sendLong, kb, tgUpload, whileTyping } from './telegram.js';
import { translate, writeLetter, reviseLetter } from './gemini.js';
import { eventIcs, feedIcs } from './files.js';
import { reportError } from './flow.js';

const DEFAULT_EVENT_REMIND_MIN = 30;
// Real calendar dates and times only (Gemini can return "2026-02-30" or "25:00").
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s)) && new Date(Date.parse(s)).toISOString().slice(0, 10) === s;
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// ======================= menu =======================

export function secMenu(env, chat, L) {
  return send(env, chat, `${L.secTitle}\n\n${L.secHint}`, kb([
    [[L.btnToday, 'ag:t'], [L.btnTomorrow, 'ag:m'], [L.btnWeek, 'ag:w']],
    [[L.btnReminders, 'rl'], [L.btnTranslate, 'sm:tr']],
    [[L.btnLetter, 'sm:lt'], [L.btnCalLink, 'cl']],
  ]));
}

// ======================= calendar =======================

function eventWhen(env, L, lang, e) {
  const iso = localISODate(env, e.start_at);
  if (e.all_day) return `${dayLabel(iso, lang)} · ${L.allDay}`;
  return `${dayLabel(iso, lang)}, ${hmLocal(env, e.start_at)}${e.end_at ? '–' + hmLocal(env, e.end_at) : ''}`;
}

// r: router fields (ev_title, ev_date, ev_time, ev_end_time, ev_location, ev_notes, ev_remind_min).
// Returns false if the time has clearly passed (the caller asks again).
export async function addEvent(env, uid, chat, L, lang, r) {
  if (!isDate(r.ev_date)) return false;
  const timed = isTime(r.ev_time);
  const start = localToUtc(env, timed ? `${r.ev_date}T${r.ev_time}` : r.ev_date);
  if (timed ? start < Date.now() - HOUR : r.ev_date < localISODate(env)) return false;
  let end = timed && isTime(r.ev_end_time) ? localToUtc(env, `${r.ev_date}T${r.ev_end_time}`) : null;
  if (end != null && end <= start) end = null;
  const before = timed ? (Number.isInteger(r.ev_remind_min) && r.ev_remind_min >= 0 ? r.ev_remind_min : DEFAULT_EVENT_REMIND_MIN) : null;
  // A heads-up time already passed (the event is soon): remind at once, unless it has started.
  const remindAt = before == null || start <= Date.now() ? null : Math.max(start - before * MIN, Date.now());
  const title = String(r.ev_title || '').trim() || '—';
  const res = await run(env, 'INSERT INTO cal_events (owner_id, title, start_at, end_at, all_day, location, notes, remind_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    uid, title, start, end, timed ? 0 : 1, r.ev_location || null, r.ev_notes || null, remindAt, Date.now());
  const id = res.meta.last_row_id;
  await logEvent(env, 'owner', 'cal_add', null, `#${id} ${title}`);

  let conflict = '';
  if (timed) {
    const rows = await all(env, 'SELECT * FROM cal_events WHERE owner_id = ? AND id <> ? AND all_day = 0 AND start_at < ? AND COALESCE(end_at, start_at + ?) > ?',
      uid, id, end || start + HOUR, HOUR, start);
    if (rows.length) conflict = '\n\n' + L.conflict(rows.map((x) => `${hmLocal(env, x.start_at)} ${esc(x.title)}`).join(', '));
  }
  const e = { start_at: start, end_at: end, all_day: timed ? 0 : 1 };
  const soon = remindAt != null && remindAt <= Date.now() + MIN;
  await send(env, chat,
    `${L.eventAdded}\n<b>${esc(title)}</b>\n🗓 ${eventWhen(env, L, lang, e)}${r.ev_location ? `\n📍 ${esc(r.ev_location)}` : ''}${remindAt && !soon ? '\n' + L.remindBefore(before) : ''}${conflict}`,
    kb([[[L.btnDelete, `xd:${id}`], [L.btnIcs, `xi:${id}`]]]));
  return true;
}

// Everything planned between two local dates (inclusive): events, reminders, flights, trips. Returns { text, events } or null.
export async function agenda(env, uid, L, lang, fromISO, toISO) {
  const from = dayStart(env, fromISO), to = dayStart(env, addDaysISO(toISO, 1));
  const days = new Map(); // iso -> [[sortKey, line]]
  const put = (iso, key, line) => { if (iso >= fromISO && iso <= toISO) { if (!days.has(iso)) days.set(iso, []); days.get(iso).push([key, line]); } };

  const evs = await all(env, 'SELECT * FROM cal_events WHERE owner_id = ? AND start_at >= ? AND start_at < ? ORDER BY start_at', uid, from, to);
  for (const e of evs) {
    const iso = localISODate(env, e.start_at);
    if (e.all_day) put(iso, e.start_at - 1, `• ${L.allDay}: ${esc(e.title)}`);
    else put(iso, e.start_at, `• ${hmLocal(env, e.start_at)}${e.end_at ? '–' + hmLocal(env, e.end_at) : ''} ${esc(e.title)}${e.location ? ` · 📍 ${esc(e.location)}` : ''}`);
  }
  // Reminders in the range; a repeating one appears on every day it fires (a daily pill: each day of the week).
  const rems = await all(env, 'SELECT * FROM user_reminders WHERE owner_id = ? AND done = 0 AND due_at < ? ORDER BY due_at', uid, to);
  for (const r of rems) {
    for (let due = r.due_at, n = 0; due != null && due < to && n < 62; due = r.repeat === 'none' ? null : nextDue(env, due, r.repeat, r.anchor_day), n++) {
      if (due >= from) put(localISODate(env, due), due, `• ⏰ ${hmLocal(env, due)} ${esc(r.text)}${r.repeat !== 'none' ? ' 🔁' : ''}`);
    }
  }

  // Booked trips only (not ones he is still choosing), and only on the days that matter: the flight out and the
  // day back. No line for every day of the stay: that read like a new flight reminder each morning.
  for (const row of await all(env, `SELECT id FROM trips WHERE owner_id = ? AND status = 'booked'`, uid)) {
    const t = await getTrip(env, row.id), f = t.fields;
    const route = `${esc(f.origin || L.origin)} → ${esc(f.destination || '?')}`;
    if (t.flight_at) put(localISODate(env, t.flight_at), t.flight_at, `• ✈️ ${hmLocal(env, t.flight_at)} ${L.flightWord}: ${route} (${t.code})`);
    else if (isDate(f.date_from)) put(f.date_from, dayStart(env, f.date_from) - 2, `• ✈️ ${L.flightWord}: ${route} (${t.code})`);
    if (isDate(f.date_to) && !f.one_way) put(f.date_to, dayStart(env, f.date_to) - 1, `• 🛬 ${L.back}: ${esc(f.destination || '?')} → ${esc(f.origin || L.origin)} (${t.code})`);
  }
  if (!days.size) return null;
  const today = localISODate(env), tomorrow = addDaysISO(today, 1);
  const blocks = [...days.keys()].sort().map((iso) => {
    const name = iso === today ? `${L.today}, ` : iso === tomorrow ? `${L.tomorrow}, ` : '';
    return `<b>📅 ${name}${dayLabel(iso, lang)}</b>\n` + days.get(iso).sort((a, b) => a[0] - b[0]).map((x) => x[1]).join('\n');
  });
  return { text: blocks.join('\n\n'), events: evs };
}

export async function showAgenda(env, uid, chat, L, lang, fromISO, toISO) {
  const a = await agenda(env, uid, L, lang, fromISO, toISO);
  const rows = [[[L.btnToday, 'ag:t'], [L.btnTomorrow, 'ag:m'], [L.btnWeek, 'ag:w']]];
  if (a) for (const e of a.events.slice(0, 6)) rows.push([[`🗑 ${e.all_day ? '' : hmLocal(env, e.start_at) + ' '}${short(e.title, 28)}`, `xd:${e.id}`]]);
  const range = fromISO === toISO ? dayLabel(fromISO, lang) : `${dayLabel(fromISO, lang)} – ${dayLabel(toISO, lang)}`;
  return sendLong(env, chat, a ? a.text : `<b>📅 ${range}</b>\n${L.agendaEmpty}`, kb(rows));
}

// ======================= reminders =======================

const localDay = (env, ms) => new Date(ms + tz(env)).getUTCDay();
// anchor: the day of the month a monthly reminder belongs to (31 stays 31: Jan 31 -> Feb 28 -> Mar 31).
export function nextDue(env, ms, repeat, anchor = null) {
  if (repeat === 'daily') return ms + DAY;
  if (repeat === 'weekly') return ms + 7 * DAY;
  if (repeat === 'weekdays') { let n = ms + DAY; while ([0, 6].includes(localDay(env, n))) n += DAY; return n; }
  if (repeat === 'monthly') {
    const d = new Date(ms + tz(env));
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Date.UTC(y, m, Math.min(anchor || d.getUTCDate(), dim), d.getUTCHours(), d.getUTCMinutes()) - tz(env);
  }
  return null;
}

// r: router fields (rm_text, rm_date, rm_time, rm_repeat). Returns false if the time is in the past (caller asks again).
export async function addReminder(env, uid, chat, L, lang, r) {
  const repeat = ['daily', 'weekdays', 'weekly', 'monthly'].includes(r.rm_repeat) ? r.rm_repeat : 'none';
  let due = localToUtc(env, `${r.rm_date}T${isTime(r.rm_time) ? r.rm_time : '09:00'}`);
  if (!isDate(r.rm_date)) return false;
  const anchor = repeat === 'monthly' ? Number(r.rm_date.slice(8, 10)) : null;
  if (repeat === 'none') {
    if (due < Date.now() - MIN) return false;
  } else {
    if (repeat === 'weekdays') while ([0, 6].includes(localDay(env, due))) due += DAY;
    while (due <= Date.now()) due = nextDue(env, due, repeat, anchor);
  }
  const text = String(r.rm_text || '').trim() || '—';
  const res = await run(env, 'INSERT INTO user_reminders (owner_id, text, due_at, repeat, anchor_day, created_at) VALUES (?, ?, ?, ?, ?, ?)', uid, text, due, repeat, anchor, Date.now());
  const id = res.meta.last_row_id;
  await logEvent(env, 'owner', 'reminder_add', null, `#${id} ${repeat}`);
  await send(env, chat, `${L.reminderSet}\n<b>${esc(text)}</b>\n🕘 ${fmtLocal(env, due, lang)}${repeat !== 'none' ? ` · 🔁 ${L.repeatWord[repeat]}` : ''}`,
    kb([[[L.btnDelete, `rx:${id}`]]]));
  return true;
}

export async function listReminders(env, uid, chat, L, lang) {
  const rows = await all(env, 'SELECT * FROM user_reminders WHERE owner_id = ? AND done = 0 ORDER BY due_at LIMIT 20', uid);
  if (!rows.length) return send(env, chat, `${L.remindersTitle}\n${L.remindersEmpty}`);
  const text = `${L.remindersTitle}\n` + rows.map((r) => `• ${fmtLocal(env, r.due_at, lang)}${r.repeat !== 'none' ? ` · 🔁 ${L.repeatWord[r.repeat]}` : ''}\n   ${esc(r.text)}`).join('\n');
  return sendLong(env, chat, text, kb(rows.slice(0, 10).map((r) => [[`🗑 ${short(r.text, 30)}`, `rx:${r.id}`]])));
}

// ======================= translation =======================

export async function doTranslate(env, chat, L, lang, text, media, target) {
  if (!text && !media.length) return send(env, chat, L.nothingToTranslate);
  let r;
  try { r = await whileTyping(env, chat, () => translate(env, text, media, target, lang)); }
  catch (e) { await reportError(env, e, 'translate'); return send(env, chat, L.readFail); }
  if (!String(r?.translation || '').trim()) return send(env, chat, L.readFail);
  const src = String(r.source_lang || '').toUpperCase(), tgt = String(r.target_lang || target || '').toUpperCase();
  await logEvent(env, 'owner', 'translate', null, `${src || '?'}->${tgt || '?'}`);
  return sendLong(env, chat, `${L.translationTitle(src, tgt)}\n\n${esc(r.translation)}`);
}

// ======================= letters =======================

function showLetter(env, chat, L, l) {
  return sendLong(env, chat, `✉️ ${l.subject ? `<b>${esc(l.subject)}</b>` : ''}\n\n${esc(l.body)}`,
    kb([[[L.btnRevise, `lr:${l.id}`], [L.btnLetterTranslate, `lt:${l.id}`]]]));
}

async function saveLetter(env, uid, request, r) {
  const res = await run(env, 'INSERT INTO letters (owner_id, request, subject, body, lang, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    uid, request, r.subject || null, r.body, r.lang || null, Date.now());
  return { id: res.meta.last_row_id, subject: r.subject, body: r.body };
}

export async function doLetter(env, uid, chat, L, lang, request, name = '') {
  await send(env, chat, L.writing);
  let r;
  try { r = await whileTyping(env, chat, () => writeLetter(env, request, lang, name)); }
  catch (e) { await reportError(env, e, 'writeLetter'); return send(env, chat, L.readFail); }
  await logEvent(env, 'owner', 'letter', null, request.slice(0, 80));
  return showLetter(env, chat, L, await saveLetter(env, uid, request, r));
}

export async function doRevise(env, uid, chat, L, letterId, instruction) {
  const l = await one(env, 'SELECT * FROM letters WHERE id = ? AND owner_id = ?', letterId, uid);
  if (!l) return send(env, chat, L.letterGone);
  await send(env, chat, L.writing);
  let r;
  try { r = await whileTyping(env, chat, () => reviseLetter(env, l, instruction)); }
  catch (e) { await reportError(env, e, 'reviseLetter'); return send(env, chat, L.readFail); }
  await logEvent(env, 'owner', 'letter_revise', null, instruction.slice(0, 80));
  return showLetter(env, chat, L, await saveLetter(env, uid, `${l.request || ''}\n[revision] ${instruction}`, r));
}

const LANG_FULL = { uz: 'Uzbek (Latin script)', ru: 'Russian', en: 'English' };

// ======================= phone calendar (subscription link) =======================

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function calToken(env, uid) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.WEBHOOK_SECRET}:cal:${uid}`))).slice(0, 32);
}
export async function calUrl(env, uid) { return `${String(env.PUBLIC_URL || '').replace(/\/$/, '')}/cal/${uid}/${await calToken(env, uid)}.ics`; }

// GET /cal/<uid>/<token>.ics -> that user's calendar, or null if the user or the token is wrong.
export async function calendarFeed(env, uid, token) {
  if (!isUser(env, uid) || token !== (await calToken(env, uid))) return null;
  const events = await all(env, 'SELECT * FROM cal_events WHERE owner_id = ? AND start_at > ? ORDER BY start_at', uid, Date.now() - 60 * DAY);
  const trips = [];
  for (const r of await all(env, `SELECT id FROM trips WHERE owner_id = ? AND status IN ('chosen', 'booked', 'done')`, uid)) trips.push(await getTrip(env, r.id));
  const { L } = await strings(env, uid);
  return feedIcs(events, trips, L, L.kbSec.replace(/^\S+\s/, ''), tz(env));
}

// ======================= buttons =======================

// Returns true if the button belonged to the secretary.
export async function handleSecCallback(env, { a, id, arg, uid, chat, L, lang, answer, dropKeyboard }) {
  const today = localISODate(env);
  switch (a) {
    case 'ag': {
      await answer();
      const from = id === 'm' ? addDaysISO(today, 1) : today;
      await showAgenda(env, uid, chat, L, lang, from, id === 'w' ? addDaysISO(today, 6) : from);
      return true;
    }
    case 'rl': await answer(); await listReminders(env, uid, chat, L, lang); return true;
    case 'sm':
      await answer();
      if (id === 'tr') await send(env, chat, L.translateChoose, kb([[['🇺🇿 UZ', 'tm:uz'], ['🇷🇺 RU', 'tm:ru'], ['🇬🇧 EN', 'tm:en']], [[L.btnAuto, 'tm:auto']]]));
      if (id === 'lt') { await setMode(env, uid, 'letter'); await send(env, chat, L.letterAsk); }
      return true;
    case 'tm': {
      await answer(); await dropKeyboard();
      const target = id === 'auto' ? '' : id;
      await setMode(env, uid, 'translate', target);
      await send(env, chat, L.translateMode(target));
      return true;
    }
    case 'cl': await answer(); await send(env, chat, L.calLink(await calUrl(env, uid))); return true;
    case 'xd': {
      const e = await one(env, 'SELECT * FROM cal_events WHERE id = ? AND owner_id = ?', +id, uid);
      if (!e) { await answer(L.staleBtn); return true; }
      await run(env, 'DELETE FROM cal_events WHERE id = ?', e.id);
      await logEvent(env, 'owner', 'cal_delete', null, `#${e.id} ${e.title}`);
      await answer(L.deleted);
      await send(env, chat, `🗑 ${L.deleted} <s>${esc(e.title)}</s>`);
      return true;
    }
    case 'xi': {
      const e = await one(env, 'SELECT * FROM cal_events WHERE id = ? AND owner_id = ?', +id, uid);
      await answer(e ? undefined : L.staleBtn);
      if (e) await tgUpload(env, 'sendDocument', { chat_id: chat }, 'document', `event-${e.id}.ics`, eventIcs(e, tz(env)), 'text/calendar');
      return true;
    }
    case 'rx': {
      const r = await one(env, 'SELECT * FROM user_reminders WHERE id = ? AND owner_id = ?', +id, uid);
      if (!r || r.done) { await answer(L.staleBtn); return true; }
      if (!(await claim(env, 'UPDATE user_reminders SET done = 1 WHERE id = ? AND done = 0', r.id))) { await answer(L.staleBtn); return true; }
      await answer(L.deleted);
      await send(env, chat, `🗑 ${L.deleted} <s>${esc(r.text)}</s>`);
      return true;
    }
    case 'rd': await answer(L.doneOk); await dropKeyboard(); return true;
    case 'rp': {
      await run(env, 'UPDATE user_reminders SET done = 1 WHERE id = ? AND owner_id = ?', +id, uid);
      await answer(); await dropKeyboard(); await send(env, chat, L.stopped);
      return true;
    }
    case 'rs': {
      const r = await one(env, 'SELECT * FROM user_reminders WHERE id = ? AND owner_id = ?', +id, uid);
      // A second tap on the same message (the buttons are already gone) must not add a second reminder.
      if (!r || !(await dropKeyboard())) { await answer(L.staleBtn); return true; }
      const due = Date.now() + (+arg || 15) * MIN;
      await run(env, 'INSERT INTO user_reminders (owner_id, text, due_at, repeat, created_at) VALUES (?, ?, ?, ?, ?)', uid, r.text, due, 'none', Date.now());
      await answer(); await send(env, chat, L.snoozed(hmLocal(env, due)));
      return true;
    }
    case 'lr': await answer(); await setMode(env, uid, 'revise', id); await send(env, chat, L.reviseAsk); return true;
    case 'lt': await answer(); await send(env, chat, L.letterLangAsk, kb([[['🇺🇿 UZ', `lx:${id}:uz`], ['🇷🇺 RU', `lx:${id}:ru`], ['🇬🇧 EN', `lx:${id}:en`]]])); return true;
    case 'lx': await answer(); await dropKeyboard(); await doRevise(env, uid, chat, L, +id, `Translate the whole letter into ${LANG_FULL[arg] || arg}, keeping its meaning and tone.`); return true;
  }
  return false;
}

// ======================= scheduled (cron, every minute) =======================

// Each send is claimed first with a conditional UPDATE, so overlapping cron runs never send it twice; if Telegram
// fails for a passing reason, the claim is released and the next minute tries again.
export async function secretaryChecks(env) {
  await morningBrief(env).catch((e) => reportError(env, e, 'morning brief')); // before the day's reminders start
  const now = Date.now();

  for (const e of await all(env, 'SELECT * FROM cal_events WHERE reminded = 0 AND remind_at IS NOT NULL AND remind_at <= ?', now)) {
    if (!(await claim(env, 'UPDATE cal_events SET reminded = 1 WHERE id = ? AND reminded = 0', e.id))) continue;
    if (e.start_at < now - 5 * MIN) continue; // too late to be useful
    const { L } = await strings(env, e.owner_id);
    const mins = Math.max(0, Math.round((e.start_at - now) / MIN));
    try {
      await sendOrRelease(env, () => send(env, e.owner_id, `${L.eventHeadsUp(mins, esc(e.title))}\n🕒 ${hmLocal(env, e.start_at)}${e.location ? ` · 📍 ${esc(e.location)}` : ''}`),
        () => run(env, 'UPDATE cal_events SET reminded = 0 WHERE id = ?', e.id));
    } catch (err) { await reportError(env, err, 'event heads-up'); continue; }
    await logEvent(env, 'cron', 'event_heads_up', null, `#${e.id}`);
  }

  for (const r of await all(env, 'SELECT * FROM user_reminders WHERE done = 0 AND due_at <= ? ORDER BY due_at LIMIT 20', now)) {
    let release;
    if (r.repeat === 'none') {
      if (!(await claim(env, 'UPDATE user_reminders SET done = 1 WHERE id = ? AND done = 0', r.id))) continue;
      release = () => run(env, 'UPDATE user_reminders SET done = 0 WHERE id = ?', r.id);
    } else {
      let next = nextDue(env, r.due_at, r.repeat, r.anchor_day);
      while (next <= now) next = nextDue(env, next, r.repeat, r.anchor_day);
      if (!(await claim(env, 'UPDATE user_reminders SET due_at = ? WHERE id = ? AND due_at = ? AND done = 0', next, r.id, r.due_at))) continue;
      release = () => run(env, 'UPDATE user_reminders SET due_at = ? WHERE id = ? AND due_at = ?', r.due_at, r.id, next);
    }
    if (r.due_at < now - 12 * HOUR) continue; // missed by far (the bot was down): skip this one, keep the series
    const { L } = await strings(env, r.owner_id);
    const last = r.repeat === 'none' ? [L.btnDone, `rd:${r.id}`] : [L.btnStop, `rp:${r.id}`];
    try {
      await sendOrRelease(env, () => send(env, r.owner_id, `${L.reminderFire}\n${esc(r.text)}`, kb([[[L.btnSnooze15, `rs:${r.id}:15`], [L.btnSnooze60, `rs:${r.id}:60`]], [last]])), release);
    } catch (err) { await reportError(env, err, 'reminder'); continue; }
    await logEvent(env, 'cron', 'user_reminder', null, `#${r.id}`);
  }
}

// Once a day between BRIEF_HOUR and noon (Tashkent time): today's plan, if there is anything.
async function morningBrief(env) {
  for (const uid of userIds(env)) await morningBriefFor(env, uid);
}
async function morningBriefFor(env, uid) {
  const hour = new Date(Date.now() + tz(env)).getUTCHours();
  if (hour < (Number(env.BRIEF_HOUR) || 8) || hour >= 12) return;
  const today = localISODate(env);
  if (!(await claim(env, `UPDATE prefs SET brief_date = ? WHERE telegram_id = ? AND COALESCE(brief_date, '') <> ?`, today, uid, today))) return;
  const { lang, L } = await strings(env, uid);
  const a = await agenda(env, uid, L, lang, today, today);
  if (a) { await sendLong(env, uid, `${L.briefTitle}\n\n${a.text}`); await logEvent(env, 'cron', 'morning_brief'); }
}
