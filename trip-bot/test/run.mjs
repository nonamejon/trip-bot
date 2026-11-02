// End-to-end test of the trip bot with Telegram and Gemini faked and SQLite standing in for D1.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import worker from '../src/index.js';
import { tinyPdf } from '../src/files.js';
import { nextDue } from '../src/secretary.js';
import { checkTelegram } from './telegram-rules.mjs';

// ---------- fake clock ----------
let NOW = Date.UTC(2026, 10, 2, 4, 0); // 09:00 Tashkent
const realNow = Date.now;
Date.now = () => NOW;
const advance = (min) => { NOW += min * 60e3; };

// ---------- D1 shim ----------
const sqlite = new Database(':memory:');
sqlite.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
class Stmt {
  constructor(sql) { this.sql = sql; this.args = []; }
  bind(...a) { this.args = a; return this; }
  async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; }
  async run() { const r = sqlite.prepare(this.sql).run(...this.args); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; }
}
const env = {
  DB: { prepare: (s) => new Stmt(s) },
  OWNER_ID: '111', ADMIN_ID: '111,222', AGENT_MODE: 'mock', MOCK_MIRROR: 'true', MOCK_DELAY_MIN: '2',
  GEMINI_MODEL: 'gemini-3.8-flash', AGENT_SLA_MIN: '240', NUDGE_MIN: '120', TZ_OFFSET_MIN: '300',
  TELEGRAM_TOKEN: 'TOKEN', GEMINI_API_KEY: 'KEY', WEBHOOK_SECRET: 'sec', PUBLIC_URL: 'https://bot.example', BRIEF_HOUR: '8',
  PASSPORT_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
};

