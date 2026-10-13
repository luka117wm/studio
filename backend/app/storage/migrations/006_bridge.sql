-- M4.1: журнал обменов моста через чат. Контракт — docs/bridge.md.
-- Строка — один промпт и ответ на него. task: plan | ideas | reference; target_id — то, о чём
-- обмен, кроме выпуска (референс). status: prompted (промпт выдан) | applied | failed.
-- errors — JSON-список {path, message}. Текст ответа чата здесь не хранится.

CREATE TABLE bridge_runs (
    id              TEXT PRIMARY KEY,
    task            TEXT NOT NULL,
    channel         TEXT NOT NULL REFERENCES channels(id),
    episode_id      TEXT REFERENCES episodes(id),
    target_id       TEXT,
    prompt_id       TEXT NOT NULL,
    prompt_version  INTEGER NOT NULL,
    prompt_hash     TEXT NOT NULL,
    part            INTEGER NOT NULL DEFAULT 1,
    parts_total     INTEGER NOT NULL DEFAULT 1,
    status          TEXT NOT NULL CHECK (status IN ('prompted', 'applied', 'failed')),
    errors          TEXT NOT NULL DEFAULT '[]',
    created_at      TEXT NOT NULL,
    answered_at     TEXT
);
CREATE INDEX bridge_runs_episode_task ON bridge_runs(episode_id, task, created_at);
CREATE INDEX bridge_runs_target ON bridge_runs(target_id, task, created_at);
