import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, per_minute: int) -> None:
        self.per_minute = per_minute
        self._hits: dict[int, deque[float]] = defaultdict(deque)

    def allow(self, user_id: int, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        q = self._hits[user_id]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= self.per_minute:
            return False
        q.append(now)
        return True


def is_allowed(user_id: int | None, allowed: set[int]) -> bool:
    """Private deployment: an empty allowlist denies everyone (fail closed)."""
    return user_id is not None and user_id in allowed
