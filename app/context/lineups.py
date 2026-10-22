"""Lineups / injuries summary from provider payloads (API-Football shapes)."""
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TeamNews:
    team: str
    formation: str | None = None
    starters: int = 0
    injured: list[str] = field(default_factory=list)


def summarize(lineups: list[dict[str, Any]], injuries: list[dict[str, Any]], home: str, away: str) -> dict[str, TeamNews]:
    out = {home: TeamNews(home), away: TeamNews(away)}
    for lu in lineups:
        try:
            name = lu["team"]["name"]
            if name in out:
                out[name].formation = lu.get("formation")
                out[name].starters = len(lu.get("startXI") or [])
        except (KeyError, TypeError):
            continue
    for inj in injuries:
        try:
            name, player = inj["team"]["name"], inj["player"]["name"]
            if name in out and player not in out[name].injured:
                out[name].injured.append(player)
        except (KeyError, TypeError):
            continue
    return out


def flags(news: dict[str, TeamNews], minutes_to_kickoff: float) -> list[str]:
    f = []
    published = all(n.starters == 11 for n in news.values())
    if not published:
        f.append("составы ещё не опубликованы" + (" (<75 мин до начала: рынок ещё может сдвинуться)" if minutes_to_kickoff < 75 else ""))
    for n in news.values():
        if len(n.injured) >= 3:
            f.append(f"{n.team}: {len(n.injured)} игроков в списке травмированных/дисквалифицированных")
    return f
