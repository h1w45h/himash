from enum import StrEnum


class IntegrityStatus(StrEnum):
    OFFICIAL_SANCTION = "official_sanction"
    OFFICIAL_INVESTIGATION = "official_investigation"
    MARKET_ANOMALY = "market_anomaly"
    UNVERIFIED_REPORT = "unverified_report"

# Status labels describe source/evidence status, not a probability of guilt.
# Never infer guilt or publish unsupported personal accusations from market anomalies.

DISCLAIMER = {
    IntegrityStatus.OFFICIAL_SANCTION: "Официально опубликованное решение.",
    IntegrityStatus.OFFICIAL_INVESTIGATION: "Официально объявленное расследование; это НЕ установление вины.",
    IntegrityStatus.MARKET_ANOMALY: "Статистический сигнал, требующий проверки; это НЕ доказательство нарушений.",
    IntegrityStatus.UNVERIFIED_REPORT: "Неподтверждённое сообщение; вины не утверждает.",
}
