"""Collects context for a match. Every source fails soft; nothing here changes the probabilities."""
import asyncio
from datetime import UTC, datetime
from html import escape
from typing import Any

from app.context import lineups as lu
from app.context import news, weather
from app.providers.contracts import Fixture


async def _safe(coro, what: str, errors: list[str]):
    try:
        return await coro
    except Exception as e:  # network/provider failure: report, never invent
        errors.append(f"{what} unavailable ({type(e).__name__})")
        return None


async def build_context(fx: Fixture, football: Any) -> dict[str, Any]:
    errors: list[str] = []
    pid = fx.match_id.split(":", 1)[1]
    has_lu = hasattr(football, "get_lineups")
    w_t = _safe(weather.get_weather(fx.venue_city, fx.kickoff), "weather", errors) if fx.venue_city else asyncio.sleep(0)
    l_t = _safe(football.get_lineups(pid), "lineups", errors) if has_lu else asyncio.sleep(0)
    i_t = _safe(football.get_injuries(pid), "injuries", errors) if has_lu else asyncio.sleep(0)
    n_t = [_safe(news.get_headlines(t), f"news ({t})", errors) for t in (fx.home, fx.away)]
    w, lineups, injuries, nh, na = await asyncio.gather(w_t, l_t, i_t, *n_t)
    ctx: dict[str, Any] = {"errors": errors, "weather": w, "headlines": (nh or []) + (na or []), "flags": []}
    if w:
        ctx["flags"] += w.flags
    elif not fx.venue_city:
        errors.append("weather unavailable (venue city unknown)")
    if has_lu and (lineups is not None or injuries is not None):
        ctx["teams"] = lu.summarize(lineups or [], injuries or [], fx.home, fx.away)
        ctx["flags"] += lu.flags(ctx["teams"], (fx.kickoff - datetime.now(UTC)).total_seconds() / 60)
    elif not has_lu:
        errors.append("lineups/injuries unavailable (provider does not supply them)")
    return ctx


def fmt_context(fx: Fixture, c: dict[str, Any]) -> str:
    out = [f"<b>Context: {escape(fx.home)} vs {escape(fx.away)}</b>",
           "Informational only — does NOT change the probabilities (market prices already include public news)."]
    if c.get("weather"):
        w = c["weather"]
        out.append(f"Weather at kickoff ({escape(fx.venue_city or '')}): {w.temp_c:.0f}°C, rain {w.precip_mm:.1f} mm/h, wind {w.wind_kmh:.0f} km/h")
    for n in (c.get("teams") or {}).values():
        inj = ", ".join(escape(p) for p in n.injured[:6]) or "none listed"
        out.append(f"{escape(n.team)}: formation {n.formation or 'n/a'}, starters {n.starters or 'not published'}; injured/suspended: {inj}")
    if c["headlines"]:
        out.append("Recent headlines (UNVERIFIED, press):")
        out += [f"  • {escape(h.title)} — {escape(h.domain)} {escape(h.url)}" for h in c["headlines"]]
    for f in c["flags"]:
        out.append(f"⚠ {escape(f)}")
    for e in c["errors"]:
        out.append(f"ℹ {escape(e)}")
    return "\n".join(out)
