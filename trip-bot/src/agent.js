// The channel to the travel agent. Two modes:
//   group: messages go to a real Telegram group (AGENT_CHAT_ID). A person answers there.
//   mock:  nothing goes out. A delayed job makes a fake agent answer (see mock.js),
//          and the conversation is mirrored into the owner's chat so you can follow it.

import { run, esc, logEvent, saveTrip, MIN } from './util.js';
import { send, tg } from './telegram.js';

export const isMock = (env) => (env.AGENT_MODE || 'mock') !== 'group';

export async function mirror(env, t, who, text) {
  if (!isMock(env) || env.MOCK_MIRROR === 'false') return;
  await send(env, t.owner_id, `<i>[Agent group · ${t.code}] ${esc(who)}:</i>\n${esc(text)}`).catch(() => {});
}

export async function openAgentThread(env, t) {
  if (isMock(env) || env.AGENT_TOPICS !== 'true' || t.agent_thread_id) return;
  try {
    const topic = await tg(env, 'createForumTopic', { chat_id: env.AGENT_CHAT_ID, name: `${t.code} · ${t.fields.destination}`.slice(0, 128) });
    t.agent_thread_id = topic.message_thread_id;
    await saveTrip(env, t);
  } catch (e) {
    await logEvent(env, 'bot', 'topic_failed', t.id, e.message); // falls back to posting in the main chat
  }
}

// kind: request | clarify | choice | passport | other | cancel | note | sla | ack
export async function toAgent(env, t, text, kind) {
  await logEvent(env, 'bot', 'to_agent:' + kind, t.id, kind === 'passport' ? '(passport details, not logged)' : text);
  if (!isMock(env)) {
    if (!env.AGENT_CHAT_ID) throw new Error('AGENT_MODE is "group" but AGENT_CHAT_ID is empty');
    await send(env, env.AGENT_CHAT_ID, esc(text), t.agent_thread_id ? { message_thread_id: t.agent_thread_id } : {});
    return;
  }
  await mirror(env, t, 'Bot → agent', kind === 'passport' ? '(passport details sent to the agent, hidden here)' : text);
  const d = Number(env.MOCK_DELAY_MIN) || 2;
  const plan = { request: ['mock_offers', d], other: ['mock_offers', d], clarify: ['mock_clarify', 1], choice: ['mock_book', d], cancel: ['mock_cancel', 1], note: ['mock_note', 1] }[kind];
  if (plan) {
    await run(env, 'INSERT INTO jobs (kind, trip_id, payload, due_at) VALUES (?, ?, ?, ?)', plan[0], t.id, JSON.stringify({ text }), Date.now() + plan[1] * MIN);
  }
}
