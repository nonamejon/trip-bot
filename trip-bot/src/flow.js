// The trip flow: owner messages, button presses, agent replies, and scheduled checks.
//
//  collecting -> draft -> sent -> offers -> chosen -> booked -> done
//                 (owner approves) (agent answers) (owner picks) (agent uploads)
//  Any open state can go to cancelled.
//
// Text: the owner sees his chosen language (O[lang], /uz or /ru); the agent sees AGENT_LANG (AL(env)).
// Admin output and error alerts are English.

import {
  MIN, DAY, one, all, run, logEvent, getTrip, activeTrip, createTrip, saveTrip, setStatus, WITH_AGENT, OPEN, code,
  fmtLocal, hmLocal, dshort, localToUtc, localISODate, addDaysISO, nights, esc, money, refundWord, b64, encrypt, decrypt,
  getLang, setLang, strings, getMode, setMode, clearMode, logChat, recentChat,
} from './util.js';
import { tg, tgUpload, send, typing, whileTyping, kb, replyKb, download } from './telegram.js';
import { parseRequest, parseOffers, transcribe, routeMessage, parseWhen } from './gemini.js';
import { toAgent, openAgentThread, mirror, isMock } from './agent.js';
import { tripIcs } from './files.js';
import { O, AL, agentLang, PICK_TEXT, PICK_BUTTONS, COMMANDS, KB_TRIPS, KB_SEC } from './i18n.js';
import { secMenu, addEvent, addReminder, showAgenda, listReminders, doTranslate, doLetter, doRevise, handleSecCallback } from './secretary.js';

// Baggage is not required: the agent states the allowance of each fare instead.
const REQUIRED = ['destination', 'date_from', 'date_to', 'travelers'];
const FIELD_KEYS = ['origin', 'destination', 'date_from', 'date_to', 'travelers', 'traveler_names', 'flight_pref', 'baggage', 'hotel', 'budget', 'notes'];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const isTime = (s) => /^\d{2}:\d{2}$/.test(s || '');
const MAX_MEDIA = 15 * 1024 * 1024;

