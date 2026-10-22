"""Pre-match line movement ('squeeze'). Neutral signal, not evidence of manipulation.

Movement = relative change of the de-vigged implied probability between the first snapshot we stored
(opening) and the latest one. Thresholds are configuration, NOT validated: the free mirror used for model
testing has no opening/closing columns. Calibrate with scripts/calibrate_movement.py on football-data.co.uk
files (B365H -> B365CH) from a machine that can reach that site.
"""
from dataclasses import dataclass

DEFAULT_SQUEEZE = 0.08  # >= 8% relative rise of implied probability  (uncalibrated default)


@dataclass(frozen=True)
class Movement:
    state: str  # stable | shortening | drifting | insufficient_data
    rel_change: float | None
    detail: str


def movement(open_prob: float | None, now_prob: float | None, hours_between: float,
             threshold: float = DEFAULT_SQUEEZE, min_hours: float = 1.0) -> Movement:
    if open_prob is None or now_prob is None or hours_between < min_hours or open_prob <= 0:
        return Movement("insufficient_data", None, "нужен более ранний снимок "
                        f"не моложе {min_hours:.0f} ч")
    rel = now_prob / open_prob - 1.0
    state = "shortening" if rel >= threshold else "drifting" if rel <= -threshold else "stable"
    return Movement(state, rel, f"вероятность по коэффициентам {open_prob:.1%} → {now_prob:.1%} ({rel:+.1%}) за {hours_between:.1f} ч")
