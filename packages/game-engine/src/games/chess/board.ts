/**
 * Шахматная доска и правила хода.
 * Клетка = rank * 8 + file; rank 0 — первая горизонталь (белые внизу), file 0 — вертикаль «a».
 * Фигуры: заглавные — белые (P N B R Q K), строчные — чёрные, '' — пусто.
 * Место 0 = белые, место 1 = чёрные.
 */
export type Color = 0 | 1;
export type Promo = 'q' | 'r' | 'b' | 'n';

export interface ChessMove {
  from: number;
  to: number;
  promo?: Promo;
}

export interface ChessResult {
  /** null — ничья. */
  winner: Color | null;
  reason: 'checkmate' | 'stalemate' | 'insufficient' | 'repetition' | 'fifty';
}

export interface ChessState {
  board: string[];
  turn: Color;
  /** Права на рокировку: подмножество 'KQkq'. */
  castling: string;
  /** Поле, «проходимое» пешкой после двойного хода (для взятия на проходе), или -1. */
  ep: number;
  halfmove: number;
  fullmove: number;
  /** Ключи позиций после каждого хода — для троекратного повторения. */
  keys: string[];
  /** Ходы в нотации «e2e4» (для списка ходов в интерфейсе). */
  moves: string[];
  last: { from: number; to: number } | null;
  result: ChessResult | null;
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const fileOf = (sq: number) => sq & 7;
export const rankOf = (sq: number) => sq >> 3;
export const sqName = (sq: number) => 'abcdefgh'[fileOf(sq)]! + String(rankOf(sq) + 1);
export const parseSq = (s: string) => 'abcdefgh'.indexOf(s[0]!) + (Number(s[1]) - 1) * 8;
export const colorOf = (p: string): Color => (p === p.toUpperCase() ? 0 : 1);
export const moveToUci = (m: ChessMove) => sqName(m.from) + sqName(m.to) + (m.promo ?? '');

// ───────── таблицы ходов ─────────

const KNIGHT_D = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING_D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

function jumps(deltas: readonly (readonly [number, number])[]): number[][] {
  return Array.from({ length: 64 }, (_, sq) =>
    deltas.flatMap(([df, dr]) => {
      const f = fileOf(sq) + df;
      const r = rankOf(sq) + dr;
      return f >= 0 && f < 8 && r >= 0 && r < 8 ? [r * 8 + f] : [];
    }),
  );
}
function rays(dirs: readonly (readonly [number, number])[]): number[][][] {
  return dirs.map(([df, dr]) =>
    Array.from({ length: 64 }, (_, sq) => {
      const out: number[] = [];
      let f = fileOf(sq) + df;
      let r = rankOf(sq) + dr;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        out.push(r * 8 + f);
        f += df;
        r += dr;
      }
      return out;
    }),
  );
}
const KNIGHT = jumps(KNIGHT_D);
const KING = jumps(KING_D);
const ROOK_RAYS = rays(ROOK_DIRS);
const BISHOP_RAYS = rays(BISHOP_DIRS);

// ───────── атаки ─────────

/** Атакована ли клетка `sq` фигурами цвета `by`. */
export function isAttacked(board: readonly string[], sq: number, by: Color): boolean {
  const f = fileOf(sq);
  const r = rankOf(sq);
  // Пешки: белая пешка атакует вверх, значит стоит на горизонталь ниже цели.
  const pr = by === 0 ? r - 1 : r + 1;
  if (pr >= 0 && pr < 8) {
    const pawn = by === 0 ? 'P' : 'p';
    if (f > 0 && board[pr * 8 + f - 1] === pawn) return true;
    if (f < 7 && board[pr * 8 + f + 1] === pawn) return true;
  }
  const knight = by === 0 ? 'N' : 'n';
  for (const t of KNIGHT[sq]!) if (board[t] === knight) return true;
  const king = by === 0 ? 'K' : 'k';
  for (const t of KING[sq]!) if (board[t] === king) return true;
  const rook = by === 0 ? 'R' : 'r';
  const bishop = by === 0 ? 'B' : 'b';
  const queen = by === 0 ? 'Q' : 'q';
  for (const ray of ROOK_RAYS) {
    for (const t of ray[sq]!) {
      const p = board[t]!;
      if (p) {
        if (p === rook || p === queen) return true;
        break;
      }
    }
  }
  for (const ray of BISHOP_RAYS) {
    for (const t of ray[sq]!) {
      const p = board[t]!;
      if (p) {
        if (p === bishop || p === queen) return true;
        break;
      }
    }
  }
  return false;
}