const isOwner = (env, id) => String(id) === String(env.OWNER_ID);
// ADMIN_ID may list several people, comma-separated.
export const adminIds = (env) => String(env.ADMIN_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
const isAdmin = (env, id) => adminIds(env).includes(String(id));

export async function reportError(env, e, where) {
  console.error(where, e);
  try {
    await logEvent(env, 'bot', 'error', null, `${where}: ${e?.message || e}`);
    for (const a of adminIds(env)) await send(env, a, `<b>Bot error</b> in ${esc(where)}:\n<code>${esc(String(e?.message || e)).slice(0, 900)}</code>`).catch(() => {});
  } catch { /* nothing else to do */ }
}

// ======================= text blocks =======================

// The request as the agent sees it (plain text, agent's language).
export function templateText(env, t) {
  const A = AL(env), al = agentLang(env), f = t.fields, n = nights(f.date_from, f.date_to);
  return [
    `${A.request} #${t.code}`,
    `${A.route}: ${f.origin || A.origin} → ${f.destination}`,
    `${A.dates}: ${dshort(f.date_from, al)} – ${dshort(f.date_to, al)}${n != null ? ` (${A.nights(n)})` : ''}`,
    `${A.travelers}: ${f.travelers}${f.traveler_names ? ` (${f.traveler_names})` : ''}`,
    `${A.flight}: ${f.flight_pref || A.noPref}`,
    `${A.baggage}: ${f.baggage || A.baggageAsk}`,
    `${A.hotel}: ${f.hotel || A.noPref}`,
    `${A.budget}: ${f.budget || A.notSet}`,
    f.notes ? `${A.notes}: ${f.notes}` : null,
    A.ask,
  ].filter(Boolean).join('\n');
}

// The request card. Missing required items show ❓ (the bot asks for them under the card).
function draftText(L, lang, t) {
  const f = t.fields, n = nights(f.date_from, f.date_to), Q = '❓';
  return [
    `<b>${L.checkTitle}</b> · ${t.code}`, '',
    `${L.route}: ${esc(f.origin || L.origin)} → ${f.destination ? esc(f.destination) : Q}`,
    `${L.dates}: ${f.date_from ? dshort(f.date_from, lang) : Q} – ${f.date_to ? dshort(f.date_to, lang) : Q}${n != null ? ` (${L.nights(n)})` : ''}`,
    `${L.travelers}: ${f.travelers ? esc(f.travelers) : Q}${f.traveler_names ? ` (${esc(f.traveler_names)})` : ''}`,
    `${L.flight}: ${esc(f.flight_pref || L.noPref)}`,
    `${L.baggage}: ${f.baggage ? esc(f.baggage) : L.baggageByFare}`,
    `${L.hotel}: ${esc(f.hotel || L.noPref)}`,
    `${L.budget}: ${esc(f.budget || L.notSet)}`,
    f.notes ? `${L.notes}: ${esc(f.notes)}` : null, '',
    `<i>${L.passportNote}</i>`,
  ].filter((x) => x !== null).join('\n');
}

function compareText(L, lang, t) {
  const out = [`<b>${L.nOptions(t.offers.length)} · ${esc(t.fields.destination)}</b> · ${t.code}`];
  t.offers.forEach((o, i) => {
    out.push('', `<b>${esc(o.label)}</b> · ${esc(money(o, lang))}${i === t.recommended ? ` · <u>${L.recommended}</u>` : ''}`,
      `${L.flight}: ${esc([o.airline, o.outbound, o.stops].filter(Boolean).join(' · ') || L.notStated)}`,
      o.return ? `${L.back}: ${esc(o.return)}` : null,
      `${L.hotel}: ${esc([o.hotel, o.distance].filter(Boolean).join(' · ') || L.notStated)}`,
      o.baggage ? `${L.baggage}: ${esc(o.baggage)}` : null,
      `${L.cancellation}: ${esc(refundWord(o.refund, lang))}${o.refund_note ? ` (${esc(o.refund_note)})` : ''}`);
  });
  if (t.recommended != null && t.reason && t.offers[t.recommended]) out.push('', `<i>${L.why(esc(t.offers[t.recommended].label))}: ${esc(t.reason)}</i>`);
  return out.filter((x) => x !== null).join('\n');
}

async function tripText(env, L, lang, t) {
  const o = t.offers[t.chosen] || {}, f = t.fields;
  const rem = await all(env, 'SELECT * FROM reminders WHERE trip_id = ? ORDER BY due_at', t.id);
  return [
    `<b>${L.booked}: ${esc(f.origin || L.origin)} → ${esc(f.destination)}</b> · ${t.code}`, '',
    `${L.out}: ${dshort(f.date_from, lang)}${o.outbound ? ' · ' + esc(o.outbound) : ''}${o.airline ? ' · ' + esc(o.airline) : ''}`,
    `${L.back}: ${o.return ? esc(o.return) : dshort(f.date_to, lang)}`,
    `${L.hotel}: ${esc([o.hotel, o.distance].filter(Boolean).join(' · ') || L.seeVoucher)}`,
    `${L.total}: ${esc(money(o, lang))} · ${esc(refundWord(o.refund, lang))}`, '',
    rem.length ? `${L.reminders}:\n` + rem.map((r) => `· ${r.type === 'checkin' ? L.remCheckin : L.remLeave}: ${fmtLocal(env, r.due_at, lang)}`).join('\n')
      : L.noFlightTime,
  ].join('\n');
}

const STEP_ORDER = ['draft', 'sent', 'offers', 'chosen', 'booked', 'done'];
function statusText(env, L, lang, t) {
  const cur = STEP_ORDER.indexOf(t.status);
  const lines = STEP_ORDER.map((s, i) => (i < cur ? '✓ ' : i === cur ? '› <b>' : '· ') + L.steps[s] + (i === cur ? '</b>' : ''));
  if (t.status === 'collecting') lines.unshift(`› <b>${L.collecting}</b>`);
  if (t.status === 'sent' && t.due_at) lines.push('', L.agentDue(fmtLocal(env, t.due_at, lang)));
  return `<b>${esc(t.fields.destination || L.trip)}</b> · ${t.code}\n\n` + lines.join('\n');
}

// The keyboard that stays at the bottom of the chat: the two sections.
export const mainKb = (L) => replyKb([[L.kbTrips, L.kbSec]]);
const route = (L, t) => `${esc(t.fields.origin || L.origin)} → ${esc(t.fields.destination)}`;

// ======================= language =======================

const askLanguage = (env, chat) => send(env, chat, PICK_TEXT, kb(PICK_BUTTONS));

async function chooseLanguage(env, uid, chat, lang) {
  await setLang(env, uid, lang);
  await logEvent(env, 'owner', 'language', null, lang);
  // The command menu in this chat follows the chosen language.
  await tg(env, 'setMyCommands', { commands: COMMANDS[lang], scope: { type: 'chat', chat_id: chat } }).catch((e) => reportError(env, e, 'setMyCommands'));
  const L = O[lang];
  return send(env, chat, `${L.langSet}\n\n${L.help}`, mainKb(L));
}

// ======================= owner messages =======================

// Audio sent with Attach -> File often has a vendor mime type (audio/x-m4a, audio/x-wav) or none; normalize from the extension.
const EXT_MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac' };
function docMime(d) {
  const ext = (d.file_name || '').split('.').pop().toLowerCase();
  const m = (d.mime_type || '').toLowerCase();
  if (m === 'audio/x-m4a' || m === 'audio/m4a') return 'audio/mp4';
  if (m === 'audio/x-wav' || m === 'audio/wave') return 'audio/wav';
  if (m && m !== 'application/octet-stream') return m;
  return EXT_MIME[ext] || m;
}

// tooLarge: the message to show when the file is over the limit.
async function mediaOf(env, msg, tooLarge) {
  let fileId, mime, size;
  if (msg.voice) ({ file_id: fileId, file_size: size } = msg.voice), (mime = msg.voice.mime_type || 'audio/ogg');
  else if (msg.audio) ({ file_id: fileId, file_size: size } = msg.audio), (mime = msg.audio.mime_type || 'audio/mpeg');
  else if (msg.photo?.length) ({ file_id: fileId, file_size: size } = msg.photo[msg.photo.length - 1]), (mime = 'image/jpeg');
  else if (msg.video_note) ({ file_id: fileId, file_size: size } = msg.video_note), (mime = 'video/mp4');
  else if (msg.document && /^(application\/pdf|image\/|audio\/)/.test(docMime(msg.document))) ({ file_id: fileId, file_size: size } = msg.document), (mime = docMime(msg.document));
  if (!fileId) return [];
  if (size && size > MAX_MEDIA) throw Object.assign(new Error('file too large'), { userText: tooLarge });
  return [{ mime, b64: b64(await download(env, fileId)) }];
}

export async function handleOwnerMessage(env, msg) {
  const uid = msg.from.id, chat = msg.chat.id;
  const text = (msg.text || msg.caption || '').trim();

  if (text.startsWith('/')) return ownerCommand(env, msg, text);
  if (!isOwner(env, uid)) return send(env, chat, 'You are set up as admin only. Admin commands: /trips /trip /log /jobs /now /fire /setstatus');

  const lang = await getLang(env, uid);
  if (!lang) return askLanguage(env, chat);
  const L = O[lang];

  // The two sections on the bottom keyboard
  if (KB_TRIPS.has(text)) { await clearMode(env, uid); return tripsMenu(env, uid, chat, L, lang); }
  if (KB_SEC.has(text)) { await clearMode(env, uid); return secMenu(env, chat, L); }

  let media;
  try { media = await mediaOf(env, msg, L.tooLarge); } catch (e) { if (e.userText) return send(env, chat, e.userText); throw e; }
  if (!text && !media.length) return send(env, chat, L.canRead);
  const isVoice = media.length > 0 && /^(audio|video)\//.test(media[0].mime);

  // A button asked for this message (translate mode, a letter, a note for the agent, ...)
  // Conversation memory: the recent chat (read before this message is logged), and this message.
  const history = await recentChat(env, uid);
  const kind = msg.voice || msg.audio ? '[voice note]' : msg.video_note ? '[video message]' : msg.photo ? '[photo]' : msg.document ? `[file ${msg.document.file_name || ''}]` : '';
  const logId = await logChat(env, uid, 'in', [kind, text].filter(Boolean).join(' '));

  const mode = await getMode(env, uid);
  if (mode && mode.mode !== 'clarify') return handleMode(env, msg, uid, chat, L, lang, mode, text, media, isVoice);

  // Otherwise Gemini decides what the message is for.
  const t = await activeTrip(env, uid);
  let r;
  try { r = await whileTyping(env, chat, () => routeMessage(env, text, media, { lang, trip: t && { code: t.code, status: t.status, destination: t.fields.destination }, pending: mode?.arg || null, history })); }
  catch (e) {
    await reportError(env, e, 'routeMessage');
    // While a trip request is being filled in, a message that could not be routed is most likely part of it.
    if (t && ['collecting', 'draft'].includes(t.status) && !isVoice) return buildRequest(env, uid, chat, t, text, media, L, lang, null, history);
    return send(env, chat, L.readFail);
  }
  if (mode) await clearMode(env, uid);
  if (r.transcript && logId) await run(env, 'UPDATE chat_log SET text = ? WHERE id = ?', `${kind} ${r.transcript}`.slice(0, 2000), logId);
  const said = text || r.transcript || '';
  const askAgain = async (question) => { await setMode(env, uid, 'clarify', mode?.arg ? `${mode.arg}\n${said}` : said); return send(env, chat, esc(question)); };
  // For a voice note, the router already transcribed it; later steps get the transcript instead of the audio.
  const useText = isVoice && r.transcript ? r.transcript : text;
  const useMedia = isVoice && r.transcript ? [] : media;
  await logEvent(env, 'owner', 'route', t?.id ?? null, r.intent);

  switch (r.intent) {
    case 'trip': return buildRequest(env, uid, chat, t && ['collecting', 'draft'].includes(t.status) ? t : null, useText, useMedia, L, lang, isVoice ? r.transcript : null, history);
    case 'trip_note': {
      const row = await one(env, `SELECT id FROM trips WHERE owner_id = ? AND status IN ('sent', 'offers', 'chosen', 'booked') ORDER BY id DESC LIMIT 1`, uid);
      if (!row) return buildRequest(env, uid, chat, t && ['collecting', 'draft'].includes(t.status) ? t : null, useText, useMedia, L, lang, isVoice ? r.transcript : null, history);
      return noteToAgent(env, msg, await getTrip(env, row.id), chat, L, said, media);
    }
    case 'trip_status': return send(env, chat, t ? statusText(env, L, lang, t) : L.noTripTell);
    case 'trip_cancel':
      if (!t) return send(env, chat, L.noCancel);
      return ['collecting', 'draft'].includes(t.status) ? cancelTrip(env, t, 'owner') : askCancel(env, t);
    case 'event':
      if (r.question || !isDate(r.ev_date)) return askAgain(r.question || L.chatFallback);
      return addEvent(env, uid, chat, L, lang, r);
    case 'reminder':
      if (r.question || !isDate(r.rm_date)) return askAgain(r.question || L.chatFallback);
      if (!(await addReminder(env, uid, chat, L, lang, r))) return askAgain(L.reminderPast);
      return;
    case 'translate': {
      const src = r.tr_text || (isVoice ? r.transcript : null);
      return doTranslate(env, chat, L, lang, src, src ? [] : media, r.tr_target);
    }
    case 'letter': return doLetter(env, uid, chat, L, lang, r.lt_request || said);
    case 'agenda': {
      const from = isDate(r.ag_from) ? r.ag_from : localISODate(env);
      let to = isDate(r.ag_to) && r.ag_to >= from ? r.ag_to : from;
      if (to > addDaysISO(from, 30)) to = addDaysISO(from, 30);
      return showAgenda(env, uid, chat, L, lang, from, to);
    }
    case 'reminders_list': return listReminders(env, uid, chat, L, lang);
    default: return send(env, chat, esc(r.reply || L.chatFallback), mainKb(L));
  }
}

// The next message after a button: translate it, write a letter from it, pass it to the agent, ...
async function handleMode(env, msg, uid, chat, L, lang, mode, text, media, isVoice) {
  if (mode.mode === 'translate') {
    await setMode(env, uid, 'translate', mode.arg); // stay in translate mode
    return doTranslate(env, chat, L, lang, media.length ? null : text, media, mode.arg || null);
  }
  let said = text;
  if (!said && isVoice) {
    await typing(env, chat);
    try { said = await transcribe(env, media); } catch (e) { await reportError(env, e, 'transcribe'); return send(env, chat, L.readFail); }
  }
  await clearMode(env, uid);
  switch (mode.mode) {
    case 'letter': return said ? doLetter(env, uid, chat, L, lang, said) : send(env, chat, L.letterAsk);
    case 'revise': return said ? doRevise(env, uid, chat, L, +mode.arg, said) : send(env, chat, L.reviseAsk);
    case 'agent': {
      const t = await getTrip(env, +mode.arg);
      if (!t || t.owner_id !== uid || !WITH_AGENT.includes(t.status)) return send(env, chat, L.staleBtn);
      return noteToAgent(env, msg, t, chat, L, said, media);
    }
    case 'flight_time': return setFlightTime(env, uid, chat, L, lang, +mode.arg, said);
  }
  return send(env, chat, L.chatFallback);
}

async function noteToAgent(env, msg, t, chat, L, said, media) {
  const A = AL(env);
  await toAgent(env, t, `${A.note(t.code)}\n"${said || A.fileAttached}"`, 'note');
  // A real agent also gets the original file (voice note, photo, PDF).
  if (!isMock(env) && media.length) await tg(env, 'forwardMessage', { chat_id: env.AGENT_CHAT_ID, from_chat_id: chat, message_id: msg.message_id, ...(t.agent_thread_id ? { message_thread_id: t.agent_thread_id } : {}) });
  return send(env, chat, L.passedOn);
}

async function setFlightTime(env, uid, chat, L, lang, tripId, said) {
  const t = await getTrip(env, tripId);
  if (!t || t.owner_id !== uid) return send(env, chat, L.staleBtn);
  let w;
  try { w = await parseWhen(env, said || ''); } catch (e) { await reportError(env, e, 'parseWhen'); return send(env, chat, L.readFail); }
  if (!isDate(w.date) || !isTime(w.time)) { await setMode(env, uid, 'flight_time', tripId); return send(env, chat, L.flightTimeBad); }
  t.flight_at = localToUtc(env, `${w.date}T${w.time}`);
  const o = t.offers[t.chosen];
  if (o) o.outbound_datetime = `${w.date}T${w.time}`;
  await saveTrip(env, t);
  await run(env, 'DELETE FROM reminders WHERE trip_id = ? AND sent_at IS NULL', t.id);
  await scheduleFlightReminders(env, t);
  await logEvent(env, 'owner', 'flight_time', t.id, `${w.date}T${w.time}`);
  return send(env, chat, `${L.flightTimeSet}\n\n${await tripText(env, L, lang, t)}`);
}

async function scheduleFlightReminders(env, t) {
  if (!t.flight_at) return;
  const now = Date.now();
  for (const [type, at] of [['checkin', t.flight_at - DAY], ['leave', t.flight_at - 3 * 60 * MIN]]) {
    if (at > now) await run(env, 'INSERT INTO reminders (trip_id, type, due_at) VALUES (?, ?, ?)', t.id, type, at);
  }
}

// ======================= My trips section =======================

async function tripsMenu(env, uid, chat, L, lang) {
  const t = await activeTrip(env, uid);
  const rows = [[[L.btnNewTrip, 'nt'], [L.btnAllTrips, 'mt']]];
  if (t) rows.unshift([[L.btnCurrentTrip, `tv:${t.id}`]]);
  return send(env, chat, `${L.tripsTitle}\n\n${t ? statusText(env, L, lang, t) + '\n\n' : ''}${L.tripsHint}`, kb(rows));
}

// One trip: route, dates, booking, documents, and what can be done with it now.
async function tripCard(env, chat, L, lang, t) {
  const f = t.fields, o = t.chosen != null ? t.offers[t.chosen] : null, n = nights(f.date_from, f.date_to);
  const docs = await all(env, 'SELECT id FROM documents WHERE trip_id = ?', t.id);
  const lines = [`<b>✈️ ${route(L, t)}</b> · ${t.code}`, `${L.statusLabel}: <b>${L.statusWord[t.status] || t.status}</b>`];
  if (f.date_from) lines.push(`🗓 ${dshort(f.date_from, lang)} – ${dshort(f.date_to, lang)}${n != null ? ` (${L.nights(n)})` : ''}`);
  if (f.travelers) lines.push(`👤 ${L.travelers}: ${esc(f.travelers)}${f.traveler_names ? ` (${esc(f.traveler_names)})` : ''}`);
  if (o) {
    lines.push('', `<b>${L.bookingTitle}: ${esc(o.label)}</b> · ${esc(money(o, lang))}`,
      `${L.flight}: ${esc([o.airline, o.outbound, o.stops].filter(Boolean).join(' · ') || L.notStated)}`);
    if (o.return) lines.push(`${L.back}: ${esc(o.return)}`);
    lines.push(`${L.hotel}: ${esc([o.hotel, o.distance].filter(Boolean).join(' · ') || L.notStated)}`);
    if (o.baggage) lines.push(`${L.baggage}: ${esc(o.baggage)}`);
    lines.push(`${L.cancellation}: ${esc(refundWord(o.refund, lang))}${o.refund_note ? ` (${esc(o.refund_note)})` : ''}`);
  }
  if (t.flight_at) lines.push(`🛫 ${fmtLocal(env, t.flight_at, lang)}`);
  if (t.status === 'sent' && t.due_at) lines.push('', L.agentDue(fmtLocal(env, t.due_at, lang)));

  const rows = [];
  if (t.status === 'draft') rows.push([[L.btnApprove, `ap:${t.id}`]]);
  if (t.status === 'offers') rows.push([[L.btnOptions, `ov:${t.id}`]]);
  if (docs.length) rows.push([[L.btnDocs(docs.length), `td:${t.id}`]]);
  if (WITH_AGENT.includes(t.status)) rows.push([[L.btnWriteAgent, `aw:${t.id}`]]);
  if (['booked', 'done'].includes(t.status) && o) rows.push([[L.btnTripIcs, `tc:${t.id}`]]);
  if (t.status === 'booked' && !t.flight_at) rows.push([[L.btnFlightTime, `tf:${t.id}`]]);
  if (OPEN.includes(t.status)) rows.push([[L.btnCancelTrip, `tx:${t.id}`]]);
  return send(env, chat, lines.join('\n'), kb(rows));
}

function offersMessage(env, t, L, lang) {
  const rows = t.offers.map((o, i) => [[`${i === t.recommended ? '★ ' : ''}${o.label} · ${money(o, lang)}`, `ch:${t.id}:${i}`]]);
  rows.push([[L.btnOther, `ot:${t.id}`]]);
  return send(env, t.owner_id, compareText(L, lang, t), kb(rows));
}

// heardText: transcript of a voice note, when the router already made one.
// history: recent conversation; heardText: transcript of a voice note (logged, not echoed back).
async function buildRequest(env, uid, chat, t, text, media, L, lang, heardText = null, history = '') {
  if (!t) t = await createTrip(env, uid);
  let r;
  try { r = await whileTyping(env, chat, () => parseRequest(env, t.fields, text, media, lang, history)); }
  catch (e) { await reportError(env, e, 'parseRequest'); return send(env, chat, L.readFail); }

  // Take Gemini's values, then drop anything that cannot be right.
  for (const k of FIELD_KEYS) if (r[k] != null && r[k] !== '') t.fields[k] = r[k];
  for (const k of ['date_from', 'date_to']) if (t.fields[k] && !isDate(t.fields[k])) delete t.fields[k];
  if (t.fields.date_from && t.fields.date_to && t.fields.date_to < t.fields.date_from) delete t.fields.date_to;
  if (t.fields.travelers != null && !(Number.isInteger(+t.fields.travelers) && +t.fields.travelers >= 1 && +t.fields.travelers <= 20)) delete t.fields.travelers;
  t.fields.origin ||= L.origin;
  await logEvent(env, 'owner', 'request_input', t.id, { text, media: media.map((m) => m.mime), transcript: heardText || r.transcript || null, fields: t.fields });

  const missing = REQUIRED.filter((k) => !t.fields[k]);
  if (missing.length) {
    // Show everything understood so far, then ask for all missing items in one message.
    if (t.status !== 'collecting') await setStatus(env, t, 'collecting', 'owner'); else await saveTrip(env, t);
    const optional = !t.fields.flight_pref && !t.fields.hotel ? `\n${L.optionalHint}` : '';
    return send(env, chat, `${draftText(L, lang, t)}\n\n<b>${L.askMissing(missing.filter((k) => k !== 'date_to' || !missing.includes('date_from')).map((k) => L.field[k]).join(', '))}</b>${optional}`,
      kb([[[L.btnCancel, `cx:${t.id}`]]]));
  }
  t.draft_at = Date.now(); t.nudged = 0;
  await setStatus(env, t, 'draft', 'owner');
  return send(env, chat, draftText(L, lang, t), kb([[[L.btnApprove, `ap:${t.id}`]], [[L.btnEdit, `ed:${t.id}`], [L.btnCancel, `cx:${t.id}`]]]));
}

// ======================= commands =======================

async function ownerCommand(env, msg, text) {
  const chat = msg.chat.id, uid = msg.from.id;
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ').trim();
  const c = cmd.toLowerCase().replace(/@.*$/, '');

  if (isAdmin(env, uid) && ADMIN[c]) return ADMIN[c](env, chat, arg);
  if (!isOwner(env, uid)) return;
  await logChat(env, uid, 'in', c === '/passport' ? '/passport (hidden)' : text);

  if (c === '/uz' || c === '/ru') return chooseLanguage(env, uid, chat, c.slice(1));
  if (c === '/lang' || c === '/language') return askLanguage(env, chat);
  const lang = await getLang(env, uid);
  if (!lang) return askLanguage(env, chat); // first contact: pick a language before anything else
  const L = O[lang];
  await clearMode(env, uid); // any command ends translate mode etc.

  switch (c) {
    case '/start':
    case '/help':
    case '/menu':
      return send(env, chat, L.help, mainKb(L));
    case '/today': { const d = localISODate(env); return showAgenda(env, uid, chat, L, lang, d, d); }
    case '/reminders': return listReminders(env, uid, chat, L, lang);
    case '/new': return send(env, chat, L.whereWhen);
    case '/status': { const t = await activeTrip(env, uid); return send(env, chat, t ? statusText(env, L, lang, t) : L.noTripTell); }
    case '/trips': return myTrips(env, L, lang, uid, chat);
    case '/cancel': { const t = await activeTrip(env, uid); return t ? askCancel(env, t) : send(env, chat, L.noCancel); }
    case '/passport': {
      if (!arg) return send(env, chat, L.passportHow);
      await run(env, 'INSERT INTO travelers (telegram_id, name, passport_enc, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET passport_enc = excluded.passport_enc, updated_at = excluded.updated_at',
        uid, msg.from.first_name || null, await encrypt(env, arg), Date.now());
      await logEvent(env, 'owner', 'passport_saved');
      await tg(env, 'deleteMessage', { chat_id: chat, message_id: msg.message_id }).catch(() => {});
      return send(env, chat, L.passportSaved);
    }
    default: return send(env, chat, L.unknownCmd);
  }
}

async function myTrips(env, L, lang, uid, chat) {
  const rows = await all(env, 'SELECT id, status, fields FROM trips WHERE owner_id = ? ORDER BY id DESC LIMIT 10', uid);
  if (!rows.length) return send(env, chat, L.noTripsYet);
  return send(env, chat, `<b>${L.yourTrips}</b>`, kb(rows.map((r) => {
    const f = JSON.parse(r.fields || '{}');
    return [[`${code(r.id)} · ${f.destination || '?'} · ${dshort(f.date_from, lang)} · ${L.statusWord[r.status] || r.status}`, `tv:${r.id}`]];
  })));
}

const ADMIN = {
  async '/trips'(env, chat) {
    const rows = await all(env, 'SELECT id, status, fields, updated_at FROM trips ORDER BY id DESC LIMIT 15');
    return send(env, chat, rows.length ? rows.map((r) => `${code(r.id)} · ${r.status} · ${esc(JSON.parse(r.fields || '{}').destination || '?')} · ${fmtLocal(env, r.updated_at)}`).join('\n') : 'No trips.');
  },
  async '/trip'(env, chat, arg) {
    const t = await getTrip(env, parseInt(String(arg).replace(/\D/g, ''), 10));
    if (!t) return send(env, chat, 'Usage: /trip T-0001');
    return send(env, chat, `<pre>${esc(JSON.stringify(t, null, 1)).slice(0, 3800)}</pre>`);
  },
  async '/log'(env, chat, arg) {
    const n = Math.min(parseInt(arg, 10) || 20, 50);
    const rows = await all(env, 'SELECT * FROM events ORDER BY id DESC LIMIT ?', n);
    return send(env, chat, `<pre>${esc(rows.reverse().map((e) => `${hmLocal(env, e.ts)} ${e.actor} ${e.action}${e.trip_id ? ' ' + code(e.trip_id) : ''}${e.detail ? ' · ' + String(e.detail).replace(/\s+/g, ' ').slice(0, 80) : ''}`).join('\n')).slice(0, 3800)}</pre>`);
  },
  async '/setstatus'(env, chat, arg) {
    const [id, st] = arg.split(/\s+/);
    const t = await getTrip(env, parseInt(String(id).replace(/\D/g, ''), 10));
    const ok = ['collecting', 'draft', 'sent', 'offers', 'chosen', 'booked', 'done', 'cancelled'];
    if (!t || !ok.includes(st)) return send(env, chat, 'Usage: /setstatus T-0001 ' + ok.join('|'));
    await setStatus(env, t, st, 'admin');
    return send(env, chat, `${t.code} is now ${st}.`);
  },
  async '/fire'(env, chat, arg) {
    const id = parseInt(String(arg).replace(/\D/g, ''), 10);
    if (!id) return send(env, chat, 'Usage: /fire T-0001 — sends that trip’s pending reminders now');
    await run(env, 'UPDATE reminders SET due_at = ? WHERE trip_id = ? AND sent_at IS NULL', Date.now() - 1, id);
    await runChecks(env);
    return send(env, chat, 'Done.');
  },
  async '/jobs'(env, chat) {
    const rows = await all(env, 'SELECT * FROM jobs WHERE done_at IS NULL ORDER BY due_at');
    return send(env, chat, rows.length ? rows.map((j) => `${j.kind} · ${code(j.trip_id)} · due ${hmLocal(env, j.due_at)}`).join('\n') : 'No pending mock-agent jobs.');
  },
  async '/now'(env, chat) {
    // Makes every waiting mock-agent job due now, so you do not have to wait.
    await run(env, 'UPDATE jobs SET due_at = ? WHERE done_at IS NULL', Date.now() - 1);
    return send(env, chat, 'Pending agent replies will arrive within a minute.');
  },
};

// ======================= buttons =======================

export async function handleCallback(env, cq) {
  const uid = cq.from.id, chat = cq.message?.chat.id, data = cq.data || '';
  const answer = (text) => tg(env, 'answerCallbackQuery', { callback_query_id: cq.id, ...(text ? { text } : {}) }).catch(() => {});
  const dropKeyboard = () => tg(env, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  const { lang, L } = await strings(env, uid);
  if (!isOwner(env, uid)) return answer(L.notAllowed);

  const [a, idStr, argStr] = data.split(':');
  const label = (cq.message?.reply_markup?.inline_keyboard || []).flat().find((b) => b.callback_data === data)?.text;
  await logChat(env, uid, 'in', `[tapped: ${label || data}]`);
  if (a === 'lg') { await answer(); await dropKeyboard(); return chooseLanguage(env, uid, chat, idStr); }
  if (a === 'nt') { await answer(); return send(env, chat, L.whereWhenVoice); }
  if (a === 'mt') { await answer(); return myTrips(env, L, lang, uid, chat); }
  if (a === 'st') { await answer(); const t = await activeTrip(env, uid); return send(env, chat, t ? statusText(env, L, lang, t) : L.noTrip); }
  if (a === 'doc') { await answer(); const d = await one(env, 'SELECT * FROM documents WHERE id = ?', +idStr); return d && tg(env, 'sendDocument', { chat_id: chat, document: d.file_id, caption: d.name }); }
  if (await handleSecCallback(env, { a, id: idStr, arg: argStr, uid, chat, L, lang, answer, dropKeyboard })) return;

  // My trips: a trip's card and what can be done from it
  if (['tv', 'ov', 'td', 'aw', 'tc', 'tf', 'tx'].includes(a)) {
    const t = await getTrip(env, +idStr);
    if (!t || t.owner_id !== uid) return answer(L.staleBtn);
    await answer();
    switch (a) {
      case 'tv': return tripCard(env, chat, L, lang, t);
      case 'ov': return t.status === 'offers' ? offersMessage(env, t, L, lang) : tripCard(env, chat, L, lang, t);
      case 'td': {
        const docs = await all(env, 'SELECT * FROM documents WHERE trip_id = ? ORDER BY id', t.id);
        if (!docs.length) return send(env, chat, L.noDocs);
        for (const d of docs) await tg(env, 'sendDocument', { chat_id: chat, document: d.file_id, caption: d.name });
        return;
      }
      case 'aw':
        if (!WITH_AGENT.includes(t.status)) return send(env, chat, L.staleBtn);
        await setMode(env, uid, 'agent', t.id);
        return send(env, chat, L.agentAsk);
      case 'tc': return tgUpload(env, 'sendDocument', { chat_id: chat, caption: L.icsCaption }, 'document', `${t.code}.ics`, tripIcs(t, t.offers[t.chosen], L), 'text/calendar');
      case 'tf': await setMode(env, uid, 'flight_time', t.id); return send(env, chat, L.flightTimeAsk);
      case 'tx': return OPEN.includes(t.status) ? askCancel(env, t) : send(env, chat, L.staleBtn);
    }
  }

  const t = await getTrip(env, +idStr);
  const need = { ap: 'draft', ed: 'draft', ch: 'offers', ot: 'offers' }[a];
  if (!t || t.owner_id !== uid || (need && t.status !== need) || (['cy', 'cn'].includes(a) && !['collecting', ...WITH_AGENT, 'draft'].includes(t.status))) {
    await answer(L.staleBtn);
    return dropKeyboard();
  }
  await answer();
  await dropKeyboard();
  switch (a) {
    case 'ap': return approve(env, t);
    case 'ed':
      await setStatus(env, t, 'collecting', 'owner');
      return send(env, chat, L.editWhat);
    case 'cx': case 'cy': return ['collecting', 'draft'].includes(t.status) || a === 'cy' ? cancelTrip(env, t, 'owner') : askCancel(env, t);
    case 'cn': return send(env, chat, L.nothingChanged);
    case 'ch': return choose(env, t, +argStr);
    case 'ot': return otherOptions(env, t);
  }
}

// ======================= transitions =======================

async function approve(env, t) {
  const { lang, L } = await strings(env, t.owner_id);
  t.sent_at = Date.now();
  t.due_at = t.sent_at + (Number(env.AGENT_SLA_MIN) || 240) * MIN;
  t.sla_reminded = 0; t.clarify_asked = 0; t.agent_texts = []; t.offers = [];
  await setStatus(env, t, 'sent', 'owner');
  await openAgentThread(env, t);
  await toAgent(env, t, templateText(env, t), 'request');
  return send(env, t.owner_id, L.sentToAgent(fmtLocal(env, t.due_at, lang)));
}

async function choose(env, t, i) {
  const { L } = await strings(env, t.owner_id);
  const A = AL(env);
  const o = t.offers[i];
  if (!o) return send(env, t.owner_id, L.optionGone);
  t.chosen = i;
  await setStatus(env, t, 'chosen', 'owner');
  await toAgent(env, t, A.chose(o.label, money(o, agentLang(env))), 'choice');

  const trav = await one(env, 'SELECT passport_enc FROM travelers WHERE telegram_id = ?', t.owner_id);
  if (trav?.passport_enc) {
    const passport = await decrypt(env, trav.passport_enc);
    await logEvent(env, 'bot', 'passport_released_to_agent', t.id);
    await toAgent(env, t, `${A.passport(t.code)}\n${passport}`, 'passport');
  } else {
    await toAgent(env, t, A.noPassport(t.code), 'ack');
    await send(env, t.owner_id, L.noPassport);
  }
  return send(env, t.owner_id, L.booking(esc(o.label)));
}

async function otherOptions(env, t) {
  const { L } = await strings(env, t.owner_id);
  t.offers = []; t.agent_texts = []; t.clarify_asked = 0; t.recommended = null; t.reason = null;
  t.sent_at = Date.now(); t.due_at = t.sent_at + (Number(env.AGENT_SLA_MIN) || 240) * MIN; t.sla_reminded = 0;
  await setStatus(env, t, 'sent', 'owner');
  await toAgent(env, t, `${AL(env).other(t.code)}\n\n${templateText(env, t)}`, 'other');
  return send(env, t.owner_id, L.askedOther);
}

async function askCancel(env, t) {
  const { lang, L } = await strings(env, t.owner_id);
  const o = t.chosen != null ? t.offers[t.chosen] : null;
  let txt = L.cancelQ(t.code, esc(t.fields.destination || '?'));
  if (o && ['chosen', 'booked'].includes(t.status)) txt += '\n' + L.cancelTerms(esc(o.label), esc(refundWord(o.refund, lang)) + (o.refund_note ? ` (${esc(o.refund_note)})` : ''));
  return send(env, t.owner_id, txt, kb([[[L.btnYesCancel, `cy:${t.id}`], [L.btnKeep, `cn:${t.id}`]]]));
}

async function cancelTrip(env, t, actor) {
  const { L } = await strings(env, t.owner_id);
  const withAgent = WITH_AGENT.includes(t.status);
  await setStatus(env, t, 'cancelled', actor);
  await run(env, 'UPDATE jobs SET done_at = ? WHERE trip_id = ? AND done_at IS NULL', Date.now(), t.id);
  if (withAgent) await toAgent(env, t, AL(env).cancel(t.code), 'cancel');
  return send(env, t.owner_id, L.cancelled(t.code, withAgent));
}

// ======================= agent side =======================

// Real agent group (AGENT_MODE=group): find which trip the message is about.
export async function handleAgentMessage(env, msg) {
  let t = null;
  if (msg.message_thread_id) t = await getTripByThread(env, msg.message_thread_id);
  if (!t) {
    const row = await one(env, `SELECT id FROM trips WHERE status IN ('sent','offers','chosen','booked') ORDER BY updated_at DESC LIMIT 1`);
    t = row && (await getTrip(env, row.id));
  }
  if (!t) return;
  const text = (msg.text || msg.caption || '').trim();

  if (msg.document || msg.photo?.length) {
    if (['chosen', 'booked'].includes(t.status)) {
      const d = msg.document || msg.photo[msg.photo.length - 1];
      return handleAgentDocs(env, t, [{ name: msg.document?.file_name || 'photo.jpg', file_id: d.file_id }], text);
    }
    let media = [];
    try { media = await mediaOf(env, msg, AL(env).unreadable); } catch (e) { return send(env, env.AGENT_CHAT_ID, e.userText || AL(env).unreadable); }
    return handleAgentText(env, t, text, media);
  }
  if (text) return handleAgentText(env, t, text, []);
}

async function getTripByThread(env, threadId) {
  const row = await one(env, 'SELECT id FROM trips WHERE agent_thread_id = ? ORDER BY id DESC LIMIT 1', threadId);
  return row && getTrip(env, row.id);
}

// Used by both the real group and the mock agent.
export async function handleAgentText(env, t, text, media) {
  const { lang, L } = await strings(env, t.owner_id);
  await logEvent(env, 'agent', 'message', t.id, text || '(file)');
  if (['chosen', 'booked'].includes(t.status)) {
    if (text) await send(env, t.owner_id, `<b>${L.agentMsg}</b> · ${t.code}\n${esc(text)}`);
    return;
  }
  if (!['sent', 'offers'].includes(t.status)) return;

  if (text) t.agent_texts.push(text);
  await saveTrip(env, t);

  let r;
  try { r = await parseOffers(env, t.fields, t.agent_texts, media, lang); }
  catch (e) { await reportError(env, e, 'parseOffers'); return send(env, t.owner_id, `${L.agentUnreadable(t.code)}\n${esc(text || L.file)}`); }

  const offers = Array.isArray(r.offers) ? r.offers.slice(0, 5) : [];
  if (!offers.length) {
    return send(env, t.owner_id, `<b>${L.agentWrote}</b> · ${t.code}\n${esc(text || L.file)}`);
  }
  if (media.length) t.agent_texts.push('[Options read from the agent’s attachment] ' + JSON.stringify(offers));
  t.offers = offers;
  t.recommended = Number.isInteger(r.recommended) && offers[r.recommended] ? r.recommended : null;
  t.reason = r.reason || null;

  const A = AL(env);
  const gaps = [];
  offers.forEach((o) => {
    const g = [];
    if (o.total_price == null) g.push(A.gap.price);
    if (!o.outbound) g.push(A.gap.times);
    if (!o.refund || o.refund === 'unknown') g.push(A.gap.terms);
    if (g.length) gaps.push(`${o.label}: ${g.join(', ')}`);
  });
  if (gaps.length && !t.clarify_asked) {
    t.clarify_asked = 1;
    await saveTrip(env, t);
    await toAgent(env, t, `${A.clarify}\n${gaps.join('\n')}`, 'clarify');
    return send(env, t.owner_id, L.offersPending(esc(t.fields.destination), offers.length));
  }

  t.offers_at = Date.now(); t.nudged_offers = 0;
  if (t.status !== 'offers') await setStatus(env, t, 'offers', 'agent'); else await saveTrip(env, t);
  return offersMessage(env, t, L, lang);
}

// docs: [{ name, file_id }] from a real agent, or [{ name, bytes, mime }] from the mock agent.
export async function handleAgentDocs(env, t, docs, caption = '') {
  if (!['chosen', 'booked'].includes(t.status)) return;
  const { lang, L } = await strings(env, t.owner_id);
  for (const d of docs) {
    const m = d.file_id
      ? await tg(env, 'sendDocument', { chat_id: t.owner_id, document: d.file_id, caption: d.name })
      : await tgUpload(env, 'sendDocument', { chat_id: t.owner_id, caption: d.name }, 'document', d.name, d.bytes, d.mime);
    const fid = m.document?.file_id || m.photo?.[m.photo.length - 1]?.file_id || d.file_id;
    await run(env, 'INSERT INTO documents (trip_id, name, file_id, created_at) VALUES (?, ?, ?, ?)', t.id, d.name, fid, Date.now());
  }
  await logEvent(env, 'agent', 'documents', t.id, docs.map((d) => d.name).join(', '));
  if (caption) await send(env, t.owner_id, `<b>${L.fromAgent}:</b> ${esc(caption)}`);
  if (t.status === 'booked') return;

  const o = t.offers[t.chosen] || {};
  t.flight_at = localToUtc(env, o.outbound_datetime) ?? null;
  const back = localToUtc(env, t.fields.date_to);
  t.done_at = back != null ? back + DAY : null;
  await setStatus(env, t, 'booked', 'agent');
  await scheduleFlightReminders(env, t);
  await send(env, t.owner_id, await tripText(env, L, lang, t), t.flight_at ? {} : kb([[[L.btnFlightTime, `tf:${t.id}`]]]));
  await tgUpload(env, 'sendDocument', { chat_id: t.owner_id, caption: L.icsCaption }, 'document', `${t.code}.ics`, tripIcs(t, o, L), 'text/calendar')
    .catch((e) => reportError(env, e, 'send ics'));
  await toAgent(env, t, AL(env).ack, 'ack');
}

// ======================= scheduled checks (cron) =======================

export async function runChecks(env) {
  const now = Date.now();
  const nudge = (Number(env.NUDGE_MIN) || 120) * MIN;

  for (const r of await all(env, `SELECT id FROM trips WHERE status = 'draft' AND nudged = 0 AND draft_at <= ?`, now - nudge)) {
    const t = await getTrip(env, r.id); t.nudged = 1; await saveTrip(env, t);
    const { L } = await strings(env, t.owner_id);
    await logEvent(env, 'cron', 'nudge_draft', t.id);
    await send(env, t.owner_id, L.nudgeDraft(esc(t.fields.destination), t.code), kb([[[L.btnApproveShort, `ap:${t.id}`]]]));
  }

  for (const r of await all(env, `SELECT id FROM trips WHERE status = 'sent' AND sla_reminded = 0 AND due_at <= ?`, now)) {
    const t = await getTrip(env, r.id); t.sla_reminded = 1; await saveTrip(env, t);
    const { L } = await strings(env, t.owner_id);
    await logEvent(env, 'cron', 'agent_late', t.id);
    await toAgent(env, t, AL(env).sla(t.code, fmtLocal(env, t.sent_at, agentLang(env))), 'sla');
    await send(env, t.owner_id, L.agentLate(t.code));
  }

  for (const r of await all(env, `SELECT id FROM trips WHERE status = 'offers' AND nudged_offers = 0 AND offers_at <= ?`, now - nudge)) {
    const t = await getTrip(env, r.id); t.nudged_offers = 1; await saveTrip(env, t);
    const { L } = await strings(env, t.owner_id);
    await logEvent(env, 'cron', 'nudge_offers', t.id);
    await send(env, t.owner_id, L.nudgeOffers(esc(t.fields.destination), t.code));
  }

  for (const rem of await all(env, `SELECT r.* FROM reminders r JOIN trips t ON t.id = r.trip_id WHERE r.sent_at IS NULL AND r.due_at <= ? AND t.status = 'booked'`, now)) {
    await run(env, 'UPDATE reminders SET sent_at = ? WHERE id = ?', now, rem.id);
    const t = await getTrip(env, rem.trip_id), o = t.offers[t.chosen] || {};
    const { L } = await strings(env, t.owner_id);
    await logEvent(env, 'cron', 'reminder_' + rem.type, t.id);
    const doc = await one(env, 'SELECT id FROM documents WHERE trip_id = ? ORDER BY id LIMIT 1', t.id);
    if (rem.type === 'checkin') {
      await send(env, t.owner_id, L.checkin(route(L, t), esc([o.airline, o.outbound].filter(Boolean).join(', ') || hmLocal(env, t.flight_at))), doc ? kb([[[L.btnTicket, `doc:${doc.id}`]]]) : {});
    } else {
      await send(env, t.owner_id, L.leave(route(L, t), hmLocal(env, t.flight_at)));
    }
  }

  for (const r of await all(env, `SELECT id FROM trips WHERE status = 'booked' AND done_at IS NOT NULL AND done_at <= ?`, now)) {
    const t = await getTrip(env, r.id);
    const { L } = await strings(env, t.owner_id);
    await setStatus(env, t, 'done', 'cron');
    await send(env, t.owner_id, L.welcomeBack(esc(t.fields.destination), t.code));
  }

  await run(env, 'DELETE FROM updates WHERE ts < ?', now - 2 * DAY);
  await run(env, 'DELETE FROM chat_log WHERE ts < ?', now - 30 * DAY);
}

export { mirror };
