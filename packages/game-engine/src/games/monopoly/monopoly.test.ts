import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import {
  BOARD, GROUP_SQUARES, RAILS, canBuild, monopolyGame as g, netWorth, rentFor,
  type MonopolyAction, type MonopolyState, type Offer,
} from './index';

const fresh = (players = 3, variant: 'classic' | 'short' = 'classic') => g.setup({ players, seed: 'm1', variant });
const act = (s: MonopolyState, seat: number, a: MonopolyAction) => {
  const v = g.validate(s, seat, a);
  if (!v.ok) throw new Error(`${v.error}: ${JSON.stringify(a)}`);
  return g.apply(s, seat, a);
};
const own = (s: MonopolyState, seat: number, ...sqs: number[]) => sqs.forEach((i) => (s.props[i] = { owner: seat, houses: 0, mortgaged: false }));
/** Ставит бросок: подменяем rng так, чтобы выпали нужные кубики, перебирая сид. */
function rollWith(s: MonopolyState, seat: number, want: [number, number]): MonopolyState {
  for (let seed = 1; seed < 200000; seed++) {
    const r = createRng(seed);
    if (r.int(6) + 1 === want[0] && r.int(6) + 1 === want[1]) return act({ ...s, rng: seed }, seat, { t: 'roll' });
  }
  throw new Error('не нашли сид');
}
const emptyOffer: Offer = { cash: 0, props: [], cards: 0 };

describe('поле', () => {
  it('40 клеток, 22 улицы, 4 вокзала, 2 коммунальные', () => {
    expect(BOARD).toHaveLength(40);
    expect(BOARD.filter((q) => q.kind === 'street')).toHaveLength(22);
    expect(RAILS).toHaveLength(4);
    expect(BOARD.filter((q) => q.kind === 'util')).toHaveLength(2);
    expect(Object.values(GROUP_SQUARES).flat()).toHaveLength(22);
  });
  it('начало игры', () => {
    const s = fresh(4);
    expect(s.cash).toEqual([1500, 1500, 1500, 1500]);
    expect(g.currentSeats(s)).toEqual([0]);
    expect(s.chance).toHaveLength(16);
    expect(JSON.stringify(g.view(s, 0))).not.toContain('"rng"');
  });
});

describe('ход и покупка', () => {
  it('бросок → покупка свободной улицы', () => {
    let s = rollWith(fresh(), 0, [1, 2]); // клетка 3 — Нагатинская (дубль не нужен)
    expect(s.pos[0]).toBe(3);
    expect(s.phase).toBe('buy');
    s = act(s, 0, { t: 'buy' });
    expect(s.props[3]).toMatchObject({ owner: 0 });
    expect(s.cash[0]).toBe(1440);
    expect(s.phase).toBe('manage');
    s = act(s, 0, { t: 'endTurn' });
    expect(s.turn).toBe(1);
    expect(s.phase).toBe('roll');
  });
  it('отказ от покупки запускает аукцион, выигрыш — за максимальную ставку', () => {
    let s = rollWith(fresh(), 0, [1, 2]);
    s = act(s, 0, { t: 'decline' });
    expect(s.phase).toBe('auction');
    expect(g.currentSeats(s)).toEqual([1]); // начинает следующий игрок
    s = act(s, 1, { t: 'bid', amount: 30 });
    s = act(s, 2, { t: 'bid', amount: 40 });
    s = act(s, 0, { t: 'passBid' });
    s = act(s, 1, { t: 'passBid' });
    expect(s.props[3]).toMatchObject({ owner: 2 });
    expect(s.cash[2]).toBe(1460);
    expect(s.phase).toBe('manage');
  });
  it('нельзя ставить больше денег и меньше текущей ставки', () => {
    let s = rollWith(fresh(), 0, [1, 2]);
    s = act(s, 0, { t: 'decline' });
    expect(g.validate(s, 1, { t: 'bid', amount: 5 }).ok).toBe(false);
    expect(g.validate(s, 1, { t: 'bid', amount: 99999 }).ok).toBe(false);
  });
  it('проход «Старта» даёт 200', () => {
    const s0 = fresh();
    s0.pos[0] = 38;
    const s = rollWith(s0, 0, [1, 2]); // 38+3 = 41 → клетка 1
    expect(s.pos[0]).toBe(1);
    expect(s.cash[0]).toBe(1700);
  });
});

