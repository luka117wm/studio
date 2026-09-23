-- M2.5: очередь джобов и журнал событий для SSE. Контракт — docs/jobs.md.
-- ADD COLUMN не умеет UNIQUE — уникальность ключа держит отдельный индекс; NULL не дедуплицируется.

ALTER TABLE jobs ADD COLUMN idempotency_key TEXT;
ALTER TABLE jobs ADD COLUMN batch_id TEXT;
ALTER TABLE jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN message TEXT;

CREATE UNIQUE INDEX jobs_idempotency ON jobs(idempotency_key);
CREATE INDEX jobs_batch ON jobs(batch_id);

-- Журнал событий: id — это id события SSE, по нему клиент догоняет пропущенное (Last-Event-ID),
-- в том числе после перезапуска бэкенда. Строка пишется в одной транзакции с переходом джоба.
CREATE TABLE job_events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      TEXT NOT NULL,
    job_id  TEXT NOT NULL REFERENCES jobs(id),
    type    TEXT NOT NULL,
    data    TEXT NOT NULL
);
CREATE INDEX job_events_ts ON job_events(ts);