export const kingSquare = (board: readonly string[], c: Color): number => board.indexOf(c === 0 ? 'K' : 'k');

export const inCheck = (s: ChessState): boolean => isAttacked(s.board, kingSquare(s.board, s.turn), (1 - s.turn) as Color);

// ───────── генерация ходов ─────────

const PROMOS: Promo[] = ['q', 'r', 'b', 'n'];

/** Псевдолегальные ходы (без проверки шаха своему королю), включая рокировки. */
export function pseudoMoves(s: ChessState): ChessMove[] {
  const { board, turn } = s;
  const out: ChessMove[] = [];
  const enemy = (p: string) => p !== '' && colorOf(p) !== turn;

  for (let from = 0; from < 64; from++) {
    const p = board[from]!;
    if (!p || colorOf(p) !== turn) continue;
    const kind = p.toLowerCase();

    if (kind === 'p') {
      const dir = turn === 0 ? 8 : -8;
      const startRank = turn === 0 ? 1 : 6;
      const lastRank = turn === 0 ? 7 : 0;
      const push = (to: number) => {
        if (rankOf(to) === lastRank) for (const promo of PROMOS) out.push({ from, to, promo });
        else out.push({ from, to });
      };
      const one = from + dir;
      if (one >= 0 && one < 64 && !board[one]) {
        push(one);
        if (rankOf(from) === startRank && !board[one + dir]) out.push({ from, to: one + dir });
      }
      for (const df of [-1, 1]) {
        const f = fileOf(from) + df;
        if (f < 0 || f > 7) continue;
        const to = one + df;
        if (to < 0 || to >= 64) continue;
        if (enemy(board[to]!) || to === s.ep) push(to);
      }
    } else if (kind === 'n' || kind === 'k') {
      for (const to of (kind === 'n' ? KNIGHT : KING)[from]!) {
        const t = board[to]!;
        if (!t || enemy(t)) out.push({ from, to });
      }
    } else {
      const dirs = kind === 'r' ? ROOK_RAYS : kind === 'b' ? BISHOP_RAYS : [...ROOK_RAYS, ...BISHOP_RAYS];
      for (const ray of dirs) {
        for (const to of ray[from]!) {
          const t = board[to]!;
          if (!t) out.push({ from, to });
          else {
            if (enemy(t)) out.push({ from, to });
            break;
          }
        }
      }
    }
  }

  // Рокировка: нужны права, пустые поля между королём и ладьёй и отсутствие шаха на пути короля.
  const opp = (1 - turn) as Color;
  const base = turn === 0 ? 0 : 56;
  const king = turn === 0 ? 'K' : 'k';
  const rook = turn === 0 ? 'R' : 'r';
  if (board[base + 4] === king && !isAttacked(board, base + 4, opp)) {
    if (
      s.castling.includes(turn === 0 ? 'K' : 'k') && board[base + 7] === rook &&
      !board[base + 5] && !board[base + 6] &&
      !isAttacked(board, base + 5, opp) && !isAttacked(board, base + 6, opp)
    ) out.push({ from: base + 4, to: base + 6 });
    if (
      s.castling.includes(turn === 0 ? 'Q' : 'q') && board[base] === rook &&
      !board[base + 1] && !board[base + 2] && !board[base + 3] &&
      !isAttacked(board, base + 3, opp) && !isAttacked(board, base + 2, opp)
    ) out.push({ from: base + 4, to: base + 2 });
  }
  return out;
}

const RIGHTS_BY_SQUARE: Record<number, string> = { 0: 'Q', 7: 'K', 56: 'q', 63: 'k', 4: 'KQ', 60: 'kq' };

/**
 * Выполняет ход, возвращая новое состояние.
 * `track=false` — облегчённый режим для перебора ботом/perft: не ведёт журнал и ключи повторений.
 */
