// Small shared helpers: database, time, text, encoding, encryption.

import { O, normLang } from './i18n.js';

export const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;

// ---------- database ----------
const clean = (args) => args.map((a) => (a === undefined ? null : a));
export const one = (env, sql, ...a) => env.DB.prepare(sql).bind(...clean(a)).first();
export const all = async (env, sql, ...a) => (await env.DB.prepare(sql).bind(...clean(a)).all()).results || [];
export const run = (env, sql, ...a) => env.DB.prepare(sql).bind(...clean(a)).run();

export async function logEvent(env, actor, action, tripId = null, detail = null) {
  await run(env, 'INSERT INTO events (ts, actor, action, trip_id, detail) VALUES (?, ?, ?, ?, ?)',
    Date.now(), actor, action, tripId, detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)));
}

// ---------- language (per person: 'uz' | 'ru'; null until they pick) ----------
export async function getLang(env, uid) {
  const r = await one(env, 'SELECT lang FROM prefs WHERE telegram_id = ?', uid);
  return r ? normLang(r.lang) : null;
}
export async function setLang(env, uid, lang) {
  await run(env, 'INSERT INTO prefs (telegram_id, lang, updated_at) VALUES (?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET lang = excluded.lang, updated_at = excluded.updated_at',
    uid, normLang(lang), Date.now());
}
// Strings for a person, Uzbek until they choose.
export async function strings(env, uid) {
  const lang = (await getLang(env, uid)) || 'uz';
  return { lang, L: O[lang] };
}

// ---------- trips ----------
const JSON_COLS = { fields: {}, offers: [], agent_texts: [] };
export const code = (id) => 'T-' + String(id).padStart(4, '0');

function inflate(row) {
  if (!row) return null;
  for (const k in JSON_COLS) { try { row[k] = JSON.parse(row[k]); } catch { row[k] = structuredClone(JSON_COLS[k]); } }
  row.code = code(row.id);
  return row;
}

export async function getTrip(env, id) { return inflate(await one(env, 'SELECT * FROM trips WHERE id = ?', id)); }

export const OPEN = ['collecting', 'draft', 'sent', 'offers', 'chosen', 'booked'];
export const WITH_AGENT = ['sent', 'offers', 'chosen', 'booked'];

export async function activeTrip(env, ownerId) {
  return inflate(await one(env,
    `SELECT * FROM trips WHERE owner_id = ? AND status IN (${OPEN.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`,
    ownerId, ...OPEN));
}

export async function createTrip(env, ownerId) {
  const now = Date.now();
  const r = await run(env, `INSERT INTO trips (owner_id, status, created_at, updated_at) VALUES (?, 'collecting', ?, ?)`, ownerId, now, now);
  const id = r.meta?.last_row_id;
  await logEvent(env, 'owner', 'trip_created', id);
  return getTrip(env, id);
}

const SAVE_COLS = ['status', 'fields', 'offers', 'agent_texts', 'recommended', 'reason', 'chosen', 'agent_thread_id', 'clarify_asked',
  'draft_at', 'nudged', 'sent_at', 'due_at', 'sla_reminded', 'offers_at', 'nudged_offers', 'flight_at', 'done_at'];

export async function saveTrip(env, t) {
  const vals = SAVE_COLS.map((c) => (c in JSON_COLS ? JSON.stringify(t[c] ?? JSON_COLS[c]) : (typeof t[c] === 'boolean' ? (t[c] ? 1 : 0) : t[c])));
  await run(env, `UPDATE trips SET ${SAVE_COLS.map((c) => c + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`, ...vals, Date.now(), t.id);
}

export async function setStatus(env, t, status, actor = 'bot') {
  const from = t.status;
  t.status = status;
  await saveTrip(env, t);
  await logEvent(env, actor, 'status', t.id, `${from} -> ${status}`);
}

// ---------- time ----------
const WD = {
  uz: ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'],
  ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
};
const MO = {
  uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
};
// "12-noyabr" / "12 ноября"
const dm = (d, m, lang) => (lang === 'ru' ? `${d} ${MO.ru[m]}` : `${d}-${MO.uz[m]}`);
const p2 = (n) => String(n).padStart(2, '0');
export const tz = (env) => (Number(env.TZ_OFFSET_MIN) || 0) * MIN;

