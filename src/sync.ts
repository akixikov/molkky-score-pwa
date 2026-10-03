// Team sync: sends this device's matches to the team spreadsheet's Apps Script web app.
// Settings, the unsent queue and the status live apart from the records (and out of backups),
// so the passphrase never ends up in an exported file.
import { get, set } from 'idb-keyval';
import { rowsForMatch, uid, type Match } from './store';

export interface SyncSettings {
  url: string;
  token: string;
  /** Identifies this device as the owner of the matches it records. */
  deviceId: string;
  /** Shown to teammates as who recorded a match. */
  recorder: string;
  auto: boolean;
}

/** Matches to send (by id), own matches to delete, and teammates' matches the user chose to delete or fix. */
export interface SyncQueue {
  put: string[];
  del: string[];
  /** Missing in queues saved before teammates' matches could be deleted. */
  delOthers?: string[];
  /** Teammates' matches corrected on this device. Missing in queues saved before that was possible. */
  putOthers?: string[];
}

export interface SyncStatus {
  lastSync?: number;
  lastError?: string;
  /** Version of the sheet script at the last pull (missing before VERSION 3 reported it). */
  sheetVersion?: number;
}

/** Sheet script version that accepts corrections to teammates' matches. */
export const FIX_OTHERS_VERSION = 3;
export const canFixOthers = (st: SyncStatus) => (st.sheetVersion ?? 0) >= FIX_OTHERS_VERSION;

/** A teammate's match pulled from the sheet. Its recorder's device owns it; others may only correct it (forced). */
export interface RemoteGame {
  match: Match;
  deviceId: string;
  recorder: string;
}

const SETTINGS_KEY = 'molkky-sync-v1';
const QUEUE_KEY = 'molkky-sync-queue-v1';
const STATUS_KEY = 'molkky-sync-status-v1';
const REMOTE_KEY = 'molkky-remote-v1';

export const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
export const emptyQueue = (): SyncQueue => ({ put: [], del: [], delOthers: [], putOthers: [] });
export const pendingCount = (q: SyncQueue) => q.put.length + q.del.length + (q.delOthers?.length ?? 0) + (q.putOthers?.length ?? 0);
export const newSettings = (): SyncSettings => ({ url: '', token: '', deviceId: uid(), recorder: '', auto: true });
export const isConfigured = (s: SyncSettings | null): s is SyncSettings => !!s && URL_RE.test(s.url) && !!s.token;

async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    return (await get<T>(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
export const loadSettings = () => load<SyncSettings | null>(SETTINGS_KEY, null);
export const saveSettings = (s: SyncSettings | null) => set(SETTINGS_KEY, s);
export const loadQueue = () => load<SyncQueue>(QUEUE_KEY, emptyQueue());
export const saveQueue = (q: SyncQueue) => set(QUEUE_KEY, q);
export const loadStatus = () => load<SyncStatus>(STATUS_KEY, {});
export const saveStatus = (s: SyncStatus) => set(STATUS_KEY, s);
export const loadRemote = () => load<RemoteGame[]>(REMOTE_KEY, []);
export const saveRemote = (r: RemoteGame[]) => set(REMOTE_KEY, r);

/** Adds changed and removed matches to the queue. A match changed several times is sent once. */
export function queueChanges(q: SyncQueue, prev: Match[], next: Match[]): SyncQueue {
  const before = new Map(prev.map((m) => [m.id, m]));
  const after = new Set(next.map((m) => m.id));
  const changed = next.filter((m) => before.get(m.id) !== m).map((m) => m.id);
  const removed = prev.filter((m) => !after.has(m.id)).map((m) => m.id);
  return {
    ...q,
    put: [...new Set([...q.put.filter((id) => !removed.includes(id)), ...changed])],
    del: [...new Set([...q.del.filter((id) => !changed.includes(id)), ...removed])],
  };
}

/** Queues every match on this device, e.g. for the first sync. */
export const queueAll = (q: SyncQueue, matches: Match[]): SyncQueue => ({
  ...q,
  put: [...new Set([...q.put, ...matches.map((m) => m.id)])],
});

/** Queues deleting a teammate's match (already confirmed by the user). A pending fix of it is dropped. */
export const queueDeleteOther = (q: SyncQueue, id: string): SyncQueue => ({
  ...q,
  delOthers: [...new Set([...(q.delOthers ?? []), id])],
  putOthers: (q.putOthers ?? []).filter((x) => x !== id),
});

/** Queues sending a teammate's match corrected on this device. */
export const queuePutOther = (q: SyncQueue, id: string): SyncQueue => ({
  ...q,
  putOthers: [...new Set([...(q.putOthers ?? []), id])],
});

export interface Reply {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

type Fetch = typeof fetch;

/** One request to the web app. text/plain avoids a CORS preflight, which Apps Script cannot answer. */
export async function call(url: string, body: object, fetchImpl: Fetch = fetch): Promise<Reply> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, error: 'network' };
  }
  try {
    const data = (await res.json()) as Reply;
    return typeof data?.ok === 'boolean' ? data : { ok: false, error: 'bad-response' };
  } catch {
    return { ok: false, error: 'bad-response' };
  }
}