describe('аренда', () => {
  it('улица: база, удвоение при наборе, дома', () => {
    const s = fresh();
    own(s, 1, 1);
    expect(rentFor(s, 1, 7)).toBe(2);
    own(s, 1, 3);
    expect(rentFor(s, 1, 7)).toBe(4); // полный коричневый набор без домов
    s.props[1]!.houses = 2;
    expect(rentFor(s, 1, 7)).toBe(30);
    s.props[1]!.mortgaged = true;
    expect(rentFor(s, 1, 7)).toBe(0);
  });
  it('вокзалы и коммунальные', () => {
    const s = fresh();
    own(s, 1, 5);
    expect(rentFor(s, 5, 7)).toBe(25);
    own(s, 1, 15, 25);
    expect(rentFor(s, 5, 7)).toBe(100);
    own(s, 1, 12);
    expect(rentFor(s, 12, 8)).toBe(32);
    own(s, 1, 28);
    expect(rentFor(s, 12, 8)).toBe(80);
  });
  it('платёж арендатора владельцу при попадании на клетку', () => {
    const s0 = fresh();
    own(s0, 1, 3);
    const s = rollWith(s0, 0, [1, 2]);
    expect(s.cash[0]).toBe(1496);
    expect(s.cash[1]).toBe(1504);
    expect(s.phase).toBe('manage');
  });
});

describe('тюрьма', () => {
  it('три дубля подряд — в тюрьму', () => {
    let s = fresh();
    s = rollWith({ ...s, pos: [0, 0, 0] }, 0, [1, 1]); // клетка 2 (казна) — может сдвинуть, поэтому проверяем счётчик
    s.phase = 'manage';
    s.pos[0] = 20;
    s.doubles = 2;
    s = rollWith(s, 0, [2, 2]);
    expect(s.jail[0]).toBe(true);
    expect(s.pos[0]).toBe(10);
    expect(g.legalActions(s, 0).some((a) => a.t === 'endTurn')).toBe(true);
  });
  it('клетка «В тюрьму»', () => {
    const s0 = fresh();
    s0.pos[0] = 25;
    const s = rollWith(s0, 0, [2, 3]); // 30
    expect(s.jail[0]).toBe(true);
    expect(s.pos[0]).toBe(10);
  });
  it('выход: штраф, дубль, три неудачи', () => {
    const base = fresh();
    base.jail[0] = true;
    base.pos[0] = 10;
    // платим штраф
    let s = act(base, 0, { t: 'jailPay' });
    expect(s.jail[0]).toBe(false);
    expect(s.cash[0]).toBe(1450);
    // дубль
    s = rollWith(base, 0, [3, 3]);
    expect(s.jail[0]).toBe(false);
    expect(s.pos[0]).toBe(16);
    expect(s.doubles).toBe(0);
    // три неудачи
    s = rollWith(base, 0, [1, 2]);
    expect(s.jail[0]).toBe(true);
    s.phase = 'roll';
    s.jailTries[0] = 2;
    s = rollWith(s, 0, [1, 2]);
    expect(s.jail[0]).toBe(false);
    expect(s.cash[0]).toBe(1450);
    expect(s.pos[0]).toBe(13);
  });
});

