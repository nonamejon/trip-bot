// Cloudflare Worker entry point.
//   POST /telegram         Telegram webhook (checked with WEBHOOK_SECRET)
//   GET  /setup?key=...    one-time: points the Telegram webhook at this Worker and sets the command list
//   cron (every minute)    mock agent replies, reminders, agent-late checks

import { run, esc } from './util.js';
import { tg, send } from './telegram.js';
import { handleOwnerMessage, handleCallback, handleAgentMessage, runChecks, reportError } from './flow.js';
import { runJobs } from './mock.js';
import { isMock } from './agent.js';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (req.method === 'POST' && url.pathname === '/telegram') {
      if (!env.WEBHOOK_SECRET || req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      const update = await req.json();
      // Answer Telegram at once; do the slow work (Gemini, database) after the response.
      ctx.waitUntil(handleUpdate(env, update).catch((e) => reportError(env, e, 'update ' + update.update_id)));
      return new Response('ok');
    }

    if (url.pathname === '/setup') {
      if (!env.WEBHOOK_SECRET || url.searchParams.get('key') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      const hook = await tg(env, 'setWebhook', {
        url: `${url.origin}/telegram`, secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
      });
      await tg(env, 'setMyCommands', {
        commands: [
          { command: 'status', description: 'Where the current trip stands' },
          { command: 'trips', description: 'My trips' },
          { command: 'passport', description: 'Save passport details (encrypted)' },
          { command: 'cancel', description: 'Cancel the current trip' },
          { command: 'help', description: 'How to use the assistant' },
        ],
      });
      const me = await tg(env, 'getMe');
      return Response.json({ webhook_set: hook, bot: '@' + me.username, agent_mode: isMock(env) ? 'mock' : 'group' });
    }

    return new Response('Trip bot is running.');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try { await runJobs(env); } catch (e) { await reportError(env, e, 'cron jobs'); }
      try { await runChecks(env); } catch (e) { await reportError(env, e, 'cron checks'); }
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
    const known = [env.OWNER_ID, env.ADMIN_ID].filter(Boolean).map(String);
    if (!known.includes(String(msg.from.id))) {
      return send(env, msg.chat.id, `This is a private assistant.\nYour Telegram ID is <code>${esc(msg.from.id)}</code> — put it in OWNER_ID if this bot is meant for you.`);
    }
    return handleOwnerMessage(env, msg);
  }

  if (!isMock(env) && String(msg.chat.id) === String(env.AGENT_CHAT_ID)) return handleAgentMessage(env, msg);

  if (msg.text?.startsWith('/chatid')) return send(env, msg.chat.id, `This chat's ID is <code>${esc(msg.chat.id)}</code> — put it in AGENT_CHAT_ID.`);
}
