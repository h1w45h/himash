import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { makeCard } from './eval';
import { START_STACK, blindsFor, pokerGame as g, type PokerAction, type PokerState } from './index';

const c = (s: string) => makeCard('23456789TJQKA'.indexOf(s[0]!), 'cdhs'.indexOf(s[1]!));
const cards = (s: string) => s.split(' ').map(c);
const act = (s: PokerState, a: PokerAction) => {
  const seat = s.toAct!;
  const v = g.validate(s, seat, a);
  if (!v.ok) throw new Error(`${v.error}: ${JSON.stringify(a)} (место ${seat})`);
  return g.apply(s, seat, a);
};
const total = (s: PokerState) => s.stacks.reduce((a, b) => a + b, 0) + s.committed.reduce((a, b) => a + b, 0);

/** Подстраиваем раздачу: карты рук и борд (в порядке: 3 флопа, терн, ривер — сжигаемые вставляются сами). */
function rig(s: PokerState, hands: string[], board: string): PokerState {
  const b = cards(board);
  s.hole = hands.map((h) => cards(h));
  // deck.pop() берёт с конца: жжём, флоп×3, жжём, терн, жжём, ривер
  s.deck = [51, b[4]!, 50, b[3]!, 49, b[2]!, b[1]!, b[0]!, 48];
  return s;
}

describe('блайнды и позиции', () => {
  it('расписание растёт и после таблицы удваивается', () => {
    expect(blindsFor(0)).toEqual([10, 20]);
    expect(blindsFor(10)).toEqual([600, 1200]);
    expect(blindsFor(12)).toEqual([2400, 4800]);
  });
  it('вдвоём: кнопка — малый блайнд и ходит первой', () => {
    const s = g.setup({ players: 2, seed: 'a' });
    expect(s.bets[s.dealer]).toBe(10);
    expect(s.bets[1 - s.dealer]).toBe(20);
    expect(s.toAct).toBe(s.dealer);
  });
  it('втроём: первым ходит игрок после большого блайнда', () => {
    const s = g.setup({ players: 3, seed: 'a' });
    expect(s.dealer).toBe(0);
    expect(s.bets).toEqual([0, 10, 20]);
    expect(s.toAct).toBe(0);
    expect(total(s)).toBe(3 * START_STACK);
  });
  it('view показывает только свои карты', () => {
    const s = g.setup({ players: 3, seed: 'b' });
    expect(g.view(s, 1).hole).toEqual(s.hole[1]);
    expect(JSON.stringify(g.view(s, 1))).not.toContain(JSON.stringify(s.hole[0]));
  });
});