describe('постройки и залог', () => {
  const setBrown = () => {
    const s = fresh();
    own(s, 0, 1, 3);
    s.phase = 'manage';
    s.dice = [1, 2];
    return s;
  };
  it('равномерная застройка', () => {
    let s = setBrown();
    expect(canBuild(s, 0, 1)).toBe(true);
    s = act(s, 0, { t: 'build', sq: 1 });
    expect(s.props[1]!.houses).toBe(1);
    expect(g.validate(s, 0, { t: 'build', sq: 1 }).ok).toBe(false); // сначала второй участок
    s = act(s, 0, { t: 'build', sq: 3 });
    expect(s.bankHouses).toBe(30);
    expect(s.cash[0]).toBe(1400);
  });
  it('нельзя строить без полного набора и на заложенном', () => {
    const s = fresh();
    own(s, 0, 1);
    s.phase = 'manage';
    expect(canBuild(s, 0, 1)).toBe(false);
    own(s, 0, 3);
    s.props[3]!.mortgaged = true;
    expect(canBuild(s, 0, 1)).toBe(false);
  });
  it('отель возвращает 4 дома в банк', () => {
    const s = setBrown();
    s.props[1]!.houses = 4;
    s.props[3]!.houses = 4;
    s.bankHouses = 24;
    const t = act(s, 0, { t: 'build', sq: 1 });
    expect(t.props[1]!.houses).toBe(5);
    expect(t.bankHotels).toBe(11);
    expect(t.bankHouses).toBe(28);
  });
  it('залог/выкуп с процентом; с домами в группе — нельзя', () => {
    let s = fresh();
    own(s, 0, 5);
    s.phase = 'manage';
    s = act(s, 0, { t: 'mortgage', sq: 5 });
    expect(s.cash[0]).toBe(1600);
    s = act(s, 0, { t: 'unmortgage', sq: 5 });
    expect(s.cash[0]).toBe(1600 - 110);
    const t = setBrown();
    t.props[1]!.houses = 1;
    expect(g.validate(t, 0, { t: 'mortgage', sq: 3 }).ok).toBe(false);
  });
});

describe('долги и банкротство', () => {
  const debtor = () => {
    const s = fresh(2);
    own(s, 1, 39);
    s.props[39]!.houses = 0;
    own(s, 0, 1, 5);
    s.cash[0] = 20;
    s.pos[0] = 35;
    s.phase = 'roll';
    return s;
  };
  it('нехватка денег → долг → залог гасит его автоматически', () => {
    let s = rollWith(debtor(), 0, [2, 2]); // 39: аренда 50
    expect(s.phase).toBe('debt');
    expect(s.debt!.creditors).toEqual([{ to: 1, amount: 50 }]);
    s = act(s, 0, { t: 'mortgage', sq: 5 }); // +100
    expect(s.phase).toBe('manage');
    expect(s.cash[0]).toBe(20 + 100 - 50);
    expect(s.cash[1]).toBe(1550);
  });
  it('банкротство: имущество кредитору, игра окончена', () => {
    const s0 = debtor();
    s0.props[1] = null;
    s0.props[5] = null;
    let s = rollWith(s0, 0, [2, 2]);
    expect(s.phase).toBe('debt');
    s = act(s, 0, { t: 'bankrupt' });
    expect(s.finished).toBe(true);
    expect(s.cash[1]).toBe(1520);
    expect(g.outcome(s)).toMatchObject({ winners: [1], ranking: [1, 0] });
  });
  it('банкротство в игре втроём передаёт ход дальше', () => {
    const s0 = debtor();
    s0.players = 3;
    s0.cash.push(1500);
    s0.pos.push(0);
    s0.jail.push(false);
    s0.jailTries.push(0);
    s0.jailCards.push([]);
    s0.bankrupt.push(false);
    s0.props[1] = null;
    s0.props[5] = null;
    let s = rollWith(s0, 0, [2, 2]);
    s = act(s, 0, { t: 'bankrupt' });
    expect(s.finished).toBe(false);
    expect(s.bankrupt[0]).toBe(true);
    expect(s.turn).toBe(1);
  });
});

