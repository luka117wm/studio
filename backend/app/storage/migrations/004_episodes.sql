-- M3.1: происхождение выпуска и индекс доски. Контракт — docs/episodes.md.
-- origin: backlog (из бэклога идей) | reference (по референсу) | blank (с нуля); задаётся при создании.

ALTER TABLE episodes ADD COLUMN origin TEXT NOT NULL DEFAULT 'blank';

CREATE INDEX episodes_channel_stage ON episodes(channel, stage);
