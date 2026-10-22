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
                    await update.message.reply_text("Access denied. This is a private deployment.")
                return
            if not self.limiter.allow(uid):
                await update.message.reply_text("Rate limit exceeded; try again in a minute.")
                return
            try:
                await fn(self, update, ctx)
            except Exception:
                log.exception("handler failed")
                await update.message.reply_text("Internal error; the failure was logged.")
        return wrapper

    async def _reply(self, update: Update, text: str) -> None:
        for i in range(0, len(text), 3900):
            await update.message.reply_text(text[i:i + 3900], parse_mode=HTML, disable_web_page_preview=True)

    async def _fixture(self, update: Update, ctx):
        if not ctx.args:
            await update.message.reply_text("Usage: /<command> <match_id>  (ids come from /today or /live)")
            return None
        if not self.svc.football:
            await update.message.reply_text("No data provider configured.")
            return None
        mid = ctx.args[0].split(":", 1)[-1]
        if not mid.isdigit():
            await update.message.reply_text("Invalid match id.")
            return None
        fx = await self.svc.football.get_fixture(mid)
        if fx is None:
            await update.message.reply_text("Match not found at the provider.")
        return fx

    # ---- commands -------------------------------------------------------------------------
    @guarded
    async def start(self, update, ctx):
        await self._reply(update, f"<b>FESI</b> — football exact-score analytics.\n{DISCLAIMER}\n"
                                  "No automatic betting. /help for commands.")

    @guarded
    async def help(self, update, ctx):
        await self._reply(update,
            "/today — today's fixtures\n/match &lt;id&gt; — full analysis\n/score &lt;id&gt; — scoreline ranking\n"
            "/live — live matches\n/odds &lt;id&gt; — odds, fair odds, EV\n/integrity &lt;id&gt; — source-backed notes\n"
            "/watch &lt;id&gt; /unwatch &lt;id&gt; — goal/kickoff-hour alerts\n/report — model performance\n"
            "/settings — configuration (read-only)\n/status — provider health\n\n"
            "Limits: coverage depends on the configured provider/plan; forecasts are suppressed when data is "
            "insufficient or stale.")

    @guarded
    async def today(self, update, ctx):
        if not self.svc.football:
            return await self._reply(update, "No football data provider configured (set FOOTBALL_DATA_API_KEY).")
        d = datetime.now(UTC).date().isoformat()
        fxs = sorted(await self.svc.football.get_fixtures(d, d), key=lambda f: f.kickoff)[:40]
        await self._reply(update, "\n".join(fmt_fixture(f) for f in fxs) or "No fixtures returned by the provider for today.")

    @guarded
    async def live(self, update, ctx):
        if not self.svc.football:
            return await self._reply(update, "No football data provider configured.")
        fxs = (await self.svc.football.get_live())[:40]
        await self._reply(update, "\n".join(fmt_fixture(f) for f in fxs) or "No live matches reported by the provider.")

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
            return await self._reply(update, "No football data provider configured.")
        d = datetime.now(UTC).date().isoformat()
        fxs = sorted((f for f in await self.svc.football.get_fixtures(d, d) if f.status != "finished"),
                     key=lambda f: f.kickoff)[:self.s.max_tips]
        if not fxs:
            return await self._reply(update, "No upcoming matches returned by the provider for today.")
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
            await self._reply(update, f"Watching {fx.match_id}. You get an alert on goals and ~60 min before kickoff.")

    @guarded
    async def unwatch(self, update, ctx):
        if not ctx.args:
            return await update.message.reply_text("Usage: /unwatch <match_id>")
        mid = ctx.args[0] if ":" in ctx.args[0] else f"{self.svc.football.name}:{ctx.args[0]}"
        ok = self.db.remove_watch(update.effective_user.id, mid)
        await update.message.reply_text("Removed." if ok else "You were not watching that match.")

    @guarded
    async def report(self, update, ctx):
        await self._resolve_forecasts()
        rows = self.db.resolved_forecasts()
        if not rows:
            return await self._reply(update, "No resolved forecasts yet (forecasts are resolved after matches finish).")
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
        await self._reply(update, f"Resolved pre-match forecasts: {n}\nMean log loss: {sum(ll) / n:.3f}\n"
                                  f"Top-1 exact-score hit rate: {hits / n:.1%} (descriptive; small samples are noisy)\n"
                                  "Backtests per competition: see /match footer. No ROI is claimed.")

    @guarded
    async def settings(self, update, ctx):
        await self._reply(update, f"Model {self.s.model_version}; EV threshold {self.s.ev_min_threshold:.0%}; "
                                  f"EV alerts {'on' if self.s.ev_alerts_enabled else 'off'}; timezone UTC. "
                                  "Per-user settings are not implemented yet.")

    @guarded
    async def status(self, update, ctx):
        fb = self.svc.football
        last = getattr(getattr(fb, "client", None), "last_success_at", None)
        txt = (f"Football provider: {fb.name if fb else 'NOT CONFIGURED'}"
               f"{'' if last is None else f' (last OK {datetime.fromtimestamp(last, UTC):%H:%M:%S} UTC)'}\n"
               f"Odds provider: {self.svc.odds.name if self.svc.odds else 'NOT CONFIGURED'}")
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