export const ping = (s: SyncSettings, fetchImpl?: Fetch) => call(s.url, { op: 'ping', token: s.token }, fetchImpl);

export interface FlushResult {
  /** Sent matches with the version that was sent. */
  sent: { id: string; updatedAt?: number }[];
  /** Own deletions that went through. */
  deleted: string[];
  /** Matches the sheet refused because another device recorded them; they are dropped from the queue. */
  refused: string[];
  /** Queued matches no longer on this device (their deletion is queued separately). */
  dropped: string[];
  /** Teammates' matches deleted on the sheet. */
  deletedOthers: string[];
  /** Teammates' matches corrected on the sheet, with the version that was sent. */
  sentOthers: { id: string; updatedAt?: number }[];
  /** Teammates' matches the sheet would not delete or correct: its script predates the feature. */
  forceRefused: string[];
  /** Teammates' corrections with nothing left to correct (deleted or gone from the sheet). */
  lostOthers: string[];
  /** Own matches that were deleted on the sheet (by a teammate); they should go from this device too. */
  gone: string[];
  error?: string;
}

type ListKey = Exclude<keyof FlushResult, 'sent' | 'sentOthers' | 'error'>;
const emptyResult = (): FlushResult => ({
  sent: [], deleted: [], refused: [], dropped: [], deletedOthers: [], sentOthers: [], forceRefused: [], lostOthers: [], gone: [],
});

/**
 * Sends the queue in order: own deletions, teammates' deletions, matches, then teammates' corrected
 * matches (looked up in `others`). Stops at the first failure that would fail every request anyway
 * (network, passphrase). onStep reports each finished item right away, so progress survives the app
 * being closed mid-way.
 */
export async function flush(
  s: SyncSettings, q: SyncQueue, matches: Match[], fetchImpl?: Fetch, onStep?: (done: FlushResult) => void, others: Match[] = [],
): Promise<FlushResult> {
  const out = emptyResult();
  const step = (key: ListKey, id: string) => {
    out[key].push(id);
    onStep?.({ ...emptyResult(), [key]: [id] });
  };
  const base = { token: s.token, deviceId: s.deviceId };
  for (const id of q.del) {
    const r = await call(s.url, { ...base, op: 'deleteMatch', matchId: id }, fetchImpl);
    if (r.ok) step('deleted', id);
    else if (r.error === 'not-owner') step('refused', id);
    else return { ...out, error: r.error };
  }
  for (const id of q.delOthers ?? []) {
    const r = await call(s.url, { ...base, op: 'deleteMatch', matchId: id, force: true }, fetchImpl);
    if (r.ok) step('deletedOthers', id);
    else if (r.error === 'not-owner') step('forceRefused', id);
    else return { ...out, error: r.error };
  }
  for (const id of q.put) {
    const m = matches.find((x) => x.id === id);
    if (!m) { step('dropped', id); continue; }
    const r = await call(s.url, { ...base, op: 'putMatch', recorder: s.recorder, match: m, rows: rowsForMatch(m) }, fetchImpl);
    if (r.ok) {
      out.sent.push({ id, updatedAt: m.updatedAt });
      onStep?.({ ...emptyResult(), sent: [{ id, updatedAt: m.updatedAt }] });
    } else if (r.error === 'not-owner') step('refused', id);
    else if (r.error === 'deleted') step('gone', id);
    else return { ...out, error: r.error };
  }
  for (const id of q.putOthers ?? []) {
    const m = others.find((x) => x.id === id);
    if (!m) { step('lostOthers', id); continue; }
    const r = await call(s.url, { ...base, op: 'putMatch', recorder: s.recorder, match: m, rows: rowsForMatch(m), force: true }, fetchImpl);
    if (r.ok) {
      out.sentOthers.push({ id, updatedAt: m.updatedAt });
      onStep?.({ ...emptyResult(), sentOthers: [{ id, updatedAt: m.updatedAt }] });
    } else if (r.error === 'not-owner') step('forceRefused', id);
    else if (r.error === 'deleted' || r.error === 'not-found') step('lostOthers', id);
    else return { ...out, error: r.error };
  }
  return out;
}

/**
 * Removes what went through from the queue as it is now. A match changed again while it was
 * being sent stays queued, so the newer version goes out next time.
 */
