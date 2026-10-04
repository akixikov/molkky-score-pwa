// Team sync state for the UI: the unsent queue, sending, and pulling teammates' matches.
import { useEffect, useRef, useState } from 'react';
import { type AppData, type Match } from './store';
import { afterFlush, canFixOthers, emptyQueue, errorText, flush, isConfigured, loadQueue, loadRemote, loadSettings, loadStatus, ownFixedElsewhere, pendingCount, pull, queueAll, queueChanges, queueDeleteOther, queuePutOther, saveQueue, saveRemote, saveSettings, saveStatus, type RemoteGame, type SyncQueue, type SyncSettings, type SyncStatus } from './sync';

export interface Sync {
  settings: SyncSettings | null;
  queue: SyncQueue;
  status: SyncStatus;
  /** Teammates' matches from the last pull. */
  remote: RemoteGame[];
  busy: boolean;
  onChange: (prev: AppData, next: AppData) => void;
  save: (s: SyncSettings) => void;
  /** Sends the queue, then pulls teammates' matches (at most once a minute unless forced). */
  run: (forcePull?: boolean) => Promise<void>;
  sendAll: () => void;
  /** Deletes a teammate's match for everyone (the user has confirmed). */
  deleteOther: (id: string) => void;
  /** Corrects a teammate's match; the fix goes to the sheet and reaches the recording phone from there. */
  editOther: (id: string, fn: (m: Match) => Match) => void;
  /** The sheet script accepts such corrections (an older one refuses them, and the fix would be undone). */
  canEditOthers: boolean;
}

const PULL_EVERY_MS = 60_000;

/**
 * Keeps the unsent queue and sends it to the team spreadsheet, then pulls teammates' matches:
 * shortly after each change, when the app starts or comes back to the foreground, and when
 * the device goes online.
 */
/**
 * The sheet changed this device's own matches: a teammate deleted some or corrected some (replace),
 * or a deletion was undone on the sheet (DeletedAt cleared) and the match comes back.
 */
export type OwnChanges = (change: { remove: string[]; restore: Match[]; replace: Match[] }) => void;

