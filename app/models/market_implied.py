"""Market-implied scoreline rates from de-vigged 1X2 + Over/Under 2.5 (best model in scripts/market_eval.py)."""
import numpy as np
from scipy.optimize import minimize

from app.models.dixon_coles import score_matrix

RHO = -0.05
GRID = 12


def _targets(lam: float, mu: float) -> np.ndarray:
    p = score_matrix(lam, mu, RHO, GRID - 1).probs
    i, j = np.indices(p.shape)
    return np.array([p[i > j].sum(), p[i == j].sum(), p[(i + j) > 2].sum()])


def implied_rates(p_home: float, p_draw: float, p_over25: float) -> tuple[float, float, float]:
    """Returns (home_rate, away_rate, fit_error). Inputs are de-vigged probabilities."""
    tgt = np.array([p_home, p_draw, p_over25])
    best = None
    for x0 in ((1.4, 1.1), (2.0, 0.8), (0.9, 1.6)):
        r = minimize(lambda x: float(((_targets(np.exp(x[0]), np.exp(x[1])) - tgt) ** 2).sum()),
                     np.log(x0), method="Nelder-Mead", options={"xatol": 1e-4, "fatol": 1e-10})
        if best is None or r.fun < best.fun:
            best = r
    lam, mu = float(np.exp(best.x[0])), float(np.exp(best.x[1]))
    return lam, mu, float(np.sqrt(best.fun))
