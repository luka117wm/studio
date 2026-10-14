"""«Утвердить план» (M4.6): проверки перед стадией «Генерация» (принцип 10, устав M4, решение 8).

Проверки — список `CHECKS`: функция от `ApprovalSubject` возвращает проблемы, пустой список —
можно утверждать. Сходство VO с референсом (принцип 11, M4.10) — `not_like_reference`; канон выпуска
(устав M5, решение 8) — `canon_ready`. Сами проверки ничего не пишут; утверждение не ставит джобов и
не резервирует бюджет — это M6. Контракт — `docs/episodes.md`, «Утверждение плана».
"""

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field

from app.pipeline.canon.episode_canon import CanonIssue, CanonTarget, EpisodeCanon
from app.pipeline.director_import import EffectivePlan
from app.pipeline.research.similarity import percent, similarity
from app.pipeline.script.plan_bridge import plural

ApprovalCheck = Literal["stage", "plan", "vo", "prompt", "similarity", "canon"]

# Стадии, на которых план можно утвердить. Позже идёт генерация — что делать с планом там, решит M6.
APPROVABLE_STAGES = ("idea", "script", "generate")
STAGE_TITLES = {
    "idea": "Идея",
    "script": "Сценарий",
    "generate": "Генерация",
    "edit": "Монтаж",
    "export": "Экспорт",
    "publish": "Публикация",
}
# Проверка кадров → чего кадру не хватает, для сводки «2 кадра без VO: s063, s071».
_WITHOUT: dict[str, str] = {"vo": "без VO", "prompt": "без промпта"}
# Сколько id кадров перечислять в сводке; остальные — числом.
SHOWN_SHOTS = 8


def _is_none(value: object) -> bool:
    return value is None


class ApprovalProblem(BaseModel):
    check: ApprovalCheck
    shot_id: str | None  # null — проблема плана целиком
    message: str
    # У проверки `canon` — сущность канона и вид проблемы: по ним сводка и ссылка на экран 12.
    canon: CanonTarget | None = Field(default=None, exclude_if=_is_none)


class ApprovalRefusal(BaseModel):
    """Тело 409 «Утвердить план» (`detail`): сводка для пользователя и проблемы по кадрам."""

    code: Literal["plan_not_ready"] = "plan_not_ready"
    message: str
    problems: list[ApprovalProblem]


@dataclass(frozen=True)
class ReferenceText:
    """Текст реплик референса выпуска и правило сходства из `config/reference.yaml`."""

    text: str
    ngram: int
    threshold: float


@dataclass(frozen=True)
class ApprovalSubject:
    """Что утверждается: стадия выпуска, действующий план, недособранный набор частей, референс."""

    stage: str
    plan: EffectivePlan | None  # null — версии плана ещё нет
    staged_parts: list[int] = field(default_factory=list)  # номера принятых частей набора
    parts_total: int = 0  # частей в наборе; 0 — набора нет
    reference: ReferenceText | None = None  # выпуск по референсу (`brief.reference_id`)
    canon: EpisodeCanon | None = None  # канон текущей версии плана; null — версии плана нет


Check = Callable[[ApprovalSubject], list[ApprovalProblem]]


def stage_open(subject: ApprovalSubject) -> list[ApprovalProblem]:
    if subject.stage in APPROVABLE_STAGES:
        return []
    title = STAGE_TITLES.get(subject.stage, subject.stage)
    return [
        ApprovalProblem(
            check="stage",
            shot_id=None,
            message=f"Выпуск уже на стадии «{title}» — план утверждается до начала генерации.",
        )
    ]


def plan_assembled(subject: ApprovalSubject) -> list[ApprovalProblem]:
    """Утверждается версия плана — она собрана целиком по построению. Нет версии — нечего
    утверждать; недособранный набор частей при готовой версии не мешает (утверждается версия)."""
    if subject.plan is not None:
        return []
    if subject.staged_parts:
        missing = [n for n in range(1, subject.parts_total + 1) if n not in subject.staged_parts]
        word = "части" if len(missing) == 1 else "частей"
        message = (
            f"План ещё не собран: не хватает {word} {', '.join(map(str, missing))} из"
            f" {subject.parts_total} — вставьте ответы чата и утвердите снова."
        )
    else:
        message = "Плана ещё нет — скопируйте промпт части 1 и вставьте ответ чата."
    return [ApprovalProblem(check="plan", shot_id=None, message=message)]


def shots_filled(subject: ApprovalSubject) -> list[ApprovalProblem]:
    """У каждого кадра плана, кроме убранных, после правок есть VO и промпт."""
    if subject.plan is None:
        return []
    problems: list[ApprovalProblem] = []
    for shot in subject.plan.shots:
        if shot.status == "removed":
            continue
        if not shot.vo.strip():
            problems.append(
                ApprovalProblem(
                    check="vo",
                    shot_id=shot.id,
                    message=f"кадр {shot.id}: пустой VO — допишите текст закадрового голоса",
                )
            )
        if not shot.image.prompt.strip():
            problems.append(
                ApprovalProblem(
                    check="prompt",
                    shot_id=shot.id,
                    message=f"кадр {shot.id}: пустой промпт — опишите действие и композицию",
                )
            )
    return problems


