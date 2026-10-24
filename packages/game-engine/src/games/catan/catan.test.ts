import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { BOARD, catanGame as g, publicVp, roadLength, totalVp, type CatanAction, type CatanState } from './index';

const setup = (players = 3, seed = 'c1') => g.setup({ players, seed });
const play = (s: CatanState, seat: number, a: CatanAction) => {
  const v = g.validate(s, seat, a);
  if (!v.ok) throw new Error(`${JSON.stringify(a)}: ${v.error}`);
  return g.apply(s, seat, a);
};
/** Проходит расстановку ботами. */
function runSetup(s: CatanState) {
  let k = 0;
  while (s.phase === 'setup') {
    const seat = s.turn;
    s = play(s, seat, g.chooseBotAction!(s, seat, { level: 'HARD', rngSeed: `su${k++}` }));
  }
  return s;
}

describe('Катан: подготовка', () => {
  it('состав поля: 19 гексов, одна пустыня, 18 жетонов, разбойник в пустыне', () => {
    const s = setup();
    expect(s.hexRes.filter((r) => r === -1)).toHaveLength(1);
    expect(s.hexNum.filter((n) => n > 0)).toHaveLength(18);
    expect(s.hexRes[s.robber]).toBe(-1);
    expect(s.hexNum.filter((n) => n === 6 || n === 8)).toHaveLength(4);
    expect(s.devDeck).toHaveLength(25);
    expect(s.ports.filter((p) => p === 5)).toHaveLength(4);
  });
  it('расстановка змейкой: порядок 0,1,2,2,1,0, вторая пара даёт ресурсы', () => {
    let s = setup();
    const order: number[] = [];
    let k = 0;
    while (s.phase === 'setup') {
      if (s.setupStep === 'road') order.push(s.turn);
      s = play(s, s.turn, g.chooseBotAction!(s, s.turn, { level: 'HARD', rngSeed: `x${k++}` }));
    }
    expect(order).toEqual([0, 1, 2, 2, 1, 0]);
    expect(s.phase).toBe('roll');
    expect(s.turn).toBe(0);
    for (let p = 0; p < 3; p++) expect(s.vOwner.filter((o) => o === p)).toHaveLength(2);
  });
  it('правило расстояния: рядом с поселением строить нельзя', () => {
    let s = setup();
    s = play(s, 0, { t: 'build', what: 'settlement', at: 0 });
    s = play(s, 0, { t: 'build', what: 'road', at: BOARD.verts[0]!.edges[0]! });
    expect(g.validate(s, 1, { t: 'build', what: 'settlement', at: BOARD.verts[0]!.adj[0]! }).ok).toBe(false);
  });
});

