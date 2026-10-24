import { createRng } from '../../core/rng';
import { fail, ok, type BotContext, type GameDefinition, type Outcome, type Seat } from '../../core/types';

/**
 * Азул. 2–4 игрока. 100 плиток пяти цветов, «фабрики» (по 4 плитки), центр стола, личные поля игроков:
 * 5 линий заготовок (длиной 1…5), стена 5×5 и штрафная полоса. Подробности подсчёта — в правилах игры.
 */
export const COLORS = 5;
export const COLOR_NAMES = ['синий', 'жёлтый', 'красный', 'чёрный', 'белый'] as const;
export const FLOOR_PENALTY = [-1, -1, -2, -2, -2, -3, -3];

export interface PlayerBoard {
  /** Линии заготовок: цвет (−1 — пусто) и число плиток. */
  lines: { color: number; count: number }[];
  /** Стена: wall[r][c] = true, если плитка уложена. Цвет клетки (r, c) = (c − r) mod 5. */
  wall: boolean[][];
  /** Штрафная полоса: цвета плиток; 5 = маркер первого игрока. */
  floor: number[];
}

export interface AzulState {
  players: number;
  bag: number[];
  discard: number[];
  factories: number[][];
  center: number[];
  /** Маркер первого игрока лежит в центре. */
  marker: boolean;
  boards: PlayerBoard[];
  scores: number[];
  turn: Seat;
  /** Кто начнёт следующий раунд (взявший маркер). */
  nextFirst: Seat;
  round: number;
  rng: number;
  log: string[];
  finished: boolean;
  /** Бонусы конца игры (для показа). */
  bonuses: number[] | null;
}

export type AzulAction = {
  t: 'draft';
  /** Номер фабрики или −1 — центр. */
  source: number;
  color: number;
  /** Линия заготовок 0…4 или 5 — сразу на пол. */
  line: number;
};

export const wallColumn = (row: number, color: number) => (color + row) % COLORS;
const factoriesFor = (players: number) => players * 2 + 1;
const clone = (s: AzulState): AzulState => JSON.parse(JSON.stringify(s)) as AzulState;
const zeros = () => Array<number>(COLORS).fill(0);
const log = (s: AzulState, t: string) => {
  s.log.push(t);
  if (s.log.length > 12) s.log.shift();
};
const name = (seat: Seat) => `Игрок ${seat + 1}`;

function emptyBoard(): PlayerBoard {
  return {
    lines: Array.from({ length: 5 }, () => ({ color: -1, count: 0 })),
    wall: Array.from({ length: 5 }, () => Array<boolean>(5).fill(false)),
    floor: [],
  };
}

/** Тянет плитку из мешка; если он пуст — переносит сброс в мешок. Возвращает цвет или −1. */
function drawTile(s: AzulState, rng: ReturnType<typeof createRng>): number {
  if (s.bag.length === 0 && s.discard.length) {
    s.bag = rng.shuffle(s.discard);
    s.discard = [];
  }
  return s.bag.length ? (s.bag.pop() as number) : -1;
}

function fillFactories(s: AzulState) {
  const rng = createRng(s.rng);
  s.factories = Array.from({ length: factoriesFor(s.players) }, () => zeros());
  for (const f of s.factories) {
    for (let i = 0; i < 4; i++) {
      const t = drawTile(s, rng);
      if (t >= 0) f[t]!++;
    }
  }
  s.rng = rng.state;
  s.center = zeros();
  s.marker = true;
}

export function canPlaceOnLine(b: PlayerBoard, line: number, color: number): boolean {
  if (line === 5) return true;
  const l = b.lines[line]!;
  if (l.count === line + 1) return false; // линия заполнена
  if (l.color !== -1 && l.color !== color) return false;
  return !b.wall[line]![wallColumn(line, color)]; // этот цвет уже лежит в строке стены
}

/** Очки за укладку плитки в (r, c) с учётом соседей. */
export function placementScore(wall: boolean[][], r: number, c: number): number {
  let h = 1;
  for (let x = c - 1; x >= 0 && wall[r]![x]; x--) h++;
  for (let x = c + 1; x < 5 && wall[r]![x]; x++) h++;
  let v = 1;
  for (let y = r - 1; y >= 0 && wall[y]![c]; y--) v++;
  for (let y = r + 1; y < 5 && wall[y]![c]; y++) v++;
  if (h === 1 && v === 1) return 1;
  return (h > 1 ? h : 0) + (v > 1 ? v : 0);
}

function floorPenalty(floorCount: number): number {
  let p = 0;
  for (let i = 0; i < Math.min(floorCount, FLOOR_PENALTY.length); i++) p += FLOOR_PENALTY[i]!;
  return p;
}