export function makeMove(s: ChessState, m: ChessMove, track = true): ChessState {
  const board = s.board.slice();
  const piece = board[m.from]!;
  const isPawn = piece === 'P' || piece === 'p';
  const captured = board[m.to]!;
  board[m.from] = '';
  board[m.to] = m.promo ? (s.turn === 0 ? m.promo.toUpperCase() : m.promo) : piece;

  if (isPawn && m.to === s.ep && !captured) board[m.to + (s.turn === 0 ? -8 : 8)] = ''; // взятие на проходе
  if ((piece === 'K' || piece === 'k') && Math.abs(m.to - m.from) === 2) {
    // Рокировка: переносим ладью.
    const rookFrom = m.to > m.from ? m.from + 3 : m.from - 4;
    const rookTo = m.to > m.from ? m.from + 1 : m.from - 1;
    board[rookTo] = board[rookFrom]!;
    board[rookFrom] = '';
  }

  let castling = s.castling;
  for (const sq of [m.from, m.to]) {
    const lose = RIGHTS_BY_SQUARE[sq];
    if (lose) for (const c of lose) castling = castling.replace(c, '');
  }

  const ns: ChessState = {
    board,
    turn: (1 - s.turn) as Color,
    castling,
    ep: isPawn && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : -1,
    halfmove: isPawn || captured ? 0 : s.halfmove + 1,
    fullmove: s.fullmove + (s.turn === 1 ? 1 : 0),
    keys: s.keys,
    moves: s.moves,
    last: { from: m.from, to: m.to },
    result: null,
  };
  if (track) {
    ns.moves = [...s.moves, moveToUci(m)];
    ns.keys = [...s.keys, positionKey(ns)];
  }
  return ns;
}

export function legalMoves(s: ChessState): ChessMove[] {
  const me = s.turn;
  const opp = (1 - me) as Color;
  const king = kingSquare(s.board, me);
  return pseudoMoves(s).filter((m) => {
    const ns = makeMove(s, m, false);
    return !isAttacked(ns.board, m.from === king ? m.to : king, opp);
  });
}

// ───────── позиция, конец партии ─────────

/** Ключ позиции для повторений. Поле ep учитывается, только если взятие на проходе реально возможно. */
export function positionKey(s: ChessState): string {
  let ep = '-';
  if (s.ep >= 0) {
    const pawn = s.turn === 0 ? 'P' : 'p';
    const r = s.turn === 0 ? rankOf(s.ep) - 1 : rankOf(s.ep) + 1;
    const f = fileOf(s.ep);
    const can = (ff: number) => ff >= 0 && ff < 8 && s.board[r * 8 + ff] === pawn;
    if (can(f - 1) || can(f + 1)) ep = String(s.ep);
  }
  return `${s.board.map((p) => p || '.').join('')} ${s.turn} ${s.castling || '-'} ${ep}`;
}

function insufficientMaterial(board: readonly string[]): boolean {
  const minors: { p: string; sq: number }[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq]!;
    if (!p || p.toLowerCase() === 'k') continue;
    if ('nb'.includes(p.toLowerCase())) minors.push({ p: p.toLowerCase(), sq });
    else return false; // пешка, ладья или ферзь — мат возможен
  }
  if (minors.length <= 1) return true;
  // Только слоны на полях одного цвета.
  if (minors.every((x) => x.p === 'b')) {
    const shade = (sq: number) => (fileOf(sq) + rankOf(sq)) & 1;
    return minors.every((x) => shade(x.sq) === shade(minors[0]!.sq));
  }
  return false;
}

/** Определяет итог позиции (с ведением ключей). Вызывается после хода. */
export function evaluateResult(s: ChessState): ChessResult | null {
  if (legalMoves(s).length === 0) {
    return inCheck(s) ? { winner: (1 - s.turn) as Color, reason: 'checkmate' } : { winner: null, reason: 'stalemate' };
  }
  if (insufficientMaterial(s.board)) return { winner: null, reason: 'insufficient' };
  const key = s.keys[s.keys.length - 1];
  if (key && s.keys.filter((k) => k === key).length >= 3) return { winner: null, reason: 'repetition' };
  if (s.halfmove >= 100) return { winner: null, reason: 'fifty' };
  return null;
}

// ───────── FEN ─────────

export function fromFen(fen: string): ChessState {
  const [placement = '', turn = 'w', castling = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/);
  const board: string[] = Array(64).fill('');
  placement.split('/').forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else board[(7 - i) * 8 + f++] = ch;
    }
  });
  const s: ChessState = {
    board,
    turn: turn === 'w' ? 0 : 1,
    castling: castling === '-' ? '' : castling,
    ep: ep === '-' ? -1 : parseSq(ep),
    halfmove: Number(half),
    fullmove: Number(full),
    keys: [],
    moves: [],
    last: null,
    result: null,
  };
  s.keys = [positionKey(s)];
  return s;
}

export function toFen(s: ChessState): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = s.board[r * 8 + f]!;
      if (!p) empty++;
      else {
        row += (empty ? empty : '') + p;
        empty = 0;
      }
    }
    rows.push(row + (empty ? empty : ''));
  }
  return `${rows.join('/')} ${s.turn === 0 ? 'w' : 'b'} ${s.castling || '-'} ${s.ep >= 0 ? sqName(s.ep) : '-'} ${s.halfmove} ${s.fullmove}`;
}

export const initialState = (): ChessState => fromFen(START_FEN);
