// One Gemini call per step. Handles text plus voice notes, PDFs and photos in the same request.

import { localISODate } from './util.js';

// How Gemini should write for the owner's language.
const STYLE = {
  uz: {
    name: 'Uzbek (Latin script, with oʻ and gʻ)', polite: 'addressing him politely with "siz"', origin: 'Toshkent',
    places: 'the usual Uzbek spelling of place names (Toshkent, Istanbul, Dubay, Moskva)',
    labels: '"1-variant", "2-variant", ...', ret: '"15-noyabr 19:30"', stops: '"toʻgʻri reys" or "X orqali 1 ta qoʻnish"',
  },
  ru: {
    name: 'Russian', polite: 'addressing him politely with "вы"', origin: 'Ташкент',
    places: 'the usual Russian spelling of place names (Ташкент, Стамбул, Дубай, Москва)',
    labels: '"Вариант 1", "Вариант 2", ...', ret: '"15 ноября 19:30"', stops: '"прямой" or "1 пересадка в X"',
  },
};
const style = (lang) => STYLE[lang] || STYLE.uz;

// thinking: 'low' for quick routing steps (Gemini 3 thinking level); omitted = model default.
// timeoutMs: how long one call may take. Writing tasks (letters, offers) can take 10-25 s on Gemini 3.8 Flash.
// tools: e.g. [{ google_search: {} }] to let Gemini search the web (then no schema; it returns text).
export async function gemini(env, { prompt, media = [], schema = null, temperature = 0.2, thinking = null, timeoutMs = 25000, tools = null }) {
  const parts = [{ text: prompt }, ...media.map((m) => ({ inline_data: { mime_type: m.mime, data: m.b64 } }))];
  const generationConfig = { temperature };
  if (schema) { generationConfig.responseMimeType = 'application/json'; generationConfig.responseSchema = schema; }
  if (thinking) generationConfig.thinkingConfig = { thinkingLevel: thinking };
  const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig, ...(tools ? { tools } : {}) });
  const r = await callGemini(env, body, timeoutMs);
  const j = await r.json();
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned no text: ' + JSON.stringify(j).slice(0, 300));
  if (!schema) return text;
  try { return JSON.parse(text); }
  catch { throw new Error('Gemini returned invalid JSON: ' + text.slice(0, 300)); }
}

