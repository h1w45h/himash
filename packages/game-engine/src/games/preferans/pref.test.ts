import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { contractId, contractName, contractOf, MAX_BID, MISERE_ID, prefGame as g, priceOf, type PrefAction, type PrefState } from './index';

const setup = (seed = 'p1', variant = '3') => g.setup({ players: 3, seed, variant });
const play = (s: PrefState, seat: number, a: PrefAction) => {
  const v = g.validate(s, seat, a);
  if (!v.ok) throw new Error(`${JSON.stringify(a)}: ${v.error}`);
  return g.apply(s, seat, a);
};

describe('Преферанс: заявки', () => {
  it('порядок старшинства: 6♠ < 6БК < 7♠ < 7БК < мизер < 8♠ < 10БК', () => {
    expect(contractName(0)).toBe('6♠');
    expect(contractName(4)).toBe('6 БК');
    expect(contractName(5)).toBe('7♠');
    expect(contractName(9)).toBe('7 БК');
    expect(contractOf(MISERE_ID).kind).toBe('misere');
    expect(contractName(11)).toBe('8♠');
    expect(contractName(MAX_BID)).toBe('10 БК');
    for (let id = 0; id <= MAX_BID; id++) {
      const c = contractOf(id);
      if (c.kind === 'suit') expect(contractId(c.level, c.suit)).toBe(id);
    }
  });
  it('цена игры: 6→2, 7→4, 8→6, 9→8, 10→10, мизер 10', () => {
    expect([6, 7, 8, 9, 10].map((l) => priceOf(contractId(l, 0)))).toEqual([2, 4, 6, 8, 10]);
    expect(priceOf(MISERE_ID)).toBe(10);
  });
});

describe('Преферанс: раздача и торговля', () => {
  it('10 карт каждому, 2 в прикупе, 32 разные карты; торговлю начинает игрок слева от сдающего', () => {
    const s = setup();
    expect(s.hands.map((h) => h.length)).toEqual([10, 10, 10]);
    expect(new Set([...s.hands.flat(), ...s.talon]).size).toBe(32);
    expect(s.dealer).toBe(0);
    expect(g.currentSeats(s)).toEqual([1]);
  });
  it('нельзя ходить не в свою очередь и заявлять ниже текущей', () => {
    let s = setup();
    expect(g.validate(s, 0, { t: 'pass' }).ok).toBe(false);
    s = play(s, 1, { t: 'bid', id: 5 });
    expect(g.validate(s, 2, { t: 'bid', id: 5 }).ok).toBe(false);
    expect(g.validate(s, 2, { t: 'bid', id: 6 }).ok).toBe(true);
  });
  it('все спасовали → распасы, ходит первый игрок без козыря', () => {
    let s = setup();
    s = play(s, 1, { t: 'pass' });
    s = play(s, 2, { t: 'pass' });
    s = play(s, 0, { t: 'pass' });
    expect(s.allPass).toBe(true);
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(1);
  });
  it('двое спасовали после заявки → заявитель берёт прикуп, сбрасывает две карты, называет игру не ниже заявки', () => {
    let s = setup();
    s = play(s, 1, { t: 'bid', id: 0 });
    s = play(s, 2, { t: 'pass' });
    s = play(s, 0, { t: 'pass' });
    expect(s.phase).toBe('discard');
    expect(s.hands[1]).toHaveLength(12);
    const [a, b] = s.hands[1]!;
    s = play(s, 1, { t: 'discard', cards: [a!, b!] });
    expect(s.hands[1]).toHaveLength(10);
    expect(s.phase).toBe('declare');
    expect(g.validate(s, 1, { t: 'declare', id: 0 }).ok).toBe(true);
    s.highRank = 7;
    expect(g.validate(s, 1, { t: 'declare', id: 3 }).ok).toBe(false);
  });
  it('торговая пауза: при пасе первого и заявке второго третий может перебить', () => {
    let s = setup();
    s = play(s, 1, { t: 'pass' });
    s = play(s, 2, { t: 'bid', id: 3 });
    expect(g.currentSeats(s)).toEqual([0]);
    s = play(s, 0, { t: 'bid', id: 4 });
    expect(g.currentSeats(s)).toEqual([2]); // игрок 2 ещё в торговле
    s = play(s, 2, { t: 'pass' });
    expect(s.declarer).toBe(0);
  });
});

