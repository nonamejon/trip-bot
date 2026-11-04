-- Trip bot database (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS trips (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id        INTEGER NOT NULL,
  status          TEXT    NOT NULL,              -- collecting | draft | sent | offers | chosen | booked | done | cancelled
  fields          TEXT    NOT NULL DEFAULT '{}', -- request details (JSON)
  offers          TEXT    NOT NULL DEFAULT '[]', -- parsed agent options (JSON)
  agent_texts     TEXT    NOT NULL DEFAULT '[]', -- raw agent messages for the current round (JSON)
  recommended     INTEGER,
  reason          TEXT,
  chosen          INTEGER,
  agent_thread_id INTEGER,                       -- forum topic id in the agent group, if topics are used
  clarify_asked   INTEGER NOT NULL DEFAULT 0,
  draft_at        INTEGER,
  nudged          INTEGER NOT NULL DEFAULT 0,
  sent_at         INTEGER,
  due_at          INTEGER,
  sla_reminded    INTEGER NOT NULL DEFAULT 0,
  offers_at       INTEGER,
  nudged_offers   INTEGER NOT NULL DEFAULT 0,
  flight_at       INTEGER,
  done_at         INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trips_owner_status ON trips(owner_id, status);

CREATE TABLE IF NOT EXISTS travelers (
  telegram_id  INTEGER PRIMARY KEY,
  name         TEXT,
  passport_enc TEXT,                              -- AES-GCM ciphertext, key is the PASSPORT_KEY secret
  updated_at   INTEGER
);

-- People the owner gave access with the "Give access" button (in addition to ADMIN_ID in wrangler.toml)
CREATE TABLE IF NOT EXISTS members (
  telegram_id INTEGER PRIMARY KEY,
  username    TEXT,
  name        TEXT,
  added_at    INTEGER NOT NULL
);

-- Usernames the owner invited (/invite @username): the first message from that username gives access automatically
CREATE TABLE IF NOT EXISTS invites (
  username   TEXT PRIMARY KEY COLLATE NOCASE,     -- without the @
  created_at INTEGER NOT NULL
);

-- Per-person settings: chosen language ('uz' | 'ru')
CREATE TABLE IF NOT EXISTS prefs (
  telegram_id INTEGER PRIMARY KEY,
  lang        TEXT NOT NULL,
  updated_at  INTEGER,
  mode        TEXT,                               -- what the next message is for: translate | letter | revise | agent | flight_time | clarify
  mode_arg    TEXT,
  mode_at     INTEGER,                            -- modes expire after a while
  brief_date  TEXT                                -- last local date the morning brief was sent
);

-- The conversation with the owner (both directions), kept 30 days: context for Gemini and for debugging
CREATE TABLE IF NOT EXISTS chat_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  dir      TEXT NOT NULL,                         -- in (from him) | out (from the bot)
  text     TEXT NOT NULL,
  ts       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_log_owner ON chat_log(owner_id, id);

-- Personal secretary: calendar events
CREATE TABLE IF NOT EXISTS cal_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   INTEGER NOT NULL,
  title      TEXT NOT NULL,
  start_at   INTEGER NOT NULL,                    -- UTC ms; for all-day events, local midnight
  end_at     INTEGER,
  all_day    INTEGER NOT NULL DEFAULT 0,
  location   TEXT,
  notes      TEXT,
  remind_at  INTEGER,                             -- when to send the heads-up (null = none)
  reminded   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cal_events_owner_start ON cal_events(owner_id, start_at);

-- Personal secretary: reminders ("remind me at 9 to call Bobur")
CREATE TABLE IF NOT EXISTS user_reminders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   INTEGER NOT NULL,
  text       TEXT NOT NULL,
  due_at     INTEGER NOT NULL,
  repeat     TEXT NOT NULL DEFAULT 'none',        -- none | daily | weekdays | weekly | monthly
  done       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS user_reminders_due ON user_reminders(done, due_at);

-- Personal secretary: drafted letters (kept so they can be revised or translated)
CREATE TABLE IF NOT EXISTS letters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   INTEGER NOT NULL,
  request    TEXT,
  subject    TEXT,
  body       TEXT NOT NULL,
  lang       TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id    INTEGER NOT NULL,
  name       TEXT,
  file_id    TEXT NOT NULL,                       -- Telegram keeps the file; we keep only its id
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL,
  type    TEXT NOT NULL,                          -- checkin | leave
  due_at  INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS reminders_due ON reminders(sent_at, due_at);

-- Delayed work for the mock travel agent (empty when a real agent group is used)
CREATE TABLE IF NOT EXISTS jobs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  kind    TEXT NOT NULL,
  trip_id INTEGER NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  due_at  INTEGER NOT NULL,
  done_at INTEGER
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(done_at, due_at);

-- Audit log: who did what, when
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  actor   TEXT NOT NULL,                          -- owner | agent | bot | cron | admin
  action  TEXT NOT NULL,
  trip_id INTEGER,
  detail  TEXT
);

-- Telegram retries a webhook it thinks failed; this stops double handling
CREATE TABLE IF NOT EXISTS updates (
  update_id  INTEGER PRIMARY KEY,
  ts         INTEGER NOT NULL,
  chat_id    INTEGER,                             -- the owner's chat, for the "never silent" watchdog
  done_at    INTEGER,                             -- set when handling finished (with or without an error)
  apologized INTEGER NOT NULL DEFAULT 0           -- the watchdog told him it was lost
);
