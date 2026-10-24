import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { COLORS, newDeck, unoGame as g, type UnoAction, type UnoCard, type UnoState } from './index';

const num = (color: UnoCard['color'], n: number): UnoCard => ({ color, kind: 'num', n });
const act = (color: UnoCard['color'], kind: 'skip' | 'reverse' | 'draw2'): UnoCard => ({ color, kind });
const wild: UnoCard = { color: null, kind: 'wild' };
const wild4: UnoCard = { color: null, kind: 'wild4' };

function scene(hands: UnoCard[][], topCard: UnoCard, extra: Partial<UnoState> = {}): UnoState {
  const deck: UnoCard[] = Array.from({ length: 30 }, (_, i) => num(COLORS[i % 4]!, i % 10));
  return {
    players: hands.length, hands, deck, discard: [topCard], color: (topCard.color ?? 'R') as UnoState['color'],
    turn: 0, dir: 1, drawn: null, uncalled: null, rng: 7, winner: null, finished: false, log: [], ...extra,
  };
}
const go = (s: UnoState, seat: number, a: UnoAction) => {
  const v = g.validate(s, seat, a);
  if (!v.ok) throw new Error(`${v.error}: ${JSON.stringify(a)}`);
  return g.apply(s, seat, a);
};

describe('колода', () => {
  it('108 карт: 76 числовых, 24 действия, 8 диких', () => {
    const d = newDeck();
    expect(d).toHaveLength(108);
    expect(d.filter((c) => c.kind === 'num')).toHaveLength(76);
    expect(d.filter((c) => ['skip', 'reverse', 'draw2'].includes(c.kind))).toHaveLength(24);
    expect(d.filter((c) => c.color === null)).toHaveLength(8);
  });
  it('раздача: по 7 карт, стартовая карта числовая', () => {
    for (let n = 2; n <= 10; n++) {
      const s = g.setup({ players: n, seed: `u${n}` });
      expect(s.hands.every((h) => h.length === 7)).toBe(true);
      expect(s.discard[0]!.kind).toBe('num');
      expect(s.hands.flat().length + s.deck.length + s.discard.length).toBe(108);
    }
  });
});

describe('розыгрыш', () => {
  it('по цвету, номиналу и символу; чужая карта не подходит', () => {
    const s = scene([[num('R', 5), num('B', 5), num('G', 7), act('G', 'skip')], [num('Y', 1)]], num('R', 3));
    const plays = g.legalActions(s, 0).filter((a) => a.t === 'play').map((a) => (a as { card: UnoCard }).card);
    expect(plays).toContainEqual(num('R', 5));
    expect(plays).not.toContainEqual(num('B', 5));
    expect(plays).not.toContainEqual(num('G', 7));
    const t = scene([[num('B', 3), num('G', 7)], [num('Y', 1)]], num('R', 3));
    expect(g.legalActions(t, 0).some((a) => a.t === 'play' && (a.card as UnoCard).color === 'B')).toBe(true); // тот же номинал
  });
  it('«+4» только при отсутствии карт текущего цвета', () => {
    const s = scene([[wild4, num('R', 9)], [num('Y', 1)]], num('R', 3));
    expect(g.validate(s, 0, { t: 'play', card: wild4, color: 'B' }).ok).toBe(false);
    const t = scene([[wild4, num('G', 9)], [num('Y', 1)]], num('R', 3));
    expect(g.validate(t, 0, { t: 'play', card: wild4, color: 'B' }).ok).toBe(true);
  });
  it('дикая карта требует выбора цвета и меняет цвет', () => {
    const s = scene([[wild, num('G', 1)], [num('Y', 1)]], num('R', 3));
    expect(g.validate(s, 0, { t: 'play', card: wild }).ok).toBe(false);
    const t = go(s, 0, { t: 'play', card: wild, color: 'B' });
    expect(t.color).toBe('B');
    expect(t.turn).toBe(1);
  });
});

describe('эффекты', () => {
  const three = (c: UnoCard) => scene([[c, num('G', 1), num('G', 2)], [num('Y', 1)], [num('Y', 2)]], num('R', 3));
  it('пропуск', () => expect(go(three(act('R', 'skip')), 0, { t: 'play', card: act('R', 'skip') }).turn).toBe(2));
  it('разворот меняет направление', () => {
    const t = go(three(act('R', 'reverse')), 0, { t: 'play', card: act('R', 'reverse') });
    expect(t.dir).toBe(-1);
    expect(t.turn).toBe(2);
  });
  it('разворот вдвоём = пропуск', () => {
    const s = scene([[act('R', 'reverse'), num('G', 1), num('G', 2)], [num('Y', 1)]], num('R', 3));
    expect(go(s, 0, { t: 'play', card: act('R', 'reverse') }).turn).toBe(0);
  });
  it('+2 и +4: следующий берёт и пропускает', () => {
    let t = go(three(act('R', 'draw2')), 0, { t: 'play', card: act('R', 'draw2') });
    expect(t.hands[1]).toHaveLength(3);
    expect(t.turn).toBe(2);
    const s = scene([[wild4, num('G', 1), num('G', 2)], [num('Y', 1)], [num('Y', 2)]], num('R', 3));
    t = go(s, 0, { t: 'play', card: wild4, color: 'G' });
    expect(t.hands[1]).toHaveLength(5);
    expect(t.turn).toBe(2);
  });
});

