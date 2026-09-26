"""Пресет формата канала и смета выпуска для диалога «Новый выпуск».

Смета считается на каждый запрос через `Gateway.estimate` маршрутами профиля по умолчанию
(принципы 5, 6): смена профиля в `providers.yaml` или цены в `pricing.yaml` меняет сумму без
правок кода. Правила — `docs/slots.md`, раздел «Пресеты формата».
"""

import math

from fastapi import APIRouter, HTTPException

from app.api.deps import DbDep, FormatsDep, GatewayDep
from app.models.director import Channel, EpisodeFormat, StrictModel
from app.models.formats import EstimateVolumes, FormatPreset
from app.providers.base import CHARS_PER_TOKEN, Cost, ImageRequest, SpeechRequest, TextRequest
from app.providers.gateway import Gateway

router = APIRouter(tags=["formats"])


class EpisodeEstimate(StrictModel):
    """Смета выпуска: цена этапа на маршруте профиля по умолчанию и итог, микродоллары."""

    stages: list[Cost]
    usd_micro: int


class FormatPreview(StrictModel):
    channel: Channel
    format: EpisodeFormat
    preset: FormatPreset
    estimate: EpisodeEstimate
    # Цена хотя бы одной модели сметы сверялась давно — сверить `config/pricing.yaml`.
    stale_pricing: bool


def _times(cost: Cost, calls: int) -> Cost:
    """Цена `calls` одинаковых вызовов: у каждого своё округление, как в журнале."""
    lines = [
        line.model_copy(
            update={"quantity": line.quantity * calls, "usd_micro": line.usd_micro * calls}
        )
        for line in cost.lines
    ]
    return cost.model_copy(update={"lines": lines, "usd_micro": cost.usd_micro * calls})


def estimate_episode(
    gateway: Gateway, preset: FormatPreset, volumes: EstimateVolumes
) -> EpisodeEstimate:
    """Запросы того же объёма, что у выпуска: цена зависит только от количества единиц.
    Слова VO — целевые минуты × темп; кадры — `shots` отдельных вызовов."""
    words = preset.minutes.target * preset.words_per_minute
    script = gateway.estimate(
        "script",
        TextRequest(
            prompt="x" * (volumes.script_input_tokens * CHARS_PER_TOKEN),
            max_output_tokens=math.ceil(words * volumes.script_output_tokens_per_word),
        ),
    )
    image = gateway.estimate("images", ImageRequest(prompt="shot"))
    voice = gateway.estimate(
        "voice",
        SpeechRequest(
            text="x" * math.ceil(words * volumes.voice_chars_per_word), voice_id="estimate"
        ),
    )
    stages = [script, _times(image, preset.shots), voice]
    return EpisodeEstimate(stages=stages, usd_micro=sum(cost.usd_micro for cost in stages))


@router.get("/formats")
async def get_format(
    channel: Channel, db: DbDep, gateway: GatewayDep, formats: FormatsDep
) -> FormatPreview:
    row = db.execute("SELECT format FROM channels WHERE id = ?", (channel,)).fetchone()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=f"Канал «{channel}» не найден. Создайте каналы: python -m app.tools.seed",
        )
    episode_format = row["format"]
    preset = formats.formats[episode_format]
    estimate = estimate_episode(gateway, preset, formats.estimate)
    return FormatPreview(
        channel=channel,
        format=episode_format,
        preset=preset,
        estimate=estimate,
        stale_pricing=any(cost.stale_pricing for cost in estimate.stages),
    )
