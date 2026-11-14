// Generated files: a calendar invite (.ics) after booking, and simple PDFs for the mock agent's "tickets".

const p2 = (n) => String(n).padStart(2, '0');
const icsTime = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}00Z`; };
const icsDate = (iso) => iso.slice(0, 10).replace(/-/g, '');
const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n?/g, '\n').replace(/\n/g, '\\n');
// RFC 5545: lines longer than 75 octets are folded (CRLF + space), never inside a UTF-8 character.
const enc = new TextEncoder();
function fold(line) {
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const icsWrap = (events, name) => new TextEncoder().encode(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//trip-bot//EN', 'CALSCALE:GREGORIAN',
  ...(name ? [`X-WR-CALNAME:${icsText(name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'] : []), ...events, 'END:VCALENDAR'].join('\r\n').split('\r\n').map(fold).join('\r\n') + '\r\n');

// One VEVENT. Either start/end (UTC ms) or dateFrom/dateTo ("YYYY-MM-DD", inclusive) for all-day spans.
function vevent({ uid, start, end, dateFrom, dateTo, summary, description, location, alarmMin, alarmText }) {
  const out = ['BEGIN:VEVENT', `UID:${uid}@trip-bot`, `DTSTAMP:${icsTime(Date.now())}`];
  if (dateFrom) {
    const endDay = new Date(Date.parse((dateTo || dateFrom).slice(0, 10)) + 86400e3).toISOString().slice(0, 10);
    out.push(`DTSTART;VALUE=DATE:${icsDate(dateFrom)}`, `DTEND;VALUE=DATE:${icsDate(endDay)}`);
  } else {
    out.push(`DTSTART:${icsTime(start)}`, `DTEND:${icsTime(end || start + 3600e3)}`);
  }
  out.push(`SUMMARY:${icsText(summary)}`);
  if (description) out.push(`DESCRIPTION:${icsText(description)}`);
  if (location) out.push(`LOCATION:${icsText(location)}`);
  if (alarmMin != null) out.push('BEGIN:VALARM', `TRIGGER:-PT${alarmMin}M`, 'ACTION:DISPLAY', `DESCRIPTION:${icsText(alarmText || summary)}`, 'END:VALARM');
  out.push('END:VEVENT');
  return out.join('\r\n');
}

// A trip: the outbound flight (with a "leave for the airport" alarm) and the whole trip as an all-day span.
function tripEvents(t, offer, L) {
  const f = t.fields, ev = [];
  if (t.flight_at) {
    ev.push(vevent({ uid: `${t.code}-flight`, start: t.flight_at, end: t.flight_at + 3 * 3600e3,
      summary: `${L.icsFlight}: ${f.origin || L.origin} → ${f.destination || '?'}`, description: [offer?.airline, offer?.outbound, t.code].filter(Boolean).join(' · '),
      alarmMin: 180, alarmText: L.icsLeave }));
  }
  if (f.date_from && f.date_to && f.date_to >= f.date_from) {
    ev.push(vevent({ uid: `${t.code}-trip`, dateFrom: f.date_from, dateTo: f.date_to, summary: `${L.icsTrip}: ${f.destination || '?'}`,
      description: [offer?.hotel, t.code].filter(Boolean).join(' · ') }));
  }
  return ev;
}

// tzMs: owner's offset from UTC in ms (all-day events are stored as local midnight).
function calEvent(e, tzMs) {
  const base = { uid: `ev-${e.id}`, summary: e.title, description: e.notes || '', location: e.location || '' };
  if (e.all_day) {
    const iso = new Date(e.start_at + tzMs).toISOString().slice(0, 10);
    return vevent({ ...base, dateFrom: iso });
  }
  return vevent({ ...base, start: e.start_at, end: e.end_at, alarmMin: e.remind_at ? Math.round((e.start_at - e.remind_at) / 60e3) : null });
}

// L: the owner's strings (i18n.js O[lang]).
export const tripIcs = (t, offer, L) => icsWrap(tripEvents(t, offer, L));
export const eventIcs = (e, tzMs) => icsWrap([calEvent(e, tzMs)]);
// The subscription feed: all calendar events and booked trips.
export const feedIcs = (events, trips, L, name, tzMs) => icsWrap([...events.map((e) => calEvent(e, tzMs)), ...trips.flatMap((t) => tripEvents(t, t.offers?.[t.chosen], L))], name);

// Minimal one-page PDF with plain lines of text (ASCII). Used only by the mock agent.
// Uzbek Latin fits in ASCII once its apostrophes (oʻ gʻ, ʼ) are written as '. Cyrillic does not (no font for it here).
const ASCII = { 'ʻ': "'", 'ʼ': "'", '‘': "'", '’': "'", '“': '"', '”': '"', '«': '"', '»': '"', '–': '-', '—': '-', '→': '->', '×': 'x', '★': '*' };
export function tinyPdf(lines) {
  const safe = (s) => String(s).replace(/[ʻʼ‘’“”«»–—→×★]/g, (c) => ASCII[c]).replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, (m) => '\\' + m);
  let content = 'BT /F1 13 Tf 50 790 Td 20 TL ';
  lines.forEach((l, i) => { content += (i ? 'T* ' : '') + '(' + safe(l) + ') Tj '; });
  content += 'ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
