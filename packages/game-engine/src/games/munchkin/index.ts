import { createRng } from '../../core/rng';
import { fail, ok, type BotContext, type GameDefinition, type Outcome, type Result, type Seat } from '../../core/types';
import { CARDS, DOOR_DECK, TREASURE_DECK, cardOf, goldOf, type Bad, type ClassKey, type RaceKey } from './cards';

export * from './cards';

/**
 * Манчкин, 3–6 игроков. Ход: открыть дверь → сразиться с монстром (с помощью других игроков за долю сокровищ)
 * или сбежать → добор сокровищ, милосердие при лишних картах. Побеждает первый, достигший 10 уровня, убив монстра.
 * Другие игроки могут вмешиваться: усиливать монстра или мешать герою ловушками. Смерть — потеря предметов,
 * расы и класса (уровень сохраняется), на следующем ходу — свежая раздача 4+4.
 * Карты — оригинальные (см. cards.ts).
 */
export const MAX_LEVEL = 10;
export const HAND_LIMIT = 5;
const FLEE_TARGET = 5;
const MAX_TURNS = 400;

export interface Owned {
  c: number;
  eq: boolean;
}
export interface Hero {
  level: number;
  hand: number[];
  items: Owned[];
  /** Карта расы / класса в игре (−1 — нет). */
  race: number;
  cls: number;
  dead: boolean;
}

export type Stage = 'combat' | 'invite' | 'interfere' | 'run';
export interface Fight {
  hero: Seat;
  monsters: { c: number; mod: number; tmod: number }[];
  helper: Seat;
  /** Сколько сокровищ обещано помощнику. */
  reward: number;
  bonus: number;
  penalty: number;
  berserk: number;
  backstab: boolean;
  declined: Seat[];
  stage: Stage;
  inviteTo: Seat;
  queue: Seat[];
  /** Последний результат броска на побег. */
  roll: number | null;
}

export type Step = 'kick' | 'fight' | 'after' | 'wrap' | 'charity' | 'over';

export interface MunchState {
  players: number;
  rng: number;
  heroes: Hero[];
  door: number[];
  doorDiscard: number[];
  treasure: number[];
  treasureDiscard: number[];
  turn: Seat;
  step: Step;
  fight: Fight | null;
  /** Был ли бой/добор в этом ходу (для «Посмотреть, что в комнате»). */
  winner: number | null;
  turnCount: number;
  log: string[];
  limitReached: boolean;
}

export type MunchAction =
  | { t: 'kick' }
  | { t: 'loot' }
  | { t: 'trouble'; c: number }
  | { t: 'end' }
  | { t: 'equip'; c: number }
  | { t: 'unequip'; c: number }
  | { t: 'race'; c: number }
  | { t: 'cls'; c: number }
  | { t: 'levelup'; c: number }
  | { t: 'curse'; c: number; target: Seat }
  | { t: 'sell'; items: number[] }
  | { t: 'potion'; c: number }
  | { t: 'berserk'; cards: number[] }
  | { t: 'invite'; to: Seat; treasures: number }
  | { t: 'fight' }
  | { t: 'flee' }
  | { t: 'flight'; cards: number[] }
  | { t: 'accept' }
  | { t: 'decline' }
  | { t: 'enhance'; c: number }
  | { t: 'hinder'; c: number }
  | { t: 'backstab'; c: number }
  | { t: 'pass' }
  | { t: 'charity'; cards: number[] };

export interface MunchView extends Omit<MunchState, 'door' | 'doorDiscard' | 'treasure' | 'treasureDiscard' | 'rng' | 'heroes'> {
  heroes: (Omit<Hero, 'hand'> & { hand: number[] | null; handCount: number; power: number })[];
  doorCount: number;
  treasureCount: number;
  finished: boolean;
  /** Сила героя в бою и сила монстров (для показа). */
  heroSide: number | null;
  monsterSide: number | null;
}

const clone = (s: MunchState): MunchState => JSON.parse(JSON.stringify(s)) as MunchState;
const name = (seat: Seat) => `Игрок ${seat + 1}`;
const log = (s: MunchState, t: string) => {
  s.log.push(t);
  if (s.log.length > 14) s.log.shift();
};
const removeOne = (arr: number[], c: number) => {
  const i = arr.indexOf(c);
  if (i >= 0) arr.splice(i, 1);
  return i >= 0;
};

// ───────── колоды ─────────

function draw(s: MunchState, kind: 'door' | 'treasure'): number | null {
  const deck = kind === 'door' ? s.door : s.treasure;
  const discard = kind === 'door' ? s.doorDiscard : s.treasureDiscard;
  if (deck.length === 0 && discard.length > 0) {
    const rng = createRng(s.rng);
    deck.push(...rng.shuffle(discard));
    discard.length = 0;
    s.rng = rng.state;
  }
  return deck.pop() ?? null;
}
function discard(s: MunchState, c: number) {
  (DOOR_DECK.includes(c) ? s.doorDiscard : s.treasureDiscard).push(c);
}
const drawTo = (s: MunchState, p: Seat, kind: 'door' | 'treasure', n: number) => {
  for (let i = 0; i < n; i++) {
    const c = draw(s, kind);
    if (c !== null) s.heroes[p]!.hand.push(c);
  }
};

// ───────── сила и снаряжение ─────────

