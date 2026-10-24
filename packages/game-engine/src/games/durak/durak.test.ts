import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { dispatch, startSession } from '../../core/runner';
import { registerBuiltinGames } from '../index';
import { beats, cardKey, durakGame, newDeck, type Card, type DurakAction, type DurakState } from './index';

registerBuiltinGames();

const c = (rank: number, suit: Card['suit']): Card => ({ rank, suit });
const total = (s: DurakState) => s.hands.reduce((n, h) => n + h.length, 0) + s.deck.length + s.discard + s.table.reduce((n, p) => n + (p.defense ? 2 : 1), 0);

/** Ручная раскладка для сценариев. */
function scene(p: Partial<DurakState> & { hands: Card[][] }): DurakState {
  return {
    variant: 'podkidnoy', players: p.hands.length, deck: [], trump: 'H', discard: 0, table: [],
    attacker: 0, defender: 1, phase: 'lead', taking: false, passed: [], cap: 6, firstBout: false,
    out: [], finished: false, loser: null, ...p,
  };
}
const act = (s: DurakState, seat: number, a: DurakAction) => {
  const v = durakGame.validate(s, seat, a);
  if (!v.ok) throw new Error(v.error);
  return durakGame.apply(s, seat, a);
};

describe('карты', () => {
  it('колода из 36 уникальных карт', () => {
    const d = newDeck();
    expect(d).toHaveLength(36);
    expect(new Set(d.map(cardKey)).size).toBe(36);
  });
  it('правила боя', () => {
    expect(beats('H', c(7, 'S'), c(8, 'S'))).toBe(true);
    expect(beats('H', c(8, 'S'), c(7, 'S'))).toBe(false);
    expect(beats('H', c(14, 'S'), c(6, 'H'))).toBe(true); // козырь бьёт любую масть
    expect(beats('H', c(6, 'H'), c(14, 'S'))).toBe(false);
    expect(beats('H', c(7, 'H'), c(9, 'H'))).toBe(true);
    expect(beats('H', c(7, 'S'), c(8, 'D'))).toBe(false);
  });
});

describe('раздача', () => {
  it('2–6 игроков: по 6 карт, козырь определён, первым ходит младший козырь', () => {
    for (let n = 2; n <= 6; n++) {
      const s = durakGame.setup({ players: n, seed: `seed${n}` });
      expect(s.hands.every((h) => h.length === 6)).toBe(true);
      expect(total(s)).toBe(36);
      const trumps = s.hands.flatMap((h, seat) => h.filter((x) => x.suit === s.trump).map((x) => ({ seat, rank: x.rank })));
      if (trumps.length) expect(s.attacker).toBe(trumps.sort((a, b) => a.rank - b.rank)[0]!.seat);
    }
  });
  it('view скрывает чужие карты', () => {
    const s = durakGame.setup({ players: 3, seed: 'x' });
    const v = durakGame.view(s, 0);
    expect(v.hand).toHaveLength(6);
    expect(v.handCounts).toEqual([6, 6, 6]);
    expect(JSON.stringify(v)).not.toContain(JSON.stringify(s.hands[1]![0]));
  });
});

describe('ход кона', () => {
  it('отбой: бьём, подкидывать нечем → кон закрыт, защитник атакует, добор до 6', () => {
    let s = scene({
      hands: [[c(7, 'S'), c(9, 'C')], [c(8, 'S'), c(10, 'D')]],
      deck: [c(12, 'D'), c(13, 'D'), c(14, 'D'), c(6, 'D')],
    });
    s = act(s, 0, { t: 'play', card: c(7, 'S') });
    s = act(s, 1, { t: 'beat', idx: 0, card: c(8, 'S') });
    // у атакующего нет карт ранга 7/8 → автоматически бито
    expect(s.phase).toBe('lead');
    expect(s.attacker).toBe(1);
    expect(s.defender).toBe(0);
    expect(s.discard).toBe(2);
    // Добирает первым атакующий: была 1 карта (9C), колода из 4 карт уходит ему целиком.
    expect(s.hands[0]).toHaveLength(5);
    expect(s.hands[1]).toHaveLength(1);
    expect(s.deck).toHaveLength(0);
  });

  it('защитник берёт, ему можно докинуть, роли пропускают защитника', () => {
    let s = scene({
      hands: [[c(7, 'S'), c(7, 'D'), c(9, 'C')], [c(6, 'D')], [c(7, 'C'), c(10, 'C')]],
      deck: [], attacker: 0, defender: 1,
    });
    s = act(s, 0, { t: 'play', card: c(7, 'S') });
    s = act(s, 1, { t: 'take' });
    expect(durakGame.currentSeats(s)).toEqual([0, 2]);
    s = act(s, 0, { t: 'throw', card: c(7, 'D') });
    expect(s.phase).toBe('throw'); // берёт — фаза остаётся
    // У атакующего больше нечего подкинуть — он пасует автоматически, остаётся только игрок 2.
    expect(durakGame.currentSeats(s)).toEqual([2]);
    s = act(s, 2, { t: 'throw', card: c(7, 'C') });
    // Подкидывать больше некому → защитник забрал 3 карты (7S, 7D, 7C) + свою.
    expect(s.hands[1]).toHaveLength(4);
    expect(s.table).toHaveLength(0);
    expect(s.attacker).toBe(2); // следующий после защитника
    expect(s.defender).toBe(0);
  });

  it('лимит подкидывания: не больше cap карт на столе', () => {
    let s = scene({
      hands: [[c(7, 'S'), c(7, 'D'), c(7, 'C'), c(9, 'C')], [c(8, 'S'), c(6, 'H')], [c(10, 'C')]],
      cap: 2, deck: [],
    });
    s = act(s, 0, { t: 'play', card: c(7, 'S') });
    s = act(s, 1, { t: 'beat', idx: 0, card: c(8, 'S') });
    s = act(s, 0, { t: 'throw', card: c(7, 'D') });
    s = act(s, 1, { t: 'beat', idx: 1, card: c(6, 'H') }); // козырь бьёт бубны
    // На столе 2 = cap: 7♣ подкинуть нельзя, кон закрыт сам.
    expect(s.discard).toBe(4);
    expect(s.table).toHaveLength(0);
    // Защитник отбился последними картами и вышел — атакует следующий за ним игрок.
    expect(s.out).toEqual([1]);
    expect(s.attacker).toBe(2);
    expect(s.defender).toBe(0);
  });

  it('конец игры: последний с картами — дурак', () => {
    let s = scene({ hands: [[c(7, 'S')], [c(8, 'S')], [c(6, 'D'), c(6, 'C')]], deck: [] });
    s = act(s, 0, { t: 'play', card: c(7, 'S') });
    s = act(s, 1, { t: 'beat', idx: 0, card: c(8, 'S') });
    expect(s.finished).toBe(true);
    expect(s.loser).toBe(2);
    const o = durakGame.outcome(s)!;
    expect(o.winners.sort()).toEqual([0, 1]);
    expect(o.ranking.at(-1)).toBe(2);
  });

  it('ничья, когда все вышли одновременно', () => {
    let s = scene({ hands: [[c(7, 'S')], [c(8, 'S')]], deck: [] });
    s = act(s, 0, { t: 'play', card: c(7, 'S') });
    s = act(s, 1, { t: 'beat', idx: 0, card: c(8, 'S') });
    expect(s.finished).toBe(true);
    expect(durakGame.outcome(s)).toMatchObject({ winners: [], reason: 'draw' });
  });
});

