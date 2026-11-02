// The trip flow: owner messages, button presses, agent replies, and scheduled checks.
//
//  collecting -> draft -> sent -> offers -> chosen -> booked -> done
//                 (owner approves) (agent answers) (owner picks) (agent uploads)
//  Any open state can go to cancelled.

import {
  MIN, DAY, one, all, run, logEvent, getTrip, activeTrip, createTrip, saveTrip, setStatus, WITH_AGENT, code,
  fmtLocal, hmLocal, dshort, localToUtc, nights, esc, money, refundWord, b64, encrypt, decrypt,
} from './util.js';
import { tg, tgUpload, send, typing, kb, download } from './telegram.js';
import { parseRequest, parseOffers, transcribe } from './gemini.js';
import { toAgent, openAgentThread, mirror, isMock } from './agent.js';
import { tripIcs } from './files.js';

const REQUIRED = ['destination', 'date_from', 'date_to', 'travelers'];
const LABEL = { destination: 'qayerga borish', date_from: 'joʻnash sanasi', date_to: 'qaytish sanasi', travelers: 'yoʻlovchilar soni' };
const STATUS_UZ = { collecting: 'maʼlumot yigʻilmoqda', draft: 'tasdiq kutilmoqda', sent: 'agentda', offers: 'variantlar tayyor', chosen: 'bron qilinmoqda', booked: 'bron qilindi', done: 'yakunlandi', cancelled: 'bekor qilindi' };
const FIELD_KEYS = ['origin', 'destination', 'date_from', 'date_to', 'travelers', 'traveler_names', 'flight_pref', 'baggage', 'hotel', 'budget', 'notes'];
const CANCEL = /\b(cancel|bekor|отмен)/i;
const STATUS = /\b(status|holat|статус|qayerda|where)\b/i;
const MAX_MEDIA = 15 * 1024 * 1024;

const isOwner = (env, id) => String(id) === String(env.OWNER_ID);
const isAdmin = (env, id) => String(id) === String(env.ADMIN_ID);

export async function reportError(env, e, where) {
  console.error(where, e);
  try {
    await logEvent(env, 'bot', 'error', null, `${where}: ${e?.message || e}`);
    if (env.ADMIN_ID) await send(env, env.ADMIN_ID, `<b>Bot error</b> in ${esc(where)}:\n<code>${esc(String(e?.message || e)).slice(0, 900)}</code>`);
  } catch { /* nothing else to do */ }
}

// ======================= text blocks =======================

export function templateText(t) {
  const f = t.fields, n = nights(f.date_from, f.date_to);
  return [
    `SOʻROV #${t.code}`,
    `Yoʻnalish: ${f.origin || 'Toshkent'} → ${f.destination}`,
    `Sanalar: ${dshort(f.date_from)} – ${dshort(f.date_to)}${n != null ? ` (${n} kecha)` : ''}`,
    `Yoʻlovchilar: ${f.travelers}${f.traveler_names ? ` (${f.traveler_names})` : ''}`,
    `Parvoz: ${f.flight_pref || 'farqi yoʻq'}`,
    `Bagaj: ${f.baggage || '1 x 23 kg'}`,
    `Mehmonxona: ${f.hotel || 'farqi yoʻq'}`,
    `Byudjet: ${f.budget || 'belgilanmagan'}`,
    f.notes ? `Izoh: ${f.notes}` : null,
    'Iltimos, har bir variantni alohida yozing: reyslar, mehmonxona, umumiy narx, bekor qilish shartlari.',
  ].filter(Boolean).join('\n');
}

