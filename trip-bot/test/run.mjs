// End-to-end test of the trip bot with Telegram and Gemini faked and SQLite standing in for D1.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import worker from '../src/index.js';
import { tinyPdf } from '../src/files.js';
import { nextDue } from '../src/secretary.js';
import { aviasalesUrl, fetchFares } from '../src/aviasales.js';
import { checkTelegram } from './telegram-rules.mjs';
import { O } from '../src/i18n.js';

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
  OWNER_ID: '111', ADMIN_ID: '222', AGENT_MODE: 'mock', MOCK_MIRROR: 'true', MOCK_DELAY_MIN: '2',
  GEMINI_MODEL: 'gemini-3.8-flash', AGENT_SLA_MIN: '240', NUDGE_MIN: '120', TZ_OFFSET_MIN: '300',
  TELEGRAM_TOKEN: 'TOKEN', GEMINI_API_KEY: 'KEY', WEBHOOK_SECRET: 'sec', PUBLIC_URL: 'https://bot.example', BRIEF_HOUR: '8',
  PASSPORT_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
};

// ---------- fake Telegram + Gemini ----------
const faresQueries = [];
let dupOffers = false;
let lastGeminiMime = null, lastParsePrompt = '', lastSearchPrompt = '', failSearch = 0, lastFaresQuery = null;
let ticketDepart = '2026-11-12T09:15', ticketBack = '2026-11-15T21:05';
let msgId = 100, offersRound = 0, failNextGemini = false;
const sent = [];
const cleared = new Set();
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
    if (prompt.startsWith('Read the attached document')) {
      geminiCalls.push('parseTicket');
      out = { is_ticket: true, booking_ref: 'ABC123', flights: [
        { flight_number: 'TK 371', airline: 'Turkish Airlines', from_city: 'Toshkent', from_iata: 'TAS', to_city: 'Istanbul', to_iata: 'IST', departure_local: ticketDepart, arrival_local: ticketDepart.slice(0, 11) + '12:30' },
        { flight_number: 'TK 370', airline: 'Turkish Airlines', from_city: 'Istanbul', from_iata: 'IST', to_city: 'Toshkent', to_iata: 'TAS', departure_local: ticketBack, arrival_local: null },
      ] };
    } else if (prompt.startsWith('You are a travel agent in Tashkent searching')) {
      geminiCalls.push('search' + (body.tools ? '+google' : ''));
      lastSearchPrompt = prompt;
      if (failSearch > 0) { failSearch--; return new Response('{"error":{"code":400,"message":"search failed"}}', { status: 400 }); }
      out = 'SEARCHRESULT 1) Uzbekistan Airways HY271 ... https://www.uzairways.com 2) Turkish TK363 ... 3) Centrum Air C6301 ...';
    } else if (prompt.startsWith('You route messages')) {
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
      out = /kerak emas/.test(prompt) ? { date: null, time: null } : { date: localISO(3), time: '07:40' };
    } else if (prompt.includes('parsing step') && prompt.includes('executive')) {
      geminiCalls.push('parseRequest' + (hasMedia ? '+audio' : ''));
      lastParsePrompt = prompt;
      const nm = (prompt.match(/His new message: "{3}([\s\S]*?)"{3}/) || [])[1] || '';
      out = /Xitoy/.test(nm)
        ? { destination: 'Xitoy', destination_kind: 'country', city_options: [{ name: 'Pekin', iata: 'BJS' }, { name: 'Shanxay', iata: 'SHA' }, { name: 'Guanchjou', iata: 'CAN' }], date_from: localISO(1), travelers: 1 }
        : /roʻyxatini ber/.test(nm) ? { wants_search: true }
        : /arzon/.test(nm)
        ? { destination: 'Guanchjou', origin: 'Toshkent', date_flex: 'noyabr oʻrtalari, borib-kelish eng arzon kunlarda', travelers: null }
        : /Dubai/.test(nm)
        ? { destination: 'Dubai', origin: 'Tashkent', travelers: /45/.test(nm) ? 45 : null }
        : { transcript: hasMedia ? "Istanbulga 12-noyabr ertalab uchishim kerak, 3 kunga." : null, origin: 'Tashkent', destination: 'Istanbul', origin_iata: 'TAS', destination_iata: 'IST', date_from: '2026-11-12', date_to: '2026-11-15', travelers: 1, flight_pref: 'morning, direct', baggage: /kg/.test(nm) ? '23 kg' : null, hotel: 'Levent, near the meeting', budget: null, notes: null };
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
      if (prompt.includes('SEARCHRESULT')) {
        o[0] = { ...o[0], flight_price: 412, hotel_price_night: 346, flight_link: 'https://www.uzairways.com/en/flights/HY271', hotel_link: 'https://www.grandlevent.example/book', date_out: '2026-12-12', date_back: '2026-12-15', baggage: '23 kg' };
        o[1] = { ...o[1], date_out: '2026-12-12', date_back: '2026-12-15', flight_link: 'https://www.turkishairlines.com/en/' };
        o[2] = { ...o[2], total_price: null, flight_price: 300, hotel_price_night: 50, date_out: '2026-12-12', date_back: '2026-12-15' };
      }
      out = { offers: o, recommended: 0, reason: 'Morning direct flight, hotel next to the meeting, and fully refundable.', origin_en: 'Tashkent', destination_en: 'Istanbul', area_en: 'Levent, Istanbul' };
      if (dupOffers) { o[1] = { ...o[0], label: 'Option 2' }; o[2] = { ...o[0], label: 'Option 3' }; out = { ...out, offers: o, recommended: 2, note: 'Bu kuni faqat bitta reys bor.' }; }
    } else if (prompt.startsWith('Transcribe')) {
      geminiCalls.push('transcribe'); out = { transcript: 'what is the status' };
    } else throw new Error('Unexpected Gemini prompt: ' + prompt.slice(0, 80));
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
  }
  if (url.startsWith('https://api.travelpayouts.com/aviasales/v3/prices_for_dates')) {
    lastFaresQuery = new URL(url).searchParams; faresQueries.push(lastFaresQuery);
    const dep = lastFaresQuery.get('departure_at'); // like the real API: an exact date only matches that day
    return new Response(JSON.stringify({ success: true, data: [
      { origin: 'TAS', destination: 'IST', price: 412, airline: 'HY', flight_number: '271', departure_at: '2026-11-12T07:40:00+05:00', return_at: '2026-11-15T12:30:00+03:00', transfers: 0, return_transfers: 0, duration_to: 320, link: '/search/TAS1211IST15111?t=HY1' },
      { origin: 'TAS', destination: 'IST', price: 380, airline: 'C6', flight_number: '301', departure_at: '2026-11-25T05:05:00+05:00', return_at: '2026-11-28T10:00:00+03:00', transfers: 0, return_transfers: 0, duration_to: 335, link: '/search/TAS2511IST28111?t=C61' },
    ].filter((d) => dep.length === 7 || d.departure_at.startsWith(dep)) }));
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
    if (method === 'editMessageReplyMarkup') { // like Telegram: removing buttons that are already gone fails
      const key = `${p.chat_id}:${p.message_id}`;
      if (cleared.has(key)) return new Response(JSON.stringify({ ok: false, description: 'Bad Request: message is not modified' }));
      if (!p.reply_markup?.inline_keyboard?.length) cleared.add(key);
    }
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
  if (/uchib keldim/.test(m)) return { intent: 'trip_finish' };
  if (/agentga|arzonroq/.test(m)) return { intent: 'trip_note' };
  if (/chiptam/.test(m)) return { intent: 'trip_docs' };
  if (/xatoga/.test(m)) return { intent: 'chat', reply: 'x' };
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
  if (/pitsa/.test(m)) return { intent: 'off_topic', reply: 'Klassik pitsa uchun xamir...' };
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
    const btns = rm ? [...(rm.inline_keyboard || []).flat().map((b) => `[${b.text} → ${b.callback_data || b.url}]`), ...(rm.keyboard || []).flat().map((b) => `⌨[${b.text}]`)].join(' ') : '';
    const body = s.p.text ?? s.p.caption ?? (s.p.document ? 'doc ' + s.p.document : '');
    console.log(`-> ${s.method} chat=${s.p.chat_id ?? ''}\n   ${String(body).replace(/\n/g, '\n   ')}${btns ? '\n   ' + btns : ''}`);
  }
  shown = sent.length;
}
const status = () => sqlite.prepare('SELECT id, status FROM trips ORDER BY id DESC LIMIT 1').get();
const lastText = () => sent.filter((x) => x.method === 'sendMessage').at(-1)?.p.text || '';
const assert = (c, m) => { if (!c) { console.error('ASSERTION FAILED: ' + m); process.exitCode = 1; } else console.log('   ok: ' + m); };

