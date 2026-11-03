// Thin Telegram Bot API client.

const api = (env, method) => `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`;

export async function tg(env, method, params = {}) {
  const r = await fetch(api(env, method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const j = await r.json().catch(() => ({ ok: false, description: 'HTTP ' + r.status }));
  if (!j.ok) throw new Error(`Telegram ${method} failed: ${j.description}`);
  return j.result;
}

// Upload a file we generated (PDF, .ics). Returns the sent Message.
export async function tgUpload(env, method, params, field, filename, bytes, mime) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(params)) if (v != null) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  fd.append(field, new Blob([bytes], { type: mime }), filename);
  const r = await fetch(api(env, method), { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({ ok: false, description: 'HTTP ' + r.status }));
  if (!j.ok) throw new Error(`Telegram ${method} failed: ${j.description}`);
  return j.result;
}

// Download a file a user sent (voice note, PDF, photo). Bots can fetch files up to 20 MB.
export async function download(env, fileId) {
  const f = await tg(env, 'getFile', { file_id: fileId });
  const r = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${f.file_path}`);
  if (!r.ok) throw new Error('Telegram file download failed: HTTP ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

export async function send(env, chatId, text, extra = {}) {
  const m = await tg(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  // Keep the bot's side of the owner's conversation (with its buttons) for context and debugging.
  if (env.DB && String(chatId) === String(env.OWNER_ID)) {
    const btns = (extra.reply_markup?.inline_keyboard || []).flat().map((b) => b.text);
    const plain = String(text).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    await env.DB.prepare('INSERT INTO chat_log (owner_id, dir, text, ts) VALUES (?, ?, ?, ?)')
      .bind(Number(chatId), 'out', (plain + (btns.length ? `\n[buttons: ${btns.join(' | ')}]` : '')).slice(0, 2000), Date.now()).run().catch(() => {});
  }
  return m;
}

export const typing = (env, chatId) => tg(env, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

// Telegram shows "typing…" for 5 s. Run fn while keeping it on, for slow steps (letters, translations, parsing).
export async function whileTyping(env, chatId, fn) {
  typing(env, chatId);
  const timer = setInterval(() => typing(env, chatId), 4500);
  try { return await fn(); } finally { clearInterval(timer); }
}

// Inline keyboard: rows of [label, callback_data]; a value starting with http(s):// makes a link button.
export const kb = (rows) => ({ reply_markup: { inline_keyboard: rows.map((r) => r.map(([text, data]) => (/^https?:\/\//.test(data) ? { text, url: data } : { text, callback_data: data }))) } });

// Bottom keyboard that stays under the chat: rows of labels.
export const replyKb = (rows) => ({ reply_markup: { keyboard: rows.map((r) => r.map((text) => ({ text }))), resize_keyboard: true, is_persistent: true } });

// Telegram allows 4096 characters per message. Split long text at line breaks; buttons go on the last part.
export async function sendLong(env, chatId, text, extra = {}) {
  const LIMIT = 3900;
  if (text.length <= LIMIT) return send(env, chatId, text, extra);
  const parts = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if ((cur + '\n' + line).length > LIMIT && cur) { parts.push(cur); cur = ''; }
    let l = line;
    while (l.length > LIMIT) { parts.push(l.slice(0, LIMIT)); l = l.slice(LIMIT); }
    cur = cur ? cur + '\n' + l : l;
  }
  if (cur) parts.push(cur);
  let last;
  for (let i = 0; i < parts.length; i++) last = await send(env, chatId, parts[i], i === parts.length - 1 ? extra : {});
  return last;
}
