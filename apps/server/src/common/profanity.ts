/**
 * Фильтр нецензурной лексики для чата. Слово маскируется звёздочками (первая буква остаётся).
 * Сравнение идёт по нормализованной форме: нижний регистр, «ё»→«е», латинские двойники → кириллица,
 * повторы букв схлопываются («хуууй» → «хуй»). Список — корни с допустимыми приставками.
 */
const LOOKALIKE: Record<string, string> = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };

const PREFIX = '(?:по|на|за|вы|у|от|до|с|об|раз|рас|под|при|пере|про|съ|недо|пред)?';
const ROOTS = [
  'хуй', 'хуе', 'хуя', 'хуи', 'хую', 'хуе?в',
  'пизд', 'пезд',
  'бля(?:д|т|х)', 'блять',
  'еб(?:а|у|и|о|л|ы|е)(?:н|т|л|р|ш|с|к|ь|й|ц)?', 'ёб',
  'сука', 'суки', 'сучк', 'сучар',
  'муда(?:к|ч)', 'мудил',
  'пидор', 'пидар', 'пидр',
  'гандон', 'залуп', 'шлюх', 'дроч', 'манда', 'ублюд', 'выродок', 'хер(?:ов|ня|ни)',
];
const RE = new RegExp(`^${PREFIX}(?:${ROOTS.join('|')})`);
/** Безобидные слова, начинающиеся с «опасных» корней. */
const SAFE = new Set(['употребл', 'ребус', 'ребят', 'ребен', 'ребён', 'небо', 'хлеб', 'требу', 'лебед', 'сукно', 'суково', 'героин']);

function normalize(word: string): string {
  const lower = word.toLowerCase().replace(/ё/g, 'е');
  let out = '';
  for (const ch of lower) out += LOOKALIKE[ch] ?? ch;
  return out.replace(/(.)\1+/g, '$1');
}

const isBad = (word: string): boolean => {
  const n = normalize(word);
  if (n.length < 3) return false;
  for (const safe of SAFE) if (n.startsWith(safe)) return false;
  return RE.test(n);
};

/** Заменяет нецензурные слова: «хуйня» → «х****». */
export function maskProfanity(text: string): string {
  return text.replace(/[\p{L}]+/gu, (w) => (isBad(w) ? w[0] + '*'.repeat(w.length - 1) : w));
}

export const hasProfanity = (text: string) => maskProfanity(text) !== text;
