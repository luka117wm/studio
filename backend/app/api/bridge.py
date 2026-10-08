"""Мост через чат: источник плана и журнал обменов. Контракт — `docs/bridge.md`.

Неверный ответ чата — `BridgeAnswerError`; обработчик ниже отдаёт его как `BridgeError` со
статусом 422 (подключается в `main.create_app`).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.api.deps import DbDep, GatewayDep
from app.pipeline.bridge import BridgeAnswerError, BridgeRun, BridgeTask, latest_runs
from app.pipeline.bridge.runs import LATEST_LIMIT
from app.providers.registry import PlanSource
from app.settings import Settings

router = APIRouter(tags=["bridge"])

REASON_NO_KEY = "Нет ключа ANTHROPIC_API_KEY — docs/api_keys.md"
# В M4 пути через API нет (устав M4): ключ появится — подключается отдельной сессией.
REASON_NOT_WIRED = "Claude API подключается отдельным этапом — пока ответы идут через мост."


class BridgeApiStatus(BaseModel):
    available: bool
    # Почему недоступен — для подсказки у выключенного сегмента «Claude API»; null — доступен.
    reason: str | None


class BridgeSettings(BaseModel):
    # Действующий источник: `api` из конфига при недоступном API — `bridge`.
    plan_source: PlanSource
    api: BridgeApiStatus


def bridge_settings(settings: Settings, configured: PlanSource) -> BridgeSettings:
    """Без ключа API недоступен, и мост остаётся единственным путём — старт это не ломает."""
    if not settings.anthropic_api_key.get_secret_value():
        api = BridgeApiStatus(available=False, reason=REASON_NO_KEY)
    else:
        api = BridgeApiStatus(available=False, reason=REASON_NOT_WIRED)
    source: PlanSource = "api" if configured == "api" and api.available else "bridge"
    return BridgeSettings(plan_source=source, api=api)


def effective_plan_source(request: Request) -> PlanSource:
    """Действующий источник плана для смет: `api` из конфига при недоступном API — `bridge`."""
    settings: Settings = request.app.state.settings
    configured: PlanSource = request.app.state.gateway.registry.config.plan_source
    return bridge_settings(settings, configured).plan_source


PlanSourceDep = Annotated[PlanSource, Depends(effective_plan_source)]


@router.get("/bridge/settings")
async def get_bridge_settings(request: Request, gateway: GatewayDep) -> BridgeSettings:
    settings: Settings = request.app.state.settings
    return bridge_settings(settings, gateway.registry.config.plan_source)


@router.get("/bridge/runs")
async def get_bridge_runs(
    db: DbDep,
    episode_id: str | None = None,
    task: BridgeTask | None = None,
    limit: int = Query(default=LATEST_LIMIT, ge=1, le=100),
) -> list[BridgeRun]:
    """Последние обмены, новые первыми; фильтры по выпуску и задаче."""
    return latest_runs(db, episode_id=episode_id, task=task, limit=limit)


async def bridge_answer_error(request: Request, exc: Exception) -> JSONResponse:
    """`BridgeAnswerError` → 422 `BridgeError {message, hint, errors[]}`."""
    if not isinstance(exc, BridgeAnswerError):  # регистрируется только на этот тип
        raise exc
    return JSONResponse(status_code=422, content=exc.to_model().model_dump(mode="json"))