const raceOf = (s: MunchState, p: Seat): RaceKey | null => {
  const c = s.heroes[p]!.race;
  return c >= 0 ? (cardOf(c) as { race: RaceKey }).race : null;
};
const classOf = (s: MunchState, p: Seat): ClassKey | null => {
  const c = s.heroes[p]!.cls;
  return c >= 0 ? (cardOf(c) as { cls: ClassKey }).cls : null;
};
export const handLimit = (s: MunchState, p: Seat) => (raceOf(s, p) === 'dwarf' ? HAND_LIMIT + 1 : HAND_LIMIT);

const itemDef = (o: Owned) => cardOf(o.c) as Extract<ReturnType<typeof cardOf>, { kind: 'item' }>;
export function gearBonus(s: MunchState, p: Seat): number {
  return s.heroes[p]!.items.reduce((a, o) => a + (o.eq ? itemDef(o).bonus : 0), 0);
}
export const heroPower = (s: MunchState, p: Seat) => s.heroes[p]!.level + gearBonus(s, p);
const runBonus = (s: MunchState, p: Seat) =>
  s.heroes[p]!.items.reduce((a, o) => a + (o.eq ? itemDef(o).run ?? 0 : 0), 0) + (classOf(s, p) === 'thief' ? 1 : 0) + (raceOf(s, p) === 'elf' ? 1 : 0);

export function monsterPower(s: MunchState, f: Fight): number {
  let total = 0;
  for (const m of f.monsters) {
    const def = cardOf(m.c) as Extract<ReturnType<typeof cardOf>, { kind: 'monster' }>;
    let v = Math.max(1, def.level + m.mod);
    for (const p of [f.hero, f.helper]) if (p >= 0 && def.vs && classOf(s, p) === def.vs.cls) v += def.vs.bonus;
    total += v;
  }
  return total;
}
export function sidePower(s: MunchState, f: Fight): number {
  let v = heroPower(s, f.hero) + f.bonus - f.penalty;
  if (f.helper >= 0) v += heroPower(s, f.helper);
  // Жрец изгоняет нежить
  const undead = f.monsters.some((m) => (cardOf(m.c) as { undead?: boolean }).undead);
  if (undead) for (const p of [f.hero, f.helper]) if (p >= 0 && classOf(s, p) === 'priest') v += 3;
  return v;
}
const heroWins = (s: MunchState, f: Fight) => {
  const mine = sidePower(s, f);
  const theirs = monsterPower(s, f);
  return mine > theirs || (mine === theirs && [f.hero, f.helper].some((p) => p >= 0 && classOf(s, p) === 'warrior'));
};

function equip(s: MunchState, p: Seat, c: number) {
  const h = s.heroes[p]!;
  let o: Owned | undefined;
  // предмет из руки выкладывается на стол (приоритет над такой же картой на столе)
  if (h.hand.includes(c) && (cardOf(c) as { slot: string }).slot !== 'none') {
    removeOne(h.hand, c);
    o = { c, eq: false };
    h.items.push(o);
  } else o = h.items.find((x) => x.c === c && !x.eq);
  if (!o) return;
  const d = itemDef(o);
  // освобождаем конфликтующие предметы
  const eqd = h.items.filter((x) => x.eq);
  if (d.slot === 'hands') {
    let used = eqd.filter((x) => itemDef(x).slot === 'hands').reduce((a, x) => a + (itemDef(x).hands ?? 1), 0);
    for (const x of eqd.filter((y) => itemDef(y).slot === 'hands').sort((a, b) => itemDef(a).bonus - itemDef(b).bonus)) {
      if (used + (d.hands ?? 1) <= 2) break;
      x.eq = false;
      used -= itemDef(x).hands ?? 1;
    }
  } else if (d.slot !== 'none') for (const x of eqd) if (itemDef(x).slot === d.slot) x.eq = false;
  if (d.big && raceOf(s, p) !== 'dwarf') for (const x of h.items) if (x.eq && itemDef(x).big) x.eq = false;
  o.eq = true;
}
/** Допустима ли «одежда» в слот (учитывая, что конфликты снимутся автоматически). */
const canEquip = (s: MunchState, p: Seat, c: number) => {
  const o = s.heroes[p]!.items.find((x) => x.c === c && !x.eq);
  return !!o && itemDef(o).slot !== 'none';
};

function dropItem(s: MunchState, p: Seat, o: Owned) {
  const h = s.heroes[p]!;
  const i = h.items.indexOf(o);
  if (i >= 0) {
    h.items.splice(i, 1);
    discard(s, o.c);
  }
}

// ───────── плохие последствия ─────────

