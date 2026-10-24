import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { CARDS, DOOR_DECK, TREASURE_DECK, handLimit, monsterPower, munchkinGame as g, sidePower, type MunchAction, type MunchState } from './index';

const id = (name: string) => CARDS.findIndex((c) => c.name === name);
const setup = (players = 4, seed = 'mk') => g.setup({ players, seed });
const play = (s: MunchState, seat: number, a: MunchAction) => {
  const v = g.validate(s, seat, a);
  if (!v.ok) throw new Error(`${JSON.stringify(a)}: ${v.error}`);
  return g.apply(s, seat, a);
};
/** Подкладывает в верх колоды дверей нужную карту. */
const topDoor = (s: MunchState, c: number) => {
  s.door.push(c);
  return s;
};

describe('Манчкин: начало', () => {
  it('по 4 двери и 4 сокровища, 1 уровень, ход первого', () => {
    const s = setup();
    for (const h of s.heroes) {
      expect(h.hand).toHaveLength(8);
      expect(h.level).toBe(1);
    }
    expect(s.door.length + 16).toBe(DOOR_DECK.length);
    expect(s.treasure.length + 16).toBe(TREASURE_DECK.length);
    expect(g.currentSeats(s)).toEqual([0]);
  });
  it('вид скрывает чужие руки и колоды', () => {
    const v = g.view(setup(), 1);
    expect(v.heroes[1]!.hand).not.toBeNull();
    expect(v.heroes[0]!.hand).toBeNull();
    expect('door' in v).toBe(false);
  });
});

describe('Манчкин: бой', () => {
  const fightSetup = (monster: string, level = 5) => {
    let s = setup();
    s.heroes[0]!.level = level;
    s.heroes[0]!.hand = [];
    s.heroes[1]!.hand = [];
    s.heroes[2]!.hand = [];
    s.heroes[3]!.hand = [];
    s = topDoor(s, id(monster));
    return play(s, 0, { t: 'kick' });
  };
  it('открытый монстр начинает бой; сила считается по уровню и снаряжению', () => {
    const s = fightSetup('Слизень-Попрошайка');
    expect(s.step).toBe('fight');
    expect(monsterPower(s, s.fight!)).toBe(1);
    expect(sidePower(s, s.fight!)).toBe(5);
  });
  it('победа: уровень растёт, берутся сокровища', () => {
    let s = fightSetup('Слизень-Попрошайка');
    const before = s.heroes[0]!.hand.length;
    s = play(s, 0, { t: 'fight' });
    for (const p of [1, 2, 3]) s = play(s, p, { t: 'pass' });
    expect(s.step).toBe('wrap');
    expect(s.heroes[0]!.level).toBe(6);
    expect(s.heroes[0]!.hand.length).toBe(before + 1);
  });
  it('поражение → бегство: бросок решает, плохие последствия применяются при неудаче', () => {
    let s = fightSetup('Гоблин-Скандалист', 1);
    s = play(s, 0, { t: 'fight' });
    for (const p of [1, 2, 3]) s = play(s, p, { t: 'pass' });
    expect(s.fight!.stage).toBe('run');
    let failed = false;
    let escaped = false;
    for (let seed = 1; seed < 200 && !(failed && escaped); seed++) {
      const r = g.apply({ ...s, rng: seed }, 0, { t: 'flee' });
      if (r.heroes[0]!.level === 1 && s.heroes[0]!.level === 1 && r.log.some((l) => l.includes('убегает'))) escaped = true;
      if (r.log.some((l) => l.includes('не смог убежать'))) failed = true;
      expect(r.step).toBe('wrap');
    }
    expect(escaped).toBe(true);
    expect(failed).toBe(true);
  });
  it('усиление монстра соперником может превратить победу в поражение', () => {
    let s = fightSetup('Крыса-Бухгалтер', 3);
    s.heroes[1]!.hand = [id('Закалённый')];
    s = play(s, 0, { t: 'fight' });
    s = play(s, 1, { t: 'enhance', c: id('Закалённый') });
    expect(s.fight!.stage).toBe('combat');
    expect(monsterPower(s, s.fight!)).toBe(7);
    s = play(s, 0, { t: 'fight' });
    for (const p of [1, 2, 3]) s = play(s, p, { t: 'pass' });
    expect(s.fight!.stage).toBe('run');
  });
  it('помощь: помощник добавляет силу и берёт обещанные сокровища', () => {
    let s = fightSetup('Болотный Тролль-Налоговик', 2);
    s.heroes[1]!.level = 5;
    s = play(s, 0, { t: 'invite', to: 1, treasures: 1 });
    expect(g.currentSeats(s)).toEqual([1]);
    s = play(s, 1, { t: 'accept' });
    expect(sidePower(s, s.fight!)).toBe(7);
    const h1 = s.heroes[1]!.hand.length;
    s = play(s, 0, { t: 'fight' });
    for (const p of [2, 3]) s = play(s, p, { t: 'pass' });
    expect(s.heroes[1]!.hand.length).toBe(h1 + 1);
    expect(s.heroes[0]!.level).toBe(3);
  });
  it('воин побеждает при равенстве сил; остальные — нет', () => {
    let s = fightSetup('Гоблин-Скандалист', 4);
    s.heroes[0]!.cls = id('Воин');
    s = play(s, 0, { t: 'fight' });
    for (const p of [1, 2, 3]) s = play(s, p, { t: 'pass' });
    expect(s.step).toBe('wrap');
    let t = fightSetup('Гоблин-Скандалист', 4);
    t = play(t, 0, { t: 'fight' });
    for (const p of [1, 2, 3]) t = play(t, p, { t: 'pass' });
    expect(t.fight!.stage).toBe('run');
  });
  it('зелье даёт бонус в бою, ярость воина тратит карты', () => {
    let s = fightSetup('Крыса-Бухгалтер', 1);
    s.heroes[0]!.hand = [id('Зелье Силы')];
    const base = sidePower(s, s.fight!);
    s = play(s, 0, { t: 'potion', c: id('Зелье Силы') });
    expect(sidePower(s, s.fight!)).toBe(base + 3);
  });
  it('смерть от сильного монстра: вещи и карты потеряны, уровень сохранён, на следующем ходу — новая раздача', () => {
    let s = fightSetup('Дракон-Банкир', 3);
    s.heroes[0]!.hand = [id('Подарок Судьбы')];
    s.heroes[0]!.items = [{ c: id('Железный шлем'), eq: true }];
    s = play(s, 0, { t: 'fight' });
    for (const p of [1, 2, 3]) s = play(s, p, { t: 'pass' });
    let died: MunchState | null = null;
    for (let seed = 1; seed < 100 && !died; seed++) {
      const r = g.apply({ ...s, rng: seed }, 0, { t: 'flee' });
      if (r.heroes[0]!.dead) died = r;
    }
    const d = died!;
    expect(d.heroes[0]!.items).toHaveLength(0);
    expect(d.heroes[0]!.hand).toHaveLength(0);
    expect(d.heroes[0]!.level).toBe(3);
    d.turn = 3;
    d.step = 'wrap';
    const t = play(d, 3, { t: 'end' });
    expect(t.turn).toBe(0);
    expect(t.heroes[0]!.dead).toBe(false);
    expect(t.heroes[0]!.hand).toHaveLength(8);
  });
});

