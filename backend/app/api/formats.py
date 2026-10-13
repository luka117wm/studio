"""Пресет формата канала и смета выпуска для диалога «Новый выпуск».

Смета считается на каждый запрос через `Gateway.estimate` маршрутами профиля по умолчанию
(принципы 5, 6): смена профиля в `providers.yaml` или цены в `pricing.yaml` меняет сумму без
правок кода. Сценарий при мосте через чат — $0 с `via: bridge` (устав M4, решение 2). Правила —
`docs/slots.md`, раздел «Пресеты формата».
"""

import math

from fastapi import APIRouter, HTTPException

from app.api.bridge import PlanSourceDep
from app.api.deps import DbDep, FormatsDep, GatewayDep
from app.models.director import Channel, EpisodeFormat, StrictModel
from app.models.formats import EstimateVolumes, FormatPreset
from app.pipeline.script.estimate import StageCost, script_cost, stage_cost
from app.providers.base import ImageRequest, SpeechRequest
from app.providers.gateway import Gateway
from app.providers.registry import PlanSource
from app.tools.seed import SEED_COMMAND

router = APIRouter(tags=["formats"])


class EpisodeEstimate(StrictModel):
    """Смета выпуска: цена этапа на маршруте профиля по умолчанию и итог, микродоллары."""

    stages: list[StageCost]
    usd_micro: int


class FormatPreview(StrictModel):
    channel: Channel
    format: EpisodeFormat
    preset: FormatPreset
    estimate: EpisodeEstimate
    # Цена хотя бы одной модели сметы сверялась давно — сверить `config/pricing.yaml`.
    stale_pricing: bool


def estimate_episode(
    gateway: Gateway, preset: FormatPreset, volumes: EstimateVolumes, plan_source: PlanSource
) -> EpisodeEstimate:
    """Запросы того же объёма, что у выпуска: цена зависит только от количества единиц.
    Слова VO — целевые минуты × темп; кадры — `shots` отдельных вызовов."""
    words = preset.minutes.target * preset.words_per_minute
    script = script_cost(gateway, volumes, words, plan_source)
    image = gateway.estimate("images", ImageRequest(prompt="shot"))
    voice = gateway.estimate(
        "voice",
        SpeechRequest(
            text="x" * math.ceil(words * volumes.voice_chars_per_word), voice_id="estimate"
        ),
    )
    stages = [script, stage_cost(image, preset.shots), stage_cost(voice)]
    return EpisodeEstimate(stages=stages, usd_micro=sum(cost.usd_micro for cost in stages))


@router.get("/formats")
async def get_format(
    channel: Channel,
    db: DbDep,
    gateway: GatewayDep,
    formats: FormatsDep,
    plan_source: PlanSourceDep,
) -> FormatPreview:
    row = db.execute("SELECT format FROM channels WHERE id = ?", (channel,)).fetchone()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=f"Канал «{channel}» не найден. Создайте каналы: {SEED_COMMAND}",
        )
    episode_format = row["format"]
    preset = formats.formats[episode_format]
    estimate = estimate_episode(gateway, preset, formats.estimate, plan_source)
    return FormatPreview(
        channel=channel,
        format=episode_format,
        preset=preset,
        estimate=estimate,
        stale_pricing=any(cost.stale_pricing for cost in estimate.stages),
    )
