import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { aliasGame as g, explainerOf, TARGET, type AliasAction, type AliasState } from './index';

const act = (s: AliasState, a: AliasAction) => {
  const seat = explainerOf(s);
  const v = g.validate(s, seat, a);
  if (!v.ok) throw new Error(`${v.error}: ${JSON.stringify(a)}`);
  return g.apply(s, seat, a);
};
const fresh = (n = 4) => g.setup({ players: n, seed: 'al' });

describe('раунд', () => {
  it('объясняет игрок команды по очереди; слово видит только он', () => {
    let s = fresh(6);
    expect(explainerOf(s)).toBe(0); // красные: места 0,2,4
    expect(g.currentSeats(s)).toEqual([0]);
    expect(g.view(s, 0).word).toBeNull(); // пока не начат
    s = act(s, { t: 'start' });
    expect(g.view(s, 0).word).toBe(s.word);
    expect(g.view(s, 2).word).toBeNull();
    expect(g.view(s, 1).word).toBeNull();
  });
  it('очки: +1 за угаданное, −1 за пропуск; счёт не уходит ниже нуля', () => {
    let s = act(fresh(), { t: 'start' });
    s = act(s, { t: 'ok' });
    s = act(s, { t: 'ok' });
    s = act(s, { t: 'skip' });
    s = act(s, { t: 'endRound' });
    expect(s.scores).toEqual([1, 0]);
    expect(s.turn).toBe(1);
    expect(explainerOf(s)).toBe(1);
    s = act(s, { t: 'start' });
    s = act(s, { t: 'skip' });
    s = act(s, { t: 'skip' });
    s = act(s, { t: 'endRound' });
    expect(s.scores).toEqual([1, 0]);
  });
  it('слова не повторяются в раунде; пустой раунд — 0 очков; роли чередуются', () => {
    let s = act(fresh(4), { t: 'start' });
    const seen = new Set<string>([s.word!]);
    for (let i = 0; i < 20; i++) {
      s = act(s, { t: 'ok' });
      expect(seen.has(s.word!)).toBe(false);
      seen.add(s.word!);
    }
    s = act(s, { t: 'endRound' }); // красные #1
    s = act(s, { t: 'start' });
    s = act(s, { t: 'endRound' }); // синие #1
    expect(explainerOf(s)).toBe(2); // красные: теперь второй игрок команды
  });
  it('таймер не сбрасывается, пока слова сменяются', () => {
    const s0 = act(fresh(), { t: 'start' });
    const s1 = act(s0, { t: 'ok' });
    expect(g.keepDeadline!(s0, s1)).toBe(true);
    const s2 = act(s1, { t: 'endRound' });
    expect(g.keepDeadline!(s1, s2)).toBe(false);
    expect(g.keepDeadline!(fresh(), s0)).toBe(false); // старт раунда запускает отсчёт заново
  });
});

describe('конец игры', () => {
  it('цель набрана, но у второй команды ещё есть ход — играем дальше; при равных раундах побеждает лидер', () => {
    let s = fresh();
    s.scores = [TARGET - 1, 5];
    s = act(s, { t: 'start' });
    s = act(s, { t: 'ok' });
    s = act(s, { t: 'ok' });
    s = act(s, { t: 'endRound' }); // красные 31, но синие ещё не ходили в этом круге
    expect(s.finished).toBe(false);
    s = act(s, { t: 'start' });
    s = act(s, { t: 'ok' });
    s = act(s, { t: 'endRound' });
    expect(s.finished).toBe(true);
    expect(s.winner).toBe(0);
    expect(g.outcome(s)).toMatchObject({ winners: [0, 2], reason: 'points' });
  });
  it('ничья при равном счёте — игра продолжается', () => {
    let s = fresh();
    s.scores = [TARGET, TARGET];
    s.played = [1, 0];
    s.turn = 1;
    s = act(s, { t: 'start' });
    s = act(s, { t: 'endRound' });
    expect(s.finished).toBe(false);
  });
});

describe('чат', () => {
  it('объясняющему нельзя писать загаданное слово или его основу', () => {
    let s = act(fresh(), { t: 'start' });
    const w = s.word!;
    expect(g.chatFilter!(s, 0, `это ${w}!`)).toMatch(/Нельзя/);
    expect(g.chatFilter!(s, 0, `это ${w.slice(0, Math.max(3, w.length - 2)).toUpperCase()}ки`)).toMatch(/Нельзя/);
    expect(g.chatFilter!(s, 0, 'совсем другое описание')).toBeNull();
    expect(g.chatFilter!(s, 2, w)).toBeNull(); // угадывающие могут называть
    s = act(s, { t: 'endRound' });
    expect(g.chatFilter!(s, 1, w)).toBeNull();
  });
});

describe('случайные партии', () => {
  it('завершаются', () => {
    for (let n = 0; n < 40; n++) {
      const rng = createRng(`ar${n}`);
      let s = fresh(4 + (n % 9));
      let steps = 0;
      while (!g.outcome(s)) {
        const legal = g.legalActions(s, explainerOf(s));
        // чаще угадываем, иначе счёт не растёт
        const a = s.phase === 'play' && rng.next() < 0.8 ? ({ t: rng.next() < 0.85 ? 'ok' : 'skip' } as const) : legal[rng.int(legal.length)]!;
        s = act(s, a);
        if (++steps > 20000) throw new Error('не заканчивается');
      }
    }
  });
});
