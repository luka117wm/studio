-- M5.3: ассет уровня канала — без выпуска (листы опорных портретов, кадры стиля). Контракт —
-- docs/providers.md, «Ассеты уровня канала (M5.3)». Кэш по (kind, input_hash) — один для обоих уровней.
-- SQLite не снимает NOT NULL через ALTER — таблица пересобирается. Канал прежних строк — канал
-- выпуска; строка без выпуска в базе остановит миграцию (NOT NULL), а не пропадёт молча.
CREATE TABLE assets_new (
    id          TEXT PRIMARY KEY,
    channel     TEXT NOT NULL REFERENCES channels(id),
    episode_id  TEXT REFERENCES episodes(id),
    shot_id     TEXT,
    kind        TEXT NOT NULL,
    version     INTEGER NOT NULL,
    path        TEXT NOT NULL,
    input_hash  TEXT NOT NULL,
    status      TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
INSERT INTO assets_new (id, channel, episode_id, shot_id, kind, version, path, input_hash, status,
                        created_at)
SELECT a.id, e.channel, a.episode_id, a.shot_id, a.kind, a.version, a.path, a.input_hash, a.status,
       a.created_at
FROM assets a LEFT JOIN episodes e ON e.id = a.episode_id;
DROP TABLE assets;
ALTER TABLE assets_new RENAME TO assets;
CREATE INDEX assets_episode_shot ON assets(episode_id, shot_id, kind);
CREATE INDEX assets_channel ON assets(channel, kind);
CREATE INDEX assets_cache ON assets(kind, input_hash);
