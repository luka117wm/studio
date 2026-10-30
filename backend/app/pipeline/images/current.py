"""Версия кадра по действующему запросу (M6.11; устав M6, решение 9).

Версия кадра помнит хэш входов своего запроса (`Asset.hash`): промпт, negative, референсы, seed,
модель (принцип 8). Действующий запрос кадра собирает тот же сборщик (`build_shot_request`) — по
действующему плану (версия плюс правки) и канону `canon_ref` текущей версии, с вариантом и моделью
версии. Хэши совпали — версия нарисована по тому, что сейчас в плане и каноне; нет — устарела, даже
если кадр не `stale` (сменился фас облика, промпт правили, пока джоб рисовал). Сборка с проблемами,
модель не из каталога, кадра нет в плане — не совпадает.

Годная картинка — выбранная версия есть, кадр не `stale` и не `failed`, её хэш совпал с действующим
запросом. Кадры с годной картинкой смета плана не считает («Уже нарисовано»); версия по
действующему запросу выбирается сама (`shot_assets`, джоб кадра); `GET …/images` отдаёт номера
таких версий (`matches_plan`). Контракт — `docs/generation.md`, «Версия по действующему запросу».
"""

import logging
from collections.abc import Callable

from app.models.canon_config import CanonConfig
from app.models.director import Director
from app.models.project import Asset, Project, ShotState, image_asset_id
from app.pipeline.canon.episode_canon import plan_canon_ref
from app.pipeline.director_import import PlanShot, effective_plan
from app.pipeline.images.prompt_builder import build_shot_request
from app.providers.base import RouteError
from app.providers.gateway import Gateway
from app.storage.atomic import read_json
from app.storage.paths import StudioPaths

log = logging.getLogger(__name__)


class CurrentRequests:
    """Хэши действующих запросов кадров выпуска: каждый (кадр, вариант, модель) собирается один
    раз. Снимок плана и правок — на момент создания; канон читается при сборке."""

    def __init__(
        self,
        paths: StudioPaths,
        gateway: Gateway,
        config: CanonConfig,
        *,
        channel: str,
        project: Project,
        director: Director,
    ) -> None:
        self.paths = paths
        self.gateway = gateway
        self.config = config
        self.channel = channel
        self.episode_id = project.episode_id
        self.canon_ref = plan_canon_ref(director)
        self.shots: dict[str, PlanShot] = {
            shot.id: shot
            for shot in effective_plan(director, project).shots
            if shot.status != "removed"
        }
        self._hashes: dict[tuple[str, int, str | None], str | None] = {}

    def hash_of(self, shot_id: str, variant: int = 1, model: str | None = None) -> str | None:
        """Хэш действующего запроса кадра; None — кадра нет в плане, модели нет в каталоге или
        запрос не собирается (проблемы канона, стоп-лист)."""
        key = (shot_id, variant, model)
        if key not in self._hashes:
            self._hashes[key] = self._build(shot_id, variant, model)
        return self._hashes[key]

    def matches(self, shot_id: str, asset: Asset) -> bool:
        """Версия нарисована по действующему запросу кадра: тот же вариант и модель дают её хэш."""
        return asset.hash == self.hash_of(shot_id, asset.variant or 1, asset.model)

    def _build(self, shot_id: str, variant: int, model: str | None) -> str | None:
        shot = self.shots.get(shot_id)
        if shot is None:
            return None
        try:
            built = build_shot_request(
                self.paths,
                self.gateway,
                self.config,
                episode_id=self.episode_id,
                channel=self.channel,
                canon_ref=self.canon_ref,
                shot=shot,
                variant=variant,
                model=model,
            )
        except RouteError:
            return None
        return built.prompt.input_hash


def has_valid_image(requests: CurrentRequests, project: Project, shot_id: str) -> bool:
    """Годная картинка: выбрана версия, кадр без причин `stale` и сбоя, хэш — действующий."""
    state = project.shots.get(shot_id, ShotState())
    if state.image_version is None or state.stale_reasons or state.error is not None:
        return False
    if state.status in ("stale", "failed", "removed"):
        return False
    asset = project.assets.get(image_asset_id(shot_id, state.image_version))
    return asset is not None and requests.matches(shot_id, asset)


def drawn_shots(requests: CurrentRequests, project: Project) -> set[str]:
    """Кадры действующего плана с годной картинкой — их смета плана не считает."""
    return {shot_id for shot_id in requests.shots if has_valid_image(requests, project, shot_id)}


def read_director(paths: StudioPaths, channel: str, project: Project) -> Director | None:
    """Текущая версия плана из `director/vNNN.json`; плана нет — None."""
    version = project.director_version
    if version is None:
        return None
    path = paths.director_version_path(channel, project.episode_id, int(version[1:]))
    return Director.model_validate(read_json(path))


def drawn_by_current(
    paths: StudioPaths,
    gateway: Gateway,
    config: CanonConfig,
    *,
    channel: str,
    shot_id: str,
    variant: int,
    model: str,
    input_hash: str,
) -> Callable[[Project], bool]:
    """Правило выбора новой версии джобом кадра: версия выбирается сама, только если нарисована по
    действующему запросу. Проверка зовётся под замком project.json (`shot_assets`) со свежим
    снимком: правка, пришедшая, пока джоб рисовал, уже в нём. Сбой сверки — не выбирать: человек
    выберет сам."""

    def current(project: Project) -> bool:
        try:
            director = read_director(paths, channel, project)
            if director is None:
                return False
            requests = CurrentRequests(
                paths, gateway, config, channel=channel, project=project, director=director
            )
            return requests.hash_of(shot_id, variant, model) == input_hash
        except Exception:
            log.exception("current request of %s/%s failed", project.episode_id, shot_id)
            return False

    return current
