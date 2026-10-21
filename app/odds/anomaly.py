"""Neutral market-anomaly states. Output is never evidence of manipulation."""
from dataclasses import dataclass
from statistics import mean, pstdev


@dataclass(frozen=True)
class AnomalyResult:
    state: str  # normal | review | insufficient_data
    features: dict
    thresholds: dict


def cross_book_divergence(prices: dict[str, float], *, min_books: int = 4, z_threshold: float = 3.0) -> AnomalyResult:
    """Flags a bookmaker whose price deviates strongly from the others for the same selection."""
    th = {"min_books": min_books, "z_threshold": z_threshold}
    if len(prices) < min_books:
        return AnomalyResult("insufficient_data", {"books": len(prices)}, th)
    vals = list(prices.values())
    m, sd = mean(vals), pstdev(vals)
    if sd == 0:
        return AnomalyResult("normal", {"mean": m, "sd": 0.0}, th)
    worst = max(abs(v - m) / sd for v in vals)
    return AnomalyResult("review" if worst > z_threshold else "normal", {"mean": m, "sd": sd, "max_z": worst}, th)
