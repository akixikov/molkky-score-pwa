import { describe, expect, it } from 'vitest';
import { deriveSet, type ThrowRecord } from './rules';
import { type Match } from './store';
import { applyPlayer, applyScore, applyWinner, canAdd, finalize, removeGame, type Cursor } from './editDraft';

let seq = 0;
const t = (team: string, score: number, player?: string): ThrowRecord => ({ id: `r${++seq}`, team, player, score, ts: seq });
const game = (id: string, records: ThrowRecord[], setNo = 1) => ({ id, setNo, closed: true, config: { firstTeam: 'us', lineup: ['A', 'B'] }, records });
const match = (...sets: ReturnType<typeof game>[]): Match => ({ id: 'm', date: '2026-10-03', tournament: 'T', opponent: 'O', kind: 'tournament', sets });
const scores = (m: Match, team: string) => m.sets[0].records.filter((r) => r.team === team).map((r) => r.score);

describe('edit draft', () => {
  it('fills a blank opponent column by tapping scores one after another', () => {
    // Imported game: only our throws.
    let m = match(game('g1', [t('us', 12, 'A'), t('us', 12, 'B'), t('us', 12, 'A')]));
    let cur: Cursor | null = { setId: 'g1', team: 'them' };
    for (const s of [5, 0, 7]) {
      const r = applyScore(m, cur!, s);
      m = r.match;
      cur = r.next;
    }
    expect(scores(m, 'them')).toEqual([5, 0, 7]);
    expect(m.sets[0].records.map((r) => r.team)).toEqual(['us', 'them', 'us', 'them', 'us', 'them']);
    // No more rows to fill.
    expect(cur).toBeNull();
  });

  it('fixing a throw moves to the same side\'s next throw', () => {
    const recs = [t('us', 5, 'A'), t('them', 3), t('us', 6, 'B'), t('them', 4)];
    const r = applyScore(match(game('g1', recs)), { setId: 'g1', recordId: recs[1].id }, 9);
    expect(scores(r.match, 'them')).toEqual([9, 4]);
    expect(r.next).toEqual({ setId: 'g1', recordId: recs[3].id });
  });

  it('refuses to add a throw after the game is over', () => {
    // us finish on their 5th throw; them have 4, so their 5th would come after the end.
    const recs = [12, 12, 12, 4, 10].flatMap((x, i) => (i < 4 ? [t('us', x, 'A'), t('them', 1)] : [t('us', x, 'A')]));
    const m = match(game('g1', recs));
    expect(deriveSet(m.sets[0].config, m.sets[0].records).winner).toBe('us');
    expect(canAdd(m.sets[0], 'them')).toBe(true);
    const r = applyScore(m, { setId: 'g1', team: 'them' }, 3);
    expect(r.late).toBe(true);
    expect(r.match).toBe(m);
  });

  it('changes the thrower, the winner, and removes games', () => {
    const recs = [t('us', 5, 'A'), t('them', 3)];
    let m = match(game('g1', recs), game('g2', [t('us', 1, 'A')], 2));
    m = applyPlayer(m, { setId: 'g1', recordId: recs[0].id }, 'B');
    expect(m.sets[0].records[0].player).toBe('B');
    m = applyWinner(m, 'g1', 'them');
    expect(m.sets[0].manualWinner).toBe('them');
    expect(applyWinner(m, 'g1', '').sets[0].manualWinner).toBeUndefined();
    m = removeGame(m, 'g1');
    expect(m.sets.map((s) => [s.id, s.setNo])).toEqual([['g2', 1]]);
  });

  it('saving drops throws a fix put out of turn, and counts them', () => {
    const recs = [12, 12, 12, 4, 1].flatMap((x) => [t('us', x, 'A'), t('them', 3)]).concat(t('us', 9, 'A'));
    const before = match(game('g1', recs));
    // 40 + 10 finishes on the fifth throw; them's last throw and our 9 no longer fit.
    const draft = applyScore(before, { setId: 'g1', recordId: recs[8].id }, 10).match;
    const { match: saved, dropped } = finalize(before, draft);
    expect(dropped).toBe(2);
    expect(saved.sets[0].records).toHaveLength(9);
    expect(finalize(before, before)).toEqual({ match: before, dropped: 0 });
  });
});