// ---------- scenario ----------
await update({ message: { message_id: 1, from: { id: 999, is_bot: false, first_name: 'Quvonchbek', username: 'quvonchbek_test' }, chat: { id: 999, type: 'private' }, text: 'hi' } });
show('stranger writes');
assert(sent.some((x) => x.p.chat_id === 999 && x.p.text.includes('999')), 'stranger gets their id, nothing else');
assert(sent.some((x) => x.p.chat_id === '111' && x.p.text.includes('@quvonchbek_test') && JSON.stringify(x.p.reply_markup).includes('ma:999')), 'the owner is told, with a "Give access" button');
const strangerNotes = () => sent.filter((x) => (x.p.text || '').startsWith('👤 New person')).length;
await update({ message: { message_id: 2, from: { id: 999, is_bot: false, first_name: 'Quvonchbek' }, chat: { id: 999, type: 'private' }, text: 'hello?' } });
assert(strangerNotes() === 1, 'the owner is told only once a day per person');

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
assert(status().status === 'collecting', 'vague request stays collecting');
assert(lastText().includes('Dubai') && lastText().includes('❓') && lastText().includes('yoʻlovchilar soni') && !/Aniqlashtirib.*bagaj/.test(lastText()), 'first request shows the card with ❓ and asks for everything missing at once (not baggage)');
await say('Dubai, 45 people'); show('impossible traveler count');
assert(lastParsePrompt.includes('Azizbek: Need to go to Dubai') && lastParsePrompt.includes('Bot: '), 'Gemini gets the recent conversation (both sides)');
assert(sqlite.prepare('SELECT fields FROM trips ORDER BY id DESC').get().fields.indexOf('"travelers"') === -1, 'an impossible traveler count is dropped and asked again');
await say('cancel'); show('cancel while collecting');

await voice(); show('voice note');
assert(status().status === 'draft' && lastText().includes('tarifga koʻra') && !lastText().includes('Eshitdim'), 'voice note: complete without baggage (left to the fare), not echoed back');
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
await say('Istanbul again please, same as before, 23 kg'); show('second trip');
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
await say('/alltrips');
assert(sent.slice(n).some((x) => x.p.chat_id === 111 && /T-0003 · cancelled/.test(x.p.text)), 'the owner sees every trip with /alltrips');
n = sent.length;
await admin2('hello'); show('second admin plain message');
assert(sent.slice(n).some((x) => x.p.chat_id === 222 && JSON.stringify(x.p.reply_markup || '').includes('lg:uz')), 'an admin is a user too: first message asks for a language');
const tapAs = (who, data) => update({ callback_query: { id: 'cq' + updateId, from: { id: who, is_bot: false }, data, message: { message_id: msgId, chat: { id: who } } } });
await tapAs(222, 'lg:ru');
n = sent.length;
await admin2('/trips');
assert(sent.slice(n).some((x) => x.p.chat_id === 222 && x.p.text === 'Поездок пока нет. Напишите, куда и когда вам нужно поехать.'), "an admin's /trips shows their own trips (none), not the owner's");
await tapAs(222, `tv:${tripId}`);
assert(sent.at(-1).method === 'answerCallbackQuery' && sent.at(-1).p.text === O.ru.staleBtn, "an admin cannot open the owner's trip");
for (const c of ['/alltrips', '/log', '/now', `/fire T-000${tripId}`, `/setstatus T-000${tripId} done`]) {
  n = sent.length;
  await admin2(c);
  assert(sent.slice(n).filter((x) => x.p.chat_id === 222).every((x) => x.p.text === O.ru.unknownCmd), `an admin does not get the maintenance command ${c.split(' ')[0]}`);
}

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
assert(lastText() === O.uz.reminderPast && mode() === 'clarify', 'a time in the past is questioned');
await say('/menu');
assert(mode() === null, 'a command clears a pending question');

