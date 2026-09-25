"""Профиль канала — `data/channels/<channel>/profile.json`.

Источник правды по каналу: имя, формат, бюджеты (принцип 6), квота голоса. Таблица `channels`
в SQLite — только реестр для внешних ключей. Потраченное и использованное — состояние, не
профиль: считается из `cost_ledger` и ответов провайдера (M2.7).
"""

from pydantic import Field

from app.models.director import Channel, EpisodeFormat, StrictModel


class Budgets(StrictModel):
    """Лимиты в USD: конфигурация, не накопление (накопление — в микродолларах, L-001)."""

    monthly_usd: float = Field(gt=0)
    per_episode_usd: float = Field(gt=0)
    animation_usd: float = Field(ge=0)


class VoiceQuota(StrictModel):
    limit_chars: int = Field(gt=0)


class ChannelProfile(StrictModel):
    id: Channel
    name: str
    format: EpisodeFormat
    budgets: Budgets
    voice_quota: VoiceQuota
