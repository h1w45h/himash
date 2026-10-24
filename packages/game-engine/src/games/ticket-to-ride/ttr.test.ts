import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { ttrGame as g, LOCO, ROUTES, TICKETS, longestPath, payments, routeFree, ticketDone, type TtrAction, type TtrState } from './index';

const act = (s: TtrState, seat: number, a: TtrAction) => {
  const v = g.validate(s, seat, a);
  if (!v.ok) throw new Error(`${v.error}: ${JSON.stringify(a)}`);
  return g.apply(s, seat, a);
};
const keepAll = (s: TtrState) => {
  for (let p = 0; p < s.players; p++) s = act(s, p, { t: 'keepTickets', keep: [0, 1, 2] });
  return s;
};
const started = (n = 2, seed = 'tt') => keepAll(g.setup({ players: n, seed }));
const routeIdx = (a: number, b: number, color?: number) => ROUTES.findIndex((r) => ((r.a === a && r.b === b) || (r.a === b && r.b === a)) && (color === undefined || r.color === color));
const cardsTotal = (s: TtrState) => s.deck.length + s.discard.length + s.faceUp.length + s.hands.flat().reduce((x, y) => x + y, 0);

describe('подготовка', () => {
  it('110 карт, 5 открытых, у каждого 4 карты и 3 билета на выбор', () => {
    const s = g.setup({ players: 3, seed: 'a' });
    expect(cardsTotal(s)).toBe(110);
    expect(s.faceUp).toHaveLength(5);
    expect(s.hands.every((h) => h.reduce((a, b) => a + b, 0) === 4)).toBe(true);
    expect(s.pending.every((p) => p?.length === 3)).toBe(true);
    expect(g.currentSeats(s)).toEqual([0, 1, 2]);
  });
  it('стартовых билетов нужно оставить минимум 2', () => {
    const s = g.setup({ players: 2, seed: 'a' });
    expect(g.validate(s, 0, { t: 'keepTickets', keep: [0] }).ok).toBe(false);
    expect(g.validate(s, 0, { t: 'keepTickets', keep: [0, 1] }).ok).toBe(true);
    expect(g.validate(s, 0, { t: 'keepTickets', keep: [0, 0] }).ok).toBe(false);
    const t = act(s, 0, { t: 'keepTickets', keep: [0, 2] });
    expect(t.tickets[0]).toHaveLength(2);
    expect(t.ticketDeck.length).toBe(s.ticketDeck.length + 1);
    expect(g.view(t, 1).myTickets).toEqual([]);
  });
  it('после выбора всех начинается игра с игрока 1', () => {
    const s = started(3);
    expect(s.phase).toBe('play');
    expect(g.currentSeats(s)).toEqual([0]);
  });
});

describe('карты', () => {
  it('две карты за ход; локомотив из открытых — весь ход', () => {
    let s = started();
    s.faceUp = [0, 1, 2, 3, 4];
    s = act(s, 0, { t: 'drawFaceUp', idx: 0 });
    expect(s.turn).toBe(0);
    expect(s.drawn).toBe(1);
    expect(s.faceUp).toHaveLength(5);
    s = act(s, 0, { t: 'drawDeck' });
    expect(s.turn).toBe(1);
    // локомотив
    s.faceUp = [LOCO, 1, 2, 3, 4];
    s = act(s, 1, { t: 'drawFaceUp', idx: 0 });
    expect(s.turn).toBe(0);
  });
  it('вторым ходом локомотив из открытых брать нельзя', () => {
    let s = started();
    s.faceUp = [0, LOCO, 2, 3, 4];
    s = act(s, 0, { t: 'drawDeck' });
    expect(g.validate(s, 0, { t: 'drawFaceUp', idx: 1 }).ok).toBe(false);
    expect(g.validate(s, 0, { t: 'drawFaceUp', idx: 0 }).ok).toBe(true);
    expect(g.legalActions(s, 0).some((a) => a.t === 'claim')).toBe(false); // после первой карты занимать нельзя
  });
  it('три локомотива среди открытых — выкладываются заново', () => {
    let s = started();
    s.faceUp = [LOCO, LOCO, 1, 2, 3];
    s.deck.push(LOCO); // следующая выложенная карта
    s = act(s, 0, { t: 'drawFaceUp', idx: 2 });
    expect(s.faceUp.filter((c) => c === LOCO).length).toBeLessThan(3);
    expect(cardsTotal(s)).toBe(111);
  });
});

