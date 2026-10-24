import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { dixitGame as g, imaginariumGame, type AssocAction, type AssocState } from './index';

const act = (s: AssocState, seat: number, a: AssocAction) => {
  const v = g.validate(s, seat, a);
  if (!v.ok) throw new Error(`${v.error}: ${JSON.stringify(a)} (место ${seat})`);
  return g.apply(s, seat, a);
};
const fresh = (n = 4, seed = 'dx') => g.setup({ players: n, seed });
/** Разыгрывает раунд: рассказчик → сдача карт → голоса `votesFor[seat] = «чья карта»`(по владельцу). */
function playRound(s: AssocState, votesByOwner: Record<number, number>) {
  const st = s.storyteller;
  s = act(s, st, { t: 'clue', card: s.hands[st]![0]!, text: 'тайна' });
  for (const seat of [...g.currentSeats(s)]) {
    for (let k = 0; k < (s.players === 3 ? 2 : 1); k++) if (g.currentSeats(s).includes(seat)) s = act(s, seat, { t: 'submit', card: s.hands[seat]![0]! });
  }
  expect(s.phase).toBe('vote');
  for (const [voter, owner] of Object.entries(votesByOwner)) {
    const pos = s.table.findIndex((t) => t.owner === owner);
    s = act(s, Number(voter), { t: 'vote', pos });
  }
  return s;
}

describe('подготовка', () => {
  it('колоды, руки и очерёдность', () => {
    for (const n of [3, 5, 8]) {
      const s = fresh(n, `s${n}`);
      expect(s.hands.every((h) => h.length === 6)).toBe(true);
      expect(new Set([...s.hands.flat(), ...s.deck]).size).toBe(84);
      expect(g.currentSeats(s)).toEqual([0]);
    }
    expect(imaginariumGame.maxPlayers).toBe(6);
    expect(imaginariumGame.setup({ players: 4, seed: 'i' }).cfg.target).toBe(39);
  });
  it('ассоциация обязательна и карта должна быть в руке', () => {
    const s = fresh();
    expect(g.validate(s, 0, { t: 'clue', card: s.hands[0]![0]!, text: '  ' }).ok).toBe(false);
    expect(g.validate(s, 0, { t: 'clue', card: s.hands[1]![0]!, text: 'ок' }).ok).toBe(false);
    expect(g.validate(s, 1, { t: 'clue', card: s.hands[1]![0]!, text: 'ок' }).ok).toBe(false);
  });
});

describe('очки', () => {
  it('угадали не все и не никто: рассказчик и угадавшие +3, плюс бонусы за голоса', () => {
    let s = fresh(4);
    // рассказчик 0; игроки 1,2,3. 1 и 2 угадывают (голос за 0), 3 голосует за карту игрока 1.
    s = playRound(s, { 1: 0, 2: 0, 3: 1 });
    expect(s.last!.delta).toEqual([3, 3 + 1, 3, 0]); // 1: угадал +3, получил голос от 3 → +1
  });
  it('никто не угадал: рассказчик 0, остальные +2 и бонусы', () => {
    let s = fresh(4);
    s = playRound(s, { 1: 2, 2: 3, 3: 2 });
    // 1→карта 2, 2→карта 3, 3→карта 2: бонусы: игрок 2 — 2 голоса, игрок 3 — 1
    expect(s.last!.delta).toEqual([0, 2, 2 + 2, 2 + 1]);
  });
  it('угадали все: рассказчик 0, остальные +2', () => {
    let s = fresh(4);
    s = playRound(s, { 1: 0, 2: 0, 3: 0 });
    expect(s.last!.delta).toEqual([0, 2, 2, 2]);
  });
  it('бонус за голоса — не больше 3', () => {
    let s = fresh(6);
    s = playRound(s, { 1: 5, 2: 5, 3: 5, 4: 5, 5: 4 });
    // карту 5 выбрали 4 игрока → бонус 3; 4-й получил 1 голос; рассказчик 0 (никто не угадал): +2 всем
    expect(s.last!.delta[5]).toBe(2 + 3);
    expect(s.last!.delta[4]).toBe(2 + 1);
  });
  it('втроём каждый кладёт по две карты', () => {
    let s = fresh(3);
    s = act(s, 0, { t: 'clue', card: s.hands[0]![0]!, text: 'тест' });
    expect(g.currentSeats(s)).toEqual([1, 2]);
    s = act(s, 1, { t: 'submit', card: s.hands[1]![0]! });
    expect(g.currentSeats(s)).toEqual([1, 2]); // вторая карта игрока 1 ещё нужна
    s = act(s, 1, { t: 'submit', card: s.hands[1]![0]! });
    expect(g.currentSeats(s)).toEqual([2]);
    s = act(s, 2, { t: 'submit', card: s.hands[2]![0]! });
    s = act(s, 2, { t: 'submit', card: s.hands[2]![0]! });
    expect(s.table).toHaveLength(5);
    expect(g.view(s, 1).table.filter((t) => t.mine)).toHaveLength(2);
  });
});

