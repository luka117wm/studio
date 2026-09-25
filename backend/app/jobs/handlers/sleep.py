"""`sleep_job` — тестовый джоб: шаги со сном и прогрессом. Проверка очереди, отмены и SSE вручную
(`curl`) и в тестах; денег и GPU не тратит."""

import time

from pydantic import Field

from app.jobs.worker import HandlerSpec, JobContext
from app.models.director import StrictModel


class SleepPayload(StrictModel):
    steps: int = Field(default=5, ge=1, le=1000)
    step_s: float = Field(default=1.0, ge=0, le=60)
    # Падение перед этим шагом (не ретраится) — проверка «сбой элемента не валит пачку».
    fail_at_step: int | None = Field(default=None, ge=1)


def sleep_job(ctx: JobContext, payload: SleepPayload) -> dict[str, int]:
    for step in range(1, payload.steps + 1):
        if ctx.cancelled():
            return {"steps_done": step - 1}
        if payload.fail_at_step == step:
            raise RuntimeError(f"sleep_job: сбой на шаге {step} по заданию payload.fail_at_step")
        time.sleep(payload.step_s)
        ctx.progress(step / payload.steps, f"Шаг {step} из {payload.steps}")
    return {"steps_done": payload.steps}


SPEC = HandlerSpec(kind="sleep_job", fn=sleep_job, payload_model=SleepPayload)