describe('маршруты', () => {
  const give = (s: TtrState, seat: number, cards: Record<number, number>) => {
    s.hands[seat] = Array(9).fill(0);
    for (const [c, n] of Object.entries(cards)) s.hands[seat]![Number(c)] = n;
    return s;
  };
  it('занять маршрут: карты уходят в сброс, очки по длине, вагоны уменьшаются', () => {
    let s = started();
    const i = routeIdx(4, 5, 5); // Москва — Нижний Новгород, длина 3, белый
    give(s, 0, { 5: 3 });
    s = act(s, 0, { t: 'claim', route: i, color: 5, locos: 0 });
    expect(s.owner[i]).toBe(0);
    expect(s.scores[0]).toBe(4);
    expect(s.trains[0]).toBe(42);
    expect(s.hands[0]![5]).toBe(0);
    expect(s.turn).toBe(1);
  });
  it('цвет маршрута обязателен; серый — любой; локомотивы заменяют карты', () => {
    let s = started();
    const colored = routeIdx(4, 5, 5);
    give(s, 0, { 1: 3 });
    expect(g.validate(s, 0, { t: 'claim', route: colored, color: 1, locos: 0 }).ok).toBe(false);
    const gray = routeIdx(4, 12);
    expect(g.validate(s, 0, { t: 'claim', route: gray, color: 1, locos: 0 }).ok).toBe(true);
    give(s, 0, { 5: 2, [LOCO]: 1 });
    expect(g.validate(s, 0, { t: 'claim', route: colored, color: 5, locos: 1 }).ok).toBe(true);
    expect(g.validate(s, 0, { t: 'claim', route: colored, color: 5, locos: 0 }).ok).toBe(false);
    give(s, 0, { [LOCO]: 3 });
    expect(payments(s.hands[0]!, ROUTES[colored]!)).toEqual([{ color: 5, locos: 3 }]);
  });
  it('двойные маршруты: при 2–3 игроках занимается один, при 4+ — оба разными игроками, но не одним', () => {
    const [p1, p2] = [routeIdx(2, 3, 2), routeIdx(2, 3, 3)];
    let s = started(2);
    s.owner[p1] = 0;
    expect(routeFree(s, 1, p2)).toBe(false);
    s = started(4);
    s.owner[p1] = 0;
    expect(routeFree(s, 1, p2)).toBe(true);
    expect(routeFree(s, 0, p2)).toBe(false); // сам себе второй путь — нельзя
  });
  it('нельзя занять занятое и при нехватке вагонов', () => {
    const s = started();
    const i = routeIdx(4, 5, 5);
    s.owner[i] = 1;
    expect(routeFree(s, 0, i)).toBe(false);
    s.trains[0] = 2;
    expect(routeFree(s, 0, routeIdx(4, 12))).toBe(false);
  });
});

