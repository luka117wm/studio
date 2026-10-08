-- M4.8: бэклог идей канала. Контракт — docs/research.md, «Идеи».
-- id — i0001, i0002, …; source: manual (руками) | bridge (чат через мост);
-- status: proposed (предложил чат) | backlog | used (взята в выпуск, episode_id) | dropped (отброшена).
-- score — мнение чата 0–100, не данные; null — оценки нет. Идеи не удаляются: dropped вместо удаления.

CREATE TABLE ideas (
    id            TEXT PRIMARY KEY,
    channel       TEXT NOT NULL REFERENCES channels(id),
    title         TEXT NOT NULL,
    angle         TEXT NOT NULL DEFAULT '',
    hook_promise  TEXT NOT NULL DEFAULT '',
    summary       TEXT NOT NULL DEFAULT '',
    score         INTEGER CHECK (score IS NULL OR score BETWEEN 0 AND 100),
    score_reason  TEXT,
    source        TEXT NOT NULL CHECK (source IN ('manual', 'bridge')),
    status        TEXT NOT NULL CHECK (status IN ('proposed', 'backlog', 'used', 'dropped')),
    episode_id    TEXT REFERENCES episodes(id),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX ideas_channel_status ON ideas(channel, status);
