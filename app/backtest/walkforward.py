"""Chronological walk-forward evaluation (no future data in training)."""
from dataclasses import dataclass
from math import log

import numpy as np

from app.models.dixon_coles import MatchResult, fit, score_matrix

EPS = 1e-12


@dataclass(frozen=True)
class BacktestReport:
    n_test: int
    log_loss_model: float
    log_loss_baseline: float
    brier_model: float
    top1_hit_rate: float
    calibration: list[tuple[float, float, int]]  # (mean predicted, observed freq, n) per bucket
    passed: bool  # model beats baseline with a minimum sample: the EV-alert calibration gate


def walk_forward(results: list[MatchResult], *, xi: float, folds: int = 4, min_train: int = 60,
                 min_test: int = 100, max_goals: int = 8) -> BacktestReport | None:
    rs = sorted(results, key=lambda r: r.kickoff)
    if len(rs) < min_train + folds:
        return None
    cuts = np.linspace(min_train, len(rs), folds + 1, dtype=int)
    ll_m, ll_b, brier, hits = [], [], [], 0
    pred_p, obs = [], []
    for k in range(folds):
        train, test = rs[:cuts[k]], rs[cuts[k]:cuts[k + 1]]
        if not test:
            continue
        as_of = test[0].kickoff  # training window ends strictly before the test window
        train = [r for r in train if r.kickoff < as_of]
        params = fit(train, xi=xi, as_of=as_of)
        known = set(params.teams)
        base_h = np.mean([r.home_goals for r in train])
        base_a = np.mean([r.away_goals for r in train])
        base = score_matrix(float(base_h), float(base_a), 0.0, max_goals)
        for r in test:
            if r.home_id not in known or r.away_id not in known:
                continue  # cold-start team: skip rather than invent a prediction
            if r.home_goals > max_goals or r.away_goals > max_goals:
                continue
            m = score_matrix(*params.rates(r.home_id, r.away_id), params.rho, max_goals)
            p = m.probs[r.home_goals, r.away_goals]
            ll_m.append(-log(max(p, EPS)))
            ll_b.append(-log(max(base.probs[r.home_goals, r.away_goals], EPS)))
            onehot = np.zeros_like(m.probs)
            onehot[r.home_goals, r.away_goals] = 1
            brier.append(float(((m.probs - onehot) ** 2).sum()))
            top = np.unravel_index(np.argmax(m.probs), m.probs.shape)
            hits += int(top == (r.home_goals, r.away_goals))
            pred_p.extend(m.probs.ravel().tolist())
            obs.extend(onehot.ravel().tolist())
    n = len(ll_m)
    if n == 0:
        return None
    pred, ob = np.array(pred_p), np.array(obs)
    edges = [0, 0.01, 0.03, 0.06, 0.1, 0.2, 1.0]
    cal = []
    for lo, hi in zip(edges, edges[1:]):
        sel = (pred >= lo) & (pred < hi if hi < 1 else pred <= hi)
        if sel.any():
            cal.append((float(pred[sel].mean()), float(ob[sel].mean()), int(sel.sum())))
    lm, lb = float(np.mean(ll_m)), float(np.mean(ll_b))
    return BacktestReport(n, lm, lb, float(np.mean(brier)), hits / n, cal, passed=(n >= min_test and lm < lb))
