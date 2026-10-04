import { describe, expect, it, vi } from 'vitest';
import { rowsForMatch, toCsv, type Match } from './store';
import { afterFlush, call, canFixOthers, mergeRemote, ownBack, ownGone, flush, fromPull, ownDeleted, ownFixedElsewhere, ownLive, pull, queueAll, queueChanges, queueDeleteOther, queuePutOther, URL_RE, type SyncSettings } from './sync';

const match = (id: string, updatedAt = 1): Match => ({
  id, date: '2026-09-21', tournament: 'Nara Open', opponent: 'Kanto', kind: 'tournament', updatedAt,
  sets: [{
    id: `${id}-g1`, setNo: 1, closed: false, config: { firstTeam: 'us', lineup: ['A', 'B'] },
    records: [
      { id: 't1', team: 'us', player: 'A', score: 12, ts: 1 },
      { id: 't2', team: 'them', score: 0, ts: 2 },
      { id: 't3', team: 'us', player: 'B', score: 3, ts: 3 },
    ],
  }],
});

const settings: SyncSettings = { url: 'https://script.google.com/macros/s/abc_DEF-123/exec', token: 'secret', deviceId: 'dev1', recorder: 'Tester', auto: true };

/** A fetch stub that answers each request with the next reply and records the bodies sent. */
function fakeFetch(replies: (object | Error)[]) {
  const bodies: Record<string, unknown>[] = [];
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const r = replies.shift() ?? { ok: true };
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r));
  });
  return { fn: fn as unknown as typeof fetch, bodies };
}

describe('rowsForMatch', () => {
  it('matches the CSV export row for row', () => {
    const m = match('m1');
    const csv = toCsv({ version: 1, roster: [], matches: [m] }).replace('﻿', '').trim().split('\n');
    const head = csv[0].split(',');
    const rows = rowsForMatch(m);
    expect(rows).toHaveLength(3);
    rows.forEach((r, i) => expect(head.map((c) => String(r[c as keyof typeof r]))).toEqual(csv[i + 1].split(',')));
    expect(rows[0]).toMatchObject({ MatchID: 'm1', SetID: 'm1-g1', Team: 'us', Player: 'A', Score: 12, SideName: 'Us' });
  });
});

describe('queue', () => {
  it('queues changed and new matches once, and deletions', () => {
    const a = match('a'), b = match('b');
    let q = queueChanges({ put: [], del: [] }, [a, b], [{ ...a, updatedAt: 2 }, b]);
    q = queueChanges(q, [a, b], [{ ...a, updatedAt: 3 }, b, match('c')]);
    expect(q.put).toEqual(['a', 'c']);
    q = queueChanges(q, [a, b], [a]);
    expect(q).toEqual({ put: ['a', 'c'], del: ['b'] });
  });

  it('a deleted match is not sent, and a re-added one is not deleted', () => {
    const a = match('a');
    let q = queueChanges({ put: ['a'], del: [] }, [a], []);
    expect(q).toEqual({ put: [], del: ['a'] });
    q = queueChanges(q, [], [a]);
    expect(q).toEqual({ put: ['a'], del: [] });
  });

  it('queueAll adds every match', () => {
    expect(queueAll({ put: ['a'], del: ['x'] }, [match('a'), match('b')])).toEqual({ put: ['a', 'b'], del: ['x'] });
  });
});

describe('call', () => {
  it('sends text/plain JSON and returns the reply', async () => {
    const f = fakeFetch([{ ok: true, version: 1 }]);
    expect(await call(settings.url, { op: 'ping' }, f.fn)).toEqual({ ok: true, version: 1 });
    expect(f.bodies[0]).toEqual({ op: 'ping' });
  });
  it('maps a network failure and a non-JSON reply', async () => {
    expect(await call(settings.url, {}, fakeFetch([new TypeError('offline')]).fn)).toEqual({ ok: false, error: 'network' });
    const html = vi.fn(async () => new Response('<html>')) as unknown as typeof fetch;
    expect(await call(settings.url, {}, html)).toEqual({ ok: false, error: 'bad-response' });
  });
});