function draftText(t) {
  const f = t.fields, n = nights(f.date_from, f.date_to);
  return [
    `<b>Soʻrovingizni tekshiring</b> · ${t.code}`, '',
    `Yoʻnalish: ${esc(f.origin || 'Toshkent')} → ${esc(f.destination)}`,
    `Sanalar: ${dshort(f.date_from)} – ${dshort(f.date_to)}${n != null ? ` (${n} kecha)` : ''}`,
    `Yoʻlovchilar: ${esc(f.travelers)}${f.traveler_names ? ` (${esc(f.traveler_names)})` : ''}`,
    `Parvoz: ${esc(f.flight_pref || 'farqi yoʻq')}`,
    `Bagaj: ${esc(f.baggage || '1 x 23 kg')}`,
    `Mehmonxona: ${esc(f.hotel || 'farqi yoʻq')}`,
    `Byudjet: ${esc(f.budget || 'belgilanmagan')}`,
    f.notes ? `Izoh: ${esc(f.notes)}` : null, '',
    '<i>Pasportingiz siz variant tanlamaguningizcha shifrlangan holda saqlanadi.</i>',
  ].filter((x) => x !== null).join('\n');
}

function compareText(t) {
  const out = [`<b>${t.offers.length} ta variant · ${esc(t.fields.destination)}</b> · ${t.code}`];
  t.offers.forEach((o, i) => {
    out.push('', `<b>${esc(o.label)}</b> · ${esc(money(o))}${i === t.recommended ? ' · <u>tavsiya etiladi</u>' : ''}`,
      `Parvoz: ${esc([o.airline, o.outbound, o.stops].filter(Boolean).join(' · ') || 'koʻrsatilmagan')}`,
      o.return ? `Qaytish: ${esc(o.return)}` : null,
      `Mehmonxona: ${esc([o.hotel, o.distance].filter(Boolean).join(' · ') || 'koʻrsatilmagan')}`,
      `Bekor qilish: ${esc(refundWord(o.refund))}${o.refund_note ? ` (${esc(o.refund_note)})` : ''}`);
  });
  if (t.recommended != null && t.reason && t.offers[t.recommended]) out.push('', `<i>Nega ${esc(t.offers[t.recommended].label)}: ${esc(t.reason)}</i>`);
  return out.filter((x) => x !== null).join('\n');
}

async function tripText(env, t) {
  const o = t.offers[t.chosen] || {}, f = t.fields;
  const rem = await all(env, 'SELECT * FROM reminders WHERE trip_id = ? ORDER BY due_at', t.id);
  return [
    `<b>Bron qilindi: ${esc(f.origin || 'Toshkent')} → ${esc(f.destination)}</b> · ${t.code}`, '',
    `Ketish: ${dshort(f.date_from)}${o.outbound ? ' · ' + esc(o.outbound) : ''}${o.airline ? ' · ' + esc(o.airline) : ''}`,
    `Qaytish: ${o.return ? esc(o.return) : dshort(f.date_to)}`,
    `Mehmonxona: ${esc([o.hotel, o.distance].filter(Boolean).join(' · ') || 'vaucherga qarang')}`,
    `Jami: ${esc(money(o))} · ${esc(refundWord(o.refund))}`, '',
    rem.length ? 'Eslatmalar:\n' + rem.map((r) => `· ${r.type === 'checkin' ? 'onlayn roʻyxatdan oʻtish' : 'aeroportga yoʻl olish'}: ${fmtLocal(env, r.due_at)}`).join('\n')
      : 'Reys vaqti topilmadi, shuning uchun eslatmalar qoʻyilmadi.',
  ].join('\n');
}

const STEPS = [['draft', 'Tasdiqlashingiz kutilmoqda'], ['sent', 'Agentda'], ['offers', 'Variantlar tayyor, tanlov sizda'], ['chosen', 'Agent bron qilmoqda'], ['booked', 'Bron qilindi, hujjatlar tayyor'], ['done', 'Safar yakunlandi']];
function statusText(env, t) {
  const cur = STEPS.findIndex(([s]) => s === t.status);
  const lines = STEPS.map(([s, name], i) => (i < cur ? '✓ ' : i === cur ? '› <b>' : '· ') + name + (i === cur ? '</b>' : ''));
  if (t.status === 'collecting') lines.unshift('› <b>Maʼlumotlar yigʻilmoqda</b>');
  if (t.status === 'sent' && t.due_at) lines.push('', `Agent javobi kutilmoqda: ${fmtLocal(env, t.due_at)} gacha.`);
  return `<b>${esc(t.fields.destination || 'Safar')}</b> · ${t.code}\n\n` + lines.join('\n');
}