// ---------- fake Telegram + Gemini ----------
let lastGeminiMime = null;
let msgId = 100, offersRound = 0, failNextGemini = false;
const sent = [];
const geminiCalls = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes('generativelanguage.googleapis.com')) {
    if (failNextGemini && url.includes('gemini-3.8-flash')) {
      failNextGemini = false; geminiCalls.push('503');
      return new Response('{"error":{"code":503,"message":"high demand"}}', { status: 503 });
    }
    const body = JSON.parse(init.body);
    const prompt = body.contents[0].parts[0].text;
    const hasMedia = body.contents[0].parts.length > 1;
    if (hasMedia) lastGeminiMime = body.contents[0].parts[1].inline_data.mime_type;
    let out;
    if (prompt.startsWith('You route messages')) {
      geminiCalls.push('route' + (hasMedia ? '+audio' : ''));
      out = fakeRoute(prompt, hasMedia);
    } else if (prompt.startsWith('Translate for a busy executive')) {
      geminiCalls.push('translate' + (hasMedia ? '+media' : ''));
      out = { source_lang: 'uz', target_lang: prompt.includes('"ru"') ? 'ru' : 'en', translation: 'Уважаемые партнёры, встречу переносим на понедельник.' };
    } else if (prompt.includes('Draft the letter he asks for')) {
      geminiCalls.push('writeLetter');
      out = { subject: 'Viza arizasini koʻrib chiqishni tezlashtirish haqida', body: 'Hurmatli janoblar,\n\nIltimos, [sana] kuni topshirilgan viza arizamni tezroq koʻrib chiqishingizni soʻrayman.\n\nHurmat bilan,\nAzizbek', lang: 'uz' };
    } else if (prompt.includes('Here is a letter you drafted')) {
      geminiCalls.push('reviseLetter');
      out = { subject: 'Viza arizasi', body: 'Hurmatli janoblar, arizamni tezlashtirishingizni soʻrayman. Hurmat bilan, Azizbek', lang: prompt.includes('into English') ? 'en' : 'uz' };
    } else if (prompt.includes('Read the date and time in this message')) {
      geminiCalls.push('parseWhen');
      out = { date: localISO(3), time: '07:40' };
    } else if (prompt.includes('parsing step') && prompt.includes('executive')) {
      geminiCalls.push('parseRequest' + (hasMedia ? '+audio' : ''));
      out = prompt.includes('Dubai')
        ? { destination: 'Dubai', origin: 'Tashkent', question: 'Which dates, and is it just you?' }
        : { transcript: hasMedia ? "Istanbulga 12-noyabr ertalab uchishim kerak, 3 kunga." : null, origin: 'Tashkent', destination: 'Istanbul', date_from: '2026-11-12', date_to: '2026-11-15', travelers: 1, flight_pref: 'morning, direct', baggage: '1 x 23 kg', hotel: 'Levent, near the meeting', budget: null, notes: null, question: null };
    } else if (prompt.startsWith('You are a travel agent in Tashkent. Today')) {
      geminiCalls.push('mockAgentOffers');
      out = '1) HY 271 12.11 07:40-10:55 direct... 1450 USD free cancel\n2) TK 371 ... 1120 USD\n3) PC via Ankara ... 890 USD non-refundable';
    } else if (prompt.startsWith('You are a travel agent in Tashkent chatting')) {
      geminiCalls.push('mockAgentClarify');
      out = 'Option 2: 1 night penalty if cancelled within 72 hours.';
    } else if (prompt.includes('A travel agent is answering')) {
      offersRound++;
      geminiCalls.push('parseOffers#' + offersRound);
      const o = [
        { label: 'Option 1', airline: 'Uzbekistan Airways HY 271', outbound: '07:40 → 10:55', outbound_datetime: '2026-11-12T07:40', return: '15 Nov 19:30', stops: 'direct', hotel: 'Grand Levent 5*', distance: '5 min walk', total_price: 1450, currency: 'USD', refund: 'full', refund_note: 'free until 48 h before' },
        { label: 'Option 2', airline: 'Turkish Airlines TK 371', outbound: '09:15 → 12:30', outbound_datetime: '2026-11-12T09:15', return: '15 Nov 21:05', stops: 'direct', hotel: 'Sisli Park 4*', distance: '15 min taxi', total_price: 1120, currency: 'USD', refund: offersRound === 1 ? 'unknown' : 'penalty', refund_note: null },
        { label: 'Option 3', airline: 'Pegasus', outbound: '06:10 → 13:40', outbound_datetime: '2026-11-12T06:10', return: '15 Nov 18:00', stops: '1 stop via Ankara', hotel: 'Levent Residence 4*', distance: '10 min walk', total_price: 890, currency: 'USD', refund: 'none', refund_note: null },
      ];
      out = { offers: o, recommended: 0, reason: 'Morning direct flight, hotel next to the meeting, and fully refundable.' };
    } else if (prompt.startsWith('Transcribe')) {
      geminiCalls.push('transcribe'); out = { transcript: 'what is the status' };
    } else throw new Error('Unexpected Gemini prompt: ' + prompt.slice(0, 80));
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
  }
  if (url.startsWith('https://api.telegram.org/file/')) return new Response(new Uint8Array([79, 103, 103, 83, 0, 1, 2, 3]));
  if (url.startsWith('https://api.telegram.org/bot')) {
    const method = url.split('/').pop();
    let p;
    if (init.body instanceof FormData) { p = Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `<file ${v.size}B ${v.type}>`])); }
    else p = JSON.parse(init.body || '{}');
    sent.push({ method, p });
    const problem = checkTelegram(method, p);
    if (problem) { tgErrors.push(`${method}: ${problem}`); return new Response(JSON.stringify({ ok: false, description: 'Bad Request: ' + problem })); }
    let result = true;
    if (method === 'sendMessage') result = { message_id: ++msgId, chat: { id: p.chat_id }, text: p.text };
    if (method === 'sendDocument') result = { message_id: ++msgId, document: { file_id: 'FILE_' + msgId } };
    if (method === 'getFile') result = { file_path: 'voice/file_1.oga' };
    if (method === 'getMe') result = { username: 'test_trip_bot' };
    return new Response(JSON.stringify({ ok: true, result }));
  }
  throw new Error('Unexpected fetch ' + url);
};