describe('переводной', () => {
  const base = (): DurakState =>
    scene({
      variant: 'perevodnoy',
      hands: [[c(7, 'S'), c(9, 'C')], [c(7, 'D'), c(12, 'C')], [c(10, 'S'), c(11, 'S'), c(6, 'D')]],
      deck: [c(6, 'S')], cap: 6,
    });

  it('перевод картой того же ранга передаёт защиту следующему', () => {
    let s = act(base(), 0, { t: 'play', card: c(7, 'S') });
    expect(durakGame.legalActions(s, 1).some((a) => a.t === 'transfer')).toBe(true);
    s = act(s, 1, { t: 'transfer', card: c(7, 'D') });
    expect(s.defender).toBe(2);
    expect(s.attacker).toBe(1);
    expect(s.table).toHaveLength(2);
    expect(s.phase).toBe('defend');
  });
  it('нельзя переводить после того, как что-то побито, и в подкидном', () => {
    let s = act(base(), 0, { t: 'play', card: c(7, 'S') });
    expect(durakGame.legalActions({ ...s, variant: 'podkidnoy' }, 1).some((a) => a.t === 'transfer')).toBe(false);
    s = { ...s, table: [{ attack: c(7, 'S'), defense: c(9, 'S') }] };
    expect(durakGame.legalActions(s, 1).some((a) => a.t === 'transfer')).toBe(false);
  });
  it('нельзя переводить, если у следующего не хватит карт', () => {
    let s = scene({ variant: 'perevodnoy', hands: [[c(7, 'S')], [c(7, 'D'), c(12, 'C')], [c(10, 'S')]], deck: [c(6, 'S')] });
    s = act(s, 0, { t: 'play', card: c(7, 'S') });
    expect(durakGame.legalActions(s, 1).some((a) => a.t === 'transfer')).toBe(false);
  });
});

describe('случайные партии (свойства)', () => {
  for (const variant of ['podkidnoy', 'perevodnoy'] as const) {
    it(`${variant}: 300 партий — карты сохраняются, партия всегда заканчивается`, () => {
      for (let g = 0; g < 300; g++) {
        const rng = createRng(`prop${variant}${g}`);
        const players = 2 + (g % 5);
        let session = startSession('durak', { players, seed: `s${g}`, variant });
        let steps = 0;
        while (!durakGame.outcome(session.state as DurakState)) {
          const seats = durakGame.currentSeats(session.state as DurakState);
          expect(seats.length).toBeGreaterThan(0);
          const seat = seats[rng.int(seats.length)]!;
          const legal = durakGame.legalActions(session.state as DurakState, seat);
          expect(legal.length).toBeGreaterThan(0);
          const r = dispatch(session, seat, legal[rng.int(legal.length)]);
          if (!r.ok) throw new Error(r.error);
          session = r.session;
          expect(total(session.state as DurakState)).toBe(36);
          if (++steps > 4000) throw new Error('партия не заканчивается');
        }
      }
    }, 60_000);
  }

  it('боты всех уровней играют до конца и делают только допустимые ходы', () => {
    for (const level of ['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const) {
      for (let g = 0; g < 20; g++) {
        let s = durakGame.setup({ players: 2 + (g % 4), seed: `bot${level}${g}`, variant: g % 2 ? 'perevodnoy' : 'podkidnoy' });
        let steps = 0;
        while (!durakGame.outcome(s)) {
          const seat = durakGame.currentSeats(s)[0]!;
          const a = durakGame.chooseBotAction!(s, seat, { level, rngSeed: `${g}:${steps}` });
          const v = durakGame.validate(s, seat, a);
          if (!v.ok) throw new Error(`${level}: ${v.error} ${JSON.stringify(a)}`);
          s = durakGame.apply(s, seat, a);
          if (++steps > 4000) throw new Error('зависание');
        }
      }
    }
  }, 60_000);
});
