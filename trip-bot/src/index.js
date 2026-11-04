// Cloudflare Worker entry point.
//   POST /telegram         Telegram webhook (checked with WEBHOOK_SECRET)
//   GET  /setup?key=...    one-time: points the Telegram webhook at this Worker and sets the command list
//   GET  /cal/<user id>/<token>.ics  a user's calendar, for subscribing from a phone (link comes from the bot)
//   cron (every minute)    mock agent replies, trip checks, secretary reminders and the morning brief

import { run, esc, strings, isUser, loadMembers } from './util.js';
import { COMMANDS, STRANGER, AL } from './i18n.js';
import { tg, send } from './telegram.js';
import { handleOwnerMessage, handleCallback, handleAgentMessage, runChecks, reportError, notifyStranger } from './flow.js';
import { runJobs } from './mock.js';
import { agentMode } from './agent.js';
import { calendarFeed, secretaryChecks } from './secretary.js';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (req.method === 'POST' && url.pathname === '/telegram') {
      if (!env.WEBHOOK_SECRET || req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      const update = await req.json();
      // Work on the update while Telegram waits, up to 25 s; if it takes longer, answer Telegram and finish in the
      // background (waitUntil gives about 30 s more). Slow Gemini steps get ~55 s in total this way.
      // A retried delivery of the same update is ignored (updates table).
      // Never silent: if handling fails, the owner gets an apology at once; if it is cut off (time limit), the cron
      // watchdog (flow.runChecks) notices the unfinished update and apologizes.
      const work = handleUpdate(env, update)
        .then(() => true, async (e) => {
          if (e.duplicate) return false; // a repeated delivery of an update already being handled
          await reportError(env, e, 'update ' + update.update_id);
          await apologize(env, update);
          return true;
        })
        .then((mine) => mine && run(env, 'UPDATE updates SET done_at = ? WHERE update_id = ?', Date.now(), update.update_id).catch(() => {}));
      ctx.waitUntil(work);
      await Promise.race([work, new Promise((res) => setTimeout(res, 25000))]);
      return new Response('ok');
    }

    if (url.pathname === '/setup') {
      if (!env.WEBHOOK_SECRET || url.searchParams.get('key') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      const hook = await tg(env, 'setWebhook', {
        url: `${url.origin}/telegram`, secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
      });
      // Default menu in Uzbek, Russian for Russian-language Telegram apps; after /uz or /ru each chat gets its own.
      await tg(env, 'setMyCommands', { commands: COMMANDS.uz });
      await tg(env, 'setMyCommands', { commands: COMMANDS.ru, language_code: 'ru' });
      const me = await tg(env, 'getMe');
      return Response.json({ webhook_set: hook, bot: '@' + me.username, agent_mode: isMock(env) ? 'mock' : 'group' });
    }

    // /cal/<user id>/<token>.ics; the older /cal/<token>.ics is the owner's
    const cal = url.pathname.match(/^\/cal\/(?:(\d+)\/)?([0-9a-f]{32})\.ics$/);
    if (cal && req.method === 'GET') {
      await loadMembers(env);
      const ics = await calendarFeed(env, cal[1] || env.OWNER_ID, cal[2]);
      if (!ics) return new Response('not found', { status: 404 });
      return new Response(ics, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store' } });
    }

    return new Response('Trip bot is running.');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await loadMembers(env);
      try { await runJobs(env); } catch (e) { await reportError(env, e, 'cron jobs'); }
      try { await runChecks(env); } catch (e) { await reportError(env, e, 'cron checks'); }
      try { await secretaryChecks(env); } catch (e) { await reportError(env, e, 'cron secretary'); }
    })());
  },
};

async function handleUpdate(env, update) {
  await loadMembers(env);
  // Telegram may deliver the same update twice; handle each one once.
  const chat = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  const ownerChat = isUser(env, chat) ? chat : null; // users' chats are watched by the watchdog
  const ins = await run(env, 'INSERT OR IGNORE INTO updates (update_id, ts, chat_id) VALUES (?, ?, ?)', update.update_id, Date.now(), ownerChat);
  if (!ins.meta?.changes) throw Object.assign(new Error('duplicate'), { duplicate: true });

  if (update.callback_query) return handleCallback(env, update.callback_query);

  const msg = update.message;
  if (!msg || !msg.from || msg.from.is_bot) return;

  if (msg.chat.type === 'private') {
    if (!isUser(env, msg.from.id)) {
      await send(env, msg.chat.id, STRANGER(esc(msg.from.id)));
      return notifyStranger(env, msg.from); // the owner can give access with one tap
    }
    return handleOwnerMessage(env, msg);
  }

  if (agentMode(env) === 'group' && String(msg.chat.id) === String(env.AGENT_CHAT_ID)) return handleAgentMessage(env, msg);

  if (msg.text?.startsWith('/chatid')) return send(env, msg.chat.id, AL(env).chatId(esc(msg.chat.id)));
}

// Tell the owner something went wrong with his message (instead of silence).
async function apologize(env, update) {
  const chat = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  if (!isUser(env, chat)) return;
  try { const { L } = await strings(env, chat); await send(env, chat, L.sorryError); } catch { /* nothing else to do */ }
}
