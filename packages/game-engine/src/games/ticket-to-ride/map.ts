/**
 * Карта «Россия (схема)»: 20 городов и сеть маршрутов. Цвета: 0–7 — цвета вагонов, 8 — любой (серый).
 * Координаты (x, y) в процентах нужны интерфейсу.
 */
export const CAR_COLORS = ['красный', 'синий', 'зелёный', 'жёлтый', 'чёрный', 'белый', 'оранжевый', 'розовый'] as const;
export const COLOR_HEX = ['#D7263D', '#2B59C3', '#2E9D5B', '#F2B705', '#2B2622', '#F4F1E8', '#F28C28', '#E86AA6', '#9AA0A6', '#6A5ACD'] as const;
export const ANY = 8;
export const LOCO = 8; // индекс «локомотива» в руке (9 типов карт: 0–7 цвета + 8 локомотив)

export interface City {
  name: string;
  x: number;
  y: number;
}
export interface Route {
  a: number;
  b: number;
  length: number;
  color: number; // 0–7 или ANY
  /** Номер «двойника»: у параллельных маршрутов один и тот же набор городов. */
  twin?: number;
}

export const CITIES: City[] = [
  { name: 'Мурманск', x: 30, y: 6 }, { name: 'Архангельск', x: 56, y: 8 }, { name: 'Санкт-Петербург', x: 20, y: 22 },
  { name: 'Вологда', x: 40, y: 24 }, { name: 'Москва', x: 34, y: 40 }, { name: 'Нижний Новгород', x: 52, y: 38 },
  { name: 'Киров', x: 66, y: 26 }, { name: 'Казань', x: 62, y: 46 }, { name: 'Екатеринбург', x: 82, y: 32 },
  { name: 'Тюмень', x: 92, y: 22 }, { name: 'Челябинск', x: 84, y: 48 }, { name: 'Самара', x: 66, y: 60 },
  { name: 'Воронеж', x: 30, y: 58 }, { name: 'Ростов-на-Дону', x: 34, y: 76 }, { name: 'Краснодар', x: 22, y: 90 },
  { name: 'Волгоград', x: 52, y: 72 }, { name: 'Астрахань', x: 64, y: 86 }, { name: 'Уфа', x: 74, y: 56 },
  { name: 'Омск', x: 97, y: 38 }, { name: 'Смоленск', x: 12, y: 42 },
];

const r = (a: number, b: number, length: number, color: number): Route => ({ a, b, length, color });

const base: Route[] = [
  r(0, 2, 4, 1), r(0, 1, 5, 5), r(1, 3, 3, ANY), r(1, 6, 4, 0), r(2, 3, 3, 2), r(2, 19, 4, ANY), r(2, 4, 5, 5),
  r(3, 4, 3, 0), r(3, 5, 3, 1), r(3, 6, 3, 3), r(19, 4, 3, 4), r(19, 12, 4, 2), r(4, 12, 3, ANY), r(4, 5, 3, 5),
  r(5, 6, 3, 2), r(5, 7, 2, ANY), r(6, 8, 4, 5), r(6, 7, 3, 4), r(7, 17, 3, 1), r(7, 11, 3, 3), r(5, 11, 4, 0),
  r(12, 13, 3, ANY), r(12, 15, 4, 3), r(13, 15, 3, 5), r(13, 14, 2, ANY), r(15, 11, 3, 6), r(15, 16, 2, ANY),
  r(13, 16, 4, 7), r(16, 11, 5, 2), r(11, 17, 2, ANY), r(17, 10, 3, 0), r(17, 8, 3, 2), r(10, 8, 2, ANY), r(8, 9, 3, 1),
  r(9, 18, 3, ANY), r(8, 18, 4, 4), r(10, 18, 4, 5), r(12, 5, 4, 4), r(7, 8, 4, ANY), r(6, 9, 5, 6), r(14, 15, 5, 1),
];
/** Параллельные маршруты (для 4–5 игроков): второй цвет на тех же городах. */
const doubles: Route[] = [
  { ...r(2, 3, 3, 3), twin: 4 }, { ...r(2, 4, 5, 0), twin: 6 }, { ...r(12, 13, 3, 1), twin: 21 }, { ...r(13, 14, 2, 4), twin: 24 }, { ...r(3, 4, 3, 7), twin: 7 },
];

export const ROUTES: Route[] = [...base, ...doubles];
// Связываем двойников (индекс первого маршрута с теми же городами).
for (const d of doubles) {
  const i = ROUTES.indexOf(d);
  const j = base.findIndex((b) => b.a === d.a && b.b === d.b);
  d.twin = j;
  base[j]!.twin = i;
}
export const ROUTE_POINTS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15 };

/** Кратчайшие расстояния (в вагонах) между городами — для генерации и оценки билетов. */
export function distances(): number[][] {
  const n = CITIES.length;
  const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
  for (const rt of ROUTES) {
    d[rt.a]![rt.b] = Math.min(d[rt.a]![rt.b]!, rt.length);
    d[rt.b]![rt.a] = Math.min(d[rt.b]![rt.a]!, rt.length);
  }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (d[i]![k]! + d[k]![j]! < d[i]![j]!) d[i]![j] = d[i]![k]! + d[k]![j]!;
  return d;
}

export interface Ticket {
  a: number;
  b: number;
  points: number;
}

/** Билеты: пары достаточно далёких городов, стоимость растёт с расстоянием. */
export function makeTickets(): Ticket[] {
  const d = distances();
  const out: Ticket[] = [];
  for (let a = 0; a < CITIES.length; a++) {
    for (let b = a + 1; b < CITIES.length; b++) {
      const dist = d[a]![b]!;
      if (dist >= 8 && dist <= 22) out.push({ a, b, points: Math.round(dist * 1.1 + 2) });
    }
  }
  return out;
}
export const TICKETS: Ticket[] = makeTickets();
