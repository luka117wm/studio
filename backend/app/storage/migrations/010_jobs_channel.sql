-- M5.4: канал джоба уровня канала — листы опорных портретов и кадры стиля идут без выпуска.
-- У джоба выпуска поле пустое: канал — у выпуска. Месячный бюджет считает оценки джобов в очереди
-- по COALESCE(jobs.channel, канал выпуска) — docs/providers.md, «Бюджеты».
ALTER TABLE jobs ADD COLUMN channel TEXT REFERENCES channels(id);
CREATE INDEX jobs_channel ON jobs(channel, status);