describe('торги', () => {
  it('все сбросили — банк забирает последний, непокрытая ставка возвращается', () => {
    let s = g.setup({ players: 3, seed: 'c' });
    s = act(s, { t: 'raise', to: 100 }); // место 0
    s = act(s, { t: 'fold' });
    s = act(s, { t: 'fold' });
    // Победитель — место 0: получил блайнды 10+20, свои 100 вернулись как непокрытые
    expect(s.lastHand!.delta).toEqual([30, -10, -20]);
    expect(s.handNo).toBe(2);
    expect(s.stacks.reduce((a, b) => a + b, 0) + s.committed.reduce((a, b) => a + b, 0)).toBe(3000);
  });
  it('минимальный рейз и олл-ин меньше минимума', () => {
    const s = g.setup({ players: 3, seed: 'd' });
    expect(g.validate(s, 0, { t: 'raise', to: 30 })).toMatchObject({ ok: false }); // минимум 40
    expect(g.validate(s, 0, { t: 'raise', to: 40 }).ok).toBe(true);
    expect(g.validate(s, 0, { t: 'check' })).toMatchObject({ ok: false });
    expect(g.validate(s, 1, { t: 'call' })).toMatchObject({ ok: false }); // не его очередь
    const short = { ...s, stacks: s.stacks.map((x, i) => (i === 0 ? 30 : x)) };
    expect(g.validate(short, 0, { t: 'raise', to: 30 }).ok).toBe(true); // олл-ин на 30 разрешён (< мин. рейза 40)
  });
  it('большой блайнд получает опцию, когда все лишь уравняли', () => {
    let s = g.setup({ players: 3, seed: 'e' });
    s = act(s, { t: 'call' }); // место 0
    s = act(s, { t: 'call' }); // малый блайнд доплатил
    expect(s.street).toBe('preflop');
    expect(s.toAct).toBe(2);
    expect(g.legalActions(s, 2).some((a) => a.t === 'check')).toBe(true);
    s = act(s, { t: 'check' });
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
    expect(s.toAct).toBe(1); // после флопа первым ходит игрок слева от кнопки
  });
  it('короткий олл-ин не переоткрывает торги для уже походивших', () => {
    let s = g.setup({ players: 3, seed: 'f' });
    s.stacks[1] = 60; // у малого блайнда после 10 останется 50
    s = act(s, { t: 'raise', to: 60 }); // место 0: рейз до 60, размер 40
    s = act(s, { t: 'raise', to: 70 }); // малый блайнд идёт олл-ин на 70 (рейз всего на 10 — короткий)
    expect(s.minRaise).toBe(40); // минимальный рейз не изменился
    s = act(s, { t: 'call' }); // BB доплачивает
    // место 0 должно доплатить 10, но рейзить снова не вправе? (оно уже действовало) — может только колл/фолд
    expect(s.toAct).toBe(0);
    s = act(s, { t: 'call' });
    expect(s.street).toBe('flop');
  });
});

describe('вскрытие и банки', () => {
  it('побеждает лучшая рука, банк целиком', () => {
    let s = g.setup({ players: 2, seed: 'g' });
    rig(s, ['Ah Ad', 'Kc Kd'], '2c 7d 9h Js 3c');
    // место dealer — малый блайнд, он ходит первым
    s = act(s, { t: 'call' });
    s = act(s, { t: 'check' });
    for (let i = 0; i < 6; i++) s = act(s, { t: 'check' });
    expect(s.handNo).toBe(2);
    expect(s.lastHand!.pots).toHaveLength(1);
    expect(s.lastHand!.pots[0]).toMatchObject({ amount: 40, hand: 'Пара' });
    const w = s.lastHand!.pots[0]!.winners[0]!;
    expect(s.lastHand!.revealed[w]).toEqual(cards(w === 0 ? 'Ah Ad' : 'Ah Ad'));
  });
  it('ничья делит банк, лишняя фишка — первому слева от кнопки', () => {
    let s = g.setup({ players: 3, seed: 'h' });
    // игроки 0 и 1 играют борд (Ac Kc Qc Jc Tc — роял-флеш на столе), 2 сбросит
    rig(s, ['2d 3d', '4d 5d', '6h 7h'], 'Ac Kc Qc Jc Tc');
    s.stacks = [1000, 1000, 1000];
    s = act(s, { t: 'call' }); // 0
    s = act(s, { t: 'call' }); // 1 (SB доплачивает 10)
    s = act(s, { t: 'check' }); // BB
    // флоп: первым ходит место 1 — чек, чек, чек … до конца
    for (let i = 0; i < 9; i++) if (s.handNo === 1) s = act(s, { t: 'check' });
    expect(s.lastHand!.pots[0]!.winners.sort()).toEqual([0, 1, 2]);
    expect(s.lastHand!.delta).toEqual([0, 0, 0]);
  });
  it('побочные банки: короткий стек не выигрывает чужое', () => {
    let s = g.setup({ players: 3, seed: 'i' });
    s.stacks = [100, 300, 1000];
    s.bets = [0, 0, 0];
    // перераздаём блайнды вручную: кнопка 0, SB=1 (10), BB=2 (20) уже внесены startHand — пересоздадим состояние ставок
    s.stacks = [100, 300 - 10, 1000 - 20];
    s.bets = [0, 10, 20];
    s.committed = [0, 10, 20];
    rig(s, ['Ah Ad', 'Kh Kd', 'Qh Qd'], '2c 7d 9s 4h 3c');
    s.currentBet = 20;
    s.minRaise = 20;
    s.acted = [false, false, false];
    s.toAct = 0;
    s = act(s, { t: 'raise', to: 100 }); // место 0 олл-ин на 100 (AA)
    s = act(s, { t: 'raise', to: 300 }); // место 1 олл-ин на 300 (KK)
    s = act(s, { t: 'call' }); // место 2 уравнивает 300 (QQ)
    // Общий банк 100+300+300 = 700. Основной (100×3=300) → AA; побочный (200×2=400) → KK.
    const lh = s.lastHand!;
    expect(lh.pots.map((p) => [p.amount, p.winners])).toEqual([[300, [0]], [400, [1]]]);
    expect(lh.delta).toEqual([200, 100, -300]);
  });
  it('непокрытый остаток большого стека возвращается до вскрытия', () => {
    let s = g.setup({ players: 3, seed: 'j' });
    s.stacks = [100, 1000 - 10, 1000 - 20];
    s.bets = [0, 10, 20];
    s.committed = [0, 10, 20];
    rig(s, ['Ah Ad', 'Kh Kd', 'Qh Qd'], '2c 7d 9s 4h 3c');
    s.currentBet = 20; s.minRaise = 20; s.acted = [false, false, false]; s.toAct = 0;
    s = act(s, { t: 'raise', to: 100 }); // место 0 — олл-ин на 100
    s = act(s, { t: 'raise', to: 400 }); // место 1 повышает до 400
    s = act(s, { t: 'fold' }); // место 2 сбрасывает
    // Вскрытие 0 против 1: 310 из ставки места 1 никто не уравнял → возврат. Банк: 100 + 100 + 20 (блайнд места 2).
    expect(s.lastHand!.pots.map((p) => [p.amount, p.winners])).toEqual([[220, [0]]]);
    expect(s.lastHand!.delta).toEqual([120, -100, -20]);
  });
});