await say('ertaga nima rejalarim bor?'); show('agenda (router)');
assert(lastText().includes('Investorlar bilan uchrashuv') && lastText().includes('Dori ichish') && lastText().includes('Ertaga'), "agenda lists tomorrow's events and reminders");
await tap('ag:w'); show('agenda: week');
assert(lastText().includes('Uchrashuv'), 'week view includes Friday');
await say('/today'); show('/today');
await say('/reminders'); show('/reminders');
assert(lastText().includes('Dori ichish') && lastText().includes('Позвонить Бобуру'), 'reminders list');

advance(21); { const mark = sent.length; await cron(); show('cron: 20-minute reminder');
var fired = sent.slice(mark).filter((x) => (x.p.text || '').includes('Позвонить Бобуру')); }
assert(fired.length === 1 && JSON.stringify(fired[0].p.reply_markup).includes(`rs:${rm20.id}:15`) && sqlite.prepare('SELECT done FROM user_reminders WHERE id = ?').get(rm20.id).done === 1, 'one-off reminder fires once, with snooze buttons');
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
const callsBefore = geminiCalls.length;
await say('pitsa retseptini ayt'); show('off-topic question');
assert(lastText() === O.uz.offTopic && !lastText().includes('xamir') && geminiCalls.length === callsBefore + 1, 'an unrelated question gets the fixed answer, with no extra Gemini call');

await tap('cl'); show('phone calendar link');
const feedUrl = lastText().match(/https:\/\/bot\.example\/cal\/111\/[0-9a-f]{32}\.ics/)?.[0];
const feed = await worker.fetch(new Request(feedUrl), env, ctx);
const ics = await feed.text();
assert(feed.status === 200 && /text\/calendar/.test(feed.headers.get('content-type')) && ics.includes('Bank bilan') && ics.includes('BEGIN:VALARM') && ics.includes(`T-000${tripId}-flight`), 'calendar feed has events and trips');
assert((await worker.fetch(new Request('https://bot.example/cal/' + '0'.repeat(32) + '.ics'), env, ctx)).status === 404, 'wrong calendar link is refused');
assert((await worker.fetch(new Request(feedUrl.replace('/cal/111/', '/cal/222/')), env, ctx)).status === 404, "one user's calendar token does not open another's");

// repeat rules
const tzE = { TZ_OFFSET_MIN: '300' };
assert(nextDue(tzE, Date.parse('2027-01-31T04:00:00Z'), 'monthly') === Date.parse('2027-02-28T04:00:00Z'), 'monthly repeat keeps to the month end');
assert(nextDue(tzE, Date.parse('2026-11-06T04:00:00Z'), 'weekdays') === Date.parse('2026-11-09T04:00:00Z'), 'weekday repeat skips the weekend');

assert(sqlite.prepare(`SELECT COUNT(*) c FROM chat_log WHERE dir = 'out'`).get().c > 50 && sqlite.prepare(`SELECT COUNT(*) c FROM chat_log WHERE text LIKE '%FA1234567%'`).get().c === 0, 'both sides of the chat are logged, the passport never');
// flexible dates: no invented date, nothing blocks, the agent is asked for the cheapest dates
await say('Guanchjouga oyning oʻrtalarida, qaysi kuni arzon boʻlsa, borib kelish'); show('flexible dates');
const flexTrip = status().id;
assert(status().status === 'draft' && lastKb().includes(`ap:${flexTrip}`), 'flexible dates: approve button right away');
assert(/Sanalar: [^\n❓]*moslashuvchan/.test(lastText()) && !lastText().includes('15-noyabr') && lastText().includes('Bilmasangiz'), 'card shows the flexible window, no invented date, optional questions only');
await tap(`ap:${flexTrip}`);
assert(!/undefined/.test(sqlite.prepare(`SELECT detail FROM events WHERE action = 'to_agent:request' AND trip_id = ?`).get(flexTrip)?.detail || ''), 'agent request: unknown traveler count shows as not set, not "undefined"');
assert(/eng arzon sanalarni/.test(sqlite.prepare(`SELECT detail FROM events WHERE action = 'to_agent:request' AND trip_id = ?`).get(flexTrip)?.detail || ''), 'agent is asked for the cheapest dates');
await say('/cancel'); await tap(`cy:${flexTrip}`);