export function afterFlush(q: SyncQueue, r: FlushResult, matches: Match[], others: Match[] = []): SyncQueue {
  const current = new Map(matches.map((m) => [m.id, m.updatedAt]));
  const done = new Set([
    ...r.sent.filter((x) => current.get(x.id) === x.updatedAt).map((x) => x.id),
    ...r.refused,
    ...r.dropped,
    ...r.gone,
  ]);
  const deleted = new Set([...r.deleted.filter((id) => !current.has(id)), ...r.refused]);
  const othersDeleted = new Set([...r.deletedOthers, ...r.forceRefused]);
  const otherNow = new Map(others.map((m) => [m.id, m.updatedAt]));
  const othersDone = new Set([
    ...r.sentOthers.filter((x) => otherNow.get(x.id) === x.updatedAt).map((x) => x.id),
    ...r.forceRefused,
    ...r.lostOthers,
  ]);
  return {
    put: q.put.filter((id) => !done.has(id)),
    del: q.del.filter((id) => !deleted.has(id)),
    delOthers: (q.delOthers ?? []).filter((id) => !othersDeleted.has(id)),
    putOthers: (q.putOthers ?? []).filter((id) => !othersDone.has(id)),
  };
}

/** Minimal shape check so a malformed row on the sheet cannot break the app. */
function isMatch(m: unknown): m is Match {
  const x = m as Match | null;
  return !!x && typeof x.id === 'string' && typeof x.date === 'string' && Array.isArray(x.sets)
    && x.sets.every((st) => !!st && Array.isArray(st.records) && !!st.config && Array.isArray(st.config.lineup));
}

/**
 * Teammates' matches from a pull: everything on the sheet except this device's own matches
 * (the device is the source of truth for those) and deleted ones. The pull is the full list,
 * so it replaces what was pulled before.
 */
export function fromPull(games: unknown, myDeviceId: string): RemoteGame[] | null {
  if (!Array.isArray(games)) return null;
  return games.flatMap((g) => {
    const x = g as { deviceId?: unknown; recorder?: unknown; deletedAt?: unknown; match?: unknown };
    if (typeof x.deviceId !== 'string' || x.deviceId === myDeviceId || x.deletedAt || !isMatch(x.match)) return [];
    return [{ match: x.match, deviceId: x.deviceId, recorder: typeof x.recorder === 'string' ? x.recorder : '' }];
  });
}

/** This device's own matches that were deleted on the sheet, e.g. by a teammate. */
export function ownDeleted(games: unknown, myDeviceId: string): string[] {
  if (!Array.isArray(games)) return [];
  return games.flatMap((g) => {
    const x = g as { matchId?: unknown; deviceId?: unknown; deletedAt?: unknown };
    return x.deviceId === myDeviceId && x.deletedAt && typeof x.matchId === 'string' ? [x.matchId] : [];
  });
}

/** This device's own matches that are live on the sheet (used to restore ones undeleted there). */
export function ownLive(games: unknown, myDeviceId: string): Match[] {
  if (!Array.isArray(games)) return [];
  return games.flatMap((g) => {
    const x = g as { deviceId?: unknown; deletedAt?: unknown; match?: unknown };
    return x.deviceId === myDeviceId && !x.deletedAt && isMatch(x.match) ? [x.match] : [];
  });
}

/**
 * Own matches a teammate corrected on the sheet: the sheet's version is newer than this device's
 * (whose last sent version carried its own updatedAt) and this device has nothing queued to send.
 * Newer, not just different: a change made here while sync was off is never queued, and must not
 * be replaced by the older version on the sheet.
 */
export function ownFixedElsewhere(live: Match[], mine: Match[], pendingPut: string[]): Match[] {
  const local = new Map(mine.map((m) => [m.id, m]));
  return live.filter((m) => {
    const here = local.get(m.id);
    return !!here && (m.updatedAt ?? 0) > (here.updatedAt ?? 0) && !pendingPut.includes(m.id);
  });
}

export interface PullResult {
  /** Version of the sheet script; 0 when it is too old to report one. */
  version?: number;
  games?: RemoteGame[];
  ownDeleted?: string[];
  ownLive?: Match[];
  error?: string;
}

export async function pull(s: SyncSettings, fetchImpl?: Fetch): Promise<PullResult> {
  const r = await call(s.url, { op: 'pull', token: s.token }, fetchImpl);
  if (!r.ok) return { error: r.error };
  const games = fromPull(r.games, s.deviceId);
  const version = typeof r.version === 'number' ? r.version : 0;
  return games ? { version, games, ownDeleted: ownDeleted(r.games, s.deviceId), ownLive: ownLive(r.games, s.deviceId) } : { error: 'bad-response' };
}

/** User-facing text for an error code from the web app or the network. */
export function errorText(code: string | undefined): string {
  switch (code) {
    case 'unauthorized': return 'Wrong passphrase.';
    case 'network': return 'No connection. Will retry.';
    case 'bad-response': return 'Unexpected reply. Check the web app URL and that it is deployed for "Anyone".';
    case 'not-owner': return 'A match was recorded on another device and was skipped.';
    case 'force-refused': return "Changing a teammate's match needs the updated sheet script (see the setup guide).";
    case 'too-large': return 'A match is too large for one sheet cell.';
    case undefined: return '';
    default: return `Sync failed (${code}).`;
  }
}
