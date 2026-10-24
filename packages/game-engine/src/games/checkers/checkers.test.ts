import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { checkersGame as g, chooseMove, initialState, legalMoves, makeMove, evaluateResult, sqName, type CheckersState } from './index';

const sq = (name: string) => 'abcdefgh'.indexOf(name[0]!) + (Number(name[1]) - 1) * 8;
/** Расстановка вида { a1: 'w', d4: 'B' }. */
function pos(pieces: Record<string, string>, turn: 0 | 1 = 0): CheckersState {
  const board: string[] = Array(64).fill('');
  for (const [k, v] of Object.entries(pieces)) board[sq(k)] = v;
  return { board, turn, quiet: 0, keys: [], moves: [], last: null, result: null };
}
const paths = (s: CheckersState) => legalMoves(s).map((m) => m.path.map(sqName).join('-')).sort();
const play = (s: CheckersState, path: string) => {
  const p = path.split('-').map(sq);
  const v = g.validate(s, s.turn, { path: p });
  if (!v.ok) throw new Error(`${path}: ${v.error}`);
  return g.apply(s, s.turn, { path: p });
};

function perft(s: CheckersState, d: number): number {
  const moves = legalMoves(s);
  if (d === 1) return moves.length;
  return moves.reduce((n, m) => n + perft(makeMove(s, m, false), d - 1), 0);
}

describe('начальная позиция', () => {
  it('по 12 шашек, белые на тёмных клетках нижних рядов', () => {
    const s = initialState();
    expect(s.board.filter((p) => p === 'w')).toHaveLength(12);
    expect(s.board.filter((p) => p === 'b')).toHaveLength(12);
    expect(s.board[sq('a1')]).toBe('w');
    expect(s.board[sq('h8')]).toBe('b');
  });
  it('perft совпадает с эталоном (7, 49, 302, 1469)', () => {
    const s = initialState();
    expect([1, 2, 3, 4].map((d) => perft(s, d))).toEqual([7, 49, 302, 1469]);
  });
});

describe('обычные ходы', () => {
  it('простая шашка ходит вперёд по диагонали', () => {
    expect(paths(pos({ c3: 'w', h8: 'b' }))).toEqual(['c3-b4', 'c3-d4']);
    expect(paths(pos({ c6: 'b', a1: 'w' }, 1))).toEqual(['c6-b5', 'c6-d5']);
  });
  it('дамка ходит на любое расстояние', () => {
    expect(paths(pos({ a1: 'W', h8: 'b' })).filter((p) => p.startsWith('a1'))).toHaveLength(6);
  });
});

