/**
 * Базовые операции над доской Го. Доска — плоский массив size×size: 0 — пусто, 1 — чёрные, 2 — белые.
 * Используется и движком партии, и ботом (для быстрых розыгрышей).
 */
export type Stone = 0 | 1 | 2;
export const opponent = (c: 1 | 2): 1 | 2 => (c === 1 ? 2 : 1);

export function neighbors(size: number, i: number): number[] {
  const x = i % size;
  const y = (i / size) | 0;
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < size - 1) out.push(i + 1);
  if (y > 0) out.push(i - size);
  if (y < size - 1) out.push(i + size);
  return out;
}

const nbCache = new Map<number, number[][]>();
export function neighborTable(size: number): number[][] {
  let t = nbCache.get(size);
  if (!t) {
    t = Array.from({ length: size * size }, (_, i) => neighbors(size, i));
    nbCache.set(size, t);
  }
  return t;
}

/** Группа камней и её свободы, начиная с точки `i`. */
export function groupAt(board: ArrayLike<number>, size: number, i: number): { stones: number[]; liberties: Set<number> } {
  const nb = neighborTable(size);
  const color = board[i];
  const stones: number[] = [];
  const liberties = new Set<number>();
  const seen = new Set<number>([i]);
  const stack = [i];
  while (stack.length) {
    const p = stack.pop() as number;
    stones.push(p);
    for (const n of nb[p]!) {
      if (board[n] === 0) liberties.add(n);
      else if (board[n] === color && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return { stones, liberties };
}

export interface PlaceResult {
  /** Снятые камни. */
  captured: number[];
}

// Переиспользуемые буферы: розыгрыши бота вызывают place() десятки тысяч раз, аллокации тут дороги.
const stamp = new Int32Array(19 * 19);
let generation = 0;
const stackBuf = new Int32Array(19 * 19);

/** Есть ли у группы с камнем `i` хотя бы одна свобода (выходит сразу, как только нашли). */
function hasLiberty(board: ArrayLike<number>, nb: number[][], i: number): boolean {
  const color = board[i];
  const gen = ++generation;
  let top = 0;
  stackBuf[top++] = i;
  stamp[i] = gen;
  while (top > 0) {
    const p = stackBuf[--top]!;
    for (const n of nb[p]!) {
      const v = board[n];
      if (v === 0) return true;
      if (v === color && stamp[n] !== gen) {
        stamp[n] = gen;
        stackBuf[top++] = n;
      }
    }
  }
  return false;
}

/** Камни группы с камнем `i` (вызывается только для групп без свобод — на снятие). */
function collectGroup(board: ArrayLike<number>, nb: number[][], i: number, out: number[]): void {
  const color = board[i];
  const gen = ++generation;
  let top = 0;
  stackBuf[top++] = i;
  stamp[i] = gen;
  while (top > 0) {
    const p = stackBuf[--top]!;
    out.push(p);
    for (const n of nb[p]!) {
      if (board[n] === color && stamp[n] !== gen) {
        stamp[n] = gen;
        stackBuf[top++] = n;
      }
    }
  }
}

/**
 * Пытается поставить камень цвета `color` на `i` прямо в `board` (изменяет массив).
 * Возвращает null (и оставляет доску нетронутой), если ход — самоубийство или точка занята.
 */
export function place(board: number[], size: number, i: number, color: 1 | 2): PlaceResult | null {
  if (board[i] !== 0) return null;
  const nb = neighborTable(size);
  const enemy = opponent(color);
  board[i] = color;
  const captured: number[] = [];
  for (const n of nb[i]!) {
    if (board[n] === enemy && !hasLiberty(board, nb, n)) {
      const before = captured.length;
      collectGroup(board, nb, n, captured);
      for (let k = before; k < captured.length; k++) board[captured[k]!] = 0; // снимаем сразу, чтобы не собрать дважды
    }
  }
  if (!hasLiberty(board, nb, i)) {
    // самоубийство — откатываем
    board[i] = 0;
    for (const c of captured) board[c] = enemy;
    return null;
  }
  return { captured };
}

/** Площадь по Тромпу–Тейлору: камни + пустые области, граничащие только с одним цветом. */
export function areaScore(board: ArrayLike<number>, size: number): { black: number; white: number } {
  const nb = neighborTable(size);
  let black = 0;
  let white = 0;
  const seen = new Set<number>();
  for (let i = 0; i < size * size; i++) {
    if (board[i] === 1) black++;
    else if (board[i] === 2) white++;
    else if (!seen.has(i)) {
      let touchesB = false;
      let touchesW = false;
      let n = 0;
      const stack = [i];
      seen.add(i);
      while (stack.length) {
        const p = stack.pop() as number;
        n++;
        for (const q of nb[p]!) {
          if (board[q] === 1) touchesB = true;
          else if (board[q] === 2) touchesW = true;
          else if (!seen.has(q)) {
            seen.add(q);
            stack.push(q);
          }
        }
      }
      if (touchesB && !touchesW) black += n;
      else if (touchesW && !touchesB) white += n;
    }
  }
  return { black, white };
}

/** Хеш позиции для проверки повторов (суперко). */
export function hashBoard(board: ArrayLike<number>): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < board.length; i++) {
    h ^= board[i]! + 1;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
