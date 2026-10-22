"""FESI composite scoreline formula (OFF by default: see README, it did not beat the plain market model).

P = norm( [ (1-w_e) * ((1-a-b) P_DC(rho) + a P_BIV(l3) + b P_DIAG(d)) + w_e * E ] ** tau ), mass-preserving on the grid.
Parameters come from scripts/composite_fit.py (fitted on a train window only) and are stored in composite_params.json.
"""
import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy.stats import poisson

from app.models.dixon_coles import ScoreMatrix, score_matrix


@lru_cache
def params() -> dict:
    return json.loads((Path(__file__).parent / "composite_params.json").read_text())


def _biv(lam: float, mu: float, l3: float, g: int) -> np.ndarray:
    l3 = min(l3, 0.9 * min(lam, mu))
    a, b, gr = lam - l3, mu - l3, np.arange(g)
    m = np.zeros((g, g))
    for k in range(g):
        px = np.where(gr >= k, poisson.pmf(np.maximum(gr - k, 0), a), 0.0)
        py = np.where(gr >= k, poisson.pmf(np.maximum(gr - k, 0), b), 0.0)
        m += poisson.pmf(k, l3) * np.outer(px, py)
    return m


def composite_matrix(lam: float, mu: float, max_goals: int = 8) -> ScoreMatrix:
    p = params()
    g = max_goals + 1
    e1, e2 = math.exp(min(p["s_biv"], 50)), math.exp(min(p["s_diag"], 50))
    a, b = e1 / (1 + e1 + e2), e2 / (1 + e1 + e2)
    dc = score_matrix(lam, mu, p["rho"], max_goals).probs
    diag = dc.copy()
    diag[np.arange(g), np.arange(g)] *= 1 + p["diag_d"]
    diag *= dc.sum() / diag.sum()
    mix = (1 - a - b) * dc + a * _biv(lam, mu, p["l3"], g) + b * diag
    E = np.array(p["E"])[:g, :g]
    E = np.pad(E, ((0, g - E.shape[0]), (0, g - E.shape[1])))
    w_e = 1 / (1 + math.exp(-p["logit_w_emp"]))
    m = (1 - w_e) * mix + w_e * E * mix.sum() / max(E.sum(), 1e-12)
    mass = m.sum()
    m = np.clip(m, 1e-12, None) ** math.exp(p["log_tau"])
    m *= mass / m.sum()
    if not np.all(np.isfinite(m)):
        raise ValueError("invalid composite matrix")
    return ScoreMatrix(m, lam, mu, p["rho"], float(max(0.0, 1.0 - m.sum())))
