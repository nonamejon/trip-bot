// Aviasales: what people in Uzbekistan use to find flights.
//
// - aviasalesUrl: a search link for the exact route, dates and passengers. Always works, no account needed.
//   Format: /search/<FROM><DDMM><TO>[<DDMM back>]<adults>, e.g. TAS1211IST15111 = TAS 12 Nov -> IST, back 15 Nov, 1 adult.
// - fetchFares: real fares from the Travelpayouts Data API (Aviasales' cache of recent user searches; prices are
//   usually hours old, the link opens the live price). Only when TRAVELPAYOUTS_TOKEN is set; otherwise [].
//   TRAVELPAYOUTS_MARKER (optional) is added to links so bookings earn the affiliate commission.

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const iata = (s) => (/^[A-Z]{3}$/.test(String(s || '').toUpperCase()) ? String(s).toUpperCase() : null);
const ddmm = (iso) => iso.slice(8, 10) + iso.slice(5, 7);
const host = (env) => String(env.AVIASALES_HOST || 'https://www.aviasales.uz').replace(/\/$/, '');
const withMarker = (env, url) => (env.TRAVELPAYOUTS_MARKER ? `${url}${url.includes('?') ? '&' : '?'}marker=${encodeURIComponent(env.TRAVELPAYOUTS_MARKER)}` : url);

// f: trip fields; o: an option with date_out/date_back (search results), else the trip's own dates.
export function aviasalesUrl(env, f, o = {}) {
  const from = iata(f.origin_iata) || 'TAS', to = iata(f.destination_iata);
  const out = isDate(o.date_out) ? o.date_out : f.date_from;
  if (!to || !isDate(out)) return null;
  const back = isDate(o.date_back) ? o.date_back : (f.one_way ? null : f.date_to);
  const adults = Math.min(Math.max(Number(f.travelers) || 1, 1), 9);
  return withMarker(env, `${host(env)}/search/${from}${ddmm(out)}${to}${isDate(back) ? ddmm(back) : ''}${adults}`);
}

// Real fares for the request: the cheapest, with direct flights preferred when he asked for them. Each fare:
// { airline, flight_number, depart (local "YYYY-MM-DDTHH:MM"), back, transfers, back_transfers, duration_min, price, currency, link }
export async function fetchFares(env, f) {
  const token = env.TRAVELPAYOUTS_TOKEN;
  const from = iata(f.origin_iata) || 'TAS', to = iata(f.destination_iata);
  if (!token || !to) return [];
  const flexible = !isDate(f.date_from) && isDate(f.window_from);
  if (!flexible && !isDate(f.date_from)) return [];
  const oneWay = !!f.one_way || (!flexible && !isDate(f.date_to));
  const query = async (out, back) => {
    const q = new URLSearchParams({
      origin: from, destination: to, departure_at: out, currency: 'usd', sorting: 'price', unique: 'false', limit: '30', page: '1',
      one_way: String(oneWay), direct: 'false', token,
    });
    if (back && !oneWay) q.set('return_at', back);
    const r = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${q}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Aviasales HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).data || [];
  };
  const month = (iso) => iso.slice(0, 7);
  let data;
  if (flexible) data = await query(month(f.window_from), month(f.window_to || f.window_from));
  else {
    data = await query(f.date_from, f.date_to);
    // The cache has no fare for the exact dates: take the month and keep the closest dates (within 3 days each way).
    if (!data.length) {
      const near = (a, b) => Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b)) / 864e5;
      data = (await query(month(f.date_from), oneWay ? null : month(f.date_to)))
        .filter((d) => near(d.departure_at, f.date_from) <= 3 && (oneWay || !d.return_at || near(d.return_at, f.date_to) <= 3))
        .sort((a, b) => near(a.departure_at, f.date_from) - near(b.departure_at, f.date_from) || a.price - b.price);
    }
  }
  let fares = data.map((d) => ({
    airline: d.airline, flight_number: d.flight_number ? `${d.airline} ${d.flight_number}` : null,
    depart: String(d.departure_at || '').slice(0, 16), back: d.return_at ? String(d.return_at).slice(0, 16) : null,
    transfers: d.transfers ?? null, back_transfers: d.return_transfers ?? null, duration_min: d.duration_to || d.duration || null,
    price: d.price, currency: 'USD', link: d.link ? withMarker(env, `${host(env)}${d.link}`) : null,
  }));
  // A flexible window: keep fares inside it.
  if (flexible) fares = fares.filter((x) => x.depart.slice(0, 10) >= f.window_from && (!f.window_to || (x.back || x.depart).slice(0, 10) <= f.window_to));
  return fares.slice(0, 12);
}