// ---------- what real Telegram would reject ----------
const tgErrors = [];

// ---------- fake router (stands in for Gemini's routeMessage) ----------
const localISO = (days = 0) => new Date(NOW + 5 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);
const localHM = (min = 0) => new Date(NOW + 5 * 3600e3 + min * 60e3).toISOString().slice(11, 16);
const localMs = (days, hm) => Date.parse(`${localISO(days)}T${hm}:00Z`) - 5 * 3600e3;
function fakeRoute(prompt, hasMedia) {
  const msg = (prompt.match(/His message: "{3}([\s\S]*?)"{3}/) || [])[1] || '';
  const m = msg.toLowerCase();
  const pending = (prompt.match(/you asked him a question about it: "{3}([\s\S]*?)"{3}/) || [])[1];
  if (hasMedia && /^(audio|video)/.test(lastGeminiMime)) return { intent: 'trip', transcript: 'Istanbulga 12-noyabr ertalab uchishim kerak, 3 kunga.' };
  if (pending && /juma/.test(pending)) return { intent: 'event', ev_title: 'Uchrashuv', ev_date: localISO(4), ev_time: '10:00' };
  if (/agentga/.test(m)) return { intent: 'trip_note' };
  if (/cancel|отмен/.test(m)) return { intent: 'trip_cancel' };
  if (/status/.test(m)) return { intent: 'trip_status' };
  if (/juma kuni uchrashuv/.test(m)) return { intent: 'event', ev_title: 'Uchrashuv', ev_date: localISO(4), question: 'Uchrashuv soat nechada boʻladi?' };
  if (/hilton/.test(m)) return { intent: 'event', ev_title: 'Investorlar bilan uchrashuv', ev_date: localISO(1), ev_time: '15:00', ev_location: 'Hilton' };
  if (/15:30/.test(m)) return { intent: 'event', ev_title: 'Bank bilan qoʻngʻiroq', ev_date: localISO(1), ev_time: '15:30', ev_end_time: '16:00' };
  if (/har kuni/.test(m)) return { intent: 'reminder', rm_text: 'Dori ichish', rm_date: localISO(1), rm_time: '08:00', rm_repeat: 'daily' };
  if (/20 минут/.test(m)) return { intent: 'reminder', rm_text: 'Позвонить Бобуру', rm_date: localISO(0), rm_time: localHM(20), rm_repeat: 'none' };
  if (/kecha/.test(m)) return { intent: 'reminder', rm_text: 'Hisobot', rm_date: localISO(-1), rm_time: '09:00', rm_repeat: 'none' };
  if (/tarjima/.test(m)) return { intent: 'translate', tr_text: 'Hurmatli hamkorlar, uchrashuvni dushanbaga koʻchiramiz', tr_target: 'ru' };
  if (/xat yoz/.test(m)) return { intent: 'letter', lt_request: msg };
  if (/rejalarim/.test(m)) return { intent: 'agenda', ag_from: localISO(1), ag_to: localISO(1) };
  if (/rahmat/.test(m)) return { intent: 'chat', reply: 'Arzimaydi!' };
  return { intent: 'trip' };
}