const mainMenu = () => kb([[['Yangi safar', 'nt']], [['Safarlarim', 'mt'], ['Holat', 'st']]]);

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

async function mediaOf(env, msg) {
  let fileId, mime, size;
  if (msg.voice) ({ file_id: fileId, file_size: size } = msg.voice), (mime = msg.voice.mime_type || 'audio/ogg');
  else if (msg.audio) ({ file_id: fileId, file_size: size } = msg.audio), (mime = msg.audio.mime_type || 'audio/mpeg');
  else if (msg.photo?.length) ({ file_id: fileId, file_size: size } = msg.photo[msg.photo.length - 1]), (mime = 'image/jpeg');
  else if (msg.video_note) ({ file_id: fileId, file_size: size } = msg.video_note), (mime = 'video/mp4');
  else if (msg.document && /^(application\/pdf|image\/|audio\/)/.test(docMime(msg.document))) ({ file_id: fileId, file_size: size } = msg.document), (mime = docMime(msg.document));
  if (!fileId) return [];
  if (size && size > MAX_MEDIA) throw Object.assign(new Error('file too large'), { userText: 'Bu fayl juda katta. Iltimos, 15 MB dan kichik fayl yuboring.' });
  return [{ mime, b64: b64(await download(env, fileId)) }];
}

