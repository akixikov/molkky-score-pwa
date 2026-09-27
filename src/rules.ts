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

/** Score from knocked pins: one pin scores its number, two or more score the count. */
export function scoreOf(pins: number[]): number {
  if (pins.length === 0) return 0;
  if (pins.length === 1) return pins[0];
  return pins.length;
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
  const lineup = order.find((s) => s.id === nextTeam)?.lineup ?? [];
  const nextPlayer = nextTeam && lineup.length > 0 ? lineup[teams[nextTeam].throws % lineup.length] : null;

  return { order, teams, winner, endReason, nextTeam, nextPlayer, rows };
}

export interface Hint {
  level: 'info' | 'warn' | 'danger';
  title: string;
  body: string;
}

/** Strategy prompts for the thrower, based on the team analysis. */
export function hintsFor(state: SetState, team: SideId): Hint[] {
  const t = state.teams[team];
  // The closest rival still in the game.
  const opp = { score: Math.max(0, ...state.order.filter((s) => s.id !== team && !state.teams[s.id].eliminated).map((s) => state.teams[s.id].score)) };
  const hints: Hint[] = [];
  const remaining = WIN_SCORE - t.score;

  if (t.faultStreak === 2) {
    hints.push({ level: 'danger', title: '2 misses: one more and you are disqualified', body: 'Just knock down a skittle. Aim only at close skittles or an easy pair.' });
  } else if (t.faultStreak === 1) {
    hints.push({ level: 'warn', title: '1 miss: play it safe', body: 'Aim only at close skittles, an easy pair, or easy targets. Say your target out loud before throwing.' });
  }

  if (t.score < 41) {
    const lo = Math.max(1, 41 - t.score);
    const hi = Math.min(12, 45 - t.score);
    if (lo <= 12) {
      hints.push({ level: 'info', title: 'Target', body: `Scoring ${lo}–${hi} puts you on 41–45 (5–9 to go).` });
    }
  } else if (remaining === 1) {
    hints.push({ level: 'warn', title: '1 to go', body: 'Knock down skittle 1 alone. Two or more takes you over 50 and back to 25.' });
  } else if (remaining <= 12) {
    hints.push({ level: 'info', title: `${remaining} to go`, body: `Knock down skittle ${remaining} alone, or ${remaining} skittles together.` });
  }

  if (opp.score >= 38 && opp.score < WIN_SCORE) {
    hints.push({ level: 'info', title: `Opponent needs ${WIN_SCORE - opp.score}`, body: 'If you cannot score, push their finishing skittle far away or into a cluster.' });
  }
  return hints;
}
