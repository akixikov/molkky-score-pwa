// Checks the engine and the KPI definitions against the team's real log and its analysis report.
// The fixture is not in the public repo (fixtures-private/ is gitignored), so this suite skips in CI.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DerivedThrow, ThrowRecord } from './rules';
import { KPIS, throwsOf } from './stats';
import type { SetEntry } from './store';

const path = new URL('../fixtures-private/molkkylog.json', import.meta.url);
const has = existsSync(path);

interface Raw {
  tournament: string;
  game: string;
  setNo: number;
  throws: { player: string; score: number; event: string }[];
}

function load(filter: (r: Raw) => boolean): { sets: SetEntry[]; raw: Raw[] } {
  const raw = (JSON.parse(readFileSync(path, 'utf8')) as Raw[]).filter(filter);
  const sets = raw.map((r, k) => ({
    id: String(k), setNo: r.setNo, closed: true,
    config: { firstTeam: 'us', lineup: [] },
    records: r.throws.map<ThrowRecord>((x, i) => ({ id: String(i), team: 'us', player: x.player, score: x.score, ts: i })),
  }));
  return { sets, raw };
}

const miss = (key: string, rows: DerivedThrow[]) => 1 - KPIS.find((k) => k.key === key)!.pick(rows).v;
const missOf = (rows: DerivedThrow[]) => rows.filter((r) => r.score === 0).length / rows.length;

describe.skipIf(!has)('real log (private fixture)', () => {
  it('matches the report: tournament games (miss rates = 1 − the hit-rate KPIs)', () => {
    const { sets } = load((r) => r.game.startsWith('vs'));
    const rows = throwsOf(sets, 'us');
    expect(sets).toHaveLength(41);
    expect(miss('hit', rows)).toBeCloseTo(0.222, 3);
    expect(miss('afterMiss', rows)).toBeCloseTo(0.321, 3);
    expect(miss('mid', rows)).toBeCloseTo(0.286, 3);
    expect(miss('zone', rows)).toBeCloseTo(0.345, 3);
    expect(missOf(rows.filter((r) => r.before >= 26))).toBeCloseTo(0.286, 3);
  });

  it('matches the report: all games', () => {
    const { sets, raw } = load(() => true);
    const perGame = sets.map((s) => throwsOf([s], 'us'));
    const rows = perGame.flat();
    expect(sets).toHaveLength(77);
    expect(rows.filter((r) => r.event === 'Over')).toHaveLength(2);
    const afterTwo = rows.filter((r) => r.faultStreak === 2);
    expect([afterTwo.filter((r) => r.score > 0).length, afterTwo.length]).toEqual([22, 23]);
    // Engine finishes agree with the recorded Event column.
    const recorded = raw.filter((r) => r.throws.some((x) => x.event === 'Finish')).length;
    expect(perGame.filter((g) => g.some((r) => r.event === 'Finish'))).toHaveLength(recorded);
    // かず from 5–9 to go, first throws of a game excluded as in the report.
    const kazu = rows.filter((r) => r.player === 'かず' && r.teamIdx > 1 && r.remaining >= 5 && r.remaining <= 9);
    expect([kazu.length, kazu.filter((r) => r.event === 'Finish').length]).toEqual([20, 11]);
  });
});