describe('flush', () => {
  it('sends deletions then matches with their throw rows', async () => {
    const f = fakeFetch([{ ok: true }, { ok: true }]);
    const r = await flush(settings, { put: ['a'], del: ['gone'] }, [match('a', 5)], f.fn);
    expect(r).toMatchObject({ sent: [{ id: 'a', updatedAt: 5 }], deleted: ['gone'] });
    expect(r.error).toBeUndefined();
    expect(f.bodies[0]).toMatchObject({ op: 'deleteMatch', matchId: 'gone', token: 'secret', deviceId: 'dev1' });
    expect(f.bodies[1]).toMatchObject({ op: 'putMatch', recorder: 'Tester', match: { id: 'a' } });
    expect((f.bodies[1].rows as unknown[]).length).toBe(3);
  });

  it('stops on a wrong passphrase and keeps the rest queued', async () => {
    const f = fakeFetch([{ ok: false, error: 'unauthorized' }]);
    const r = await flush(settings, { put: ['a', 'b'], del: [] }, [match('a'), match('b')], f.fn);
    expect(r.error).toBe('unauthorized');
    expect(afterFlush({ put: ['a', 'b'], del: [] }, r, [match('a'), match('b')])).toEqual({ put: ['a', 'b'], del: [], delOthers: [], putOthers: [] });
  });

  it('drops matches another device owns and carries on', async () => {
    const f = fakeFetch([{ ok: false, error: 'not-owner' }, { ok: true }]);
    const r = await flush(settings, { put: ['a', 'b'], del: [] }, [match('a'), match('b')], f.fn);
    expect(r).toMatchObject({ refused: ['a'], sent: [{ id: 'b' }] });
    expect(afterFlush({ put: ['a', 'b'], del: [] }, r, [match('a'), match('b')])).toEqual({ put: [], del: [], delOthers: [], putOthers: [] });
  });

  it('keeps a match queued when it changed while being sent', () => {
    const r = { sent: [{ id: 'a', updatedAt: 1 }], deleted: [], refused: [], dropped: [], deletedOthers: [], sentOthers: [], forceRefused: [], lostOthers: [], gone: [] };
    expect(afterFlush({ put: ['a'], del: [] }, r, [match('a', 2)])).toEqual({ put: ['a'], del: [], delOthers: [], putOthers: [] });
    expect(afterFlush({ put: ['a'], del: [] }, r, [match('a', 1)])).toEqual({ put: [], del: [], delOthers: [], putOthers: [] });
  });

  it('reports each finished item as it goes, so an interrupted send keeps its progress', async () => {
    let q = { put: ['a', 'b', 'c'], del: ['x'] };
    const matches = [match('a'), match('b'), match('c')];
    const f = fakeFetch([{ ok: true }, { ok: true }, { ok: true }, new TypeError('offline')]);
    const r = await flush(settings, q, matches, f.fn, (done) => { q = afterFlush(q, done, matches); });
    expect(r.error).toBe('network');
    expect(q).toEqual({ put: ['c'], del: [], delOthers: [], putOthers: [] });
  });

  it('drops queued matches that no longer exist', async () => {
    const r = await flush(settings, { put: ['gone'], del: [] }, [], fakeFetch([]).fn);
    expect(afterFlush({ put: ['gone'], del: [] }, r, [])).toEqual({ put: [], del: [], delOthers: [], putOthers: [] });
  });
});

describe('URL check', () => {
  it('accepts only Apps Script web app URLs', () => {
    expect(URL_RE.test(settings.url)).toBe(true);
    expect(URL_RE.test('https://script.google.com/macros/s/abc/dev')).toBe(false);
    expect(URL_RE.test('https://example.com/macros/s/abc/exec')).toBe(false);
  });
});

