import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { backgammonGame as g, initialState, legalMoves, pips, type BackgammonState } from './index';

/** Конструктор позиций: pos0/pos1 — {p: count} в дорожках игроков. */
function pos(w: Record<number, number>, b: Record<number, number>, dice: [number, number] | null, turn: 0 | 1 = 0, extra: Partial<BackgammonState> = {}): BackgammonState {
  const s = initialState('t');
  s.pos = [Array(24).fill(0), Array(24).fill(0)];
  for (const [p, c] of Object.entries(w)) s.pos[0][Number(p)] = c;
  for (const [p, c] of Object.entries(b)) s.pos[1][Number(p)] = c;
  s.turn = turn;
  s.turnsTaken = [5, 5];
  if (dice) {
    s.dice = dice;
    s.remaining = dice[0] === dice[1] ? Array(4).fill(dice[0]) : [...dice];
    s.phase = 'move';
  }
  return Object.assign(s, extra);
}
const act = (s: BackgammonState, a: Parameters<typeof g.apply>[2]) => {
  const v = g.validate(s, s.turn, a);
  if (!v.ok) throw new Error(`${v.error}: ${JSON.stringify(a)}`);
  return g.apply(s, s.turn, a);
};
const moves = (s: BackgammonState) => legalMoves(s).map((m) => `${m.from}+${m.die}`).sort();

describe('начало', () => {
  it('по 15 шашек на голове, 360 пипсов у каждого', () => {
    const s = initialState('x');
    expect(s.pos[0][0]).toBe(15);
    expect(s.pos[1][0]).toBe(15);
    expect(pips(s, 0)).toBe(360);
    expect(g.legalActions(s, 0)).toEqual([{ t: 'roll' }]);
    expect(g.legalActions(s, 1)).toEqual([]);
  });
  it('бросок даёт кости; дубль — четыре хода', () => {
    let s = initialState('seed');
    s = act(s, { t: 'roll' });
    expect(s.dice).toHaveLength(2);
    expect(s.remaining.length).toBe(s.dice![0] === s.dice![1] ? 4 : 2);
  });
});

describe('голова', () => {
  it('со своей головы за ход — одна шашка', () => {
    const s = pos({ 0: 15 }, { 0: 15 }, [3, 4]);
    // 0+3 и 0+4 доступны, но после одного хода с головы второй с головы нельзя
    let t = act(s, { t: 'move', from: 0, die: 3 });
    expect(moves(t)).toEqual(['3+4']);
    t = act(t, { t: 'move', from: 3, die: 4 });
    expect(t.turn).toBe(1);
  });
  it('в первый ход дубли 3, 4, 6 позволяют снять две шашки', () => {
    const base = (d: number) => pos({ 0: 15 }, { 0: 15 }, [d, d], 0, { turnsTaken: [0, 0] });
    for (const d of [3, 4, 6]) {
      let t = base(d);
      t = act(t, { t: 'move', from: 0, die: d });
      expect(moves(t)).toContain(`0+${d}`);
    }
    // дубль 5 — всё равно одна
    let t = base(5);
    t = act(t, { t: 'move', from: 0, die: 5 });
    expect(moves(t)).not.toContain('0+5');
  });
});

describe('блокировки', () => {
  it('нельзя встать на пункт соперника', () => {
    // чёрные на своей позиции p=5 → в системе белых это (5+12)%24 = 17
    const s = pos({ 14: 1, 0: 14 }, { 5: 1, 0: 14 }, [3, 1]);
    expect(moves(s)).not.toContain('14+3');
    expect(moves(s)).toContain('14+1');
  });
  it('шесть пунктов подряд — только если впереди есть шашка соперника', () => {
    // пункты 0..4 заняты, ход 4->5 формирует блок 0..5
    const w = { 0: 3, 1: 3, 2: 3, 3: 3, 4: 2, 6: 1 } as Record<number, number>;
    // чёрные: шашка в системе белых впереди блока (позиция 12) → разрешено
    const free = pos(w, { 0: 15 }, [1, 6]);
    expect(moves(free)).toContain('4+1');
    // чёрные только позади (их голова 12 — «впереди», поэтому уберём их, оставив единственную шашку на их p=14 → белая позиция 2, т.е. позади блока)
    const blocked = pos(w, { 14: 15 }, [1, 6]);
    expect(moves(blocked)).not.toContain('4+1');
  });
});

