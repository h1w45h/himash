import { createRng } from '../../core/rng';
import type { BotContext, Seat } from '../../core/types';
import { BOARD, GROUP_SQUARES } from './board';
import { monopolyGame, ownedBy, type MonopolyAction, type MonopolyState } from './index';

/**
 * Бот «Монополии». Идея: покупать почти всё, застраивать полные наборы, держать запас наличных,
 * в долгах закладывать самое дешёвое. Обмены никогда не принимает (защита от эксплуатации).
 * Уровень влияет на осторожность с деньгами и долю случайных решений.
 */
export function chooseMonopolyAction(s: MonopolyState, seat: Seat, bot: BotContext): MonopolyAction {
  const legal = monopolyGame.legalActions(s, seat);
  const rng = createRng(bot.rngSeed);
  const has = (t: MonopolyAction['t']) => legal.find((a) => a.t === t);
  const reserve = bot.level === 'EASY' ? 50 : bot.level === 'MEDIUM' ? 150 : 250;
  const cash = s.cash[seat]!;

  // Без осмысленной стратегии лёгкий бот иногда ходит случайно, но не разоряет себя без нужды.
  if (bot.level === 'EASY' && rng.next() < 0.25) {
    const safe = legal.filter((a) => !['bankrupt', 'mortgage', 'sellHouse', 'accept'].includes(a.t) || s.phase === 'debt');
    if (safe.length) return safe[rng.int(safe.length)]!;
  }

  switch (s.phase) {
    case 'trade':
      return { t: 'reject' };

    case 'buy': {
      const pos = s.pos[seat]!;
      const sq = BOARD[pos]!;
      const price = 'price' in sq ? sq.price : 0;
      const buy = has('buy');
      if (buy && cash - price >= reserve) return buy;
      // Дешёвую «собственность, достраивающую набор», берём и с меньшим запасом.
      if (buy && sq.kind === 'street' && GROUP_SQUARES[sq.group].some((g) => s.props[g]?.owner === seat) && cash - price >= 0) return buy;
      return { t: 'decline' };
    }

    case 'auction': {
      const a = s.auction!;
      const sq = BOARD[a.sq]!;
      const value = 'price' in sq ? sq.price : 0;
      const ceiling = Math.min(cash - reserve, Math.floor(value * (bot.level === 'EXPERT' ? 1.2 : 0.95)));
      const next = legal.filter((x): x is Extract<MonopolyAction, { t: 'bid' }> => x.t === 'bid').sort((x, y) => x.amount - y.amount)[0];
      return next && next.amount <= ceiling ? next : { t: 'passBid' };
    }

    case 'debt': {
      // Сначала продаём постройки, затем закладываем самое дешёвое.
      const sell = legal.find((a) => a.t === 'sellHouse');
      if (sell) return sell;
      const mortgages = legal
        .filter((a): a is Extract<MonopolyAction, { t: 'mortgage' }> => a.t === 'mortgage')
        .sort((x, y) => ('price' in BOARD[x.sq]! ? (BOARD[x.sq] as { price: number }).price : 0) - ('price' in BOARD[y.sq]! ? (BOARD[y.sq] as { price: number }).price : 0));
      return mortgages[0] ?? { t: 'bankrupt' };
    }

    case 'roll':
    case 'manage': {
      const jailPay = has('jailPay');
      const jailCard = has('jailCard');
      if (s.phase === 'roll' && s.jail[seat]) {
        if (jailCard) return jailCard;
        // В начале игры из тюрьмы лучше выходить быстро — там ещё есть что покупать.
        if (jailPay && cash > 600 && ownedBy(s, seat).length < 6) return jailPay;
      }

      // Выкупаем заложенное при больших деньгах.
      const un = legal.find((a) => a.t === 'unmortgage');
      if (un && cash > 800) return un;

      // Застройка: самая дешёвая доступная постройка, пока остаётся запас.
      const builds = legal
        .filter((a): a is Extract<MonopolyAction, { t: 'build' }> => a.t === 'build')
        .map((a) => ({ a, cost: (BOARD[a.sq] as { houseCost: number }).houseCost }))
        .sort((x, y) => x.cost - y.cost);
      const b = builds[0];
      if (b && cash - b.cost >= (bot.level === 'EASY' ? 100 : 300)) return b.a;

      return has('roll') ?? has('endTurn') ?? legal[0]!;
    }
  }
}
