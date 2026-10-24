/**
 * Карты «Манчкина» — оригинальный набор «Подземелье Гнилого Холма» (названия, монстры и предметы придуманы
 * для этой игры; механика — общеизвестная: открыть дверь, сразиться, сбежать, подняться до 10 уровня).
 */
export type Slot = 'head' | 'body' | 'feet' | 'hands' | 'none';

/** Что происходит с проигравшим «Непотребство» монстра или с жертвой проклятия. */
export type Bad =
  | { k: 'levels'; n: number }
  | { k: 'slot'; slot: Exclude<Slot, 'none'> }
  | { k: 'items'; n: number }
  | { k: 'hand'; n: number }
  | { k: 'death' }
  | { k: 'class' }
  | { k: 'race' }
  | { k: 'big' };

export type RaceKey = 'elf' | 'dwarf' | 'halfling';
export type ClassKey = 'warrior' | 'wizard' | 'thief' | 'priest';

export type CardDef =
  | { kind: 'monster'; name: string; level: number; treasures: number; gain: number; bad: Bad; undead?: boolean; vs?: { cls: ClassKey; bonus: number } }
  | { kind: 'curse'; name: string; bad: Bad }
  | { kind: 'race'; name: string; race: RaceKey }
  | { kind: 'class'; name: string; cls: ClassKey }
  | { kind: 'enhancer'; name: string; mod: number; tmod: number }
  | { kind: 'item'; name: string; slot: Slot; bonus: number; gold: number; big?: boolean; hands?: number; run?: number }
  | { kind: 'potion'; name: string; bonus: number; gold: number }
  | { kind: 'trap'; name: string; penalty: number; gold: number }
  | { kind: 'levelup'; name: string };

export const RACE_NAMES: Record<RaceKey, string> = { elf: 'Эльф', dwarf: 'Гном', halfling: 'Полурослик' };
export const CLASS_NAMES: Record<ClassKey, string> = { warrior: 'Воин', wizard: 'Маг', thief: 'Вор', priest: 'Жрец' };

const m = (name: string, level: number, treasures: number, bad: Bad, extra: Partial<Extract<CardDef, { kind: 'monster' }>> = {}): CardDef => ({ kind: 'monster', name, level, treasures, gain: 1, bad, ...extra });

interface Entry {
  def: CardDef;
  copies: number;
}