describe('добор', () => {
  it('нечего играть → взять карту; подходящую можно сыграть или пропустить', () => {
    const s = scene([[num('B', 1)], [num('Y', 1)]], num('R', 3), { deck: [num('B', 9), num('R', 8)] }); // берут с конца: достанется R8
    let t = go(s, 0, { t: 'draw' }); // достаётся R8 (подходит по цвету)
    expect(t.drawn).toEqual(num('R', 8));
    expect(t.turn).toBe(0);
    expect(g.validate(t, 0, { t: 'draw' }).ok).toBe(false); // второй раз нельзя
    expect(g.validate(t, 0, { t: 'play', card: num('B', 1) }).ok).toBe(false); // только взятую
    const passed = go(t, 0, { t: 'pass' });
    expect(passed.turn).toBe(1);
    t = go(scene([[num('B', 1)], [num('Y', 1)]], num('R', 3), { deck: [num('B', 8), num('B', 9)] }), 0, { t: 'draw' });
    expect(t.turn).toBe(1); // неподходящая карта — ход переходит автоматически
  });
  it('колода пополняется из сброса', () => {
    const s = scene([[num('B', 1)], [num('Y', 1)]], num('R', 3), { deck: [], discard: [num('R', 1), num('R', 2), num('R', 3)] });
    const t = go(s, 0, { t: 'draw' });
    expect(t.hands[0]).toHaveLength(2);
    expect(t.discard).toHaveLength(1);
  });
});

describe('UNO и победа', () => {
  it('забыл сказать «UNO!» — следующий может поймать (+2)', () => {
    const s = scene([[num('R', 5), num('R', 6)], [num('Y', 1), num('Y', 2)]], num('R', 3));
    const t = go(s, 0, { t: 'play', card: num('R', 5) }); // без uno
    expect(t.uncalled).toBe(0);
    expect(g.legalActions(t, 1).some((a) => a.t === 'catch')).toBe(true);
    const c = go(t, 1, { t: 'catch' });
    expect(c.hands[0]).toHaveLength(3);
    expect(c.turn).toBe(1); // ход не расходуется
    expect(go(s, 0, { t: 'play', card: num('R', 5), uno: true }).uncalled).toBeNull();
  });
  it('победа первым опустевшим; штраф последней карты применяется', () => {
    const s = scene([[act('R', 'draw2')], [num('Y', 1)], [num('Y', 2)]], num('R', 3));
    const t = go(s, 0, { t: 'play', card: act('R', 'draw2') });
    expect(t.finished).toBe(true);
    expect(t.hands[1]).toHaveLength(3);
    expect(g.outcome(t)).toMatchObject({ winners: [0], ranking: [0, 2, 1] });
  });
  it('view скрывает чужие руки', () => {
    const s = g.setup({ players: 3, seed: 'v' });
    const v = g.view(s, 1);
    expect(v.hand).toEqual(s.hands[1]);
    expect(JSON.stringify(v)).not.toContain(JSON.stringify(s.hands[0]));
  });
});

describe('случайные партии', () => {
  it('партии заканчиваются, карты сохраняются; боты играют допустимо', () => {
    for (let n = 0; n < 150; n++) {
      const rng = createRng(`unorand${n}`);
      const useBots = n % 3 === 0;
      let s = g.setup({ players: 2 + (n % 9), seed: `r${n}` });
      let steps = 0;
      while (!g.outcome(s)) {
        const seat = s.turn;
        const legal = g.legalActions(s, seat);
        expect(legal.length).toBeGreaterThan(0);
        const a = useBots
          ? g.chooseBotAction!(s, seat, { level: (['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const)[n % 4]!, rngSeed: `${n}:${steps}` })
          : legal[rng.int(legal.length)]!;
        const v = g.validate(s, seat, a);
        if (!v.ok) throw new Error(`${v.error} ${JSON.stringify(a)}`);
        s = g.apply(s, seat, a);
        expect(s.hands.flat().length + s.deck.length + s.discard.length).toBe(108);
        if (++steps > 20000) throw new Error('не заканчивается');
      }
    }
  }, 60_000);
});
