import { randomInt } from 'crypto';

/** Алфавит без похожих символов (0/O, 1/I/L), чтобы код легко диктовать голосом. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRoomCode(length = 6, pick: (max: number) => number = randomInt): string {
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[pick(CODE_ALPHABET.length)];
  return code;
}

/** Первое свободное место [0, max) или null, если комната заполнена. */
export function firstFreeSeat(taken: readonly number[], max: number): number | null {
  const set = new Set(taken);
  for (let s = 0; s < max; s++) if (!set.has(s)) return s;
  return null;
}