describe('билеты и подсчёт', () => {
  it('выполнение билета по связности; самый длинный путь', () => {
    const s = started();
    const [a, b] = [routeIdx(4, 5, 5), routeIdx(5, 6, 2)];
    s.owner[a] = 0;
    s.owner[b] = 0;
    const id = TICKETS.findIndex((t) => [t.a, t.b].sort().join() === [4, 6].sort().join());
    if (id >= 0) expect(ticketDone(s, 0, id)).toBe(true);
    expect(longestPath(s, 0)).toBe(6);
    expect(longestPath(s, 1)).toBe(0);
  });
  it('конец игры: ≤2 вагонов → каждый ходит ещё раз; билеты ± и бонус пути', () => {
    let s = started(2);
    s.trains = [4, 40];
    s.hands[0] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    s.hands[0]![5] = 2;
    const i = routeIdx(5, 7); // длина 2, серый
    s.tickets[0] = [];
    s.tickets[1] = [];
    s = act(s, 0, { t: 'claim', route: i, color: 5, locos: 0 });
    expect(s.trains[0]).toBe(2);
    expect(s.endTrigger).toBe(0);
    expect(s.finished).toBe(false);
    s = act(s, 1, { t: 'drawDeck' });
    s = act(s, 1, { t: 'drawDeck' });
    expect(s.finished).toBe(true);
    expect(s.final!.longestBonus).toEqual([10, 0]);
    expect(s.scores[0]).toBe(2 + 10);
    expect(g.outcome(s)).toMatchObject({ winners: [0] });
  });
  it('невыполненный билет вычитается', () => {
    let s = started(2);
    s.tickets = [[0], []];
    s.trains = [2, 40];
    s.endTrigger = 0;
    s.turn = 1;
    s = act(s, 1, { t: 'drawDeck' });
    s = act(s, 1, { t: 'drawDeck' });
    expect(s.final!.tickets[0]).toBe(-TICKETS[0]!.points);
  });
  it('взять билеты: нужно оставить минимум один', () => {
    let s = started();
    s = act(s, 0, { t: 'drawTickets' });
    expect(g.currentSeats(s)).toEqual([0]);
    expect(g.legalActions(s, 0).every((a) => a.t === 'keepTickets')).toBe(true);
    expect(g.validate(s, 0, { t: 'keepTickets', keep: [] }).ok).toBe(false);
    const before = s.tickets[0]!.length;
    s = act(s, 0, { t: 'keepTickets', keep: [1] });
    expect(s.tickets[0]).toHaveLength(before + 1);
    expect(s.turn).toBe(1);
  });
  it('скрытая информация', () => {
    const s = started();
    expect(g.view(s, 1).hand).toEqual(s.hands[1]);
    expect(JSON.stringify(g.view(s, 1))).not.toContain('"ticketDeck"');
    expect(g.view(s, 1).myTickets).toEqual(s.tickets[1]);
  });
});

describe('партии', () => {
  it('случайные и бот-партии завершаются, карты сохраняются', () => {
    for (let n = 0; n < 25; n++) {
      const rng = createRng(`tr${n}`);
      let s = g.setup({ players: 2 + (n % 4), seed: `g${n}` });
      let steps = 0;
      while (!g.outcome(s)) {
        const seat = g.currentSeats(s)[0]!;
        const legal = g.legalActions(s, seat);
        expect(legal.length).toBeGreaterThan(0);
        const a = n % 2 ? g.chooseBotAction!(s, seat, { level: (['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const)[n % 4]!, rngSeed: `${n}:${steps}` }) : legal[rng.int(legal.length)]!;
        const v = g.validate(s, seat, a);
        if (!v.ok) throw new Error(`${v.error} ${JSON.stringify(a)}`);
        s = g.apply(s, seat, a);
        expect(cardsTotal(s)).toBe(110);
        if (++steps > 6000) throw new Error('не заканчивается');
      }
    }
  }, 120_000);
  it('бот набирает больше случайного игрока', () => {
    let bot = 0;
    let rnd = 0;
    for (let n = 0; n < 8; n++) {
      const rng = createRng(`vs${n}`);
      let s = g.setup({ players: 2, seed: `v${n}` });
      let steps = 0;
      while (!g.outcome(s) && steps++ < 4000) {
        const seat = g.currentSeats(s)[0]!;
        const a = seat === 0 ? g.chooseBotAction!(s, 0, { level: 'HARD', rngSeed: `${n}:${steps}` }) : g.legalActions(s, 1)[rng.int(g.legalActions(s, 1).length)]!;
        s = g.apply(s, seat, a);
      }
      bot += s.scores[0]!;
      rnd += s.scores[1]!;
    }
    expect(bot).toBeGreaterThan(rnd);
  }, 120_000);
});
