# Trip bot

A Telegram assistant for Azizbek. He sends a message or voice note ("Istanbul, 12 to 15 Nov, morning flight"), approves a request card, picks one of the agent's options, and gets his tickets, a calendar file and reminders in the same chat.

It runs on one Cloudflare Worker, a D1 database and the Gemini API. There is no server to rent.

## The travel agent: mock or real

- **`AGENT_MODE = "mock"`** (the default): no real agent is involved. A fake agent answers after `MOCK_DELAY_MIN` minutes:
  - it writes three options as free text, like a person would;
  - about half the time it forgets the cancellation terms for one option, so you see the bot ask for them;
  - it answers that question, then "books" and sends test PDFs.

  Its replies go through the same code a real agent's messages do. The agent-group conversation is copied into your chat in italics so you can follow it.
- **`AGENT_MODE = "group"`**: the bot talks to a real Telegram group. Add the bot to the group and type `/chatid` there to get the ID for `AGENT_CHAT_ID`. If the group has Topics turned on and the bot is an admin, set `AGENT_TOPICS = "true"` to give each trip its own topic.

## Setup (about 15 minutes)

You need a Cloudflare account, a Gemini API key from a project with billing turned on, and Node 18 or newer.

1. **Create the bot.** In Telegram, open @BotFather, send `/newbot`, and copy the token.
2. **Install dependencies and log in:**
   ```
   npm install
   npx wrangler login
   ```
3. **Create the database.** Run this, then copy the `database_id` it prints into `wrangler.toml`:
   ```
   npx wrangler d1 create trip-bot
   ```
   Then load the tables:
   ```
   npx wrangler d1 execute trip-bot --remote --file=schema.sql
   ```
4. **Add the secrets.** Each command asks for a value:
   ```
   npx wrangler secret put TELEGRAM_TOKEN    # from BotFather
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put WEBHOOK_SECRET    # any long random string, letters and digits only
   npx wrangler secret put PASSPORT_KEY      # output of: openssl rand -base64 32
   ```
5. **Deploy and connect the bot to Telegram:**
   ```
   npx wrangler deploy
   ```
   Then open `https://<your-worker>.workers.dev/setup?key=<WEBHOOK_SECRET>` in a browser. It points Telegram at the Worker and sets the command menu.
6. **Make the bot yours.** Message the bot. It replies with your Telegram ID. Put that ID in `OWNER_ID` and `ADMIN_ID` in `wrangler.toml`, then run `npx wrangler deploy` again.

## Testing it yourself

- **Save a passport (optional).** Send `/passport FULL NAME, FA1234567, valid until 2031-05-01`. The bot encrypts it and deletes your message. Use fake details while testing.
- **Start a trip.** Send a request as text or a voice note, in Uzbek, Russian or English. A vague request ("Dubai next week") makes the bot ask for what's missing.
- **Run the flow.** Approve the card, wait for the mock agent (or send `/now` to make it answer right away), pick an option, and wait for the documents.
- **Speed up the timers.** In `wrangler.toml`, lower `AGENT_SLA_MIN` (agent-late reminder) and `NUDGE_MIN` (reminders to approve or choose), then redeploy.
- **Trigger flight reminders now.** Flight reminders fire 24 hours and 3 hours before departure. `/fire T-0001` sends them immediately.

Admin commands (from `ADMIN_ID`):

| Command | What it does |
| --- | --- |
| `/trips` | List recent trips |
| `/trip T-0001` | Show one trip's full record |
| `/log 30` | Show the last 30 entries of the audit log |
| `/jobs` | Show the mock agent's pending replies |
| `/now` | Make the mock agent's pending replies arrive within a minute |
| `/fire T-0001` | Send that trip's pending reminders now |
| `/setstatus T-0001 booked` | Fix a stuck trip by setting its status |

Errors are sent to `ADMIN_ID` as they happen.

`npm test` runs the whole flow locally, with Telegram and Gemini faked and SQLite standing in for D1.

## How it fits together

| File | Job |
| --- | --- |
| `src/index.js` | Telegram webhook, `/setup`, and the cron entry. It answers Telegram right away and does the slow work afterwards. |
| `src/flow.js` | The trip flow. Each trip moves `collecting → draft → sent → offers → chosen → booked → done`, or to `cancelled`. Also the buttons, commands and scheduled checks. |
| `src/gemini.js` | The three Gemini calls: request details from text or voice, options from the agent's text, PDF or photo, and a short transcription. |
| `src/agent.js` | Where agent messages go: the real group, or the mock. |
| `src/mock.js` | The fake agent. |
| `src/files.js` | The calendar `.ics` file and the test PDFs. |
| `schema.sql` | Tables: `trips`, `travelers` (passport encrypted with AES-GCM), `documents` (Telegram `file_id` only), `reminders`, `jobs` (mock agent), `events` (audit log), `updates` (drops duplicate webhooks). |

The cron runs every minute. It delivers mock-agent replies, reminds a late agent, nudges an unanswered request or unchosen options, sends flight reminders, and closes finished trips.

## Notes

- **Language.** Uzbek or Russian, chosen with flag buttons on first contact and switched any time with `/uz` or `/ru`. He can write or speak in Uzbek, Russian or English either way. Messages to the travel agent use `AGENT_LANG` (`uz` or `ru`). Admin commands and error alerts are in English. All strings are in `src/i18n.js`.
- **Gemini model.** Check that `GEMINI_MODEL` is still a current model name in Google AI Studio before deploying. If it was retired, change it to the current Flash model.
- **Cost.** One trip makes about 3 to 6 Gemini calls. The Cloudflare free plan covers the Worker, a cron trigger every minute, and D1 at this size. If a large voice note or PDF ever hits the free plan's CPU limit, the $5/month Workers plan removes it.
- **Not built yet.** The personal-secretary and EAS sections from the original plan.
