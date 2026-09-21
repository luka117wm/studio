"""Общие зависимости роутеров: пути и соединение с БД на запрос."""

import sqlite3
from typing import Annotated

from fastapi import Depends, Request

from app.storage.db import get_db
from app.storage.paths import StudioPaths


def get_paths(request: Request) -> StudioPaths:
    paths: StudioPaths = request.app.state.paths
    return paths


PathsDep = Annotated[StudioPaths, Depends(get_paths)]
DbDep = Annotated[sqlite3.Connection, Depends(get_db)]
