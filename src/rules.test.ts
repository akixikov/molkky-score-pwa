import { describe, expect, it } from 'vitest';
import { applyThrow, deriveSet, hintsFor, scoreOf, type ThrowRecord, type Team } from './rules';

let seq = 0;
const t = (team: Team, score: number, player?: string): ThrowRecord => ({
  id: String(++seq),
  team,
  player,
  score,
  ts: seq,
});

describe('scoreOf', () => {
  it('one pin scores its number', () => expect(scoreOf([12])).toBe(12));
  it('two or more pins score the count', () => expect(scoreOf([10, 11, 12])).toBe(3));
  it('no pins is a miss', () => expect(scoreOf([])).toBe(0));
});

describe('applyThrow', () => {
  it('exactly 50 finishes', () => expect(applyThrow(41, 9)).toEqual({ after: 50, event: 'Finish' }));
  it('over 50 resets to 25', () => expect(applyThrow(45, 6)).toEqual({ after: 25, event: 'Over' }));
  it('a miss keeps the score', () => expect(applyThrow(30, 0)).toEqual({ after: 30, event: 'Miss' }));
});

describe('deriveSet', () => {
  const cfg = { firstTeam: 'us' as Team, lineup: ['A', 'B', 'C'] };

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

describe('hintsFor', () => {
  const cfg = { firstTeam: 'us' as Team, lineup: ['A'] };
  it('warns after one miss', () => {
    const s = deriveSet(cfg, [t('us', 0), t('them', 3)]);
    expect(hintsFor(s, 'us').map((h) => h.title)).toContain('1ミス中：崖っぷちモード');
  });
  it('suggests the 41–45 landing band', () => {
    const s = deriveSet(cfg, [t('us', 12), t('them', 3), t('us', 12), t('them', 3), t('us', 11)]);
    // 35 → need 6〜10
    const h = hintsFor(s, 'us').find((x) => x.title === '狙いの目安');
    expect(h?.body).toContain('6〜10点');
  });
  it('flags remaining 1', () => {
    const recs = [12, 12, 12, 12, 1].flatMap((sc) => [t('us', sc), t('them', 1)]);
    const s = deriveSet(cfg, recs);
    expect(s.teams.us.score).toBe(49);
    expect(hintsFor(s, 'us').some((h) => h.title === '残り1点')).toBe(true);
  });
});
