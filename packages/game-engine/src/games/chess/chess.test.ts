import { describe, expect, it } from 'vitest';
import {
  evaluateResult, fromFen, initialState, legalMoves, makeMove, parseSq, toFen, type ChessMove, type ChessState,
} from './board';

function perft(s: ChessState, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(s);
  if (depth === 1) return moves.length;
  return moves.reduce((n, m) => n + perft(makeMove(s, m, false), depth - 1), 0);
}

/** Ход по строке «e2e4» / «e7e8q». */
export function mv(s: ChessState, uci: string): ChessState {
  const m: ChessMove = { from: parseSq(uci.slice(0, 2)), to: parseSq(uci.slice(2, 4)), promo: uci[4] as ChessMove['promo'] };
  const found = legalMoves(s).find((x) => x.from === m.from && x.to === m.to && x.promo === m.promo);
  if (!found) throw new Error(`Нелегальный ход ${uci} в ${toFen(s)}`);
  const ns = makeMove(s, found);
  return { ...ns, result: evaluateResult(ns) };
}

describe('perft — проверка генератора ходов на эталонных позициях', () => {
  const cases: [string, string, number[]][] = [
    ['начальная', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
    ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['позиция 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['позиция 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['позиция 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ];
  for (const [name, fen, counts] of cases) {
    it(name, () => {
      const s = fromFen(fen);
      counts.forEach((expected, i) => expect(perft(s, i + 1)).toBe(expected));
    });
  }
});

describe('FEN', () => {
  it('туда и обратно', () => {
    const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
    expect(toFen(fromFen(fen))).toBe(fen);
  });
});

describe('исходы партии', () => {
  it('детский мат', () => {
    let s = initialState();
    for (const m of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) s = mv(s, m);
    expect(s.result).toEqual({ winner: 1, reason: 'checkmate' });
  });
  it('пат', () => {
    const s = fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(evaluateResult({ ...s, keys: [] })).toEqual({ winner: null, reason: 'stalemate' });
  });
  it('недостаточный материал', () => {
    expect(evaluateResult(fromFen('8/8/4k3/8/8/3K4/8/6B1 w - - 0 1'))).toEqual({ winner: null, reason: 'insufficient' });
    expect(evaluateResult(fromFen('8/8/4k3/8/8/3K4/8/6R1 w - - 0 1'))).toBeNull();
  });
  it('правило 50 ходов', () => {
    expect(evaluateResult(fromFen('8/8/4k3/8/8/3K4/8/6R1 w - - 100 80'))).toEqual({ winner: null, reason: 'fifty' });
  });
  it('троекратное повторение', () => {
    let s = initialState();
    for (const m of ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']) s = mv(s, m);
    expect(s.result).toEqual({ winner: null, reason: 'repetition' });
  });
});

describe('особые ходы', () => {
  it('рокировка перемещает ладью и снимает права', () => {
    const s = mv(fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 'e1g1');
    expect(toFen(s)).toBe('r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1');
  });
  it('нельзя рокироваться через битое поле', () => {
    const s = fromFen('r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1');
    expect(legalMoves(s).some((m) => m.from === 4 && m.to === 6)).toBe(false);
  });
  it('взятие на проходе', () => {
    let s = fromFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    s = mv(s, 'e5d6');
    expect(s.board[parseSq('d5')]).toBe('');
    expect(s.board[parseSq('d6')]).toBe('P');
  });
  it('превращение пешки', () => {
    const s = mv(fromFen('8/P3k3/8/8/8/8/8/4K3 w - - 0 1'), 'a7a8n');
    expect(s.board[parseSq('a8')]).toBe('N');
  });
  it('связанная фигура не может уйти со связки', () => {
    const s = fromFen('4k3/4r3/8/8/8/8/4N3/4K3 w - - 0 1');
    expect(legalMoves(s).every((m) => m.from !== parseSq('e2'))).toBe(true);
  });
});

import { chessGame } from './index';
import { chooseMove } from './ai';
import { dispatch, registerBuiltinGames, startSession } from '../../index';

describe('определение игры и бот', () => {
  registerBuiltinGames();

  it('партия через dispatch: мат Шолара', () => {
    let s = startSession('chess', { players: 2, seed: 't' });
    const play = (seat: number, m: { from: string; to: string }) => {
      const r = dispatch(s, seat, { from: parseSq(m.from), to: parseSq(m.to) });
      if (!r.ok) throw new Error(r.error);
      s = r.session;
      return r;
    };
    play(0, { from: 'e2', to: 'e4' }); play(1, { from: 'e7', to: 'e5' });
    play(0, { from: 'f1', to: 'c4' }); play(1, { from: 'b8', to: 'c6' });
    play(0, { from: 'd1', to: 'h5' }); play(1, { from: 'g8', to: 'f6' });
    const last = play(0, { from: 'h5', to: 'f7' });
    expect(last.outcome).toEqual({ winners: [0], ranking: [0, 1], reason: 'checkmate' });
    expect(dispatch(s, 1, { from: 0, to: 8 })).toMatchObject({ ok: false });
  });

  it('отвергает чужой ход, чужую фигуру и мусор', () => {
    const s = startSession('chess', { players: 2, seed: 't' });
    expect(dispatch(s, 1, { from: parseSq('e7'), to: parseSq('e5') })).toMatchObject({ ok: false });
    expect(dispatch(s, 0, { from: parseSq('e7'), to: parseSq('e5') })).toMatchObject({ ok: false });
    expect(dispatch(s, 0, { from: 'x', to: 3 })).toMatchObject({ ok: false });
    expect(dispatch(s, 0, null)).toMatchObject({ ok: false });
  });

  it('view не раскрывает лишнего и сериализуется в JSON', () => {
    const v = chessGame.view(initialState(), 0);
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
    expect('keys' in v).toBe(false);
  });

  it('бот всех уровней делает легальный ход', () => {
    for (const level of ['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const) {
      const s = fromFen('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
      const m = chooseMove(s, { level, rngSeed: 'x' });
      expect(legalMoves(s).some((x) => x.from === m.from && x.to === m.to && x.promo === m.promo)).toBe(true);
    }
  });

  it('бот ставит мат в один ход и берёт повешенного ферзя', () => {
    const mate = fromFen('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1'); // Rd8#
    const m = chooseMove(mate, { level: 'MEDIUM', rngSeed: 'a' });
    expect(m).toMatchObject({ from: parseSq('d1'), to: parseSq('d8') });
    const hang = fromFen('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1'); // Rxd5
    expect(chooseMove(hang, { level: 'HARD', rngSeed: 'b' })).toMatchObject({ from: parseSq('d1'), to: parseSq('d5') });
  });

  it('бот против бота доигрывает до конца без нелегальных ходов', () => {
    let s = initialState();
    for (let i = 0; i < 300 && !s.result; i++) {
      const m = chooseMove(s, { level: i % 2 ? 'EASY' : 'MEDIUM', rngSeed: `g${i}` });
      s = mv(s, `${'abcdefgh'[m.from & 7]}${(m.from >> 3) + 1}${'abcdefgh'[m.to & 7]}${(m.to >> 3) + 1}${m.promo ?? ''}`);
    }
    expect(s.moves.length).toBeGreaterThan(10);
  }, 60_000);
});
