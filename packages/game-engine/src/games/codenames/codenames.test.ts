import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { WORDS_RU } from '../../words/ru';
import { codenamesGame as g, remaining, type CodenamesAction, type CodenamesState } from './index';

const act = (s: CodenamesState, seat: number, a: CodenamesAction) => {
  const v = g.validate(s, seat, a);
  if (!v.ok) throw new Error(`${v.error}: ${JSON.stringify(a)}`);
  return g.apply(s, seat, a);
};
const fresh = (players = 4, seed = 'cn') => g.setup({ players, seed });
const idxOf = (s: CodenamesState, card: string, n = 0) => s.key.map((c, i) => [c, i] as const).filter(([c]) => c === card).map(([, i]) => i)[n]!;

describe('словарь', () => {
  it('слова уникальны и достаточно', () => {
    expect(new Set(WORDS_RU).size).toBe(WORDS_RU.length);
    expect(WORDS_RU.length).toBeGreaterThan(300);
  });
});

describe('подготовка', () => {
  it('25 слов; 9/8/7/1 в ключе; начинает команда с 9', () => {
    for (let n = 0; n < 20; n++) {
      const s = fresh(4 + (n % 7), `s${n}`);
      expect(new Set(s.words).size).toBe(25);
      const count = (c: string) => s.key.filter((x) => x === c).length;
      const first = s.turn === 0 ? 'red' : 'blue';
      expect(count(first)).toBe(9);
      expect(count(first === 'red' ? 'blue' : 'red')).toBe(8);
      expect(count('neutral')).toBe(7);
      expect(count('assassin')).toBe(1);
    }
  });
  it('ключ видят только капитаны', () => {
    const s = fresh();
    expect(g.view(s, 0).key.every((c) => c !== null)).toBe(true);
    expect(g.view(s, 1).key.every((c) => c !== null)).toBe(true);
    expect(g.view(s, 2).key.every((c) => c === null)).toBe(true);
    expect(JSON.stringify(g.view(s, 3))).not.toContain('assassin');
  });
});

describe('подсказка', () => {
  it('даёт капитан активной команды', () => {
    const s = fresh();
    const cap = s.turn;
    expect(g.currentSeats(s)).toEqual([cap]);
    expect(g.validate(s, 1 - cap, { t: 'clue', word: 'привет', number: 2 }).ok).toBe(false);
    expect(g.validate(s, cap, { t: 'guess', idx: 0 }).ok).toBe(false);
  });
  it('нельзя называть слово со стола, с пробелами и числа вне 0–9', () => {
    const s = fresh();
    const cap = s.turn;
    const word = s.words[3]!;
    expect(g.validate(s, cap, { t: 'clue', word, number: 1 })).toMatchObject({ ok: false });
    expect(g.validate(s, cap, { t: 'clue', word: word.toUpperCase(), number: 1 }).ok).toBe(false);
    expect(g.validate(s, cap, { t: 'clue', word: 'два слова', number: 1 }).ok).toBe(false);
    expect(g.validate(s, cap, { t: 'clue', word: 'цвет', number: 10 }).ok).toBe(false);
    expect(g.validate(s, cap, { t: 'clue', word: 'xyzzy', number: 2 }).ok).toBe(true);
  });
});

describe('угадывание', () => {
  const guessing = (s: CodenamesState, number = 2) => act(s, s.turn, { t: 'clue', word: 'подсказка', number });
  it('оперативники команды угадывают; свои слова — ход продолжается до лимита число+1', () => {
    let s = fresh();
    const team = s.turn === 0 ? 'red' : 'blue';
    s = guessing(s, 1);
    expect(g.currentSeats(s)).toEqual([s.turn + 2]);
    s = act(s, s.turn + 2, { t: 'guess', idx: idxOf(s, team, 0) });
    expect(s.turn).toBe(team === 'red' ? 0 : 1); // ещё можно
    s = act(s, s.turn + 2, { t: 'guess', idx: idxOf(s, team, 1) });
    expect(s.turn).toBe(team === 'red' ? 1 : 0); // лимит 2 исчерпан — ход перешёл
  });
  it('чужой агент и нейтральное слово завершают ход', () => {
    let s = fresh();
    const team = s.turn;
    s = guessing(s);
    s = act(s, team + 2, { t: 'guess', idx: idxOf(s, 'neutral') });
    expect(s.turn).toBe(1 - team);
    expect(s.revealed.filter(Boolean)).toHaveLength(1);
  });
  it('убийца — мгновенное поражение', () => {
    let s = fresh();
    const team = s.turn;
    s = guessing(s);
    s = act(s, team + 2, { t: 'guess', idx: idxOf(s, 'assassin') });
    expect(s.finished).toBe(true);
    expect(s.winner).toBe(1 - team);
    expect(g.outcome(s)).toMatchObject({ reason: 'assassin' });
  });
  it('все агенты команды открыты — победа', () => {
    let s = fresh();
    const team = s.turn;
    const color = team === 0 ? 'red' : 'blue';
    s = act(s, team, { t: 'clue', word: 'всё', number: 0 }); // 0 — без ограничения
    for (let i = 0; i < 9; i++) s = act(s, team + 2, { t: 'guess', idx: s.key.findIndex((c, k) => c === color && !s.revealed[k]) });
    expect(remaining(s, team)).toBe(0);
    expect(s.winner).toBe(team);
    expect(g.outcome(s)!.winners.every((p) => p % 2 === team)).toBe(true);
  });
  it('нельзя открыть слово дважды; завершить ход без догадок нельзя; таймаут пропускает', () => {
    let s = fresh();
    const team = s.turn;
    s = guessing(s);
    expect(g.validate(s, team + 2, { t: 'endTurn' }).ok).toBe(false);
    s = act(s, team + 2, { t: 'guess', idx: idxOf(s, team === 0 ? 'red' : 'blue') });
    expect(g.validate(s, team + 2, { t: 'guess', idx: s.revealed.indexOf(true) }).ok).toBe(false);
    expect(g.timeoutAction!(s, team + 2)).toEqual({ t: 'endTurn' });
    const t = g.apply(guessing(fresh()), 2, { t: 'skip' });
    expect(t.turn).not.toBe(fresh().turn);
  });
  it('капитаны не пишут в чат', () => {
    const s = fresh();
    expect(g.chatAllowed!(s, 0)).toBe(false);
    expect(g.chatAllowed!(s, 3)).toBe(true);
  });
});

describe('случайные партии', () => {
  it('всегда завершаются', () => {
    for (let n = 0; n < 60; n++) {
      const rng = createRng(`cr${n}`);
      let s = fresh(4 + (n % 7), `g${n}`);
      let steps = 0;
      while (!g.outcome(s)) {
        const seat = g.currentSeats(s)[0]!;
        const a: CodenamesAction = s.phase === 'clue' ? { t: 'clue', word: `слово${'абвгд'[rng.int(5)]}`, number: rng.int(3) + 1 } : g.legalActions(s, seat)[rng.int(g.legalActions(s, seat).length)]!;
        s = act(s, seat, a);
        if (++steps > 5000) throw new Error('не заканчивается');
      }
    }
  });
});