describe('Манчкин: предметы и уровни', () => {
  it('снаряжение: слот заменяется, двуручное освобождает руки, один большой предмет (кроме гнома)', () => {
    const s = setup();
    const h = s.heroes[0]!;
    h.hand = [];
    h.items = [
      { c: id('Короткий меч'), eq: false },
      { c: id('Щит'), eq: false },
      { c: id('Двуручный молот'), eq: false },
      { c: id('Латы великана'), eq: false },
    ];
    let t = play(s, 0, { t: 'equip', c: id('Короткий меч') });
    t = play(t, 0, { t: 'equip', c: id('Щит') });
    expect(t.heroes[0]!.items.filter((o) => o.eq)).toHaveLength(2);
    t = play(t, 0, { t: 'equip', c: id('Двуручный молот') });
    expect(t.heroes[0]!.items.filter((o) => o.eq).map((o) => CARDS[o.c]!.name)).toEqual(['Двуручный молот']);
    t = play(t, 0, { t: 'equip', c: id('Латы великана') });
    expect(t.heroes[0]!.items.filter((o) => o.eq).map((o) => CARDS[o.c]!.name)).toEqual(['Латы великана']);
    t.heroes[0]!.race = id('Гном');
    t = play(t, 0, { t: 'equip', c: id('Двуручный молот') });
    expect(t.heroes[0]!.items.filter((o) => o.eq)).toHaveLength(2);
    expect(handLimit(t, 0)).toBe(6);
  });
  it('продажа предметов на 1000 золотых даёт уровень, но не 10-й', () => {
    const s = setup();
    const h = s.heroes[0]!;
    h.hand = [];
    h.items = [{ c: id('Арбалет'), eq: false }, { c: id('Кубок вождя'), eq: false }];
    expect(g.validate(s, 0, { t: 'sell', items: [id('Арбалет')] }).ok).toBe(false);
    const t = play(s, 0, { t: 'sell', items: [id('Арбалет'), id('Кубок вождя')] });
    expect(t.heroes[0]!.level).toBe(2);
    expect(t.heroes[0]!.items).toHaveLength(0);
    s.heroes[0]!.level = 9;
    expect(g.validate(s, 0, { t: 'sell', items: [id('Арбалет'), id('Кубок вождя')] }).ok).toBe(false);
  });
  it('карта уровня повышает уровень, но не выше 9', () => {
    const s = setup();
    s.heroes[0]!.hand = [id('Подарок Судьбы')];
    s.heroes[0]!.level = 9;
    expect(g.legalActions(s, 0).some((a) => a.t === 'levelup')).toBe(false);
    s.heroes[0]!.level = 4;
    expect(play(s, 0, { t: 'levelup', c: id('Подарок Судьбы') }).heroes[0]!.level).toBe(5);
  });
  it('проклятие карты из руки: понижает уровень цели', () => {
    const s = setup();
    s.heroes[0]!.hand = [id('Проклятие Понижения')];
    s.heroes[1]!.level = 5;
    const t = play(s, 0, { t: 'curse', c: id('Проклятие Понижения'), target: 1 });
    expect(t.heroes[1]!.level).toBe(4);
  });
  it('лишние карты в конце хода: милосердие отдаёт слабейшему', () => {
    let s = setup();
    s.heroes[0]!.level = 4;
    s.heroes[0]!.hand = [1, 2, 3, 4, 5, 6, 7].map((i) => TREASURE_DECK[i]!);
    s.step = 'wrap';
    s = play(s, 0, { t: 'end' });
    expect(s.step).toBe('charity');
    const a = g.legalActions(s, 0).find((x) => x.t === 'charity')!;
    s = play(s, 0, a);
    expect(s.heroes[0]!.hand).toHaveLength(5);
    expect(s.turn).toBe(1);
    expect(s.heroes[1]!.hand.length + s.heroes[2]!.hand.length + s.heroes[3]!.hand.length).toBe(24 + 2);
  });
  it('победа: 10-й уровень достигается только убийством монстра', () => {
    let s = setup();
    s.heroes[0]!.level = 9;
    s.heroes[0]!.hand = [];
    s = topDoor(s, id('Слизень-Попрошайка'));
    s = play(s, 0, { t: 'kick' });
    s = play(s, 0, { t: 'fight' });
    for (const p of [1, 2, 3]) s = play(s, p, { t: 'pass' });
    expect(s.step).toBe('over');
    expect(g.outcome(s)!.winners).toEqual([0]);
  });
});

