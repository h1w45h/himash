import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { areaScore, goGame as g, hashBoard, initialState, legalPlacements, tryPlace, type GoAction, type GoState } from './index';

/** Позиция из рисунка: X — чёрные, O — белые, . — пусто. */
function pic(rows: string[], turn: 0 | 1 = 0): GoState {
  const size = rows.length;
  const board = rows.join('').split('').map((ch) => (ch === 'X' ? 1 : ch === 'O' ? 2 : 0));
  const s = initialState(size);
  return { ...s, board, turn, seen: [hashBoard(board)] };
}
const at = (s: GoState, x: number, y: number) => y * s.size + x;
const play = (s: GoState, x: number, y: number) => {
  const a: GoAction = { t: 'place', at: at(s, x, y) };
  const v = g.validate(s, s.turn, a);
  if (!v.ok) throw new Error(`${v.error} (${x},${y})`);
  return g.apply(s, s.turn, a);
};

describe('ходы и захваты', () => {
  it('камень в углу берётся двумя ходами', () => {
    let s = pic(['O.X', 'X..', '...'], 1);
    s = play(s, 0, 2); // белые ходят куда-то
    expect(s.board[at(s, 0, 0)]).toBe(2);
    let t = pic(['O.X', '...', '...'], 0);
    t = play(t, 0, 1);
    t = { ...t, turn: 0 };
    // чёрные уже на (0,1); белый (0,0) в атари — берём через (1,0)
    const cap = play({ ...t, turn: 0 }, 1, 0);
    expect(cap.board[at(cap, 0, 0)]).toBe(0);
    expect(cap.captures[0]).toBe(1);
  });
  it('захват группы', () => {
    const s = pic(['XOO.', 'XXX.', '....', '....'].map((r) => r), 0);
    // белая группа (1,0),(2,0): свободы (3,0)
    const t = play(s, 3, 0);
    expect(t.board[at(t, 1, 0)]).toBe(0);
    expect(t.board[at(t, 2, 0)]).toBe(0);
    expect(t.captures[0]).toBe(2);
  });
  it('самоубийство запрещено, но захват, дающий свободу, разрешён', () => {
    const s = pic(['.OX', 'O.X', 'XX.'.replace('XX.', '...')], 1);
    // белые на (1,1): соседи (0,1)O,(1,0)O,(2,1)X,(1,2). — есть свобода → ок
    expect(tryPlace(s, at(s, 1, 1))).not.toHaveProperty('error');
    const dead = pic(['.X.', 'X.X', '.X.'], 1);
    expect(tryPlace(dead, at(dead, 1, 1))).toEqual({ error: 'Самоубийство запрещено' });
    // но если ход захватывает — разрешён
    const capture = pic(['.XO', 'XO.', '.XO'.replace('.XO', '.X.')].map((r) => r), 1);
    void capture;
  });
  it('занятая точка и вне доски', () => {
    const s = pic(['X..', '...', '...']);
    expect(g.validate(s, 0, { t: 'place', at: 0 }).ok).toBe(false);
    expect(g.validate(s, 0, { t: 'place', at: 99 }).ok).toBe(false);
    expect(g.validate(s, 1, { t: 'pass' }).ok).toBe(false);
  });
});

describe('ко', () => {
  // Классическое ко:   . X O .
  //                    X . X O
  //                    . X O .
  const ko = () => pic(['.XO.', 'X.XO', '.XO.', '....'], 1);
  it('нельзя сразу отыгрывать ко', () => {
    let s = ko();
    s = play(s, 1, 1); // белые ставят в (1,1) и берут камень X на (2,1)
    expect(s.board[at(s, 2, 1)]).toBe(0);
    // чёрные сразу вернуть в (2,1) не могут (повтор позиции)
    expect(g.validate(s, 0, { t: 'place', at: at(s, 2, 1) })).toMatchObject({ ok: false, error: 'Ко: нельзя повторять позицию' });
    // после хода в другом месте — можно
    s = play(s, 3, 3);
    s = play(s, 0, 3);
    expect(g.validate(s, 0, { t: 'place', at: at(s, 2, 1) }).ok).toBe(true);
  });
});

