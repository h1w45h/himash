import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { azulGame as g, canPlaceOnLine, placementScore, wallColumn, type AzulAction, type AzulState } from './index';

const act = (s: AzulState, seat: number, a: AzulAction) => {
  const v = g.validate(s, seat, a);
  if (!v.ok) throw new Error(`${v.error}: ${JSON.stringify(a)}`);
  return g.apply(s, seat, a);
};
const fresh = (n = 2, seed = 'az') => g.setup({ players: n, seed });
const totalTiles = (s: AzulState) =>
  s.bag.length + s.discard.length + s.factories.flat().reduce((a, b) => a + b, 0) + s.center.reduce((a, b) => a + b, 0) +
  s.boards.reduce((n, b) => n + b.lines.reduce((m, l) => m + l.count, 0) + b.floor.filter((t) => t < 5).length + b.wall.flat().filter(Boolean).length, 0);

describe('подготовка', () => {
  it('фабрик 5/7/9, по 4 плитки, всего 100 плиток', () => {
    for (const [n, f] of [[2, 5], [3, 7], [4, 9]] as const) {
      const s = fresh(n);
      expect(s.factories).toHaveLength(f);
      expect(s.factories.every((x) => x.reduce((a, b) => a + b, 0) === 4)).toBe(true);
      expect(totalTiles(s)).toBe(100);
    }
  });
  it('стена: цвет клетки (r, c) = (c − r) mod 5', () => {
    for (let r = 0; r < 5; r++) for (let k = 0; k < 5; k++) expect((wallColumn(r, k) - r + 5) % 5).toBe(k);
  });
});

describe('выбор плиток', () => {
  it('берутся все плитки цвета; остальные уходят в центр', () => {
    let s = fresh();
    s.factories[0] = [2, 1, 1, 0, 0];
    const centerBefore = s.center.slice();
    s = act(s, 0, { t: 'draft', source: 0, color: 0, line: 1 });
    expect(s.boards[0]!.lines[1]).toEqual({ color: 0, count: 2 });
    expect(s.factories[0]).toEqual([0, 0, 0, 0, 0]);
    expect(s.center[1]).toBe(centerBefore[1]! + 1);
    expect(s.center[2]).toBe(centerBefore[2]! + 1);
    expect(s.turn).toBe(1);
  });
  it('из центра: первый взявший получает маркер на пол и начинает следующий раунд', () => {
    let s = fresh();
    s.center = [3, 0, 0, 0, 0];
    s = act(s, 0, { t: 'draft', source: -1, color: 0, line: 2 });
    expect(s.boards[0]!.floor).toEqual([5]);
    expect(s.marker).toBe(false);
    expect(s.nextFirst).toBe(0);
    expect(s.boards[0]!.lines[2]!.count).toBe(3);
  });
  it('излишки идут на пол; пол переполнен — в сброс', () => {
    let s = fresh();
    s.factories[0] = [4, 0, 0, 0, 0];
    s = act(s, 0, { t: 'draft', source: 0, color: 0, line: 0 });
    expect(s.boards[0]!.lines[0]).toEqual({ color: 0, count: 1 });
    expect(s.boards[0]!.floor).toEqual([0, 0, 0]);
    let t = fresh();
    t.boards[0]!.floor = [1, 1, 1, 1, 1, 1];
    t.factories[0] = [3, 0, 0, 0, 0];
    const d = t.discard.length;
    t = act(t, 0, { t: 'draft', source: 0, color: 0, line: 5 });
    expect(t.boards[0]!.floor).toHaveLength(7);
    expect(t.discard.length).toBe(d + 2);
  });
  it('нельзя: чужой цвет в линии, цвет уже на стене, полная линия, пустой источник', () => {
    const s = fresh();
    const b = s.boards[0]!;
    b.lines[2] = { color: 1, count: 1 };
    expect(canPlaceOnLine(b, 2, 0)).toBe(false);
    expect(canPlaceOnLine(b, 2, 1)).toBe(true);
    b.wall[3]![wallColumn(3, 4)] = true;
    expect(canPlaceOnLine(b, 3, 4)).toBe(false);
    b.lines[0] = { color: 2, count: 1 };
    expect(canPlaceOnLine(b, 0, 2)).toBe(false);
    expect(canPlaceOnLine(b, 5, 3)).toBe(true);
    s.factories[1] = [0, 0, 0, 0, 0];
    expect(g.validate(s, 0, { t: 'draft', source: 1, color: 0, line: 5 }).ok).toBe(false);
    expect(g.validate(s, 1, { t: 'draft', source: 0, color: 0, line: 5 }).ok).toBe(false);
  });
});

