// Mölkky rules engine.
// Records hold only facts (who threw, the score of each throw). Totals, bursts,
// finishes and eliminations are always derived here, never stored.

/** The two sides of a tournament game. */
export type Team = 'us' | 'them';
/** Any side of a game: 'us' / 'them' in tournaments, 's1'… in practice games. */
export type SideId = string;

/** A side and its throwing order. Practice games list every side; tournament games derive theirs. */
export interface Side {
  id: SideId;
  name: string;
  lineup: string[];
}

/** Practice games allow up to this many players in total. */
export const MAX_PRACTICE_PLAYERS = 6;

export const WIN_SCORE = 50;
export const BURST_RESET = 25;
export const MAX_FAULTS = 3;

/** Initial pin layout, front row first. Used for the input screen. */
export const PIN_ROWS: number[][] = [
  [1, 2],
  [3, 10, 4],
  [5, 11, 12, 6],
  [7, 9, 8],
];

export interface ThrowRecord {
  id: string;
  team: SideId;
  /** Thrower. Empty when unknown (tournament opponents). */
  player?: string;
  /** Pins knocked down. Only in older records; new records store the score only. */
  pins?: number[];
  /** Score of this throw (0 = miss). */
  score: number;
  ts: number;
}

export interface SetConfig {
  /** Side that throws first. */
  firstTeam: SideId;
  /** Our throwing order (tournament games). */
  lineup: string[];
  /** Practice games: every side, in setup order. Absent in tournament games (us vs them). */
  sides?: Side[];
}

export type ThrowEvent = '' | 'Miss' | 'Finish' | 'Over' | 'Eliminated';

export interface DerivedThrow extends ThrowRecord {
  /** 1-based index of this throw within its team in the set. */
  teamIdx: number;
  before: number;
  after: number;
  event: ThrowEvent;
  /** Consecutive misses of this team before this throw. */
  faultStreak: number;
  /** Remaining points before this throw. */
  remaining: number;
}

export interface TeamState {
  score: number;
  faultStreak: number;
  throws: number;
  eliminated: boolean;
}

/** 'opponent-eliminated': every other side was disqualified. */
export type EndReason = 'finish' | 'opponent-eliminated' | null;

export interface SetState {
  /** Sides in throwing order, starting with the first side. */
  order: Side[];
  teams: Record<SideId, TeamState>;
  winner: SideId | null;
  endReason: EndReason;
  /** Side to throw next, or null when the set has ended. */
  nextTeam: SideId | null;
  /** Next thrower of that side (by lineup), when the side has a lineup. */
  nextPlayer: string | null;
  rows: DerivedThrow[];
}

/** Apply one throw to a team score. */
export function applyThrow(before: number, score: number): { after: number; event: ThrowEvent } {
  const total = before + score;
  if (total > WIN_SCORE) return { after: BURST_RESET, event: 'Over' };
  if (total === WIN_SCORE) return { after: WIN_SCORE, event: 'Finish' };
  return { after: total, event: score === 0 ? 'Miss' : '' };
}

export function other(team: Team): Team {
  return team === 'us' ? 'them' : 'us';
}

/** Sides of a game in throwing order, first side first. */
export function sidesOf(config: SetConfig): Side[] {
  const all = config.sides ?? [
    { id: 'us', name: 'Us', lineup: config.lineup },
    { id: 'them', name: 'Them', lineup: [] },
  ];
  const i = Math.max(0, all.findIndex((s) => s.id === config.firstTeam));
  return [...all.slice(i), ...all.slice(0, i)];
}

/** A side's throwing order; empty when it has none (tournament opponents). */
export const lineupOf = (config: SetConfig, team: SideId): string[] => sidesOf(config).find((s) => s.id === team)?.lineup ?? [];

/** Throws recorded for a side, counted or not. */
export const throwCount = (records: ThrowRecord[], team: SideId): number => records.filter((r) => r.team === team).length;

/** Who throws a side's next throw by its lineup, when it has one. */
export function nextThrower(config: SetConfig, records: ThrowRecord[], team: SideId): string | undefined {
  const lineup = lineupOf(config, team);
  return lineup.length > 0 ? lineup[throwCount(records, team) % lineup.length] : undefined;
}

const freshTeam = (): TeamState => ({ score: 0, faultStreak: 0, throws: 0, eliminated: false });

/** Derive the full state of a set from its records. */
export function deriveSet(config: SetConfig, records: ThrowRecord[]): SetState {
  const order = sidesOf(config);
  const teams: Record<SideId, TeamState> = Object.fromEntries(order.map((s) => [s.id, freshTeam()]));
  const rows: DerivedThrow[] = [];
  let winner: SideId | null = null;
  let endReason: EndReason = null;

  for (const rec of records) {
    const t = (teams[rec.team] ??= freshTeam());
    const before = t.score;
    const streakBefore = t.faultStreak;
    let { after, event } = applyThrow(before, rec.score);
    t.throws += 1;
    t.score = after;
    t.faultStreak = rec.score === 0 ? t.faultStreak + 1 : 0;
    if (t.faultStreak >= MAX_FAULTS) {
      t.eliminated = true;
      event = 'Eliminated';
    }
    rows.push({
      ...rec,
      teamIdx: t.throws,
      before,
      after,
      event,
      faultStreak: streakBefore,
      remaining: WIN_SCORE - before,
    });
    if (event === 'Finish') {
      winner = rec.team;
      endReason = 'finish';
    } else if (event === 'Eliminated') {
      // The game goes on until only one side is left.
      const alive = order.filter((s) => !teams[s.id].eliminated);
      if (alive.length === 1) {
        winner = alive[0].id;
        endReason = 'opponent-eliminated';
      }
    }
    if (winner) break;
  }

  // Next side: the one after the last thrower in order, skipping disqualified sides.
  let nextTeam: SideId | null = null;
  if (!winner) {
    const last = records[records.length - 1];
    const from = last ? order.findIndex((s) => s.id === last.team) : -1;
    for (let k = 1; k <= order.length; k++) {
      const cand = order[(from + k + order.length) % order.length];
      if (!teams[cand.id].eliminated) { nextTeam = cand.id; break; }
    }
  }
  const nextPlayer = (nextTeam && nextThrower(config, records, nextTeam)) || null;

  return { order, teams, winner, endReason, nextTeam, nextPlayer, rows };
}

/**
 * How many leading records still fit the rules: each throw comes from the side due next, and none
 * follows the end of the game. A corrected throw can end a game earlier or disqualify a side sooner,
 * which leaves later records out of turn.
 */
export function playableLength(config: SetConfig, records: ThrowRecord[]): number {
  for (let i = 0; i < records.length; i++) {
    const st = deriveSet(config, records.slice(0, i));
    if (st.winner || st.nextTeam !== records[i].team) return i;
  }
  return records.length;
}

/**
 * Records in throwing order: each side's throws keep their own order and the sides take turns,
 * first side first, as on the score sheet. Used after a throw is added to a side's column; a side
 * out of throws (disqualified, or not recorded) is simply skipped.
 */
export function inTurnOrder(config: SetConfig, records: ThrowRecord[]): ThrowRecord[] {
  const ids = [...new Set([...sidesOf(config).map((s) => s.id), ...records.map((r) => r.team)])];
  const cols = ids.map((id) => records.filter((r) => r.team === id));
  const turns = Math.max(0, ...cols.map((c) => c.length));
  return Array.from({ length: turns }, (_, i) => cols.flatMap((c) => (i < c.length ? [c[i]] : []))).flat();
}