function applyBad(s: MunchState, p: Seat, bad: Bad, source: string) {
  const h = s.heroes[p]!;
  switch (bad.k) {
    case 'levels':
      h.level = Math.max(1, h.level - bad.n);
      log(s, `${source}: ${name(p)} теряет ${bad.n} ур. (теперь ${h.level}).`);
      break;
    case 'slot': {
      const cands = h.items.filter((o) => itemDef(o).slot === bad.slot).sort((a, b) => itemDef(b).bonus - itemDef(a).bonus);
      if (cands[0]) {
        log(s, `${source}: ${name(p)} теряет «${itemDef(cands[0]).name}».`);
        dropItem(s, p, cands[0]);
      } else log(s, `${source}: терять нечего.`);
      break;
    }
    case 'big': {
      const big = h.items.find((o) => itemDef(o).big);
      if (big) {
        log(s, `${source}: ${name(p)} теряет «${itemDef(big).name}».`);
        dropItem(s, p, big);
      }
      break;
    }
    case 'items': {
      for (let i = 0; i < bad.n; i++) {
        const best = [...h.items].sort((a, b) => itemDef(b).bonus * 1000 + itemDef(b).gold - (itemDef(a).bonus * 1000 + itemDef(a).gold))[0];
        if (!best) break;
        log(s, `${source}: ${name(p)} теряет «${itemDef(best).name}».`);
        dropItem(s, p, best);
      }
      break;
    }
    case 'hand': {
      const rng = createRng(s.rng);
      for (let i = 0; i < bad.n && h.hand.length > 0; i++) discard(s, h.hand.splice(rng.int(h.hand.length), 1)[0]!);
      s.rng = rng.state;
      log(s, `${source}: ${name(p)} теряет карты из руки.`);
      break;
    }
    case 'class':
      if (h.cls >= 0) {
        discard(s, h.cls);
        h.cls = -1;
        log(s, `${source}: ${name(p)} теряет класс.`);
      }
      break;
    case 'race':
      if (h.race >= 0) {
        discard(s, h.race);
        h.race = -1;
        log(s, `${source}: ${name(p)} теряет расу.`);
      }
      break;
    case 'death': {
      for (const o of h.items) discard(s, o.c);
      h.items = [];
      for (const c of h.hand) discard(s, c);
      h.hand = [];
      if (h.cls >= 0) discard(s, h.cls);
      if (h.race >= 0) discard(s, h.race);
      h.cls = -1;
      h.race = -1;
      h.dead = true;
      log(s, `${source}: ${name(p)} погибает! Все вещи потеряны (уровень сохраняется).`);
      break;
    }
  }
}

// ───────── ход и бой ─────────

function nextTurn(s: MunchState) {
  s.turnCount++;
  s.fight = null;
  if (s.turnCount >= MAX_TURNS) {
    s.step = 'over';
    s.limitReached = true;
    log(s, 'Лимит ходов: побеждает самый высокий уровень.');
    return;
  }
  s.turn = (s.turn + 1) % s.players;
  s.step = 'kick';
  const h = s.heroes[s.turn]!;
  if (h.dead) {
    h.dead = false;
    drawTo(s, s.turn, 'door', 4);
    drawTo(s, s.turn, 'treasure', 4);
    log(s, `${name(s.turn)} возвращается новым героем и получает 4+4 карты.`);
  }
}

function startFight(s: MunchState, hero: Seat, monsters: number[]) {
  s.step = 'fight';
  s.fight = {
    hero,
    monsters: monsters.map((c) => ({ c, mod: 0, tmod: 0 })),
    helper: -1,
    reward: 0,
    bonus: 0,
    penalty: 0,
    berserk: 0,
    backstab: false,
    declined: [],
    stage: 'combat',
    inviteTo: -1,
    queue: [],
    roll: null,
  };
  log(s, `${name(hero)} сражается с «${monsters.map((c) => cardOf(c).name).join(', ')}» (${monsterPower(s, s.fight)}).`);
}

const treasureCount = (f: Fight) => Math.max(0, f.monsters.reduce((a, m) => a + (cardOf(m.c) as { treasures: number }).treasures + m.tmod, 0));

function afterFight(s: MunchState) {
  // герои, умершие в бою, в charity не участвуют
  s.fight = null;
  s.step = 'wrap';
}

function victory(s: MunchState) {
  const f = s.fight!;
  const gain = f.monsters.reduce((a, m) => a + (cardOf(m.c) as { gain: number }).gain, 0);
  const t = treasureCount(f);
  const hero = s.heroes[f.hero]!;
  hero.level += gain;
  log(s, `${name(f.hero)} побеждает! +${gain} ур. (теперь ${hero.level}), сокровищ: ${t}.`);
  if (f.helper >= 0) {
    drawTo(s, f.helper, 'treasure', Math.min(f.reward, t));
    if (raceOf(s, f.helper) === 'elf') {
      s.heroes[f.helper]!.level = Math.min(MAX_LEVEL - 1, s.heroes[f.helper]!.level + 1);
      log(s, `Эльф ${name(f.helper)} получает уровень за помощь.`);
    }
    drawTo(s, f.hero, 'treasure', Math.max(0, t - f.reward));
  } else drawTo(s, f.hero, 'treasure', t);
  for (const m of f.monsters) discard(s, m.c);
  if (hero.level >= MAX_LEVEL) {
    hero.level = MAX_LEVEL;
    s.winner = f.hero;
    s.step = 'over';
    s.fight = null;
    log(s, `${name(f.hero)} достигает 10 уровня и побеждает!`);
    return;
  }
  afterFight(s);
}

function runAway(s: MunchState, auto: boolean) {
  const f = s.fight!;
  const h = f.hero;
  const failed: number[] = [];
  const rng = createRng(s.rng);
  for (const m of f.monsters) {
    if (auto) continue;
    const roll = rng.int(6) + 1;
    f.roll = roll;
    const total = roll + runBonus(s, h);
    if (total >= FLEE_TARGET) log(s, `${name(h)} убегает от «${cardOf(m.c).name}» (бросок ${roll}${runBonus(s, h) ? `+${runBonus(s, h)}` : ''}).`);
    else {
      failed.push(m.c);
      log(s, `${name(h)} не смог убежать от «${cardOf(m.c).name}» (бросок ${roll}).`);
    }
  }
  s.rng = rng.state;
  for (const c of failed) {
    const def = cardOf(c) as { bad: Bad; name: string };
    applyBad(s, h, def.bad, def.name);
    if (s.heroes[h]!.dead) break;
  }
  for (const m of f.monsters) discard(s, m.c);
  afterFight(s);
}

