"""Chronological test: market-implied vs Dixon-Coles vs league-average, exact-score log loss.

usage: python -I scripts/market_eval.py data/Matches.csv [test_start=2023-07-01]
Dataset: xgabora/Club-Football-Match-Data-2000-2025 (derived from football-data.co.uk). OddHome/Draw/Away are
pre-match prices; the file has NO opening-vs-closing columns, so line movement cannot be tested with it.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pandas as pd

from app.models.dixon_coles import MatchResult, fit, score_matrix

G = 10  # grid goals 0..9
DIVS = ["E0", "SP1", "I1", "D1", "F1"]
RHO = -0.05


def mats(lam, mu, rho=RHO):
    from scipy.stats import poisson
    g = np.arange(G)
    m = poisson.pmf(g[None, :, None], lam[:, None, None]) * poisson.pmf(g[None, None, :], mu[:, None, None])
    m[:, 0, 0] *= 1 - lam * mu * rho
    m[:, 0, 1] *= 1 + lam * rho
    m[:, 1, 0] *= 1 + mu * rho
    m[:, 1, 1] *= 1 - rho
    return m


def summ(m):
    i, j = np.indices((G, G))
    return np.stack([(m * (i > j)).sum((1, 2)), (m * (i == j)).sum((1, 2)),
                     (m * ((i + j) > 2)).sum((1, 2))], 1)


def market_rates(p1x2, pover):
    ls = np.linspace(0.2, 3.8, 73)
    L, M = np.meshgrid(ls, ls, indexing="ij")
    grid = summ(mats(L.ravel(), M.ravel()))
    tgt = np.column_stack([p1x2[:, 0], p1x2[:, 1], pover])
    out = np.empty(len(tgt), dtype=int)
    for s in range(0, len(tgt), 2000):
        d = ((tgt[s:s + 2000, None, :] - grid[None]) ** 2).sum(2)
        out[s:s + 2000] = d.argmin(1)
    return L.ravel()[out], M.ravel()[out]


def devig(*cols):
    inv = np.column_stack([1 / c for c in cols])
    return inv / inv.sum(1, keepdims=True)


def ll(m, h, a):
    return -np.log(np.clip(m[np.arange(len(h)), h, a], 1e-12, None))


def main(path, test_start="2023-07-01"):
    d = pd.read_csv(path, low_memory=False)
    d["MatchDate"] = pd.to_datetime(d.MatchDate)
    d = d[d.Division.isin(DIVS) & (d.MatchDate >= "2012-07-01")].dropna(
        subset=["FTHome", "FTAway", "OddHome", "OddDraw", "OddAway", "Over25", "Under25"])
    d = d[(d.FTHome < G) & (d.FTAway < G)].sort_values("MatchDate")
    ts = pd.Timestamp(test_start)
    train, test = d[d.MatchDate < ts], d[d.MatchDate >= ts]
    rows = []
    for div in DIVS:
        tr, te = train[train.Division == div], test[test.Division == div].copy()
        # (a) league-average Poisson
        base = mats(np.full(len(te), tr.FTHome.mean()), np.full(len(te), tr.FTAway.mean()))
        # (b) Dixon-Coles fitted on past 3y only, refit at each test-season start (no leakage)
        te["season"] = np.where(te.MatchDate.dt.month >= 7, te.MatchDate.dt.year, te.MatchDate.dt.year - 1)
        dc = np.full((len(te), G, G), np.nan)
        for sea in sorted(te.season.unique()):
            cut = pd.Timestamp(f"{sea}-07-01")
            past = d[(d.Division == div) & (d.MatchDate < cut) & (d.MatchDate >= cut - pd.Timedelta(days=1095))]
            res = [MatchResult(r.MatchDate.to_pydatetime(), r.HomeTeam, r.AwayTeam, int(r.FTHome), int(r.FTAway))
                   for r in past.itertuples()]
            p = fit(res, xi=0.0018, as_of=cut.to_pydatetime())
            known = set(p.teams)
            for k, r in enumerate(te.itertuples()):
                if r.season == sea and r.HomeTeam in known and r.AwayTeam in known:
                    lam, mu = p.rates(r.HomeTeam, r.AwayTeam)
                    dc[k] = score_matrix(lam, mu, p.rho, G - 1).probs
        # (c) market-implied (de-vigged 1X2 + O/U 2.5 -> lambda, mu)
        p3 = devig(te.OddHome.values, te.OddDraw.values, te.OddAway.values)
        po = devig(te.Over25.values, te.Under25.values)[:, 0]
        lam, mu = market_rates(p3, po)
        mk = mats(lam, mu)
        te = te.assign(_i=range(len(te)))
        ok = ~np.isnan(dc[:, 0, 0])
        h, a = te.FTHome.values.astype(int), te.FTAway.values.astype(int)
        bl = 0.5 * dc + 0.5 * mk
        for name, m in (("league_avg", base), ("dixon_coles", dc), ("market_implied", mk), ("blend_50_50", bl)):
            idx = np.where(ok)[0]
            top = m[idx].reshape(len(idx), -1).argmax(1)
            hit = (top == h[idx] * G + a[idx]).mean()
            rows.append((div, name, len(idx), ll(m[idx], h[idx], a[idx]).mean(), hit,
                         m[idx].reshape(len(idx), -1).max(1).mean()))
    r = pd.DataFrame(rows, columns=["div", "model", "n", "exact_score_logloss", "top1_hit", "mean_top1_prob"])
    print(r.round(4).to_string(index=False))
    agg = r.groupby("model").apply(lambda g: pd.Series({
        "n": g.n.sum(), "logloss": np.average(g.exact_score_logloss, weights=g.n),
        "top1_hit": np.average(g.top1_hit, weights=g.n), "mean_top1_prob": np.average(g.mean_top1_prob, weights=g.n)}),
        include_groups=False)
    print("\nPOOLED\n", agg.round(4).to_string())


if __name__ == "__main__":
    main(sys.argv[1], *sys.argv[2:3])
