from html import escape
from typing import Any

from app.forecast import Forecast
from app.providers.contracts import Fixture

DISCLAIMER = ("Exact-score outcomes are highly uncertain. Statistical estimates, not advice or a guarantee. "
              "18+ / gamble responsibly; obey local law.")


def fmt_fixture(f: Fixture) -> str:
    score = f" {f.home_goals}-{f.away_goals}" if f.home_goals is not None else ""
    minute = f" {f.minute}'" if f.status == "live" and f.minute else ""
    return (f"<code>{escape(f.match_id)}</code> {escape(f.home)} vs {escape(f.away)}{score} "
            f"[{f.status}{minute}] {f.kickoff:%Y-%m-%d %H:%M} UTC — {escape(f.competition)}")


def fmt_forecast(fc: Forecast) -> str:
    f = fc.fixture
    head = (f"<b>{escape(f.home)} vs {escape(f.away)}</b>\n{escape(f.competition)} | {fc.mode} | "
            f"<code>{escape(f.match_id)}</code>\nKickoff {f.kickoff:%Y-%m-%d %H:%M} UTC, status {f.status}")
    if not fc.available:
        return f"{head}\n\n<b>Forecast unavailable:</b> {escape(fc.reason or 'unknown')}\n\n{DISCLAIMER}"
    cur = f"{fc.offset[0]}-{fc.offset[1]}"
    lines = [head]
    if fc.mode == "live":
        lines.append(f"Live {cur}, minute {f.minute}")
    lines.append(f"Model {escape(fc.model_version)} | generated {fc.created_at:%H:%M:%S} UTC | "
                 f"provider data observed {f.observed_at:%H:%M:%S} UTC ({escape(f.provider)})")
    lines.append(f"Rate source: {escape(fc.source)}")
    if fc.movement:
        mv = fc.movement
        lines.append(f"Line movement ({mv['selection']} win): {mv['state']} — {escape(mv['detail'])} "
                     "(neutral signal; default threshold uncalibrated)")
    what = "Expected REMAINING goals" if fc.mode == "live" else "Expected goals"
    lines.append(f"{what}: {fc.rates[0]:.2f} - {fc.rates[1]:.2f} | trained on {fc.n_train} matches")
    if fc.outcome:
        o = fc.outcome
        lines.append(f"1X2: home {o['home']:.1%} / draw {o['draw']:.1%} / away {o['away']:.1%}")
    lines.append("<b>Top scorelines</b>" + (" (final score)" if fc.mode == "live" else ""))
    for h, a, p in fc.top:
        lines.append(f"  {h}-{a}: {p:.1%}  (fair odds {1 / p:.2f})")
    lines.append(f"Residual tail beyond grid: {fc.tail:.2%}")
    for flag in fc.flags:
        lines.append(f"ℹ {escape(flag)}")
    lines.append(f"\n{DISCLAIMER}")
    return "\n".join(lines)


def fmt_odds(fc: Forecast, ov: dict[str, Any], ev_min: float) -> str:
    if not ov.get("available"):
        return f"Odds unavailable: {escape(ov.get('reason', 'unknown'))}"
    out = ["<b>Exact-score odds vs model</b> (best fresh price across bookmakers)"]
    for ln in ov["lines"]:
        ev = ln["ev"]
        out.append(f"  {ln['score']}: model {ln['p']:.1%} fair {ln['fair']:.2f} | offered {ln['odds']:.2f} "
                   f"({escape(ln['bookmaker'])}, {ln['observed_at']:%H:%M:%S} UTC) | EV {ev:+.1%}")
    if not ov["lines"]:
        out.append("  no offered price for the top scorelines")
    if ov["market_complete"]:
        out.append(f"Market complete; estimated overround {ov['overround']:.1%} (proportional de-vig).")
    else:
        out.append("Market not complete (no 'other' selection): overround/de-vigged probabilities NOT claimed.")
    out.append("EV = p×odds−1 before costs, limits and tax; uncertain, depends on model calibration.")
    if not ov["ev_alert_gate_passed"]:
        out.append("No value alert: out-of-sample calibration gate not passed / alerts disabled.")
    return "\n".join(out)


def fmt_pick(pk: dict[str, Any]) -> str:
    if pk["status"] == "no_pick":
        return f"No pick: {escape(pk['reason'])}"
    out = [f"<b>Most likely exact score: {pk['score']}</b> — model p = {pk['p']:.1%} (source: {escape(pk['source'])})",
           f"Fair odds {pk['fair_odds']:.2f}; minimum odds for +EV after buffer: <b>{pk['min_odds']:.2f}</b>"]
    if "offered" in pk:
        out.append(f"Best offered: {pk['offered']:.2f} → EV {pk['ev']:+.1%}")
    verdict = {"bet": "PICK: price clears the bar.", "candidate": "CANDIDATE only: ",
               "no_bet": "NO BET: ", "no_price": "NO PRICE: "}[pk["status"]]
    out.append(verdict + escape(pk.get("reason", "")))
    out.append("Even the best exact score hits only ~1 time in 8; expect frequent losses. Estimate, not advice.")
    return "\n".join(out)


def fmt_line(fc: Forecast) -> str:
    """Required short form: country | tournament | teams | exact score."""
    f = fc.fixture
    head = f"{escape(f.country or 'n/a')} | {escape(f.competition)} | {escape(f.home)} — {escape(f.away)}"
    if not fc.available or not fc.top:
        return f"{head} | прогноз недоступен: {escape(fc.reason or 'нет данных')}"
    h, a, p = fc.top[0]
    return f"{head} | <b>{h}-{a}</b> ({p:.0%})"
