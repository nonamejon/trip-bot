// Live test: the real bot code against the REAL Gemini API. Telegram is faked (nothing is sent to anyone)
// and SQLite stands in for D1. Every reply is checked against Telegram's rules and written to a report.
//
//   GEMINI_API_KEY=... node test/live.mjs [voice-dir] [report.md]
//   SCENARIO=intake ... : only the trip-request conversations that went wrong in real use (multi-turn, corrections)
//
// voice-dir (optional) holds trip.ogg and remind.ogg: Uzbek voice notes used as real voice messages.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import worker from '../src/index.js';
import { tinyPdf } from '../src/files.js';
import { checkTelegram } from './telegram-rules.mjs';

const [voiceDir, reportPath = 'live-report.md'] = process.argv.slice(2);
if (!process.env.GEMINI_API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

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
  OWNER_ID: '111', ADMIN_ID: '111', AGENT_MODE: 'mock', AGENT_LANG: 'uz', MOCK_MIRROR: 'true', MOCK_DELAY_MIN: '2',
  GEMINI_MODEL: 'gemini-3.8-flash', AGENT_SLA_MIN: '240', NUDGE_MIN: '120', TZ_OFFSET_MIN: '300', BRIEF_HOUR: '8',
  TELEGRAM_TOKEN: 'TOKEN', GEMINI_API_KEY: process.env.GEMINI_API_KEY, WEBHOOK_SECRET: 'sec', PUBLIC_URL: 'https://bot.example',
  PASSPORT_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
};

// ---------- fake Telegram, real Gemini ----------
const realFetch = globalThis.fetch;
const files = {};
const sent = [], tgErrors = [];
let msgId = 100, geminiMs = 0, geminiCalls = 0;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes('generativelanguage.googleapis.com')) {
    const t = Date.now(); const r = await realFetch(url, init); geminiMs += Date.now() - t; geminiCalls++; return r;
  }
  if (url.startsWith('https://api.telegram.org/file/')) return new Response(files[url.split('/').pop()]);
  const method = url.split('/').pop();
  const p = init.body instanceof FormData
    ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `<file ${v.size}B ${v.type}>`]))
    : JSON.parse(init.body || '{}');
  sent.push({ method, p });
  const problem = checkTelegram(method, p);
  if (problem) { tgErrors.push(`${method}: ${problem}`); return new Response(JSON.stringify({ ok: false, description: 'Bad Request: ' + problem })); }
  let result = true;
  if (method === 'sendMessage') result = { message_id: ++msgId };
  if (method === 'sendDocument') result = { message_id: ++msgId, document: { file_id: 'FILE_' + msgId } };
  if (method === 'getFile') result = { file_path: p.file_id };
  return new Response(JSON.stringify({ ok: true, result }));
};

// ---------- driving ----------
let updateId = 1;
const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };
const owner = { id: 111, is_bot: false, first_name: 'Azizbek' };
const report = [`# Live test report\n\nReal Gemini (${env.GEMINI_MODEL}), fake Telegram, ${new Date().toISOString()}\n`];
const steps = [];
let shown = 0;

