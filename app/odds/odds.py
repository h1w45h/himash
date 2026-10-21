from datetime import UTC, datetime
from typing import Any

from app.models.poisson import expected_value, fair_odds  # noqa: F401  (re-exported)


def implied_probability(decimal_odds: float) -> float | None:
    return 1.0 / decimal_odds if decimal_odds > 1.0 else None


def devig_proportional(odds: dict[str, float]) -> tuple[dict[str, float], float] | None:
    """Proportional normalization of a COMPLETE market. Returns (fair probs, overround)."""
    probs = {k: implied_probability(v) for k, v in odds.items()}
    if not probs or any(v is None for v in probs.values()):
        return None
    total = sum(probs.values())  # type: ignore[arg-type]
    return {k: v / total for k, v in probs.items()}, total - 1.0  # type: ignore[operator]


def best_prices(rows: list[dict[str, Any]], *, now: datetime | None = None,
                max_age_s: float = 900) -> dict[str, dict[str, Any]]:
    """Best fresh price per selection across bookmakers. Stale/malformed rows are dropped."""
    now = now or datetime.now(UTC)
    best: dict[str, dict[str, Any]] = {}
    for r in rows:
        age = (now - r["observed_at"]).total_seconds()
        if age > max_age_s or age < -60 or not r["odds"] > 1.0:
            continue
        cur = best.get(r["selection"])
        if cur is None or r["odds"] > cur["odds"]:
            best[r["selection"]] = r
    return best


def market_is_complete(selections: set[str]) -> bool:
    """A de-vigged market needs every outcome. Exact-score feeds are complete only with an
    explicit 'other' selection; otherwise de-vig is NOT claimed."""
    return any(s.startswith("other") or s.startswith("any other") for s in selections)


def score_selection(h: int, a: int) -> str:
    return f"{h}:{a}"