export function useTeamSync(getMatches: () => Match[], applyOwn: OwnChanges): Sync {
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [queue, setQueue] = useState<SyncQueue>(emptyQueue());
  const [status, setStatus] = useState<SyncStatus>({});
  const [remote, setRemote] = useState<RemoteGame[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef({ settings: null as SyncSettings | null, queue: emptyQueue(), remote: [] as RemoteGame[], running: false, again: false, timer: 0, lastPull: 0 });

  const writeQueue = (q: SyncQueue) => {
    ref.current.queue = q;
    setQueue(q);
    saveQueue(q);
  };
  const writeRemote = (r: RemoteGame[]) => {
    ref.current.remote = r;
    setRemote(r);
    saveRemote(r);
  };
  const remoteMatches = () => ref.current.remote.map((g) => g.match);
  const writeStatus = (fn: (s: SyncStatus) => SyncStatus) => setStatus((prev) => {
    const next = fn(prev);
    saveStatus(next);
    return next;
  });

  const run = async (forcePull = false) => {
    const s = ref.current.settings;
    if (!isConfigured(s)) return;
    if (ref.current.running) { ref.current.again = true; return; }
    const q = ref.current.queue;
    const needPush = pendingCount(q) > 0;
    const needPull = forcePull || Date.now() - ref.current.lastPull > PULL_EVERY_MS;
    if (!needPush && !needPull) return;
    ref.current.running = true;
    setBusy(true);
    let error: string | undefined;
    let notice: string | undefined;
    let sheetVersion: number | undefined;
    // Own matches a teammate deleted on the sheet leave this device too.
    const dropOwn = (ids: string[]) => {
      const mine = new Set(getMatches().map((m) => m.id));
      const gone = ids.filter((id) => mine.has(id));
      if (gone.length === 0) return;
      applyOwn({ remove: gone, restore: [], replace: [] });
      // Already deleted on the sheet: do not send the deletion back.
      const q = ref.current.queue;
      writeQueue({ ...q, del: q.del.filter((id) => !gone.includes(id)) });
    };
    // Own matches live on the sheet but missing here (undeleted on the sheet) come back,
    // unless this device is still about to delete them itself. Ones a teammate corrected are taken over.
    const restoreOwn = (live: Match[]) => {
      const mine = getMatches();
      const ids = new Set(mine.map((m) => m.id));
      const deleting = new Set(ref.current.queue.del);
      const back = live.filter((m) => !ids.has(m.id) && !deleting.has(m.id));
      const fixed = ownFixedElsewhere(live, mine, ref.current.queue.put);
      if (back.length > 0 || fixed.length > 0) applyOwn({ remove: [], restore: back, replace: fixed });
    };
    if (needPush) {
      // Take each finished match off the queue at once, so a long send cut short still counts.
      const r = await flush(s, q, getMatches(), undefined,
        (done) => writeQueue(afterFlush(ref.current.queue, done, getMatches(), remoteMatches())), remoteMatches());
      writeQueue(afterFlush(ref.current.queue, r, getMatches(), remoteMatches()));
      dropOwn(r.gone);
      error = r.error;
      notice = r.forceRefused.length > 0 ? 'force-refused' : r.refused.length > 0 ? 'not-owner' : undefined;
    }
    if (!error && needPull) {
      const p = await pull(s);
      if (p.games) {
        ref.current.lastPull = Date.now();
        sheetVersion = p.version;
        // A teammate's match deleted here but not yet on the sheet stays hidden; one corrected here
        // but not yet sent keeps the correction.
        const pending = new Set(ref.current.queue.delOthers ?? []);
        const fixing = new Map(ref.current.remote.filter((g) => ref.current.queue.putOthers?.includes(g.match.id)).map((g) => [g.match.id, g]));
        writeRemote(p.games.filter((g) => !pending.has(g.match.id)).map((g) => fixing.get(g.match.id) ?? g));
        dropOwn(p.ownDeleted ?? []);
        restoreOwn(p.ownLive ?? []);
      } else error = p.error;
    }
    writeStatus((prev) => (error
      ? { ...prev, lastError: error }
      : { lastSync: Date.now(), lastError: notice, sheetVersion: sheetVersion ?? prev.sheetVersion }));
    ref.current.running = false;
    setBusy(false);
    if (ref.current.again) { ref.current.again = false; void run(); }
  };

  useEffect(() => {
    Promise.all([loadSettings(), loadQueue(), loadStatus(), loadRemote()]).then(([s, q, st, rm]) => {
      ref.current.settings = s;
      ref.current.queue = q;
      setSettings(s);
      setQueue(q);
      setStatus(st);
      ref.current.remote = isConfigured(s) ? rm : [];
      setRemote(ref.current.remote);
      if (s?.auto) void run(true);
    });
    const retry = () => { if (ref.current.settings?.auto && document.visibilityState === 'visible') void run(); };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, []);

  return {
    settings, queue, status, remote, busy, run,
    canEditOthers: canFixOthers(status),
    onChange: (prev, next) => {
      if (!isConfigured(ref.current.settings)) return;
      writeQueue(queueChanges(ref.current.queue, prev.matches, next.matches));
      if (ref.current.settings.auto) {
        window.clearTimeout(ref.current.timer);
        ref.current.timer = window.setTimeout(() => void run(), 1500);
      }
    },
    save: (s) => {
      ref.current.settings = s;
      setSettings(s);
      saveSettings(s);
      if (isConfigured(s)) void run(true);
      else {
        // Turning sync off also forgets teammates' matches on this device.
        writeQueue(emptyQueue());
        writeRemote([]);
      }
    },
    sendAll: () => {
      writeQueue(queueAll(ref.current.queue, getMatches()));
      void run();
    },
    deleteOther: (id) => {
      writeQueue(queueDeleteOther(ref.current.queue, id));
      writeRemote(ref.current.remote.filter((g) => g.match.id !== id));
      void run();
    },
    editOther: (id, fn) => {
      const g = ref.current.remote.find((x) => x.match.id === id);
      if (!g) return;
      writeRemote(ref.current.remote.map((x) => (x === g ? { ...g, match: { ...fn(g.match), updatedAt: Date.now() } } : x)));
      writeQueue(queuePutOther(ref.current.queue, id));
      void run();
    },
  };
}

export const clock = (t: number) => {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('sv-SE').slice(5)} ${time}`;
};

/** Errors worth showing even when nothing is left to send (the refused item was dropped). */
export const showsWhenIdle = (code: string | undefined) => code === 'force-refused' || code === 'not-owner';

/** One-line sync state for the home screen. */
export function syncSummary(sync: Sync): string {
  if (!isConfigured(sync.settings)) return 'Off';
  const pending = pendingCount(sync.queue);
  if (sync.busy) return pending > 0 ? `Sending… ${pending} left` : 'Syncing…';
  if (sync.status.lastError && pending > 0) return `${pending} unsent · ${errorText(sync.status.lastError)}`;
  if (showsWhenIdle(sync.status.lastError)) return errorText(sync.status.lastError);
  if (pending > 0) return `${pending} unsent`;
  return sync.status.lastSync ? `Synced ${clock(sync.status.lastSync)}` : 'On';
}

/** Short sync state for the chip at the top of the home screen; the full text is in syncSummary. */
export function syncChip(sync: Sync): { label: string; tone: 'off' | 'ok' | 'busy' | 'warn' } {
  if (!isConfigured(sync.settings)) return { label: 'Sync off', tone: 'off' };
  const pending = pendingCount(sync.queue);
  if (sync.busy) return { label: 'Syncing…', tone: 'busy' };
  if (sync.status.lastError && (pending > 0 || showsWhenIdle(sync.status.lastError))) return { label: 'Sync issue', tone: 'warn' };
  if (pending > 0) return { label: `${pending} unsent`, tone: 'warn' };
  return { label: sync.status.lastSync ? `Synced ${clock(sync.status.lastSync)}` : 'Sync on', tone: 'ok' };
}
