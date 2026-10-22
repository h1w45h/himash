"""Compare scoreline-distribution families found in the literature, all driven by the same market inputs.

usage: python -I scripts/model_zoo_eval.py data/Matches.csv [test_start=2023-07-01]
Each family has one shape parameter, fitted on the TRAIN window (latest 6000 train matches) by minimizing exact-score
log loss; for every family the rates (lambda, mu) are re-solved so that its own 1X2 and Over2.5 probabilities match the
de-vigged market. Test window is strictly later. Families:
  dixon_coles  : Poisson x tau(rho)                       (current model)
  independent  : rho = 0
  biv_poisson  : X=X1+Z, Y=Y1+Z, Z~Poisson(l3)            (Karlis & Ntzoufras 2003)
  diag_inflate : DC + draw (diagonal) multiplier (1+d), renormalised   (diagonal-inflated idea)
  neg_binomial : NB marginals (dispersion r) x tau(rho)   (over-dispersion)
"""
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import numpy as np
import pandas as pd
from market_eval import DIVS, G, devig, ll
from scipy.optimize import minimize_scalar
from scipy.stats import nbinom, poisson

GR = np.arange(G)


def tau_apply(m, lam, mu, rho):
    rho = np.clip(rho, np.maximum(-1 / lam, -1 / mu), 1.0)
    m = m.copy()
    m[:, 0, 0] *= 1 - lam * mu * rho
    m[:, 0, 1] *= 1 + lam * rho
    m[:, 1, 0] *= 1 + mu * rho
    m[:, 1, 1] *= 1 - rho
    return m


def f_dc(lam, mu, rho=-0.05):
    return tau_apply(np.einsum("ni,nj->nij", poisson.pmf(GR, lam[:, None]), poisson.pmf(GR, mu[:, None])), lam, mu, rho)


def f_biv(lam, mu, l3):
    l3 = np.minimum(l3, 0.9 * np.minimum(lam, mu))
    a, b = lam - l3, mu - l3
    m = np.zeros((len(lam), G, G))
    for k in range(G):
        pk = poisson.pmf(k, l3)
        px = np.where(GR[None, :] >= k, poisson.pmf(np.maximum(GR[None, :] - k, 0), a[:, None]), 0.0)
        py = np.where(GR[None, :] >= k, poisson.pmf(np.maximum(GR[None, :] - k, 0), b[:, None]), 0.0)
        m += pk[:, None, None] * px[:, :, None] * py[:, None, :]
    return m


def f_diag(lam, mu, d):
    m = f_dc(lam, mu)
    m[:, GR, GR] *= 1 + d
    return m / m.sum((1, 2), keepdims=True) * m.sum((1, 2), keepdims=True).clip(max=1)  # keep truncation mass honest


def f_nb(lam, mu, r):
    def pmf(mean):
        return nbinom.pmf(GR, r, r / (r + mean[:, None]))
    return tau_apply(np.einsum("ni,nj->nij", pmf(lam), pmf(mu)), lam, mu, -0.05)


FAMILIES = {  # name: (builder, parameter bounds)
    "dixon_coles(rho fitted)": (f_dc, (-0.3, 0.1)),
    "biv_poisson(l3)": (f_biv, (0.0, 0.5)),
    "diag_inflate(d)": (f_diag, (-0.2, 0.4)),
    "neg_binomial(r)": (f_nb, (3.0, 200.0)),
}


def summ(m):
    i, j = np.indices((G, G))
    return np.stack([(m * (i > j)).sum((1, 2)), (m * (i == j)).sum((1, 2)), (m * ((i + j) > 2)).sum((1, 2))], 1)


def solve_rates(fn, par, p3, po):
    ls = np.linspace(0.25, 3.75, 36)
    L, M = np.meshgrid(ls, ls, indexing="ij")
    grid = summ(fn(L.ravel(), M.ravel(), par))
    tgt = np.column_stack([p3[:, 0], p3[:, 1], po])
    idx = np.empty(len(tgt), int)
    for s in range(0, len(tgt), 1500):
        idx[s:s + 1500] = (((tgt[s:s + 1500, None, :] - grid[None]) ** 2).sum(2)).argmin(1)
    return L.ravel()[idx], M.ravel()[idx]


def load(path):
    d = pd.read_csv(path, low_memory=False)
    d["MatchDate"] = pd.to_datetime(d.MatchDate)
    d = d[d.Division.isin(DIVS) & (d.MatchDate >= "2012-07-01")].dropna(
        subset=["FTHome", "FTAway", "OddHome", "OddDraw", "OddAway", "Over25", "Under25"])
    return d[(d.FTHome < G) & (d.FTAway < G)].sort_values("MatchDate")


def inputs(t):
    return (devig(t.OddHome.values, t.OddDraw.values, t.OddAway.values),
            devig(t.Over25.values, t.Under25.values)[:, 0],
            t.FTHome.values.astype(int), t.FTAway.values.astype(int))


def main(path, test_start="2023-07-01"):
    d = load(path)
    ts = pd.Timestamp(test_start)
    train, test = d[d.MatchDate < ts].tail(6000), d[d.MatchDate >= ts]
    p3t, pot, ht, at = inputs(train)
    p3, po, h, a = inputs(test)
    res, controls = {}, None
    for name, (fn, (lo, hi)) in FAMILIES.items():
        def loss(par, fn=fn):
            lam, mu = solve_rates(fn, par, p3t, pot)
            return ll(fn(lam, mu, par), ht, at).mean()
        best = minimize_scalar(loss, bounds=(lo, hi), method="bounded", options={"xatol": 1e-2 * (hi - lo)})
        lam, mu = solve_rates(fn, best.x, p3, po)
        res[name] = (best.x, ll(fn(lam, mu, best.x), h, a))
        if controls is None:
            lam0, mu0 = solve_rates(f_dc, -0.05, p3, po)
            controls = ("dixon_coles(rho=-0.05 fixed) [current]", ll(f_dc(lam0, mu0, -0.05), h, a))
    base = controls[1]
    print(f"train n={len(ht)}, test n={len(h)}\n{'family':42s} {'param':>8s} {'logloss':>8s} {'diff vs current':>16s}  95% CI (paired)")
    for name, par, v in [(controls[0], float('nan'), base)] + [(k, x, v) for k, (x, v) in res.items()]:
        diff = v - base
        se = diff.std(ddof=1) / math.sqrt(len(diff)) if diff.any() else 0.0
        print(f"{name:42s} {par:8.3f} {v.mean():8.4f} {diff.mean():+16.4f}  [{diff.mean() - 1.96 * se:+.4f}, {diff.mean() + 1.96 * se:+.4f}]")


if __name__ == "__main__":
    main(sys.argv[1], *sys.argv[2:3])