async function step(label, update) {
  const t0 = Date.now(), g0 = geminiMs, c0 = geminiCalls;
  update.update_id = updateId++;
  await worker.fetch(new Request('https://bot.example/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'sec' }, body: JSON.stringify(update) }), env, ctx);
  while (pending.length) await pending.shift();
  record(label, Date.now() - t0, geminiMs - g0, geminiCalls - c0);
}
async function cronNow(label) {
  sqlite.prepare('UPDATE jobs SET due_at = 0 WHERE done_at IS NULL').run(); // like /now
  const t0 = Date.now(), g0 = geminiMs, c0 = geminiCalls;
  await worker.scheduled({}, env, ctx);
  while (pending.length) await pending.shift();
  record(label, Date.now() - t0, geminiMs - g0, geminiCalls - c0);
}
function record(label, ms, gms, calls) {
  const route = sqlite.prepare(`SELECT detail FROM events WHERE action = 'route' ORDER BY id DESC LIMIT 1`).get()?.detail;
  steps.push({ label, ms, calls, route });
  report.push(`\n### ${label}\n_${(ms / 1000).toFixed(1)} s, ${calls} Gemini call(s)_\n`);
  for (const s of sent.slice(shown)) {
    if (['answerCallbackQuery', 'editMessageReplyMarkup', 'sendChatAction', 'getFile', 'setMyCommands', 'deleteMessage'].includes(s.method)) continue;
    const rm = typeof s.p.reply_markup === 'string' ? JSON.parse(s.p.reply_markup) : s.p.reply_markup;
    const btns = [...(rm?.inline_keyboard || []).flat().map((b) => `[${b.text}]`), ...(rm?.keyboard || []).flat().map((b) => `⌨ ${b.text}`)].join(' ');
    const body = s.p.text ?? (s.p.document ? `📎 ${s.p.caption || ''} ${s.p.document}` : '');
    report.push('> ' + String(body).replace(/\n/g, '\n> ') + (btns ? `\n>\n> ${btns}` : '') + '\n');
  }
  shown = sent.length;
  console.log(`${(ms / 1000).toFixed(1).padStart(5)}s ${String(calls).padStart(2)} calls  ${route && label.startsWith('»') ? route.padEnd(14) : ''.padEnd(14)} ${label}`);
}
const say = (text) => step(`» ${text}`, { message: { message_id: ++msgId, from: owner, chat: { id: 111, type: 'private' }, text } });
const tap = (data, label = data) => step(`[tap ${label}]`, { callback_query: { id: 'cq' + updateId, from: owner, data, message: { message_id: msgId, chat: { id: 111 } } } });
const voice = (name) => { files[name] = fs.readFileSync(`${voiceDir}/${name}.ogg`); return step(`» 🎤 voice note ${name}.ogg`, { message: { message_id: ++msgId, from: owner, chat: { id: 111, type: 'private' }, voice: { file_id: name, file_size: files[name].length, mime_type: 'audio/ogg' } } }); };
const doc = (id, bytes, name, mime, caption) => { files[id] = bytes; return step(`» 📄 ${name}${caption ? ' — ' + caption : ''}`, { message: { message_id: ++msgId, from: owner, chat: { id: 111, type: 'private' }, caption, document: { file_id: id, file_name: name, mime_type: mime, file_size: bytes.length } } }); };
const trip = () => sqlite.prepare('SELECT * FROM trips ORDER BY id DESC LIMIT 1').get();
const lastButtons = () => { const m = sent.filter((x) => x.method === 'sendMessage' && x.p.reply_markup).at(-1); return (m?.p.reply_markup.inline_keyboard || []).flat().map((b) => b.callback_data); };

// ---------- trip-request conversations from real use ----------
const fields = () => JSON.parse(trip()?.fields || '{}');
if (process.env.SCENARIO === 'intake') {
  const expect = (cond, what) => { report.push(`\n**${cond ? 'OK' : 'WRONG'}:** ${what} — ${JSON.stringify(fields())}\n`); console.log(`   ${cond ? 'OK   ' : 'WRONG'} ${what}`); };
  await say('/start'); await tap('lg:uz', 'Oʻzbekcha');
  await say('Istanbulga 12-dan 15-noyabrgacha, 3 kun, bir kishilik.');
  expect(fields().destination && fields().date_from?.endsWith('-11-12') && fields().date_to?.endsWith('-11-15') && fields().travelers === 1 && trip().status === 'draft', 'first message: Istanbul, 12-15 Nov, 1 person; complete, nothing asked');
  await say('Bagaj 10 kilo');
  expect(trip().status === 'draft' && /10/.test(fields().baggage || ''), 'baggage mentioned later is added');
  await say('Nimaga yoʻlovchilar sonini 13 ta deb yozib qoʻyibsan?');
  expect(fields().travelers === 1, 'complaint about "13" does not change the count');
  await tap(`cx:${trip().id}`, 'Bekor qilish');
  await say('Istanbulga 5-noyabrdan bir haftalik');
  expect(fields().date_from?.endsWith('-11-05') && fields().date_to?.endsWith('-11-12') && !fields().travelers, 'a week from 5 Nov; travelers asked, not guessed');
  await say('Uch kishi.');
  expect(fields().travelers === 3, 'three people');
  await say("Reja o'zgardi, bir haftalikka emas, 10 kunlik qil.");
  expect(fields().date_to?.endsWith('-11-15'), '10 days -> back 15 Nov');
  await say("Bo'ldi, qolganlar kelolmaydi.");
  expect(fields().travelers === 1, 'the others cannot come -> 1 person');
  expect(trip().status === 'draft', 'complete without being asked for baggage');
  fs.writeFileSync(reportPath, report.join('\n'));
  process.exit(0);
}

// ---------- a day of use ----------
await say('/start');
await tap('lg:uz', 'Oʻzbekcha');
await say('/passport AZIZBEK TESTOV, FA0000000, 2031-05-01 gacha');

// My trips: request by voice, approve, agent answers, choose, booked
if (voiceDir) await voice('trip'); else await say('Kelasi seshanba Istanbulga uchishim kerak, juma qaytaman, yolgʻiz, ertalabki toʻgʻri reys, mehmonxona Levent tumanida');
for (let i = 0; i < 2 && trip()?.status === 'collecting'; i++) await say('Yolgʻiz boraman, 1 kishi');
if (trip()?.status === 'draft') await tap(`ap:${trip().id}`, 'Tasdiqlash');
for (let i = 0; i < 4 && trip()?.status === 'sent'; i++) await cronNow('[cron] mock agent replies (real Gemini writes and parses)');
if (trip()?.status === 'offers') {
  const choice = lastButtons().find((d) => d.startsWith('ch:'));
  await tap(choice, 'choose ' + choice);
  await cronNow('[cron] mock agent books and sends documents');
}
await say('agentga ayting, deraza yonidagi joy kerak');
await say('safarim qanday holatda?');
await say('✈️ Mening safarlarim');
await tap(`tv:${trip().id}`, 'trip card');

// Personal secretary
await say('🗂 Shaxsiy kotib');
await say('ertaga soat 15:00 da Hilton mehmonxonasida investorlar bilan uchrashuv');
if (voiceDir) await voice('remind');
await say('juma kuni Bobur bilan uchrashuv bor');
await say('soat 10 da, ofisda');
await say('har kuni ertalab 8 da dori ichishni eslatib tur');
await say('20 daqiqadan keyin onamga qoʻngʻiroq qilishni eslat');
await say('ertaga nima rejalarim bor?');
await say('bu matnni rus tiliga tarjima qil: Hurmatli hamkorlar, uchrashuvni dushanba kuniga koʻchirishni taklif qilamiz.');
await doc('pdf1', tinyPdf(['Hurmatli Azizbek Karimovich!', '', "Sizni 2026-yil 20-noyabr kuni soat 10:00 da bo'ladigan", "investitsiya forumiga taklif qilamiz. Forum Toshkent shahrida o'tadi.", '', 'Hurmat bilan, tashkiliy qo\'mita']), 'taklifnoma.pdf', 'application/pdf', 'ingliz tiliga tarjima qil');
await say('Germaniya elchixonasiga viza arizamni tezroq koʻrib chiqishni soʻrab rasmiy xat yoz');
const lr = lastButtons().find((d) => d.startsWith('lr:'));
if (lr) { await tap(lr, 'Oʻzgartirish'); await say('qisqaroq qil va nemis tilida yoz'); }
await say('rahmat!');

// Russian
await say('/ru');
await say('Напомни завтра в 9 утра позвонить в посольство');
await say('Что у меня на этой неделе?');
await say('Переведи на узбекский: Встреча переносится на пятницу, 11:00.');

// ---------- summary ----------
const slow = steps.filter((s) => s.ms > 25000);
const lines = [
  '', '## Summary', '',
  `Steps: ${steps.length}. Gemini calls: ${geminiCalls}. Slowest step: ${(Math.max(...steps.map((s) => s.ms)) / 1000).toFixed(1)} s.`,
  `Steps over 25 s (risky for the Worker's ~30 s limit): ${slow.length ? slow.map((s) => s.label).join('; ') : 'none'}.`,
  `Telegram rule violations: ${tgErrors.length ? tgErrors.join(' | ') : 'none'}.`,
  `Final trip status: ${trip()?.status}. Calendar events: ${sqlite.prepare('SELECT COUNT(*) c FROM cal_events').get().c}. Reminders: ${sqlite.prepare('SELECT COUNT(*) c FROM user_reminders').get().c}. Letters: ${sqlite.prepare('SELECT COUNT(*) c FROM letters').get().c}.`,
  `Errors reported to admin: ${sent.filter((x) => x.p.text?.includes('Bot error')).length}.`,
];
report.push(...lines);
fs.writeFileSync(reportPath, report.join('\n'));
console.log(lines.join('\n'));
