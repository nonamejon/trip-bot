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

export const send = (env, chatId, text, extra = {}) =>
  tg(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

export const typing = (env, chatId) => tg(env, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

// Inline keyboard: rows of [label, callback_data]
export const kb = (rows) => ({ reply_markup: { inline_keyboard: rows.map((r) => r.map(([text, data]) => ({ text, callback_data: data }))) } });
