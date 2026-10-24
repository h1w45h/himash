import { createRng } from '@nastolki/game-engine';

/**
 * Процедурные «картинки» для ассоциативных игр: у карты нет файла, оформление
 * детерминированно строится из номера карты и названия колоды (одинаково у всех игроков).
 */
const POOLS: Record<string, string[]> = {
  dixit: ['🌙', '🗝️', '🕯️', '🦉', '🌹', '🪞', '🎭', '🦋', '🌊', '🏰', '🕰️', '🌳', '🐚', '🔮', '🪶', '🎻', '🌌', '🦢', '🪄', '📜', '🌵', '🦊', '🍄', '⚓', '🧭', '🐋', '🌺', '🪐', '🎪', '🗼'],
  imaginarium: ['🎈', '🧩', '🪁', '🎠', '🦄', '🍭', '🚀', '🧸', '🎨', '🐙', '🌈', '🎡', '🪅', '🐘', '🍉', '🛸', '🧙', '🐢', '🍰', '🎲', '🪀', '🦜', '🌋', '⛵', '🐝', '🧁', '🛼', '🎷', '🦩', '🪗'],
};
const COMMON = ['⭐', '☁️', '🔥', '❄️', '🌸', '🍂', '💎', '🪨', '🌴', '🐟', '🦅', '🐺', '🚪', '🪜', '🏔️', '☂️'];

export interface CardArt {
  bg: [string, string];
  emojis: [string, string, string];
  rotation: number[];
}

export function cardArt(deck: string, id: number): CardArt {
  const rng = createRng(`${deck}:${id}`);
  const pool = [...(POOLS[deck] ?? POOLS.dixit!), ...COMMON];
  const hue = rng.int(360);
  return {
    bg: [`hsl(${hue}, 55%, ${rng.int(25) + 55}%)`, `hsl(${(hue + 40 + rng.int(80)) % 360}, 60%, ${rng.int(25) + 35}%)`],
    emojis: [pool[rng.int(pool.length)]!, pool[rng.int(pool.length)]!, pool[rng.int(pool.length)]!],
    rotation: [rng.int(40) - 20, rng.int(40) - 20, rng.int(40) - 20],
  };
}