describe('pull', () => {
  it("keeps teammates' matches and leaves out this device's and deleted ones", () => {
    const games = [
      { matchId: 'a', deviceId: 'dev1', recorder: 'Tester', deletedAt: '', match: match('a') },
      { matchId: 'b', deviceId: 'dev2', recorder: 'Ken', deletedAt: '', match: match('b') },
      { matchId: 'c', deviceId: 'dev2', recorder: 'Ken', deletedAt: '2026-09-27T10:00:00Z', match: null },
      { matchId: 'd', deviceId: 'dev3', recorder: 'Mai', deletedAt: '', match: { id: 'd' } },
    ];
    expect(fromPull(games, 'dev1')).toEqual([{ match: match('b'), deviceId: 'dev2', recorder: 'Ken' }]);
    expect(fromPull('nope', 'dev1')).toBeNull();
  });

  it('asks the web app for every game', async () => {
    const f = fakeFetch([{ ok: true, games: [{ deviceId: 'dev2', recorder: 'Ken', deletedAt: '', match: match('b') }] }]);
    // An old sheet script reports no version, so corrections to teammates' matches stay off.
    expect(await pull(settings, f.fn)).toEqual({ version: 0, games: [{ match: match('b'), deviceId: 'dev2', recorder: 'Ken' }], ownDeleted: [], ownLive: [] });
    expect(await pull(settings, fakeFetch([{ ok: true, version: 3, games: [] }]).fn)).toMatchObject({ version: 3 });
    expect([canFixOthers({}), canFixOthers({ sheetVersion: 2 }), canFixOthers({ sheetVersion: 3 })]).toEqual([false, false, true]);
    expect(f.bodies[0]).toEqual({ op: 'pull', token: 'secret' });
    expect(await pull(settings, fakeFetch([{ ok: false, error: 'unauthorized' }]).fn)).toEqual({ error: 'unauthorized' });
    expect(await pull(settings, fakeFetch([{ ok: true }]).fn)).toEqual({ error: 'bad-response' });
  });
});

describe("deleting teammates' matches", () => {
  it('sends a forced delete and clears it from the queue', async () => {
    const f = fakeFetch([{ ok: true }]);
    const q = queueDeleteOther({ put: [], del: [] }, 'x');
    const r = await flush(settings, q, [], f.fn);
    expect(f.bodies[0]).toMatchObject({ op: 'deleteMatch', matchId: 'x', deviceId: 'dev1', force: true });
    expect(r.deletedOthers).toEqual(['x']);
    expect(afterFlush(q, r, [])).toEqual({ put: [], del: [], delOthers: [], putOthers: [] });
  });

  it('reports a sheet script too old to allow it', async () => {
    const r = await flush(settings, { put: [], del: [], delOthers: ['x'] }, [], fakeFetch([{ ok: false, error: 'not-owner' }]).fn);
    expect(r.forceRefused).toEqual(['x']);
  });

  it('an own match deleted on the sheet is reported as gone', async () => {
    const r = await flush(settings, { put: ['a'], del: [] }, [match('a')], fakeFetch([{ ok: false, error: 'deleted' }]).fn);
    expect(r.gone).toEqual(['a']);
    expect(afterFlush({ put: ['a'], del: [] }, r, [match('a')])).toEqual({ put: [], del: [], delOthers: [], putOthers: [] });
  });

  it('a pull lists own matches deleted by teammates', () => {
    const games = [
      { matchId: 'a', deviceId: 'dev1', deletedAt: '2026-09-27T10:00:00Z', match: null },
      { matchId: 'b', deviceId: 'dev1', deletedAt: '', match: match('b') },
      { matchId: 'c', deviceId: 'dev2', deletedAt: '2026-09-27T10:00:00Z', match: null },
    ];
    expect(ownDeleted(games, 'dev1')).toEqual(['a']);
  });

  it('a pull lists own live matches, for restoring ones undeleted on the sheet', () => {
    const games = [
      { matchId: 'a', deviceId: 'dev1', deletedAt: '', match: match('a') },
      { matchId: 'b', deviceId: 'dev1', deletedAt: '2026-09-27T10:00:00Z', match: match('b') },
      { matchId: 'c', deviceId: 'dev2', deletedAt: '', match: match('c') },
    ];
    expect(ownLive(games, 'dev1').map((m) => m.id)).toEqual(['a']);
  });

  it('queue changes keep pending teammate deletions', () => {
    const q = queueChanges({ put: [], del: [], delOthers: ['x'] }, [], [match('a')]);
    expect(q).toEqual({ put: ['a'], del: [], delOthers: ['x'] });
  });
});

