-- M3.2: в слоте один выпуск (решение 3 устава M3). Расписание одно на оба канала, поэтому
-- уникальность глобальная. Проверка с понятным текстом — в API; индекс страхует от гонки.

CREATE UNIQUE INDEX episodes_slot ON episodes(slot_date) WHERE slot_date IS NOT NULL;
