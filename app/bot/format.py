from html import escape
from typing import Any

from app.forecast import Forecast
from app.providers.contracts import Fixture
from app.staking.fibonacci import losing_streak_prob, outlay_to_level

DISCLAIMER = ("Точный счёт крайне неопределён. Это статистическая оценка, а не совет и не гарантия. "
              "18+, играйте ответственно, соблюдайте местное законодательство.")
STATUS = {"scheduled": "не начался", "live": "идёт", "finished": "завершён", "other": "иной"}
MODE = {"prematch": "до матча", "live": "live"}
MOVE = {"stable": "стабильно", "shortening": "коэффициент падает (прижатие)", "drifting": "коэффициент растёт",
        "insufficient_data": "недостаточно данных"}
SIDE = {"home": "победа хозяев", "away": "победа гостей"}


def fmt_fixture(f: Fixture) -> str:
    score = f" {f.home_goals}-{f.away_goals}" if f.home_goals is not None else ""
    minute = f" {f.minute}'" if f.status == "live" and f.minute else ""
    return (f"<code>{escape(f.match_id)}</code> {escape(f.home)} — {escape(f.away)}{score} "
            f"[{STATUS.get(f.status, f.status)}{minute}] {f.kickoff:%d.%m.%Y %H:%M} UTC — {escape(f.competition)}")


def fmt_forecast(fc: Forecast) -> str:
    f = fc.fixture
    head = (f"<b>{escape(f.country or 'n/a')} | {escape(f.competition)}</b>\n<b>{escape(f.home)} — {escape(f.away)}</b>\n"
            f"{MODE[fc.mode]} | <code>{escape(f.match_id)}</code>\n"
            f"Начало {f.kickoff:%d.%m.%Y %H:%M} UTC, статус: {STATUS.get(f.status, f.status)}")
    if not fc.available:
        return f"{head}\n\n<b>Прогноз недоступен:</b> {escape(fc.reason or 'причина неизвестна')}\n\n{DISCLAIMER}"
    lines = [head]
    if fc.mode == "live":
        lines.append(f"Сейчас {fc.offset[0]}-{fc.offset[1]}, {f.minute}-я минута")
    lines.append(f"Модель {escape(fc.model_version)} | рассчитано {fc.created_at:%H:%M:%S} UTC | "
                 f"данные источника получены {f.observed_at:%H:%M:%S} UTC ({escape(f.provider)})")
    lines.append(f"Источник интенсивности голов: {'рынок (коэффициенты без маржи)' if fc.source == 'market-implied' else 'модель Диксона–Коулза'}")
    if fc.movement:
        mv = fc.movement
        lines.append(f"Движение линии ({SIDE.get(mv['selection'], mv['selection'])}): {MOVE.get(mv['state'], mv['state'])} — "
                     f"{escape(mv['detail'])} (нейтральный сигнал; порог по умолчанию не откалиброван)")
    what = "Ожидаемые ОСТАВШИЕСЯ голы" if fc.mode == "live" else "Ожидаемые голы"
    lines.append(f"{what}: {fc.rates[0]:.2f} - {fc.rates[1]:.2f} | обучено на {fc.n_train} матчах")
    if fc.outcome:
        o = fc.outcome
        lines.append(f"1X2: хозяева {o['home']:.1%} / ничья {o['draw']:.1%} / гости {o['away']:.1%}")
    lines.append("<b>Самые вероятные счета</b>" + (" (итоговый счёт)" if fc.mode == "live" else ""))
    for h, a, p in fc.top:
        lines.append(f"  {h}-{a}: {p:.1%}  (честный коэффициент {1 / p:.2f})")
    lines.append(f"Остаток вероятности за пределами таблицы: {fc.tail:.2%}")
    for flag in fc.flags:
        lines.append(f"ℹ {escape(flag)}")
    lines.append(f"\n{DISCLAIMER}")
    return "\n".join(lines)


def fmt_odds(fc: Forecast, ov: dict[str, Any], ev_min: float) -> str:
    if not ov.get("available"):
        return f"Коэффициенты недоступны: {escape(ov.get('reason', 'причина неизвестна'))}"
    out = ["<b>Коэффициенты на точный счёт и модель</b> (лучшая свежая цена среди букмекеров)"]
    for ln in ov["lines"]:
        out.append(f"  {ln['score']}: модель {ln['p']:.1%}, честный {ln['fair']:.2f} | предложено {ln['odds']:.2f} "
                   f"({escape(ln['bookmaker'])}, {ln['observed_at']:%H:%M:%S} UTC) | EV {ln['ev']:+.1%}")
    if not ov["lines"]:
        out.append("  по самым вероятным счетам цен нет")
    if ov["market_complete"]:
        out.append(f"Рынок полный; оценка маржи {ov['overround']:.1%} (пропорциональное снятие маржи).")
    else:
        out.append("Рынок неполный (нет позиции «другой счёт»): маржа и вероятности без маржи НЕ заявляются.")
    out.append("EV = p×коэффициент−1 до комиссий, лимитов и налогов; это оценка, зависит от калибровки модели.")
    if not ov["ev_alert_gate_passed"]:
        out.append("Сигнала «ценность» нет: проверка калибровки вне выборки не пройдена / сигналы выключены.")
    return "\n".join(out)


def fmt_pick(pk: dict[str, Any]) -> str:
    if pk["status"] == "no_pick":
        return f"Прогноза нет: {escape(pk['reason'])}"
    src = "рынок" if pk["source"] == "market-implied" else "Диксон–Коулз"
    out = [f"<b>Наиболее вероятный точный счёт: {pk['score']}</b> — вероятность {pk['p']:.1%} (источник: {src})",
           f"Честный коэффициент {pk['fair_odds']:.2f}; минимальный коэффициент для +EV с запасом: <b>{pk['min_odds']:.2f}</b>"]
    if "offered" in pk:
        out.append(f"Лучшее предложение: {pk['offered']:.2f} → EV {pk['ev']:+.1%}")
    verdict = {"bet": "СТАВКА: цена проходит порог.", "candidate": "ТОЛЬКО КАНДИДАТ: ",
               "no_bet": "НЕ СТАВИТЬ: ", "no_price": "НЕТ ЦЕНЫ: "}[pk["status"]]
    out.append(verdict + escape(pk.get("reason", "")))
    if pk["status"] in ("candidate", "bet", "no_price"):
        p = pk["p"]
        out.append(f"Ставка: плоская, 1 единица (≤1% банка). Лесенка Фибоначчи НЕ рекомендуется: при p={p:.1%} "
                   f"вероятность 8 проигрышей подряд = {losing_streak_prob(p, 8):.0%}, а 7 проигрышей стоят "
                   f"{outlay_to_level(6)} ед. (симуляция: scripts/staking_sim.py).")
    out.append("Даже лучший точный счёт угадывается примерно 1 раз из 8; частые проигрыши неизбежны. Оценка, не совет.")
    return "\n".join(out)


def fmt_line(fc: Forecast) -> str:
    """Required short form: country | tournament | teams | exact score."""
    f = fc.fixture
    head = f"{escape(f.country or 'n/a')} | {escape(f.competition)} | {escape(f.home)} — {escape(f.away)}"
    if not fc.available or not fc.top:
        return f"{head} | прогноз недоступен: {escape(fc.reason or 'нет данных')}"
    h, a, p = fc.top[0]
    return f"{head} | <b>{h}-{a}</b> ({p:.0%})"