// ───────── определение игры ─────────

const hasKind = (s: MunchState, p: Seat, kind: string) => s.heroes[p]!.hand.filter((c) => cardOf(c).kind === kind);

export const munchkinGame: GameDefinition<MunchState, MunchAction, MunchView> = {
  slug: 'munchkin',
  minPlayers: 3,
  maxPlayers: 6,

  setup: ({ players, seed }) => {
    const rng = createRng(seed);
    const s: MunchState = {
      players,
      rng: 0,
      heroes: Array.from({ length: players }, () => ({ level: 1, hand: [], items: [], race: -1, cls: -1, dead: false })),
      door: rng.shuffle(DOOR_DECK),
      doorDiscard: [],
      treasure: rng.shuffle(TREASURE_DECK),
      treasureDiscard: [],
      turn: 0,
      step: 'kick',
      fight: null,
      winner: null,
      turnCount: 0,
      log: ['Игра началась: у каждого по 4 двери и 4 сокровища. Выложите расу, класс и снаряжение, затем «Открыть дверь».'],
      limitReached: false,
    };
    s.rng = rng.state;
    for (let p = 0; p < players; p++) {
      drawTo(s, p, 'door', 4);
      drawTo(s, p, 'treasure', 4);
    }
    return s;
  },

  currentSeats: (s) => {
    if (s.step === 'over') return [];
    if (s.step === 'fight' && s.fight) {
      const f = s.fight;
      if (f.stage === 'invite') return [f.inviteTo];
      if (f.stage === 'interfere') return [f.queue[0]!];
      return [f.hero];
    }
    return [s.turn];
  },

  legalActions: (s, seat) => {
    const out: MunchAction[] = [];
    if (s.step === 'over') return out;
    const h = s.heroes[seat]!;
    const f = s.fight;

    // Вмешательство и приглашения — действия не только активного игрока
    if (s.step === 'fight' && f) {
      if (f.stage === 'invite') {
        if (seat === f.inviteTo) out.push({ t: 'accept' }, { t: 'decline' });
        return out;
      }
      if (f.stage === 'interfere') {
        if (seat !== f.queue[0]) return out;
        for (const c of new Set(h.hand)) {
          const d = cardOf(c);
          if (d.kind === 'enhancer') out.push({ t: 'enhance', c });
          if (d.kind === 'trap') out.push({ t: 'hinder', c });
        }
        if (classOf(s, seat) === 'thief' && !f.backstab) for (const c of new Set(h.hand)) out.push({ t: 'backstab', c });
        out.push({ t: 'pass' });
        return out;
      }
      if (seat !== f.hero) return out;
      if (f.stage === 'run') {
        out.push({ t: 'flee' });
        if (classOf(s, seat) === 'wizard' && h.hand.length > 0) out.push({ t: 'flight', cards: h.hand.slice(0, Math.min(3, h.hand.length)) });
        return out;
      }
      // стадия боя
      for (const c of new Set(h.hand)) if (cardOf(c).kind === 'potion') out.push({ t: 'potion', c });
      if (classOf(s, seat) === 'warrior' && f.berserk < 3 && h.hand.length > 0) out.push({ t: 'berserk', cards: [h.hand[0]!] });
      if (f.helper < 0) {
        const t = treasureCount(f);
        for (let p = 0; p < s.players; p++) {
          if (p === seat || f.declined.includes(p)) continue;
          for (let r = 0; r <= t; r++) out.push({ t: 'invite', to: p, treasures: r });
        }
      }
      out.push({ t: 'fight' });
      return out;
    }

    if (seat !== s.turn) return out;

    if (s.step === 'charity') {
      const n = h.hand.length - handLimit(s, seat);
      if (n > 0) out.push({ t: 'charity', cards: [...h.hand].sort((a, b) => goldOf(a) - goldOf(b) || a - b).slice(0, n) });
      return out;
    }

    // Свободные действия вне боя
    for (const o of h.items) if (!o.eq && canEquip(s, seat, o.c) && !out.some((a) => a.t === 'equip' && a.c === o.c)) out.push({ t: 'equip', c: o.c });
    for (const o of h.items) if (o.eq && !out.some((a) => a.t === 'unequip' && a.c === o.c)) out.push({ t: 'unequip', c: o.c });
    for (const c of new Set(h.hand)) {
      const d = cardOf(c);
      if (d.kind === 'item' && d.slot !== 'none' && !out.some((a) => a.t === 'equip' && a.c === c)) out.push({ t: 'equip', c });
      if (d.kind === 'race') out.push({ t: 'race', c });
      if (d.kind === 'class') out.push({ t: 'cls', c });
      if (d.kind === 'levelup' && h.level < MAX_LEVEL - 1) out.push({ t: 'levelup', c });
      if (d.kind === 'curse') for (let p = 0; p < s.players; p++) if (p !== seat) out.push({ t: 'curse', c, target: p });
    }
    if (s.step === 'kick') out.push({ t: 'kick' });
    if (s.step === 'after') {
      out.push({ t: 'loot' });
      for (const c of new Set(hasKind(s, seat, 'monster'))) out.push({ t: 'trouble', c });
    }
    if (s.step === 'wrap') out.push({ t: 'end' });
    return out;
  },

  validate: (s, seat, a): Result => {
    if (s.step === 'over') return fail('Игра окончена');
    if (!munchkinGame.currentSeats(s).includes(seat)) return fail('Сейчас не ваш ход');
    const h = s.heroes[seat]!;
    const f = s.fight;
    switch (a.t) {
      case 'sell': {
        if (seat !== s.turn || (s.step !== 'kick' && s.step !== 'after' && s.step !== 'wrap')) return fail('Сейчас нельзя продавать');
        if (a.items.length === 0) return fail('Выберите предметы');
        const pool = [...h.items.map((o) => o.c), ...h.hand];
        const tmp = [...pool];
        for (const c of a.items) {
          const i = tmp.indexOf(c);
          if (i < 0 || goldOf(c) === 0) return fail('Нельзя продать эту карту');
          tmp.splice(i, 1);
        }
        const gold = a.items.reduce((x, c) => x + goldOf(c), 0);
        if (gold < 1000) return fail('Нужно минимум 1000 золотых');
        if (h.level >= MAX_LEVEL - 1) return fail('Продажей нельзя достичь 10 уровня');
        return ok(undefined);
      }
      case 'berserk': {
        if (!f || f.stage !== 'combat' || seat !== f.hero || classOf(s, seat) !== 'warrior') return fail('Недоступно');
        if (a.cards.length < 1 || f.berserk + a.cards.length > 3) return fail('Не больше 3 карт за бой');
        const tmp = [...h.hand];
        for (const c of a.cards) {
          const i = tmp.indexOf(c);
          if (i < 0) return fail('Нет такой карты');
          tmp.splice(i, 1);
        }
        return ok(undefined);
      }
      case 'flight': {
        if (!f || f.stage !== 'run' || classOf(s, seat) !== 'wizard') return fail('Недоступно');
        if (a.cards.length < 1 || a.cards.length > 3) return fail('Сбросьте от 1 до 3 карт');
        const tmp = [...h.hand];
        for (const c of a.cards) {
          const i = tmp.indexOf(c);
          if (i < 0) return fail('Нет такой карты');
          tmp.splice(i, 1);
        }
        return ok(undefined);
      }
      case 'charity': {
        if (s.step !== 'charity') return fail('Сейчас не нужно');
        const need = h.hand.length - handLimit(s, seat);
        const tmp = [...h.hand];
        if (a.cards.length !== need) return fail(`Нужно отдать ровно ${need}`);
        for (const c of a.cards) {
          const i = tmp.indexOf(c);
          if (i < 0) return fail('Нет такой карты');
          tmp.splice(i, 1);
        }
        return ok(undefined);
      }
      case 'invite':
        if (!f || f.stage !== 'combat' || f.helper >= 0) return fail('Нельзя пригласить');
        if (a.to === seat || a.to < 0 || a.to >= s.players || f.declined.includes(a.to)) return fail('Нельзя пригласить этого игрока');
        if (a.treasures < 0 || a.treasures > treasureCount(f)) return fail('Слишком большая награда');
        return ok(undefined);
      case 'backstab':
        if (!f || f.stage !== 'interfere' || classOf(s, seat) !== 'thief' || f.backstab) return fail('Недоступно');
        return h.hand.includes(a.c) ? ok(undefined) : fail('Нет такой карты');
      default:
        return munchkinGame.legalActions(s, seat).some((x) => JSON.stringify(x) === JSON.stringify(a)) ? ok(undefined) : fail('Недопустимое действие');
    }
  },

  apply: (prev, seat, a) => {
    const s = clone(prev);
    const h = s.heroes[seat]!;
    const f = s.fight;
    switch (a.t) {
      case 'equip':
        equip(s, seat, a.c);
        break;
      case 'unequip': {
        const o = h.items.find((x) => x.c === a.c && x.eq);
        if (o) o.eq = false;
        break;
      }
      case 'race':
        removeOne(h.hand, a.c);
        if (h.race >= 0) discard(s, h.race);
        h.race = a.c;
        log(s, `${name(seat)} становится расой «${cardOf(a.c).name}».`);
        break;
      case 'cls':
        removeOne(h.hand, a.c);
        if (h.cls >= 0) discard(s, h.cls);
        h.cls = a.c;
        log(s, `${name(seat)} выбирает класс «${cardOf(a.c).name}».`);
        break;
      case 'levelup':
        removeOne(h.hand, a.c);
        discard(s, a.c);
        h.level++;
        log(s, `${name(seat)} получает уровень (${h.level}).`);
        break;
      case 'curse': {
        removeOne(h.hand, a.c);
        discard(s, a.c);
        const def = cardOf(a.c) as { name: string; bad: Bad };
        log(s, `${name(seat)} накладывает «${def.name}» на ${name(a.target)}.`);
        applyBad(s, a.target, def.bad, def.name);
        break;
      }
      case 'sell': {
        const gold = a.items.reduce((x, c) => x + goldOf(c), 0);
        for (const c of a.items) {
          const i = h.items.findIndex((o) => o.c === c);
          if (i >= 0) h.items.splice(i, 1);
          else removeOne(h.hand, c);
          discard(s, c);
        }
        const lv = Math.min(Math.floor(gold / 1000), MAX_LEVEL - 1 - h.level);
        h.level += lv;
        log(s, `${name(seat)} продаёт вещи на ${gold} золотых и получает ${lv} ур. (${h.level}).`);
        break;
      }
      case 'kick': {
        const c = draw(s, 'door');
        if (c === null) {
          s.step = 'after';
          break;
        }
        const d = cardOf(c);
        if (d.kind === 'monster') {
          startFight(s, seat, [c]);
        } else if (d.kind === 'curse') {
          log(s, `${name(seat)} открывает «${d.name}»!`);
          discard(s, c);
          applyBad(s, seat, d.bad, d.name);
          s.step = 'after';
          if (s.heroes[seat]!.dead) nextTurn(s);
        } else {
          log(s, `${name(seat)} открывает «${d.name}» и берёт в руку.`);
          h.hand.push(c);
          s.step = 'after';
        }
        break;
      }
      case 'loot': {
        drawTo(s, seat, 'door', 1);
        log(s, `${name(seat)} обыскивает комнату.`);
        s.step = 'wrap';
        break;
      }
      case 'trouble':
        removeOne(h.hand, a.c);
        startFight(s, seat, [a.c]);
        break;
      case 'end':
        s.step = h.hand.length > handLimit(s, seat) ? 'charity' : 'kick';
        if (s.step === 'kick') nextTurn(s);
        break;
      case 'charity': {
        const lowest = Math.min(...s.heroes.map((x, p) => (p === seat ? 99 : x.level)));
        const takers = s.heroes.map((x, p) => (p !== seat && x.level === lowest && x.level < h.level ? p : -1)).filter((p) => p >= 0);
        a.cards.forEach((c, i) => {
          removeOne(h.hand, c);
          if (takers.length) s.heroes[takers[i % takers.length]!]!.hand.push(c);
          else discard(s, c);
        });
        log(s, takers.length ? `${name(seat)} отдаёт лишние карты слабейшему.` : `${name(seat)} сбрасывает лишние карты.`);
        nextTurn(s);
        break;
      }
      case 'potion': {
        removeOne(h.hand, a.c);
        discard(s, a.c);
        const d = cardOf(a.c) as { bonus: number; name: string };
        f!.bonus += d.bonus;
        log(s, `${name(seat)} использует «${d.name}» (+${d.bonus}).`);
        break;
      }
      case 'berserk':
        for (const c of a.cards) {
          removeOne(h.hand, c);
          discard(s, c);
        }
        f!.berserk += a.cards.length;
        f!.bonus += a.cards.length;
        log(s, `${name(seat)} впадает в ярость: +${a.cards.length}.`);
        break;
      case 'invite':
        f!.stage = 'invite';
        f!.inviteTo = a.to;
        f!.reward = a.treasures;
        log(s, `${name(seat)} просит помощи у ${name(a.to)} за ${a.treasures} сокр.`);
        break;
      case 'accept':
        f!.helper = seat;
        f!.stage = 'combat';
        log(s, `${name(seat)} помогает в бою.`);
        break;
      case 'decline':
        f!.declined.push(seat);
        f!.reward = 0;
        f!.stage = 'combat';
        log(s, `${name(seat)} отказывает в помощи.`);
        break;
      case 'fight': {
        if (heroWins(s, f!) && f!.queue.length === 0) {
          // другие игроки могут вмешаться
        }
        f!.stage = 'interfere';
        f!.queue = [...Array(s.players).keys()].filter((p) => p !== f!.hero && p !== f!.helper);
        resolveIfNoInterference(s);
        break;
      }
      case 'enhance': {
        removeOne(h.hand, a.c);
        discard(s, a.c);
        const d = cardOf(a.c) as { name: string; mod: number; tmod: number };
        f!.monsters[0]!.mod += d.mod;
        f!.monsters[0]!.tmod += d.tmod;
        log(s, `${name(seat)} усиливает монстра: «${d.name}» (${d.mod > 0 ? '+' : ''}${d.mod}).`);
        f!.stage = 'combat';
        f!.queue = [];
        break;
      }
      case 'hinder': {
        removeOne(h.hand, a.c);
        discard(s, a.c);
        const d = cardOf(a.c) as { name: string; penalty: number };
        f!.penalty += d.penalty;
        log(s, `${name(seat)} мешает герою: «${d.name}» (−${d.penalty}).`);
        f!.stage = 'combat';
        f!.queue = [];
        break;
      }
      case 'backstab':
        removeOne(h.hand, a.c);
        discard(s, a.c);
        f!.backstab = true;
        f!.penalty += 2;
        log(s, `${name(seat)} бьёт героя в спину (−2).`);
        f!.stage = 'combat';
        f!.queue = [];
        break;
      case 'pass':
        f!.queue.shift();
        resolveIfNoInterference(s);
        break;
      case 'flee':
        runAway(s, false);
        break;
      case 'flight': {
        for (const c of a.cards) {
          removeOne(h.hand, c);
          discard(s, c);
        }
        log(s, `${name(seat)} улетает с помощью заклинания.`);
        runAway(s, true);
        break;
      }
    }
    return s;
  },

  outcome: (s): Outcome | null => {
    if (s.step !== 'over') return null;
    const levels = s.heroes.map((h) => h.level);
    const winner = s.winner ?? levels.indexOf(Math.max(...levels));
    const order = levels.map((_, i) => i).sort((x, y) => (y === winner ? 1 : 0) - (x === winner ? 1 : 0) || levels[y]! - levels[x]! || x - y);
    return {
      winners: s.winner !== null ? [s.winner] : order.filter((i) => levels[i] === levels[order[0]!]),
      ranking: order,
      reason: s.limitReached ? 'limit' : 'victory',
      scores: Object.fromEntries(levels.map((v, i) => [i, v])),
    };
  },

  view: (s, seat) => {
    const { door, doorDiscard: _a, treasure, treasureDiscard: _b, rng: _r, heroes, ...pub } = s;
    return {
      ...pub,
      heroes: heroes.map((h, p) => ({ ...h, hand: p === seat ? h.hand : null, handCount: h.hand.length, power: s.heroes[p]!.level + gearBonus(s, p) })),
      doorCount: door.length,
      treasureCount: treasure.length,
      finished: s.step === 'over',
      heroSide: s.fight ? sidePower(s, s.fight) : null,
      monsterSide: s.fight ? monsterPower(s, s.fight) : null,
    };
  },

  timeoutAction: (s, seat) => {
    const f = s.fight;
    if (s.step === 'kick') return { t: 'kick' };
    if (s.step === 'after') return { t: 'loot' };
    if (s.step === 'wrap') return { t: 'end' };
    if (s.step === 'charity') return munchkinGame.legalActions(s, seat).find((a) => a.t === 'charity') ?? null;
    if (f?.stage === 'invite') return { t: 'decline' };
    if (f?.stage === 'interfere') return { t: 'pass' };
    if (f?.stage === 'run') return { t: 'flee' };
    return { t: 'fight' };
  },
  chooseBotAction: (s, seat, bot) => chooseBot(s, seat, bot),
};

