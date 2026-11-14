// The mock travel agent. Only used when AGENT_MODE = "mock".
// It answers like a person would, after a delay, and its replies go through the exact same
// code path as a real agent's messages (handleAgentText / handleAgentDocs).
// It writes in AGENT_LANG; its test PDFs are in the owner's language.

import { all, run, claim, getTrip, localISODate, money, dshort, logEvent, strings } from './util.js';
import { gemini } from './gemini.js';
import { handleAgentText, handleAgentDocs, templateText, reportError } from './flow.js';
import { mirror, isMock, isSearch } from './agent.js';
import { runSearch } from './search.js';
import { tinyPdf } from './files.js';
import { AL } from './i18n.js';

// Delayed work: the mock agent's replies, and (search mode) flight and hotel searches.
export async function runJobs(env) {
  if (!isMock(env) && !isSearch(env)) return;
  const jobs = await all(env, 'SELECT * FROM jobs WHERE done_at IS NULL AND due_at <= ? ORDER BY due_at LIMIT 5', Date.now());
  for (const j of jobs) {
    // Claim first so a slow run never repeats it, and an overlapping cron run never takes the same job.
    if (!(await claim(env, 'UPDATE jobs SET done_at = ? WHERE id = ? AND done_at IS NULL', Date.now(), j.id))) continue;
    try { await runJob(env, j); } catch (e) { await reportError(env, e, 'mock agent ' + j.kind); }
  }
}

async function runJob(env, j) {
  if (j.kind === 'search_offers') return runSearch(env, j);
  const t = await getTrip(env, j.trip_id);
  if (!t) return;
  const payload = JSON.parse(j.payload || '{}');
  const A = AL(env);

  if (j.kind === 'mock_offers') {
    if (t.status !== 'sent') return;
    const gap = Math.random() < 0.5; // half the time the agent forgets a detail, like people do
    const text = await gemini(env, { prompt: offersPrompt(env, t, gap), temperature: 0.9, timeoutMs: 45000 }); // cron, not the 30 s webhook budget
    return agentSays(env, t, text);
  }
  if (j.kind === 'mock_clarify') {
    if (t.status !== 'sent') return;
    const text = await gemini(env, {
      temperature: 0.6, timeoutMs: 45000,
      prompt: `You are a travel agent in Tashkent chatting in Telegram. Earlier you sent these options:\n"""${t.agent_texts.join('\n\n')}"""\n\nYour client's assistant bot then asked:\n"""${payload.text}"""\n\nAnswer only what was asked, briefly, with plausible specific terms. Write in ${A.geminiLang}. Plain text, one to three lines, no greeting.`,
    });
    return agentSays(env, t, text);
  }
  if (j.kind === 'mock_book') {
    if (t.status !== 'chosen') return;
    const { lang, L } = await strings(env, t.owner_id);
    const P = L.pdf;
    const o = t.offers[t.chosen] || {};
    const f = t.fields;
    const ref = 'MOCK' + Math.random().toString(36).slice(2, 7).toUpperCase();
    const ticket = tinyPdf([P.ticket, '', `${t.code}   ${P.ref}: ${ref}`, `${P.passenger}: AZIZBEK`,
      `${f.origin || L.origin} -> ${f.destination}`, `${L.out}: ${dshort(f.date_from, lang)}  ${o.airline || ''}  ${o.outbound || ''}`, `${L.back}: ${dshort(f.date_to, lang)}  ${o.return || ''}`, `${L.total}: ${money(o, lang)}`]);
    const voucher = tinyPdf([P.voucher, '', `${t.code}   ${P.ref}: ${ref}`, `${L.hotel}: ${o.hotel || '-'}`, `${P.checkIn}: ${dshort(f.date_from, lang)}   ${P.checkOut}: ${dshort(f.date_to, lang)}`, `${P.guest}: AZIZBEK`]);
    await mirror(env, t, 'agent', A.mockBooked);
    await logEvent(env, 'agent', 'mock_booked', t.id, ref);
    return handleAgentDocs(env, t, [
      { name: `${P.ticketFile}_${t.code}.pdf`, bytes: ticket, mime: 'application/pdf' },
      { name: `${P.voucherFile}_${t.code}.pdf`, bytes: voucher, mime: 'application/pdf' },
    ]);
  }
  if (j.kind === 'mock_cancel') return mirror(env, t, 'agent', A.mockCancelled);
  if (j.kind === 'mock_note') return mirror(env, t, 'agent', A.mockNoted);
}

async function agentSays(env, t, text) {
  await mirror(env, t, 'agent', text);
  return handleAgentText(env, t, text, []);
}

function offersPrompt(env, t, gap) {
  return `You are a travel agent in Tashkent. Today is ${localISODate(env)}. Your client's assistant bot posted this request in your Telegram group:

${templateText(env, t)}

Reply as a real agent would in Telegram, in ${AL(env).geminiLang}: a one-line greeting, then 3 options numbered 1) 2) 3).
For each option: airline and flight number, departure date with local departure and arrival times, direct or the connection, the return flight date and time, the hotel name with stars and how far it is from where the client needs to be, the baggage allowance of the fare, the total price in USD for everything, and the cancellation terms.
Use airlines that actually fly this route from Tashkent and realistic prices. Make the three options differ in price, timing and flexibility.${gap ? '\nForget to mention the cancellation terms for option 2.' : ''}
Plain text, no markdown, under 150 words.`;
}
