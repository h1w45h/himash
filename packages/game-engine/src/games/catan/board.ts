/**
 * Геометрия поля «Катана»: 19 шестиугольников (осевые координаты, острый угол вверх),
 * 54 перекрёстка (вершины), 72 дороги (рёбра) и 30 береговых рёбер, из которых 9 — гавани.
 * Топология одна и та же во всех партиях; случайны только ресурсы, числа и типы гаваней.
 */
export interface BHex {
  q: number;
  r: number;
  /** Центр в единицах «радиус шестиугольника = 1». */
  x: number;
  y: number;
  verts: number[];
}
export interface BVert {
  x: number;
  y: number;
  hexes: number[];
  edges: number[];
  adj: number[];
}
export interface BEdge {
  a: number;
  b: number;
  hexes: number[];
}

const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

/** Кольцо радиуса k по часовой стрелке (на экране), начиная сверху. */
function ring(k: number): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  let q = 0;
  let r = -k;
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < k; j++) {
      out.push({ q, r });
      q += DIRS[i]![0];
      r += DIRS[i]![1];
    }
  }
  return out;
}

/** Порядок обхода гексов — по спирали: внешнее кольцо, внутреннее, центр (по нему раскладываются числа). */
export const HEX_ORDER = [...ring(2), ...ring(1), { q: 0, r: 0 }];

/** Расположение гаваней среди 30 береговых рёбер (чередование шагов 3-3-4). */
const PORT_SLOTS = [0, 3, 6, 10, 13, 16, 20, 23, 26];

function build() {
  const hexes: BHex[] = HEX_ORDER.map(({ q, r }) => ({ q, r, x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r, verts: [] }));
  const verts: BVert[] = [];
  const vIndex = new Map<string, number>();
  hexes.forEach((h, hi) => {
    for (let i = 0; i < 6; i++) {
      const ang = ((60 * i - 30) * Math.PI) / 180;
      const x = h.x + Math.cos(ang);
      const y = h.y + Math.sin(ang);
      const key = `${Math.round(x * 100)},${Math.round(y * 100)}`;
      let v = vIndex.get(key);
      if (v === undefined) {
        v = verts.length;
        vIndex.set(key, v);
        verts.push({ x, y, hexes: [], edges: [], adj: [] });
      }
      verts[v]!.hexes.push(hi);
      h.verts.push(v);
    }
  });
  const edges: BEdge[] = [];
  const eIndex = new Map<string, number>();
  hexes.forEach((h, hi) => {
    for (let i = 0; i < 6; i++) {
      const a = h.verts[i]!;
      const b = h.verts[(i + 1) % 6]!;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      let e = eIndex.get(key);
      if (e === undefined) {
        e = edges.length;
        eIndex.set(key, e);
        edges.push({ a, b, hexes: [] });
        verts[a]!.edges.push(e);
        verts[b]!.edges.push(e);
        verts[a]!.adj.push(b);
        verts[b]!.adj.push(a);
      }
      edges[e]!.hexes.push(hi);
    }
  });

  // Береговые рёбра в порядке обхода по периметру.
  const coastal = edges.map((e, i) => (e.hexes.length === 1 ? i : -1)).filter((i) => i >= 0);
  const order: number[] = [coastal[0]!];
  let end = edges[coastal[0]!]!.b;
  while (order.length < coastal.length) {
    const cur = order[order.length - 1]!;
    const next = coastal.find((e) => e !== cur && !order.includes(e) && (edges[e]!.a === end || edges[e]!.b === end))!;
    order.push(next);
    end = edges[next]!.a === end ? edges[next]!.b : edges[next]!.a;
  }
  const portEdges = PORT_SLOTS.map((i) => order[i]!);
  return { hexes, verts, edges, portEdges };
}

export const BOARD = build();
export const HEX_COUNT = BOARD.hexes.length;
export const VERT_COUNT = BOARD.verts.length;
export const EDGE_COUNT = BOARD.edges.length;

/** Вероятностные «точки» числа на жетоне (6 и 8 — по 5). */
export const PIPS = [0, 0, 1, 2, 3, 4, 5, 0, 5, 4, 3, 2, 1];