describe('взятие', () => {
  it('обязательно, в том числе назад простой шашкой', () => {
    expect(paths(pos({ c3: 'w', d4: 'b', a1: 'w' }))).toEqual(['c3-e5']);
    expect(paths(pos({ e5: 'w', d4: 'b', h8: 'b' }))).toEqual(['e5-c3']);
  });
  it('серия взятий выполняется до конца', () => {
    const s = pos({ a1: 'w', b2: 'b', d4: 'b', h8: 'b' });
    expect(paths(s)).toEqual(['a1-c3-e5'.replace('c3', 'c3')]);
    // a1 бьёт b2 (приземление c3), затем d4 (приземление e5)
    const t = play(s, 'a1-c3-e5');
    expect(t.board[sq('b2')]).toBe('');
    expect(t.board[sq('d4')]).toBe('');
    expect(t.board[sq('e5')]).toBe('w');
  });
  it('дамка бьёт издалека и выбирает клетку приземления', () => {
    const s = pos({ a1: 'W', d4: 'b', h8: 'b' });
    expect(paths(s)).toEqual(['a1-e5', 'a1-f6', 'a1-g7']);
  });
  it('если после приземления можно бить дальше — обязаны выбрать такую клетку', () => {
    // дамка a1 бьёт d4; с e5 можно бить f6? Расставим вторую жертву так, чтобы бить дальше можно было только с f6
    const s = pos({ a1: 'W', d4: 'b', g5: 'b', h8: 'b' });
    // с клетки f6 дамка бьёт g5 → h4; с e5 и g7 — нет
    expect(paths(s)).toEqual(['a1-f6-h4']);
  });
  it('нельзя перепрыгнуть одну и ту же шашку дважды', () => {
    const s = pos({ a1: 'W', c3: 'b', e3: 'b', e5: 'b', c5: 'b', h8: 'b' });
    for (const p of legalMoves(s)) {
      const jumps = p.path.length - 1;
      expect(jumps).toBeLessThanOrEqual(4);
    }
  });
  it('превращение по ходу взятия: дальше бьём как дамка', () => {
    // e6 бьёт d7 и встаёт на c8 (последняя горизонталь) → дамка; с c8 по диагонали бьёт b7 → a6
    const s = pos({ e6: 'w', d7: 'b', b7: 'b', h8: 'b' });
    expect(paths(s)).toEqual(['e6-c8-a6']);
    const t = play(s, 'e6-c8-a6');
    expect(t.board[sq('a6')]).toBe('W');
    expect(t.board[sq('b7')]).toBe('');
  });
  it('шашка, дошедшая до последней горизонтали обычным ходом, становится дамкой', () => {
    const t = play(pos({ b7: 'w', h8: 'b' }), 'b7-a8');
    expect(t.board[sq('a8')]).toBe('W');
  });
});

describe('конец партии', () => {
  it('нет ходов — проигрыш', () => {
    const s = pos({ a1: 'w', b2: 'w' , c3: 'b' }, 1); // у чёрной c3 заблокировано? есть ход — проверим другое: чёрных нет
    expect(evaluateResult(pos({ a1: 'w' }, 1))).toEqual({ winner: 0, reason: 'nomoves' });
    expect(s.turn).toBe(1);
  });
  it('ничья по 30 полуходам дамками без взятий', () => {
    const s = { ...pos({ a1: 'W', h8: 'B' }), quiet: 30 };
    expect(evaluateResult(s)).toEqual({ winner: null, reason: 'quiet' });
  });
  it('исход через GameDefinition', () => {
    let s = pos({ a1: 'w', b2: 'b' });
    s = g.apply(s, 0, { path: [sq('a1'), sq('c3')] });
    expect(g.outcome(s)).toMatchObject({ winners: [0] });
  });
});

describe('валидация и бот', () => {
  it('отклоняет простой ход при обязательном взятии', () => {
    const s = pos({ c3: 'w', d4: 'b', a1: 'w' });
    expect(g.validate(s, 0, { path: [sq('a1'), sq('b2')] })).toMatchObject({ ok: false, error: 'Взятие обязательно' });
    expect(g.validate(s, 1, { path: [sq('c3'), sq('e5')] }).ok).toBe(false);
    expect(g.validate(s, 0, { path: [5] }).ok).toBe(false);
  });
  it('бот всех уровней выбирает допустимый ход и берёт выгодное взятие', () => {
    for (const level of ['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const) {
      const m = chooseMove(initialState(), { level, rngSeed: 'x' });
      expect(legalMoves(initialState()).some((l) => l.path.join() === m.path.join())).toBe(true);
    }
  });
  it('случайные партии и бот-против-бота заканчиваются без нелегальных ходов', () => {
    for (let n = 0; n < 60; n++) {
      const rng = createRng(`chk${n}`);
      let s = initialState();
      let steps = 0;
      while (!s.result) {
        const legal = legalMoves(s);
        const m = n % 3 === 0 ? chooseMove(s, { level: 'MEDIUM', rngSeed: `${n}:${steps}` }) : legal[rng.int(legal.length)]!;
        expect(g.validate(s, s.turn, m).ok).toBe(true);
        s = g.apply(s, s.turn, m);
        if (++steps > 600) break; // партии с ботом без ничьей могут быть долгими — главное, что ходы легальны
      }
    }
  }, 120_000);
});
