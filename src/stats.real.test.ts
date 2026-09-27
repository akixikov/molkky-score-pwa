// Checks the engine against the team's real log. The fixture is not in the
// public repo (fixtures-private/ is gitignored), so this suite skips in CI.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ThrowRecord } from './rules';
import { playerStats, teamStats, type SetInput } from './stats';

const path = new URL('../fixtures-private/molkkylog.json', import.meta.url);
const has = existsSync(path);

interface Raw {
  tournament: string;
  game: string;
  setNo: number;
  throws: { player: string; score: number; event: string }[];
}

function load(filter: (r: Raw) => boolean): { sets: SetInput[]; raw: Raw[] } {
  const raw = (JSON.parse(readFileSync(path, 'utf8')) as Raw[]).filter(filter);
  const sets = raw.map((r) => ({
    config: { firstTeam: 'us' as const, lineup: [] },
    records: r.throws.map<ThrowRecord>((x, i) => ({ id: String(i), team: 'us', player: x.player, score: x.score, ts: i })),
  }));
  return { sets, raw };
}

describe.skipIf(!has)('real log (private fixture)', () => {
  it('matches the report: tournament sets', () => {
    const { sets } = load((r) => r.game.startsWith('vs'));
    const s = teamStats(sets);
    expect(s.sets).toBe(41);
    expect(s.overall.fault).toBeCloseTo(0.222, 3);
    expect(s.afterOneMiss.fault).toBeCloseTo(0.321, 3);
    expect(s.throws4to6.fault).toBeCloseTo(0.286, 3);
    expect(s.over26.fault).toBeCloseTo(0.286, 3);
    expect(s.over38.fault).toBeCloseTo(0.345, 3);
  });

  it('matches the report: all sets', () => {
    const { sets, raw } = load(() => true);
    const s = teamStats(sets);
    expect(s.sets).toBe(77);
    expect(s.bursts).toBe(2);
    expect(s.afterTwoMisses.hits).toBe(22);
    expect(s.afterTwoMisses.n).toBe(23);
    // Engine finishes agree with the recorded Event column.
    const recorded = raw.filter((r) => r.throws.some((x) => x.event === 'Finish')).length;
    expect(s.finishedSets).toBe(recorded);
    const kazu = playerStats(sets).find((p) => p.player === 'かず')!;
    expect(kazu.rem5to9).toEqual({ n: 20, finishes: 11 });
  });
});
