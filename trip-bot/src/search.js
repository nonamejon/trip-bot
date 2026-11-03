// Search mode (AGENT_MODE = "search"): the bot finds flights and hotels itself, no travel agent.
//
// 1. Gemini with Google Search writes 3 real options as plain text, like an agent would (flights with numbers and
//    times, baggage, approximate price, terms, a hotel, booking URLs).
// 2. That text goes through the same parsing and comparison as an agent's reply (flow.handleAgentText).
// 3. Each option also gets links that always work: a live Google Flights search and a Booking.com search for the
//    exact dates. Prices from web search are approximate; the links show the live price.
//
// It runs as a cron job (jobs table, kind search_offers): a search takes 30-60 s, too long for the webhook.

import { run, getTrip, logEvent, strings, MIN } from './util.js';
import { gemini } from './gemini.js';
import { handleAgentText, reportError } from './flow.js';
import { send, kb } from './telegram.js';

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// ---------- links ----------
export const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\/[^\s"<>]+$/.test(u) && u.length < 1500 ? u : null);

export function googleFlightsUrl(f, o = {}) {
  const out = isDate(o.date_out) ? o.date_out : f.date_from;
  if (!isDate(out)) return null;
  const back = isDate(o.date_back) ? o.date_back : (f.one_way ? null : f.date_to);
  const q = `Flights from ${f.origin_en || 'Tashkent'} to ${f.destination_en || f.destination} on ${out}${isDate(back) ? ` through ${back}` : ' one way'}${f.travelers > 1 ? ` for ${f.travelers} adults` : ''}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&curr=USD`;
}

export function bookingComUrl(f, o = {}) {
  const inDate = isDate(o.date_out) ? o.date_out : f.date_from;
  const outDate = isDate(o.date_back) ? o.date_back : f.date_to;
  if (!isDate(inDate) || !isDate(outDate) || outDate <= inDate) return null;
  const p = new URLSearchParams({ ss: f.area_en || f.destination_en || f.destination, checkin: inDate, checkout: outDate, group_adults: String(f.travelers || 1), no_rooms: '1', selected_currency: 'USD' });
  return `https://www.booking.com/searchresults.html?${p}`;
}

// Queue a search (cron runs it within a minute). payload: { previous, note } for "other options" / a new wish.
export async function queueSearch(env, t, payload = {}) {
  await run(env, 'UPDATE jobs SET done_at = ? WHERE trip_id = ? AND done_at IS NULL', Date.now(), t.id);
  await run(env, 'INSERT INTO jobs (kind, trip_id, payload, due_at) VALUES (?, ?, ?, ?)', 'search_offers', t.id, JSON.stringify(payload), Date.now());
}

// ---------- the search ----------
function searchPrompt(env, t, payload) {
  const f = t.fields;
  const today = new Date(Date.now() + (Number(env.TZ_OFFSET_MIN) || 0) * 60e3).toISOString().slice(0, 10);
  const wantsHotel = !f.one_way && !/mehmonxona kerak emas|отель не нужен|no hotel/i.test(`${f.hotel || ''} ${f.notes || ''}`);
  return `You are a travel agent in Tashkent searching for your client. Today is ${today}. Use Google Search to find real, currently scheduled options.

The request (JSON): ${JSON.stringify({ from: f.origin, to: f.destination, date_from: f.date_from, date_to: f.date_to, flexible_dates: f.date_flex, one_way: !!f.one_way, travelers: f.travelers || 1, flight_wishes: f.flight_pref, baggage: f.baggage, hotel_wishes: f.hotel, budget: f.budget, notes: f.notes })}
${payload.note ? `His new wish: """${payload.note}"""` : ''}
${payload.previous ? `He has seen these options and wants different ones: ${payload.previous}` : ''}

Write 3 options numbered 1) 2) 3), making them differ (the cheapest, the best timing, the most comfortable). For each option:
- airline and flight numbers; exact dates and local departure and arrival times for the outbound${f.one_way ? '' : ' and the return'} flight; direct, or where the connection is;
- the baggage allowance of that fare;
- the approximate total price in USD for all travelers${wantsHotel ? ', flights and hotel separately' : ''} (say it is approximate);
- the usual change/refund terms of that fare;
- the URL of the airline's (or a booking site's) page for that flight;${wantsHotel ? `
- one hotel that fits his wishes: name, stars, how far it is from where he needs to be, approximate price per night in USD, and its official or booking URL;` : ''}
${f.date_flex || !f.date_from ? '- the dates are flexible: pick the cheapest suitable dates in his window and state them.' : ''}
Use only airlines that really fly this route and real hotels. Plain text, no markdown, under 300 words.`;
}

// Cron job: search, then hand the text to the normal parsing and comparison.
export async function runSearch(env, job) {
  const t = await getTrip(env, job.trip_id);
  if (!t || t.status !== 'sent') return;
  const payload = JSON.parse(job.payload || '{}');
  try {
    const text = await gemini(env, { prompt: searchPrompt(env, t, payload), tools: [{ google_search: {} }], temperature: 0.3, timeoutMs: 90000 });
    await logEvent(env, 'bot', 'search_done', t.id, text.slice(0, 300));
    t.agent_texts = []; // only this search's results are parsed
    await run(env, 'UPDATE trips SET agent_texts = ? WHERE id = ?', '[]', t.id);
    await handleAgentText(env, { ...t, agent_texts: [] }, text, []);
  } catch (e) {
    await reportError(env, e, 'search');
    const attempt = (payload.attempt || 0) + 1;
    if (attempt < 2) {
      await run(env, 'INSERT INTO jobs (kind, trip_id, payload, due_at) VALUES (?, ?, ?, ?)', 'search_offers', t.id, JSON.stringify({ ...payload, attempt }), Date.now() + MIN);
      return;
    }
    const { L } = await strings(env, t.owner_id);
    await send(env, t.owner_id, L.searchFailed, kb([[[L.btnRetrySearch, `sr:${t.id}`]]]));
  }
}
