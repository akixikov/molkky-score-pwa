// Runs apps-script/Code.gs against an in-memory spreadsheet, so the web app's rules are tested here too.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';
import { rowsForMatch, SHEET_COLUMNS, type Match } from './store';

type Cell = string | number;
interface Gs {
  THROW_COLUMNS: string[];
  handle: (req: object, ss: FakeSpreadsheet, now: Date) => Record<string, unknown>;
}

/** Just enough of SpreadsheetApp's Sheet/Range for Code.gs. Rows and columns are 1-based. */
class FakeSheet {
  rows: Cell[][] = [];
  getLastRow() { return this.rows.length; }
  getLastColumn() { return Math.max(0, ...this.rows.map((r) => r.length)); }
  appendRow(r: Cell[]) { this.rows.push([...r]); }
  setFrozenRows() {}
  getRange(row: number, col: number, nRows: number, nCols: number) {
    return {
      getValues: () => Array.from({ length: nRows }, (_, i) => Array.from({ length: nCols }, (_, j) => this.rows[row - 1 + i]?.[col - 1 + j] ?? '')),
      setValues: (v: Cell[][]) => v.forEach((r, i) => {
        const target = (this.rows[row - 1 + i] ??= []);
        r.forEach((c, j) => { target[col - 1 + j] = c; });
      }),
      clearContent: () => { this.rows.splice(row - 1, nRows); },
    };
  }
}
class FakeSpreadsheet {
  sheets: Record<string, FakeSheet> = {};
  getSheetByName(n: string) { return this.sheets[n] ?? null; }
  insertSheet(n: string) { return (this.sheets[n] = new FakeSheet()); }
}

const gs = runInNewContext(`${readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8')}\n;({ THROW_COLUMNS, handle })`) as Gs;

const match = (id: string, scores: number[]): Match => ({
  id, date: '2026-09-21', tournament: 'Nara Open', opponent: 'Kanto', kind: 'tournament',
  sets: [{
    id: `${id}-g1`, setNo: 1, closed: false, config: { firstTeam: 'us', lineup: ['A'] },
    records: scores.map((score, i) => ({ id: `${id}-t${i}`, team: i % 2 ? 'them' : 'us', player: i % 2 ? undefined : 'A', score, ts: i })),
  }],
});
const put = (m: Match, deviceId = 'dev1') => ({ op: 'putMatch', match: m, deviceId, recorder: 'Aki', rows: rowsForMatch(m) });

let ss: FakeSpreadsheet;
const now = new Date('2026-09-27T10:00:00Z');
const throwsFor = (id: string) => ss.sheets.Throws.rows.slice(1).filter((r) => r[0] === id);
beforeEach(() => { ss = new FakeSpreadsheet(); });

