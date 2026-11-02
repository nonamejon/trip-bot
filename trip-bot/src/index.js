// Cloudflare Worker entry point.
//   POST /telegram         Telegram webhook (checked with WEBHOOK_SECRET)
//   GET  /setup?key=...    one-time: points the Telegram webhook at this Worker and sets the command list
//   GET  /cal/<token>.ics  the owner's calendar, for subscribing from a phone (link comes from the bot)
//   cron (every minute)    mock agent replies, trip checks, secretary reminders and the morning brief

import { run, esc } from './util.js';
import { COMMANDS, STRANGER, AL } from './i18n.js';
import { tg, send } from './telegram.js';
import { handleOwnerMessage, handleCallback, handleAgentMessage, runChecks, reportError, adminIds } from './flow.js';
import { runJobs } from './mock.js';
import { isMock } from './agent.js';
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
      const work = handleUpdate(env, update).catch((e) => reportError(env, e, 'update ' + update.update_id));
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

    const cal = url.pathname.match(/^\/cal\/([0-9a-f]{32})\.ics$/);
    if (cal && req.method === 'GET') {
      const ics = await calendarFeed(env, cal[1]);
      if (!ics) return new Response('not found', { status: 404 });
      return new Response(ics, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store' } });
    }

    return new Response('Trip bot is running.');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try { await runJobs(env); } catch (e) { await reportError(env, e, 'cron jobs'); }
      try { await runChecks(env); } catch (e) { await reportError(env, e, 'cron checks'); }
      try { await secretaryChecks(env); } catch (e) { await reportError(env, e, 'cron secretary'); }
    })());
  },
};

async function handleUpdate(env, update) {
  // Telegram may deliver the same update twice; handle each one once.
  const ins = await run(env, 'INSERT OR IGNORE INTO updates (update_id, ts) VALUES (?, ?)', update.update_id, Date.now());
  if (!ins.meta?.changes) return;

  if (update.callback_query) return handleCallback(env, update.callback_query);

  const msg = update.message;
  if (!msg || !msg.from || msg.from.is_bot) return;

  if (msg.chat.type === 'private') {
    const known = [env.OWNER_ID, ...adminIds(env)].filter(Boolean).map(String);
    if (!known.includes(String(msg.from.id))) {
      return send(env, msg.chat.id, STRANGER(esc(msg.from.id)));
    }
    return handleOwnerMessage(env, msg);
  }

  if (!isMock(env) && String(msg.chat.id) === String(env.AGENT_CHAT_ID)) return handleAgentMessage(env, msg);

  if (msg.text?.startsWith('/chatid')) return send(env, msg.chat.id, AL(env).chatId(esc(msg.chat.id)));
}