/** Конец раунда: плитки с заполненных линий ложатся на стену, начисляются очки и штрафы. */
function scoreRound(s: AzulState) {
  for (let p = 0; p < s.players; p++) {
    const b = s.boards[p]!;
    let gain = 0;
    for (let r = 0; r < 5; r++) {
      const l = b.lines[r]!;
      if (l.count === r + 1) {
        const c = wallColumn(r, l.color);
        b.wall[r]![c] = true;
        gain += placementScore(b.wall, r, c);
        for (let i = 0; i < r; i++) s.discard.push(l.color); // остальные плитки линии уходят в сброс
        l.color = -1;
        l.count = 0;
      }
    }
    const pen = floorPenalty(b.floor.length);
    s.scores[p] = Math.max(0, s.scores[p]! + gain + pen);
    for (const t of b.floor) if (t < COLORS) s.discard.push(t);
    b.floor = [];
    log(s, `${name(p)}: +${gain}${pen ? ` ${pen}` : ''} (всего ${s.scores[p]}).`);
  }
}

export function wallRowComplete(b: PlayerBoard): boolean {
  return b.wall.some((row) => row.every(Boolean));
}

function endBonuses(s: AzulState): number[] {
  return s.boards.map((b) => {
    let bonus = 0;
    for (let r = 0; r < 5; r++) if (b.wall[r]!.every(Boolean)) bonus += 2;
    for (let c = 0; c < 5; c++) if (b.wall.every((row) => row[c])) bonus += 7;
    for (let k = 0; k < COLORS; k++) if (Array.from({ length: 5 }, (_, r) => b.wall[r]![wallColumn(r, k)]).every(Boolean)) bonus += 10;
    return bonus;
  });
}

export function sources(s: AzulState): { source: number; colors: number[] }[] {
  const out: { source: number; colors: number[] }[] = [];
  s.factories.forEach((f, i) => {
    const colors = f.map((n, c) => (n > 0 ? c : -1)).filter((c) => c >= 0);
    if (colors.length) out.push({ source: i, colors });
  });
  const cc = s.center.map((n, c) => (n > 0 ? c : -1)).filter((c) => c >= 0);
  if (cc.length) out.push({ source: -1, colors: cc });
  return out;
}

