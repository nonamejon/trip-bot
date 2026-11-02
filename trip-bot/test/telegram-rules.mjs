// What the real Telegram Bot API would reject: bad HTML, over-long text, oversized button data, bad commands.
// Shared by test/run.mjs and test/live.mjs.

const HTML_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'a', 'blockquote', 'tg-spoiler', 'span']);
function checkHtml(text) {
  if (text.length > 4096) return `message is too long (${text.length})`;
  const stack = [];
  const rest = text.replace(/<(\/?)([a-z-]+)(?:\s[^<>]*)?>/g, (m, close, tag) => {
    if (!HTML_TAGS.has(tag)) { stack.push('!' + tag); return ''; }
    if (close) { if (stack.pop() !== tag) stack.push('!unbalanced ' + tag); } else stack.push(tag);
    return '';
  });
  if (stack.length) return 'bad or unbalanced HTML tags: ' + stack.join(',');
  if (/[<>]/.test(rest)) return 'unescaped < or >';
  if (/&(?!(lt|gt|amp|quot|#\d+);)/.test(rest)) return 'unescaped &';
  return null;
}
export function checkTelegram(method, p) {
  if (method === 'sendMessage') {
    if (!p.text) return 'message text is empty';
    if (p.parse_mode === 'HTML') { const e = checkHtml(p.text); if (e) return e; }
  }
  if (p.caption && p.caption.length > 1024) return 'caption is too long';
  const rm = typeof p.reply_markup === 'string' ? JSON.parse(p.reply_markup) : p.reply_markup;
  for (const b of rm?.inline_keyboard?.flat() || []) {
    if (!b.text) return 'button text is empty';
    if (!b.callback_data || Buffer.byteLength(b.callback_data) > 64) return 'BUTTON_DATA_INVALID ' + b.callback_data;
  }
  for (const b of rm?.keyboard?.flat() || []) if (!b.text) return 'keyboard button text is empty';
  if (method === 'setMyCommands') for (const c of p.commands) if (!/^[a-z0-9_]{1,32}$/.test(c.command) || !c.description || c.description.length > 256) return 'bad command ' + c.command;
  return null;
}

