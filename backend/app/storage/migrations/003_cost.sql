-- M2.6: журнал расходов и оценка платных джобов. Контракт — docs/providers.md.

-- Строка журнала — единица учёта одного вызова: `quantity` штук `unit` (было `units`).
-- `status`: estimated (резерв на время вызова) | charged | cached | refused | failed;
-- строки одного вызова связаны `call_id`; `variant` — вариант цены (разрешение картинки или видео).
ALTER TABLE cost_ledger RENAME COLUMN units TO quantity;
ALTER TABLE cost_ledger ADD COLUMN variant TEXT;
ALTER TABLE cost_ledger ADD COLUMN status TEXT NOT NULL DEFAULT 'charged';
ALTER TABLE cost_ledger ADD COLUMN call_id TEXT;
ALTER TABLE cost_ledger ADD COLUMN input_hash TEXT;
CREATE INDEX cost_ledger_call ON cost_ledger(call_id);

-- Оценка платного джоба при постановке: пока он `queued`, она входит в потраченное бюджета —
-- пачка упрётся в лимит на том джобе, который его превышает, а не после оплаты.
ALTER TABLE jobs ADD COLUMN cost_usd_micro INTEGER;
ALTER TABLE jobs ADD COLUMN cost_stage TEXT;
