"""Джоб кадра `shot_image` (M6.2): один кадр выпуска, один вариант. Заказ, отрисовка и версия —
`pipeline/images/shot_job.py`; пачка — `pipeline/images/batch.py`; контракт —
`docs/generation.md`."""

from app.jobs.worker import HandlerSpec
from app.pipeline.images.shot_job import (
    SHOT_KIND,
    ShotOrder,
    cancel_shot,
    draw_shot,
    finish_shot,
    order_cost,
)


def spec(images_parallel: int) -> HandlerSpec:
    """Спека вида: не больше `images_parallel` одновременных из общего пула (M6.3)."""
    return HandlerSpec(
        SHOT_KIND,
        draw_shot,
        ShotOrder,
        estimate=order_cost,
        on_cancel=cancel_shot,
        max_parallel=images_parallel,
        on_finish=finish_shot,
    )
