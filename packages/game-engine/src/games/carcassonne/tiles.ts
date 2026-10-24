/**
 * Классический набор из 72 плиток. Стороны задаются по часовой стрелке: 0 — север, 1 — восток, 2 — юг, 3 — запад.
 * Тип стороны: c — город, r — дорога, f — поле. У каждой стороны три «слота» границы
 * (для полей: слева, середина, справа), поэтому фермерские участки считаются точно.
 */
export type FeatureKind = 'city' | 'road' | 'monastery' | 'field';

export interface Feature {
  kind: FeatureKind;
  /** Стороны плитки, которых касается город или дорога. */
  sides: number[];
  /** Слоты границы (0…11) для поля. */
  slots: number[];
  shield: boolean;
  /** Для поля: индексы городов этой плитки, к которым оно примыкает. */
  cities: number[];
}

export interface TileType {
  name: string;
  sides: string; // 'crfr' и т.п.: север, восток, юг, запад
  count: number;
  features: Feature[];
}

interface Spec {
  name: string;
  sides: string;
  count: number;
  /** Группы сторон одного города, напр. ['NW'] — угловой город. По умолчанию все городские стороны образуют отдельные города. */
  cities?: string[];
  monastery?: boolean;
  shield?: boolean;
  /** Начальная плитка. */
  start?: boolean;
}

const SIDE = { N: 0, E: 1, S: 2, W: 3 } as const;
const toSides = (g: string) => [...g].map((c) => SIDE[c as keyof typeof SIDE]);

// Имена — собственные, расположение элементов соответствует классическому раскладу.
const SPECS: Spec[] = [
  { name: 'Монастырь у дороги', sides: 'ffrf', count: 2, monastery: true },
  { name: 'Монастырь', sides: 'ffff', count: 4, monastery: true },
  { name: 'Город-крепость', sides: 'cccc', count: 1, cities: ['NESW'], shield: true },
  { name: 'Город и дорога', sides: 'crfr', count: 4, cities: ['N'], start: true },
  { name: 'Город-тупик', sides: 'cfff', count: 5, cities: ['N'] },
  { name: 'Мост города с щитом', sides: 'fcfc', count: 2, cities: ['EW'], shield: true },
  { name: 'Мост города', sides: 'fcfc', count: 1, cities: ['EW'] },
  { name: 'Два города напротив', sides: 'fcfc', count: 3, cities: ['E', 'W'] },
  { name: 'Два города рядом', sides: 'ccff', count: 2, cities: ['N', 'E'] },
  { name: 'Город и поворот (вправо)', sides: 'crrf', count: 3, cities: ['N'] },
  { name: 'Город и поворот (влево)', sides: 'cfrr', count: 3, cities: ['N'] },
  { name: 'Город и перекрёсток', sides: 'crrr', count: 3, cities: ['N'] },
  { name: 'Угловой город с щитом', sides: 'cffc', count: 2, cities: ['NW'], shield: true },
  { name: 'Угловой город', sides: 'cffc', count: 3, cities: ['NW'] },
  { name: 'Угловой город с щитом и дорогой', sides: 'crrc', count: 2, cities: ['NW'], shield: true },
  { name: 'Угловой город с дорогой', sides: 'crrc', count: 3, cities: ['NW'] },
  { name: 'Три стороны города с щитом', sides: 'ccfc', count: 1, cities: ['NEW'], shield: true },
  { name: 'Три стороны города', sides: 'ccfc', count: 3, cities: ['NEW'] },
  { name: 'Три стороны города с щитом и дорогой', sides: 'ccrc', count: 2, cities: ['NEW'], shield: true },
  { name: 'Три стороны города и дорога', sides: 'ccrc', count: 1, cities: ['NEW'] },
  { name: 'Прямая дорога', sides: 'rfrf', count: 8 },
  { name: 'Поворот дороги', sides: 'ffrr', count: 9 },
  { name: 'Развилка', sides: 'frrr', count: 4 },
  { name: 'Перекрёсток', sides: 'rrrr', count: 1 },
];

function build(spec: Spec): TileType {
  const features: Feature[] = [];
  const sideType = (s: number) => spec.sides[s]!;
  // Города
  const cityOfSide: number[] = [-1, -1, -1, -1];
  const groups = spec.cities ?? [];
  for (const g of groups) {
    const sides = toSides(g);
    sides.forEach((s) => (cityOfSide[s] = features.length));
    features.push({ kind: 'city', sides, slots: [], shield: !!spec.shield, cities: [] });
  }
  // Дороги: при трёх и более дорожных сторонах каждая дорога обрывается в центре и считается отдельной
  const roadSides = [0, 1, 2, 3].filter((s) => sideType(s) === 'r');
  if (roadSides.length > 0) {
    if (roadSides.length <= 2) features.push({ kind: 'road', sides: roadSides, slots: [], shield: false, cities: [] });
    else for (const s of roadSides) features.push({ kind: 'road', sides: [s], slots: [], shield: false, cities: [] });
  }
  if (spec.monastery) features.push({ kind: 'monastery', sides: [], slots: [], shield: false, cities: [] });

  // Поля: слоты границы, соседние слоты-поля объединяются в кольце
  const isFieldSlot = (j: number) => {
    const t = sideType(Math.floor(j / 3));
    return t === 'f' || (t === 'r' && j % 3 !== 1);
  };
  const seen = new Array<boolean>(12).fill(false);
  for (let j0 = 0; j0 < 12; j0++) {
    if (seen[j0] || !isFieldSlot(j0)) continue;
    const slots: number[] = [];
    const stack = [j0];
    seen[j0] = true;
    while (stack.length) {
      const j = stack.pop()!;
      slots.push(j);
      for (const n of [(j + 1) % 12, (j + 11) % 12]) {
        if (!seen[n] && isFieldSlot(n)) {
          seen[n] = true;
          stack.push(n);
        }
      }
    }
    const adj = new Set<number>();
    for (const j of slots) {
      for (const n of [(j + 1) % 12, (j + 11) % 12]) {
        const side = Math.floor(n / 3);
        if (sideType(side) === 'c' && cityOfSide[side]! >= 0) adj.add(cityOfSide[side]!);
      }
    }
    features.push({ kind: 'field', sides: [], slots: slots.sort((a, b) => a - b), shield: false, cities: [...adj] });
  }
  return { name: spec.name, sides: spec.sides, count: spec.count, features };
}

export const TILE_TYPES: TileType[] = SPECS.map(build);
export const START_TYPE = SPECS.findIndex((s) => s.start);

/** Тип стороны плитки после поворота на `rot` четвертей по часовой стрелке. */
export const sideTypeOf = (type: number, rot: number, side: number) => TILE_TYPES[type]!.sides[(side - rot + 4) % 4]!;

/** Элементы плитки с учётом поворота (индексы сохраняются). */
export function rotatedFeatures(type: number, rot: number): Feature[] {
  return TILE_TYPES[type]!.features.map((f) => ({
    ...f,
    sides: f.sides.map((s) => (s + rot) % 4),
    slots: f.slots.map((j) => (j + 3 * rot) % 12),
  }));
}
const cache = new Map<number, Feature[]>();
export function featuresOf(type: number, rot: number): Feature[] {
  const k = type * 4 + rot;
  let f = cache.get(k);
  if (!f) {
    f = rotatedFeatures(type, rot);
    cache.set(k, f);
  }
  return f;
}

export const TOTAL_TILES = TILE_TYPES.reduce((a, t) => a + t.count, 0);
