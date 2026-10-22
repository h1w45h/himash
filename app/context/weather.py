"""Match-time weather from Open-Meteo (free, no key; https://open-meteo.com, non-commercial use).

Informational only: the effect of weather on goals is NOT validated here and does not change probabilities
(bookmaker prices already include it). Fixed hosts only (no user-supplied URLs -> no SSRF).
"""
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx

GEO = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST = "https://api.open-meteo.com/v1/forecast"


@dataclass(frozen=True)
class Weather:
    temp_c: float
    precip_mm: float
    wind_kmh: float
    flags: list[str]


def summarize(payload: dict, kickoff: datetime) -> Weather | None:
    """Pick the hourly slot nearest kickoff; validate every value."""
    try:
        h = payload["hourly"]
        times = [datetime.fromisoformat(x).replace(tzinfo=UTC) for x in h["time"]]
        i = min(range(len(times)), key=lambda k: abs((times[k] - kickoff).total_seconds()))
        if abs((times[i] - kickoff).total_seconds()) > 3 * 3600:
            return None
        t, p, w = float(h["temperature_2m"][i]), float(h["precipitation"][i]), float(h["wind_speed_10m"][i])
    except (KeyError, TypeError, ValueError, IndexError):
        return None
    flags = []
    if p >= 2.0:
        flags.append("heavy rain expected")
    if w >= 35:
        flags.append("strong wind")
    if t <= 0 or t >= 32:
        flags.append("extreme temperature")
    return Weather(t, p, w, flags)


async def get_weather(city: str, kickoff: datetime, transport: httpx.AsyncBaseTransport | None = None) -> Weather | None:
    async with httpx.AsyncClient(timeout=10.0, transport=transport) as c:
        g = (await c.get(GEO, params={"name": city, "count": 1})).json()
        res = (g.get("results") or [None])[0]
        if not res:
            return None
        day = kickoff.date().isoformat()
        r = await c.get(FORECAST, params={
            "latitude": res["latitude"], "longitude": res["longitude"], "timezone": "UTC",
            "hourly": "temperature_2m,precipitation,wind_speed_10m", "start_date": day, "end_date": day})
        r.raise_for_status()
        return summarize(r.json(), kickoff)