describe("correcting teammates' matches", () => {
  it('sends a forced put of the corrected match after own changes, and clears it from the queue', async () => {
    const f = fakeFetch([{ ok: true }, { ok: true }]);
    const q = queuePutOther({ put: ['a'], del: [] }, 'x');
    const others = [match('x', 5)];
    const r = await flush(settings, q, [match('a')], f.fn, undefined, others);
    expect(f.bodies.map((b) => [b.op, (b.match as Match).id, b.force])).toEqual([['putMatch', 'a', undefined], ['putMatch', 'x', true]]);
    expect(f.bodies[1].rows).toEqual(rowsForMatch(others[0]));
    expect(r.sentOthers).toEqual([{ id: 'x', updatedAt: 5 }]);
    expect(afterFlush(q, r, [match('a')], others)).toEqual({ put: [], del: [], delOthers: [], putOthers: [] });
    // Corrected again while it was being sent: stays queued.
    expect(afterFlush(q, r, [match('a')], [match('x', 6)]).putOthers).toEqual(['x']);
  });

  it('drops a correction the sheet has nothing to apply to, or cannot accept yet', async () => {
    const q = { put: [], del: [], putOthers: ['x', 'y', 'z', 'gone'] };
    const others = [match('x'), match('y'), match('z')];
    const f = fakeFetch([{ ok: false, error: 'deleted' }, { ok: false, error: 'not-found' }, { ok: false, error: 'not-owner' }]);
    const r = await flush(settings, q, [], f.fn, undefined, others);
    expect(r.lostOthers).toEqual(['x', 'y', 'gone']);
    expect(r.forceRefused).toEqual(['z']);
    expect(afterFlush(q, r, [], others).putOthers).toEqual([]);
  });

  it('deleting a teammate match drops its pending correction', () => {
    expect(queueDeleteOther(queuePutOther({ put: [], del: [] }, 'x'), 'x')).toMatchObject({ delOthers: ['x'], putOthers: [] });
  });

  it('the recording phone takes over a correction made elsewhere, unless it has a newer version to send', () => {
    const mine = [match('a', 1), match('b', 1), match('c', 1), match('e', 9)];
    const live = [match('a', 1), match('b', 9), match('c', 9), match('d', 9), match('e', 1)];
    expect(ownFixedElsewhere(live, mine, []).map((m) => m.id)).toEqual(['b', 'c']);
    expect(ownFixedElsewhere(live, mine, ['c']).map((m) => m.id)).toEqual(['b']);
    // 'e' changed here while sync was off (so never queued): the older sheet version must not win.
  });
});

describe('applying a pull', () => {
  const remote = (id: string, updatedAt = 1) => ({ match: match(id, updatedAt), deviceId: 'dev2', recorder: 'Ken' });

  it("keeps teammates' matches deleted or corrected here until that is sent", () => {
    const pulled = [remote('a'), remote('b'), remote('c')];
    const current = [remote('a'), remote('b', 7)];
    const merged = mergeRemote(pulled, current, { put: [], del: [], delOthers: ['a'], putOthers: ['b'] });
    expect(merged.map((g) => [g.match.id, g.match.updatedAt])).toEqual([['b', 7], ['c', 1]]);
    // Nothing pending: the pull replaces everything.
    expect(mergeRemote(pulled, current, { put: [], del: [] })).toEqual(pulled);
  });

  it('removes own matches deleted on the sheet and drops their pending deletion', () => {
    const mine = [match('a'), match('b')];
    const { remove, queue } = ownGone(['a', 'x'], mine, { put: [], del: ['a', 'b'] });
    expect(remove).toEqual(['a']);
    expect(queue.del).toEqual(['b']);
    const none = { put: [], del: ['b'] };
    expect(ownGone(['x'], mine, none)).toEqual({ remove: [], queue: none });
  });

  it('brings back own matches undeleted on the sheet and takes over corrections', () => {
    const mine = [match('a', 1), match('b', 1)];
    const live = [match('a', 1), match('b', 5), match('c', 1), match('d', 1)];
    const r = ownBack(live, mine, { put: [], del: ['d'] });
    // 'd' is about to be deleted here, so it does not come back.
    expect(r.restore.map((m) => m.id)).toEqual(['c']);
    expect(r.replace.map((m) => m.id)).toEqual(['b']);
  });
});
