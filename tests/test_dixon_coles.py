from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from app.models.dixon_coles import MatchResult, feasible_rho, fit, live_score_matrix, score_matrix, tau


def test_matrix_finite_nonneg_and_mass():
    m = score_matrix(1.4, 1.1, -0.1, 8)
    assert np.all(np.isfinite(m.probs)) and np.all(m.probs >= 0)
    assert m.probs.sum() + m.tail == pytest.approx(1.0)
    big = score_matrix(1.4, 1.1, -0.1, 30)
    assert big.probs.sum() == pytest.approx(1.0, abs=1e-9)  # tau preserves total mass


def test_tau_only_low_scores():
    assert tau(2, 2, 1.2, 1.0, -0.1) == 1.0
    assert tau(0, 0, 1.2, 1.0, -0.1) == pytest.approx(1 + 0.12)


def test_rho_clipped_to_feasible():
    r = feasible_rho(2.0, 2.0, 0.9)
    assert tau(0, 0, 2.0, 2.0, r) >= 0


def test_live_matrix_shifts_and_shrinks():
    m = live_score_matrix(1.5, 1.2, 0, home_goals=2, away_goals=1, minute=90)
    assert m.probs[0, 0] == pytest.approx(1.0)
    assert m.top(1, (2, 1))[0][:2] == (2, 1)


def test_fit_recovers_strong_team_and_is_deterministic():
    rng = np.random.default_rng(1)
    t0 = datetime(2025, 1, 1, tzinfo=UTC)
    teams = list("ABCDEF")
    rs, k = [], 0
    for _ in range(6):
        for h in teams:
            for a in teams:
                if h != a:
                    lam = 2.2 if h == "A" else 1.2
                    mu = 0.5 if a == "A" else 1.0
                    rs.append(MatchResult(t0 + timedelta(days=k), h, a, int(rng.poisson(lam)), int(rng.poisson(mu))))
                    k += 1
    asof = t0 + timedelta(days=k + 1)
    p1, p2 = fit(rs, xi=0.001, as_of=asof), fit(rs, xi=0.001, as_of=asof)
    assert p1.attack[0] == p2.attack[0]
    assert p1.attack[0] == p1.attack.max()
    assert p1.home_adv > 0
