// Search mode (AGENT_MODE = "search"): the bot finds flights and hotels itself, no travel agent.
//
// 1. Gemini with Google Search writes 3 real options as plain text, like an agent would (flights with numbers and
//    times, baggage, approximate price, terms, a hotel, booking URLs).
// 2. That text goes through the same parsing and comparison as an agent's reply (flow.handleAgentText).
// 3. With TRAVELPAYOUTS_TOKEN the flights come from real Aviasales fares (aviasales.js). Each option links to an
//    Aviasales search and a Booking.com search for its exact dates; the links show the live price.
//
// It runs as a cron job (jobs table, kind search_offers): a search takes 30-60 s, too long for the webhook.

import { run, one, getTrip, logEvent, strings, MIN } from './util.js';
import { gemini } from './gemini.js';
import { handleAgentText, reportError } from './flow.js';
import { send, kb } from './telegram.js';
import { fetchFares } from './aviasales.js';

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// ---------- links ----------
export const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\/[^\s"<>]+$/.test(u) && u.length < 1500 ? u : null);

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
// fares: real Aviasales fares (fetchFares), or [] when the Travelpayouts token is not set.
export function searchPrompt(env, t, payload, fares = []) {
  const f = t.fields;
  const today = new Date(Date.now() + (Number(env.TZ_OFFSET_MIN) || 0) * 60e3).toISOString().slice(0, 10);
  // No return date and no flexible window: one-way flights. A hotel is still offered (priced per night) unless he
  // said he wants a one-way ticket only or no hotel.
  const oneWay = !!f.one_way || (!isDate(f.date_to) && !f.date_flex && isDate(f.date_from));
  const wantsHotel = !f.one_way && !/mehmonxona kerak emas|отель не нужен|no hotel/i.test(`${f.hotel || ''} ${f.notes || ''}`);
  return `You are a travel agent in Tashkent searching for your client. Today is ${today}. Use Google Search to find real, currently scheduled options.

The request (JSON): ${JSON.stringify({ from: f.origin, to: f.destination, date_from: f.date_from, date_to: f.date_to, flexible_dates: f.date_flex, one_way: oneWay, travelers: f.travelers || 1, flight_wishes: f.flight_pref, baggage: f.baggage, hotel_wishes: f.hotel, budget: f.budget, notes: f.notes })}
${payload.note ? `His new wish: """${payload.note}"""` : ''}
${payload.previous ? `He has seen these options and wants different ones: ${payload.previous}` : ''}

${fares.length ? `Real fares found on Aviasales for this request (JSON; times local; "price" is USD per person, "price_total" is USD for all ${f.travelers || 1} traveler(s)): ${JSON.stringify(fares)}
Build the flight options from these fares: use exactly their flights and times, "price_total" as the flight price, and each fare's "link" as its booking URL. Use Google Search to add details (airline name, baggage allowance, fare rules), the hotels, and real alternatives when the fares hold fewer than 3 different flights.
` : ''}Write up to 3 options numbered 1) 2) 3) that are really different flights (another airline, departure time, routing or date): the cheapest, the best timing, the most comfortable. Never repeat the same flight to fill the list.
- If there are fewer than 3 different flights for his date, add real alternatives you find: another airline, a connection, or a day or two earlier or later (state its date; its price is approximate).
- If fewer real options exist, give only those, even just one. With a single flight, give one option with the best-fitting hotel and name up to two other hotels in the note.
- Whenever the request does not fit this format, use your judgement and adapt rather than force it: no invented flights, no padding.
- Start with one line "Note: ..." if he should know something about the options as a whole (only one airline flies this route that day, a nearby day is much cheaper, what you adapted and why); leave it out otherwise.
For each option:
- airline and flight numbers; exact dates and local departure and arrival times for the outbound${oneWay ? '' : ' and the return'} flight; direct, or where the connection is;
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
    let fares = [];
    try { fares = await fetchFares(env, t.fields); } catch (e) { await reportError(env, e, 'aviasales'); }
    t.fields.price_source = fares.length ? 'aviasales' : 'web';
    const text = await gemini(env, { prompt: searchPrompt(env, t, payload, fares), tools: [{ google_search: {} }], temperature: 0.3, timeoutMs: 90000 });
    await logEvent(env, 'bot', 'search_done', t.id, text.slice(0, 300));
    t.agent_texts = []; // only this search's results are parsed
    await handleAgentText(env, { ...t, agent_texts: [] }, text, []); // saves t.fields (price_source) with the offers
  } catch (e) {
    if (e.stale) return reportError(env, e, 'search'); // he cancelled, booked or searched again meanwhile
    await reportError(env, e, 'search');
    // Still waiting for this search? (not cancelled or searched again meanwhile)
    const cur = await one(env, 'SELECT status, sent_at FROM trips WHERE id = ?', t.id);
    if (!cur || cur.status !== 'sent' || cur.sent_at !== t.sent_at) return;
    const attempt = (payload.attempt || 0) + 1;
    if (attempt < (/location is not supported/i.test(String(e?.message)) ? 4 : 2)) { // a refused location: try from elsewhere
      await run(env, 'INSERT INTO jobs (kind, trip_id, payload, due_at) VALUES (?, ?, ?, ?)', 'search_offers', t.id, JSON.stringify({ ...payload, attempt }), Date.now() + MIN);
      return;
    }
    const { L } = await strings(env, t.owner_id);
    await send(env, t.owner_id, L.searchFailed, kb([[[L.btnRetrySearch, `sr:${t.id}`]]]));
  }
}
