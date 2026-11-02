// Generated files: a calendar invite (.ics) after booking, and simple PDFs for the mock agent's "tickets".

const p2 = (n) => String(n).padStart(2, '0');
const icsTime = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}00Z`; };
const icsDate = (iso) => iso.slice(0, 10).replace(/-/g, '');
const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

// One file with the outbound flight and the whole trip as an all-day span. Opens in any calendar app.
export function tripIcs(t, offer) {
  const f = t.fields, now = icsTime(Date.now());
  const ev = [];
  if (t.flight_at) {
    ev.push(['BEGIN:VEVENT', `UID:${t.code}-flight@trip-bot`, `DTSTAMP:${now}`, `DTSTART:${icsTime(t.flight_at)}`, `DTEND:${icsTime(t.flight_at + 3 * 3600e3)}`,
      `SUMMARY:${icsText('Parvoz: ' + (f.origin || 'Toshkent') + ' → ' + f.destination)}`, `DESCRIPTION:${icsText([offer?.airline, offer?.outbound, t.code].filter(Boolean).join(' · '))}`,
      'BEGIN:VALARM', 'TRIGGER:-PT3H', 'ACTION:DISPLAY', 'DESCRIPTION:Aeroportga yoʻl olish vaqti', 'END:VALARM', 'END:VEVENT'].join('\r\n'));
  }
  if (f.date_from && f.date_to) {
    const end = new Date(Date.parse(f.date_to.slice(0, 10)) + 86400e3).toISOString().slice(0, 10);
    ev.push(['BEGIN:VEVENT', `UID:${t.code}-trip@trip-bot`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${icsDate(f.date_from)}`, `DTEND;VALUE=DATE:${icsDate(end)}`,
      `SUMMARY:${icsText('Safar: ' + f.destination)}`, `DESCRIPTION:${icsText([offer?.hotel, t.code].filter(Boolean).join(' · '))}`, 'END:VEVENT'].join('\r\n'));
  }
  return new TextEncoder().encode(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//trip-bot//EN', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n');
}

// Minimal one-page PDF with plain lines of text (ASCII). Used only by the mock agent.
export function tinyPdf(lines) {
  const safe = (s) => String(s).replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, (m) => '\\' + m);
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