describe('обмен', () => {
  const setup = () => {
    const s = fresh(2);
    own(s, 0, 1);
    own(s, 1, 3);
    s.phase = 'manage';
    s.dice = [1, 2];
    return s;
  };
  it('предложение → согласие переносит собственность и деньги', () => {
    let s = setup();
    s = act(s, 0, { t: 'trade', to: 1, give: { cash: 100, props: [1], cards: 0 }, get: { cash: 0, props: [3], cards: 0 } });
    expect(g.currentSeats(s)).toEqual([1]);
    s = act(s, 1, { t: 'accept' });
    expect(s.props[1]!.owner).toBe(1);
    expect(s.props[3]!.owner).toBe(0);
    expect(s.cash).toEqual([1400, 1600]);
    expect(s.phase).toBe('manage');
  });
  it('отказ возвращает ход; невалидные предложения отклоняются', () => {
    let s = setup();
    s = act(s, 0, { t: 'trade', to: 1, give: { ...emptyOffer, cash: 10 }, get: emptyOffer });
    s = act(s, 1, { t: 'reject' });
    expect(s.phase).toBe('manage');
    expect(g.validate(s, 0, { t: 'trade', to: 1, give: { ...emptyOffer, cash: 99999 }, get: emptyOffer }).ok).toBe(false);
    expect(g.validate(s, 0, { t: 'trade', to: 1, give: { ...emptyOffer, props: [3] }, get: emptyOffer }).ok).toBe(false); // чужое
    expect(g.validate(s, 0, { t: 'trade', to: 0, give: emptyOffer, get: emptyOffer }).ok).toBe(false);
  });
  it('улицы с постройками обменивать нельзя', () => {
    const s = setup();
    own(s, 0, 3);
    s.props[1]!.houses = 1;
    expect(g.validate(s, 0, { t: 'trade', to: 1, give: { ...emptyOffer, props: [1] }, get: { ...emptyOffer, cash: 1 } }).ok).toBe(false);
  });
});

describe('короткая игра', () => {
  it('по лимиту раундов побеждает самый богатый', () => {
    let s = fresh(2, 'short');
    own(s, 1, 39);
    s.turnCount = 2 * 20 - 1;
    s.phase = 'manage';
    s.dice = [1, 2];
    s = act(s, 0, { t: 'endTurn' });
    expect(s.finished).toBe(true);
    expect(netWorth(s, 1)).toBeGreaterThan(netWorth(s, 0));
    expect(g.outcome(s)).toMatchObject({ winners: [1], reason: 'netWorth' });
  });
});

describe('свойства', () => {
  const invariants = (s: MonopolyState) => {
    s.cash.forEach((c) => expect(c).toBeGreaterThanOrEqual(0));
    let houses = 0;
    let hotels = 0;
    s.props.forEach((p, i) => {
      if (!p) return;
      expect(s.bankrupt[p.owner]).toBe(false);
      if (p.houses === 5) hotels++;
      else houses += p.houses;
      if (p.houses > 0) expect(BOARD[i]!.kind).toBe('street');
    });
    expect(houses + s.bankHouses).toBe(32);
    expect(hotels + s.bankHotels).toBe(12);
  };

  it('случайные партии (короткий вариант) всегда заканчиваются, инварианты соблюдены', () => {
    for (let n = 0; n < 40; n++) {
      const rng = createRng(`mono${n}`);
      let s = g.setup({ players: 2 + (n % 5), seed: `r${n}`, variant: 'short' });
      let steps = 0;
      while (!g.outcome(s)) {
        const seats = g.currentSeats(s);
        const seat = seats[0]!;
        const legal = g.legalActions(s, seat);
        expect(legal.length).toBeGreaterThan(0);
        // Чтобы партия не затягивалась, чаще выбираем «двигающие» действия.
        const adv = legal.filter((a) => ['roll', 'endTurn', 'buy', 'passBid', 'bankrupt', 'reject'].includes(a.t));
        const pool = rng.next() < 0.7 && adv.length ? adv : legal;
        s = g.apply(s, seat, pool[rng.int(pool.length)]!);
        invariants(s);
        if (++steps > 30000) throw new Error('не закончилась');
      }
    }
  }, 120_000);

  it('боты: только допустимые ходы, инварианты соблюдены, партия движется', () => {
    for (const level of ['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const) {
      for (let n = 0; n < 6; n++) {
        let s = g.setup({ players: 2 + (n % 4), seed: `b${level}${n}`, variant: 'short' });
        let steps = 0;
        while (!g.outcome(s)) {
          const seat = g.currentSeats(s)[0]!;
          const a = g.chooseBotAction!(s, seat, { level, rngSeed: `${n}:${steps}` });
          const v = g.validate(s, seat, a);
          if (!v.ok) throw new Error(`${level}: ${v.error} ${JSON.stringify(a)} фаза ${s.phase}`);
          s = g.apply(s, seat, a);
          invariants(s);
          if (++steps > 30000) throw new Error('бот зациклился');
        }
      }
    }
  }, 120_000);
});
