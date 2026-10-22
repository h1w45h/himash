import asyncio
import functools
import logging
from datetime import UTC, datetime, timedelta
from math import log as ln

from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes

from app.bot.format import DISCLAIMER, fmt_fixture, fmt_forecast, fmt_line, fmt_odds, fmt_pick
from app.bot.security import RateLimiter, is_allowed
from app.config import Settings
from app.context.service import build_context, fmt_context
from app.forecast import ForecastService
from app.integrity.registry import render_for_match
from app.storage.db import Database

log = logging.getLogger("fesi.bot")
HTML = ParseMode.HTML


class FesiBot:
    def __init__(self, s: Settings, service: ForecastService, db: Database) -> None:
        self.s, self.svc, self.db = s, service, db
        self.limiter = RateLimiter(s.commands_per_minute)

    # ---- plumbing -------------------------------------------------------------------------
    def guarded(fn):  # noqa: N805
        @functools.wraps(fn)
        async def wrapper(self, update: Update, ctx: ContextTypes.DEFAULT_TYPE):
            if update.message is None:
                return  # edited messages / non-message updates carry nothing to answer
            uid = update.effective_user.id if update.effective_user else None
            if not is_allowed(uid, self.s.allowed_user_ids):
                log.warning("unauthorized access attempt")
                if update.message:
                    await update.message.reply_text("Доступ запрещён. Это закрытая установка.")
                return
            if not self.limiter.allow(uid):
                await update.message.reply_text("Превышен лимит запросов; повторите через минуту.")
                return
            try:
                await fn(self, update, ctx)
            except Exception:
                log.exception("handler failed")
                await update.message.reply_text("Внутренняя ошибка; она записана в журнал.")
        return wrapper

    async def _reply(self, update: Update, text: str) -> None:
        for i in range(0, len(text), 3900):
            await update.message.reply_text(text[i:i + 3900], parse_mode=HTML, disable_web_page_preview=True)

    async def _fixture(self, update: Update, ctx):
        if not ctx.args:
            await update.message.reply_text("Использование: /<команда> <id_матча>  (id берите из /today или /live)")
            return None
        if not self.svc.football:
            await update.message.reply_text("Источник данных не настроен.")
            return None
        mid = ctx.args[0].split(":", 1)[-1]
        if not mid.isdigit():
            await update.message.reply_text("Некорректный id матча.")
            return None
        fx = await self.svc.football.get_fixture(mid)
        if fx is None:
            await update.message.reply_text("Матч не найден у источника данных.")
        return fx

    # ---- commands -------------------------------------------------------------------------
    @guarded
    async def start(self, update, ctx):
        await self._reply(update, f"<b>FESI</b> — аналитика точных счетов в футболе.\n{DISCLAIMER}\n"
                                  "Автоматических ставок нет. Команды: /help.")

    @guarded
    async def help(self, update, ctx):
        await self._reply(update,
            "/today — матчи на сегодня\n/tips — сегодня: страна | турнир | команды | точный счёт\n"
            "/match &lt;id&gt; — полный разбор\n/score &lt;id&gt; — прогноз одной строкой\n"
            "/pick &lt;id&gt; — наиболее вероятный точный счёт и минимальный коэффициент\n"
            "/odds &lt;id&gt; — коэффициенты, честные коэффициенты, EV\n"
            "/context &lt;id&gt; — погода, составы, травмы, заголовки новостей\n"
            "/live — матчи в live\n/integrity &lt;id&gt; — проверенные записи с источниками\n"
            "/watch &lt;id&gt; /unwatch &lt;id&gt; — оповещения о голах и за час до начала\n"
            "/report — качество прогнозов\n/settings — настройки (только чтение)\n/status — состояние источников\n\n"
            "Ограничения: охват зависит от источника и тарифа; при нехватке или устаревании данных прогноз не выдаётся.")

    @guarded
    async def today(self, update, ctx):
        if not self.svc.football:
            return await self._reply(update, "Источник футбольных данных не настроен (задайте FOOTBALL_DATA_API_KEY).")
        d = datetime.now(UTC).date().isoformat()
        fxs = sorted(await self.svc.football.get_fixtures(d, d), key=lambda f: f.kickoff)[:40]
        await self._reply(update, "\n".join(fmt_fixture(f) for f in fxs) or "Источник не вернул матчей на сегодня.")

    @guarded
    async def live(self, update, ctx):
        if not self.svc.football:
            return await self._reply(update, "Источник футбольных данных не настроен.")
        fxs = (await self.svc.football.get_live())[:40]
        await self._reply(update, "\n".join(fmt_fixture(f) for f in fxs) or "Источник не сообщает о матчах в live.")

    @guarded
    async def match(self, update, ctx):
        fx = await self._fixture(update, ctx)
        if fx:
            await self._reply(update, fmt_forecast(await self.svc.forecast(fx)))

    @guarded
    async def score(self, update, ctx):
        fx = await self._fixture(update, ctx)
        if fx:
            await self._reply(update, fmt_line(await self.svc.forecast(fx)) + f"\n\n{DISCLAIMER}")

    @guarded
    async def tips(self, update, ctx):
        """Today's not-yet-finished matches in the form: country | tournament | teams | exact score."""
        if not self.svc.football:
            return await self._reply(update, "Источник футбольных данных не настроен.")
        d = datetime.now(UTC).date().isoformat()
        fxs = sorted((f for f in await self.svc.football.get_fixtures(d, d) if f.status != "finished"),
                     key=lambda f: f.kickoff)[:self.s.max_tips]
        if not fxs:
            return await self._reply(update, "Источник не вернул предстоящих матчей на сегодня.")
        lines = [fmt_line(await self.svc.forecast(f)) for f in fxs]
        await self._reply(update, "\n".join(lines) + f"\n\n{DISCLAIMER}")

    @guarded
    async def odds(self, update, ctx):
        fx = await self._fixture(update, ctx)
        if not fx:
            return
        fc = await self.svc.forecast(fx)
        if not fc.available:
            return await self._reply(update, fmt_forecast(fc))
        await self._reply(update, fmt_odds(fc, await self.svc.odds_view(fc), self.s.ev_min_threshold))

    @guarded
    async def pick(self, update, ctx):
        fx = await self._fixture(update, ctx)
        if not fx:
            return
        fc = await self.svc.forecast(fx)
        pk = self.svc.pick(fc, await self.svc.exact_prices(fc) if fc.available else None)
        text = fmt_pick(pk)
        if fc.available:
            cx = await build_context(fx, self.svc.football)
            text += "".join(f"\n⚠ {f}" for f in cx["flags"])
        await self._reply(update, text)

    @guarded
    async def context(self, update, ctx):
        fx = await self._fixture(update, ctx)
        if fx:
            await self._reply(update, fmt_context(fx, await build_context(fx, self.svc.football)))

    @guarded
    async def integrity(self, update, ctx):
        fx = await self._fixture(update, ctx)
        if fx:
            await self._reply(update, render_for_match(self.db, [fx.home, fx.away], fx.competition))

    @guarded
    async def watch(self, update, ctx):
        fx = await self._fixture(update, ctx)
        if fx:
            self.db.add_watch(update.effective_user.id, fx.match_id)
            await self._reply(update, f"Слежу за {fx.match_id}. Оповещу о голах и примерно за 60 минут до начала.")

    @guarded
    async def unwatch(self, update, ctx):
        if not ctx.args:
            return await update.message.reply_text("Использование: /unwatch <id_матча>")
        mid = ctx.args[0] if ":" in ctx.args[0] else f"{self.svc.football.name}:{ctx.args[0]}"
        ok = self.db.remove_watch(update.effective_user.id, mid)
        await update.message.reply_text("Удалено." if ok else "Вы не следили за этим матчем.")

    @guarded
    async def report(self, update, ctx):
        await self._resolve_forecasts()
        rows = self.db.resolved_forecasts()
        if not rows:
            return await self._reply(update, "Пока нет оценённых прогнозов (они оцениваются после окончания матчей).")
        import json
        ll, hits = [], 0
        for r in rows:
            p = json.loads(r["payload"])["probs"]
            h, a = r["outcome_home"], r["outcome_away"]
            pr = p[h][a] if h < len(p) and a < len(p[0]) else 1e-12
            ll.append(-ln(max(pr, 1e-12)))
            top = max(((i, j) for i in range(len(p)) for j in range(len(p[0]))), key=lambda t: p[t[0]][t[1]])
            hits += top == (h, a)
        n = len(rows)
        await self._reply(update, f"Оценено доматчевых прогнозов: {n}\nСредний log loss: {sum(ll) / n:.3f}\n"
                                  f"Доля попаданий в самый вероятный счёт: {hits / n:.1%} (описательно; малые выборки шумные)\n"
                                  "Бэктесты по турнирам — внизу /match. Доходность (ROI) не заявляется.")

    @guarded
    async def settings(self, update, ctx):
        await self._reply(update, f"Модель {self.s.model_version}; порог EV {self.s.ev_min_threshold:.0%}; "
                                  f"сигналы ценности {'включены' if self.s.ev_alerts_enabled else 'выключены'}; часовой пояс UTC. "
                                  "Персональные настройки пока не реализованы.")

    @guarded
    async def status(self, update, ctx):
        fb = self.svc.football
        last = getattr(getattr(fb, "client", None), "last_success_at", None)
        txt = (f"Футбольные данные: {fb.name if fb else 'НЕ НАСТРОЕНО'}"
               f"{'' if last is None else f' (последний успешный запрос {datetime.fromtimestamp(last, UTC):%H:%M:%S} UTC)'}\n"
               f"Коэффициенты: {self.svc.odds.name if self.svc.odds else 'НЕ НАСТРОЕНО'}")
        await self._reply(update, txt)

    # ---- background -----------------------------------------------------------------------
    async def _resolve_forecasts(self) -> None:
        if not self.svc.football:
            return
        for r in self.db.unresolved_forecasts():
            try:
                fx = await self.svc.football.get_fixture(r["match_id"].split(":", 1)[1])
            except Exception:
                continue
            if fx and fx.status == "finished" and fx.home_goals is not None and fx.away_goals is not None:
                self.db.resolve_forecast(r["id"], fx.home_goals, fx.away_goals)

    async def poll_watches(self, ctx: ContextTypes.DEFAULT_TYPE) -> None:
        if not self.svc.football:
            return
        by_match: dict[str, list[int]] = {}
        for uid, mid in self.db.watches():
            by_match.setdefault(mid, []).append(uid)
        for mid, users in by_match.items():
            try:
                fx = await self.svc.football.get_fixture(mid.split(":", 1)[1])
            except Exception:
                continue
            if not fx:
                continue
            alerts = []
            if fx.status == "scheduled" and timedelta(0) < fx.kickoff - datetime.now(UTC) <= timedelta(minutes=60):
                alerts.append("prematch_60m")
            if fx.status == "live" and fx.home_goals is not None:
                alerts.append(f"goal:{fx.home_goals}-{fx.away_goals}")
            for alert in alerts:
                fc = await self.svc.forecast(fx)
                for uid in users:
                    if not self.db.claim_notification(uid, mid, self.s.model_version, alert):
                        continue
                    try:
                        await ctx.bot.send_message(uid, fmt_forecast(fc), parse_mode=HTML)
                    except Exception:
                        self.db.release_notification(uid, mid, self.s.model_version, alert)  # retry next poll
            await asyncio.sleep(0.2)  # provider/Telegram pacing


def build_application(s: Settings, service: ForecastService, db: Database) -> Application:
    if not s.telegram_bot_token:
        raise SystemExit("TELEGRAM_BOT_TOKEN is not set")
    if not s.allowed_user_ids:
        log.warning("TELEGRAM_ALLOWED_USER_IDS is empty: every user will be denied")
    bot = FesiBot(s, service, db)
    app = Application.builder().token(s.telegram_bot_token).build()
    for name in ("start", "help", "today", "tips", "match", "score", "live", "odds", "integrity", "watch",
                 "unwatch", "pick", "context", "report", "settings", "status"):
        app.add_handler(CommandHandler(name, getattr(bot, name)))
    app.job_queue.run_repeating(bot.poll_watches, interval=max(s.live_poll_seconds, 30), first=15)
    return app
