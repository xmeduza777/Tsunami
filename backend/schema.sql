CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, first_name TEXT NOT NULL DEFAULT '',
 credits INTEGER NOT NULL DEFAULT 0 CHECK(credits >= 0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
 template_id TEXT NOT NULL, cost INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','queued','processing','completed','failed')),
 image_key TEXT, result_url TEXT, error TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS jobs_by_user ON jobs(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS credit_transactions (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, amount INTEGER NOT NULL,
 reason TEXT NOT NULL, reference TEXT UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);