const DOORS: Entry[] = [
  { def: m('Слизень-Попрошайка', 1, 1, { k: 'levels', n: 1 }), copies: 1 },
  { def: m('Крыса-Бухгалтер', 2, 1, { k: 'hand', n: 1 }), copies: 1 },
  { def: m('Зомби-Курьер', 2, 1, { k: 'levels', n: 1 }, { undead: true }), copies: 1 },
  { def: m('Грибной Дозорный', 3, 1, { k: 'slot', slot: 'head' }), copies: 1 },
  { def: m('Гоблин-Скандалист', 4, 1, { k: 'levels', n: 1 }), copies: 1 },
  { def: m('Скелет-Лютнист', 4, 2, { k: 'levels', n: 2 }, { undead: true }), copies: 1 },
  { def: m('Болотный Тролль-Налоговик', 6, 2, { k: 'items', n: 1 }), copies: 1 },
  { def: m('Гарпия-Сплетница', 6, 2, { k: 'hand', n: 2 }), copies: 1 },
  { def: m('Волк-Оборотень', 8, 2, { k: 'levels', n: 2 }), copies: 1 },
  { def: m('Ледяной Голем', 8, 2, { k: 'slot', slot: 'body' }), copies: 1 },
  { def: m('Огненная Саламандра', 9, 2, { k: 'levels', n: 2 }, { vs: { cls: 'wizard', bonus: 4 } }), copies: 1 },
  { def: m('Мумия-Архивариус', 10, 2, { k: 'levels', n: 3 }, { undead: true }), copies: 1 },
  { def: m('Минотавр-Лабиринтщик', 12, 3, { k: 'death' }), copies: 1 },
  { def: m('Тёмный Рыцарь', 14, 3, { k: 'death' }, { vs: { cls: 'warrior', bonus: 3 } }), copies: 1 },
  { def: m('Трёхглавая Гидра', 16, 4, { k: 'death' }), copies: 1 },
  { def: m('Дракон-Банкир', 20, 5, { k: 'death' }), copies: 1 },
  { def: m('Мимик-Сундук', 5, 2, { k: 'items', n: 1 }), copies: 1 },
  { def: m('Вампир-Лорд', 12, 3, { k: 'levels', n: 3 }, { undead: true }), copies: 1 },
  { def: m('Кикимора-Вымогатель', 3, 1, { k: 'slot', slot: 'feet' }), copies: 1 },
  { def: m('Бес-Искуситель', 7, 2, { k: 'class' }), copies: 1 },
  { def: m('Призрак-Привратник', 5, 1, { k: 'levels', n: 1 }, { undead: true }), copies: 1 },
  { def: m('Цербер-Охранник', 11, 3, { k: 'items', n: 2 }), copies: 1 },
  { def: m('Каменная Горгулья', 9, 2, { k: 'hand', n: 3 }), copies: 1 },
  { def: m('Тролль-Король', 15, 4, { k: 'death' }, { vs: { cls: 'thief', bonus: 3 } }), copies: 1 },
  { def: m('Чумная Крыса', 3, 1, { k: 'levels', n: 1 }), copies: 1 },
  { def: m('Лесной Дух', 6, 2, { k: 'race' }), copies: 1 },
  { def: m('Баньши', 9, 2, { k: 'levels', n: 2 }, { undead: true }), copies: 1 },
  { def: m('Кракен на мели', 13, 3, { k: 'levels', n: 4 }), copies: 1 },
  // исключаем «двойные» награды у самых сильных
  { def: { kind: 'curse', name: 'Проклятие Забывчивости', bad: { k: 'hand', n: 2 } }, copies: 2 },
  { def: { kind: 'curse', name: 'Проклятие Дырявых Карманов', bad: { k: 'items', n: 1 } }, copies: 1 },
  { def: { kind: 'curse', name: 'Проклятие Босых Ног', bad: { k: 'slot', slot: 'feet' } }, copies: 1 },
  { def: { kind: 'curse', name: 'Проклятие Лысины', bad: { k: 'slot', slot: 'head' } }, copies: 1 },
  { def: { kind: 'curse', name: 'Проклятие Бездарности', bad: { k: 'class' } }, copies: 1 },
  { def: { kind: 'curse', name: 'Проклятие Чужака', bad: { k: 'race' } }, copies: 1 },
  { def: { kind: 'curse', name: 'Проклятие Тяжёлой Ноши', bad: { k: 'big' } }, copies: 1 },
  { def: { kind: 'curse', name: 'Проклятие Понижения', bad: { k: 'levels', n: 1 } }, copies: 2 },
  { def: { kind: 'race', name: 'Эльф', race: 'elf' }, copies: 2 },
  { def: { kind: 'race', name: 'Гном', race: 'dwarf' }, copies: 2 },
  { def: { kind: 'race', name: 'Полурослик', race: 'halfling' }, copies: 2 },
  { def: { kind: 'class', name: 'Воин', cls: 'warrior' }, copies: 2 },
  { def: { kind: 'class', name: 'Маг', cls: 'wizard' }, copies: 2 },
  { def: { kind: 'class', name: 'Вор', cls: 'thief' }, copies: 2 },
  { def: { kind: 'class', name: 'Жрец', cls: 'priest' }, copies: 2 },
  { def: { kind: 'enhancer', name: 'Закалённый', mod: 5, tmod: 1 }, copies: 2 },
  { def: { kind: 'enhancer', name: 'Бешеный', mod: 10, tmod: 2 }, copies: 1 },
  { def: { kind: 'enhancer', name: 'Детёныш', mod: -5, tmod: -1 }, copies: 2 },
  { def: { kind: 'enhancer', name: 'Древний', mod: 10, tmod: 3 }, copies: 1 },
];

const item = (name: string, slot: Slot, bonus: number, gold: number, extra: { big?: boolean; hands?: number; run?: number } = {}): CardDef => ({ kind: 'item', name, slot, bonus, gold, ...extra });

