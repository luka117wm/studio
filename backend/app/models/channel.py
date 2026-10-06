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


class ChannelVoice(StrictModel):
    """Голос канала для плана (устав M4, решение 4): код подставляет его в `director.voice`.

    Модель голоса — маршрут `voice` в `config/providers.yaml`, не профиль (принцип 5). Голос
    выбирается в модуле голоса, до него — `unset`.
    """

    voice_id: str = Field(default="unset", min_length=1)
    # Темп закадра; null — темп пресета формата (`config/formats.yaml → words_per_minute`).
    pace_wpm: int | None = Field(default=None, ge=100, le=200)


class ChannelProfile(StrictModel):
    id: Channel
    name: str
    format: EpisodeFormat
    budgets: Budgets
    voice_quota: VoiceQuota
    # Профили до M4.2 поля не имеют — читаются со значениями по умолчанию.
    voice: ChannelVoice = ChannelVoice()
