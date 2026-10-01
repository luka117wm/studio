"""Общие зависимости роутеров: пути, соединение с БД на запрос, пул джобов, gateway провайдеров."""

import sqlite3
from typing import Annotated

from fastapi import Depends, Request

from app.jobs.worker import JobPool
from app.models.formats import FormatsConfig
from app.providers.gateway import Gateway
from app.storage.db import get_db
from app.storage.paths import StudioPaths


def get_paths(request: Request) -> StudioPaths:
    paths: StudioPaths = request.app.state.paths
    return paths


def get_jobs(request: Request) -> JobPool:
    jobs: JobPool = request.app.state.jobs
    return jobs


def get_gateway(request: Request) -> Gateway:
    gateway: Gateway = request.app.state.gateway
    return gateway


def get_formats(request: Request) -> FormatsConfig:
    formats: FormatsConfig = request.app.state.formats
    return formats


PathsDep = Annotated[StudioPaths, Depends(get_paths)]
FormatsDep = Annotated[FormatsConfig, Depends(get_formats)]
GatewayDep = Annotated[Gateway, Depends(get_gateway)]
JobsDep = Annotated[JobPool, Depends(get_jobs)]
DbDep = Annotated[sqlite3.Connection, Depends(get_db)]
