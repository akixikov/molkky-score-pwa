import { describe, expect, it } from 'vitest';
import { matchResult, type SetEntry } from './store';

const game = (manualWinner?: string): SetEntry => ({ id: `g${manualWinner}`, setNo: 1, closed: true, config: { firstTeam: 'us', lineup: [] }, records: [], manualWinner });

describe('matchResult', () => {
  it('counts games won and lost and gives the verdict', () => {
    expect(matchResult({ sets: [game('us'), game('them'), game('us')] })).toEqual({ won: 2, lost: 1, verdict: 'Win' });
    expect(matchResult({ sets: [game('them'), game('them'), game('us')] })).toEqual({ won: 1, lost: 2, verdict: 'Loss' });
    // An undecided game counts for neither side.
    expect(matchResult({ sets: [game('us'), game('them'), game()] })).toEqual({ won: 1, lost: 1, verdict: 'Draw' });
  });
});