// ---------- search mode: no agent, the bot finds flights and hotels itself ----------
env.AGENT_MODE = 'search';
await say('Istanbul again please, same as before, 23 kg'); show('search mode: request');
assert(!/agent/i.test(lastText()), 'search mode: the request card never mentions an agent');
await tap(`cx:${status().id}`);
await say('Guanchjouga oyning oʻrtalarida, qaysi kuni arzon boʻlsa, borib kelish');
assert(!/agent/i.test(lastText()) && lastText().includes('har bir variantda koʻrsatiladi') && lastText().includes('shunday yuboravering.'), 'search mode: baggage and optional lines without the agent');
await tap(`cx:${status().id}`);
await say('/help');
assert(lastText().includes('reys va mehmonxona qidirish') && !/turagent/i.test(lastText()), 'search mode: help describes search, not an agent');
await say('/passport');
assert(!/agent/i.test(lastText()), 'search mode: passport instructions do not mention an agent');
await say('Istanbul again please, same as before, 23 kg');
const sTrip = status().id;
env.TRAVELPAYOUTS_TOKEN = 'tp-test'; env.TRAVELPAYOUTS_MARKER = '12345';
await tap(`ap:${sTrip}`); show('search mode: approve');
assert(sent.filter((x) => x.method === 'sendMessage').at(-2).p.reply_markup.inline_keyboard[0][0].text === 'Tasdiqlash va qidirish', 'search mode: the card says approve and search');
assert(lastText().startsWith('🔎') && sqlite.prepare(`SELECT COUNT(*) c FROM jobs WHERE kind = 'search_offers' AND trip_id = ? AND done_at IS NULL`).get(sTrip).c === 1, 'approve queues a search, not a message to an agent');
await cron(); show('cron: search');
assert(geminiCalls.includes('search+google') && status().status === 'offers', 'search runs with Google Search and shows options (no clarification round)');
assert(lastText().includes('aviasales.uz/search/TAS1212IST15121?marker=12345') && lastText().includes('uzairways.com') && lastText().includes('booking.com') && !lastText().includes('google.com'), 'options link to Aviasales (with the affiliate marker), the airline, the hotel and Booking.com');
assert(lastSearchPrompt.includes('Real fares found on Aviasales') && lastSearchPrompt.includes('"price":412') && faresQueries.some((q) => q.get('origin') === 'TAS' && q.get('destination') === 'IST' && q.get('departure_at') === '2026-11-12' && q.get('return_at') === '2026-11-15'), 'with a Travelpayouts token the search is built from real Aviasales fares');
assert(lastText().includes('Aviasales’dan'), 'the card says the prices come from Aviasales');
assert(!lastText().includes('turkishairlines.com'), 'a bare home page (airline site with nothing filled in) is not shown');
assert(lastText().includes('450 USD (✈️ 300 + 🏨 50/kecha)') && !/narxi nomaʼlum \(/.test(lastText()), 'only flight and hotel prices given: the total is computed (no "price unknown" next to prices)');
assert(lastText().includes('1 450 USD (✈️ 412 + 🏨 346/kecha)'), 'the total is split into the flight (as on Aviasales) and the hotel per night');
delete env.TRAVELPAYOUTS_TOKEN; delete env.TRAVELPAYOUTS_MARKER;
assert(!sent.slice(-6).some((x) => (x.p.text || '').includes('Bot → agent')), 'nothing is mirrored to an agent');
assert(lastText().includes('ss=Levent%2C+Istanbul'), 'hotel search uses the area he wants, in English');
await tap(`ch:${sTrip}:0`); show('search mode: choose');
assert(status().status === 'chosen' && lastKb().includes('"url":"https://www.aviasales.uz/search/TAS1212IST15121') && lastKb().includes(`bk:${sTrip}`), 'choosing shows booking links (Aviasales first) and "I booked it"');
n0 = sent.length;
await tap(`bk:${sTrip}`); show('search mode: booked');
assert(status().status === 'booked' && sent.slice(n0).some((x) => x.method === 'sendDocument' && /text\/calendar/.test(x.p.document)), '"I booked it" completes the trip with the calendar file');
assert(sent.slice(n0).some((x) => (x.p.text || '').includes('qidiruvdan olindi') && JSON.stringify(x.p.reply_markup).includes(`tf:${sTrip}`)), 'after "I booked it": the time came from the search, send the ticket or change it');
assert(JSON.parse(sqlite.prepare('SELECT fields FROM trips WHERE id = ?').get(sTrip).fields).date_from === '2026-11-12', 'dates kept');
await tap(`tv:${sTrip}`);
assert(lastKb().includes(`bl:${sTrip}`) && !lastKb().includes('aw:'), 'card: booking links, no "write to agent"');

// a failed search is retried once, then he gets a retry button
await say('Istanbul again please, same as before, 23 kg'); const sTrip2 = status().id;
await tap(`ap:${sTrip2}`);
failSearch = 2;
await cron(); advance(2); await cron(); show('search fails twice');
assert(lastText().includes('topa olmadim') && lastKb().includes(`sr:${sTrip2}`), 'after two failures: apology and a retry button');
await tap(`sr:${sTrip2}`); await cron(); show('retry search');
assert(status().status === 'offers', 'retry finds options');
await say('arzonroq variant topib ber'); show('new wish while choosing');
assert(lastText().startsWith('🔎') && /arzonroq/.test(sqlite.prepare('SELECT payload FROM jobs ORDER BY id DESC').get().payload), 'a new wish starts a new search with it');
await cron();
assert(lastSearchPrompt.includes('arzonroq'), 'the search gets his wish');
await tap(`ch:${sTrip2}:1`);
await update({ message: { message_id: ++msgId, from: owner, chat: { id: 111, type: 'private' }, caption: 'chiptam', document: { file_id: 'TICKET1', file_name: 'ticket.pdf', mime_type: 'application/pdf', file_size: 30000 } } });
show('his ticket');
assert(status().status === 'booked' && sqlite.prepare('SELECT COUNT(*) c FROM documents WHERE trip_id = ?').get(sTrip2).c === 1, 'sending the ticket saves it and completes the booking');
const tk2 = sqlite.prepare('SELECT * FROM trips WHERE id = ?').get(sTrip2);
assert(tk2.flight_at === Date.UTC(2026, 10, 12, 4, 15) && JSON.parse(tk2.fields).date_to === '2026-11-15' && sent.some((x) => (x.p.text || '').includes('Chiptadan oʻqidim: <b>TK 371</b>')), 'the real flight time is read from the ticket and used for reminders');
// a ticket for a trip booked elsewhere: the bot creates the trip from it
sqlite.prepare(`UPDATE trips SET status = 'done' WHERE status IN ('booked', 'chosen', 'offers', 'sent')`).run();
ticketDepart = '2026-12-20T08:00'; ticketBack = '2026-12-27T19:00';
await update({ message: { message_id: ++msgId, from: owner, chat: { id: 111, type: 'private' }, caption: 'chiptam', photo: [{ file_id: 'TICKETPHOTO', file_size: 80000, width: 900, height: 1200 }] } });
show('ticket for an unknown trip');
const fromTicket = sqlite.prepare('SELECT * FROM trips ORDER BY id DESC').get();
assert(fromTicket.status === 'booked' && fromTicket.flight_at === Date.UTC(2026, 11, 20, 3, 0) && JSON.parse(fromTicket.fields).destination === 'Istanbul' && sqlite.prepare('SELECT COUNT(*) c FROM reminders WHERE trip_id = ?').get(fromTicket.id).c === 2, 'a ticket for a trip booked elsewhere becomes a booked trip with reminders');
env.AGENT_MODE = 'mock';

// never silent: an error gives an apology at once; a cut-off message is caught by the watchdog
sqlite.exec('ALTER TABLE chat_log RENAME TO chat_log_off');
await say('bu xabar xatoga uchraydi');
sqlite.exec('ALTER TABLE chat_log_off RENAME TO chat_log');
assert(lastText().startsWith('Kechirasiz, xabaringizni qayta ishlashda xatolik'), 'an unexpected error: he gets an apology, not silence');
sqlite.prepare('INSERT INTO updates (update_id, ts, chat_id) VALUES (?, ?, ?)').run(999001, Date.now() - 3 * 60e3, 111);
await cron(); show('watchdog');
assert(sent.some((x) => (x.p.text || '').startsWith('Kechirasiz, oxirgi xabaringizga javob bera olmadim')) && sqlite.prepare('SELECT apologized FROM updates WHERE update_id = 999001').get().apologized === 1, 'a message cut off mid-way: the watchdog apologizes (once)');
await cron();
assert(sent.filter((x) => (x.p.text || '').startsWith('Kechirasiz, oxirgi')).length === 1, 'the watchdog apologizes only once');

// access: the owner approves a new person with a button; admins cannot
const tapAs2 = (who, data) => update({ callback_query: { id: 'cq' + updateId, from: { id: who, is_bot: false }, data, message: { message_id: msgId, chat: { id: who } } } });
await tapAs2(222, 'ma:999');
assert(!sqlite.prepare('SELECT 1 FROM members WHERE telegram_id = 999').get() && sent.at(-1).p.text === O.ru.notAllowed, 'an admin cannot give access');
await tap('ma:999'); show('owner gives access');
assert(sqlite.prepare('SELECT username FROM members WHERE telegram_id = 999').get()?.username === 'quvonchbek_test', 'access given, stored with the username');
assert(sent.some((x) => x.p.chat_id === 999 && JSON.stringify(x.p.reply_markup || '').includes('lg:uz')), 'the new person gets the language picker');
await tapAs2(999, 'lg:uz');
await update({ message: { message_id: ++msgId, from: { id: 999, is_bot: false }, chat: { id: 999, type: 'private' }, text: '/today' } });
assert(sent.filter((x) => x.p.chat_id === 999).at(-1).p.text.includes('rejalar yoʻq'), 'the new person uses the assistant (own empty calendar)');
await update({ message: { message_id: ++msgId, from: { id: 999, is_bot: false }, chat: { id: 999, type: 'private' }, text: '/log' } });
assert(sent.filter((x) => x.p.chat_id === 999).at(-1).p.text === O.uz.unknownCmd, 'but has no maintenance commands');
await say('/users'); show('/users');
assert(lastText().includes('@quvonchbek_test') && lastKb().includes('mr:999'), '/users lists approved people with a remove button');
await tap('mr:999');
assert(!sqlite.prepare('SELECT 1 FROM members WHERE telegram_id = 999').get(), 'removed');
n0 = sent.length;
await update({ message: { message_id: ++msgId, from: { id: 999, is_bot: false }, chat: { id: 999, type: 'private' }, text: 'salom' } });
assert(sent.slice(n0).some((x) => x.p.chat_id === 999 && x.p.text.includes('shaxsiy yordamchi')), 'after removal they are a stranger again');

// a country instead of a city (real case: "ertaga Xitoyga"): city buttons; "show the flights" starts the search
await say('ertaga Xitoyga uchishim kerak, taqdimotga'); show('country instead of a city');
const cnTrip = status().id;
assert(status().status === 'collecting' && lastText().includes('qaysi shaharga') && lastKb().includes(`dc:${cnTrip}:0`) && lastKb().includes('📍 Pekin'), 'a country: the bot asks which city, with buttons for the main ones');
await tap(`dc:${cnTrip}:0`); show('city chosen');
const cnFields = JSON.parse(sqlite.prepare('SELECT fields FROM trips WHERE id = ?').get(cnTrip).fields);
assert(status().status === 'draft' && cnFields.destination === 'Pekin' && cnFields.destination_iata === 'BJS' && lastKb().includes(`ap:${cnTrip}`), 'one tap sets the city and its airport code');
await say('reyslar roʻyxatini ber'); show('"show me the flights"');
assert(status().status === 'sent', '"reyslar roʻyxatini ber" on a complete request starts the search (no repeated card)');
await say('/cancel'); await tap(`cy:${cnTrip}`);

// a booked trip after its flight (real case: flight 9 Nov, stay 10-13 Nov): no daily "trip" line in the brief or
// agenda; "I already flew" closes it instead of offering to cancel
const finIns = sqlite.prepare(`INSERT INTO trips (owner_id, status, fields, offers, chosen, flight_at, done_at, created_at, updated_at) VALUES (111, 'booked', ?, ?, 0, ?, ?, ?, ?)`)
  .run(JSON.stringify({ origin: 'Germaniya', destination: 'Saudiya Arabistoni', date_from: localISO(4), date_to: localISO(6) }),
    JSON.stringify([{ label: '1-variant', airline: 'Pegasus', outbound: '14:30 → 01:25', refund: 'none' }]), localMs(3, '14:30'), localMs(7, '00:00'), NOW, NOW);
const finTrip = Number(finIns.lastInsertRowid);
const dayAfterFlight = localMs(4, '08:00'); // computed before the clock moves (localMs is relative to NOW)
NOW = dayAfterFlight; await cron();
await say('/today'); show('day after the flight: /today');
assert(!lastText().includes('Saudiya'), 'the day after the flight: nothing about the trip in today\'s plan (no daily "trip" line)');
await tap('ag:w'); show('week during the stay');
assert(!lastText().includes('🧳') && (lastText().match(/Saudiya/g) || []).length === 1 && lastText().includes('🛬 Qaytish: Saudiya'), 'the week view shows only the return day, not every day of the stay');
await tap(`tv:${finTrip}`);
assert(lastKb().includes(`tz:${finTrip}`), 'a booked trip card has "the trip happened" (stop reminders)');
await say('allaqachon uchib keldim, endi eslatmang'); show('"I already flew"');
assert(sqlite.prepare('SELECT status FROM trips WHERE id = ?').get(finTrip).status === 'done' && lastText().includes('yakunlandi') && !lastKb().includes('cy:'), '"I already flew, stop reminding" closes the trip as done, not a cancellation');

// an unbooked request whose dates passed and that nobody touched for a day is closed quietly
const staleIns = sqlite.prepare(`INSERT INTO trips (owner_id, status, fields, offers, chosen, created_at, updated_at) VALUES (111, 'chosen', ?, '[]', 0, ?, ?)`)
  .run(JSON.stringify({ destination: 'Urganch', date_from: localISO(-6), date_to: localISO(-1) }), NOW - 8 * 86400e3, NOW - 8 * 86400e3);
const freshPast = sqlite.prepare(`INSERT INTO trips (owner_id, status, fields, offers, created_at, updated_at) VALUES (111, 'draft', ?, '[]', ?, ?)`)
  .run(JSON.stringify({ destination: 'Samarqand', date_from: localISO(-5) }), NOW, NOW);
await cron();
assert(sqlite.prepare('SELECT status FROM trips WHERE id = ?').get(Number(staleIns.lastInsertRowid)).status === 'cancelled', 'a stale unbooked trip with past dates is closed');
assert(sqlite.prepare('SELECT status FROM trips WHERE id = ?').get(Number(freshPast.lastInsertRowid)).status === 'draft', 'a request he is working on right now is left alone even with a past date');
// cancelling in search mode: no "I told the agent"
env.AGENT_MODE = 'search';
sqlite.prepare(`UPDATE trips SET status = 'offers' WHERE id = ?`).run(Number(freshPast.lastInsertRowid));
await tap(`tx:${Number(freshPast.lastInsertRowid)}`); await tap(`cy:${Number(freshPast.lastInsertRowid)}`);
assert(lastText().includes('bekor qilindi') && !lastText().includes('Agentga'), 'search mode: cancelling does not claim to have told an agent');
env.AGENT_MODE = 'mock';

// invite by username: access the moment they write, no waiting for the owner
await say('/invite @Quvonch_Test');
assert(lastText().startsWith('✅ @Quvonch_Test is invited'), 'the owner invites a username');
await update({ message: { message_id: ++msgId, from: { id: 777, is_bot: false, first_name: 'Quvonchbek', username: 'quvonch_test' }, chat: { id: 777, type: 'private' }, text: 'salom' } });
show('invited person writes');
assert(sqlite.prepare('SELECT 1 FROM members WHERE telegram_id = 777').get() && !sqlite.prepare('SELECT 1 FROM invites').get(), 'their first message gives access (username case does not matter)');
assert(sent.some((x) => x.p.chat_id === 777 && JSON.stringify(x.p.reply_markup || '').includes('lg:uz')) && !sent.some((x) => x.p.chat_id === 777 && (x.p.text || '').includes('shaxsiy yordamchi')), 'they get the language picker, not the stranger message');
assert(sent.some((x) => x.p.chat_id === '111' && (x.p.text || '').includes('@quvonch_test (ID <code>777</code>) joined')), 'the owner is told they joined');
await update({ message: { message_id: ++msgId, from: { id: 778, is_bot: false, username: 'someone_else' }, chat: { id: 778, type: 'private' }, text: 'hi' } });
assert(!sqlite.prepare('SELECT 1 FROM members WHERE telegram_id = 778').get(), 'other usernames are not let in');
n0 = sent.length;
await update({ message: { message_id: ++msgId, from: { id: 222, is_bot: false }, chat: { id: 222, type: 'private' }, text: '/invite @x_someone' } });
assert(!sqlite.prepare('SELECT 1 FROM invites').get(), 'admins cannot invite');

// Aviasales link and fares
assert(aviasalesUrl({}, { origin_iata: 'TAS', destination_iata: 'IST', date_from: '2026-11-12', date_to: '2026-11-15', travelers: 1 }) === 'https://www.aviasales.uz/search/TAS1211IST15111', 'Aviasales search link format');
assert(aviasalesUrl({}, { destination_iata: 'DXB', date_from: '2026-12-01', one_way: true, travelers: 2 }) === 'https://www.aviasales.uz/search/TAS0112DXB2', 'Aviasales one-way link for 2 adults');
const flexFares = await fetchFares({ TRAVELPAYOUTS_TOKEN: 't' }, { origin_iata: 'TAS', destination_iata: 'IST', date_flex: 'noyabr oʻrtalari', window_from: '2026-11-10', window_to: '2026-11-20' });
assert(lastFaresQuery.get('departure_at') === '2026-11' && flexFares.length === 1 && flexFares[0].price === 412 && flexFares[0].link === 'https://www.aviasales.uz/search/TAS1211IST15111?t=HY1', 'flexible dates: month search, kept to his window');
assert((await fetchFares({}, { destination_iata: 'IST', date_from: '2026-11-12' })).length === 0, 'no token: no fare lookup');
const nearFares = await fetchFares({ TRAVELPAYOUTS_TOKEN: 't' }, { origin_iata: 'TAS', destination_iata: 'IST', date_from: '2026-11-13', date_to: '2026-11-16' });
assert(nearFares.length === 1 && nearFares[0].depart === '2026-11-12T07:40', 'exact dates: fares for those dates or the closest ones (±3 days)');

// ---------- audit fixes: races, stale buttons, outdated results ----------
{
  env.AGENT_MODE = 'search';
  sqlite.prepare(`UPDATE trips SET status = 'done' WHERE status IN ('collecting', 'draft', 'sent', 'offers', 'chosen', 'booked')`).run();
  // a double tap on "approve" queues one search
  await say('Istanbul again please, same as before, 23 kg'); const dt = status().id;
  await Promise.all([tap(`ap:${dt}`), tap(`ap:${dt}`)]);
  assert(sqlite.prepare(`SELECT COUNT(*) c FROM jobs WHERE kind = 'search_offers' AND trip_id = ? AND done_at IS NULL`).get(dt).c === 1 && !sent.slice(-4).some((x) => /Kechirasiz, xabaringizni/.test(x.p.text || '')), 'a double tap on approve: one search, no error');
  // cancelled while searching: the late result is dropped
  const { runSearch } = await import('../src/search.js');
  const job = sqlite.prepare(`SELECT * FROM jobs WHERE trip_id = ? AND done_at IS NULL`).get(dt);
  sqlite.prepare('UPDATE jobs SET done_at = 1 WHERE id = ?').run(job.id);
  const late = runSearch(env, job);
  sqlite.prepare(`UPDATE trips SET status = 'cancelled' WHERE id = ?`).run(dt);
  await late; await settle();
  assert(sqlite.prepare('SELECT status FROM trips WHERE id = ?').get(dt).status === 'cancelled', 'a search that finishes after he cancelled does not bring the trip back');
  // an old option button after a new search
  await say('Istanbul again please, same as before, 23 kg'); const ob = status().id;
  await tap(`ap:${ob}`); await cron();
  const oldBtn = JSON.parse(lastKb()).inline_keyboard[0][0].callback_data;
  assert(/^ch:\d+:0:[0-9a-z]+$/.test(oldBtn), 'option buttons carry the version of the list');
  advance(1); await say('arzonroq variant topib ber'); await cron();
  await tap(oldBtn);
  assert(status().status === 'offers', 'a button from the previous list does not pick from the new one');
  // a flight time typed for a trip that is not booked yet books it, with reminders
  const fresh = JSON.parse(lastKb()).inline_keyboard[0][0].callback_data;
  await tap(fresh);
  assert(status().status === 'chosen', 'the current list still works');
  await tap(`tf:${ob}`); await say('12-noyabr 07:40'); show('flight time on a chosen trip');
  const obRow = sqlite.prepare('SELECT * FROM trips WHERE id = ?').get(ob);
  assert(obRow.status === 'booked' && obRow.done_at > obRow.flight_at && sqlite.prepare('SELECT COUNT(*) c FROM reminders WHERE trip_id = ? AND sent_at IS NULL').get(ob).c === 2, 'a typed flight time books the trip: reminders and an end date');
  // a bad answer in flight-time mode does not trap the next message
  await tap(`tf:${ob}`); await say('kerak emas');
  assert(lastKb().includes(`tf:${ob}`) && mode() === null, 'flight time not understood: a button to try again, no trap');
  // the document button checks the owner
  const docId = sqlite.prepare('INSERT INTO documents (trip_id, name, file_id, created_at) VALUES (?, ?, ?, ?)').run(ob, 'x.pdf', 'SECRETFILE', Date.now()).lastInsertRowid;
  n0 = sent.length;
  await update({ callback_query: { id: 'cqx', from: { id: 222, is_bot: false }, data: `doc:${docId}`, message: { message_id: msgId, chat: { id: 222 } } } });
  assert(!sent.slice(n0).some((x) => x.method === 'sendDocument'), "one user cannot open another user's document");
  // a ticket for another destination becomes its own trip, the booked one is untouched
  ticketDepart = '2027-01-10T08:00'; ticketBack = '2027-01-14T19:00';
  await update({ message: { message_id: ++msgId, from: owner, chat: { id: 111, type: 'private' }, caption: 'chiptam', document: { file_id: 'TICKET9', file_name: 't9.pdf', mime_type: 'application/pdf', file_size: 30000 } } });
  assert(sqlite.prepare('SELECT flight_at FROM trips WHERE id = ?').get(ob).flight_at === obRow.flight_at && status().id !== ob && status().status === 'booked', "a ticket that matches none of his trips does not change the booked one");
  env.AGENT_MODE = 'mock';
}
// the same flight three times (one fare that day) is shown once, with the search's note
{
  env.AGENT_MODE = 'search';
  sqlite.prepare(`UPDATE trips SET status = 'done' WHERE status IN ('collecting', 'draft', 'sent', 'offers', 'chosen', 'booked')`).run();
  await say('Istanbul again please, same as before, 23 kg'); const du = status().id;
  dupOffers = true; await tap(`ap:${du}`); await cron(); dupOffers = false; show('duplicate options');
  assert(status().status === 'offers' && JSON.parse(sqlite.prepare('SELECT offers FROM trips WHERE id = ?').get(du).offers).length === 1 && lastText().includes('Bu kuni faqat bitta reys bor') && lastText().startsWith('<b>1 ta variant'), 'identical options are shown once, with the note');
  env.AGENT_MODE = 'mock';
}
// cron runs that overlap send a reminder once
{
  const { secretaryChecks, nextDue: nd, addEvent } = await import('../src/secretary.js');
  sqlite.prepare('INSERT INTO user_reminders (owner_id, text, due_at, repeat, created_at) VALUES (?, ?, ?, ?, ?)').run(111, 'Bir marta', Date.now() - 1000, 'none', Date.now());
  sqlite.prepare('INSERT INTO user_reminders (owner_id, text, due_at, repeat, anchor_day, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(111, 'Har oy', Date.now() - 1000, 'monthly', 31, Date.now());
  n0 = sent.length;
  await Promise.all([secretaryChecks(env), secretaryChecks(env)]);
  assert(sent.slice(n0).filter((x) => /Bir marta/.test(x.p.text || '')).length === 1 && sent.slice(n0).filter((x) => /Har oy/.test(x.p.text || '')).length === 1, 'overlapping cron runs: each reminder is sent once');
  const tzE2 = { TZ_OFFSET_MIN: '300' };
  const feb = nd(tzE2, Date.parse('2027-01-31T04:00:00Z'), 'monthly', 31);
  assert(feb === Date.parse('2027-02-28T04:00:00Z') && nd(tzE2, feb, 'monthly', 31) === Date.parse('2027-03-31T04:00:00Z'), 'monthly on the 31st: Feb 28, then back to Mar 31');
  // a snooze tapped twice adds one reminder
  const rid = sqlite.prepare(`SELECT id FROM user_reminders WHERE text = 'Bir marta'`).get().id;
  const before = sqlite.prepare('SELECT COUNT(*) c FROM user_reminders').get().c;
  const snoozeMsg = ++msgId;
  const tapMsg = () => update({ callback_query: { id: 'cq' + updateId, from: owner, data: `rs:${rid}:15`, message: { message_id: snoozeMsg, chat: { id: 111 } } } });
  await tapMsg(); await tapMsg();
  assert(sqlite.prepare('SELECT COUNT(*) c FROM user_reminders').get().c === before + 1, 'a snooze tapped twice snoozes once');
  // an event in the past is questioned; a soon one gets its heads-up at once
  const L0 = O.uz;
  const y = new Date(Date.now() + 5 * 3600e3 - 86400e3).toISOString().slice(0, 10);
  assert((await addEvent(env, 111, 111, L0, 'uz', { ev_title: 'Eski', ev_date: y, ev_time: '10:00' })) === false, 'an event in the past is not saved');
  const soon = new Date(Date.now() + 5 * 3600e3 + 10 * 60e3);
  await addEvent(env, 111, 111, L0, 'uz', { ev_title: 'Tezda', ev_date: soon.toISOString().slice(0, 10), ev_time: soon.toISOString().slice(11, 16) });
  n0 = sent.length; await secretaryChecks(env);
  assert(sent.slice(n0).some((x) => /Tezda/.test(x.p.text || '') && /daqiqadan keyin/.test(x.p.text)), 'an event added 10 minutes ahead still gets a heads-up');
}
// long text is split safely; .ics lines are folded
{
  const { splitText } = await import('../src/telegram.js');
  const parts = splitText('a &amp; b '.repeat(1000), 3900);
  assert(parts.every((p) => p.length <= 3900 && !/&[a-z]*$/.test(p)), 'long messages are never cut inside an HTML entity');
  const { eventIcs } = await import('../src/files.js');
  const ics = new TextDecoder().decode(eventIcs({ id: 9, title: 'Juda uzun nomli uchrashuv '.repeat(6), start_at: Date.now(), all_day: 0 }, 18e6));
  assert(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75), '.ics lines are folded to 75 octets');
  const fares2 = await fetchFares({ TRAVELPAYOUTS_TOKEN: 't' }, { origin_iata: 'TAS', destination_iata: 'IST', date_from: '2026-11-12', date_to: '2026-11-15', travelers: 2 });
  assert(fares2[0].price === 412 && fares2[0].price_total === 824, 'Aviasales prices are per person: the total is for all travelers');
}

// error alerts: passing glitches are only logged; repeated ones give one warning; real errors alert at once
const { reportError } = await import('../src/flow.js');
const alerts = () => sent.filter((x) => /Bot (error|warning)/.test(x.p.text || '')).length;
let a0 = alerts();
await reportError(env, new Error('D1_ERROR: Network connection lost.'), 'cron checks');
assert(alerts() === a0, 'a single D1 network blip does not alert anyone');
await reportError(env, new Error('Gemini gemini-3.8-flash timed out after 25 s'), 'routeMessage');
await reportError(env, new Error('D1_ERROR: Network connection lost.'), 'cron checks');
await reportError(env, new Error('D1_ERROR: Network connection lost.'), 'cron checks');
assert(alerts() === a0 + 1 && sent.at(-1).p.chat_id === '111', 'repeated glitches: one warning, to the alert list only');
a0 = alerts();
await reportError(env, new Error('TypeError: x is undefined'), 'update 1');
assert(alerts() === a0 + 1, 'a real error alerts at once');
assert(tgErrors.length === 0, 'Telegram would accept every message' + (tgErrors.length ? ': ' + tgErrors.join(' | ') : ''));

console.log('\nGemini calls:', geminiCalls.join(', '));
Date.now = realNow;
