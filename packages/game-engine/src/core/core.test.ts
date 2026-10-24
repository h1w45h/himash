import { describe, expect, it } from 'vitest';
import { createRng } from './rng';

describe('rng', () => {
  it('детерминирован по сиду', () => {
    const a = createRng('seed').shuffle([1, 2, 3, 4, 5, 6]);
    const b = createRng('seed').shuffle([1, 2, 3, 4, 5, 6]);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