describe('скрытая информация', () => {
  it('во время сдачи видны только свои карты; при голосовании владельцев нет', () => {
    let s = fresh(4);
    s = act(s, 0, { t: 'clue', card: s.hands[0]![0]!, text: 'тест' });
    s = act(s, 1, { t: 'submit', card: s.hands[1]![0]! });
    expect(g.view(s, 2).table).toEqual([]);
    expect(g.view(s, 1).table).toHaveLength(1);
    s = act(s, 2, { t: 'submit', card: s.hands[2]![0]! });
    s = act(s, 3, { t: 'submit', card: s.hands[3]![0]! });
    const v = g.view(s, 2);
    expect(v.table).toHaveLength(4);
    expect(JSON.stringify(v)).not.toContain('"owner"');
    expect(v.table.filter((t) => t.mine)).toHaveLength(1);
    expect(g.validate(s, 2, { t: 'vote', pos: s.table.findIndex((t) => t.owner === 2) }).ok).toBe(false);
    expect(g.validate(s, 0, { t: 'vote', pos: 0 }).ok).toBe(false); // рассказчик не голосует
  });
  it('чат закрыт до конца игры', () => {
    expect(g.chatAllowed!(fresh(), 0)).toBe(false);
  });
});

describe('конец игры', () => {
  it('набрана цель — игра заканчивается, побеждает лидер', () => {
    let s = fresh(4);
    s.scores = [0, 29, 10, 10];
    s = playRound(s, { 1: 0, 2: 0, 3: 1 }); // рассказчик 0 получает 3, игрок 1 набирает ≥30
    expect(s.finished).toBe(true);
    expect(g.outcome(s)!.winners).toEqual([1]);
    expect(g.chatAllowed!(s, 2)).toBe(true);
  });
  it('очерёдность рассказчиков и добор карт', () => {
    let s = fresh(4);
    s = playRound(s, { 1: 0, 2: 0, 3: 0 });
    expect(s.storyteller).toBe(1);
    expect(s.hands.every((h) => h.length === 6)).toBe(true);
    expect(s.phase).toBe('clue');
  });
});

describe('случайные партии', () => {
  it('для обеих игр всегда завершаются', () => {
    for (const game of [g, imaginariumGame]) {
      for (let n = 0; n < 15; n++) {
        const rng = createRng(`as${n}`);
        let s = game.setup({ players: 3 + (n % 4), seed: `g${n}` });
        let steps = 0;
        while (!game.outcome(s)) {
          const seats = game.currentSeats(s);
          expect(seats.length).toBeGreaterThan(0);
          const seat = seats[rng.int(seats.length)]!;
          const legal = game.legalActions(s, seat);
          expect(legal.length).toBeGreaterThan(0);
          const pick = legal[rng.int(legal.length)]!;
          const a = pick.t === 'clue' ? { ...pick, text: 'ассоциация' } : pick;
          const v = game.validate(s, seat, a);
          if (!v.ok) throw new Error(v.error);
          s = game.apply(s, seat, a);
          if (++steps > 5000) throw new Error('не заканчивается');
        }
      }
    }
  });
});
