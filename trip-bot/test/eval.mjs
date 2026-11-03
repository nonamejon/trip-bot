// Regression set against the REAL Gemini API: real messages (several from actual use) with what the bot must
// understand. Run before deploying a prompt change:   GEMINI_API_KEY=... node test/eval.mjs
// Exits non-zero below 95% so a quiet drop in understanding (Uzbek and Russian) is caught.

import { routeMessage, parseRequest } from '../src/gemini.js';

const env = { GEMINI_API_KEY: process.env.GEMINI_API_KEY, GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.8-flash', TZ_OFFSET_MIN: '300' };
if (!env.GEMINI_API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }
const md = (iso) => (iso || '').slice(5); // compare month-day only, so the set keeps working next year
const trip = (status, destination = 'Istanbul') => ({ code: 'T-0009', status, destination });

// [message, context, check(result) -> true | 'what was wrong']
const ROUTE = [
  ['Istanbulga 12-15 noyabr, ertalabki reys', null, (r) => r.intent === 'trip'],
  ['Guanchjouga shu oyning oʻrtalarida, qaysi kuni arzon boʻlsa', null, (r) => r.intent === 'trip'],
  ['Мне нужно в Дубай в конце месяца', null, (r) => r.intent === 'trip'],
  ['Moskvaga bir tomonga, 20-noyabr', null, (r) => r.intent === 'trip'],
  ['Bobur bilan Istanbulga uchrashuvga boraman, 20-noyabrda, 3 kunga', null, (r) => r.intent === 'trip'],
  ["2 kishi bo'lamiz", trip('collecting'), (r) => r.intent === 'trip'],
  ["Reja o'zgardi, bir haftalikka emas, 10 kunlik qil.", trip('draft'), (r) => r.intent === 'trip'],
  ['Nimaga yoʻlovchilar sonini 13 ta deb yozib qoʻyibsan?', trip('draft'), (r) => r.intent === 'trip'],
  ['Zaybal farqi yoq deyapman, qaysi kunlari bilet arzonligiga qarab oyni ortasida borib kelsam boldi', trip('collecting', 'Guanchjou'), (r) => r.intent === 'trip'],
  ['safarni bekor qil', trip('sent'), (r) => r.intent === 'trip_cancel'],
  ['отмени поездку', trip('offers'), (r) => r.intent === 'trip_cancel'],
  ['safarim qanday holatda?', trip('sent'), (r) => r.intent === 'trip_status'],
  ['arzonroq variant topib ber', trip('offers'), (r) => ['trip_note', 'trip'].includes(r.intent)],
  ['ertaga soat 15:00 da Hilton mehmonxonasida uchrashuv', null, (r) => r.intent === 'event' && r.ev_time === '15:00'],
  ['встреча с инвесторами в пятницу в 10 утра', null, (r) => r.intent === 'event' && r.ev_time === '10:00'],
  ['juma kuni Bobur bilan uchrashuv bor', null, (r) => r.intent === 'event' && (!!r.question || !r.ev_time)],
  ['ertaga Bobur bilan Toshkentda tushlik, soat 13 da', null, (r) => r.intent === 'event'],
  ['har kuni ertalab 8 da dori ichishni eslatib tur', null, (r) => r.intent === 'reminder' && r.rm_repeat === 'daily' && r.rm_time === '08:00'],
  ['напомни через 20 минут позвонить маме', null, (r) => r.intent === 'reminder' && r.rm_repeat !== 'daily'],
  ['dushanba kuni soat 9 da hisobotni topshirishni eslat', null, (r) => r.intent === 'reminder' && r.rm_time === '09:00'],
  ['ertaga nima rejalarim bor?', null, (r) => r.intent === 'agenda'],
  ['что у меня на этой неделе?', null, (r) => r.intent === 'agenda'],
  ['eslatmalarimni koʻrsat', null, (r) => r.intent === 'reminders_list'],
  ['bu matnni rus tiliga tarjima qil: Hurmatli hamkorlar, uchrashuv dushanbaga koʻchdi', null, (r) => r.intent === 'translate' && r.tr_target === 'ru'],
  ['переведи на английский: встреча переносится на пятницу', null, (r) => r.intent === 'translate' && r.tr_target === 'en'],
  ['Germaniya elchixonasiga viza boʻyicha xat yoz', null, (r) => r.intent === 'letter'],
  ['напиши письмо партнёру с благодарностью за встречу', null, (r) => r.intent === 'letter'],
  ['rahmat!', null, (r) => r.intent === 'chat'],
];

// [message, draft so far, history, check(fields)]
const PARSE = [
  ['Istanbulga 12-dan 15-noyabrgacha, 3 kun, bir kishilik.', {}, '', (f) => md(f.date_from) === '11-12' && md(f.date_to) === '11-15' && f.travelers === 1 && f.destination_iata === 'IST'],
  ['Guanchjouga shu shu oyning oʻrtalariga boʻladi, lyuboy arzonroq kuni boʻlaveradi, bitta odamga.', {}, '', (f) => !!f.date_flex && !f.date_from && f.travelers === 1 && f.destination_iata === 'CAN' && !!f.window_from],
  ['Moskvaga bir tomonga, 20-noyabr, 2 kishi', {}, '', (f) => f.one_way === true && f.travelers === 2 && md(f.date_from) === '11-20' && !f.date_to],
  ['Дубай, в конце ноября на неделю, я один', {}, '', (f) => f.travelers === 1 && f.destination_iata === 'DXB' && (!!f.date_flex || !!f.date_from)],
  ['Istanbulga 5-noyabrdan bir haftalik', {}, '', (f) => md(f.date_from) === '11-05' && md(f.date_to) === '11-12' && !f.travelers],
  ['Uch kishi.', { destination: 'Istanbul', date_from: '2026-11-05', date_to: '2026-11-12' }, 'Azizbek: Istanbulga 5-noyabrdan bir haftalik\nBot: Aniqlashtirib bering: yoʻlovchilar soni.', (f) => f.travelers === 3 && md(f.date_to) === '11-12'],
  ["Reja o'zgardi, bir haftalikka emas, 10 kunlik qil.", { destination: 'Istanbul', date_from: '2026-11-05', date_to: '2026-11-12', travelers: 3 }, '', (f) => md(f.date_to) === '11-15' && f.travelers === 3],
  ["Bo'ldi, qolganlar kelolmaydi.", { destination: 'Istanbul', date_from: '2026-11-05', date_to: '2026-11-15', travelers: 3 }, 'Azizbek: Uch kishi.', (f) => f.travelers === 1],
  ['Nimaga yoʻlovchilar sonini 13 ta deb yozib qoʻyibsan? Bitta odamman', { destination: 'Istanbul', date_from: '2026-11-12', date_to: '2026-11-15', travelers: 13 }, '', (f) => f.travelers === 1],
];

const results = [];
async function run(kind, i, fn, check) {
  const t = Date.now();
  try { const r = await fn(); const ok = check(r) === true; results.push({ kind, i, ok, ms: Date.now() - t, r }); }
  catch (e) { results.push({ kind, i, ok: false, ms: Date.now() - t, r: { error: e.message } }); }
}
const jobs = [
  ...ROUTE.map(([m, ctx, c], i) => () => run('route', i, () => routeMessage(env, m, [], { lang: /[а-я]/i.test(m) ? 'ru' : 'uz', trip: ctx, pending: null, history: '' }), c)),
  ...PARSE.map(([m, d, h, c], i) => () => run('parse', i, () => parseRequest(env, d, m, [], /[а-я]/i.test(m) ? 'ru' : 'uz', h).then((r) => {
    const f = { ...d }; for (const [k, v] of Object.entries(r)) if (v != null && v !== '') f[k] = v; return f;
  }), c)),
];
for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map((j) => j()));

for (const x of results.filter((x) => !x.ok)) {
  const msg = (x.kind === 'route' ? ROUTE : PARSE)[x.i][0];
  console.log(`WRONG ${x.kind} "${msg}"\n      -> ${JSON.stringify(Object.fromEntries(Object.entries(x.r).filter(([, v]) => v != null)))}`);
}
const ok = results.filter((x) => x.ok).length, pct = Math.round((ok / results.length) * 100);
const slow = Math.max(...results.map((x) => x.ms));
console.log(`\n${ok}/${results.length} right (${pct}%). Slowest call ${(slow / 1000).toFixed(1)} s.`);
process.exit(pct >= 95 ? 0 : 1);