const TREASURES: Entry[] = [
  { def: item('Котелок-шлем', 'head', 1, 200), copies: 2 },
  { def: item('Железный шлем', 'head', 2, 300), copies: 2 },
  { def: item('Рогатый шлем', 'head', 3, 400), copies: 1 },
  { def: item('Колпак мудреца', 'head', 1, 100), copies: 1 },
  { def: item('Кольчуга', 'body', 2, 300), copies: 2 },
  { def: item('Латы великана', 'body', 3, 600, { big: true }), copies: 2 },
  { def: item('Плащ-хамелеон', 'body', 1, 200), copies: 1 },
  { def: item('Кираса', 'body', 2, 400), copies: 1 },
  { def: item('Сапоги-скороходы', 'feet', 1, 400, { run: 1 }), copies: 2 },
  { def: item('Тяжёлые башмаки', 'feet', 2, 300), copies: 2 },
  { def: item('Лапти', 'feet', 1, 100), copies: 1 },
  { def: item('Короткий меч', 'hands', 2, 400, { hands: 1 }), copies: 3 },
  { def: item('Боевой топор', 'hands', 3, 500, { hands: 1 }), copies: 2 },
  { def: item('Двуручный молот', 'hands', 4, 600, { hands: 2, big: true }), copies: 2 },
  { def: item('Булава', 'hands', 1, 200, { hands: 1 }), copies: 2 },
  { def: item('Кинжал', 'hands', 1, 200, { hands: 1 }), copies: 2 },
  { def: item('Копьё', 'hands', 2, 300, { hands: 2 }), copies: 2 },
  { def: item('Арбалет', 'hands', 3, 700, { hands: 2 }), copies: 1 },
  { def: item('Щит', 'hands', 1, 200, { hands: 1 }), copies: 2 },
  { def: item('Длинный лук', 'hands', 2, 400, { hands: 2 }), copies: 1 },
  { def: item('Золотая статуэтка', 'none', 0, 500), copies: 1 },
  { def: item('Самоцвет', 'none', 0, 300), copies: 2 },
  { def: item('Кубок вождя', 'none', 0, 400), copies: 1 },
  { def: item('Старинная монета', 'none', 0, 200), copies: 2 },
  { def: item('Идол из болота', 'none', 0, 600), copies: 1 },
  { def: { kind: 'potion', name: 'Зелье Силы', bonus: 3, gold: 200 }, copies: 3 },
  { def: { kind: 'potion', name: 'Зелье Ярости', bonus: 5, gold: 300 }, copies: 2 },
  { def: { kind: 'potion', name: 'Огненная Бомба', bonus: 4, gold: 300 }, copies: 2 },
  { def: { kind: 'trap', name: 'Подножка', penalty: 2, gold: 100 }, copies: 2 },
  { def: { kind: 'trap', name: 'Верёвка-Ловушка', penalty: 3, gold: 200 }, copies: 2 },
  { def: { kind: 'trap', name: 'Зелье Слабости', penalty: 4, gold: 200 }, copies: 1 },
  { def: { kind: 'levelup', name: 'Подарок Судьбы' }, copies: 5 },
];

/** Реестр всех карт: идентификатор = индекс. Колоды содержат идентификаторы (с повторами копий). */
export const CARDS: CardDef[] = [];
export const DOOR_DECK: number[] = [];
export const TREASURE_DECK: number[] = [];
for (const [list, deck] of [[DOORS, DOOR_DECK], [TREASURES, TREASURE_DECK]] as const) {
  for (const e of list) {
    const id = CARDS.length;
    CARDS.push(e.def);
    for (let i = 0; i < e.copies; i++) deck.push(id);
  }
}

export const cardOf = (id: number) => CARDS[id]!;
export const isDoor = (id: number) => DOOR_DECK.includes(id);
/** Цена в золоте для продажи (0 — не продаётся). */
export function goldOf(id: number): number {
  const c = cardOf(id);
  return c.kind === 'item' || c.kind === 'potion' || c.kind === 'trap' ? c.gold : 0;
}
