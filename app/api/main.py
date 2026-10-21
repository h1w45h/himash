from fastapi import FastAPI
from pydantic import BaseModel

from app.config import get_settings

app = FastAPI(
    title="FOOTBALL EXACT SCORE INTELLIGENCE",
    version="0.1.0",
    description="Health/readiness API. Bind to localhost / private network only.",
)


class HealthResponse(BaseModel):
    status: str
    app: str
    version: str


@app.get("/health", response_model=HealthResponse, tags=["operations"])
def health() -> HealthResponse:
    return HealthResponse(status="ok", app="fesi", version="0.1.0")


@app.get("/ready", tags=["operations"])
def ready() -> dict:
    s = get_settings()
    checks = {
        "football_api_key": bool(s.football_data_api_key),
        "telegram_token": bool(s.telegram_bot_token),
        "allowlist": bool(s.allowed_user_ids),
    }
    return {"status": "ready" if all(checks.values()) else "not-ready", "checks": checks}