export const azulGame: GameDefinition<AzulState, AzulAction, AzulState> = {
  slug: 'azul',
  minPlayers: 2,
  maxPlayers: 4,

  setup: ({ players, seed }) => {
    const rng = createRng(seed);
    const s: AzulState = {
      players, bag: rng.shuffle(Array.from({ length: 100 }, (_, i) => i % COLORS)), discard: [], factories: [], center: zeros(), marker: true,
      boards: Array.from({ length: players }, emptyBoard), scores: Array(players).fill(0), turn: 0, nextFirst: 0, round: 1,
      rng: rng.state, log: ['Игра началась.'], finished: false, bonuses: null,
    };
    fillFactories(s);
    return s;
  },

  currentSeats: (s) => (s.finished ? [] : [s.turn]),

  legalActions: (s, seat) => {
    if (s.finished || s.turn !== seat) return [];
    const b = s.boards[seat]!;
    const acts: AzulAction[] = [];
    for (const { source, colors } of sources(s)) {
      for (const color of colors) {
        for (let line = 0; line <= 5; line++) if (canPlaceOnLine(b, line, color)) acts.push({ t: 'draft', source, color, line });
      }
    }
    return acts;
  },

  validate: (s, seat, a) => {
    if (s.finished) return fail('Игра окончена');
    if (s.turn !== seat) return fail('Сейчас ход соперника');
    const act = a as AzulAction | null;
    if (!act || act.t !== 'draft') return fail('Некорректное действие');
    const have = act.source === -1 ? s.center[act.color] : s.factories[act.source]?.[act.color];
    if (!have) return fail('В этом источнике нет плиток такого цвета');
    if (!Number.isInteger(act.line) || act.line < 0 || act.line > 5) return fail('Нет такой линии');
    return canPlaceOnLine(s.boards[seat]!, act.line, act.color) ? ok(undefined) : fail('Сюда плитки такого цвета положить нельзя');
  },

  apply: (prev, seat, a) => {
    const s = clone(prev);
    const b = s.boards[seat]!;
    let n: number;
    if (a.source === -1) {
      n = s.center[a.color]!;
      s.center[a.color] = 0;
      if (s.marker) {
        s.marker = false;
        b.floor.push(5); // маркер первого игрока — на пол
        s.nextFirst = seat;
      }
    } else {
      const f = s.factories[a.source]!;
      n = f[a.color]!;
      // Остальные плитки фабрики уходят в центр.
      f.forEach((cnt, c) => {
        if (c !== a.color) s.center[c]! += cnt;
      });
      s.factories[a.source] = zeros();
    }

    let toLine = 0;
    if (a.line < 5) {
      const l = b.lines[a.line]!;
      toLine = Math.min(n, a.line + 1 - l.count);
      l.color = a.color;
      l.count += toLine;
    }
    // Лишние плитки — на пол; на заполненный пол плитки идут сразу в сброс.
    for (let i = 0; i < n - toLine; i++) {
      if (b.floor.length < FLOOR_PENALTY.length) b.floor.push(a.color);
      else s.discard.push(a.color);
    }

    const left = sources(s);
    if (left.length === 0) {
      // Фабрики и центр опустели: подсчёт раунда.
      scoreRound(s);
      if (s.boards.some(wallRowComplete)) {
        s.bonuses = endBonuses(s);
        s.scores = s.scores.map((x, i) => x + s.bonuses![i]!);
        s.finished = true;
        log(s, 'Игра окончена: у кого-то заполнена строка стены.');
        return s;
      }
      s.round++;
      s.turn = s.nextFirst;
      fillFactories(s);
      log(s, `Раунд ${s.round}. Начинает ${name(s.turn)}.`);
      return s;
    }
    s.turn = (seat + 1) % s.players;
    return s;
  },

  outcome: (s): Outcome | null => {
    if (!s.finished) return null;
    const rows = s.boards.map((b) => b.wall.filter((r) => r.every(Boolean)).length);
    const order = s.scores.map((sc, i) => i).sort((x, y) => s.scores[y]! - s.scores[x]! || rows[y]! - rows[x]! || x - y);
    const best = order[0]!;
    const winners = order.filter((i) => s.scores[i] === s.scores[best] && rows[i] === rows[best]);
    return { winners, ranking: order, reason: 'points', scores: Object.fromEntries(s.scores.map((sc, i) => [i, sc])) };
  },

  view: (s) => ({ ...s, bag: [], discard: s.discard }),
  timeoutAction: (s, seat) => azulGame.legalActions(s, seat)[0] ?? null,
  chooseBotAction: (s, seat, bot) => chooseBot(s, seat, bot),
};

// ───────── бот ─────────

/** Оценка хода: очки за укладку и штрафы, заготовка линий и «недоставаемые» плитки. */
function evaluateMove(s: AzulState, seat: Seat, a: AzulAction): number {
  const b = s.boards[seat]!;
  const n = a.source === -1 ? s.center[a.color]! : s.factories[a.source]![a.color]!;
  const takesMarker = a.source === -1 && s.marker;
  let v = 0;
  const floorBefore = b.floor.length;
  let toFloor: number;
  if (a.line === 5) toFloor = n;
  else {
    const l = b.lines[a.line]!;
    const fit = Math.min(n, a.line + 1 - l.count);
    toFloor = n - fit;
    if (l.count + fit === a.line + 1) {
      v += 2 + placementScore(b.wall.map((r) => r.slice()).map((r, i) => (i === a.line ? r.map((x, c) => x || c === wallColumn(a.line, a.color)) : r)), a.line, wallColumn(a.line, a.color));
    } else {
      v += (l.count + fit) / (a.line + 1); // чем ближе к заполнению, тем лучше
      v -= a.line * 0.15; // длинные линии строятся дольше
    }
  }
  const extra = toFloor + (takesMarker ? 1 : 0);
  v += floorPenalty(floorBefore + extra) - floorPenalty(floorBefore);
  v -= takesMarker ? 0 : 0;
  // Бонус за построение вдоль уже заполненных столбцов/строк стены (будущие очки)
  if (a.line < 5) v += 0.3 * (b.wall[a.line]!.filter(Boolean).length + b.wall.filter((row) => row[wallColumn(a.line, a.color)]).length);
  return v;
}

function chooseBot(s: AzulState, seat: Seat, bot: BotContext): AzulAction {
  const legal = azulGame.legalActions(s, seat);
  const rng = createRng(bot.rngSeed);
  if (bot.level === 'EASY' && rng.next() < 0.5) return legal[rng.int(legal.length)]!;
  const scored = legal.map((a) => ({ a, v: evaluateMove(s, seat, a) + (bot.level === 'MEDIUM' ? rng.next() * 0.8 : 0) }));
  scored.sort((x, y) => y.v - x.v);
  return scored[0]!.a;
}