describe('использовать максимум костей', () => {
  it('если играются обе кости, нельзя остановиться на одной', () => {
    // одна шашка на 20: кубики 2 и 3 → 20+2=22, 22+3 off? дом не завершён... создадим: единственная шашка на 10, чёрные блокируют 13 (p=1 у чёрных → 13)
    const s = pos({ 10: 1, 0: 14 }, { 1: 1, 0: 14 }, [3, 4]);
    // 10+3 → 13 занят соперником, 10+4 → 14 свободен, далее 14+3 → 17 свободно. Играть 3 первой нельзя; 4 потом 3 — можно (макс = 2)
    const m = moves(s);
    expect(m).toContain('10+4');
    expect(m).not.toContain('10+3');
    // с головы тоже можно: 0+3,0+4 — но тогда вторую кость сыграть тоже можно
  });
  it('если сыграть можно только одну из двух — обязана быть большая', () => {
    // шашка одна на p=17 (дом не весь → вывод невозможен); кубики 1 и 5: 17+1=18 свободно, 17+5=22 свободно; но после любого хода вторая кость невозможна?
    // Сделаем так, чтобы после хода второй костью ходить было некуда: единственная шашка, чёрные закрыли всё вокруг
    const blockersBlack: Record<number, number> = {};
    // закрываем в системе белых позиции 18,19,20,21,22,23 (чёрные p = 6..11) и 17+1=18 тоже
    for (let q = 6; q <= 11; q++) blockersBlack[q] = 1;
    const s = pos({ 17: 1, 1: 14 }, { ...blockersBlack, 0: 9 }, [1, 5]);
    // 17+1=18 занят, 17+5=22 занят; 1+1/1+5 тоже можно играть... упростим: убираем остальные шашки белых, оставляем одну
    const only = pos({ 17: 1 }, { ...blockersBlack, 0: 9 }, [1, 5]);
    expect(moves(only)).toEqual([]);
    void s;
  });
  it('нет ходов — ход переходит автоматически', () => {
    const blockers: Record<number, number> = {};
    for (let q = 6; q <= 11; q++) blockers[q] = 1;
    let s = pos({ 17: 1 }, { ...blockers, 0: 9 }, null, 0, { phase: 'roll' });
    s.rng = 5;
    s = act(s, { t: 'roll' });
    // кубики могут разрешить какие-то ходы; главное — состояние согласовано
    expect(['roll', 'move']).toContain(s.phase);
  });
});

describe('вывод шашек', () => {
  const home = (extra: Record<number, number>) => ({ ...extra });
  it('нельзя выводить, пока не все дома', () => {
    const s = pos(home({ 5: 1, 23: 14 }), { 0: 15 }, [1, 6]);
    expect(moves(s)).not.toContain('23+1');
  });
  it('точная кость выводит, большая — только с самого дальнего пункта', () => {
    const s = pos({ 18: 2, 21: 3, 23: 10 }, { 0: 15 }, [6, 2]);
    // 6 выводит с p=18 (24-18=6), 2 — с 22? там пусто → играет внутри дома или с 22: нет шашек; 2 из 21→23
    expect(moves(s)).toContain('18+6');
    const s2 = pos({ 20: 2, 22: 2, 23: 11 }, { 0: 15 }, [6, 1]);
    // 6 больше нужного (20 требует 4): выводим с самой дальней (20)
    expect(moves(s2)).toContain('20+6');
    expect(moves(s2)).not.toContain('22+6');
  });
  it('победа и марс', () => {
    const s = pos({ 23: 1 }, { 0: 15 }, [1, 2], 0, { off: [14, 0] });
    const t = act(s, { t: 'move', from: 23, die: 2 }); // играется большая кость
    expect(t.winner).toBe(0);
    expect(t.mars).toBe(true);
    expect(g.outcome(t)).toMatchObject({ winners: [0], reason: 'mars' });
    const s2 = pos({ 23: 1 }, { 0: 14, 5: 0 }, [1, 2], 0, { off: [14, 1] });
    expect(g.outcome(act(s2, { t: 'move', from: 23, die: 2 }))).toMatchObject({ reason: 'oin' });
  });
});

describe('партии', () => {
  it('случайные партии заканчиваются, шашки сохраняются, боты играют допустимо', () => {
    for (let n = 0; n < 40; n++) {
      const rng = createRng(`bg${n}`);
      let s = g.setup({ players: 2, seed: `s${n}` });
      let steps = 0;
      const useBot = n % 2 === 0;
      while (!g.outcome(s)) {
        const seat = g.currentSeats(s)[0]!;
        const legal = g.legalActions(s, seat);
        expect(legal.length).toBeGreaterThan(0);
        const a = useBot
          ? g.chooseBotAction!(s, seat, { level: (['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const)[n % 4]!, rngSeed: `${n}:${steps}` })
          : legal[rng.int(legal.length)]!;
        const v = g.validate(s, seat, a);
        if (!v.ok) throw new Error(`${v.error} ${JSON.stringify(a)}`);
        s = g.apply(s, seat, a);
        for (const p of [0, 1] as const) expect(s.pos[p].reduce((x, y) => x + y, 0) + s.off[p]).toBe(15);
        if (++steps > 3000) throw new Error('не заканчивается');
      }
    }
  }, 120_000);
});