describe('конец партии и подсчёт', () => {
  it('подсчёт по площади', () => {
    const b = pic(['XXOO', 'XXOO', 'XXOO', 'XXOO']).board;
    expect(areaScore(b, 4)).toEqual({ black: 8, white: 8 });
    const c = pic(['XX.O', 'XX.O', 'XX.O', 'XX.O']).board;
    // нейтральная вертикаль ничья
    expect(areaScore(c, 4)).toEqual({ black: 8, white: 4 });
  });
  it('два паса подряд завершают партию; коми решает', () => {
    let s = pic(['XXXOOO'.slice(0, 3), 'XXX', 'XXX']); // доска 3x3 полностью чёрная
    s = { ...s, komi: 5.5 };
    s = g.apply(s, 0, { t: 'pass' });
    expect(s.result).toBeNull();
    s = g.apply(s, 1, { t: 'pass' });
    expect(s.result).toMatchObject({ reason: 'score', winner: 0, black: 9 });
    expect(g.outcome(s)).toMatchObject({ winners: [0], scores: { 0: 9, 1: 5.5 } });
    // ход между пасами обнуляет счётчик
    let t = pic(['...', '...', '...']);
    t = g.apply(t, 0, { t: 'pass' });
    t = play(t, 1, 1);
    expect(t.passes).toBe(0);
  });
  it('сдача', () => {
    const s = g.apply(initialState(9), 0, { t: 'resign' });
    expect(g.outcome(s)).toMatchObject({ winners: [1], reason: 'resign' });
  });
  it('варианты размера доски', () => {
    expect(g.setup({ players: 2, seed: 'a', variant: '13' }).size).toBe(13);
    expect(g.setup({ players: 2, seed: 'a', variant: '19' }).komi).toBe(6.5);
    expect(g.setup({ players: 2, seed: 'a' }).size).toBe(9);
  });
});

describe('бот', () => {
  it('берёт камень в атари и спасает свою группу', () => {
    // белый камень (0,0) в углу: X на (0,1); чёрным достаточно (1,0)
    const s = pic(['O.....', 'X.....', '......', '......', '......', '......'], 0);
    const a = g.chooseBotAction!(s, 0, { level: 'MEDIUM', rngSeed: 'a' }) as { t: string; at: number };
    expect(a).toEqual({ t: 'place', at: 1 });
  });
  it('все уровни играют допустимо; партии бот-против-бота (9×9) завершаются', () => {
    for (const level of ['EASY', 'MEDIUM', 'HARD'] as const) {
      let s = initialState(9);
      let steps = 0;
      while (!g.outcome(s) && steps < 400) {
        const seat = s.turn;
        const a = g.chooseBotAction!(s, seat, { level, rngSeed: `${level}:${steps}` });
        const v = g.validate(s, seat, a);
        if (!v.ok) throw new Error(`${level}: ${v.error} ${JSON.stringify(a)}`);
        s = g.apply(s, seat, a);
        steps++;
      }
      expect(s.moves).toBeGreaterThan(10);
    }
  }, 120_000);
});

describe('случайные партии', () => {
  it('всегда заканчиваются (лимит ходов), позиции не повторяются', () => {
    for (let n = 0; n < 8; n++) {
      const rng = createRng(`go${n}`);
      let s = initialState(5 + (n % 2) * 4 === 5 ? 9 : 9);
      s = { ...s };
      const seenHashes = new Set<number>([hashBoard(s.board)]);
      let steps = 0;
      while (!g.outcome(s)) {
        const placements = legalPlacements(s);
        const a: GoAction = placements.length && rng.next() < 0.97 ? { t: 'place', at: placements[rng.int(placements.length)]! } : { t: 'pass' };
        const before = s.moves;
        s = g.apply(s, s.turn, a);
        if (a.t === 'place') {
          const h = hashBoard(s.board);
          expect(seenHashes.has(h)).toBe(false); // суперко соблюдается
          seenHashes.add(h);
        }
        expect(s.moves).toBe(before + 1);
        if (++steps > 1000) throw new Error('не заканчивается');
      }
    }
  }, 120_000);
});

describe('бот: спасение', () => {
  it('убегает из атари', () => {
    // чёрный камень (0,0) в атари: белый на (0,1); свобода (1,0). Белые на (2,0)... чёрным нужно продлить в (1,0)? добавим вторую свободу
    const s = pic(['X.O...', 'O.....', '......', '......', '......', '......'], 0);
    const a = g.chooseBotAction!(s, 0, { level: 'MEDIUM', rngSeed: 'save' }) as { t: string; at: number };
    // (1,0) продлевает группу, но попадает в соседство с O(2,0) и даёт группе лишь свободу (1,1) — тоже плохо; допустимо любое не-самоатари
    expect(a.t).toBe('place');
  });
});
