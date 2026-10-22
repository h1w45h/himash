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
        errors.append(f"{what}: недоступно ({type(e).__name__})")
        return None


async def build_context(fx: Fixture, football: Any) -> dict[str, Any]:
    errors: list[str] = []
    pid = fx.match_id.split(":", 1)[1]
    has_lu = hasattr(football, "get_lineups")
    w_t = _safe(weather.get_weather(fx.venue_city, fx.kickoff), "погода", errors) if fx.venue_city else asyncio.sleep(0)
    l_t = _safe(football.get_lineups(pid), "составы", errors) if has_lu else asyncio.sleep(0)
    i_t = _safe(football.get_injuries(pid), "травмы", errors) if has_lu else asyncio.sleep(0)
    n_t = [_safe(news.get_headlines(t), f"новости ({t})", errors) for t in (fx.home, fx.away)]
    w, lineups, injuries, nh, na = await asyncio.gather(w_t, l_t, i_t, *n_t)
    ctx: dict[str, Any] = {"errors": errors, "погода": w, "headlines": (nh or []) + (na or []), "flags": []}
    if w:
        ctx["flags"] += w.flags
    elif not fx.venue_city:
        errors.append("погода: недоступно (город стадиона неизвестен)")
    if has_lu and (lineups is not None or injuries is not None):
        ctx["teams"] = lu.summarize(lineups or [], injuries or [], fx.home, fx.away)
        ctx["flags"] += lu.flags(ctx["teams"], (fx.kickoff - datetime.now(UTC)).total_seconds() / 60)
    elif not has_lu:
        errors.append("составы/травмы: источник их не предоставляет")
    return ctx


def fmt_context(fx: Fixture, c: dict[str, Any]) -> str:
    out = [f"<b>Контекст: {escape(fx.home)} — {escape(fx.away)}</b>",
           "Только для информации — вероятности НЕ меняет (рыночные цены уже учитывают публичные новости)."]
    if c.get("погода"):
        w = c["погода"]
        out.append(f"Погода к началу матча ({escape(fx.venue_city or '')}): {w.temp_c:.0f}°C, осадки {w.precip_mm:.1f} мм/ч, ветер {w.wind_kmh:.0f} км/ч")
    for n in (c.get("teams") or {}).values():
        inj = ", ".join(escape(p) for p in n.injured[:6]) or "нет в списке"
        out.append(f"{escape(n.team)}: схема {n.formation or 'н/д'}, в старте {n.starters or 'состав не опубликован'}; травмы/дисквалификации: {inj}")
    if c["headlines"]:
        out.append("Свежие заголовки (НЕ ПРОВЕРЕНО, пресса):")
        out += [f"  • {escape(h.title)} — {escape(h.domain)} {escape(h.url)}" for h in c["headlines"]]
    for f in c["flags"]:
        out.append(f"⚠ {escape(f)}")
    for e in c["errors"]:
        out.append(f"ℹ {escape(e)}")
    return "\n".join(out)
