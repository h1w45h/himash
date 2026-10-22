"""Falsification test: do Fibonacci-weighted form and a pi-based constant improve exact-score forecasts?

usage: python -I scripts/numerology_eval.py data/Matches.csv [test_start=2023-07-01]
Control: market-implied rates (rho=-0.05). Variants change only the named ingredient. Same 5 leagues, same
chronological split as scripts/market_eval.py. Form features use only matches strictly before each match.
"""
import math
import sys
from collections import defaultdict, deque
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import numpy as np
import pandas as pd
from market_eval import DIVS, G, devig, ll, market_rates, mats

FIB = np.array([1, 1, 2, 3, 5], float)  # oldest -> newest weight
EQ = np.ones(5)


def wavg(xs, w):
    xs = list(xs)[-5:]
    if len(xs) < 5:
        return None
    return float(np.dot(xs, w) / w.sum())


def main(path, test_start="2023-07-01"):
    d = pd.read_csv(path, low_memory=False)
    d["MatchDate"] = pd.to_datetime(d.MatchDate)
    d = d[d.Division.isin(DIVS) & (d.MatchDate >= "2012-07-01")].dropna(
        subset=["FTHome", "FTAway", "OddHome", "OddDraw", "OddAway", "Over25", "Under25"])
    d = d[(d.FTHome < G) & (d.FTAway < G)].sort_values("MatchDate").reset_index(drop=True)
    gf, ga = defaultdict(lambda: deque(maxlen=5)), defaultdict(lambda: deque(maxlen=5))
    feats = np.full((len(d), 4), np.nan)  # fib_home_lam, fib_away_mu, eq_home_lam, eq_away_mu
    for i, r in enumerate(d.itertuples()):
        h, a = r.HomeTeam, r.AwayTeam
        for k, w in ((0, FIB), (2, EQ)):
            hs, hc, as_, ac = wavg(gf[h], w), wavg(ga[h], w), wavg(gf[a], w), wavg(ga[a], w)
            if None not in (hs, hc, as_, ac):
                feats[i, k], feats[i, k + 1] = (hs + ac) / 2, (as_ + hc) / 2
        gf[h].append(r.FTHome); ga[h].append(r.FTAway)  # noqa: E702
        gf[a].append(r.FTAway); ga[a].append(r.FTHome)  # noqa: E702
    te_mask = (d.MatchDate >= pd.Timestamp(test_start)).to_numpy() & ~np.isnan(feats).any(1)
    t = d[te_mask]
    f = feats[te_mask]
    p3 = devig(t.OddHome.values, t.OddDraw.values, t.OddAway.values)
    po = devig(t.Over25.values, t.Under25.values)[:, 0]
    lam, mu = market_rates(p3, po)
    h, a = t.FTHome.values.astype(int), t.FTAway.values.astype(int)
    pi_rho = -1 / math.pi

    def rho_mats(lm, m, rho):  # clip to the feasible range so every tau stays >= 0
        rho = np.clip(rho, np.maximum(-1 / lm, -1 / m), 1.0)
        return mats(lm, m, rho)

    rows = [("control: market-implied", ll(mats(lam, mu), h, a))]
    for w in (0.1, 0.25):
        for name, k in (("Fibonacci 1-1-2-3-5", 0), ("equal weights (control)", 2)):
            fl, fm = np.maximum(f[:, k], 0.2), np.maximum(f[:, k + 1], 0.2)
            rows.append((f"form blend w={w}: {name}", ll(mats(lam ** (1 - w) * fl ** w, mu ** (1 - w) * fm ** w), h, a)))
    rows.append(("rho = -1/pi (clipped), fixed", ll(rho_mats(lam, mu, pi_rho), h, a)))
    rows.append(("rho = 0 (independent)", ll(mats(lam, mu, 0.0), h, a)))
    base = rows[0][1]
    print(f"n = {len(h)} test matches\n{'variant':45s} {'logloss':>8s} {'diff vs control':>16s}  95% CI of diff (paired)")
    for name, v in rows:
        diff = v - base
        se = diff.std(ddof=1) / math.sqrt(len(diff))
        print(f"{name:45s} {v.mean():8.4f} {diff.mean():+16.4f}  [{diff.mean() - 1.96 * se:+.4f}, {diff.mean() + 1.96 * se:+.4f}]")


if __name__ == "__main__":
    main(sys.argv[1], *sys.argv[2:3])
