// The mock travel agent. Only used when AGENT_MODE = "mock".
// It answers like a person would, after a delay, and its replies go through the exact same
// code path as a real agent's messages (handleAgentText / handleAgentDocs).

import { all, run, getTrip, localISODate, money, dshort, logEvent } from './util.js';
import { gemini } from './gemini.js';
import { handleAgentText, handleAgentDocs, templateText, reportError } from './flow.js';
import { mirror, isMock } from './agent.js';
import { tinyPdf } from './files.js';

export async function runJobs(env) {
  if (!isMock(env)) return;
  const jobs = await all(env, 'SELECT * FROM jobs WHERE done_at IS NULL AND due_at <= ? ORDER BY due_at LIMIT 5', Date.now());
  for (const j of jobs) {
    await run(env, 'UPDATE jobs SET done_at = ? WHERE id = ?', Date.now(), j.id); // claim first so a slow run never repeats it
    try { await runJob(env, j); } catch (e) { await reportError(env, e, 'mock agent ' + j.kind); }
  }
}

async function runJob(env, j) {
  const t = await getTrip(env, j.trip_id);
  if (!t) return;
  const payload = JSON.parse(j.payload || '{}');

  if (j.kind === 'mock_offers') {
    if (t.status !== 'sent') return;
    const gap = Math.random() < 0.5; // half the time the agent forgets a detail, like people do
    const text = await gemini(env, { prompt: offersPrompt(env, t, gap), temperature: 0.9 });
    return agentSays(env, t, text);
  }
  if (j.kind === 'mock_clarify') {
    if (t.status !== 'sent') return;
    const text = await gemini(env, {
      temperature: 0.6,
      prompt: `You are a travel agent in Tashkent chatting in Telegram. Earlier you sent these options:\n"""${t.agent_texts.join('\n\n')}"""\n\nYour client's assistant bot then asked:\n"""${payload.text}"""\n\nAnswer only what was asked, briefly, with plausible specific terms. Plain text, one to three lines, no greeting.`,
    });
    return agentSays(env, t, text);
  }
  if (j.kind === 'mock_book') {
    if (t.status !== 'chosen') return;
    const o = t.offers[t.chosen] || {};
    const f = t.fields;
    const ref = 'MOCK' + Math.random().toString(36).slice(2, 7).toUpperCase();
    const ticket = tinyPdf(['E-TICKET (TEST DOCUMENT, NOT VALID FOR TRAVEL)', '', `Trip ${t.code}   Booking ref ${ref}`, `Passenger: AZIZBEK`,
      `${f.origin || 'Tashkent'} -> ${f.destination}`, `Out: ${dshort(f.date_from)}  ${o.airline || ''}  ${o.outbound || ''}`, `Back: ${dshort(f.date_to)}  ${o.return || ''}`, `Total: ${money(o)}`]);
    const voucher = tinyPdf(['HOTEL VOUCHER (TEST DOCUMENT)', '', `Trip ${t.code}   Ref ${ref}`, `Hotel: ${o.hotel || '-'}`, `Check-in: ${dshort(f.date_from)}   Check-out: ${dshort(f.date_to)}`, `Guest: AZIZBEK`]);
    await mirror(env, t, 'Agent', 'Booked. Sending the ticket and the hotel voucher.');
    await logEvent(env, 'agent', 'mock_booked', t.id, ref);
    return handleAgentDocs(env, t, [
      { name: `Ticket_${t.code}.pdf`, bytes: ticket, mime: 'application/pdf' },
      { name: `Hotel_voucher_${t.code}.pdf`, bytes: voucher, mime: 'application/pdf' },
    ]);
  }
  if (j.kind === 'mock_cancel') return mirror(env, t, 'Agent', 'Cancelled. Any refund follows the fare rules; I will confirm the amount tomorrow.');
  if (j.kind === 'mock_note') return mirror(env, t, 'Agent', 'Noted, thank you.');
}

async function agentSays(env, t, text) {
  await mirror(env, t, 'Agent', text);
  return handleAgentText(env, t, text, []);
}

function offersPrompt(env, t, gap) {
  return `You are a travel agent in Tashkent. Today is ${localISODate(env)}. Your client's assistant bot posted this request in your Telegram group:

${templateText(t)}

Reply as a real agent would in Telegram: a one-line greeting, then 3 options numbered 1) 2) 3).
For each option: airline and flight number, departure date with local departure and arrival times, direct or the connection, the return flight date and time, the hotel name with stars and how far it is from where the client needs to be, the total price in USD for everything, and the cancellation terms.
Use airlines that actually fly this route from Tashkent and realistic prices. Make the three options differ in price, timing and flexibility.${gap ? '\nForget to mention the cancellation terms for option 2.' : ''}
Plain text, no markdown, under 150 words.`;
}
