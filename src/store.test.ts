import { describe, expect, it } from 'vitest';
import { matchResult, newestFirst, type Match, type SetEntry } from './store';

const game = (manualWinner?: string): SetEntry => ({ id: `g${manualWinner}`, setNo: 1, closed: true, config: { firstTeam: 'us', lineup: [] }, records: [], manualWinner });

describe('matchResult', () => {
  it('counts games won and lost and gives the verdict', () => {
    expect(matchResult({ sets: [game('us'), game('them'), game('us')] })).toEqual({ won: 2, lost: 1, verdict: 'Win' });
    expect(matchResult({ sets: [game('them'), game('them'), game('us')] })).toEqual({ won: 1, lost: 2, verdict: 'Loss' });
    // An undecided game counts for neither side.
    expect(matchResult({ sets: [game('us'), game('them'), game()] })).toEqual({ won: 1, lost: 1, verdict: 'Draw' });
  });
});

describe('newestFirst', () => {
  const match = (id: string, date: string, ...ts: number[]) => ({
    id, date, sets: [{ ...game(), records: ts.map((t, k) => ({ id: `${id}${k}`, team: 'us', score: 1, ts: t })) }],
  }) as Pick<Match, 'id' | 'date' | 'sets'>;
  const ids = (ms: Pick<Match, 'id'>[]) => ms.map((m) => m.id);

  it('orders by date, then by the first throw, whichever phone recorded it', () => {
    // Own matches first, then a teammate's, as App joins them.
    const all = [match('a', '2026-10-01', 100, 150), match('c', '2026-10-01', 300), match('b', '2026-10-01', 200), match('old', '2026-09-30', 900)];
    expect(ids(newestFirst(all))).toEqual(['c', 'b', 'a', 'old']);
  });

  it('puts a match with no throw yet first, and keeps the later of a tie first', () => {
    const all = [match('a', '2026-10-01', 100), match('empty', '2026-10-01'), match('b', '2026-10-01', 100)];
    expect(ids(newestFirst(all))).toEqual(['empty', 'b', 'a']);
  });
});
