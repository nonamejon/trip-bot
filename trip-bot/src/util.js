// Small shared helpers: database, time, text, encoding, encryption.

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
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n) => String(n).padStart(2, '0');
export const tz = (env) => (Number(env.TZ_OFFSET_MIN) || 0) * MIN;

export function localISODate(env, ms = Date.now()) {
  const d = new Date(ms + tz(env));
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}
export function fmtLocal(env, ms) {
  const d = new Date(ms + tz(env));
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}, ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
export function hmLocal(env, ms) { const d = new Date(ms + tz(env)); return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; }
export function dshort(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '?';
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MO[m - 1]}`;
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
export function money(o) {
  if (!o || o.total_price == null) return 'price unknown';
  return Number(o.total_price).toLocaleString('en-US').replace(/,/g, ' ') + ' ' + (o.currency || 'USD');
}
export const refundWord = (r) => ({ full: 'full refund', penalty: 'refund with a penalty', none: 'no refund' }[r] || 'not stated');

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
