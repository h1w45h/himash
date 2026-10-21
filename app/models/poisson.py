from math import exp, factorial


def poisson_pmf(goals: int, rate: float) -> float:
    """Poisson probability of exactly `goals` goals for non-negative rate."""
    if goals < 0:
        raise ValueError("goals must be >= 0")
    if rate < 0:
        raise ValueError("rate must be >= 0")
    if rate == 0:
        return 1.0 if goals == 0 else 0.0
    return exp(-rate) * rate**goals / factorial(goals)

def independent_score_probability(home_goals: int, away_goals: int,
                                  home_rate: float, away_rate: float) -> float:
    """Baseline independent Poisson score probability; not yet Dixon–Coles adjusted."""
    return poisson_pmf(home_goals, home_rate) * poisson_pmf(away_goals, away_rate)

def score_matrix(home_rate: float, away_rate: float, max_goals: int = 8) -> list[dict]:
    """Return truncated score probabilities. Matrix mass is < 1 when tails are omitted."""
    if max_goals < 0:
        raise ValueError("max_goals must be >= 0")
    return [
        {
            "home_goals": h,
            "away_goals": a,
            "probability": independent_score_probability(h, a, home_rate, away_rate),
        }
        for h in range(max_goals + 1)
        for a in range(max_goals + 1)
    ]

def fair_odds(probability: float) -> float | None:
    if not 0 < probability <= 1:
        return None
    return 1.0 / probability

def expected_value(probability: float, decimal_odds: float) -> float | None:
    """Expected net return per unit stake before execution limits/tax; e.g. 0.05 = +5%."""
    if not 0 <= probability <= 1 or decimal_odds <= 1:
        return None
    return probability * decimal_odds - 1.0
