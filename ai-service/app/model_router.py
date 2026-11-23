import re
import time
from collections.abc import Callable
from dataclasses import dataclass

from google.genai import errors

# Errors that belong to one model (quota, overload, missing or not permitted), so the next model may still work.
FALLBACK_CODES = {403, 404, 429, 500, 502, 503, 504}

OVERLOAD_COOLDOWN = 30.0
UNAVAILABLE_COOLDOWN = 3600.0
FORBIDDEN_COOLDOWN = 600.0
QUOTA_COOLDOWN = 60.0
DAILY_QUOTA_COOLDOWN = 1800.0
MIN_RETRY_DELAY, MAX_RETRY_DELAY = 5.0, 300.0

_RETRY_DELAY = re.compile(r"^(\d+(?:\.\d+)?)s$")


@dataclass(frozen=True)
class Failure:
    """How a failed call should be handled: try another model, and stop using this one for `cooldown` seconds."""

    cooldown: float
    reason: str


def classify(exc: BaseException) -> Failure | None:
    """Returns a Failure when another model may succeed, or None when the error would be the same for any model."""
    if isinstance(exc, TimeoutError):
        return Failure(OVERLOAD_COOLDOWN, "timeout")
    if not isinstance(exc, errors.APIError):
        return None

    code = getattr(exc, "code", None)
    if code not in FALLBACK_CODES:
        return None  # 400 (bad request) and 401 (bad key) are not fixed by switching models
    if code == 429:
        return Failure(_quota_cooldown(exc), "quota")
    if code == 404:
        return Failure(UNAVAILABLE_COOLDOWN, "not_found")
    if code == 403:
        return Failure(FORBIDDEN_COOLDOWN, "forbidden")
    return Failure(OVERLOAD_COOLDOWN, "unavailable")


def _quota_cooldown(exc: errors.APIError) -> float:
    details = getattr(exc, "details", None)
    error = details.get("error", {}) if isinstance(details, dict) else {}
    text = f"{getattr(exc, 'message', '')} {error}"

    # A daily limit will not recover within minutes, so wait longer before probing this model again.
    if "PerDay" in text or "per day" in text.lower():
        return DAILY_QUOTA_COOLDOWN

    for item in error.get("details", []) if isinstance(error, dict) else []:
        match = _RETRY_DELAY.match(str(item.get("retryDelay", ""))) if isinstance(item, dict) else None
        if match:
            return min(MAX_RETRY_DELAY, max(MIN_RETRY_DELAY, float(match.group(1))))
    return QUOTA_COOLDOWN


class ModelRouter:
    """Keeps the model priority list and remembers which models are cooling down after a failure."""

    def __init__(self, models: list[str], clock: Callable[[], float] = time.monotonic) -> None:
        if not models:
            raise ValueError("At least one model is required.")
        self._models = list(models)
        self._clock = clock
        self._until: dict[str, float] = {}

    @property
    def models(self) -> list[str]:
        return list(self._models)

    def cooldown_left(self, model: str) -> float:
        return max(0.0, self._until.get(model, 0.0) - self._clock())

    def candidates(self) -> list[str]:
        """Models to try now, in priority order. If every model is cooling down, only the one that recovers first."""
        available = [name for name in self._models if self.cooldown_left(name) == 0]
        if available:
            return available
        return [min(self._models, key=self.cooldown_left)]

    def mark_failed(self, model: str, cooldown: float) -> None:
        if cooldown > 0:
            self._until[model] = self._clock() + cooldown

    def mark_ok(self, model: str) -> None:
        self._until.pop(model, None)
