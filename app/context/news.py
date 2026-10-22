"""Recent headlines from GDELT DOC 2.0 (free, no key). Headline + source link only.

Shown as UNVERIFIED context for a human reader (rule: rumours never feed the model or integrity claims).
"""
from dataclasses import dataclass

import httpx

URL = "https://api.gdeltproject.org/api/v2/doc/doc"


@dataclass(frozen=True)
class Headline:
    title: str
    url: str
    domain: str
    seen: str


def parse(payload: dict, limit: int = 5) -> list[Headline]:
    out = []
    for a in (payload.get("articles") or [])[:limit]:
        try:
            url = str(a["url"])
            if not url.startswith("https://"):
                continue
            out.append(Headline(str(a["title"])[:160], url, str(a.get("domain", "")), str(a.get("seendate", ""))))
        except KeyError:
            continue
    return out


async def get_headlines(team: str, transport: httpx.AsyncBaseTransport | None = None) -> list[Headline]:
    q = f'"{team.replace(chr(34), "")}" (injury OR lineup OR suspended OR squad)'
    async with httpx.AsyncClient(timeout=10.0, transport=transport) as c:
        r = await c.get(URL, params={"query": q, "mode": "artlist", "format": "json", "maxrecords": 5,
                                     "timespan": "3d", "sort": "datedesc"})
        r.raise_for_status()
        return parse(r.json())
