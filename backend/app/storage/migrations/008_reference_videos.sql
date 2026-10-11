-- M4.10: референсы канала — ролики, чью структуру разбирает чат через мост. Контракт — docs/research.md,
-- «Референс». `references` — зарезервированное слово SQL, отсюда имя таблицы.
-- id — ref0001, …; url может быть пустым (ссылка только хранится, сеть не используется);
-- subtitles — исходный текст как вставлен (SRT, VTT, расшифровка YouTube); title и author — из разбора чата;
-- analysis — JSON разбора (сегменты, приёмы) или NULL, пока не разобран.

CREATE TABLE reference_videos (
    id           TEXT PRIMARY KEY,
    channel      TEXT NOT NULL REFERENCES channels(id),
    url          TEXT NOT NULL DEFAULT '',
    title        TEXT NOT NULL DEFAULT '',
    author       TEXT NOT NULL DEFAULT '',
    duration_s   REAL NOT NULL CHECK (duration_s > 0),
    subtitles    TEXT NOT NULL,
    analysis     TEXT,
    created_at   TEXT NOT NULL,
    analyzed_at  TEXT
);
CREATE INDEX reference_videos_channel ON reference_videos(channel, created_at);
