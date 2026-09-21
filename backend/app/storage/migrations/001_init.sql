-- Схема M2.3. Применённые миграции не правятся: изменения — новым файлом 002_*.sql.
-- Время — ISO 8601 UTC; деньги — микродоллары (L-001); медиа в БД нет — только пути и хэши.

CREATE TABLE channels (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    format      TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE episodes (
    id          TEXT PRIMARY KEY,
    channel     TEXT NOT NULL REFERENCES channels(id),
    title       TEXT NOT NULL,
    short_title TEXT,
    stage       TEXT NOT NULL DEFAULT 'idea',
    status      TEXT NOT NULL DEFAULT 'queued',
    slot_date   TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX episodes_channel ON episodes(channel);

-- Долгие операции (принцип 7): идемпотентны, переживают перезапуск. Форма payload/result — M2.5.
CREATE TABLE jobs (
    id          TEXT PRIMARY KEY,
    episode_id  TEXT REFERENCES episodes(id),
    kind        TEXT NOT NULL,
    status      TEXT NOT NULL,
    progress    REAL NOT NULL DEFAULT 0,
    payload     TEXT NOT NULL,
    result      TEXT,
    error       TEXT,
    created_at  TEXT NOT NULL,
    started_at  TEXT,
    finished_at TEXT
);
CREATE INDEX jobs_episode ON jobs(episode_id);
CREATE INDEX jobs_status ON jobs(status);

-- Кэш по хэшу входов (принцип 8): (kind, input_hash) → готовый ассет.
CREATE TABLE assets (
    id          TEXT PRIMARY KEY,
    episode_id  TEXT NOT NULL REFERENCES episodes(id),
    shot_id     TEXT,
    kind        TEXT NOT NULL,
    version     INTEGER NOT NULL,
    path        TEXT NOT NULL,
    input_hash  TEXT NOT NULL,
    status      TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX assets_episode_shot ON assets(episode_id, shot_id, kind);
CREATE INDEX assets_cache ON assets(kind, input_hash);

-- Каждый платный вызов — строка (принцип 6).
CREATE TABLE cost_ledger (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              TEXT NOT NULL,
    channel         TEXT NOT NULL REFERENCES channels(id),
    episode_id      TEXT REFERENCES episodes(id),
    stage           TEXT NOT NULL,
    job_id          TEXT REFERENCES jobs(id),
    provider        TEXT NOT NULL,
    model           TEXT NOT NULL,
    units           REAL NOT NULL,
    unit            TEXT NOT NULL,
    cost_micro_usd  INTEGER NOT NULL
);
CREATE INDEX cost_ledger_channel_ts ON cost_ledger(channel, ts);
CREATE INDEX cost_ledger_episode ON cost_ledger(episode_id);
