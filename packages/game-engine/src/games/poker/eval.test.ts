import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { evaluate, categoryOf, handName, makeCard, rankOf, suitOf } from './eval';

/** Запись вроде 'Ah Kh Qh Jh Th'. Масти: c d h s → 0 1 2 3. */
const hand = (s: string) =>
  s.split(' ').map((t) => makeCard('23456789TJQKA'.indexOf(t[0]!), 'cdhs'.indexOf(t[1]!)));
const v = (s: string) => evaluate(hand(s));

describe('категории', () => {
  it.each([
    ['Ah Kh Qh Jh Th', 'Роял-флеш'],
    ['9h 8h 7h 6h 5h', 'Стрит-флеш'],
    ['9c 9d 9h 9s 2c', 'Каре'],
    ['Kc Kd Kh 2s 2c', 'Фулл-хаус'],
    ['Ac 9c 7c 5c 2c', 'Флеш'],
    ['9c 8d 7h 6s 5c', 'Стрит'],
    ['Qc Qd Qh 7s 2c', 'Тройка'],
    ['Jc Jd 4h 4s 2c', 'Две пары'],
    ['Tc Td 7h 5s 2c', 'Пара'],
    ['Ac Kd 9h 5s 2c', 'Старшая карта'],
  ])('%s → %s', (cards, name) => expect(handName(v(cards))).toBe(name));

  it('колесо A-2-3-4-5 — младший стрит; стрит-флеш на колесе', () => {
    expect(handName(v('Ac 2d 3h 4s 5c'))).toBe('Стрит');
    expect(v('Ac 2d 3h 4s 5c')).toBeLessThan(v('2c 3d 4h 5s 6c'));
    expect(handName(v('Ah 2h 3h 4h 5h'))).toBe('Стрит-флеш');
  });
  it('нет «стрита через туза»: Q-K-A-2-3', () => {
    expect(categoryOf(v('Qc Kd Ah 2s 3c'))).toBe(0);
  });
});

describe('сравнение', () => {
  it('категория сильнее кикеров', () => {
    expect(v('2c 2d 3h 4s 6c')).toBeGreaterThan(v('Ac Kd Qh Js 9c'));
    expect(v('Ac 9c 7c 5c 2c')).toBeGreaterThan(v('Tc Td Th 7s 2c'));
  });
  it('кикеры пары', () => {
    expect(v('9c 9d Ah 5s 2c')).toBeGreaterThan(v('9h 9s Kc Qd Jh'));
    expect(v('9c 9d Ah 5s 2c')).toBe(v('9h 9s Ac 5d 2h'));
  });
  it('две пары: старшая пара, затем младшая, затем кикер', () => {
    expect(v('Kc Kd 3h 3s 9c')).toBeGreaterThan(v('Qc Qd Jh Js Ac'));
    expect(v('Kc Kd 5h 5s 9c')).toBeGreaterThan(v('Kh Ks 4h 4d Ac'));
  });
  it('фулл-хаус: тройка важнее пары', () => {
    expect(v('3c 3d 3h As Ac')).toBeLessThan(v('4c 4d 4h 2s 2c'));
  });
});

describe('7 карт', () => {
  it('лучшие пять из семи', () => {
    expect(handName(v('Ah Kh 2c 3d Qh Jh Th'))).toBe('Роял-флеш');
    expect(handName(v('Kc Kd Kh 2s 2c 2d 9h'))).toBe('Фулл-хаус'); // две тройки → фулл-хаус K на 2
    expect(v('Kc Kd Kh 2s 2c 2d 9h')).toBe(v('Kc Kd Kh 2s 2c 9h 8d'));
    expect(handName(v('Ac Ad 5h 5s 9c 9d Kh'))).toBe('Две пары');
    expect(v('Ac Ad 5h 5s 9c 9d Kh')).toBe(v('Ac Ad 9h 9s 5c 5d Kh')); // из трёх пар берутся две старшие, кикер — лучшая из оставшихся
  });
  it('флеш из 6 карт берёт старшие пять; стрит и флеш одновременно — флеш', () => {
    expect(v('Ac Kc 9c 7c 4c 2c 3d')).toBe(v('Ac Kc 9c 7c 4c 5d 6d'));
    expect(handName(v('9h 8h 7h 6h 2h 5d 4s'))).toBe('Флеш'); // 9-8-7-6-5 стрит есть, но флеш сильнее
  });
  it('согласуется с перебором всех пятёрок на случайных раздачах', () => {
    // Эталон: максимум по 5-карточным подмножествам (каждая оценка независима от 7-карточного кода).
    const best5 = (c: number[]) => {
      let best = -1;
      for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
        const five = c.filter((_, i) => i !== a && i !== b);
        best = Math.max(best, evaluate(five));
      }
      return best;
    };
    const rng = createRng('poker-eval');
    for (let n = 0; n < 3000; n++) {
      const deck = rng.shuffle(Array.from({ length: 52 }, (_, i) => i));
      const cards = deck.slice(0, 7);
      expect(evaluate(cards)).toBe(best5(cards));
    }
  });
  it('частоты категорий на 7 картах близки к теоретическим', () => {
    const rng = createRng('freq');
    const n = 40000;
    const cnt = new Array(9).fill(0);
    for (let i = 0; i < n; i++) cnt[categoryOf(evaluate(rng.shuffle(Array.from({ length: 52 }, (_, k) => k)).slice(0, 7)))]++;
    // Теория (7 карт): пара ≈ 43.8%, две пары ≈ 23.5%, старшая ≈ 17.4%, тройка ≈ 4.8%, стрит ≈ 4.6%, флеш ≈ 3.0%, фулл-хаус ≈ 2.6%
    const pct = (k: number) => (cnt[k] / n) * 100;
    expect(pct(1)).toBeGreaterThan(41); expect(pct(1)).toBeLessThan(46);
    expect(pct(2)).toBeGreaterThan(21.5); expect(pct(2)).toBeLessThan(25.5);
    expect(pct(0)).toBeGreaterThan(15.5); expect(pct(0)).toBeLessThan(19.5);
    expect(pct(6)).toBeGreaterThan(2); expect(pct(6)).toBeLessThan(3.3);
    expect(pct(7)).toBeLessThan(0.4);
  });
  it('служебные функции', () => {
    expect(rankOf(makeCard(12, 3))).toBe(12);
    expect(suitOf(makeCard(5, 2))).toBe(2);
  });
});
