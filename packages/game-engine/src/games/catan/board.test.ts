import { describe, expect, it } from 'vitest';
import { BOARD, EDGE_COUNT, HEX_COUNT, VERT_COUNT } from './board';

describe('поле Катана', () => {
  it('19 гексов, 54 вершины, 72 дороги', () => {
    expect(HEX_COUNT).toBe(19);
    expect(VERT_COUNT).toBe(54);
    expect(EDGE_COUNT).toBe(72);
  });
  it('30 береговых рёбер, 9 гаваней на разных рёбрах без общих вершин', () => {
    expect(BOARD.edges.filter((e) => e.hexes.length === 1)).toHaveLength(30);
    const verts = BOARD.portEdges.flatMap((e) => [BOARD.edges[e]!.a, BOARD.edges[e]!.b]);
    expect(new Set(verts).size).toBe(18);
  });
  it('у каждой вершины 2–3 соседа', () => {
    for (const v of BOARD.verts) expect([2, 3]).toContain(v.adj.length);
  });
});
