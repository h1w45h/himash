"""Forecast service: provider data -> fitted model -> immutable snapshot with quality flags."""
from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from app.backtest.walkforward import BacktestReport, walk_forward
from app.config import Settings
from app.models.dixon_coles import (
    DCParams,
    MatchResult,
    ScoreMatrix,
    fit,
    live_score_matrix,
    outcome_probs,
    score_matrix,
)
from app.models.market_implied import RHO as MARKET_RHO
from app.models.market_implied import implied_rates
from app.odds.movement import movement
from app.odds.odds import best_prices, devig_proportional, expected_value, fair_odds, market_is_complete
from app.providers.contracts import Fixture, FootballDataProvider, OddsProvider
from app.storage.db import Database

HISTORY_TTL = 6 * 3600


@dataclass
class Forecast:
    fixture: Fixture
    mode: str  # prematch | live
    available: bool
    reason: str | None = None
    top: list[tuple[int, int, float]] = field(default_factory=list)
    tail: float = 0.0
    rates: tuple[float, float] | None = None
    outcome: dict[str, float] | None = None
    flags: list[str] = field(default_factory=list)
    n_train: int = 0
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    model_version: str = ""
    snapshot_id: int | None = None
    matrix: ScoreMatrix | None = None
    offset: tuple[int, int] = (0, 0)
    source: str = "dixon-coles"
    movement: dict[str, str] = field(default_factory=dict)


