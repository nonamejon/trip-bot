// End-to-end test of the trip bot with Telegram and Gemini faked and SQLite standing in for D1.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import worker from '../src/index.js';
import { tinyPdf } from '../src/files.js';

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
  TELEGRAM_TOKEN: 'TOKEN', GEMINI_API_KEY: 'KEY', WEBHOOK_SECRET: 'sec',
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
    if (prompt.includes('parsing step') && prompt.includes('executive')) {
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
    let result = true;
    if (method === 'sendMessage') result = { message_id: ++msgId, chat: { id: p.chat_id }, text: p.text };
    if (method === 'sendDocument') result = { message_id: ++msgId, document: { file_id: 'FILE_' + msgId } };
    if (method === 'getFile') result = { file_path: 'voice/file_1.oga' };
    if (method === 'getMe') result = { username: 'test_trip_bot' };
    return new Response(JSON.stringify({ ok: true, result }));
  }
  throw new Error('Unexpected fetch ' + url);
};

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
    const btns = s.p.reply_markup ? (typeof s.p.reply_markup === 'string' ? JSON.parse(s.p.reply_markup) : s.p.reply_markup).inline_keyboard.flat().map((b) => `[${b.text} → ${b.callback_data}]`).join(' ') : '';
    const body = s.p.text ?? s.p.caption ?? (s.p.document ? 'doc ' + s.p.document : '');
    console.log(`-> ${s.method} chat=${s.p.chat_id ?? ''}\n   ${String(body).replace(/\n/g, '\n   ')}${btns ? '\n   ' + btns : ''}`);
  }
  shown = sent.length;
}
const status = () => sqlite.prepare('SELECT id, status FROM trips ORDER BY id DESC LIMIT 1').get();
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
assert(sent.some((x) => x.method === 'setMyCommands' && x.p.scope?.chat_id === 111 && x.p.commands[0].description === 'Joriy safar holati'), 'command menu set to Uzbek for this chat');
await say('/passport AZIZBEK UBAYDULLAYEV, FA1234567, valid until 2031-05-01'); show('/passport');
const trav = sqlite.prepare('SELECT passport_enc FROM travelers').get();
assert(trav.passport_enc.startsWith('v1:') && !trav.passport_enc.includes('FA1234567'), 'passport stored encrypted');

await say('Need to go to Dubai'); show('vague request');
assert(status().status === 'collecting', 'vague request stays collecting and asks a question');
await say('cancel'); show('cancel while collecting');

await voice(); show('voice note');
assert(status().status === 'draft', 'voice note produced a draft');
const audioCalls = () => geminiCalls.filter((c) => c === 'parseRequest+audio').length;
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

console.log('\nGemini calls:', geminiCalls.join(', '));
Date.now = realNow;
