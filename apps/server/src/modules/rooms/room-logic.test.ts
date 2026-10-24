import { describe, expect, it } from 'vitest';
import { firstFreeSeat, generateRoomCode } from './room-logic';

describe('generateRoomCode', () => {
  it('6 символов без похожих', () => {
    for (let i = 0; i < 200; i++) expect(generateRoomCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
  });
});

describe('firstFreeSeat', () => {
  it('находит дырку', () => expect(firstFreeSeat([0, 2, 3], 4)).toBe(1));
  it('null при заполнении', () => expect(firstFreeSeat([0, 1], 2)).toBeNull());
  it('пустая комната → 0', () => expect(firstFreeSeat([], 4)).toBe(0));
});
