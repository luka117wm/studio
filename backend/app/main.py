"""Фабрика приложения. Точка входа для uvicorn — модульный `app`."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import api_router
from app.log import configure_logging
from app.settings import Settings
from app.storage.db import migrate
from app.storage.paths import StudioPaths

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    paths: StudioPaths = app.state.paths
    paths.root.mkdir(parents=True, exist_ok=True)
    log.info("data dir: %s", paths.root)
    applied = migrate(paths.db_path)
    log.info("db: %s, migrations applied: %s", paths.db_path, applied or "none")
    yield


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)

    app = FastAPI(title="Studio", version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.paths = StudioPaths(settings.studio_data_dir)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router)
    return app


app = create_app()
