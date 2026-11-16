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
// { airline, flight_number, depart (local "YYYY-MM-DDTHH:MM"), back, transfers, back_transfers, duration_min,
//   price (per person, as Aviasales gives it), travelers, price_total (all travelers), currency, link (one adult) }
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
      one_way: String(oneWay), direct: 'false',
    });
    if (back && !oneWay) q.set('return_at', back);
    // The token goes in a header (not the URL), so it never shows up in logs of the request.
    const r = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${q}`, { headers: { 'X-Access-Token': token }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Aviasales HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).data || [];
  };
  const month = (iso) => iso.slice(0, 7);
  let data;
  if (flexible) data = await query(month(f.window_from), month(f.window_to || f.window_from));
  else {
    data = await query(f.date_from, f.date_to);
    // Fewer than 3 different flights on the exact dates (often just one): add the closest dates in that month
    // (within 3 days each way) as alternatives, after the exact-date fares.
    const flightKey = (d) => `${d.airline}${d.flight_number}${String(d.departure_at).slice(0, 16)}`;
    if (new Set(data.map(flightKey)).size < 3) {
      const near = (a, b) => Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b)) / 864e5;
      const seen = new Set(data.map(flightKey));
      const more = (await query(month(f.date_from), oneWay ? null : month(f.date_to)).catch(() => []))
        .filter((d) => near(d.departure_at, f.date_from) <= 3 && (oneWay || !d.return_at || near(d.return_at, f.date_to) <= 3) && !seen.has(flightKey(d)))
        .sort((a, b) => near(a.departure_at, f.date_from) - near(b.departure_at, f.date_from) || a.price - b.price);
      data = [...data, ...more];
    }
  }
  const n = Math.min(Math.max(Number(f.travelers) || 1, 1), 9);
  let fares = data.map((d) => ({
    airline: d.airline, flight_number: d.flight_number ? `${d.airline} ${d.flight_number}` : null,
    depart: String(d.departure_at || '').slice(0, 16), back: d.return_at ? String(d.return_at).slice(0, 16) : null,
    depart_offset: String(d.departure_at || '').slice(19) || null, back_offset: d.return_at ? String(d.return_at).slice(19) || null : null,
    transfers: d.transfers ?? null, back_transfers: d.return_transfers ?? null, duration_min: d.duration_to || d.duration || null, back_duration_min: d.duration_back || null,
    price: d.price, travelers: n, price_total: d.price != null ? Math.round(d.price * n) : null, currency: 'USD', link: d.link ? withMarker(env, `${host(env)}${d.link}`) : null,
  }));
  // A flexible window: keep fares inside it.
  if (flexible) fares = fares.filter((x) => x.depart.slice(0, 10) >= f.window_from && (!f.window_to || (x.back || x.depart).slice(0, 10) <= f.window_to));
  return fares.slice(0, 30);
}

// ---------- options built from real fares only ----------
// Every value shown comes from the Aviasales data: airline, flight number, dates, times, stops, time in the air,
// price. Nothing is guessed (no baggage or refund terms: they differ per fare and are shown on Aviasales).

const AIRLINES = {
  HY: 'Uzbekistan Airways', C6: 'Centrum Air', HH: 'Qanot Sharq', TK: 'Turkish Airlines', PC: 'Pegasus', VF: 'AJet',
  FZ: 'flydubai', EK: 'Emirates', EY: 'Etihad', QR: 'Qatar Airways', G9: 'Air Arabia', KC: 'Air Astana', DV: 'SCAT',
  SU: 'Aeroflot', S7: 'S7 Airlines', U6: 'Ural Airlines', DP: 'Pobeda', MU: 'China Eastern', CZ: 'China Southern',
  CA: 'Air China', HU: 'Hainan Airlines', '3U': 'Sichuan Airlines', MF: 'Xiamen Airlines', KE: 'Korean Air',
  OZ: 'Asiana', LH: 'Lufthansa', LO: 'LOT', AZ: 'ITA Airways', W6: 'Wizz Air', J2: 'Azerbaijan Airlines',
  A3: 'Aegean', PS: 'UIA', B2: 'Belavia', ZM: 'Air Manas', '6E': 'IndiGo', AI: 'Air India', TG: 'Thai Airways',
  SQ: 'Singapore Airlines', MH: 'Malaysia Airlines', GF: 'Gulf Air', WY: 'Oman Air', SV: 'Saudia', XY: 'flynas',
  J9: 'Jazeera Airways', KU: 'Kuwait Airways', AF: 'Air France', KL: 'KLM', BA: 'British Airways',
  FV: 'Rossiya', UT: 'UTair', N4: 'Nordwind', ZF: 'Azur Air', '5N': 'Smartavia', YK: 'Avia Traffic', QH: 'Bamboo Airways',
  JL: 'Japan Airlines', NH: 'ANA', CX: 'Cathay Pacific', ZH: 'Shenzhen Airlines', SC: 'Shandong Airlines', GS: 'Tianjin Airlines',
  JD: 'Beijing Capital Airlines', '9C': 'Spring Airlines', HO: 'Juneyao Air', KA: 'Cathay Dragon', VN: 'Vietnam Airlines',
  OS: 'Austrian', LX: 'SWISS', SN: 'Brussels Airlines', IB: 'Iberia', TP: 'TAP', PK: 'PIA', RJ: 'Royal Jordanian', MS: 'EgyptAir',
  T5: 'Turkmenistan Airlines', Z9: 'Aero Nomad', IQ: 'Qazaq Air', FS: 'FlyArystan', '4L': 'Georgian Airways', A9: 'Georgian Airways',
};
export const airlineName = (code) => AIRLINES[code] || null; // unknown code: only the flight number is shown

// Time zones of common destinations (IATA city or airport code), for the arrival time of a one-way flight (a round
// trip gets it from the return fare). Unknown cities fall back to Tashkent time.
const CITY_TZ = {
  'Asia/Shanghai': 'BJS PEK PKX SHA PVG CAN SZX CTU TFU XIY URC YIW HRB CKG KMG HGH NKG WUH TAO DLC XMN CSX TSN SHE HAK SYX',
  'Asia/Hong_Kong': 'HKG', 'Europe/Istanbul': 'IST SAW AYT ESB ADB BJV DLM', 'Asia/Dubai': 'DXB DWC AUH SHJ RKT',
  'Europe/Moscow': 'MOW SVO DME VKO ZIA LED KZN AER MRV ROV KRR UFA', 'Asia/Yekaterinburg': 'SVX', 'Asia/Novosibirsk': 'OVB',
  'Asia/Seoul': 'SEL ICN GMP PUS', 'Asia/Tokyo': 'TYO NRT HND KIX OSA', 'Asia/Kolkata': 'DEL BOM BLR MAA', 'Asia/Bangkok': 'BKK DMK HKT',
  'Asia/Almaty': 'ALA NQZ TSE CIT', 'Asia/Bishkek': 'FRU OSS', 'Asia/Dushanbe': 'DYU', 'Asia/Ashgabat': 'ASB', 'Asia/Baku': 'GYD BAK',
  'Asia/Tbilisi': 'TBS BUS', 'Asia/Yerevan': 'EVN', 'Asia/Riyadh': 'JED RUH MED DMM', 'Asia/Qatar': 'DOH', 'Asia/Kuwait': 'KWI',
  'Asia/Bahrain': 'BAH', 'Asia/Muscat': 'MCT', 'Asia/Kuala_Lumpur': 'KUL', 'Asia/Singapore': 'SIN', 'Asia/Jakarta': 'CGK', 'Asia/Makassar': 'DPS',
  'Asia/Ho_Chi_Minh': 'SGN HAN', 'Asia/Karachi': 'KHI LHE ISB', 'Asia/Tehran': 'IKA THR', 'Africa/Cairo': 'CAI SSH HRG',
  'Europe/Berlin': 'BER FRA MUC DUS HAM CGN STR', 'Europe/Paris': 'PAR CDG ORY NCE', 'Europe/London': 'LON LHR LGW STN',
  'Europe/Rome': 'ROM FCO MIL MXP', 'Europe/Madrid': 'MAD BCN', 'Europe/Amsterdam': 'AMS', 'Europe/Vienna': 'VIE', 'Europe/Prague': 'PRG',
  'Europe/Warsaw': 'WAW', 'Europe/Riga': 'RIX', 'Europe/Minsk': 'MSQ', 'Europe/Athens': 'ATH', 'Europe/Budapest': 'BUD', 'Europe/Zurich': 'ZRH GVA',
  'America/New_York': 'NYC JFK EWR', 'Asia/Tashkent': 'TAS SKD BHK UGC NMA FEG TMJ NCU',
};
const TZ_OF = Object.fromEntries(Object.entries(CITY_TZ).flatMap(([z, codes]) => codes.split(' ').map((c) => [c, z])));
// Minutes ahead of UTC at a place on a day, from its IANA zone (handles daylight saving).
function zoneOffsetMin(zone, iso) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(Date.parse(iso.slice(0, 10) + 'T12:00:00Z'))).map((x) => [x.type, x.value]));
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Date.parse(iso.slice(0, 10) + 'T12:00:00Z')) / 60e3;
  } catch { return null; }
}

const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
const offsetMin = (o) => (/^[+-]\d\d:\d\d$/.test(o || '') ? (o[0] === '-' ? -1 : 1) * (+o.slice(1, 3) * 60 + +o.slice(4, 6)) : null);
const addMinutesLocal = (local, min) => new Date(Date.parse(local + ':00Z') + min * 60e3).toISOString().slice(0, 16);

// f: trip fields; fares: fetchFares(); W: { L, lang, dshort }. Returns { offers, recommended, why, note } (offers may be []).
// Exact dates: only fares on his dates; if there are none, the closest dates (and the note says so).
export function buildOptions(env, f, fares, W) {
  const { L, lang, dshort } = W;
  const exact = isDate(f.date_from);
  const all0 = fares.filter((x) => isDate(x.depart.slice(0, 10)));
  // One per outbound flight (its cheapest fare, so the cheapest return with it), cheapest first.
  const uniq = (list) => {
    const m = new Map();
    for (const x of [...list].sort((a, b) => a.price_total - b.price_total)) { const k = `${x.flight_number || x.airline}|${x.depart}`; if (!m.has(k)) m.set(k, x); }
    return [...m.values()];
  };
  // Up to n: the cheapest, the one with the fewest stops, then the next cheapest.
  const choose = (list, n) => {
    if (!list.length || n <= 0) return [];
    const p = [list[0]];
    const fewest = [...list].sort((a, b) => (a.transfers ?? 9) - (b.transfers ?? 9) || a.price_total - b.price_total)[0];
    if (p.length < n && !p.includes(fewest)) p.push(fewest);
    for (const x of list) { if (p.length >= n) break; if (!p.includes(x)) p.push(x); }
    return p.sort((a, b) => a.price_total - b.price_total);
  };
  const outDiff = (x) => Math.abs(dayDiff(x.depart.slice(0, 10), f.date_from));
  const backDiff = (x) => (x.back && isDate(f.date_to) && !f.one_way ? Math.abs(dayDiff(x.back.slice(0, 10), f.date_to)) : 0);
  let pick, note = null;
  if (exact) {
    // His dates first. Fewer than 3 flights on them: add the nearest days (up to 2 days off each way), each
    // marked with its date, and the note says so.
    const d = dshort(f.date_from, lang);
    pick = choose(uniq(all0.filter((x) => outDiff(x) === 0 && backDiff(x) === 0)), 3);
    if (pick.length < 3) {
      const near = uniq(all0.filter((x) => outDiff(x) + backDiff(x) > 0 && outDiff(x) <= 2 && backDiff(x) <= 2))
        .sort((a, b) => outDiff(a) + backDiff(a) - outDiff(b) - backDiff(b) || a.price_total - b.price_total)
        .slice(0, 3 - pick.length);
      note = near.length ? (pick.length ? L.addedNearNote(d, pick.length) : L.nearDatesNote(d)) : (pick.length ? L.fewFaresNote(d) : null);
      pick = [...pick, ...near];
    }
  } else pick = choose(uniq(all0), 3);
  if (!pick.length) return { offers: [], recommended: null, why: null, note: null };

  // His wishes: a direct flight, a time of day.
  const wish = `${f.flight_pref || ''} ${f.notes || ''}`.toLowerCase();
  const wantsDirect = /to[ʻ'`’]?g[ʻ'`’]?ri|прям|direct|без пересад/.test(wish);
  const hourOk = (h) => (/ertalab|утр|morning/.test(wish) ? h >= 5 && h < 12 : /kechqurun|вечер|evening/.test(wish) ? h >= 17 : /tush|днём|днем|afternoon/.test(wish) ? h >= 12 && h < 17 : true);
  const score = (x) => (x.transfers || 0) * (wantsDirect ? 1000 : 120) + (hourOk(+x.depart.slice(11, 13)) ? 0 : 150) + x.price_total;
  const recommended = pick.indexOf([...pick].sort((a, b) => score(a) - score(b))[0]);
  const r = pick[recommended];
  const why = r.transfers === 0 ? (r === pick[0] ? L.whyCheapDirect : L.whyDirect) : (r === pick[0] ? L.whyCheapest : L.whyFewStops);

  const stopsText = (n) => (n === 0 ? L.nonstop : n > 0 ? L.stopsN(n) : null);
  // Hotel nights: check-in on the arrival day (a small-hours arrival books the night before, so the room is ready);
  // check-out on the return day, or one night when there is no return date yet (stay_assumed: the card says so).
  const stay = (x, outDate, backDate) => {
    // The destination's UTC offset: from the return fare, else from the city's time zone, else Tashkent's (unknown city).
    const destZone = TZ_OF[String(f.destination_iata || '').toUpperCase()];
    const dest = offsetMin(x.back_offset) ?? (destZone ? zoneOffsetMin(destZone, x.depart) : null) ?? offsetMin(x.depart_offset);
    const arr = x.duration_min && dest != null && offsetMin(x.depart_offset) != null
      ? addMinutesLocal(x.depart, x.duration_min + dest - offsetMin(x.depart_offset)) : null;
    let checkin = arr ? arr.slice(0, 10) : outDate;
    if (arr && +arr.slice(11, 13) < 8 && checkin > outDate) checkin = addDays(checkin, -1);
    const checkout = backDate && backDate > checkin ? backDate : addDays(checkin, 1);
    return { checkin, checkout, stay_assumed: !backDate };
  };
  const durText = (m) => (m ? L.inAir(Math.floor(m / 60), m % 60) : null);
  const offers = pick.map((x, i) => {
    const outDate = x.depart.slice(0, 10), backDate = x.back ? x.back.slice(0, 10) : null;
    // A date other than the one he asked for is marked: "19-noyabr (-1)".
    const mark = (d, want) => (exact && isDate(want) && d !== want ? ` (${dayDiff(d, want) > 0 ? '+' : ''}${dayDiff(d, want)})` : '');
    const offDay = mark(outDate, f.date_from);
    return {
      src: 'aviasales', label: L.optionLabel(i + 1),
      airline: [airlineName(x.airline), x.flight_number || x.airline].filter(Boolean).join(' · '),
      outbound: `${dshort(outDate, lang)}${offDay}, ${x.depart.slice(11, 16)}${durText(x.duration_min) ? ' · ' + durText(x.duration_min) : ''}`,
      stops: stopsText(x.transfers),
      return: backDate ? `${dshort(backDate, lang)}${mark(backDate, f.one_way ? null : f.date_to)}, ${x.back.slice(11, 16)}${x.back_transfers != null ? ' · ' + stopsText(x.back_transfers) : ''}` : null,
      outbound_datetime: x.depart, out_tz: x.depart_offset, return_datetime: x.back, return_tz: x.back_offset,
      date_out: outDate, date_back: backDate,
      ...stay(x, outDate, backDate),
      transfers: x.transfers, flight_price: x.price_total, total_price: x.price_total, currency: 'USD', refund: 'unknown',
      flight_link: aviasalesUrl(env, f, { date_out: outDate, date_back: backDate }),
    };
  });
  return { offers, recommended, why, note };
}