export function localISODate(env, ms = Date.now()) {
  const d = new Date(ms + tz(env));
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}
export function fmtLocal(env, ms, lang = 'uz') {
  const d = new Date(ms + tz(env));
  lang = normLang(lang);
  return `${WD[lang][d.getUTCDay()]}, ${dm(d.getUTCDate(), d.getUTCMonth(), lang)}, ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
export function hmLocal(env, ms) { const d = new Date(ms + tz(env)); return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; }
export function dshort(iso, lang = 'uz') {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '?';
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return dm(d, m - 1, normLang(lang));
}
// "2026-11-12" or "2026-11-12T07:40" in the owner's local time -> UTC ms
export function localToUtc(env, iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  let H = 0, M = 0;
  const t = iso.slice(11, 16);
  if (/^\d{2}:\d{2}$/.test(t)) { H = +t.slice(0, 2); M = +t.slice(3, 5); }
  return Date.UTC(y, m - 1, d, H, M) - tz(env);
}
export function nights(a, b) {
  if (!a || !b) return null;
  const x = Date.parse(a.slice(0, 10)), y = Date.parse(b.slice(0, 10));
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / DAY) : null;
}

// ---------- text ----------
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function money(o, lang = 'uz') {
  if (!o || o.total_price == null) return O[normLang(lang)].priceUnknown;
  return Number(o.total_price).toLocaleString('en-US').replace(/,/g, ' ') + ' ' + (o.currency || 'USD');
}
export const refundWord = (r, lang = 'uz') => { const w = O[normLang(lang)].refund; return w[r] || w.unknown; };

// ---------- encoding ----------
export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---------- passport encryption (AES-GCM, key = PASSPORT_KEY secret, 32 bytes base64) ----------
async function aesKey(env) {
  if (!env.PASSPORT_KEY) throw new Error('PASSPORT_KEY secret is not set');
  return crypto.subtle.importKey('raw', unb64(env.PASSPORT_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(text)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}
export async function decrypt(env, blob) {
  const [, iv, ct] = blob.split(':');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

// ---------- conversation log (context for Gemini, and for debugging) ----------
const plain = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
export async function logChat(env, uid, dir, text) {
  if (!text) return null;
  const r = await run(env, 'INSERT INTO chat_log (owner_id, dir, text, ts) VALUES (?, ?, ?, ?)', uid, dir, plain(text).slice(0, 2000), Date.now());
  return r.meta?.last_row_id ?? null;
}
// The last messages of the past day, oldest first, as "Azizbek: …" / "Bot: …" lines. Small on purpose (about 20 lines).
export async function recentChat(env, uid, limit = 20) {
  const rows = await all(env, 'SELECT dir, text FROM chat_log WHERE owner_id = ? AND ts > ? ORDER BY id DESC LIMIT ?', uid, Date.now() - DAY, limit);
  return rows.reverse().map((r) => `${r.dir === 'in' ? 'Azizbek' : 'Bot'}: ${r.text.slice(0, 600)}`).join('\n');
}

// ---------- "what is the next message for" (translate mode, letter request, ...) ----------
const MODE_TTL = 30 * MIN;
export async function setMode(env, uid, mode, arg = null) {
  await run(env, 'UPDATE prefs SET mode = ?, mode_arg = ?, mode_at = ? WHERE telegram_id = ?', mode, arg == null ? null : String(arg), Date.now(), uid);
}
export async function getMode(env, uid) {
  const r = await one(env, 'SELECT mode, mode_arg, mode_at FROM prefs WHERE telegram_id = ?', uid);
  if (!r?.mode || Date.now() - (r.mode_at || 0) > MODE_TTL) return null;
  return { mode: r.mode, arg: r.mode_arg };
}
export const clearMode = (env, uid) => run(env, 'UPDATE prefs SET mode = NULL, mode_arg = NULL, mode_at = NULL WHERE telegram_id = ?', uid);

// ---------- local (Tashkent) calendar days ----------
// UTC ms of local midnight for a local "YYYY-MM-DD"
export const dayStart = (env, iso) => localToUtc(env, iso);
export const addDaysISO = (iso, n) => new Date(Date.parse(iso.slice(0, 10)) + n * DAY).toISOString().slice(0, 10);
export function weekdayName(iso, lang = 'uz') { return WD[normLang(lang)][new Date(Date.parse(iso.slice(0, 10))).getUTCDay()]; }
// "dushanba, 3-noyabr" / "понедельник, 3 ноября"
export function dayLabel(iso, lang = 'uz') { return `${weekdayName(iso, lang)}, ${dshort(iso, lang)}`; }
