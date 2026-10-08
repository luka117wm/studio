"""Профиль канала — `data/channels/<channel>/profile.json`.

Источник правды по каналу: имя, формат, бюджеты (принцип 6), квота голоса. Таблица `channels`
в SQLite — только реестр для внешних ключей. Потраченное и использованное — состояние, не
профиль: считается из `cost_ledger` и ответов провайдера (M2.7).
"""

from typing import Annotated

from pydantic import AfterValidator, Field
from pydantic_core import PydanticCustomError

from app.models.director import Channel, EpisodeFormat, StrictModel

SEEDS_MAX = 20
SEED_MAX_CHARS = 80


class Budgets(StrictModel):
    """Лимиты в USD: конфигурация, не накопление (накопление — в микродолларах, L-001)."""

    monthly_usd: float = Field(gt=0)
    per_episode_usd: float = Field(gt=0)
    animation_usd: float = Field(ge=0)


class VoiceQuota(StrictModel):
    limit_chars: int = Field(gt=0)


class ChannelVoice(StrictModel):
    """Голос канала для плана (устав M4, решение 4): код подставляет его в `director.voice`.

    Модель голоса — маршрут `voice` в `config/providers.yaml`, не профиль (принцип 5). Голос
    выбирается в модуле голоса, до него — `unset`.
    """

    voice_id: str = Field(default="unset", min_length=1)
    # Темп закадра; null — темп пресета формата (`config/formats.yaml → words_per_minute`).
    pace_wpm: int | None = Field(default=None, ge=100, le=200)


def _no_seeds(value: list[str]) -> bool:
    return not value


def _clean_seeds(value: list[str]) -> list[str]:
    """Семена ниши: строки после `strip`, пустые выбрасываются; до 20, до 80 знаков, без повторов
    без учёта регистра. Ошибка — одна фраза с тем, что исправить (L-022)."""
    seeds = [seed.strip() for seed in value if seed.strip()]
    if len(seeds) > SEEDS_MAX:
        raise PydanticCustomError(
            "seeds_too_many",
            "Семян {count}, а можно не больше {max} — уберите лишние.",
            {"count": len(seeds), "max": SEEDS_MAX},
        )
    seen: set[str] = set()
    for seed in seeds:
        if len(seed) > SEED_MAX_CHARS:
            raise PydanticCustomError(
                "seed_too_long",
                "Семя «{seed}» длиннее {max} знаков — сократите его до пары слов.",
                {"seed": seed[:40] + "…", "max": SEED_MAX_CHARS},
            )
        key = seed.casefold()
        if key in seen:
            raise PydanticCustomError(
                "seed_duplicate", "Семя «{seed}» повторяется — оставьте одно.", {"seed": seed}
            )
        seen.add(key)
    return seeds


Seeds = Annotated[list[str], AfterValidator(_clean_seeds)]


class ChannelProfile(StrictModel):
    id: Channel
    name: str
    format: EpisodeFormat
    budgets: Budgets
    voice_quota: VoiceQuota
    # Профили до M4.2 поля не имеют — читаются со значениями по умолчанию.
    voice: ChannelVoice = ChannelVoice()
    # Семена ниши для промпта идей (M4.8): короткие строки. Пустой список не выгружается — в TS поле
    # необязательно, пока его не покажет экран идей (L-033).
    seeds: list[str] = Field(default_factory=list, exclude_if=_no_seeds)


class ChannelPatch(StrictModel):
    """Тело `PATCH /api/channels/{id}`: пока только семена ниши; профиль пишется атомарно."""

    seeds: Seeds
