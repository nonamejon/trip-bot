# Trip bot: context for Claude Code

Read `CHAT_LOG.md` for the full history. This file says what exists now and what to do next.

## What this is

A private Telegram assistant in Uzbek or Russian. Roles: `OWNER_ID` is the maintainer (uses the assistant, gets error alerts, has the maintenance commands); `ADMIN_ID` lists the people who use the assistant (Azizbek at handover), with no alerts or maintenance commands. Each person has their own trips, calendar, reminders and chat (`util.userIds`). Two sections, on a keyboard at the bottom of the chat:

| Section | Main features |
| --- | --- |
| ✈️ Mening safarlarim (My trips) | Flight and hotel search (or a travel agent), routes, bookings, documents |
| 🗂 Shaxsiy kotib (Personal secretary) | Calendar, reminders, translations, letters |

- **Search mode (live now, `AGENT_MODE = "search"`):** no travel agent. After he approves, a cron job (`search_offers`, `src/search.js`) asks Gemini with Google Search for 3 real options (flights with numbers and times, baggage, approximate price, terms, a hotel, booking URLs); the text goes through the normal `parseOffers` and comparison. Every option links to an **Aviasales** search for its exact route, dates and passengers (`src/aviasales.js`; needs the IATA codes `parseRequest` now returns) and a Booking.com search. **Live: the `TRAVELPAYOUTS_TOKEN` secret is set**, so the options are built from real Aviasales fares (Travelpayouts Data API `prices_for_dates`, the Aviasales cache of recent searches; exact dates, else the closest dates within ±3 days in that month; flexible dates: month search + window filter) and each fare's own Aviasales link is used. `TRAVELPAYOUTS_MARKER = "800005"` (the user's Partner ID) is on every Aviasales link for commission. Option prices show the split "total (✈️ flight + 🏨 hotel/night)"; the flight part matches the Aviasales link. Without the token, prices are estimates from web search (the card says which). He picks one, books through the links, then taps "✅ Bron qildim" (the card says the time came from the search, with a button to change it) or sends the ticket (router intent `trip_docs`): `parseTicket` reads the real flights and the reminders use them. A ticket for a trip the bot doesn't know creates a booked trip from it. "Other options" and new wishes ("arzonroq") re-run the search. A search takes 30-60 s (cron allows 15 min); a failed search is retried once, then he gets a retry button. The agent modes (`group`, `mock`) still work, so a hybrid (search + agent books) can be added later.
- **Trips (agent modes):** he messages or voice-notes a trip request; Gemini extracts the details and shows an approval card. Once he approves, the bot sends the request to his travel agent, parses the agent's options and shows a comparison with buttons. He picks one, the agent books it and uploads documents, and the bot sends the files, a calendar file and flight reminders. Each trip has a card (booking, documents, calendar file, write to the agent, add a missing flight time, cancel).
- **Secretary:** free messages or voice notes like "ertaga 15:00 da Hilton'da uchrashuv", "har kuni 8 da dori ichishni eslat", "rus tiliga tarjima qil: …", "elchixonaga xat yoz". Calendar events get a heads-up (default 30 min) and an overlap warning; a subscription link (`/cal/<token>.ics`) puts events and trips in his phone's calendar. Reminders can repeat (daily, weekdays, weekly, monthly) and be snoozed. Translation works on text, voice, photos and PDFs, one-off or in a translate mode. Letters can be revised or translated. A morning brief at `BRIEF_HOUR` lists the day.
- **Trip request intake:** from the first message the bot shows the request card with ❓ for missing items and asks for all of them in one message; the questions come from code, not from Gemini. Only "where" and "roughly when" (exact dates or `date_flex`) block a request (`hardMissing`); travelers and a missing return date are asked as optional (`softMissing`) and the approve button is shown anyway. Approximate dates are never turned into exact ones. Baggage is never asked: if he mentions it, it is passed on; otherwise the agent is asked to state each fare's allowance, which the options show. Gemini only extracts, with the recent conversation as context; impossible values (travelers outside 1-20, non-ISO dates, return before departure) are dropped. Voice notes are not echoed back. One-way trips (`one_way`) need no return date; approximate dates keep a `date_flex` note ("noyabr oʻrtalari, eng arzon kun") that the card and the agent see.
- **Never silent:** an unexpected error sends him an apology at once (index.js `apologize`); a message whose handling was cut off (time limit) is found by the cron watchdog (`updates.done_at` still empty after 2 min) which apologizes once and alerts the maintainer. Cloudflare Workers Logs are on (`[observability]`).
- **Errors:** alerts go to `OWNER_ID` (the maintainer; `ALERT_ID` can override), never to the admins (users). Passing glitches (D1 network blips, Gemini busy or slow) are only logged as `error_transient`; 3+ within 15 min give one warning per hour. Other errors alert at once.
- **Memory:** both sides of the owner's chat are kept in `chat_log` (30 days; never the `/passport` text). The last 20 lines of the past 24 h go to `routeMessage` and `parseRequest`. Read `chat_log` (via the connector) to see what the bot actually said.
- **Routing:** every free message goes through `routeMessage` (Gemini, low thinking) which picks the intent; buttons can set a "mode" (prefs.mode: translate, letter, revise, agent, flight_time, clarify) so the next message is used for that.