// ---------- driving helpers ----------
let updateId = 1;
const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };
const settle = async () => { while (pending.length) await pending.shift(); };
async function update(u) {
  u.update_id = updateId++;
  const res = await worker.fetch(new Request('https://bot.example/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'sec' }, body: JSON.stringify(u) }), env, ctx);
  if ((await res.text()) !== 'ok') throw new Error('webhook rejected');
  await settle();
}
const owner = { id: 111, is_bot: false, first_name: 'Azizbek' };
const say = (text) => update({ message: { message_id: ++msgId, from: owner, chat: { id: 111, type: 'private' }, text } });
const voice = () => update({ message: { message_id: ++msgId, from: owner, chat: { id: 111, type: 'private' }, voice: { file_id: 'VOICE1', file_size: 9000, mime_type: 'audio/ogg' } } });
const tap = (data) => update({ callback_query: { id: 'cq' + updateId, from: owner, data, message: { message_id: msgId, chat: { id: 111 } } } });
const cron = async () => { await worker.scheduled({}, env, ctx); await settle(); };

let shown = 0;
function show(label) {
  console.log(`\n===== ${label}  [${new Date(NOW + 5 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')} Tashkent]`);
  for (const s of sent.slice(shown)) {
    if (['answerCallbackQuery', 'editMessageReplyMarkup', 'sendChatAction', 'getFile'].includes(s.method)) continue;
    const rm = s.p.reply_markup ? (typeof s.p.reply_markup === 'string' ? JSON.parse(s.p.reply_markup) : s.p.reply_markup) : null;
    const btns = rm ? [...(rm.inline_keyboard || []).flat().map((b) => `[${b.text} → ${b.callback_data}]`), ...(rm.keyboard || []).flat().map((b) => `⌨[${b.text}]`)].join(' ') : '';
    const body = s.p.text ?? s.p.caption ?? (s.p.document ? 'doc ' + s.p.document : '');
    console.log(`-> ${s.method} chat=${s.p.chat_id ?? ''}\n   ${String(body).replace(/\n/g, '\n   ')}${btns ? '\n   ' + btns : ''}`);
  }
  shown = sent.length;
}
const status = () => sqlite.prepare('SELECT id, status FROM trips ORDER BY id DESC LIMIT 1').get();
const lastText = () => sent.filter((x) => x.method === 'sendMessage').at(-1)?.p.text || '';
const assert = (c, m) => { if (!c) { console.error('ASSERTION FAILED: ' + m); process.exitCode = 1; } else console.log('   ok: ' + m); };

// ---------- scenario ----------
await update({ message: { message_id: 1, from: { id: 999, is_bot: false }, chat: { id: 999, type: 'private' }, text: 'hi' } });
show('stranger writes');
assert(sent.at(-1).p.text.includes('999'), 'stranger gets their id, nothing else');

await say('salom'); show('first message, no language yet');
const lastKb = () => { const m = sent.filter((x) => x.method === 'sendMessage').at(-1); return JSON.stringify(m.p.reply_markup || ''); };
assert(lastKb().includes('lg:uz') && lastKb().includes('lg:ru'), 'first message asks for a language with flag buttons');
await say('/start'); show('/start');
assert(lastKb().includes('lg:uz') && lastKb().includes('🇷🇺'), '/start asks for a language');
await tap('lg:uz'); show('picked Uzbek');
assert(sqlite.prepare('SELECT lang FROM prefs WHERE telegram_id = 111').get()?.lang === 'uz', 'language saved');
assert(sent.some((x) => x.method === 'setMyCommands' && x.p.scope?.chat_id === 111 && x.p.commands[0].description === 'Asosiy menyu'), 'command menu set to Uzbek for this chat');
assert(lastKb().includes('✈️ Mening safarlarim') && lastKb().includes('🗂 Shaxsiy kotib'), 'bottom keyboard shows the two sections');
await say('/passport AZIZBEK UBAYDULLAYEV, FA1234567, valid until 2031-05-01'); show('/passport');
const trav = sqlite.prepare('SELECT passport_enc FROM travelers').get();
assert(trav.passport_enc.startsWith('v1:') && !trav.passport_enc.includes('FA1234567'), 'passport stored encrypted');

await say('Need to go to Dubai'); show('vague request');
assert(status().status === 'collecting', 'vague request stays collecting and asks a question');
await say('cancel'); show('cancel while collecting');

await voice(); show('voice note');
assert(status().status === 'draft', 'voice note produced a draft');
const audioCalls = () => geminiCalls.filter((c) => c === 'route+audio').length;
let before = audioCalls();
await update({ message: { message_id: ++msgId, from: owner, chat: { id: 111, type: 'private' }, document: { file_id: 'M4A1', file_name: 'note.m4a', mime_type: 'audio/x-m4a', file_size: 50000 } } });
assert(audioCalls() === before + 1 && lastGeminiMime === 'audio/mp4', 'audio sent as a file is read (m4a -> audio/mp4)');
before = audioCalls();
await update({ message: { message_id: ++msgId, from: owner, chat: { id: 111, type: 'private' }, video_note: { file_id: 'VN1', file_size: 300000, length: 240, duration: 8 } } });
assert(audioCalls() === before + 1 && lastGeminiMime === 'video/mp4', 'round video message is read');
assert(status().status === 'draft', 'still a draft after extra media');
const tripId = status().id;

await tap(`ap:${tripId}`); show('approve');
assert(status().status === 'sent', 'approved -> sent');
await tap(`ap:${tripId}`); show('tap approve again (stale button)');

advance(3); await cron(); show('cron: mock agent sends options with a gap');
assert(geminiCalls.includes('mockAgentOffers') && status().status === 'sent', 'gap found -> still sent, clarify asked');

advance(1); await cron(); show('cron: mock agent answers the gap');
assert(status().status === 'offers', 'options shown to owner');

await say('what is the status?'); show('status question');

await tap(`ch:${tripId}:0`); show('choose option 1');
assert(status().status === 'chosen', 'chosen');

advance(3); await cron(); show('cron: mock agent books, sends PDFs');
assert(status().status === 'booked', 'booked');
const rem = sqlite.prepare('SELECT type, due_at FROM reminders').all();
assert(rem.length === 2, 'two reminders scheduled');

NOW = rem[0].due_at + 1; await cron(); show('cron: check-in reminder (24 h before)');
NOW = rem[1].due_at + 1; await cron(); show('cron: leave-for-airport reminder (3 h before)');
NOW = Date.UTC(2026, 10, 16, 0, 0); await cron(); show('cron: trip over');
assert(status().status === 'done', 'trip closed as done');

// ---------- My trips section ----------
await say('✈️ Mening safarlarim'); show('My trips (bottom keyboard)');
assert(lastKb().includes('"nt"') && lastKb().includes('"mt"'), 'trips menu: new trip, all trips');
await tap('mt'); show('all trips');
assert(lastKb().includes(`tv:${tripId}`), 'trip list has a button per trip');
await tap(`tv:${tripId}`); show('trip card');
assert(lastText().includes('Bron') && lastKb().includes(`td:${tripId}`) && lastKb().includes(`tc:${tripId}`), 'trip card shows the booking, documents and calendar file');
let n0 = sent.length;
await tap(`td:${tripId}`); show('documents');
assert(sent.slice(n0).filter((x) => x.method === 'sendDocument').length === 2, 'both documents re-sent');
n0 = sent.length;
await tap(`tc:${tripId}`);
assert(sent.slice(n0).some((x) => x.method === 'sendDocument' && /text\/calendar/.test(x.p.document)), 'trip calendar file sent');
// a booking without a flight time: add it from the card
sqlite.prepare(`UPDATE trips SET status = 'booked', flight_at = NULL WHERE id = ?`).run(tripId);
sqlite.prepare('DELETE FROM reminders').run();
await tap(`tv:${tripId}`);
assert(lastKb().includes(`tf:${tripId}`), 'card offers to add the flight time');
await tap(`tf:${tripId}`); await say('19-noyabr 07:40'); show('flight time added');
assert(sqlite.prepare('SELECT flight_at FROM trips WHERE id = ?').get(tripId).flight_at === localMs(3, '07:40') && sqlite.prepare('SELECT COUNT(*) c FROM reminders').get().c === 2, 'flight time saved and reminders set');
sqlite.prepare(`UPDATE trips SET status = 'done' WHERE id = ?`).run(tripId);
sqlite.prepare('DELETE FROM reminders').run();

// second trip: agent never answers -> SLA reminder; then owner cancels
failNextGemini = true;
await say('/ru'); show('/ru');
assert(sqlite.prepare('SELECT lang FROM prefs WHERE telegram_id = 111').get()?.lang === 'ru', 'switched to Russian');
await say('Istanbul again please, same as before'); show('second trip');
assert(sent.filter((x) => x.method === 'sendMessage').at(-1).p.text.includes('Проверьте заявку'), 'draft card in Russian');
const t2 = status().id;
assert(geminiCalls.includes('503') && status().status === 'draft', 'Gemini 503 -> retried and succeeded');
await tap(`ap:${t2}`);
await say('/jobs');
sqlite.prepare('UPDATE jobs SET done_at = 1 WHERE done_at IS NULL').run(); // agent goes silent
advance(241); await cron(); show('cron: agent late');
assert(sqlite.prepare('SELECT sla_reminded FROM trips WHERE id = ?').get(t2).sla_reminded === 1, 'agent-late reminder sent');
const notes = () => sqlite.prepare(`SELECT COUNT(*) c FROM events WHERE action = 'to_agent:note' AND trip_id = ?`).get(t2).c;
await say('agentga ayt, deraza yonidagi joy kerak'); show('note for the agent (router)');
assert(notes() === 1 && lastText() === 'Передал агенту.', 'free message for the agent passed on');
await tap(`aw:${t2}`); await say('Ещё нужен трансфер из аэропорта'); show('note for the agent (button)');
assert(notes() === 2, '"write to agent" button passes the next message on');
await say('отмени поездку'); show('cancel request (Russian)');
assert(lastKb().includes('cy:'), 'Russian cancel word understood');
await tap(`cy:${t2}`); show('confirm cancel');
assert(status().status === 'cancelled', 'cancelled');

await say('/uz'); show('/uz');
assert(sent.filter((x) => x.method === 'sendMessage').at(-1).p.text.startsWith('Til: Oʻzbekcha'), 'switched back to Uzbek');
const pdf = new TextDecoder().decode(tinyPdf(["Yoʻlovchi: AZIZBEK", 'Toshkent → Istanbul']));
assert(pdf.includes("(Yo'lovchi: AZIZBEK)") && pdf.includes('(Toshkent -> Istanbul)') && !pdf.includes('?'), 'PDF keeps Uzbek letters');

await say('/log 12'); show('admin /log');

// a second admin who is not the owner
const admin2 = (text) => update({ message: { message_id: ++msgId, from: { id: 222, is_bot: false }, chat: { id: 222, type: 'private' }, text } });
let n = sent.length;
await admin2('/trips'); show('second admin /trips');
assert(sent.slice(n).some((x) => x.p.chat_id === 222 && /T-0003 · cancelled/.test(x.p.text)), 'second admin can use admin commands');
n = sent.length;
await admin2('hello'); show('second admin plain message');
assert(sent.slice(n).some((x) => x.p.chat_id === 222 && x.p.text.includes('admin only')), 'second admin is not treated as the owner');

// ---------- Personal secretary ----------
const mode = () => sqlite.prepare('SELECT mode FROM prefs WHERE telegram_id = 111').get()?.mode ?? null;
await say('🗂 Shaxsiy kotib'); show('secretary menu');
assert(['ag:t', '"rl"', 'sm:tr', 'sm:lt', '"cl"'].every((k) => lastKb().includes(k)), 'secretary menu: calendar, reminders, translate, letters, phone calendar');

await say('ertaga soat 15:00 da Hilton mehmonxonasida investorlar bilan uchrashuv'); show('add event');
const ev1 = sqlite.prepare('SELECT * FROM cal_events ORDER BY id DESC').get();
assert(ev1?.title === 'Investorlar bilan uchrashuv' && ev1.start_at === localMs(1, '15:00') && ev1.remind_at === ev1.start_at - 30 * 60e3 && lastKb().includes(`xd:${ev1.id}`), 'event added with a 30-minute heads-up');
await say('ertaga 15:30 da bank bilan qoʻngʻiroq'); show('overlapping event');
assert(lastText().includes('⚠️'), 'overlap with another event is flagged');
await say('juma kuni uchrashuv bor'); show('event without a time');
assert(lastText().includes('soat nechada') && mode() === 'clarify', 'asks for the missing time');
await say('soat 10 da'); show('answer with the time');
assert(sqlite.prepare('SELECT COUNT(*) c FROM cal_events').get().c === 3 && mode() === null, 'the answer completes the event');

await say('har kuni ertalab 8 da dori ichishni eslatib tur'); show('daily reminder');
const rmDaily = sqlite.prepare(`SELECT * FROM user_reminders WHERE repeat = 'daily'`).get();
assert(rmDaily?.due_at === localMs(1, '08:00'), 'daily reminder set for tomorrow 08:00');
await say('напомни через 20 минут позвонить Бобуру'); show('reminder in 20 minutes');
const rm20 = sqlite.prepare(`SELECT * FROM user_reminders WHERE text = 'Позвонить Бобуру'`).get();
await say('kecha 9 da hisobotni eslat'); show('reminder in the past');
assert(lastText() === 'Bu vaqt oʻtib ketgan. Qaysi vaqtga qoʻyay?' && mode() === 'clarify', 'a time in the past is questioned');
await say('/menu');
assert(mode() === null, 'a command clears a pending question');

await say('ertaga nima rejalarim bor?'); show('agenda (router)');
assert(lastText().includes('Investorlar bilan uchrashuv') && lastText().includes('Dori ichish') && lastText().includes('Ertaga'), "agenda lists tomorrow's events and reminders");
await tap('ag:w'); show('agenda: week');
assert(lastText().includes('Uchrashuv'), 'week view includes Friday');
await say('/today'); show('/today');
await say('/reminders'); show('/reminders');
assert(lastText().includes('Dori ichish') && lastText().includes('Позвонить Бобуру'), 'reminders list');

advance(21); await cron(); show('cron: 20-minute reminder');
assert(lastText().includes('Позвонить Бобуру') && lastKb().includes(`rs:${rm20.id}:15`) && sqlite.prepare('SELECT done FROM user_reminders WHERE id = ?').get(rm20.id).done === 1, 'one-off reminder fires once, with snooze buttons');
await tap(`rs:${rm20.id}:15`); show('snooze 15 min');
advance(16); await cron(); show('cron: snoozed reminder');
assert(sent.filter((x) => x.p.text?.includes('Позвонить Бобуру')).length >= 3, 'snoozed reminder fires again');

NOW = localMs(1, '08:00'); await cron(); show('cron: next morning 08:00');
assert(sent.some((x) => x.p.text?.startsWith('☀️')) && sqlite.prepare('SELECT due_at FROM user_reminders WHERE id = ?').get(rmDaily.id).due_at === localMs(1, '08:00'), 'morning brief sent; daily reminder fired and moved to the next day');
await cron();
assert(sent.filter((x) => x.p.text?.startsWith('☀️')).length === 1, 'morning brief only once a day');
await tap(`rp:${rmDaily.id}`); show('stop the daily reminder');
assert(sqlite.prepare('SELECT done FROM user_reminders WHERE id = ?').get(rmDaily.id).done === 1, 'repeating reminder stopped');
NOW = ev1.remind_at + 1; await cron(); show('cron: 30 minutes before the meeting');
assert(lastText().includes('daqiqadan keyin') && lastText().includes('Investorlar'), 'heads-up before the event');
n0 = sent.length;
await tap(`xi:${ev1.id}`);
assert(sent.slice(n0).some((x) => x.method === 'sendDocument' && /text\/calendar/.test(x.p.document)), 'event .ics file');
await tap(`xd:${ev1.id}`); show('delete event');
assert(!sqlite.prepare('SELECT 1 FROM cal_events WHERE id = ?').get(ev1.id), 'event deleted');

await say('bu matnni rus tiliga tarjima qil: Hurmatli hamkorlar'); show('translate (router)');
assert(lastText().includes('UZ → RU') && lastText().includes('Уважаемые'), 'text translated');
await tap('sm:tr'); await tap('tm:en'); show('translate mode');
assert(mode() === 'translate', 'translate mode on');
await update({ message: { message_id: ++msgId, from: owner, chat: { id: 111, type: 'private' }, photo: [{ file_id: 'PH1', file_size: 50000, width: 800, height: 600 }] } });
show('translate a photo');
assert(geminiCalls.at(-1) === 'translate+media' && lastGeminiMime === 'image/jpeg', 'photo sent to translation');
await say('Yana bir matn');
assert(geminiCalls.at(-1) === 'translate' && mode() === 'translate', 'stays in translate mode');
await say('✈️ Mening safarlarim');
assert(mode() === null, 'section button leaves translate mode');

await tap('sm:lt'); await say('Germaniya elchixonasiga viza arizasini tezlashtirish haqida rasmiy xat'); show('letter');
const letter1 = sqlite.prepare('SELECT * FROM letters ORDER BY id DESC').get();
assert(letter1 && lastText().includes('Hurmatli janoblar') && lastKb().includes(`lr:${letter1.id}`), 'letter drafted');
await tap(`lr:${letter1.id}`); await say('qisqaroq qil'); show('revise letter');
const letter2 = sqlite.prepare('SELECT * FROM letters ORDER BY id DESC').get();
assert(letter2.id === letter1.id + 1 && geminiCalls.at(-1) === 'reviseLetter', 'letter revised');
await tap(`lt:${letter2.id}`); await tap(`lx:${letter2.id}:en`); show('letter to English');
assert(sqlite.prepare('SELECT lang FROM letters ORDER BY id DESC').get().lang === 'en', 'letter translated');
await say('Germaniya elchixonasiga viza boʻyicha xat yoz'); show('letter (router)');
assert(sqlite.prepare('SELECT COUNT(*) c FROM letters').get().c === 4, 'letter from a free message');

await say('rahmat'); show('small talk');
assert(lastText() === 'Arzimaydi!', 'small talk answered');

await tap('cl'); show('phone calendar link');
const feedUrl = lastText().match(/https:\/\/bot\.example\/cal\/[0-9a-f]{32}\.ics/)?.[0];
const feed = await worker.fetch(new Request(feedUrl), env, ctx);
const ics = await feed.text();
assert(feed.status === 200 && /text\/calendar/.test(feed.headers.get('content-type')) && ics.includes('Bank bilan') && ics.includes('BEGIN:VALARM') && ics.includes(`T-000${tripId}-flight`), 'calendar feed has events and trips');
assert((await worker.fetch(new Request('https://bot.example/cal/' + '0'.repeat(32) + '.ics'), env, ctx)).status === 404, 'wrong calendar link is refused');

// repeat rules
const tzE = { TZ_OFFSET_MIN: '300' };
assert(nextDue(tzE, Date.parse('2027-01-31T04:00:00Z'), 'monthly') === Date.parse('2027-02-28T04:00:00Z'), 'monthly repeat keeps to the month end');
assert(nextDue(tzE, Date.parse('2026-11-06T04:00:00Z'), 'weekdays') === Date.parse('2026-11-09T04:00:00Z'), 'weekday repeat skips the weekend');

assert(tgErrors.length === 0, 'Telegram would accept every message' + (tgErrors.length ? ': ' + tgErrors.join(' | ') : ''));

console.log('\nGemini calls:', geminiCalls.join(', '));
Date.now = realNow;
