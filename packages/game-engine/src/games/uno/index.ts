import { createRng } from '../../core/rng';
import { fail, ok, type GameDefinition, type Outcome, type Seat } from '../../core/types';

export type Color = 'R' | 'Y' | 'G' | 'B';
export type Kind = 'num' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface UnoCard {
  /** Цвет карты; у диких — null. */
  color: Color | null;
  kind: Kind;
  /** Номинал 0–9 для числовых карт. */
  n?: number;
}

export interface UnoState {
  players: number;
  hands: UnoCard[][];
  deck: UnoCard[];
  discard: UnoCard[];
  /** Текущий цвет (после дикой карты может отличаться от цвета верхней). */
  color: Color;
  turn: Seat;
  /** 1 — по часовой, −1 — против. */
  dir: 1 | -1;
  /** Карта, взятая в этом ходу и пригодная для розыгрыша (иначе ход переходит автоматически). */
  drawn: UnoCard | null;
  /** Игрок, оставшийся с одной картой без объявления «UNO!» — его можно поймать. */
  uncalled: Seat | null;
  rng: number;
  winner: Seat | null;
  finished: boolean;
  log: string[];
}

export type UnoAction =
  | { t: 'play'; card: UnoCard; color?: Color; uno?: boolean }
  | { t: 'draw' }
  | { t: 'pass' }
  | { t: 'catch' };

export interface UnoView {
  players: number;
  hand: UnoCard[];
  handCounts: number[];
  top: UnoCard;
  color: Color;
  turn: Seat;
  dir: 1 | -1;
  deckCount: number;
  drawn: UnoCard | null;
  uncalled: Seat | null;
  winner: Seat | null;
  finished: boolean;
  log: string[];
}

export const COLORS: Color[] = ['R', 'Y', 'G', 'B'];
const HAND = 7;
const MAX_LOG = 8;

export function newDeck(): UnoCard[] {
  const d: UnoCard[] = [];
  for (const color of COLORS) {
    d.push({ color, kind: 'num', n: 0 });
    for (let n = 1; n <= 9; n++) d.push({ color, kind: 'num', n }, { color, kind: 'num', n });
    for (const kind of ['skip', 'reverse', 'draw2'] as const) d.push({ color, kind }, { color, kind });
  }
  for (let i = 0; i < 4; i++) d.push({ color: null, kind: 'wild' }, { color: null, kind: 'wild4' });
  return d;
}

export const sameCard = (a: UnoCard, b: UnoCard) => a.color === b.color && a.kind === b.kind && a.n === b.n;
const clone = (s: UnoState): UnoState => JSON.parse(JSON.stringify(s)) as UnoState;
const top = (s: UnoState) => s.discard[s.discard.length - 1] as UnoCard;
const name = (seat: Seat) => `Игрок ${seat + 1}`;
const log = (s: UnoState, t: string) => {
  s.log.push(t);
  if (s.log.length > MAX_LOG) s.log.shift();
};
const nextSeat = (s: UnoState, from: Seat, steps = 1) => (((from + s.dir * steps) % s.players) + s.players * steps) % s.players;

/** Можно ли сыграть `c` на текущую верхнюю карту. «+4» — только при отсутствии карт текущего цвета. */
export function canPlay(s: UnoState, hand: UnoCard[], c: UnoCard): boolean {
  if (c.kind === 'wild') return true;
  if (c.kind === 'wild4') return !hand.some((x) => x.color === s.color);
  const t = top(s);
  return c.color === s.color || (c.kind === 'num' ? t.kind === 'num' && t.n === c.n : t.kind === c.kind);
}

/** Берёт карты из колоды; когда она пуста — перемешивает сброс (кроме верхней карты). */
function draw(s: UnoState, seat: Seat, n: number): UnoCard[] {
  const got: UnoCard[] = [];
  for (let i = 0; i < n; i++) {
    if (s.deck.length === 0 && s.discard.length > 1) {
      const rng = createRng(s.rng);
      const keep = s.discard.pop() as UnoCard;
      s.deck = rng.shuffle(s.discard);
      s.discard = [keep];
      s.rng = rng.state;
    }
    const c = s.deck.pop();
    if (!c) break; // карты совсем кончились — берём сколько есть
    s.hands[seat]!.push(c);
    got.push(c);
  }
  return got;
}

function finishIfWon(s: UnoState, seat: Seat): boolean {
  if (s.hands[seat]!.length > 0) return false;
  s.finished = true;
  s.winner = seat;
  log(s, `${name(seat)} выходит первым и побеждает!`);
  return true;
}