def not_like_reference(subject: ApprovalSubject) -> list[ApprovalProblem]:
    """Принцип 11: VO плана выпуска по референсу не повторяет текст референса. Плана нет — проверять
    нечего (об этом скажет `plan_assembled`)."""
    if subject.plan is None or subject.reference is None:
        return []
    ref = subject.reference
    vo = [shot.vo for shot in subject.plan.shots if shot.status != "removed"]
    found = similarity(vo, ref.text, ref.ngram, ref.threshold)
    if found.ok:
        return []
    phrases = "; ".join(f"«{phrase}»" for phrase in found.phrases)
    return [
        ApprovalProblem(
            check="similarity",
            shot_id=None,
            message=f"Сходство с референсом {percent(found.ratio)} при пороге"
            f" {percent(found.threshold)}: перепишите совпавшие фразы — {phrases}.",
        )
    ]


def canon_ready(subject: ApprovalSubject) -> list[ApprovalProblem]:
    """Стиль, эпохи и облики плана резолвятся в опубликованные версии, у облика лист 6/6 и не
    устарел (устав M5, решение 8). Плана нет — проверять нечего."""
    if subject.canon is None:
        return []
    return [
        ApprovalProblem(
            check="canon",
            shot_id=None,
            message=problem.message,
            canon=CanonTarget(kind=problem.kind, id=problem.id, issue=problem.issue),
        )
        for problem in subject.canon.problems
    ]


CHECKS: list[Check] = [stage_open, plan_assembled, shots_filled, not_like_reference, canon_ready]


def approval_problems(subject: ApprovalSubject) -> list[ApprovalProblem]:
    return [problem for check in CHECKS for problem in check(subject)]


def refusal(problems: list[ApprovalProblem]) -> ApprovalRefusal:
    """Сводка отказа: проблемы плана — как есть, канон — одной фразой с числами, проблемы
    кадров — числом и id по проверке."""
    parts = [
        problem.message
        for problem in problems
        if problem.shot_id is None and problem.check != "canon"
    ]
    canon = [problem.canon for problem in problems if problem.canon is not None]
    if canon:
        parts.append(canon_summary(canon))
    by_check: dict[str, list[str]] = {}
    for problem in problems:
        if problem.shot_id is not None:
            by_check.setdefault(problem.check, []).append(problem.shot_id)
    summaries = [
        f"{len(ids)} {plural(len(ids), 'кадр', 'кадра', 'кадров')}"
        f" {_WITHOUT.get(check, 'с ошибками')}: {_shot_list(ids)}"
        for check, ids in by_check.items()
    ]
    if summaries:
        parts.append(
            "; ".join(summaries)
            + " — допишите на листе сценария или в таблице плана и утвердите снова."
        )
    return ApprovalRefusal(message=" ".join(parts), problems=problems)


def _shot_list(ids: list[str]) -> str:
    shown = ", ".join(ids[:SHOWN_SHOTS])
    rest = len(ids) - SHOWN_SHOTS
    return f"{shown} и ещё {rest}" if rest > 0 else shown


def canon_summary(targets: list[CanonTarget]) -> str:
    """«Канон не готов: 1 эпоха не опубликована, у 2 обликов нет листа — экран «Канон».»"""
    counts = Counter((target.kind, target.issue) for target in targets)
    parts: list[str] = []
    if counts["style", "unpublished"]:
        parts.append("стиль канала не опубликован")
    if n := counts["period", "unpublished"]:
        parts.append(
            f"{n} {plural(n, 'эпоха', 'эпохи', 'эпох')} не"
            f" {plural(n, 'опубликована', 'опубликованы', 'опубликованы')}"
        )
    if n := counts["appearance", "unpublished"]:
        parts.append(
            f"{n} {plural(n, 'облик', 'облика', 'обликов')} не"
            f" {plural(n, 'опубликован', 'опубликованы', 'опубликованы')}"
        )
    if n := sum(count for (_, issue), count in counts.items() if issue == "unresolved"):
        parts.append(
            f"{n} {plural(n, 'ссылка', 'ссылки', 'ссылок')} не"
            f" {plural(n, 'находит', 'находят', 'находят')} версию"
        )
    sheet_issues: tuple[tuple[CanonIssue, str], ...] = (
        ("no_sheet", "нет листа"),
        ("sheet_incomplete", "лист не собран"),
        ("sheet_outdated", "лист устарел"),
    )
    for issue, text in sheet_issues:
        if n := counts["appearance", issue]:
            parts.append(f"у {n} {plural(n, 'облика', 'обликов', 'обликов')} {text}")
    where = []
    if any(target.issue != "unresolved" for target in targets):
        where.append("экран «Канон»")
    if any(target.issue == "unresolved" for target in targets):
        where.append("«Перевести на новые версии»")
    return f"Канон не готов: {', '.join(parts)} — {' и '.join(where)}."