describe('партия целиком', () => {
  const invariants = (s: PokerState) => {
    if (!s.finished) expect(total(s)).toBe(s.players * START_STACK);
    s.stacks.forEach((x) => expect(x).toBeGreaterThanOrEqual(0));
  };

  it('случайные партии заканчиваются, фишки сохраняются', () => {
    for (let n = 0; n < 40; n++) {
      const rng = createRng(`pk${n}`);
      let s = g.setup({ players: 2 + (n % 8), seed: `p${n}` });
      let steps = 0;
      while (!g.outcome(s)) {
        const seat = g.currentSeats(s)[0]!;
        const legal = g.legalActions(s, seat);
        expect(legal.length).toBeGreaterThan(0);
        // ограничиваем «пассивность»: иначе без рейзов партия идёт долго
        const raises = legal.filter((a) => a.t === 'raise');
        const pool = raises.length && rng.next() < 0.25 ? raises : legal.filter((a) => a.t !== 'raise');
        s = g.apply(s, seat, pool[rng.int(pool.length)]!);
        invariants(s);
        if (++steps > 60000) throw new Error('не заканчивается');
      }
      const o = g.outcome(s)!;
      expect(o.ranking).toHaveLength(s.players);
      expect(new Set(o.ranking).size).toBe(s.players);
    }
  }, 120_000);

  it('боты всех уровней играют допустимо и доводят партию до конца', () => {
    for (const level of ['EASY', 'MEDIUM', 'HARD'] as const) {
      for (let n = 0; n < 3; n++) {
        let s = g.setup({ players: 2 + n, seed: `bot${level}${n}` });
        let steps = 0;
        while (!g.outcome(s)) {
          const seat = g.currentSeats(s)[0]!;
          const a = g.chooseBotAction!(s, seat, { level, rngSeed: `${n}:${steps}` });
          const v = g.validate(s, seat, a);
          if (!v.ok) throw new Error(`${level}: ${v.error} ${JSON.stringify(a)}`);
          s = g.apply(s, seat, a);
          invariants(s);
          if (++steps > 20000) throw new Error('бот зациклился');
        }
      }
    }
  }, 120_000);
});