describe('Манчкин: полные партии', () => {
  function run(players: number, seed: string, pick: (s: MunchState, seat: number, i: number) => MunchAction, max = 20000) {
    let s = setup(players, seed);
    for (let i = 0; i < max && !g.outcome(s); i++) {
      const seats = g.currentSeats(s);
      const seat = seats[0]!;
      const a = pick(s, seat, i);
      const v = g.validate(s, seat, a);
      if (!v.ok) throw new Error(`${i}: ${JSON.stringify(a)} ${v.error} step=${s.step} stage=${s.fight?.stage}`);
      s = g.apply(s, seat, a);
      // инвариант: все карты на месте
      const all = [
        ...s.door, ...s.doorDiscard, ...s.treasure, ...s.treasureDiscard,
        ...s.heroes.flatMap((h) => [...h.hand, ...h.items.map((o) => o.c), ...(h.race >= 0 ? [h.race] : []), ...(h.cls >= 0 ? [h.cls] : [])]),
        ...(s.fight ? s.fight.monsters.map((m) => m.c) : []),
      ];
      if (all.length !== DOOR_DECK.length + TREASURE_DECK.length) throw new Error(`карты потеряны: ${all.length} из ${DOOR_DECK.length + TREASURE_DECK.length} на шаге ${i} (${a.t})`);
    }
    return s;
  }
  it('боты играют партию до конца', () => {
    for (const [n, seed] of [[3, 'a'], [4, 'b'], [6, 'c']] as const) {
      const s = run(n, seed, (st, seat, i) => g.chooseBotAction!(st, seat, { level: 'HARD', rngSeed: `${seed}${i}` }));
      expect(g.outcome(s), `seed ${seed} turns ${s.turnCount}`).not.toBeNull();
    }
  }, 120000);
  it('случайные ходы сохраняют инварианты', () => {
    const rng = createRng('rnd');
    const s = run(4, 'r', (st, seat) => {
      const l = g.legalActions(st, seat);
      return l[rng.int(l.length)]!;
    }, 4000);
    expect(s.turnCount).toBeGreaterThan(0);
  }, 60000);
});
