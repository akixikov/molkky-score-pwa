import { describe, expect, it } from 'vitest';
import { applyThrow, deriveSet, inTurnOrder, playableLength, sidesOf, type SetConfig, type ThrowRecord } from './rules';

let seq = 0;
const t = (team: string, score: number, player?: string): ThrowRecord => ({
  id: String(++seq),
  team,
  player,
  score,
  ts: seq,
});

describe('applyThrow', () => {
  it('exactly 50 finishes', () => expect(applyThrow(41, 9)).toEqual({ after: 50, event: 'Finish' }));
  it('over 50 resets to 25', () => expect(applyThrow(45, 6)).toEqual({ after: 25, event: 'Over' }));
  it('a miss keeps the score', () => expect(applyThrow(30, 0)).toEqual({ after: 30, event: 'Miss' }));
});

describe('deriveSet', () => {
  const cfg: SetConfig = { firstTeam: 'us', lineup: ['A', 'B', 'C'] };

  it('alternates teams and rotates our lineup', () => {
    const s = deriveSet(cfg, [t('us', 5, 'A'), t('them', 3)]);
    expect(s.nextTeam).toBe('us');
    expect(s.nextPlayer).toBe('B');
    expect(s.teams.us.score).toBe(5);
  });

  it('finishing at 50 wins the set', () => {
    const recs = [12, 12, 12, 5, 9].flatMap((sc) => [t('us', sc), t('them', 1)]).slice(0, -1);
    const s = deriveSet(cfg, recs);
    expect(s.winner).toBe('us');
    expect(s.endReason).toBe('finish');
    expect(s.nextTeam).toBeNull();
  });

  it('three misses in a row eliminate the team', () => {
    const s = deriveSet(cfg, [t('us', 0), t('them', 4), t('us', 0), t('them', 4), t('us', 0)]);
    expect(s.teams.us.eliminated).toBe(true);
    expect(s.winner).toBe('them');
    expect(s.endReason).toBe('opponent-eliminated');
    expect(s.rows.at(-1)?.event).toBe('Eliminated');
  });

  it('a hit resets the miss streak', () => {
    const s = deriveSet(cfg, [t('us', 0), t('them', 1), t('us', 0), t('them', 1), t('us', 2), t('them', 1), t('us', 0)]);
    expect(s.teams.us.faultStreak).toBe(1);
    expect(s.winner).toBeNull();
  });

  it('records the streak and score before each throw', () => {
    const s = deriveSet(cfg, [t('us', 10), t('them', 0), t('us', 0), t('them', 0), t('us', 7)]);
    const last = s.rows.at(-1)!;
    expect(last.before).toBe(10);
    expect(last.faultStreak).toBe(1);
    expect(last.teamIdx).toBe(3);
    expect(last.remaining).toBe(40);
  });

  it('opponent can start', () => {
    const s = deriveSet({ firstTeam: 'them', lineup: ['A'] }, []);
    expect(s.nextTeam).toBe('them');
  });
});

describe('practice games (2–6 sides)', () => {
  // Individual game: A, B, C each on their own side; B throws first.
  const solo: SetConfig = {
    firstTeam: 's2',
    lineup: [],
    sides: [
      { id: 's1', name: 'A', lineup: ['A'] },
      { id: 's2', name: 'B', lineup: ['B'] },
      { id: 's3', name: 'C', lineup: ['C'] },
    ],
  };

  it('orders sides from the first side and rotates through them', () => {
    expect(sidesOf(solo).map((s) => s.id)).toEqual(['s2', 's3', 's1']);
    const s = deriveSet(solo, [t('s2', 3, 'B'), t('s3', 4, 'C')]);
    expect(s.nextTeam).toBe('s1');
    expect(s.nextPlayer).toBe('A');
  });

  it('rotates players within a team side', () => {
    const teams: SetConfig = {
      firstTeam: 's1',
      lineup: [],
      sides: [
        { id: 's1', name: 'Team 1', lineup: ['A', 'B'] },
        { id: 's2', name: 'Team 2', lineup: ['C', 'D', 'E'] },
      ],
    };
    const s = deriveSet(teams, [t('s1', 1, 'A'), t('s2', 1, 'C'), t('s1', 1, 'B'), t('s2', 1, 'D')]);
    expect(s.nextTeam).toBe('s1');
    expect(s.nextPlayer).toBe('A');
  });

  it('keeps playing after one side is disqualified and skips it', () => {
    const recs = [t('s2', 0), t('s3', 5), t('s1', 5), t('s2', 0), t('s3', 5), t('s1', 5), t('s2', 0)];
    const s = deriveSet(solo, recs);
    expect(s.teams.s2.eliminated).toBe(true);
    expect(s.winner).toBeNull();
    expect(s.nextTeam).toBe('s3');
    const s2 = deriveSet(solo, [...recs, t('s3', 5), t('s1', 5)]);
    expect(s2.nextTeam).toBe('s3');
  });

  it('the last side left wins', () => {
    const recs = [
      t('s2', 0), t('s3', 0), t('s1', 5),
      t('s2', 0), t('s3', 0), t('s1', 5),
      t('s2', 0), t('s3', 0),
    ];
    const s = deriveSet(solo, recs);
    expect(s.winner).toBe('s1');
    expect(s.endReason).toBe('opponent-eliminated');
    expect(s.nextTeam).toBeNull();
  });

  it('finishing at 50 ends the game at once', () => {
    const recs = [12, 12, 12, 12].flatMap((sc) => [t('s2', sc), t('s3', 1), t('s1', 1)]);
    const s = deriveSet(solo, [...recs, t('s2', 2)]);
    expect(s.winner).toBe('s2');
    expect(s.endReason).toBe('finish');
  });

});

