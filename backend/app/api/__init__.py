"""Агрегатор роутеров: каждый модуль API подключается здесь под общим префиксом `/api`."""

from fastapi import APIRouter

from app.api import channels, director, episodes, health, projects

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(channels.router)
api_router.include_router(episodes.router)
api_router.include_router(projects.router)
api_router.include_router(director.router)
