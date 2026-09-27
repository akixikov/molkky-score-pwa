// Mölkky rules engine.
// Records hold only facts (who threw, which pins fell). Scores, bursts,
// finishes and eliminations are always derived here, never stored.

export type Team = 'us' | 'them';

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
  team: Team;
  /** Our team's thrower. Empty for the opponent. */
  player?: string;
  /** Pins knocked down (our team). Undefined when only the score is known. */
  pins?: number[];
  /** Score entered directly (opponent) or derived from pins (our team). */
  score: number;
  ts: number;
}

export interface SetConfig {
  firstTeam: Team;
  /** Our throwing order. */
  lineup: string[];
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

export type EndReason = 'finish' | 'opponent-eliminated' | null;

export interface SetState {
  teams: Record<Team, TeamState>;
  winner: Team | null;
  endReason: EndReason;
  /** Team to throw next, or null when the set has ended. */
  nextTeam: Team | null;
  /** Our next thrower (by lineup), when it is our turn. */
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

/** Derive the full state of a set from its records. */
export function deriveSet(config: SetConfig, records: ThrowRecord[]): SetState {
  const teams: Record<Team, TeamState> = {
    us: { score: 0, faultStreak: 0, throws: 0, eliminated: false },
    them: { score: 0, faultStreak: 0, throws: 0, eliminated: false },
  };
  const rows: DerivedThrow[] = [];
  let winner: Team | null = null;
  let endReason: EndReason = null;

  for (const rec of records) {
    const t = teams[rec.team];
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
      winner = other(rec.team);
      endReason = 'opponent-eliminated';
    }
    if (winner) break;
  }

  let nextTeam: Team | null = null;
  if (!winner) {
    const last = records[records.length - 1];
    nextTeam = last ? other(last.team) : config.firstTeam;
  }
  const nextPlayer =
    nextTeam === 'us' && config.lineup.length > 0
      ? config.lineup[teams.us.throws % config.lineup.length]
      : null;

  return { teams, winner, endReason, nextTeam, nextPlayer, rows };
}

export interface Hint {
  level: 'info' | 'warn' | 'danger';
  title: string;
  body: string;
}

/** Strategy prompts for the thrower, based on the team analysis. */
export function hintsFor(state: SetState, team: Team): Hint[] {
  const t = state.teams[team];
  const opp = state.teams[other(team)];
  const hints: Hint[] = [];
  const remaining = WIN_SCORE - t.score;

  if (t.faultStreak === 2) {
    hints.push({ level: 'danger', title: '2ミス中：失格の危機', body: '確実に1本倒す。近いピン・2本倒しだけを狙う。' });
  } else if (t.faultStreak === 1) {
    hints.push({ level: 'warn', title: '1ミス中：崖っぷちモード', body: '近いピン・2本倒し・当てやすいピンだけを狙う。狙いを声に出してから投げる。' });
  }

  if (t.score < 41) {
    const lo = Math.max(1, 41 - t.score);
    const hi = Math.min(12, 45 - t.score);
    if (lo <= 12) {
      hints.push({ level: 'info', title: '狙いの目安', body: `${lo}〜${hi}点で41〜45点（残り5〜9点）に入る。` });
    }
  } else if (remaining === 1) {
    hints.push({ level: 'warn', title: '残り1点', body: '1番を1本だけ倒す。2本以上はバースト。' });
  } else if (remaining <= 12) {
    hints.push({ level: 'info', title: `残り${remaining}点`, body: `${remaining}番を1本、または${remaining}本まとめて倒す。` });
  }

  if (opp.score >= 38 && opp.score < WIN_SCORE) {
    hints.push({ level: 'info', title: `相手は残り${WIN_SCORE - opp.score}点`, body: '点が取れない場面では、相手の上がりピンを遠くへ押しやるか、固まりに寄せる。' });
  }
  return hints;
}
