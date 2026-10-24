import { describe, expect, it } from 'vitest';
import { hasProfanity, maskProfanity } from './profanity';

describe('фильтр мата', () => {
  it('маскирует грубые слова, включая искажения', () => {
    expect(maskProfanity('ну ты и хуйня')).toBe('ну ты и х****');
    expect(maskProfanity('пиздец')).toBe('п*****');
    expect(maskProfanity('ты сука')).toBe('ты с***');
    expect(maskProfanity('хуууй')).not.toContain('уу');
    expect(hasProfanity('БЛЯДЬ')).toBe(true);
    expect(hasProfanity('xуй')).toBe(true); // латинская x
  });
  it('не трогает обычные слова', () => {
    const ok = 'Ребята, хлеб на небо не похож; требуется ход, употребление зелья, ребус';
    expect(maskProfanity(ok)).toBe(ok);
    expect(hasProfanity('Привет! Сыграем в шахматы?')).toBe(false);
  });
});
