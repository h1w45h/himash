"""Fit and test the FESI composite formula (research script).

usage: python -I scripts/composite_fit.py data/Matches.csv [val_start=2022-07-01] [test_start=2023-07-01]

FESI composite:  P = norm( [ (1-w_e) * ((1-a-b) P_DC(rho) + a P_BIV(l3) + b P_DIAG(d)) + w_e * E ] ** tau )
  P_DC / P_BIV / P_DIAG  scoreline families from the literature, same market-implied rates (lambda, mu)
  E    empirical scoreline frequencies of the training window   (corrects systematic misfit)
  tau  temperature (calibration; tau<1 flattens, >1 sharpens)
Parameters are fitted on the TRAIN window only, model choice is judged on VALIDATION, and TEST is touched once.
Optional research stage: Elo / recent-form tilt of log(lambda/mu) (not available in the live bot's data feeds).
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import numpy as np
import pandas as pd
from market_eval import G, ll
from model_zoo_eval import f_biv, f_dc, f_diag, inputs, load, solve_rates
from scipy.optimize import minimize


def composite(lam, mu, th, E):
    rho, l3, d, s1, s2, we, ltau = th
    e1, e2 = math.exp(s1), math.exp(s2)
    a, b = e1 / (1 + e1 + e2), e2 / (1 + e1 + e2)
    w_e = 1 / (1 + math.exp(-we))
    mix = (1 - a - b) * f_dc(lam, mu, rho) + a * f_biv(lam, mu, l3) + b * f_diag(lam, mu, d)
    m = (1 - w_e) * mix + w_e * E[None]
    m = np.clip(m, 1e-12, None) ** math.exp(ltau)
    return m / m.sum((1, 2), keepdims=True)


def main(path, val_start="2022-07-01", test_start="2023-07-01"):
    d = load(path)
    vs, ts = pd.Timestamp(val_start), pd.Timestamp(test_start)
    train, val, test = d[d.MatchDate < vs].tail(8000), d[(d.MatchDate >= vs) & (d.MatchDate < ts)], d[d.MatchDate >= ts]
    p3t, pot, ht, at = inputs(train)
    E = np.zeros((G, G))
    np.add.at(E, (ht, at), 1)
    E /= E.sum()
    lamt, mut = solve_rates(f_dc, -0.05, p3t, pot)
    th0 = np.array([-0.05, 0.02, 0.03, -3.0, -3.0, -4.0, 0.0])

    def loss(th):
        if not (-0.3 <= th[0] <= 0.1 and 0 <= th[1] <= 0.5 and -0.2 <= th[2] <= 0.4 and th[5] > -9 and abs(th[6]) < 0.5):
            return 9.0
        return ll(composite(lamt, mut, th, E), ht, at).mean()

    res = minimize(loss, th0, method="Nelder-Mead", options={"maxiter": 500, "xatol": 1e-3, "fatol": 1e-6})
    th = res.x
    names = ["rho", "l3", "diag_d", "s_biv", "s_diag", "logit_w_emp", "log_tau"]
    print("fitted:", {n: round(float(v), 4) for n, v in zip(names, th)}, f"train logloss {res.fun:.4f}")

    out = {}
    for label, part in (("VALIDATION", val), ("TEST", test)):
        p3, po, h, a = inputs(part)
        lam, mu = solve_rates(f_dc, -0.05, p3, po)
        base = ll(f_dc(lam, mu, -0.05), h, a)
        comp = ll(composite(lam, mu, th, E), h, a)
        diff = comp - base
        se = diff.std(ddof=1) / math.sqrt(len(diff))
        print(f"{label:10s} n={len(h)}  current {base.mean():.4f}  composite {comp.mean():.4f}  "
              f"diff {diff.mean():+.4f} [{diff.mean() - 1.96 * se:+.4f}, {diff.mean() + 1.96 * se:+.4f}]")
        out[label] = (float(diff.mean()), float(diff.mean() - 1.96 * se), float(diff.mean() + 1.96 * se))
    Path(HERE.parent / "data" / "composite_params.json").write_text(json.dumps({n: float(v) for n, v in zip(names, th)} | {"E": E.tolist(), "result": out}))

    # research stage: Elo / form tilt on top of the composite (needs features the live feeds do not provide)
    def feats(part):
        return np.nan_to_num(np.column_stack([(part.HomeElo - part.AwayElo).values / 400, (part.Form5Home - part.Form5Away).values / 15]))

    def tilt_loss(ab, part, lam, mu, h, a):
        z = feats(part) @ ab
        return ll(composite(lam * np.exp(z / 2), mu * np.exp(-z / 2), th, E), h, a)

    ab = minimize(lambda x: tilt_loss(x, train, lamt, mut, ht, at).mean(), np.zeros(2), method="Nelder-Mead").x
    p3, po, h, a = inputs(test)
    lam, mu = solve_rates(f_dc, -0.05, p3, po)
    base = ll(f_dc(lam, mu, -0.05), h, a)
    t = tilt_loss(ab, test, lam, mu, h, a)
    diff = t - base
    se = diff.std(ddof=1) / math.sqrt(len(diff))
    print(f"RESEARCH   Elo/form tilt coefficients {np.round(ab, 4).tolist()}; TEST diff vs current "
          f"{diff.mean():+.4f} [{diff.mean() - 1.96 * se:+.4f}, {diff.mean() + 1.96 * se:+.4f}]")


if __name__ == "__main__":
    main(sys.argv[1], *sys.argv[2:4])
