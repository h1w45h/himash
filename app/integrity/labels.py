from enum import StrEnum


class IntegrityStatus(StrEnum):
    OFFICIAL_SANCTION = "official_sanction"
    OFFICIAL_INVESTIGATION = "official_investigation"
    MARKET_ANOMALY = "market_anomaly"
    UNVERIFIED_REPORT = "unverified_report"

# Status labels describe source/evidence status, not a probability of guilt.
# Never infer guilt or publish unsupported personal accusations from market anomalies.

DISCLAIMER = {
    IntegrityStatus.OFFICIAL_SANCTION: "Official published decision.",
    IntegrityStatus.OFFICIAL_INVESTIGATION: "Officially announced investigation; NOT a finding of guilt.",
    IntegrityStatus.MARKET_ANOMALY: "Statistical signal requiring review; NOT evidence of wrongdoing.",
    IntegrityStatus.UNVERIFIED_REPORT: "Unconfirmed report; makes no claim of guilt.",
}
