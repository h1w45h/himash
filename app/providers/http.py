import asyncio
import random
import time
from typing import Any

import httpx


class ProviderError(Exception):
    pass


class CircuitOpen(ProviderError):
    pass


class ResilientClient:
    """httpx wrapper: timeout, retries with exponential backoff + jitter, circuit breaker."""

    def __init__(self, base_url: str, headers: dict[str, str], *, retries: int = 3,
                 timeout: float = 10.0, breaker_threshold: int = 5, breaker_cooldown: float = 60.0,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._client = httpx.AsyncClient(base_url=base_url, headers=headers, timeout=timeout,
                                         transport=transport)
        self._retries = retries
        self._threshold = breaker_threshold
        self._cooldown = breaker_cooldown
        self._failures = 0
        self._opened_at = 0.0
        self.last_success_at: float | None = None

    async def get_json(self, path: str, params: dict[str, Any] | None = None) -> Any:
        if self._failures >= self._threshold and time.monotonic() - self._opened_at < self._cooldown:
            raise CircuitOpen("provider circuit breaker is open")
        last: Exception | None = None
        for attempt in range(self._retries + 1):
            try:
                r = await self._client.get(path, params=params)
                if r.status_code in (429, 500, 502, 503, 504):
                    raise ProviderError(f"HTTP {r.status_code}")
                r.raise_for_status()
                self._failures = 0
                self.last_success_at = time.time()
                return r.json()
            except (httpx.HTTPError, ProviderError, ValueError) as e:
                last = e
                if isinstance(e, httpx.HTTPStatusError) and e.response.status_code < 500:
                    break  # client error (bad key, bad params): retrying will not help
                if attempt < self._retries:
                    await asyncio.sleep(min(8.0, 0.5 * 2**attempt) * (0.5 + random.random()))
        self._failures += 1
        self._opened_at = time.monotonic()
        # never include headers (API keys) in the message
        raise ProviderError(f"request to {path} failed: {type(last).__name__}")

    async def aclose(self) -> None:
        await self._client.aclose()