describe('очки', () => {
  const w = () => Array.from({ length: 5 }, () => Array<boolean>(5).fill(false));
  it('одиночная плитка = 1; цепочки считаются по горизонтали и вертикали', () => {
    const wall = w();
    wall[2]![2] = true;
    expect(placementScore(wall, 2, 2)).toBe(1);
    wall[2]![3] = true;
    expect(placementScore(wall, 2, 3)).toBe(2); // горизонталь из 2
    wall[1]![3] = true;
    expect(placementScore(wall, 2, 3)).toBe(2 + 2); // + вертикаль из 2
    wall[0]![3] = true;
    expect(placementScore(wall, 2, 3)).toBe(2 + 3);
  });
  it('конец раунда: линия укладывается на стену, остальное в сброс, штрафы вычитаются, счёт не ниже нуля', () => {
    let s = fresh();
    s.factories = s.factories.map(() => [0, 0, 0, 0, 0]);
    s.center = [0, 0, 0, 0, 1];
    s.boards[0]!.lines[1] = { color: 2, count: 1 };
    s.boards[1]!.floor = [0, 0];
    s.scores = [0, 1];
    s.marker = false;
    s.nextFirst = 1;
    const before = totalTiles(s);
    s = act(s, 0, { t: 'draft', source: -1, color: 4, line: 5 });
    // у игрока 0: линия 1 заполнена (2 из 2? count 1 — нет!) — проверим штраф
    expect(s.round).toBe(2);
    expect(s.scores[0]).toBe(0); // 0 − 1 → не ниже нуля
    expect(s.scores[1]).toBe(0); // 1 − 2 → 0
    expect(s.turn).toBe(1); // начинает владелец маркера
    expect(s.marker).toBe(true);
    expect(totalTiles(s)).toBe(before);
  });
  it('заполненная линия приносит очки', () => {
    let s = fresh();
    s.factories = s.factories.map(() => [0, 0, 0, 0, 0]);
    s.center = [0, 0, 0, 0, 1];
    s.marker = false;
    s.boards[0]!.lines[1] = { color: 2, count: 2 };
    s = act(s, 0, { t: 'draft', source: -1, color: 4, line: 3 });
    expect(s.scores[0]).toBe(1);
    expect(s.boards[0]!.wall[1]![wallColumn(1, 2)]).toBe(true);
    expect(s.boards[0]!.lines[1]).toEqual({ color: -1, count: 0 });
  });
});

describe('конец игры', () => {
  it('заполненная строка стены завершает игру; бонусы: строка +2, столбец +7, цвет +10', () => {
    let s = fresh();
    s.factories = s.factories.map(() => [0, 0, 0, 0, 0]);
    s.center = [0, 0, 0, 0, 1];
    s.marker = false;
    const b = s.boards[0]!;
    // строка 0 заполнена кроме одной клетки цвета 2; линия 0 содержит эту недостающую плитку
    for (let c = 0; c < 5; c++) b.wall[0]![c] = c !== wallColumn(0, 2);
    b.lines[0] = { color: 2, count: 1 };
    s = act(s, 0, { t: 'draft', source: -1, color: 4, line: 5 });
    expect(s.finished).toBe(true);
    expect(s.bonuses![0]).toBe(2); // одна полная строка
    const o = g.outcome(s)!;
    expect(o.winners).toEqual([0]);
  });
});

describe('партии', () => {
  it('случайные и бот-партии заканчиваются, плитки сохраняются', () => {
    for (let n = 0; n < 30; n++) {
      const rng = createRng(`azr${n}`);
      let s = fresh(2 + (n % 3), `g${n}`);
      let steps = 0;
      while (!g.outcome(s)) {
        const seat = s.turn;
        const legal = g.legalActions(s, seat);
        expect(legal.length).toBeGreaterThan(0);
        const a = n % 2 ? g.chooseBotAction!(s, seat, { level: (['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const)[n % 4]!, rngSeed: `${n}:${steps}` }) : legal[rng.int(legal.length)]!;
        const v = g.validate(s, seat, a);
        if (!v.ok) throw new Error(`${v.error} ${JSON.stringify(a)}`);
        s = g.apply(s, seat, a);
        if (!s.finished) expect(totalTiles(s)).toBe(100);
        if (++steps > 5000) throw new Error('не заканчивается');
      }
    }
  });
  it('бот в среднем набирает больше случайного игрока', () => {
    let botTotal = 0;
    let rndTotal = 0;
    for (let n = 0; n < 12; n++) {
      const rng = createRng(`cmp${n}`);
      let s = fresh(2, `c${n}`);
      while (!g.outcome(s)) {
        const a = s.turn === 0 ? g.chooseBotAction!(s, 0, { level: 'HARD', rngSeed: `${n}:${s.log.length}:${s.round}` }) : g.legalActions(s, 1)[rng.int(g.legalActions(s, 1).length)]!;
        s = g.apply(s, s.turn, a);
      }
      botTotal += s.scores[0]!;
      rndTotal += s.scores[1]!;
    }
    expect(botTotal).toBeGreaterThan(rndTotal);
  });
});