export async function handleOwnerMessage(env, msg) {
  const uid = msg.from.id, chat = msg.chat.id;
  const text = (msg.text || msg.caption || '').trim();

  if (text.startsWith('/')) return ownerCommand(env, msg, text);
  if (!isOwner(env, uid)) return send(env, chat, 'You are set up as admin only. Admin commands: /trips /trip /log /jobs /now /fire /setstatus');

  let media;
  try { media = await mediaOf(env, msg); } catch (e) { if (e.userText) return send(env, chat, e.userText); throw e; }
  if (!text && !media.length) return send(env, chat, 'Men matn, ovozli xabar, audio fayl, dumaloq video, rasm va PDF fayllarni oʻqiy olaman.');

  const t = await activeTrip(env, uid);

  // A trip is already with the agent: short commands, otherwise pass the note on.
  if (t && WITH_AGENT.includes(t.status)) {
    let said = text;
    if (!said && media.length && /^(audio|video)\//.test(media[0].mime)) { await typing(env, chat); said = await transcribe(env, media); }
    if (CANCEL.test(said)) return askCancel(env, t);
    if (STATUS.test(said)) return send(env, chat, statusText(env, t));
    await toAgent(env, t, `Azizbekdan ${t.code} boʻyicha izoh:\n"${said || '(fayl biriktirilgan)'}"`, 'note');
    if (!isMock(env) && media.length && !said) await tg(env, 'forwardMessage', { chat_id: env.AGENT_CHAT_ID, from_chat_id: chat, message_id: msg.message_id, ...(t.agent_thread_id ? { message_thread_id: t.agent_thread_id } : {}) });
    return send(env, chat, 'Agentga yetkazdim.');
  }
  if (t && ['collecting', 'draft'].includes(t.status) && CANCEL.test(text) && text.length < 60) return cancelTrip(env, t, 'owner');

  return buildRequest(env, uid, chat, t, text, media);
}

async function buildRequest(env, uid, chat, t, text, media) {
  if (!t) t = await createTrip(env, uid);
  await typing(env, chat);
  let r;
  try { r = await parseRequest(env, t.fields, text, media); }
  catch (e) { await reportError(env, e, 'parseRequest'); return send(env, chat, 'Hozir buni oʻqiy olmadim. Iltimos, bir daqiqadan soʻng qayta urinib koʻring.'); }

  for (const k of FIELD_KEYS) if (r[k] != null && r[k] !== '') t.fields[k] = r[k];
  for (const k of ['date_from', 'date_to']) if (t.fields[k] && !/^\d{4}-\d{2}-\d{2}$/.test(t.fields[k])) delete t.fields[k];
  t.fields.origin ||= 'Toshkent';
  t.fields.baggage ||= '1 x 23 kg';
  await logEvent(env, 'owner', 'request_input', t.id, { text, media: media.map((m) => m.mime), transcript: r.transcript || null });

  const heard = r.transcript ? `<i>Eshitdim: «${esc(r.transcript)}»</i>\n\n` : '';
  const missing = REQUIRED.filter((k) => !t.fields[k]);
  if (missing.length) {
    if (t.status !== 'collecting') await setStatus(env, t, 'collecting', 'owner'); else await saveTrip(env, t);
    return send(env, chat, heard + esc(r.question || `Soʻrovni tayyorlash uchun yana kerak: ${missing.map((k) => LABEL[k]).join(', ')}.`));
  }
  t.draft_at = Date.now(); t.nudged = 0;
  await setStatus(env, t, 'draft', 'owner');
  return send(env, chat, heard + draftText(t), kb([[['Tasdiqlash va agentga yuborish', `ap:${t.id}`]], [['Tahrirlash', `ed:${t.id}`], ['Bekor qilish', `cx:${t.id}`]]]));
}

// ======================= commands =======================

async function ownerCommand(env, msg, text) {
  const chat = msg.chat.id, uid = msg.from.id;
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ').trim();
  const c = cmd.toLowerCase().replace(/@.*$/, '');

  if (isAdmin(env, uid) && ADMIN[c]) return ADMIN[c](env, chat, arg);
  if (!isOwner(env, uid)) return;

  switch (c) {
    case '/start':
    case '/help':
      return send(env, chat, 'Assalomu alaykum! Men sizning safar yordamchingizman. Qayerga va qachon borishingiz kerakligini matn yoki ovozli xabar bilan yozing — oʻzbek, rus yoki ingliz tilida. Men soʻrovni tayyorlayman, sayohat agentingiz bilan ishlayman, chiptalar va eslatmalarni shu yerda saqlayman.\n\n/passport — pasport maʼlumotlarini saqlash (shifrlangan holda)\n/status — joriy safar holati\n/trips — safarlaringiz\n/cancel — joriy safarni bekor qilish', mainMenu());
    case '/new': return send(env, chat, 'Qayerga va qachon borishingiz kerak?');
    case '/status': { const t = await activeTrip(env, uid); return send(env, chat, t ? statusText(env, t) : 'Hozir faol safar yoʻq. Qayerga va qachon borishingiz kerakligini yozing.'); }
    case '/trips': return myTrips(env, uid, chat);
    case '/cancel': { const t = await activeTrip(env, uid); return t ? askCancel(env, t) : send(env, chat, 'Bekor qilinadigan safar yoʻq.'); }
    case '/passport': {
      if (!arg) return send(env, chat, 'Bitta xabarda yuboring, masalan:\n<code>/passport AZIZBEK UBAYDULLAYEV, FA1234567, 2031-05-01 gacha amal qiladi</code>\nMen uni shifrlab saqlayman, xabaringizni oʻchiraman va agentga faqat siz variant tanlaganingizdan keyin beraman.');
      await run(env, 'INSERT INTO travelers (telegram_id, name, passport_enc, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET passport_enc = excluded.passport_enc, updated_at = excluded.updated_at',
        uid, msg.from.first_name || null, await encrypt(env, arg), Date.now());
      await logEvent(env, 'owner', 'passport_saved');
      await tg(env, 'deleteMessage', { chat_id: chat, message_id: msg.message_id }).catch(() => {});
      return send(env, chat, 'Pasport saqlandi va shifrlandi. Xabaringizni bu chatdan oʻchirdim.');
    }
    default: return send(env, chat, 'Bunday buyruqni bilmayman. /help ni bosing.');
  }
}

async function myTrips(env, uid, chat) {
  const rows = await all(env, 'SELECT id, status, fields FROM trips WHERE owner_id = ? ORDER BY id DESC LIMIT 10', uid);
  if (!rows.length) return send(env, chat, 'Hali safarlar yoʻq. Qayerga va qachon borishingiz kerakligini yozing.');
  return send(env, chat, '<b>Safarlaringiz</b>\n' + rows.map((r) => { const f = JSON.parse(r.fields || '{}'); return `${code(r.id)} · ${esc(f.destination || '?')} · ${dshort(f.date_from)} · ${STATUS_UZ[r.status] || r.status}`; }).join('\n'));
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
  if (!isOwner(env, uid)) return answer('Ruxsat yoʻq.');

  const [a, idStr, argStr] = data.split(':');
  if (a === 'nt') { await answer(); return send(env, chat, 'Qayerga va qachon borishingiz kerak? Matn yoki ovozli xabar yuboring.'); }
  if (a === 'mt') { await answer(); return myTrips(env, uid, chat); }
  if (a === 'st') { await answer(); const t = await activeTrip(env, uid); return send(env, chat, t ? statusText(env, t) : 'Hozir faol safar yoʻq.'); }
  if (a === 'doc') { await answer(); const d = await one(env, 'SELECT * FROM documents WHERE id = ?', +idStr); return d && tg(env, 'sendDocument', { chat_id: chat, document: d.file_id, caption: d.name }); }

  const t = await getTrip(env, +idStr);
  const need = { ap: 'draft', ed: 'draft', cx: 'draft', ch: 'offers', ot: 'offers' }[a];
  if (!t || t.owner_id !== uid || (need && t.status !== need) || (['cy', 'cn'].includes(a) && !['collecting', ...WITH_AGENT, 'draft'].includes(t.status))) {
    await answer('Bu tugma eskirgan.');
    return dropKeyboard();
  }
  await answer();
  await dropKeyboard();
  switch (a) {
    case 'ap': return approve(env, t);
    case 'ed':
      await setStatus(env, t, 'collecting', 'owner');
      return send(env, chat, 'Nimani oʻzgartiray? Masalan: «13–16-noyabrga oʻzgartir» yoki «ikkinchi yoʻlovchi qilib Boburni qoʻsh».');
    case 'cx': case 'cy': return cancelTrip(env, t, 'owner');
    case 'cn': return send(env, chat, 'Yaxshi, hech narsa oʻzgarmadi.');
    case 'ch': return choose(env, t, +argStr);
    case 'ot': return otherOptions(env, t);
  }
}

// ======================= transitions =======================

async function approve(env, t) {
  t.sent_at = Date.now();
  t.due_at = t.sent_at + (Number(env.AGENT_SLA_MIN) || 240) * MIN;
  t.sla_reminded = 0; t.clarify_asked = 0; t.agent_texts = []; t.offers = [];
  await setStatus(env, t, 'sent', 'owner');
  await openAgentThread(env, t);
  await toAgent(env, t, templateText(t), 'request');
  return send(env, t.owner_id, `Agentga yuborildi. Variantlar kelishi bilan xabar beraman (${fmtLocal(env, t.due_at)} gacha kutilmoqda).`);
}

async function choose(env, t, i) {
  const o = t.offers[i];
  if (!o) return send(env, t.owner_id, 'Bu variant endi mavjud emas.');
  t.chosen = i;
  await setStatus(env, t, 'chosen', 'owner');
  await toAgent(env, t, `Azizbek tanladi: ${o.label} (${money(o)}). Iltimos, bron qiling va chipta hamda vaucherni shu yerga yuboring.`, 'choice');

  const trav = await one(env, 'SELECT passport_enc FROM travelers WHERE telegram_id = ?', t.owner_id);
  if (trav?.passport_enc) {
    const passport = await decrypt(env, trav.passport_enc);
    await logEvent(env, 'bot', 'passport_released_to_agent', t.id);
    await toAgent(env, t, `${t.code} uchun pasport maʼlumotlari:\n${passport}`, 'passport');
  } else {
    await toAgent(env, t, `${t.code} uchun pasport maʼlumotlari hali yoʻq. Azizbek ularni oʻzi yuboradi.`, 'ack');
    await send(env, t.owner_id, 'Pasport maʼlumotlaringiz menda yoʻq. Ularni /passport orqali yuboring yoki agentga bevosita bering.');
  }
  return send(env, t.owner_id, `Tayyor. Agent bron qilmoqda: ${esc(o.label)}. Chipta va vaucher tayyor boʻlgach, shu yerda paydo boʻladi.`);
}

async function otherOptions(env, t) {
  t.offers = []; t.agent_texts = []; t.clarify_asked = 0; t.recommended = null; t.reason = null;
  t.sent_at = Date.now(); t.due_at = t.sent_at + (Number(env.AGENT_SLA_MIN) || 240) * MIN; t.sla_reminded = 0;
  await setStatus(env, t, 'sent', 'owner');
  await toAgent(env, t, `Azizbek ${t.code} boʻyicha boshqa variantlarni soʻramoqda, soʻrov oʻsha:\n\n${templateText(t)}`, 'other');
  return send(env, t.owner_id, 'Agentdan boshqa variantlarni soʻradim.');
}

async function askCancel(env, t) {
  const o = t.chosen != null ? t.offers[t.chosen] : null;
  let txt = `${t.code} — ${esc(t.fields.destination || '?')} safarini bekor qilaymi?`;
  if (o && ['chosen', 'booked'].includes(t.status)) txt += `\n${esc(o.label)} boʻyicha bekor qilish shartlari: ${esc(refundWord(o.refund))}${o.refund_note ? ` (${esc(o.refund_note)})` : ''}.`;
  return send(env, t.owner_id, txt, kb([[['Ha, bekor qilish', `cy:${t.id}`], ['Qoldirish', `cn:${t.id}`]]]));
}

async function cancelTrip(env, t, actor) {
  const withAgent = WITH_AGENT.includes(t.status);
  await setStatus(env, t, 'cancelled', actor);
  await run(env, 'UPDATE jobs SET done_at = ? WHERE trip_id = ? AND done_at IS NULL', Date.now(), t.id);
  if (withAgent) await toAgent(env, t, `Azizbek ${t.code} safarini bekor qildi. Iltimos, u boʻyicha qilingan bronlarni bekor qiling va shu yerda tasdiqlang.`, 'cancel');
  return send(env, t.owner_id, `${t.code} safari bekor qilindi.${withAgent ? ' Agentga xabar berdim.' : ''}`);
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
    try { media = await mediaOf(env, msg); } catch (e) { return send(env, env.AGENT_CHAT_ID, e.userText || 'Bu faylni oʻqiy olmadim.'); }
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
  await logEvent(env, 'agent', 'message', t.id, text || '(file)');
  if (['chosen', 'booked'].includes(t.status)) {
    if (text) await send(env, t.owner_id, `<b>Agentdan xabar</b> · ${t.code}\n${esc(text)}`);
    return;
  }
  if (!['sent', 'offers'].includes(t.status)) return;

  if (text) t.agent_texts.push(text);
  await saveTrip(env, t);

  let r;
  try { r = await parseOffers(env, t.fields, t.agent_texts, media); }
  catch (e) { await reportError(env, e, 'parseOffers'); return send(env, t.owner_id, `Agent ${t.code} boʻyicha javob berdi, lekin uni oʻqiy olmadim. Agentning xabari:\n${esc(text || '(fayl)')}`); }

  const offers = Array.isArray(r.offers) ? r.offers.slice(0, 5) : [];
  if (!offers.length) {
    return send(env, t.owner_id, `<b>Agent yozdi</b> · ${t.code}\n${esc(text || '(fayl)')}`);
  }
  if (media.length) t.agent_texts.push('[Options read from the agent’s attachment] ' + JSON.stringify(offers));
  t.offers = offers;
  t.recommended = Number.isInteger(r.recommended) && offers[r.recommended] ? r.recommended : null;
  t.reason = r.reason || null;

  const gaps = [];
  offers.forEach((o) => {
    const g = [];
    if (o.total_price == null) g.push('umumiy narx');
    if (!o.outbound) g.push('reys vaqtlari');
    if (!o.refund || o.refund === 'unknown') g.push('bekor qilish shartlari');
    if (g.length) gaps.push(`${o.label}: ${g.join(', ')}`);
  });
  if (gaps.length && !t.clarify_asked) {
    t.clarify_asked = 1;
    await saveTrip(env, t);
    await toAgent(env, t, `Rahmat. Azizbekka koʻrsatishdan oldin, iltimos, quyidagilarni qoʻshing:\n${gaps.join('\n')}`, 'clarify');
    return send(env, t.owner_id, `${esc(t.fields.destination)} boʻyicha ${offers.length} ta variant keldi. Agentdan yetishmayotgan maʼlumotni soʻradim, kelishi bilan koʻrsataman.`);
  }

  t.offers_at = Date.now(); t.nudged_offers = 0;
  if (t.status !== 'offers') await setStatus(env, t, 'offers', 'agent'); else await saveTrip(env, t);
  const rows = offers.map((o, i) => [[`${i === t.recommended ? '★ ' : ''}${o.label} · ${money(o)}`, `ch:${t.id}:${i}`]]);
  rows.push([['Boshqa variantlarni soʻrash', `ot:${t.id}`]]);
  return send(env, t.owner_id, compareText(t), kb(rows));
}

// docs: [{ name, file_id }] from a real agent, or [{ name, bytes, mime }] from the mock agent.
export async function handleAgentDocs(env, t, docs, caption = '') {
  if (!['chosen', 'booked'].includes(t.status)) return;
  for (const d of docs) {
    const m = d.file_id
      ? await tg(env, 'sendDocument', { chat_id: t.owner_id, document: d.file_id, caption: d.name })
      : await tgUpload(env, 'sendDocument', { chat_id: t.owner_id, caption: d.name }, 'document', d.name, d.bytes, d.mime);
    const fid = m.document?.file_id || m.photo?.[m.photo.length - 1]?.file_id || d.file_id;
    await run(env, 'INSERT INTO documents (trip_id, name, file_id, created_at) VALUES (?, ?, ?, ?)', t.id, d.name, fid, Date.now());
  }
  await logEvent(env, 'agent', 'documents', t.id, docs.map((d) => d.name).join(', '));
  if (caption) await send(env, t.owner_id, `<b>Agentdan:</b> ${esc(caption)}`);
  if (t.status === 'booked') return;

  const o = t.offers[t.chosen] || {};
  t.flight_at = localToUtc(env, o.outbound_datetime) ?? null;
  const back = localToUtc(env, t.fields.date_to);
  t.done_at = back != null ? back + DAY : null;
  await setStatus(env, t, 'booked', 'agent');
  if (t.flight_at) {
    const now = Date.now();
    for (const [type, at] of [['checkin', t.flight_at - DAY], ['leave', t.flight_at - 3 * 60 * MIN]]) {
      if (at > now) await run(env, 'INSERT INTO reminders (trip_id, type, due_at) VALUES (?, ?, ?)', t.id, type, at);
    }
  }
  await send(env, t.owner_id, await tripText(env, t));
  await tgUpload(env, 'sendDocument', { chat_id: t.owner_id, caption: 'Safarni kalendaringizga qoʻshish uchun faylni oching.' }, 'document', `${t.code}.ics`, tripIcs(t, o), 'text/calendar')
    .catch((e) => reportError(env, e, 'send ics'));
  await toAgent(env, t, 'Qabul qildim, rahmat. Azizbekka yuborildi.', 'ack');
}

// ======================= scheduled checks (cron) =======================

export async function runChecks(env) {
  const now = Date.now();
  const nudge = (Number(env.NUDGE_MIN) || 120) * MIN;

  for (const r of await all(env, `SELECT id FROM trips WHERE status = 'draft' AND nudged = 0 AND draft_at <= ?`, now - nudge)) {
    const t = await getTrip(env, r.id); t.nudged = 1; await saveTrip(env, t);
    await logEvent(env, 'cron', 'nudge_draft', t.id);
    await send(env, t.owner_id, `${esc(t.fields.destination)} safari boʻyicha ${t.code} soʻrovi hali tasdiqlashingizni kutmoqda.`, kb([[['Tasdiqlash va yuborish', `ap:${t.id}`]]]));
  }

  for (const r of await all(env, `SELECT id FROM trips WHERE status = 'sent' AND sla_reminded = 0 AND due_at <= ?`, now)) {
    const t = await getTrip(env, r.id); t.sla_reminded = 1; await saveTrip(env, t);
    await logEvent(env, 'cron', 'agent_late', t.id);
    await toAgent(env, t, `Eslatma: ${t.code} soʻrovi ${fmtLocal(env, t.sent_at)} dan beri variantlarni kutmoqda.`, 'sla');
    await send(env, t.owner_id, `Agent ${t.code} boʻyicha hali javob bermadi. Unga eslatma yubordim.`);
  }

  for (const r of await all(env, `SELECT id FROM trips WHERE status = 'offers' AND nudged_offers = 0 AND offers_at <= ?`, now - nudge)) {
    const t = await getTrip(env, r.id); t.nudged_offers = 1; await saveTrip(env, t);
    await logEvent(env, 'cron', 'nudge_offers', t.id);
    await send(env, t.owner_id, `${esc(t.fields.destination)} (${t.code}) boʻyicha variantlar tanlovingizni kutmoqda. Narxlar oʻzgarishi mumkin, shuning uchun tezroq tanlagan maʼqul.`);
  }

  for (const rem of await all(env, `SELECT r.* FROM reminders r JOIN trips t ON t.id = r.trip_id WHERE r.sent_at IS NULL AND r.due_at <= ? AND t.status = 'booked'`, now)) {
    await run(env, 'UPDATE reminders SET sent_at = ? WHERE id = ?', now, rem.id);
    const t = await getTrip(env, rem.trip_id), o = t.offers[t.chosen] || {};
    await logEvent(env, 'cron', 'reminder_' + rem.type, t.id);
    const doc = await one(env, 'SELECT id FROM documents WHERE trip_id = ? ORDER BY id LIMIT 1', t.id);
    if (rem.type === 'checkin') {
      await send(env, t.owner_id, `Ertaga parvoz: ${esc(t.fields.origin || 'Toshkent')} → ${esc(t.fields.destination)}.\nReys: ${esc([o.airline, o.outbound].filter(Boolean).join(', ') || hmLocal(env, t.flight_at))}\nOnlayn roʻyxatdan oʻtish hozir ochiq boʻlishi kerak.`, doc ? kb([[['Chiptani ochish', `doc:${doc.id}`]]]) : {});
    } else {
      await send(env, t.owner_id, `Reysingiz (${esc(t.fields.origin || 'Toshkent')} → ${esc(t.fields.destination)}) soat ${hmLocal(env, t.flight_at)} da, 3 soatdan keyin. Aeroportga yoʻl olish vaqti boʻldi.`);
    }
  }

  for (const r of await all(env, `SELECT id FROM trips WHERE status = 'booked' AND done_at IS NOT NULL AND done_at <= ?`, now)) {
    const t = await getTrip(env, r.id);
    await setStatus(env, t, 'done', 'cron');
    await send(env, t.owner_id, `Safardan eson-omon qaytganingiz bilan! ${esc(t.fields.destination)} safari (${t.code}) yopildi; uni /trips da topishingiz mumkin.`);
  }

  await run(env, 'DELETE FROM updates WHERE ts < ?', now - 2 * DAY);
}

export { mirror };
