"""Общие зависимости роутеров: пути, БД на запрос, пул джобов, gateway, шаблоны промптов моста,
пресеты формата, настройки сходства с референсом, настройки канона (ракурсы, кадры стиля)."""

import sqlite3
from typing import Annotated

from fastapi import Depends, Request

from app.jobs.worker import JobPool
from app.models.canon_config import CanonConfig
from app.models.formats import FormatsConfig
from app.models.reference import ReferenceConfig
from app.pipeline.bridge import PromptLibrary
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


def get_prompts(request: Request) -> PromptLibrary:
    prompts: PromptLibrary = request.app.state.prompts
    return prompts


def get_formats(request: Request) -> FormatsConfig:
    formats: FormatsConfig = request.app.state.formats
    return formats


def get_reference_config(request: Request) -> ReferenceConfig:
    config: ReferenceConfig = request.app.state.reference
    return config


def get_canon_config(request: Request) -> CanonConfig:
    config: CanonConfig = request.app.state.canon
    return config


PathsDep = Annotated[StudioPaths, Depends(get_paths)]
ReferenceConfigDep = Annotated[ReferenceConfig, Depends(get_reference_config)]
CanonConfigDep = Annotated[CanonConfig, Depends(get_canon_config)]
FormatsDep = Annotated[FormatsConfig, Depends(get_formats)]
GatewayDep = Annotated[Gateway, Depends(get_gateway)]
PromptsDep = Annotated[PromptLibrary, Depends(get_prompts)]
JobsDep = Annotated[JobPool, Depends(get_jobs)]
DbDep = Annotated[sqlite3.Connection, Depends(get_db)]
