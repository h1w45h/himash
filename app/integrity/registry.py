import hashlib
from datetime import UTC, datetime
from urllib.parse import urlparse

from app.integrity.labels import DISCLAIMER, IntegrityStatus
from app.storage.db import Database

REVIEW_STATES = {"pending", "approved", "rejected", "corrected"}


def add_item(db: Database, *, status: str, source_url: str, publisher: str, subject: str,
             competition: str, summary: str, source_type: str, published: str | None = None,
             snippet: str = "", allowed_domains: set[str] | None = None) -> int:
    st = IntegrityStatus(status)  # raises on unknown label
    u = urlparse(source_url)
    if u.scheme != "https" or not u.hostname:
        raise ValueError("source_url must be an https URL")
    if allowed_domains and not any(u.hostname == d or u.hostname.endswith("." + d) for d in allowed_domains):
        raise ValueError("source domain not in allowlist")
    if not (publisher and subject and summary):
        raise ValueError("publisher, subject and summary are required")
    return db.insert_integrity(
        status=st.value, source_url=source_url, publisher=publisher, published=published,
        retrieved_at=datetime.now(UTC).isoformat(), subject=subject, competition=competition,
        summary=summary, source_type=source_type,
        snippet_hash=hashlib.sha256(snippet.encode()).hexdigest() if snippet else None,
        review_state="pending")


def render_for_match(db: Database, names: list[str], competition: str) -> str:
    items = [i for i in db.integrity_items() if i["review_state"] == "approved"
             and (i["subject"] in names or i["competition"] == competition)]
    if not items:
        return "No reviewed, source-backed integrity records for this match. (Absence of records is not a statement of integrity.)"
    lines = []
    for i in items:
        lines.append(f"[{i['status']}] {i['subject']} — {i['summary']}\n  {DISCLAIMER[IntegrityStatus(i['status'])]} "
                     f"Source: {i['publisher']} {i['source_url']} (retrieved {i['retrieved_at'][:10]})")
    return "\n".join(lines)