/** Если вмешиваться больше некому — бой разрешается: победа или (при проигрыше) стадия бегства. */
function resolveIfNoInterference(s: MunchState) {
  const f = s.fight!;
  if (f.queue.length > 0) return;
  if (heroWins(s, f)) victory(s);
  else {
    f.stage = 'run';
    log(s, `${name(f.hero)} проигрывает бой (${sidePower(s, f)} против ${monsterPower(s, f)}) и пытается бежать.`);
  }
}

// ───────── бот ─────────

/** Лучшее снаряжение: по слоту — максимум бонуса, руки — перебор подмножеств. */
function bestLoadout(s: MunchState, p: Seat): number[] {
  const h = s.heroes[p]!;
  const owned = h.items.map((o, i) => ({ o, i, d: itemDef(o) })).filter((x) => x.d.slot !== 'none');
  const dwarf = raceOf(s, p) === 'dwarf';
  let best: number[] = [];
  let bv = -1;
  const pick = (slot: string) => owned.filter((x) => x.d.slot === slot);
  const heads = [null, ...pick('head')];
  const bodies = [null, ...pick('body')];
  const feets = [null, ...pick('feet')];
  const hands = pick('hands');
  const handSets: typeof hands[] = [[]];
  for (let i = 0; i < hands.length; i++) {
    handSets.push([hands[i]!]);
    for (let j = i + 1; j < hands.length; j++) handSets.push([hands[i]!, hands[j]!]);
  }
  for (const a of heads) for (const b of bodies) for (const c of feets) for (const hs of handSets) {
    const set = [a, b, c, ...hs].filter(Boolean) as typeof owned;
    if (hs.reduce((x, y) => x + (y.d.hands ?? 1), 0) > 2) continue;
    if (!dwarf && set.filter((x) => x.d.big).length > 1) continue;
    const v = set.reduce((x, y) => x + y.d.bonus, 0);
    if (v > bv) [best, bv] = [set.map((x) => x.i), v];
  }
  return best;
}

