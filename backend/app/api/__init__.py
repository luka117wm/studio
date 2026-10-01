"""Агрегатор роутеров: каждый модуль API подключается здесь под общим префиксом `/api`."""

from fastapi import APIRouter

from app.api import (
    channels,
    cost,
    director,
    episodes,
    formats,
    health,
    jobs,
    projects,
    providers,
    slots,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(channels.router)
api_router.include_router(episodes.router)
api_router.include_router(slots.router)
api_router.include_router(formats.router)
api_router.include_router(projects.router)
api_router.include_router(director.router)
api_router.include_router(jobs.router)
api_router.include_router(cost.router)
api_router.include_router(providers.router)
