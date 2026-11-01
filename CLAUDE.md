# Trip bot: context for Claude Code

Read `CHAT_LOG.md` for the full history. This file says what exists now and what to do next.

## What this is

A private Telegram assistant for one person, Azizbek. He messages or voice-notes a trip request; the bot extracts the details with Gemini and shows an approval card. Once he approves, the bot sends the request to his travel agent, parses the agent's options, and shows a comparison with buttons. He picks one, the agent books it and uploads documents, and the bot sends the files, a calendar file and flight reminders.

The person now working on it wants it cheap and minimal:
- No VPS.
- One Cloudflare Worker, D1, and Gemini on a paid key (a $5 deposit).
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
  schema.sql              D1 schema (already applied to the live database)
  test/run.mjs            end-to-end test: fake Telegram and Gemini, better-sqlite3 as D1, fake clock
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
- The cron runs every minute and does five things:
  - runs mock-agent jobs;
  - nudges an unapproved draft or unchosen offers after `NUDGE_MIN`;
  - reminds a late agent after `AGENT_SLA_MIN`;
  - sends flight reminders 24 hours and 3 hours before departure;
  - marks the trip done the day after `date_to`.

## Cloudflare state (live, in the user's account)

- D1 `trip-bot`, id `a6b9448f-7127-4913-9ea5-bc786dddc799`, region EEUR. All tables from `schema.sql` are created and empty.
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
4. `GEMINI_MODEL` is `gemini-3.8-flash` (12 s limit), then `GEMINI_FALLBACK_MODEL` (`gemini-3.5-flash,gemini-3.5-flash-lite`, 8 s each) on 429/5xx or timeout. The key is on the free tier for now.
5. `npx wrangler deploy`
6. Open `https://trip-bot.<subdomain>.workers.dev/setup?key=<WEBHOOK_SECRET>`. This sets the webhook and the bot's command list.
7. Done: `OWNER_ID` and `ADMIN_ID` are `5503792899`.
8. Test in mock mode:
   - Send a voice note in Uzbek and approve the card.
   - Send `/now` to make the mock agent answer immediately.
   - Pick an option and wait for the PDFs, the `.ics` file and the reminders.
   - `/fire T-0001` sends a trip's reminders immediately.
   - While testing, lower `AGENT_SLA_MIN` and `NUDGE_MIN` in `wrangler.toml` to see those timers fire.
9. Watch the logs with `npx wrangler tail`. Admin commands: `/trips`, `/trip T-0001`, `/log 30`, `/jobs`, `/now`, `/fire`, `/setstatus`.

## Untested against the real services

The local test fakes Telegram and Gemini, so these still need checking live:
- **Gemini schemas.** The `responseSchema` objects use uppercase `OBJECT`/`STRING` and `nullable`. If Gemini rejects them, adjust `src/gemini.js`.
- **Telegram uploads.** Multipart uploads (`tgUpload`) and an inline keyboard sent as a JSON string in FormData.
- **Large media.** Voice notes and PDFs are base64-encoded inside the Worker. On the free Workers plan a big file might hit the CPU limit; the $5 Workers plan fixes that.
- **Group mode.** `AGENT_MODE=group` with a real group, including `AGENT_TOPICS=true` (the group must be a forum and the bot an admin).

## Known gaps and possible next work

- **English messages.** The bot's fixed messages are English; Azizbek would need Uzbek or Russian. They live in `src/flow.js`.
- **Pausing the agent.** There's no way to tell the mock agent to stop other than cancelling the trip.
- **Missing flight time.** If the chosen offer has no `outbound_datetime`, no reminders are set; the bot says so, but there's no command to add the time later.
- **One trip at a time.** Only one open trip per owner (`activeTrip` takes the newest).
- **Not built.** The personal-secretary and EAS sections.
- **Outdated documents.** The original spec, design and slides in `original-docs/` describe the old Go/VPS/Claude stack and need updating if they will be shown to Azizbek.

## Rules

- Never commit secrets. Passport data is never sent to Gemini; only `/passport` stores it, encrypted.
- `npm test` must keep passing. Extend `test/run.mjs` when the flow changes.
