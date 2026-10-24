import { createRng } from '../../core/rng';
import type { BotContext, Seat } from '../../core/types';
import { canTransfer, durakGame, type Card, type DurakAction, type DurakState } from './index';

/**
 * Бот Дурака. Эвристики:
 *  - атака/подкидывание: младшие некозыри, козыри бережём;
 *  - защита: бьём самой дешёвой картой; козырем на мелочь не бьём, пока колода велика;
 *  - если защитник берёт — подкидываем всё лишнее, кроме козырей.
 * На лёгком уровне часть ходов — случайные допустимые.
 */
export function chooseDurakAction(s: DurakState, seat: Seat, bot: BotContext): DurakAction {
  const legal = durakGame.legalActions(s, seat);
  const rng = createRng(bot.rngSeed);
  const randomness = bot.level === 'EASY' ? 0.45 : bot.level === 'MEDIUM' ? 0.1 : 0;
  if (rng.next() < randomness) return legal[rng.int(legal.length)]!;

  const cost = (c: Card) => c.rank + (c.suit === s.trump ? 20 : 0);
  const cheapest = <T extends { card: Card }>(xs: T[]) => xs.slice().sort((a, b) => cost(a.card) - cost(b.card))[0];

  if (s.phase === 'lead') {
    // Лучше начинать с ранга, которых несколько в руке: их можно будет подкинуть.
    const plays = legal.filter((a): a is Extract<DurakAction, { t: 'play' }> => a.t === 'play');
    const count = (r: number) => s.hands[seat]!.filter((c) => c.rank === r).length;
    return plays.sort((a, b) => cost(a.card) - count(a.card.rank) * 2 - (cost(b.card) - count(b.card.rank) * 2))[0]!;
  }

  if (s.phase === 'defend') {
    const target = s.table.findIndex((p) => !p.defense);
    const beatsList = legal.filter((a): a is Extract<DurakAction, { t: 'beat' }> => a.t === 'beat' && a.idx === target);
    const transfers = legal.filter((a): a is Extract<DurakAction, { t: 'transfer' }> => a.t === 'transfer');
    const cheapBeat = cheapest(beatsList);
    const attack = s.table[target]!.attack;
    const trumpOnJunk = cheapBeat?.card.suit === s.trump && attack.suit !== s.trump && attack.rank <= 10 && s.deck.length > 6;
    if (transfers.length && (!cheapBeat || cost(cheapBeat.card) > 12)) return cheapest(transfers)!;
    if (cheapBeat && !trumpOnJunk) return cheapBeat;
    // Не можем (или не хотим тратить козырь) — берём.
    return canTransfer(s) && transfers.length ? cheapest(transfers)! : { t: 'take' };
  }

  // Подкидывание
  const throws = legal.filter((a): a is Extract<DurakAction, { t: 'throw' }> => a.t === 'throw');
  const safe = throws.filter((a) => a.card.suit !== s.trump);
  if (s.taking) return cheapest(safe) ?? { t: 'pass' };
  const cheap = safe.filter((a) => a.card.rank <= 10);
  return cheapest(cheap) ?? { t: 'pass' };
}

