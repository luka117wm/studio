"""Джобы кадра: `shot_image` (M6.2) — один кадр выпуска, один вариант, с проверкой лица новой
версии (M6.5); `shot_check` (M6.5) — перепроверка выбранной версии. Заказ, отрисовка и версия —
`pipeline/images/shot_job.py`; пачка — `pipeline/images/batch.py`; перепроверка —
`pipeline/checks/shot_check.py`; контракт — `docs/generation.md`."""

from functools import partial

from app.jobs.worker import HandlerSpec
from app.pipeline.checks.face import FaceChecker
from app.pipeline.checks.shot_check import CHECK_KIND, ShotCheckOrder, finish_check, run_check
from app.pipeline.images.shot_job import (
    SHOT_KIND,
    ShotOrder,
    cancel_shot,
    draw_shot,
    finish_shot,
    order_cost,
)


def specs(images_parallel: int, checker: FaceChecker) -> list[HandlerSpec]:
    """Спеки видов: `shot_image` — не больше `images_parallel` одновременных из общего пула
    (M6.3); `shot_check` — по одному: модель лица одна на процесс, вызовы и так по очереди."""
    return [
        HandlerSpec(
            SHOT_KIND,
            partial(draw_shot, checker=checker),
            ShotOrder,
            estimate=order_cost,
            on_cancel=cancel_shot,
            max_parallel=images_parallel,
            on_finish=finish_shot,
        ),
        HandlerSpec(
            CHECK_KIND,
            partial(run_check, checker=checker),
            ShotCheckOrder,
            max_parallel=1,
            on_finish=finish_check,
        ),
    ]