describe('Катан: ход', () => {
  const ready = () => runSetup(setup());
  it('семёрка: игроки с более чем 7 картами сбрасывают половину, затем двигается разбойник', () => {
    const s = ready();
    s.hands[1] = [3, 3, 2, 0, 0]; // 8 карт
    s.hands[2] = [1, 0, 0, 0, 0];
    let found: CatanState | null = null;
    for (let seed = 1; seed < 3000 && !found; seed++) {
      const r = g.apply({ ...s, rng: seed }, 0, { t: 'roll' });
      if (r.dice![0] + r.dice![1] === 7) found = r;
    }
    const f = found!;
    expect(f.phase).toBe('discard');
    expect(g.currentSeats(f)).toEqual([1]);
    expect(g.validate(f, 1, { t: 'discard', cards: [1, 0, 0, 0, 0] }).ok).toBe(false);
    expect(g.validate(f, 1, { t: 'discard', cards: [0, 0, 0, 4, 0] }).ok).toBe(false);
    const d = play(f, 1, { t: 'discard', cards: [2, 1, 1, 0, 0] });
    expect(d.phase).toBe('robber');
    expect(d.bank[0]).toBe(f.bank[0]! + 2);
    const m = play(d, 0, { t: 'moveRobber', hex: (d.robber + 1) % 19 });
    expect(['main', 'steal']).toContain(m.phase);
  });
  it('покупка и стройка списывают ресурсы в банк', () => {
    const s = ready();
    s.phase = 'main';
    s.rolled = true;
    s.hands[0] = [5, 5, 5, 5, 5];
    s.bank = [14, 14, 14, 14, 14];
    const spots = g.legalActions(s, 0).filter((a) => a.t === 'build' && a.what === 'road');
    expect(spots.length).toBeGreaterThan(0);
    const r = play(s, 0, spots[0]!);
    expect(r.hands[0]).toEqual([4, 4, 5, 5, 5]);
    expect(r.bank[0]).toBe(15);
    const d = play(r, 0, { t: 'buyDev' });
    expect(d.devDeck).toHaveLength(24);
    expect(d.hands[0]![2]).toBe(4);
  });
  it('карту, купленную в этот ход, играть нельзя; на следующий — можно', () => {
    let s = ready();
    s.phase = 'main';
    s.rolled = true;
    s.hands[0] = [0, 0, 1, 1, 1];
    s.devDeck = [0, 0];
    s = play(s, 0, { t: 'buyDev' });
    expect(g.legalActions(s, 0).some((a) => a.t === 'playKnight')).toBe(false);
    s = play(s, 0, { t: 'end' });
    s = { ...s, turn: 0, phase: 'roll' };
    expect(g.legalActions(s, 0).some((a) => a.t === 'playKnight')).toBe(true);
  });
  it('торговля с банком идёт по курсу 4:1 без гавани', () => {
    const s = ready();
    s.phase = 'main';
    s.rolled = true;
    s.vOwner = s.vOwner.map(() => -1);
    s.hands[0] = [4, 0, 0, 0, 0];
    const r = play(s, 0, { t: 'bank', give: 0, get: 3 });
    expect(r.hands[0]).toEqual([0, 0, 0, 1, 0]);
    s.hands[0] = [3, 0, 0, 0, 0];
    expect(g.validate(s, 0, { t: 'bank', give: 0, get: 3 }).ok).toBe(false);
  });
  it('гавань 2:1 снижает курс', () => {
    const s = ready();
    s.phase = 'main';
    s.rolled = true;
    s.ports = [0, 1, 2, 3, 4, 5, 5, 5, 5];
    const e = BOARD.edges[BOARD.portEdges[0]!]!;
    s.vOwner = s.vOwner.map(() => -1);
    s.vOwner[e.a] = 0;
    s.hands[0] = [2, 0, 0, 0, 0];
    expect(g.validate(s, 0, { t: 'bank', give: 0, get: 4 }).ok).toBe(true);
  });
});

describe('Катан: дороги и очки', () => {
  it('цепочка из 5 дорог, разрыв чужим поселением укорачивает', () => {
    const s = setup(2);
    const path: number[] = [];
    let v = 0;
    const seen = new Set<number>([0]);
    while (path.length < 5) {
      const e = BOARD.verts[v]!.edges.find((x) => {
        const o = BOARD.edges[x]!.a === v ? BOARD.edges[x]!.b : BOARD.edges[x]!.a;
        return !seen.has(o);
      })!;
      path.push(e);
      v = BOARD.edges[e]!.a === v ? BOARD.edges[e]!.b : BOARD.edges[e]!.a;
      seen.add(v);
    }
    for (const e of path) s.eOwner[e] = 0;
    expect(roadLength(s, 0)).toBe(5);
    const ed = BOARD.edges[path[2]!]!;
    const shared = [ed.a, ed.b].find((x) => BOARD.edges[path[1]!]!.a === x || BOARD.edges[path[1]!]!.b === x)!;
    s.vOwner[shared] = 1;
    s.vKind[shared] = 1;
    expect(roadLength(s, 0)).toBeLessThan(5);
  });
  it('очки: карты победы скрыты в публичных очках и в чужом виде', () => {
    const s = runSetup(setup(2));
    expect(publicVp(s, 0)).toBe(2);
    s.dev[0]![4] = 2;
    expect(publicVp(s, 0)).toBe(2);
    expect(totalVp(s, 0)).toBe(4);
    const v = g.view(s, 1);
    expect(v.myDev).toEqual(s.dev[1]);
    expect(v.vp[0]).toBe(2);
    expect('hands' in v).toBe(false);
  });
});