// Gemini sometimes answers "busy" (429/5xx) at once, or is slow. A quick "busy" is retried once, after a short pause;
// a slow call is not retried (a second slow call would only add delay). Always model GEMINI_MODEL.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
async function callGemini(env, body, timeoutMs) {
  const model = env.GEMINI_MODEL || 'gemini-3.8-flash';
  const started = Date.now();
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = timeoutMs - (Date.now() - started);
    if (left < 3000) break;
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body,
        signal: AbortSignal.timeout(left),
      });
    } catch (e) {
      throw new Error(`Gemini ${model} ${e.name === 'TimeoutError' ? `timed out after ${Math.round((Date.now() - started) / 1000)} s` : 'failed: ' + e.message}`);
    }
    if (r.ok) return r;
    last = new Error(`Gemini ${model} HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    if (!RETRYABLE.has(r.status)) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw last;
}

const S = (nullable = true) => ({ type: 'STRING', nullable });

// ---------- 1. Owner message (text and/or voice/photo/PDF) -> request fields ----------
const REQUEST_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: S(), origin: S(), destination: S(), date_from: S(), date_to: S(),
    travelers: { type: 'INTEGER', nullable: true }, traveler_names: S(), flight_pref: S(),
    one_way: { type: 'BOOLEAN', nullable: true }, date_flex: S(), window_from: S(), window_to: S(),
    origin_iata: S(), destination_iata: S(),
    baggage: S(), hotel: S(), budget: S(), notes: S(),
  },
};

// history: the recent conversation (util.recentChat), so earlier answers and the bot's questions are known.
export function parseRequest(env, draft, text, media, lang = 'uz', history = '') {
  const S = style(lang);
  const prompt = `You are the parsing step of a Telegram travel assistant for one executive, Azizbek, based in Tashkent. ${nowLine(env)}
He writes or speaks in Uzbek, Russian or English, sometimes mixed.${media.length ? ' His message includes the attached file (a voice note, photo or document); read or transcribe it.' : ''}

Recent conversation with the bot, oldest first (the bot's lines show what it already understood and what it asked):
"""${history || '(none)'}"""

The trip request so far (JSON, may be empty): ${JSON.stringify(draft)}
His new message: """${text || '(none, see attachment)'}"""

Return the complete, updated trip request as JSON:
- destination: the city (add the country only if unclear).
- origin: where he flies from; "${S.origin}" unless he says otherwise.
- date_from, date_to: only exact dates he gave; ALWAYS digits "YYYY-MM-DD", even though other values are in ${S.name}. "12-15 noyabr" / "с 12 по 15 ноября" means date_from = the 12th and date_to = the 15th. A length ("3 kunga", "на неделю") counts from date_from. Use the nearest future date.
- date_flex: if his dates are approximate or he wants the cheapest day ("oyning oʻrtalarida", "arzonroq kuni", "в конце месяца", "±2 kun"), describe it briefly, including the return if it is flexible too (e.g. "noyabr oʻrtalari, borib-kelish eng arzon kunlarda"), and leave date_from/date_to null unless he gave exact dates. Never turn an approximate date into an exact one. Else null.
- window_from, window_to: when date_flex is set, the earliest departure and latest return dates of that window, "YYYY-MM-DD" ("noyabr oʻrtalari" = about the 10th to the 20th); else null.
- origin_iata, destination_iata: the 3-letter IATA city code of the origin and destination (TAS, IST, DXB, CAN, MOW...); null if no destination yet.
- one_way: true if he wants a one-way ticket ("bir tomonga", "в одну сторону", "qaytish kerak emas"); then date_to is null. Otherwise null.
- travelers: the number of people travelling, ONLY if he says it ("yolgʻiz", "bir kishilik", "1 kishi", "вдвоём", "3 kishi"). Numbers in dates, times, prices or lengths of stay are never the traveler count. null if he has not said.
- baggage: ONLY what he says ("faqat qoʻl yuki", "1 chamadon", "23 kg"); null if he has not said. Never assume a default and never ask for it.
- traveler_names, flight_pref (time of day, direct or not, class), hotel (his wishes, short), budget, notes: only what he says.
- transcript: if there is a voice note, its transcript in the original language; else null.
Keep earlier values unless he changes or corrects them; a correction always wins. If he complains that a value is wrong, fix that value. Never invent anything. Text values in ${S.name}, using ${S.places}.`;
  return gemini(env, { prompt, media, schema: REQUEST_SCHEMA, timeoutMs: 30000 });
}

// ---------- 2. Agent message(s) -> structured options ----------
const OFFERS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    offers: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' }, airline: S(), outbound: S(), outbound_datetime: S(), return: S(), stops: S(), baggage: S(),
          date_out: S(), date_back: S(), flight_link: S(), hotel_link: S(),
          flight_price: { type: 'NUMBER', nullable: true }, hotel_price_night: { type: 'NUMBER', nullable: true },
          hotel: S(), distance: S(), total_price: { type: 'NUMBER', nullable: true }, currency: S(),
          refund: { type: 'STRING', enum: ['full', 'penalty', 'none', 'unknown'] }, refund_note: S(),
        },
        required: ['label', 'refund'],
      },
    },
    recommended: { type: 'INTEGER', nullable: true },
    reason: S(),
    origin_en: S(), destination_en: S(), area_en: S(),
  },
  required: ['offers'],
};

export function parseOffers(env, fields, agentTexts, media, lang = 'uz') {
  const S = style(lang);
  const prompt = `You are the parsing step of a Telegram travel assistant. A travel agent is answering this request:
${JSON.stringify(fields)}

Everything the agent has written for this request so far (later messages may add details to earlier options):
"""${agentTexts.join('\n\n---\n\n') || '(see attachment)'}"""
${media.length ? 'The agent also attached the file(s) included here; read them.' : ''}

Return JSON:
offers: every option the agent gave, in order, each with label (${S.labels}), airline, outbound (short, like "07:40 → 10:55"), outbound_datetime ("YYYY-MM-DDTHH:MM", local departure time), return (short, with date and time, like ${S.ret}), stops (${S.stops}), baggage (the fare's allowance, short, like "23 kg" or "hand luggage only"), hotel (name and stars), distance (to where he needs to be), total_price (number, everything together), flight_price (the flights alone, if given), hotel_price_night (the hotel per night, if given), currency (ISO code, like "USD"), refund ("full", "penalty", "none" or "unknown"), refund_note, date_out and date_back ("YYYY-MM-DD" of the outbound and return flights; date_back null if one-way), flight_link and hotel_link (http(s) URLs given in the text for booking that flight and that hotel; null if none).
origin_en, destination_en: the origin and destination cities in English; area_en: the area where he wants to stay, in English (e.g. "Levent, Istanbul"), or the destination city.
recommended: index (0-based) of the best fit for the request: his wishes on flight time and hotel location first, then flexibility, then price.
reason: one short sentence saying why.
Write all free-text values in ${S.name}; keep airline names, flight numbers and hotel names as they are.
Use only what the agent wrote; anything not stated stays null or "unknown". If there are no options in the text, return offers: [].`;
  return gemini(env, { prompt, media, schema: OFFERS_SCHEMA, timeoutMs: 40000 });
}

// ---------- 3. Short transcription for voice notes sent mid-trip ----------
export async function transcribe(env, media) {
  const r = await gemini(env, {
    prompt: 'Transcribe this voice note in its original language. Return JSON {"transcript": string}.',
    media, schema: { type: 'OBJECT', properties: { transcript: { type: 'STRING' } }, required: ['transcript'] },
  });
  return r.transcript || '';
}

// ======================= personal secretary =======================

const LANG_NAME = { uz: 'Uzbek (Latin script, with oʻ and gʻ)', ru: 'Russian', en: 'English' };
const nowLine = (env) => {
  const d = new Date(Date.now() + (Number(env.TZ_OFFSET_MIN) || 0) * 60e3);
  const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
  return `Now in Tashkent: ${wd} ${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}.`;
};

// ---------- 4. What is this message for? ----------
const ROUTE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: { type: 'STRING', enum: ['trip', 'trip_note', 'trip_docs', 'trip_status', 'trip_cancel', 'event', 'reminder', 'translate', 'letter', 'agenda', 'reminders_list', 'chat'] },
    transcript: S(),
    question: S(),
    reply: S(),
    ev_title: S(), ev_date: S(), ev_time: S(), ev_end_time: S(), ev_location: S(), ev_notes: S(),
    ev_remind_min: { type: 'INTEGER', nullable: true },
    rm_text: S(), rm_date: S(), rm_time: S(),
    rm_repeat: { type: 'STRING', enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly'], nullable: true },
    tr_text: S(), tr_target: S(),
    lt_request: S(),
    ag_from: S(), ag_to: S(),
  },
  required: ['intent'],
};

// ctx: { lang, trip: { code, status, destination } | null, pending: earlier unfinished message or null, history: recent chat }
export function routeMessage(env, text, media, ctx) {
  const L = LANG_NAME[ctx.lang] || LANG_NAME.uz;
  const hist = ctx.history ? `Recent conversation with the bot, oldest first:\n"""${ctx.history}"""\n` : '';
  const trip = ctx.trip ? `His current trip: ${ctx.trip.code} to ${ctx.trip.destination || '(destination not given yet)'}, status "${ctx.trip.status}" (collecting = the bot is still asking him for trip details; draft = waiting for his approval; sent/offers/chosen/booked = the travel agent is working on it).` : 'He has no trip in progress.';
  const prompt = `You route messages for a Telegram assistant of one executive, Azizbek, based in Tashkent. It is his travel assistant and personal secretary.
${nowLine(env)}
He writes or speaks in Uzbek, Russian or English, sometimes mixed.${media.length ? ' His message includes the attached file (voice note, photo or document); listen to it or read it.' : ''}
${trip}
${hist}
${ctx.pending ? `His previous message was not complete and you asked him a question about it: """${ctx.pending}""". If this message answers it, combine both.` : ''}

His message: """${text || '(none, see attachment)'}"""

Decide the intent:
- trip: a new trip or flight/hotel request, or more details/changes for the trip being collected or the draft ("2 kishi", "13-noyabrdan", "add Bobur").
- trip_note: something for the travel agent about the trip the agent is already working on (seat, meal, a question for the agent, "agentga ayt ...").
- trip_docs: he sends his ticket, booking confirmation, boarding pass or hotel voucher (a file or photo) for his trip.
- trip_status: he asks where his trip/booking stands.
- trip_cancel: he wants to cancel his trip.
- event: put a meeting/appointment/event into his calendar ("ertaga 15:00 da uchrashuv", "встреча в пятницу в 10").
- reminder: remind him to do something at a time ("eslat", "напомни", "remind me"), once or repeating.
- translate: translate text, a voice note, a photo or a document.
- letter: write/draft a letter, email, official request, message or note for him.
- agenda: he asks what is planned (today, tomorrow, this week, a date).
- reminders_list: he asks to see his reminders.
- chat: greetings, thanks or anything else; put a short helpful answer in reply.

Fill only the fields for the chosen intent:
transcript: if there is a voice note or round video, its transcript in the original language; else null.
event: ev_title (short, in his language), ev_date "YYYY-MM-DD", ev_time "HH:MM" or null for all-day, ev_end_time, ev_location, ev_notes, ev_remind_min (minutes before to remind him, only if he says so).
reminder: rm_text (what to remind, short, in his language, as an instruction to him), rm_date "YYYY-MM-DD", rm_time "HH:MM", rm_repeat (none, daily, weekdays, weekly, monthly). "in 2 hours"/"через 20 минут" means from now. A date without a time means 09:00.
translate: tr_text = the text to translate (null if it is the attachment), tr_target = ISO code of the language he wants (uz, ru, en, tr, ...) or null if he did not say.
letter: lt_request = everything he said about the letter (recipient, purpose, details, tone, language).
agenda: ag_from and ag_to "YYYY-MM-DD" (today if he does not say).
Resolve relative dates and times from now, in Tashkent time.
question: if an event or reminder has no date or time you can work out, one short question in ${L} asking only for that; else null.
reply: for chat, a short answer in ${L}; else null.`;
  return gemini(env, { prompt, media, schema: ROUTE_SCHEMA, thinking: 'low', timeoutMs: 25000 });
}

// ---------- 5. Translation ----------
export function translate(env, text, media, target, ownerLang) {
  const fallback = LANG_NAME[ownerLang] || LANG_NAME.uz;
  const prompt = `Translate for a busy executive in Tashkent.
${text ? `Text: """${text}"""` : 'Translate the text in the attached file (voice note, photo or document). If it is a photo of a document, translate all the text in it, keeping its structure.'}
Target language: ${target ? `the language with ISO code "${target}"` : `${fallback} if the text is in another language; if the text is already in ${fallback}, translate it into ${ownerLang === 'ru' ? 'Uzbek (Latin script)' : 'Russian'}`}.
Keep names, numbers, dates and formatting. Translate faithfully; do not add comments.
Return JSON: source_lang (ISO code), target_lang (ISO code), translation.`;
  return gemini(env, {
    prompt, media,
    schema: { type: 'OBJECT', properties: { source_lang: S(), target_lang: S(), translation: { type: 'STRING' } }, required: ['translation'] },
    timeoutMs: 40000,
  });
}

// ---------- 6. Letters ----------
const LETTER_SCHEMA = { type: 'OBJECT', properties: { subject: S(), body: { type: 'STRING' }, lang: S() }, required: ['body'] };

export function writeLetter(env, request, ownerLang) {
  const prompt = `You are the personal secretary of Azizbek, an executive based in Tashkent. Draft the letter he asks for.
His request: """${request}"""
${nowLine(env)}
Write it in the language he asks for; if he does not say, in ${LANG_NAME[ownerLang] || LANG_NAME.uz}. Use the tone that fits the recipient (official, business or friendly).
Ready to send: a greeting, a clear body, a polite closing and his name "Azizbek" (add a surname only if he gives one). Where a fact you need is missing, write a short placeholder in square brackets, like [sana].
Plain text, no markdown.
Return JSON: subject (a short subject line, or null for a personal message), body, lang (ISO code).`;
  return gemini(env, { prompt, schema: LETTER_SCHEMA, temperature: 0.5, timeoutMs: 40000 });
}

export function reviseLetter(env, letter, instruction) {
  const prompt = `You are the personal secretary of Azizbek. Here is a letter you drafted:
Subject: ${letter.subject || '(none)'}
"""${letter.body}"""

His instruction: """${instruction}"""
Rewrite the letter following the instruction (it may ask to change content, tone, length, or to translate it). Keep everything else.
Plain text, no markdown. Return JSON: subject, body, lang (ISO code).`;
  return gemini(env, { prompt, schema: LETTER_SCHEMA, temperature: 0.4, timeoutMs: 40000 });
}

// ---------- 7. A date and time from free text ("12-noyabr 07:40", "завтра в 9") ----------
export function parseWhen(env, text) {
  const prompt = `${nowLine(env)}
Read the date and time in this message (Tashkent time; resolve relative dates from now): """${text}"""
Return JSON: date "YYYY-MM-DD" or null, time "HH:MM" or null.`;
  return gemini(env, { prompt, schema: { type: 'OBJECT', properties: { date: S(), time: S() } }, thinking: 'low', timeoutMs: 15000 });
}

// ---------- 8. A ticket, booking confirmation or boarding pass -> the real flights (for reminders) ----------
const TICKET_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_ticket: { type: 'BOOLEAN' },
    booking_ref: S(), passenger: S(),
    flights: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { flight_number: S(), airline: S(), from_city: S(), from_iata: S(), to_city: S(), to_iata: S(), departure_local: S(), arrival_local: S() },
      },
    },
    hotel: S(), check_in: S(), check_out: S(),
  },
  required: ['is_ticket'],
};
export function parseTicket(env, media, lang = 'uz') {
  const prompt = `Read the attached document. Is it an air ticket, e-ticket, itinerary receipt, booking confirmation, boarding pass or hotel voucher?
Return JSON: is_ticket; booking_ref; passenger; flights (every flight segment in order: flight_number like "HY 271", airline, from_city and to_city in ${lang === 'ru' ? 'Russian' : 'Uzbek (Latin script)'}, from_iata, to_iata, departure_local and arrival_local as "YYYY-MM-DDTHH:MM" in the local time printed on the document); hotel, check_in, check_out ("YYYY-MM-DD") for a hotel voucher.
Copy what is printed; never guess a time. Use null for anything not on the document.`;
  return gemini(env, { prompt, media, schema: TICKET_SCHEMA, timeoutMs: 40000 });
}
