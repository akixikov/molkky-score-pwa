// Team statistics computed from derived sets.
// Definitions follow the analysis report and the Kanto Prime League
// public stats (fault = a throw that scores 0).
import { deriveSet, type DerivedThrow, type SetConfig, type ThrowRecord, type Team } from './rules';

export interface SetInput {
  config: SetConfig;
  records: ThrowRecord[];
}

export interface Rate {
  n: number;
  hits: number;
  /** Share of throws that scored 0. NaN when n = 0. */
  fault: number;
}

export interface TeamStats {
  sets: number;
  throws: number;
  finishedSets: number;
  /** Mean team throws in sets the team finished at exactly 50. */
  throwsPerFinishedSet: number;
  bursts: number;
  overall: Rate;
  /** After exactly one consecutive miss. */
  afterOneMiss: Rate;
  /** After two consecutive misses (the brink). */
  afterTwoMisses: Rate;
  /** Team throws 4 to 6 within a set. */
  throws4to6: Rate;
  /** Score before the throw is 26 or more. */
  over26: Rate;
  /** Score before the throw is 38 or more (finish zone). */
  over38: Rate;
  firstThrowAvg: number;
}

export interface PlayerStats {
  player: string;
  /** All throws except the team's first throw of a set. */
  nonFirst: Rate;
  avgScore: number;
  /** Throws taken from 38 or more. */
  zone: Rate;
  zoneFinishes: number;
  /** Throws taken with 5 to 9 remaining, and how many finished. */
  rem5to9: { n: number; finishes: number };
}

function rate(rows: DerivedThrow[]): Rate {
  const n = rows.length;
  const hits = rows.filter((r) => r.score > 0).length;
  return { n, hits, fault: n === 0 ? NaN : (n - hits) / n };
}

function teamRows(sets: SetInput[], team: Team): DerivedThrow[][] {
  return sets.map((s) => deriveSet(s.config, s.records).rows.filter((r) => r.team === team));
}

export function teamStats(sets: SetInput[], team: Team = 'us'): TeamStats {
  const perSet = teamRows(sets, team).filter((rows) => rows.length > 0);
  const all = perSet.flat();
  const finished = perSet.filter((rows) => rows.some((r) => r.event === 'Finish'));
  const firsts = perSet.map((rows) => rows[0].score);
  return {
    sets: perSet.length,
    throws: all.length,
    finishedSets: finished.length,
    throwsPerFinishedSet: finished.length === 0 ? NaN : finished.reduce((a, r) => a + r.length, 0) / finished.length,
    bursts: all.filter((r) => r.event === 'Over').length,
    overall: rate(all),
    afterOneMiss: rate(all.filter((r) => r.faultStreak === 1)),
    afterTwoMisses: rate(all.filter((r) => r.faultStreak === 2)),
    throws4to6: rate(all.filter((r) => r.teamIdx >= 4 && r.teamIdx <= 6)),
    over26: rate(all.filter((r) => r.before >= 26)),
    over38: rate(all.filter((r) => r.before >= 38)),
    firstThrowAvg: firsts.length === 0 ? NaN : firsts.reduce((a, b) => a + b, 0) / firsts.length,
  };
}

export function playerStats(sets: SetInput[]): PlayerStats[] {
  const rows = teamRows(sets, 'us').flat().filter((r) => r.teamIdx > 1 && r.player);
  const names = [...new Set(rows.map((r) => r.player as string))];
  return names.map((player) => {
    const mine = rows.filter((r) => r.player === player);
    const zone = mine.filter((r) => r.before >= 38);
    const band = mine.filter((r) => r.remaining >= 5 && r.remaining <= 9);
    return {
      player,
      nonFirst: rate(mine),
      avgScore: mine.reduce((a, r) => a + r.score, 0) / mine.length,
      zone: rate(zone),
      zoneFinishes: zone.filter((r) => r.event === 'Finish').length,
      rem5to9: { n: band.length, finishes: band.filter((r) => r.event === 'Finish').length },
    };
  });
}

export function pct(x: number, digits = 1): string {
  return Number.isNaN(x) ? '—' : `${(x * 100).toFixed(digits)}%`;
}