class ForecastService:
    def __init__(self, s: Settings, football: FootballDataProvider | None, odds: OddsProvider | None, db: Database):
        self.s, self.football, self.odds, self.db = s, football, odds, db
        self._hist: dict[tuple[str, int], tuple[float, list[Fixture]]] = {}
        self._models: dict[tuple[str, int], tuple[float, DCParams, int]] = {}
        self.backtests: dict[str, BacktestReport | None] = {}

    async def _results(self, fx: Fixture) -> list[MatchResult]:
        assert self.football and fx.season
        out: list[Fixture] = []
        for season in (fx.season, fx.season - 1):
            key = (fx.competition_id, season)
            cached = self._hist.get(key)
            if not cached or time.time() - cached[0] > HISTORY_TTL:
                try:
                    cached = (time.time(), await self.football.get_competition_results(fx.competition_id, season))
                except Exception:
                    if season == fx.season:
                        raise
                    cached = (time.time(), [])  # previous season unavailable on plan: continue without
                self._hist[key] = cached
            out += cached[1]
        return [MatchResult(f.kickoff, f.home_id, f.away_id, f.home_goals, f.away_goals) for f in out
                if f.home_goals is not None and f.away_goals is not None and f.kickoff < fx.kickoff]

    async def _model(self, fx: Fixture) -> tuple[DCParams, int, list[MatchResult]]:
        results = await self._results(fx)
        key = (fx.competition_id, fx.season or 0)
        cached = self._models.get(key)
        if cached and time.time() - cached[0] < HISTORY_TTL:
            return cached[1], cached[2], results
        if len(results) < self.s.min_training_matches:
            raise InsufficientData(f"only {len(results)} completed matches available for {fx.competition} "
                                   f"(need {self.s.min_training_matches})")
        params = fit(results, xi=self.s.time_decay_xi, as_of=datetime.now(UTC))
        self._models[key] = (time.time(), params, len(results))
        return params, len(results), results

    async def forecast(self, fx: Fixture) -> Forecast:
        mode = "live" if fx.status == "live" else "prematch"
        base = Forecast(fx, mode, False, model_version=self.s.model_version)
        if fx.status == "finished":
            base.reason = "match finished"
            return base
        if not self.football:
            base.reason = "no football data provider configured"
            return base
        if fx.season is None:
            base.reason = "season unknown"
            return base
        try:
            params, n, results = await self._model(fx)
        except InsufficientData as e:
            base.reason = str(e)
            return base
        except Exception as e:
            base.reason = f"data provider error ({type(e).__name__})"
            return base
        for t, name in ((fx.home_id, fx.home), (fx.away_id, fx.away)):
            if params.matches_per_team.get(t, 0) < self.s.min_team_matches:
                base.reason = f"insufficient history for {name} (<{self.s.min_team_matches} matches)"
                return base
        lam, mu = params.rates(fx.home_id, fx.away_id)
        base.n_train, base.rates = n, (lam, mu)
        if mode == "live":
            age = (datetime.now(UTC) - fx.observed_at).total_seconds()
            if age > self.s.live_stale_seconds:
                base.reason = f"live feed stale ({int(age)}s)"
                return base
            if fx.home_goals is None or fx.away_goals is None or fx.minute is None:
                base.reason = "live score/minute missing"
                return base
            m = live_score_matrix(lam, mu, params.rho, home_goals=fx.home_goals, away_goals=fx.away_goals,
                                  minute=fx.minute, max_goals=self.s.max_score_goals)
            base.offset = (fx.home_goals, fx.away_goals)
            base.flags.append("live: constant-rate remaining-goals model; red cards/stoppage not modelled")
        else:
            m = score_matrix(lam, mu, params.rho, self.s.max_score_goals)
            m = await self._apply_market(fx, base, m, lam, mu)
        base.available, base.matrix = True, m
        base.top = m.top(5, base.offset)
        base.tail = m.tail
        base.rates = (m.home_rate, m.away_rate)
        if mode == "prematch":
            base.outcome = outcome_probs(m)
        if fx.competition_id not in self.backtests:
            self.backtests[fx.competition_id] = walk_forward(results, xi=self.s.time_decay_xi)
            bt = self.backtests[fx.competition_id]
            if bt:
                self.db.save_backtest(fx.competition, bt.__dict__ | {"calibration": bt.calibration})
        bt = self.backtests.get(fx.competition_id)
        base.flags.append("backtest: not enough data" if bt is None else
                          f"backtest n={bt.n_test} logloss {bt.log_loss_model:.3f} vs baseline {bt.log_loss_baseline:.3f}"
                          + (" (passed)" if bt.passed else " (NOT passed)"))
        digest = hashlib.sha256(f"{fx.match_id}|{n}|{params.trained_until}|{lam:.6f}|{mu:.6f}|{params.rho:.6f}".encode()).hexdigest()[:16]
        base.snapshot_id = self.db.save_forecast(
            fx.match_id, self.s.model_version, mode, digest,
            {"source": base.source, "dc_rates": [lam, mu], "rates": list(base.rates), "movement": base.movement, "rho": params.rho, "n_train": n, "trained_until": params.trained_until,
             "top": base.top, "tail": base.tail, "flags": base.flags, "score": [fx.home_goals, fx.away_goals],
             "minute": fx.minute, "probs": m.probs.tolist()})
        return base

    async def _apply_market(self, fx: Fixture, fc: Forecast, dc: ScoreMatrix, lam: float, mu: float) -> ScoreMatrix:
        """Pre-match: replace DC rates by market-implied rates (best performer in scripts/market_eval.py)
        when fresh 1X2 + O/U 2.5 prices exist. Falls back to DC and says why."""
        per_fx = getattr(self.odds, "get_prematch_odds_for_fixture", None)
        getter = getattr(self.odds, "get_prematch_odds", None)
        if per_fx is None and getter is None:
            fc.flags.append("market odds not available -> Dixon-Coles only")
            return dc
        try:
            rows = await per_fx(fx) if per_fx else await getter(fx.match_id.split(":", 1)[1])
        except Exception as e:
            fc.flags.append(f"market odds error ({type(e).__name__}) -> Dixon-Coles only")
            return dc
        now = datetime.now(UTC)
        rows = [r for r in rows if 0 <= (now - r["observed_at"]).total_seconds() <= self.s.odds_stale_seconds]
        p1, po = _consensus(rows, "1x2", ("home", "draw", "away")), _consensus(rows, "ou25", ("over", "under"))
        if p1 is None or po is None:
            fc.flags.append("incomplete/stale 1X2 or O/U2.5 market -> Dixon-Coles only")
            return dc
        mlam, mmu, err = implied_rates(p1[0], p1[1], po[0])
        if err > 0.02:
            fc.flags.append(f"market-implied fit poor (rmse {err:.3f}) -> Dixon-Coles only")
            return dc
        self.db.save_odds_snapshot(fx.match_id, "1x2_ou25", now,
                                   {"home": p1[0], "draw": p1[1], "away": p1[2], "over25": po[0]})
        first, last = self.db.first_last_odds(fx.match_id, "1x2_ou25")
        fav = "home" if p1[0] >= p1[2] else "away"
        if first and last and first["observed_at"] != last["observed_at"]:
            hrs = (datetime.fromisoformat(last["observed_at"]) - datetime.fromisoformat(first["observed_at"])).total_seconds() / 3600
            import json
            mv = movement(json.loads(first["probs"])[fav], json.loads(last["probs"])[fav], hrs)
        else:
            mv = movement(None, None, 0)
        fc.movement = {"selection": fav, "state": mv.state, "detail": mv.detail}
        fc.source = "market-implied"
        fc.flags.append(f"rates from de-vigged market (1X2+O/U2.5); DC cross-check {lam:.2f}-{mu:.2f} vs market {mlam:.2f}-{mmu:.2f}")
        return score_matrix(mlam, mmu, MARKET_RHO, self.s.max_score_goals)

    async def exact_prices(self, f: Forecast) -> dict[str, float]:
        if not self.odds:
            return {}
        try:
            rows = await self.odds.get_exact_score_odds(f.fixture.match_id.split(":", 1)[1])
        except Exception:
            return {}
        return {k: v["odds"] for k, v in best_prices(rows, max_age_s=self.s.odds_stale_seconds).items()}

    def pick(self, f: Forecast, exact_odds: dict | None) -> dict[str, Any]:
        """Most likely exact score + the minimum odds at which it has positive expected value
        (after the configured EV buffer). Never claims certainty; 'bet' only if offered odds clear the bar."""
        if not f.available or f.mode != "prematch" or not f.top:
            return {"status": "no_pick", "reason": f.reason or "pre-match forecast required"}
        h, a, p = f.top[0]
        fair = 1 / p
        need = fair * (1 + self.s.ev_min_threshold)
        out = {"score": f"{h}-{a}", "p": p, "fair_odds": fair, "min_odds": need, "source": f.source}
        offered = (exact_odds or {}).get(f"{h}:{a}")
        if offered is None:
            return out | {"status": "no_price", "reason": "no fresh exact-score price; bet only if you find >= min_odds"}
        out["offered"] = offered
        out["ev"] = offered * p - 1
        if offered < need:
            return out | {"status": "no_bet", "reason": "offered odds below required minimum"}
        if not (f.source == "market-implied" and self.s.ev_alerts_enabled):
            return out | {"status": "candidate", "reason": "price clears the bar but value alerts are disabled / "
                          "exact-score EV is not backtested (no historical exact-score odds)"}
        return out | {"status": "bet"}

    async def odds_view(self, f: Forecast) -> dict[str, Any]:
        """Exact-score odds vs model. EV is informational unless the calibration gate passed."""
        if not self.odds:
            return {"available": False, "reason": "no odds provider configured"}
        if f.mode != "prematch" or not f.available or f.matrix is None:
            return {"available": False, "reason": "odds comparison only for available pre-match forecasts"}
        try:
            rows = await self.odds.get_exact_score_odds(f.fixture.match_id.split(":", 1)[1])
        except Exception as e:
            return {"available": False, "reason": f"odds provider error ({type(e).__name__})"}
        best = best_prices(rows, max_age_s=self.s.odds_stale_seconds)
        if not best:
            return {"available": False, "reason": "no fresh exact-score odds"}
        complete = market_is_complete(set(best))
        devig = None
        if complete:
            res = devig_proportional({k: v["odds"] for k, v in best.items()})
            devig = res
        lines = []
        for h, a, p in f.top:
            sel = best.get(f"{h}:{a}")
            if sel:
                lines.append({"score": f"{h}-{a}", "p": p, "fair": fair_odds(p), "odds": sel["odds"],
                              "bookmaker": sel["bookmaker"], "observed_at": sel["observed_at"],
                              "ev": expected_value(p, sel["odds"])})
        bt = self.backtests.get(f.fixture.competition_id)
        gate = bool(self.s.ev_alerts_enabled and bt and bt.passed)
        return {"available": True, "lines": lines, "market_complete": complete,
                "overround": devig[1] if devig else None, "ev_alert_gate_passed": gate}


class InsufficientData(Exception):
    pass


def _consensus(rows: list[dict[str, Any]], market: str, sels: tuple[str, ...]) -> tuple[float, ...] | None:
    """Average of per-bookmaker proportionally de-vigged probabilities; only bookmakers quoting every selection."""
    by_bm: dict[str, dict[str, float]] = {}
    for r in rows:
        if r["market"] == market and r["selection"] in sels:
            by_bm.setdefault(r["bookmaker"], {})[r["selection"]] = r["odds"]
    probs = []
    for q in by_bm.values():
        if set(q) == set(sels):
            dv = devig_proportional(q)
            if dv:
                probs.append([dv[0][s] for s in sels])
    if len(probs) < 2:
        return None  # need >= 2 independent bookmakers for a consensus
    return tuple(float(x) for x in (sum(c) / len(probs) for c in zip(*probs)))
