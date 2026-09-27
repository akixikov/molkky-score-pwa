import { describe, expect, it } from 'vitest';
import type { ThrowRecord } from './rules';
import { finishers, KPIS, ourThrows, throwsOf } from './stats';
import type { Match, SetEntry } from './store';

const pick = (key: string, sets: SetEntry[]) => KPIS.find((k) => k.key === key)!.pick(throwsOf(sets, 'us'));
const us = (scores: number[], player = 'A'): ThrowRecord[] => scores.map((score, i) => ({ id: `${player}${i}`, team: 'us', player, score, ts: i }));
const game = (records: ThrowRecord[]): SetEntry => ({ id: 'g', setNo: 1, closed: true, config: { firstTeam: 'us', lineup: [] }, records });

describe('KPIS', () => {
  // 12, 0, 12, 0, 5, 12, 9 → 12, 12, 24, 24, 29, 41, 50 (finish from 41).
  const sets = [game(us([12, 0, 12, 0, 5, 12, 9]))];

  it('keeps the display order', () => {
    expect(KPIS.map((k) => k.key)).toEqual(['hit', 'avg', 'finish', 'afterMiss', 'mid', 'zone']);
  });
  it('hit rate and average count every throw', () => {
    expect(pick('hit', sets)).toEqual({ v: 5 / 7, n: 7 });
    expect(pick('avg', sets)).toEqual({ v: 50 / 7, n: 7 });
  });
  it('after a miss looks at the throw right after one miss', () => {
    expect(pick('afterMiss', sets)).toEqual({ v: 1, n: 2 });
  });
  it('mid-game is turns 4–6 of a game', () => {
    expect(pick('mid', sets)).toEqual({ v: 2 / 3, n: 3 });
  });
  it('finishing zone and finish rate use throws taken from 38+', () => {
    expect(pick('zone', sets)).toEqual({ v: 1, n: 1 });
    expect(pick('finish', sets)).toEqual({ v: 1, n: 1 });
  });
  it('no throws gives NaN rather than 0', () => {
    expect(Number.isNaN(pick('hit', []).v)).toBe(true);
  });
});

describe('ourThrows', () => {
  const tournament: Match = {
    id: 't', date: '2026-09-21', tournament: 'X', opponent: 'Y', kind: 'tournament',
    sets: [game([...us([5]), { id: 'o', team: 'them', score: 3, ts: 9 }])],
  };
  const practice: Match = {
    id: 'p', date: '2026-09-21', tournament: '', opponent: '', kind: 'practice',
    sets: [{
      id: 'g', setNo: 1, closed: true,
      config: { firstTeam: 's1', lineup: [], sides: [{ id: 's1', name: 'A', lineup: ['A'] }, { id: 's2', name: 'B', lineup: ['B'] }] },
      records: [{ id: '1', team: 's1', player: 'A', score: 5, ts: 1 }, { id: '2', team: 's2', player: 'B', score: 7, ts: 2 }],
    }],
  };
  it('is our side in tournaments and every player in practice', () => {
    expect(ourThrows(tournament).map((r) => r.score)).toEqual([5]);
    expect(ourThrows(practice).map((r) => r.player)).toEqual(['A', 'B']);
  });
});

describe('finishers', () => {
  it('counts finishes per player', () => {
    const rows = throwsOf([game(us([12, 12, 12, 12, 2], 'A')), game(us([12, 12, 12, 12, 2], 'B')), game(us([12, 12, 12, 12, 2], 'A'))], 'us');
    expect(finishers(rows)).toEqual([['A', 2], ['B', 1]]);
  });
});