export const unoGame: GameDefinition<UnoState, UnoAction, UnoView> = {
  slug: 'uno',
  minPlayers: 2,
  maxPlayers: 10,

  setup: ({ players, seed }) => {
    const rng = createRng(seed);
    const deck = rng.shuffle(newDeck());
    const hands: UnoCard[][] = Array.from({ length: players }, () => []);
    for (let r = 0; r < HAND; r++) for (let p = 0; p < players; p++) hands[p]!.push(deck.pop() as UnoCard);
    // Первая открытая карта — числовая (чтобы не разбирать эффекты до первого хода).
    let first = deck.pop() as UnoCard;
    const buried: UnoCard[] = [];
    while (first.kind !== 'num') {
      buried.push(first);
      first = deck.pop() as UnoCard;
    }
    deck.unshift(...buried);
    return {
      players, hands, deck: rng.shuffle(deck), discard: [first], color: first.color as Color,
      turn: 0, dir: 1, drawn: null, uncalled: null, rng: rng.state, winner: null, finished: false,
      log: ['Игра началась.'],
    };
  },

  currentSeats: (s) => (s.finished ? [] : [s.turn]),

  legalActions: (s, seat) => {
    if (s.finished || s.turn !== seat) return [];
    const hand = s.hands[seat]!;
    const acts: UnoAction[] = [];
    if (s.uncalled !== null && s.uncalled !== seat) acts.push({ t: 'catch' });

    const playable = s.drawn ? [s.drawn] : hand.filter((c) => canPlay(s, hand, c));
    const seen: UnoCard[] = [];
    for (const card of playable) {
      if (seen.some((x) => sameCard(x, card))) continue;
      seen.push(card);
      const colors: (Color | undefined)[] = card.color === null ? COLORS : [undefined];
      for (const color of colors) {
        acts.push({ t: 'play', card, ...(color ? { color } : {}), ...(hand.length === 2 ? { uno: true } : {}) });
      }
    }
    if (s.drawn) acts.push({ t: 'pass' });
    else acts.push({ t: 'draw' });
    return acts;
  },

  validate: (s, seat, a) => {
    if (s.finished) return fail('Партия завершена');
    if (s.turn !== seat) return fail('Сейчас ход соперника');
    const act = a as UnoAction | null;
    if (!act || typeof act !== 'object') return fail('Некорректное действие');
    const hand = s.hands[seat]!;
    switch (act.t) {
      case 'draw':
        return s.drawn ? fail('Вы уже брали карту — сыграйте её или пропустите ход') : ok(undefined);
      case 'pass':
        return s.drawn ? ok(undefined) : fail('Пропустить можно только после добора');
      case 'catch':
        return s.uncalled !== null && s.uncalled !== seat ? ok(undefined) : fail('Некого ловить');
      case 'play': {
        const card = act.card;
        if (!card || !hand.some((c) => sameCard(c, card))) return fail('У вас нет такой карты');
        if (s.drawn && !sameCard(s.drawn, card)) return fail('После добора можно сыграть только взятую карту');
        if (card.kind === 'wild4' && hand.some((x) => x.color === s.color)) return fail('«+4» можно играть, только если нет карт текущего цвета');
        if (!canPlay(s, hand, card)) return fail('Эта карта не подходит');
        if (card.color === null && !(act.color && COLORS.includes(act.color))) return fail('Выберите цвет');
        return ok(undefined);
      }
      default:
        return fail('Неизвестное действие');
    }
  },

  apply: (prev, seat, a) => {
    const s = clone(prev);
    const hand = s.hands[seat]!;

    if (a.t === 'catch') {
      const victim = s.uncalled as Seat;
      draw(s, victim, 2);
      log(s, `${name(seat)} ловит игрока ${victim + 1}: тот не сказал «UNO!» и берёт 2 карты.`);
      s.uncalled = null;
      return s; // ход не расходуется
    }

    if (a.t === 'draw') {
      const [c] = draw(s, seat, 1);
      log(s, `${name(seat)} берёт карту.`);
      if (c && canPlay(s, s.hands[seat]!, c)) {
        s.drawn = c; // можно сыграть сразу или пропустить
      } else {
        s.uncalled = null;
        s.turn = nextSeat(s, seat);
      }
      return s;
    }

    if (a.t === 'pass') {
      s.drawn = null;
      s.uncalled = null;
      s.turn = nextSeat(s, seat);
      return s;
    }

    // play
    const idx = hand.findIndex((c) => sameCard(c, a.card));
    const [card] = hand.splice(idx, 1) as [UnoCard];
    s.discard.push(card);
    s.drawn = null;
    s.color = card.color ?? (a.color as Color);
    s.uncalled = null;
    log(s, `${name(seat)} играет ${describe(card)}${card.color === null ? ` (цвет: ${COLOR_NAMES[s.color]})` : ''}.`);

    // «UNO!»: осталась одна карта, а игрок не объявил — соперник сможет поймать.
    if (hand.length === 1) {
      if (a.uno) log(s, `${name(seat)}: «UNO!»`);
      else s.uncalled = seat;
    }

    let skip = 0;
    let penalty = 0;
    switch (card.kind) {
      case 'skip': skip = 1; break;
      case 'reverse':
        s.dir = (s.dir * -1) as 1 | -1;
        if (s.players === 2) skip = 1; // вдвоём «разворот» работает как «пропуск»
        break;
      case 'draw2': penalty = 2; break;
      case 'wild4': penalty = 4; break;
      default: break;
    }
    const victim = nextSeat(s, seat);
    if (penalty) {
      draw(s, victim, penalty);
      log(s, `${name(victim)} берёт ${penalty} и пропускает ход.`);
      skip = 1;
    }
    if (finishIfWon(s, seat)) return s;
    s.turn = nextSeat(s, seat, 1 + skip);
    return s;
  },

  outcome: (s): Outcome | null => {
    if (!s.finished || s.winner === null) return null;
    const rest = Array.from({ length: s.players }, (_, i) => i)
      .filter((i) => i !== s.winner)
      .sort((a, b) => s.hands[a]!.length - s.hands[b]!.length || a - b);
    return { winners: [s.winner], ranking: [s.winner, ...rest], reason: 'uno' };
  },

  view: (s, seat) => ({
    players: s.players,
    hand: seat === null ? [] : s.hands[seat]!,
    handCounts: s.hands.map((h) => h.length),
    top: top(s),
    color: s.color,
    turn: s.turn,
    dir: s.dir,
    deckCount: s.deck.length,
    drawn: seat === s.turn ? s.drawn : s.drawn ? { color: null, kind: 'wild' } : null, // чужую взятую карту не раскрываем
    uncalled: s.uncalled,
    winner: s.winner,
    finished: s.finished,
    log: s.log,
  }),

  timeoutAction: (s) => (s.drawn ? { t: 'pass' } : { t: 'draw' }),

  chooseBotAction: (s, seat, bot) => {
    const legal = unoGame.legalActions(s, seat);
    const rng = createRng(bot.rngSeed);
    const plays = legal.filter((a): a is Extract<UnoAction, { t: 'play' }> => a.t === 'play');
    // Бот всегда ловит и всегда говорит «UNO!»; лёгкий уровень иногда играет случайно.
    if (legal.some((a) => a.t === 'catch') && bot.level !== 'EASY') return { t: 'catch' };
    if (bot.level === 'EASY' && rng.next() < 0.3) return legal[rng.int(legal.length)]!;
    if (plays.length === 0) return legal.find((a) => a.t === 'draw') ?? { t: 'pass' };

    const hand = s.hands[seat]!;
    const score = (a: Extract<UnoAction, { t: 'play' }>) => {
      const c = a.card;
      if (c.kind === 'wild4') return 1; // дорогие дикие карты бережём
      if (c.kind === 'wild') return 2;
      let v = 10;
      if (c.kind !== 'num') v += 6; // действия мешают соперникам
      if (bot.level !== 'MEDIUM' && bot.level !== 'EASY') v += hand.filter((x) => x.color === c.color).length; // освобождаемся от самого частого цвета
      return v;
    };
    const best = plays.slice().sort((x, y) => score(y) - score(x));
    const pick = best[0]!;
    if (pick.card.color === null) {
      // Цвет для дикой карты — тот, которого в руке больше всего.
      const count = (col: Color) => hand.filter((x) => x.color === col).length;
      const color = COLORS.slice().sort((x, y) => count(y) - count(x))[0]!;
      return { ...pick, color, uno: hand.length === 2 };
    }
    return { ...pick, uno: hand.length === 2 };
  },
};

export const COLOR_NAMES: Record<Color, string> = { R: 'красный', Y: 'жёлтый', G: 'зелёный', B: 'синий' };
export function describe(c: UnoCard): string {
  const col = c.color ? COLOR_NAMES[c.color] : '';
  const k = { num: String(c.n), skip: 'пропуск', reverse: 'разворот', draw2: '+2', wild: 'выбор цвета', wild4: '+4' }[c.kind];
  return `${k}${col ? ` ${col}` : ''}`;
}
