"""Агрегатор роутеров: каждый модуль API подключается здесь под общим префиксом `/api`."""

from fastapi import APIRouter

from app.api import channels, cost, director, episodes, health, jobs, projects, providers

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(channels.router)
api_router.include_router(episodes.router)
api_router.include_router(projects.router)
api_router.include_router(director.router)
api_router.include_router(jobs.router)
api_router.include_router(cost.router)
api_router.include_router(providers.router)
