"""Джоб кадра `shot_image` (M6.2): один кадр выпуска, один вариант. Заказ, отрисовка и версия —
`pipeline/images/shot_job.py`; контракт — `docs/generation.md`, «Джоб кадра»."""

from app.jobs.worker import HandlerSpec
from app.pipeline.images.shot_job import SHOT_KIND, ShotOrder, cancel_shot, draw_shot, order_cost

SPEC = HandlerSpec(SHOT_KIND, draw_shot, ShotOrder, estimate=order_cost, on_cancel=cancel_shot)