describe('Катан: полные партии', () => {
  function runGame(players: number, seed: string, pick: (s: CatanState, seat: number, i: number) => CatanAction, max: number) {
    let s = setup(players, seed);
    for (let i = 0; i < max && !g.outcome(s); i++) {
      const seats = g.currentSeats(s);
      const seat = seats[i % seats.length]!;
      const a = pick(s, seat, i);
      const v = g.validate(s, seat, a);
      if (!v.ok) throw new Error(`${i}: ${JSON.stringify(a)} ${v.error} phase=${s.phase}`);
      s = g.apply(s, seat, a);
      for (let r = 0; r < 5; r++) {
        const inHands = s.hands.reduce((x, h) => x + h[r]!, 0);
        if (inHands + s.bank[r]! !== 19) throw new Error(`баланс ресурса ${r}: ${inHands}+${s.bank[r]}`);
      }
    }
    return s;
  }
  it('боты играют до победы (3 игрока)', () => {
    for (const seed of ['a', 'b', 'c']) {
      const s = runGame(3, seed, (st, seat, i) => g.chooseBotAction!(st, seat, { level: 'HARD', rngSeed: `${seed}${i}` }), 12000);
      expect(g.outcome(s), `seed ${seed} turn ${s.turnCount}`).not.toBeNull();
      expect(totalVp(s, s.winner!)).toBeGreaterThanOrEqual(10);
    }
  }, 60000);
  it('случайные ходы сохраняют инварианты', () => {
    const rng = createRng('rand');
    for (const seed of ['r1', 'r2']) {
      runGame(4, seed, (st, seat) => {
        const l = g.legalActions(st, seat);
        return l[rng.int(l.length)]!;
      }, 3000);
    }
  }, 60000);
  it('сильный бот обыгрывает случайный', () => {
    let wins = 0;
    for (let i = 0; i < 6; i++) {
      const rng = createRng(`vs${i}`);
      const s = runGame(2, `m${i}`, (st, seat, k) => {
        if (seat === 0) return g.chooseBotAction!(st, seat, { level: 'EXPERT', rngSeed: `b${i}-${k}` });
        const l = g.legalActions(st, seat);
        return l[rng.int(l.length)]!;
      }, 20000);
      if (s.winner === 0) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(5);
  }, 120000);
});

describe('Катан: торговля игроков', () => {
  it('предложение, согласие и подтверждение', () => {
    let s = runSetup(setup(3));
    s.phase = 'main';
    s.rolled = true;
    s.hands = [[2, 0, 0, 0, 0], [0, 0, 0, 0, 1], [0, 0, 0, 0, 0]];
    s = play(s, 0, { t: 'offer', give: [1, 0, 0, 0, 0], get: [0, 0, 0, 0, 1] });
    expect(g.currentSeats(s).sort()).toEqual([0, 1, 2]);
    expect(g.legalActions(s, 2).some((a) => a.t === 'respond' && a.accept)).toBe(false);
    s = play(s, 2, { t: 'respond', accept: false });
    s = play(s, 1, { t: 'respond', accept: true });
    s = play(s, 0, { t: 'confirm', with: 1 });
    expect(s.hands[0]).toEqual([1, 0, 0, 0, 1]);
    expect(s.hands[1]).toEqual([1, 0, 0, 0, 0]);
    expect(s.offer).toBeNull();
  });
  it('если все отказались, предложение снимается', () => {
    let s = runSetup(setup(2));
    s.phase = 'main';
    s.rolled = true;
    s.hands = [[2, 0, 0, 0, 0], [0, 0, 0, 0, 1]];
    s = play(s, 0, { t: 'offer', give: [1, 0, 0, 0, 0], get: [0, 0, 0, 0, 1] });
    s = play(s, 1, { t: 'respond', accept: false });
    expect(s.offer).toBeNull();
  });
});