The person now working on it wants it cheap and minimal:
- No VPS.
- One Cloudflare Worker, D1, and Gemini 3.8 Flash on a billed key.
- The real thing, not mock-ups or simulators.

They prefer short, direct answers.

## Layout

```
trip-bot/                 the bot (deploy this)
  src/index.js            webhook (/telegram), /setup, cron entry
  src/flow.js             state machine, owner messages, buttons, agent handling, cron checks, admin commands
  src/gemini.js           Gemini calls with JSON schemas: parseRequest, parseOffers, transcribe
  src/agent.js            agent channel: real Telegram group or mock
  src/mock.js             mock travel agent (Gemini writes offers as free text; cron delivers after a delay)
  src/telegram.js         Bot API client
  src/util.js             D1 helpers, time (TZ offset), HTML escaping, AES-GCM passport encryption
  src/files.js            .ics calendar file, tiny PDF generator for the mock tickets
  src/i18n.js             every user-facing string, Uzbek and Russian (owner: O[lang]; agent: A[AGENT_LANG])
  src/secretary.js        calendar, reminders, translation, letters, morning brief, calendar feed
  src/search.js           search mode: Gemini + Google Search for flights and hotels, Booking.com links
  src/aviasales.js        Aviasales search links; real fares from the Travelpayouts API when TRAVELPAYOUTS_TOKEN is set
  schema.sql              D1 schema (already applied to the live database)
  test/run.mjs            end-to-end test (npm test): fake Telegram and Gemini, better-sqlite3 as D1, fake clock
  test/live.mjs           live test (npm run test:live): real Gemini, fake Telegram; writes a transcript report
  test/eval.mjs           regression set against the real Gemini (npm run eval)
  test/telegram-rules.mjs what real Telegram would reject (HTML, lengths, button data); used by both tests
  wrangler.toml           config; D1 id filled in; OWNER_ID and ADMIN_ID empty
  README.md               setup and admin commands
simulator/                the HTML simulator built by mistake; keep only as a reference
original-docs/            first-day Uzbek spec, Telegram screen designs, slides (old stack, outdated)
```

## Trip states

```
collecting -> draft -> sent -> offers -> chosen -> booked -> done
                  (approve)  (agent)  (choose)  (docs)
any open state -> cancelled
```

- The bot asks the agent once for missing price, flight times or cancellation terms (`clarify_asked`) before showing the options.
- The cron runs every minute. Trip checks:
  - runs mock-agent jobs;
  - nudges an unapproved draft or unchosen offers after `NUDGE_MIN`;
  - reminds a late agent after `AGENT_SLA_MIN`;
  - sends flight reminders 24 hours and 3 hours before departure;
  - marks the trip done the day after `date_to`.
  Secretary checks: event heads-ups, due reminders (repeating ones move to the next date), the morning brief.

## Cloudflare state (live, in the user's account)

- D1 `trip-bot`, id `a6b9448f-7127-4913-9ea5-bc786dddc799`, region EEUR. The live schema matches `schema.sql` (later tables and columns were added through the connector with `CREATE TABLE` / `ALTER TABLE ADD COLUMN`; do the same for future changes).
- Worker `trip-bot` deployed at https://trip-bot.zsayidfozil.workers.dev; secrets set; webhook set (bot `@trip_t_est_bot`). The deploy API token has no D1 permission; query D1 through the Cloudflare connector.

## Next steps, in order

1. `cd trip-bot && npm install`
2. `npx wrangler login`
3. Set the secrets. The user must supply the Telegram token and Gemini key themselves.
   ```
   npx wrangler secret put TELEGRAM_TOKEN    # from @BotFather
   npx wrangler secret put GEMINI_API_KEY    # paid Gemini key
   npx wrangler secret put WEBHOOK_SECRET    # random letters and digits
   npx wrangler secret put PASSPORT_KEY      # openssl rand -base64 32
   ```