describe('playableLength', () => {
  const cfg: SetConfig = { firstTeam: 'us', lineup: ['A'] };

  it('accepts a game recorded in turn', () => {
    const recs = [t('us', 5, 'A'), t('them', 3), t('us', 7, 'A')];
    expect(playableLength(cfg, recs)).toBe(3);
  });

  it('stops after a corrected throw that now finishes the game', () => {
    // us: 12, 12, 12, 4, 1, then 9 to finish; them throw 3 in between.
    const recs = [12, 12, 12, 4, 1].flatMap((x) => [t('us', x, 'A'), t('them', 3)]).concat(t('us', 9, 'A'));
    expect(playableLength(cfg, recs)).toBe(11);
    // Correcting the 1 to a 10 finishes there (40 + 10); the two throws after it no longer fit.
    const early = recs.map((r, i) => (i === 8 ? { ...r, score: 10 } : r));
    expect(deriveSet(cfg, early).winner).toBe('us');
    expect(playableLength(cfg, early)).toBe(9);
  });

  it('stops at a throw by a side that is now disqualified', () => {
    const sides = [{ id: 's1', name: 'A', lineup: ['A'] }, { id: 's2', name: 'B', lineup: ['B'] }, { id: 's3', name: 'C', lineup: ['C'] }];
    const pc: SetConfig = { firstTeam: 's1', lineup: [], sides };
    const turn = (a: number, b: number, c: number) => [t('s1', a, 'A'), t('s2', b, 'B'), t('s3', c, 'C')];
    const recs = [...turn(0, 5, 5), ...turn(0, 5, 5), ...turn(4, 5, 5), ...turn(0, 5, 5)];
    expect(playableLength(pc, recs)).toBe(12);
    // A third miss in a row on turn 3 disqualifies s1, so its turn-4 throw is out of turn.
    const fixed = recs.map((r, i) => (i === 6 ? { ...r, score: 0 } : r));
    expect(playableLength(pc, fixed)).toBe(9);
  });
});

describe('inTurnOrder', () => {
  it('fills in opponent throws recorded afterwards, keeping each side in its own order', () => {
    const cfg: SetConfig = { firstTeam: 'them', lineup: ['A', 'B'] };
    const us = [t('us', 5, 'A'), t('us', 7, 'B'), t('us', 9, 'A')];
    const them = [t('them', 3), t('them', 0)];
    expect(inTurnOrder(cfg, [...us, ...them]).map((r) => r.id)).toEqual([them[0], us[0], them[1], us[1], us[2]].map((r) => r.id));
  });

  it('leaves a game recorded in turn as it is, with a disqualified side skipped', () => {
    const sides = [{ id: 's1', name: 'A', lineup: [] }, { id: 's2', name: 'B', lineup: [] }, { id: 's3', name: 'C', lineup: [] }];
    const recs = [t('s1', 0), t('s2', 5), t('s3', 5), t('s1', 0), t('s2', 5), t('s3', 5), t('s1', 0), t('s2', 5), t('s3', 5), t('s2', 5)];
    expect(inTurnOrder({ firstTeam: 's1', lineup: [], sides }, recs)).toEqual(recs);
  });
});
