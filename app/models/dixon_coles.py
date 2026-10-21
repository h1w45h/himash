"""Dixon–Coles model: regularized, time-decayed maximum likelihood.

log(lambda_home) = mu + home_adv + attack[h] - defence[a]
log(lambda_away) = mu + attack[a] - defence[h]
The tau correction only changes 0-0, 0-1, 1-0, 1-1 and preserves total mass (adjustments sum to
zero), so the full-space distribution still sums to 1; only the *displayed* truncated matrix has a
residual tail, which is reported explicitly.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
from scipy.optimize import minimize
from scipy.special import gammaln


@dataclass(frozen=True)
class MatchResult:
    kickoff: datetime
    home_id: str
    away_id: str
    home_goals: int
    away_goals: int


@dataclass
class DCParams:
    teams: list[str]
    attack: np.ndarray
    defence: np.ndarray
    mu: float
    home_adv: float
    rho: float
    n_matches: int
    trained_until: datetime
    matches_per_team: dict[str, int] = field(default_factory=dict)

    def rates(self, home_id: str, away_id: str) -> tuple[float, float]:
        idx = {t: i for i, t in enumerate(self.teams)}
        h, a = idx[home_id], idx[away_id]
        return (float(np.exp(self.mu + self.home_adv + self.attack[h] - self.defence[a])),
                float(np.exp(self.mu + self.attack[a] - self.defence[h])))


def tau(x: int, y: int, lam: float, mu: float, rho: float) -> float:
    if x == 0 and y == 0:
        return 1.0 - lam * mu * rho
    if x == 0 and y == 1:
        return 1.0 + lam * rho
    if x == 1 and y == 0:
        return 1.0 + mu * rho
    if x == 1 and y == 1:
        return 1.0 - rho
    return 1.0


def feasible_rho(lam: float, mu: float, rho: float) -> float:
    """Clip rho so every tau stays non-negative."""
    lo = max(-1.0 / lam if lam > 0 else -1.0, -1.0 / mu if mu > 0 else -1.0, -1.0)
    hi = min(1.0 / (lam * mu) if lam * mu > 0 else 1.0, 1.0)
    return float(min(max(rho, lo), hi))


def fit(results: list[MatchResult], *, xi: float, as_of: datetime, reg: float = 0.5) -> DCParams:
    if not results:
        raise ValueError("no results to fit")
    teams = sorted({r.home_id for r in results} | {r.away_id for r in results})
    idx = {t: i for i, t in enumerate(teams)}
    n_t = len(teams)
    h = np.array([idx[r.home_id] for r in results])
    a = np.array([idx[r.away_id] for r in results])
    x = np.array([r.home_goals for r in results], dtype=float)
    y = np.array([r.away_goals for r in results], dtype=float)
    days = np.array([max((as_of - r.kickoff).total_seconds() / 86400.0, 0.0) for r in results])
    w = np.exp(-xi * days)
    lgx, lgy = gammaln(x + 1), gammaln(y + 1)
    m00, m01, m10, m11 = (x == 0) & (y == 0), (x == 0) & (y == 1), (x == 1) & (y == 0), (x == 1) & (y == 1)

    def unpack(p):
        return p[:n_t], p[n_t:2 * n_t], p[2 * n_t], p[2 * n_t + 1], p[2 * n_t + 2]

    def nll(p):
        att, dfn, mu, ha, rho = unpack(p)
        ll_h = mu + ha + att[h] - dfn[a]
        ll_a = mu + att[a] - dfn[h]
        lam, mu_a = np.exp(ll_h), np.exp(ll_a)
        t = np.ones_like(lam)
        t[m00] = 1 - lam[m00] * mu_a[m00] * rho
        t[m01] = 1 + lam[m01] * rho
        t[m10] = 1 + mu_a[m10] * rho
        t[m11] = 1 - rho
        t = np.maximum(t, 1e-10)
        ll = np.log(t) + x * ll_h - lam - lgx + y * ll_a - mu_a - lgy
        pen = reg * (np.sum(att**2) + np.sum(dfn**2)) + 10.0 * (np.sum(att) ** 2 + np.sum(dfn) ** 2)
        return -np.sum(w * ll) + pen

    p0 = np.zeros(2 * n_t + 3)
    p0[2 * n_t] = np.log(max((x.mean() + y.mean()) / 2, 0.1))
    p0[2 * n_t + 1] = 0.2
    bounds = [(-3, 3)] * (2 * n_t) + [(-3, 3), (-1, 1), (-0.3, 0.3)]
    res = minimize(nll, p0, method="L-BFGS-B", bounds=bounds)
    if not np.all(np.isfinite(res.x)):
        raise ValueError("model fit produced non-finite parameters")
    att, dfn, mu, ha, rho = unpack(res.x)
    counts: dict[str, int] = {}
    for r in results:
        counts[r.home_id] = counts.get(r.home_id, 0) + 1
        counts[r.away_id] = counts.get(r.away_id, 0) + 1
    return DCParams(teams, att, dfn, float(mu), float(ha), float(rho), len(results),
                    max(r.kickoff for r in results), counts)


@dataclass(frozen=True)
class ScoreMatrix:
    probs: np.ndarray  # [home_goals, away_goals] on the truncated grid
    home_rate: float
    away_rate: float
    rho: float
    tail: float  # probability mass outside the displayed grid (1 - sum(probs))

    def top(self, n: int = 5, offset: tuple[int, int] = (0, 0)) -> list[tuple[int, int, float]]:
        flat = [(i + offset[0], j + offset[1], float(self.probs[i, j]))
                for i in range(self.probs.shape[0]) for j in range(self.probs.shape[1])]
        return sorted(flat, key=lambda t: -t[2])[:n]


def score_matrix(lam: float, mu: float, rho: float, max_goals: int = 8) -> ScoreMatrix:
    if lam < 0 or mu < 0:
        raise ValueError("rates must be >= 0")
    rho = feasible_rho(lam, mu, rho)
    g = np.arange(max_goals + 1)
    from scipy.stats import poisson
    ph, pa = poisson.pmf(g, lam), poisson.pmf(g, mu)
    m = np.outer(ph, pa)
    for (i, j) in ((0, 0), (0, 1), (1, 0), (1, 1)):
        if i <= max_goals and j <= max_goals:
            m[i, j] *= tau(i, j, lam, mu, rho)
    if not np.all(np.isfinite(m)) or np.any(m < 0):
        raise ValueError("invalid probability matrix")
    return ScoreMatrix(m, lam, mu, rho, float(max(0.0, 1.0 - m.sum())))


def live_score_matrix(lam: float, mu: float, rho: float, *, home_goals: int, away_goals: int,
                      minute: int, total_minutes: int = 90, max_goals: int = 8) -> ScoreMatrix:
    """Final-score distribution given the current score: remaining goals ~ Poisson(rate * remaining
    fraction), shifted by the current score. Rates are time-homogeneous (no stoppage/card effects), and
    the DC correction is not applied to the remainder. Returned matrix indexes *remaining* goals; use
    `top(offset=(home_goals, away_goals))` for final scores."""
    frac = min(max((total_minutes - minute) / total_minutes, 0.0), 1.0)
    return score_matrix(lam * frac, mu * frac, 0.0, max_goals)


def outcome_probs(m: ScoreMatrix) -> dict[str, float]:
    p = m.probs
    return {"home": float(np.tril(p, -1).sum()), "draw": float(np.trace(p)), "away": float(np.triu(p, 1).sum())}
