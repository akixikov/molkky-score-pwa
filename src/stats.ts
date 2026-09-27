// Key numbers (KPIs) over derived throws. Every screen and test uses these definitions.
// A miss is a throw that scores 0 (fouls included); first throws are counted like any other.
import { deriveSet, type DerivedThrow, type SideId } from './rules';
import { isPracticeGame, type Match, type SetEntry } from './store';

export interface KpiValue {
  v: number;
  /** Throws the value is based on. */
  n: number;
}

export interface Kpi {
  key: string;
  label: string;
  note: string;
  /** Points per throw rather than a rate. */
  num?: boolean;
  pick: (rows: DerivedThrow[]) => KpiValue;
}

export const hitOf = (rows: DerivedThrow[]): KpiValue => ({ v: rows.length === 0 ? NaN : rows.filter((r) => r.score > 0).length / rows.length, n: rows.length });
export const avgOf = (rows: DerivedThrow[]): KpiValue => ({ v: rows.length === 0 ? NaN : rows.reduce((a, r) => a + r.score, 0) / rows.length, n: rows.length });

/** Headline measures first, then hit rates by situation (the order shown everywhere). */
export const KPIS: Kpi[] = [
  { key: 'hit', label: 'Hit rate', note: 'throws scoring 1+', pick: hitOf },
  { key: 'avg', label: 'Avg score', note: 'points per throw', num: true, pick: avgOf },
  {
    key: 'finish', label: 'Finish rate', note: 'exactly 50 ÷ throws from 38+',
    pick: (rows) => {
      const zone = rows.filter((r) => r.before >= 38);
      return { v: zone.length === 0 ? NaN : zone.filter((r) => r.event === 'Finish').length / zone.length, n: zone.length };
    },
  },
  { key: 'afterMiss', label: 'After a miss', note: 'hit rate after 1 miss', pick: (rows) => hitOf(rows.filter((r) => r.faultStreak === 1)) },
  { key: 'mid', label: 'Mid-game', note: 'hit rate, turns 4–6', pick: (rows) => hitOf(rows.filter((r) => r.teamIdx >= 4 && r.teamIdx <= 6)) },
  { key: 'zone', label: 'Finishing zone', note: 'hit rate from 38+', pick: (rows) => hitOf(rows.filter((r) => r.before >= 38)) },
];

/** Derived throws of the given games, of one side or of every side (null). */
export const throwsOf = (sets: SetEntry[], team: SideId | null): DerivedThrow[] =>
  sets.flatMap((s) => deriveSet(s.config, s.records).rows.filter((r) => team === null || r.team === team));

/** Our throws in a match: our side in tournaments; every side in practice games (all are our players). */
export const ourThrows = (m: Match): DerivedThrow[] =>
  isPracticeGame(m) ? throwsOf(m.sets, null).filter((r) => !!r.player) : throwsOf(m.sets, 'us');

/** Times each player reached exactly 50, in order of first finish. */
export function finishers(rows: DerivedThrow[]): [string, number][] {
  const count = new Map<string, number>();
  rows.filter((r) => r.event === 'Finish').forEach((r) => count.set(r.player ?? '', (count.get(r.player ?? '') ?? 0) + 1));
  return [...count];
}

export function pct(x: number, digits = 1): string {
  return Number.isNaN(x) ? '—' : `${(x * 100).toFixed(digits)}%`;
}
