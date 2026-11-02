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

export async function gemini(env, { prompt, media = [], schema = null, temperature = 0.2 }) {
  const parts = [{ text: prompt }, ...media.map((m) => ({ inline_data: { mime_type: m.mime, data: m.b64 } }))];
  const generationConfig = { temperature };
  if (schema) { generationConfig.responseMimeType = 'application/json'; generationConfig.responseSchema = schema; }
  const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig });
  const r = await callWithFallback(env, body);
  const j = await r.json();
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned no text: ' + JSON.stringify(j).slice(0, 300));
  if (!schema) return text;
  try { return JSON.parse(text); }
  catch { throw new Error('Gemini returned invalid JSON: ' + text.slice(0, 300)); }
}

// Gemini models get overloaded (503) or slow. Try the model with a time limit, then retry it once.
// Both together stay under the ~30 s a Worker gets for background work after answering Telegram.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
async function callWithFallback(env, body) {
  // One retry of the same model on 429/5xx or timeout.
  const model = env.GEMINI_MODEL || 'gemini-3.8-flash';
  const tries = [[model, 15000], [model, 12000]];
  let last;
  for (const [model, ms] of tries) {
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body,
        signal: AbortSignal.timeout(ms),
      });
    } catch (e) {
      last = new Error(`Gemini ${model} ${e.name === 'TimeoutError' ? 'timed out' : 'failed'}: ${e.message}`);
      continue;
    }
    if (r.ok) return r;
    last = new Error(`Gemini ${model} HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    if (!RETRYABLE.has(r.status)) break;
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
    baggage: S(), hotel: S(), budget: S(), notes: S(), question: S(),
  },
};

export function parseRequest(env, draft, text, media, lang = 'uz') {
  const S = style(lang);
  const prompt = `You are the parsing step of a Telegram travel assistant for one executive, Azizbek, based in Tashkent. Today is ${localISODate(env)}.
He writes or speaks in Uzbek, Russian or English, sometimes mixed.${media.length ? ' His message includes the attached file (a voice note, photo or document); read or transcribe it.' : ''}

Current draft request (JSON, may be empty): ${JSON.stringify(draft)}
His message text: """${text || '(none, see attachment)'}"""

Merge the message into the draft and return JSON with these fields:
transcript: if there is a voice note, its transcript in the original language; else null.
origin (default "${S.origin}"), destination, date_from and date_to ("YYYY-MM-DD"), travelers (number), traveler_names, flight_pref, baggage (default "1 x 23 kg"), hotel (his hotel wishes, short), budget, notes.
question: one short friendly question in ${S.name}, ${S.polite}, asking for ALL still-missing required fields (destination, date_from, date_to, travelers) at once; null if none are missing.
Rules: keep draft values unless he changes them. If he gives a length ("3 days", "3 kunga") compute date_to from date_from. Resolve relative dates ("next Monday") from today. If he says he travels alone, travelers = 1. Never invent a destination, dates or traveler count. Write field values in ${S.name}, using ${S.places}.`;
  return gemini(env, { prompt, media, schema: REQUEST_SCHEMA });
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
          label: { type: 'STRING' }, airline: S(), outbound: S(), outbound_datetime: S(), return: S(), stops: S(),
          hotel: S(), distance: S(), total_price: { type: 'NUMBER', nullable: true }, currency: S(),
          refund: { type: 'STRING', enum: ['full', 'penalty', 'none', 'unknown'] }, refund_note: S(),
        },
        required: ['label', 'refund'],
      },
    },
    recommended: { type: 'INTEGER', nullable: true },
    reason: S(),
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
offers: every option the agent gave, in order, each with label (${S.labels}), airline, outbound (short, like "07:40 → 10:55"), outbound_datetime ("YYYY-MM-DDTHH:MM", local departure time), return (short, with date and time, like ${S.ret}), stops (${S.stops}), hotel (name and stars), distance (to where he needs to be), total_price (number), currency, refund ("full", "penalty", "none" or "unknown"), refund_note.
recommended: index (0-based) of the best fit for the request: his wishes on flight time and hotel location first, then flexibility, then price.
reason: one short sentence saying why.
Write all free-text values in ${S.name}; keep airline names, flight numbers and hotel names as they are.
Use only what the agent wrote; anything not stated stays null or "unknown". If there are no options in the text, return offers: [].`;
  return gemini(env, { prompt, media, schema: OFFERS_SCHEMA });
}

// ---------- 3. Short transcription for voice notes sent mid-trip ----------
export async function transcribe(env, media) {
  const r = await gemini(env, {
    prompt: 'Transcribe this voice note in its original language. Return JSON {"transcript": string}.',
    media, schema: { type: 'OBJECT', properties: { transcript: { type: 'STRING' } }, required: ['transcript'] },
  });
  return r.transcript || '';
}
