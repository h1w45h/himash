/** Поле «Монополии» (40 клеток) и колоды карточек. Суммы в рублях. */
export type Group = 'brown' | 'lightblue' | 'pink' | 'orange' | 'red' | 'yellow' | 'green' | 'darkblue';

export type Square =
  | { kind: 'go'; name: string }
  | { kind: 'street'; name: string; group: Group; price: number; rent: [number, number, number, number, number, number]; houseCost: number }
  | { kind: 'rail'; name: string; price: number }
  | { kind: 'util'; name: string; price: number }
  | { kind: 'tax'; name: string; amount: number }
  | { kind: 'chance' | 'chest' | 'jail' | 'parking' | 'gotojail'; name: string };

const street = (name: string, group: Group, price: number, rent: [number, number, number, number, number, number], houseCost: number): Square =>
  ({ kind: 'street', name, group, price, rent, houseCost });
const rail = (name: string): Square => ({ kind: 'rail', name, price: 200 });

export const BOARD: Square[] = [
  { kind: 'go', name: 'Старт' },
  street('Житная улица', 'brown', 60, [2, 10, 30, 90, 160, 250], 50),
  { kind: 'chest', name: 'Общественная казна' },
  street('Нагатинская улица', 'brown', 60, [4, 20, 60, 180, 320, 450], 50),
  { kind: 'tax', name: 'Подоходный налог', amount: 200 },
  rail('Рижский вокзал'),
  street('Варшавское шоссе', 'lightblue', 100, [6, 30, 90, 270, 400, 550], 50),
  { kind: 'chance', name: 'Шанс' },
  street('Улица Огарёва', 'lightblue', 100, [6, 30, 90, 270, 400, 550], 50),
  street('Первая Парковая улица', 'lightblue', 120, [8, 40, 100, 300, 450, 600], 50),
  { kind: 'jail', name: 'Тюрьма / просто визит' },
  street('Улица Полянка', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  { kind: 'util', name: 'Электростанция', price: 150 },
  street('Улица Сретенка', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  street('Ростовская набережная', 'pink', 160, [12, 60, 180, 500, 700, 900], 100),
  rail('Курский вокзал'),
  street('Рязанский проспект', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  { kind: 'chest', name: 'Общественная казна' },
  street('Улица Вавилова', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  street('Рублёвское шоссе', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  { kind: 'parking', name: 'Бесплатная стоянка' },
  street('Тверская улица', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  { kind: 'chance', name: 'Шанс' },
  street('Грузинский вал', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  street('Улица Чайковского', 'red', 240, [20, 100, 300, 750, 925, 1100], 150),
  rail('Казанский вокзал'),
  street('Смоленская площадь', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  street('Улица Щусева', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  { kind: 'util', name: 'Водопровод', price: 150 },
  street('Гоголевский бульвар', 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150),
  { kind: 'gotojail', name: 'Отправляйтесь в тюрьму' },
  street('Кутузовский проспект', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  street('Улица Малая Бронная', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  { kind: 'chest', name: 'Общественная казна' },
  street('Улица Арбат', 'green', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  rail('Ленинградский вокзал'),
  { kind: 'chance', name: 'Шанс' },
  street('Площадь Маяковского', 'darkblue', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { kind: 'tax', name: 'Роскошный налог', amount: 100 },
  street('Улица Горького', 'darkblue', 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

export const GROUP_SQUARES: Record<Group, number[]> = BOARD.reduce(
  (acc, sq, i) => {
    if (sq.kind === 'street') (acc[sq.group] ??= []).push(i);
    return acc;
  },
  {} as Record<Group, number[]>,
);

export const GROUP_COLORS: Record<Group, string> = {
  brown: '#8B5A2B', lightblue: '#8FD3F4', pink: '#E86AA6', orange: '#F28C28',
  red: '#D7263D', yellow: '#F2D20F', green: '#2E9D5B', darkblue: '#2748B8',
};

export const RAILS = BOARD.flatMap((s, i) => (s.kind === 'rail' ? [i] : []));
export const UTILS = BOARD.flatMap((s, i) => (s.kind === 'util' ? [i] : []));
export const JAIL = 10;
export const GO_SALARY = 200;
export const JAIL_FINE = 50;
export const START_CASH = 1500;

export type CardDef = { text: string } & (
  | { k: 'move'; to: number }
  | { k: 'back'; by: number }
  | { k: 'nearest'; what: 'rail' | 'util' }
  | { k: 'cash'; amount: number }
  | { k: 'jail' }
  | { k: 'free' }
  | { k: 'repairs'; house: number; hotel: number }
  | { k: 'eachPay'; amount: number }
  | { k: 'eachCollect'; amount: number }
);

export const CHANCE: CardDef[] = [
  { text: 'Отправляйтесь на «Старт». Получите 200 ₽.', k: 'move', to: 0 },
  { text: 'Отправляйтесь на улицу Чайковского. Пройдя «Старт», получите 200 ₽.', k: 'move', to: 24 },
  { text: 'Отправляйтесь на улицу Полянка. Пройдя «Старт», получите 200 ₽.', k: 'move', to: 11 },
  { text: 'Ближайшая коммунальная служба: если свободна — купите, иначе заплатите 10× выпавших очков.', k: 'nearest', what: 'util' },
  { text: 'Ближайший вокзал: если свободен — купите, иначе заплатите двойную аренду.', k: 'nearest', what: 'rail' },
  { text: 'Ближайший вокзал: если свободен — купите, иначе заплатите двойную аренду.', k: 'nearest', what: 'rail' },
  { text: 'Банк выплачивает вам дивиденды 50 ₽.', k: 'cash', amount: 50 },
  { text: 'Карточка «Освобождение из тюрьмы». Можно сохранить.', k: 'free' },
  { text: 'Вернитесь на три клетки назад.', k: 'back', by: 3 },
  { text: 'Отправляйтесь в тюрьму. Не проходите «Старт».', k: 'jail' },
  { text: 'Капитальный ремонт: 25 ₽ за дом и 100 ₽ за отель.', k: 'repairs', house: 25, hotel: 100 },
  { text: 'Штраф за превышение скорости: 15 ₽.', k: 'cash', amount: -15 },
  { text: 'Поездка на Рижский вокзал. Пройдя «Старт», получите 200 ₽.', k: 'move', to: 5 },
  { text: 'Отправляйтесь на улицу Горького.', k: 'move', to: 39 },
  { text: 'Вас избрали председателем совета: заплатите каждому игроку по 50 ₽.', k: 'eachPay', amount: 50 },
  { text: 'Срок строительного кредита истёк: получите 150 ₽.', k: 'cash', amount: 150 },
];

export const CHEST: CardDef[] = [
  { text: 'Отправляйтесь на «Старт». Получите 200 ₽.', k: 'move', to: 0 },
  { text: 'Банковская ошибка в вашу пользу: получите 200 ₽.', k: 'cash', amount: 200 },
  { text: 'Плата за визит к врачу: 50 ₽.', k: 'cash', amount: -50 },
  { text: 'Вы продали акции: получите 50 ₽.', k: 'cash', amount: 50 },
  { text: 'Карточка «Освобождение из тюрьмы». Можно сохранить.', k: 'free' },
  { text: 'Отправляйтесь в тюрьму. Не проходите «Старт».', k: 'jail' },
  { text: 'Гала-вечер в театре: получите по 50 ₽ с каждого игрока.', k: 'eachCollect', amount: 50 },
  { text: 'Праздничный фонд выплачен: получите 100 ₽.', k: 'cash', amount: 100 },
  { text: 'Возврат подоходного налога: получите 20 ₽.', k: 'cash', amount: 20 },
  { text: 'День рождения: получите по 10 ₽ с каждого игрока.', k: 'eachCollect', amount: 10 },
  { text: 'Страховка по жизни выплачена: получите 100 ₽.', k: 'cash', amount: 100 },
  { text: 'Оплатите больничные расходы: 100 ₽.', k: 'cash', amount: -100 },
  { text: 'Оплатите школьные сборы: 50 ₽.', k: 'cash', amount: -50 },
  { text: 'Гонорар за консультацию: получите 25 ₽.', k: 'cash', amount: 25 },
  { text: 'Ремонт улиц: 40 ₽ за дом и 115 ₽ за отель.', k: 'repairs', house: 40, hotel: 115 },
  { text: 'Вы заняли второе место на конкурсе красоты: получите 10 ₽.', k: 'cash', amount: 10 },
];