describe('Преферанс: розыгрыш и запись', () => {
  /** Состояние после торговли: игрок 1 играет контракт `id`. */
  function toPlay(id: number, whists: [boolean, boolean]) {
    let s = setup('q', '1');
    s = play(s, 1, { t: 'bid', id });
    s = play(s, 2, { t: 'pass' });
    s = play(s, 0, { t: 'pass' });
    const [a, b] = s.hands[1]!;
    s = play(s, 1, { t: 'discard', cards: [a!, b!] });
    s = play(s, 1, { t: 'declare', id });
    if (contractOf(id).kind === 'misere') return s;
    s = play(s, 2, { t: 'whist', yes: whists[0] });
    s = play(s, 0, { t: 'whist', yes: whists[1] });
    return s;
  }
  it('оба пасуют: игра засчитана, пуля +цена', () => {
    const s = toPlay(contractId(7, 0), [false, false]);
    expect(s.pula[1]).toBe(4);
    expect(s.dealNo).toBe(1);
    expect(s.phase).toBe('over');
  });
  it('один вистует: карты пасующего открыты и ходит за него вистующий', () => {
    const s = toPlay(contractId(6, 0), [true, false]);
    expect(s.phase).toBe('play');
    expect(s.openHand).toBe(0);
    expect(g.view(s, 2).hands[0]).not.toBeNull();
    // ходит заказчик (1), затем игрок 2, затем за игрока 0 — игрок 2
    const first = g.legalActions(s, 1)[0]!;
    let t = play(s, 1, first);
    t = play(t, 2, g.legalActions(t, 2)[0]!);
    expect(g.currentSeats(t)).toEqual([2]);
    const a = g.legalActions(t, 2)[0] as any;
    expect(a.for).toBe(0);
  });
  it('правило масти и козыря: обязан отвечать мастью, иначе козырем', () => {
    const s = toPlay(contractId(6, 3), [true, true]);
    const lead = g.legalActions(s, 1)[0] as any;
    const t = play(s, 1, lead);
    const legal = g.legalActions(t, 2) as any[];
    const suit = Math.floor(lead.card / 8);
    const hand = t.hands[2]!;
    if (hand.some((c) => Math.floor(c / 8) === suit)) expect(legal.every((a) => Math.floor(a.card / 8) === suit)).toBe(true);
    else if (hand.some((c) => Math.floor(c / 8) === 3)) expect(legal.every((a) => Math.floor(a.card / 8) === 3)).toBe(true);
    else expect(legal).toHaveLength(hand.length);
  });
  it('мизер: вистов нет, ход заказчика; взятка заказчика → гора', () => {
    const s = toPlay(MISERE_ID, [false, false]);
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(1);
    expect(s.whist).toEqual([null, null, null]);
  });
});

describe('Преферанс: полные матчи', () => {
  function run(seed: string, pick: (s: PrefState, seat: number, i: number) => PrefAction, variant = '6') {
    let s = setup(seed, variant);
    for (let i = 0; i < 5000 && !g.outcome(s); i++) {
      const seat = g.currentSeats(s)[0]!;
      const a = pick(s, seat, i);
      const v = g.validate(s, seat, a);
      if (!v.ok) throw new Error(`${i}: ${JSON.stringify(a)} ${v.error} phase=${s.phase}`);
      s = g.apply(s, seat, a);
      const all = [...s.hands.flat(), ...s.talon, ...s.trick.map((t) => t.card)];
      if (s.phase !== 'over' && new Set(all).size !== all.length) throw new Error('дубли карт');
    }
    return s;
  }
  it('боты играют матч до конца, баланс по нулевой сумме', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const s = run(seed, (st, seat, i) => g.chooseBotAction!(st, seat, { level: 'HARD', rngSeed: `${seed}${i}` }));
      const o = g.outcome(s)!;
      expect(o).not.toBeNull();
      expect(Math.abs(s.balance!.reduce((a, b) => a + b, 0))).toBeLessThan(0.5);
    }
  }, 60000);
  it('случайные ходы не ломают правила', () => {
    const rng = createRng('rnd');
    const s = run('r', (st, seat) => {
      const l = g.legalActions(st, seat);
      return l[rng.int(l.length)]!;
    }, '4');
    expect(g.outcome(s)).not.toBeNull();
  }, 60000);
  it('бот сильнее случайных игроков', () => {
    let total = 0;
    for (let i = 0; i < 6; i++) {
      const rng = createRng(`vs${i}`);
      const s = run(`m${i}`, (st, seat, k) => {
        if (seat === 0 || g.currentSeats(st)[0] === 0) return g.chooseBotAction!(st, 0, { level: 'HARD', rngSeed: `b${i}-${k}` });
        const l = g.legalActions(st, seat);
        return l[rng.int(l.length)]!;
      });
      total += s.balance![0]!;
    }
    expect(total).toBeGreaterThan(0);
  }, 120000);
  it('вид скрывает чужие карты и прикуп', () => {
    const s = setup();
    const v = g.view(s, 0);
    expect(v.hands[0]).toEqual(s.hands[0]);
    expect(v.hands[1]).toBeNull();
    expect('talon' in v).toBe(false);
  });
});