4. `GEMINI_MODEL` is `gemini-3.8-flash`, always (user's choice; no cheaper fallback). On 429/5xx or a timeout (15 s) it retries the same model once (12 s). The key is on the billed tier.
5. `npx wrangler deploy`
6. Open `https://trip-bot.<subdomain>.workers.dev/setup?key=<WEBHOOK_SECRET>`. This sets the webhook and the bot's command list.
7. Done: `OWNER_ID` is `5503792899` (the maintainer: alerts and maintenance commands). `ADMIN_ID` = `606554606` (a user). At handover add Azizbek's ID to `ADMIN_ID`; the owner stays the maintainer.
8. Test in mock mode:
   - Send a voice note in Uzbek and approve the card.
   - Send `/now` to make the mock agent answer immediately.
   - Pick an option and wait for the PDFs, the `.ics` file and the reminders.
   - `/fire T-0001` sends a trip's reminders immediately.
   - While testing, lower `AGENT_SLA_MIN` and `NUDGE_MIN` in `wrangler.toml` to see those timers fire.
9. Watch the logs with `npx wrangler tail`. Admin commands: `/alltrips`, `/trip T-0001`, `/log 30`, `/jobs`, `/now`, `/fire`, `/setstatus`.

## Testing

- `npm test`: 124 checks
- `npm run eval`: 37 real messages (several from actual use) against the real Gemini; must stay at 95%+ before deploying a prompt change. Last run: 37/37. over every flow, every message validated against Telegram's rules.
- `SCENARIO=search npm run test:live -- <voice-dir> <report.md>`: real searches (Istanbul by voice, Guangzhou with flexible dates); last run: both found real options in ~40 s and completed.
- `npm run test:live -- <voice-dir> <report.md>`: real Gemini 3.8 Flash on a full day of use (voice notes, PDF, Uzbek and Russian). Last run: all steps worked, slowest 19.7 s, no rule violations.
- Timing: Gemini 3.8 Flash takes 3-25 s per call (letters and the mock agent's offers are the slow ones). The webhook works up to 25 s before answering Telegram, then up to ~30 s more in `waitUntil`; Gemini calls time out at 25 s (router, parsing), 40 s (letters, translation, agent options) or 45 s (mock agent, cron); they retry once only on a quick 429/5xx.

## Untested against the real services

- **Telegram rendering on a real phone.** Messages are validated against the API rules, but nobody has looked at them in the app yet.
- **Telegram uploads.** Multipart uploads (`tgUpload`) and an inline keyboard sent as a JSON string in FormData.
- **Large media.** Voice notes and PDFs are base64-encoded inside the Worker. On the free Workers plan a big file might hit the CPU limit; the $5 Workers plan fixes that.
- **Group mode.** `AGENT_MODE=group` with a real group, including `AGENT_TOPICS=true` (the group must be a forum and the bot an admin).

## Known gaps and possible next work

- **Done: language.** Two languages, Uzbek (Latin script) and Russian. The first message or `/start` shows a picker (🇺🇿 / 🇷🇺 buttons); `/uz`, `/ru` switch, `/lang` shows the picker again. The choice is stored per person in the `prefs` table and drives fixed messages, buttons, dates, the per-chat command menu, the `.ics` file, and what Gemini writes (questions, request fields, option summaries). Messages to the travel agent use `AGENT_LANG` (default `uz`), as does the mock agent. Admin output and error alerts stay English. Mock PDFs: Uzbek (apostrophes written as `'`), or English in Russian mode because the PDF's built-in font has no Cyrillic.
- **Pausing the agent.** There's no way to tell the mock agent to stop other than cancelling the trip.
- **Done: missing flight time.** The booking message and trip card have "🕒 Reys vaqtini kiritish".
- **One trip at a time.** Only one open trip per owner (`activeTrip` takes the newest).
- **Not built.** EAS. Email sending (letters are drafted for him to copy). Google Calendar two-way sync (the subscription feed is one-way, refreshed by the phone).
- **Outdated documents.** The original spec, design and slides in `original-docs/` describe the old Go/VPS/Claude stack and need updating if they will be shown to Azizbek.

## Rules

- Never commit secrets. Passport data is never sent to Gemini; only `/passport` stores it, encrypted.
- `npm test` must keep passing. Extend `test/run.mjs` when the flow changes.