describe('Code.gs', () => {
  it('uses the same throw columns as the app', () => {
    expect([...gs.THROW_COLUMNS]).toEqual([...SHEET_COLUMNS]);
  });

  it('ping answers without touching the sheets', () => {
    expect(gs.handle({ op: 'ping' }, ss, now)).toEqual({ ok: true, version: 2 });
    expect(Object.keys(ss.sheets)).toEqual([]);
  });

  it('putMatch stores the game and its throws, and replaces them when sent again', () => {
    expect(gs.handle(put(match('m1', [5, 1, 7])), ss, now)).toEqual({ ok: true, rows: 3 });
    expect(gs.handle(put(match('m2', [2, 2])), ss, now)).toMatchObject({ ok: true });
    expect(gs.handle(put(match('m1', [5, 1])), ss, now)).toEqual({ ok: true, rows: 2 });
    expect(ss.sheets.Games.rows.slice(1).map((r) => r[0])).toEqual(['m1', 'm2']);
    expect(throwsFor('m1')).toHaveLength(2);
    expect(throwsFor('m2')).toHaveLength(2);
    expect(throwsFor('m1')[0].slice(-3)).toEqual(['dev1', 'Aki', now.toISOString()]);
    expect(JSON.parse(String(ss.sheets.Games.rows[1][5])).sets[0].records).toHaveLength(2);
  });

  it('refuses a match recorded on another device', () => {
    gs.handle(put(match('m1', [5])), ss, now);
    expect(gs.handle(put(match('m1', [9]), 'dev2'), ss, now)).toEqual({ ok: false, error: 'not-owner' });
    expect(gs.handle({ op: 'deleteMatch', matchId: 'm1', deviceId: 'dev2' }, ss, now)).toEqual({ ok: false, error: 'not-owner' });
    expect(throwsFor('m1')[0][13]).toBe(5);
  });

  it('a teammate may delete a match only when forced, and the owner cannot bring it back', () => {
    gs.handle(put(match('m1', [5, 1])), ss, now);
    expect(gs.handle({ op: 'deleteMatch', matchId: 'm1', deviceId: 'dev2', force: true }, ss, now)).toEqual({ ok: true });
    expect(throwsFor('m1')).toHaveLength(0);
    // Still owned by dev1, so dev1 sees the deletion in its own games when it pulls.
    expect(ss.sheets.Games.rows[1].slice(0, 2)).toEqual(['m1', 'dev1']);
    expect(ss.sheets.Games.rows[1][4]).toBe(now.toISOString());
    expect(gs.handle(put(match('m1', [5, 1, 7])), ss, now)).toEqual({ ok: false, error: 'deleted' });
  });

  it('deleteMatch removes the throws and leaves a marker for other devices', () => {
    gs.handle(put(match('m1', [5, 1])), ss, now);
    expect(gs.handle({ op: 'deleteMatch', matchId: 'm1', deviceId: 'dev1' }, ss, now)).toEqual({ ok: true });
    expect(throwsFor('m1')).toHaveLength(0);
    expect(ss.sheets.Games.rows[1].slice(0, 5)).toEqual(['m1', 'dev1', 'Aki', now.toISOString(), now.toISOString()]);
    // The match data stays, so the deletion can be undone by clearing DeletedAt.
    expect(JSON.parse(String(ss.sheets.Games.rows[1][5])).id).toBe('m1');
    expect(gs.handle({ op: 'deleteMatch', matchId: 'unknown', deviceId: 'dev1' }, ss, now)).toEqual({ ok: true });
  });

  it('rejects bad rows', () => {
    const m = match('m1', [5]);
    const bad = (rows: object[]) => gs.handle({ ...put(m), rows }, ss, now);
    const row = rowsForMatch(m)[0];
    expect(bad([{ ...row, Score: 13 }])).toEqual({ ok: false, error: 'bad-rows' });
    expect(bad([{ ...row, Score: 1.5 }])).toEqual({ ok: false, error: 'bad-rows' });
    expect(bad([{ ...row, Team: 'x' }])).toEqual({ ok: false, error: 'bad-rows' });
    expect(bad([{ ...row, Extra: 1 }])).toEqual({ ok: false, error: 'bad-rows' });
    expect(bad([{ ...row, MatchID: 'other' }])).toEqual({ ok: false, error: 'bad-rows' });
    expect(bad(Array.from({ length: 501 }, () => row))).toEqual({ ok: false, error: 'bad-rows' });
    expect(gs.handle({ op: 'putMatch', deviceId: 'dev1', rows: [] }, ss, now)).toEqual({ ok: false, error: 'bad-request' });
  });

  it('accepts practice sides', () => {
    const m = match('p1', [5]);
    const rows = rowsForMatch(m).map((r) => ({ ...r, Team: 's3' }));
    expect(gs.handle({ ...put(m), rows }, ss, now)).toMatchObject({ ok: true });
  });

  it('pull returns every game, including deletions', () => {
    gs.handle(put(match('m1', [5])), ss, now);
    gs.handle(put(match('m2', [3]), 'dev2'), ss, now);
    gs.handle({ op: 'deleteMatch', matchId: 'm1', deviceId: 'dev1' }, ss, now);
    const r = gs.handle({ op: 'pull' }, ss, now) as { games: { matchId: string; deviceId: string; deletedAt: string; match: Match | null }[] };
    expect(r.games.map((g) => [g.matchId, g.deviceId, !!g.deletedAt, g.match?.id ?? null])).toEqual([
      ['m1', 'dev1', true, 'm1'],
      ['m2', 'dev2', false, 'm2'],
    ]);
  });

  it('rejects unknown operations', () => {
    expect(gs.handle({ op: 'drop' }, ss, now)).toEqual({ ok: false, error: 'bad-op' });
  });
});