function chooseBot(s: MunchState, seat: Seat, bot: BotContext): MunchAction {
  const legal = munchkinGame.legalActions(s, seat);
  const rng = createRng(bot.rngSeed);
  const h = s.heroes[seat]!;
  const f = s.fight;
  const easy = bot.level === 'EASY';
  const find = <T extends MunchAction['t']>(t: T) => legal.find((a) => a.t === t) as Extract<MunchAction, { t: T }> | undefined;

  // Бой
  if (s.step === 'fight' && f) {
    if (f.stage === 'invite') {
      // помогаем, если награда есть и герой не выиграет игру благодаря нам
      const hero = s.heroes[f.hero]!;
      const wouldWin = hero.level + f.monsters.reduce((a, m) => a + (cardOf(m.c) as { gain: number }).gain, 0) >= MAX_LEVEL;
      return !wouldWin && (f.reward > 0 || raceOf(s, seat) === 'elf') && (!easy || rng.next() < 0.7) ? { t: 'accept' } : { t: 'decline' };
    }
    if (f.stage === 'interfere') {
      const hero = s.heroes[f.hero]!;
      const margin = sidePower(s, f) - monsterPower(s, f);
      const dangerous = hero.level >= 8 || hero.level >= Math.max(...s.heroes.map((x) => x.level));
      if (!easy || rng.next() < 0.3) {
        if (margin > 0 && dangerous) {
          const enh = legal.filter((a): a is Extract<MunchAction, { t: 'enhance' }> => a.t === 'enhance').sort((x, y) => (cardOf(y.c) as { mod: number }).mod - (cardOf(x.c) as { mod: number }).mod)[0];
          const enhMod = enh ? (cardOf(enh.c) as { mod: number }).mod : 0;
          if (enh && enhMod > 0 && enhMod > margin - 1) return enh;
          const trap = legal.filter((a): a is Extract<MunchAction, { t: 'hinder' }> => a.t === 'hinder').sort((x, y) => (cardOf(y.c) as { penalty: number }).penalty - (cardOf(x.c) as { penalty: number }).penalty)[0];
          if (trap && (cardOf(trap.c) as { penalty: number }).penalty >= margin) return trap;
          const bs = find('backstab');
          if (bs && margin <= 2 && h.hand.length > 0) return { t: 'backstab', c: h.hand.slice().sort((a, b) => goldOf(a) - goldOf(b))[0]! };
        }
      }
      return { t: 'pass' };
    }
    if (f.stage === 'run') {
      const fl = find('flight');
      return fl ? { t: 'flight', cards: fl.cards.slice(0, 1) } : { t: 'flee' };
    }
    // combat, герой
    const margin = sidePower(s, f) - monsterPower(s, f);
    const tie = classOf(s, seat) === 'warrior';
    if (margin > 0 || (margin === 0 && tie)) return { t: 'fight' };
    // нужны бонусы: зелья
    const potions = legal.filter((a): a is Extract<MunchAction, { t: 'potion' }> => a.t === 'potion').sort((x, y) => (cardOf(y.c) as { bonus: number }).bonus - (cardOf(x.c) as { bonus: number }).bonus);
    let need = monsterPower(s, f) - sidePower(s, f) + (tie ? 0 : 1);
    let sum = 0;
    for (const p of potions) {
      sum += (cardOf(p.c) as { bonus: number }).bonus;
      if (sum >= need) return potions[0]!;
    }
    // ярость воина
    const bk = find('berserk');
    if (bk && h.hand.length >= need - sum && need - sum <= 3 - f.berserk) return { t: 'berserk', cards: [h.hand[0]!] };
    // помощь
    if (f.helper < 0) {
      const t = treasureCount(f);
      const candidates = legal.filter((a): a is Extract<MunchAction, { t: 'invite' }> => a.t === 'invite' && a.treasures === Math.min(t, 1));
      const best = candidates
        .filter((a) => heroPower(s, a.to) + sum >= need && s.heroes[a.to]!.level + 1 < MAX_LEVEL)
        .sort((x, y) => heroPower(s, y.to) - heroPower(s, x.to))[0];
      if (best && t >= 1) return best;
    }
    if (potions.length && sum > 0 && sum >= need) return potions[0]!;
    return { t: 'fight' };
  }

  // Милосердие
  if (s.step === 'charity') return find('charity')!;

  // Свободные действия: уровни, раса/класс, снаряжение, продажа
  const lu = find('levelup');
  if (lu) return lu;
  const hasRace = h.race >= 0;
  const hasCls = h.cls >= 0;
  const rc = legal.find((a) => (a.t === 'race' && !hasRace) || (a.t === 'cls' && !hasCls));
  if (rc) return rc;
  const target = bestLoadout(s, seat);
  const wantEq = target.map((i) => h.items[i]!).filter((o) => !o.eq);
  if (wantEq[0]) return { t: 'equip', c: wantEq[0].c };
  // продаём лишнее на уровень
  if (h.level < MAX_LEVEL - 1) {
    const equippedIdx = new Set(target);
    const sellable = [
      ...h.items.filter((_, i) => !equippedIdx.has(i)).map((o) => o.c),
      ...h.hand.filter((c) => cardOf(c).kind === 'item' && (cardOf(c) as { slot: string }).slot === 'none'),
    ].sort((a, b) => goldOf(b) - goldOf(a));
    let sum = 0;
    const pick: number[] = [];
    for (const c of sellable) {
      if (goldOf(c) === 0) continue;
      pick.push(c);
      sum += goldOf(c);
      if (sum >= 1000) return { t: 'sell', items: pick };
    }
  }
  // Предметы из руки в игру: «снаряжение» кладётся в игру, как только оказывается полезным
  const handItem = h.hand.find((c) => cardOf(c).kind === 'item' && (cardOf(c) as { slot: string }).slot !== 'none');
  if (handItem !== undefined) {
    // кладём в игру (через unequip→equip нельзя): снаряжение в руке мы просто переносим на стол, сделав его частью items
    return { t: 'equip', c: handItem };
  }

  if (s.step === 'kick') return { t: 'kick' };
  if (s.step === 'after') {
    const monsters = [...new Set(hasKind(s, seat, 'monster'))];
    const power = heroPower(s, seat);
    const safe = monsters.filter((c) => (cardOf(c) as { level: number }).level + 2 <= power).sort((a, b) => (cardOf(b) as { level: number }).level - (cardOf(a) as { level: number }).level)[0];
    if (safe !== undefined && !easy) return { t: 'trouble', c: safe };
    return { t: 'loot' };
  }
  // Проклятия на лидера
  const curse = legal.find((a): a is Extract<MunchAction, { t: 'curse' }> => a.t === 'curse');
  if (curse && !easy) {
    const leader = s.heroes.map((x, p) => ({ p, l: x.level })).filter((x) => x.p !== seat).sort((a, b) => b.l - a.l)[0];
    if (leader && leader.l >= 7) return { t: 'curse', c: curse.c, target: leader.p };
  }
  return { t: 'end' };
}
