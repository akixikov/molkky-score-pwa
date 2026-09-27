// Team sync state for the UI: the unsent queue, sending, and pulling teammates' matches.
import { useEffect, useRef, useState } from 'react';
import { type AppData, type Match } from './store';
import { afterFlush, emptyQueue, errorText, flush, isConfigured, loadQueue, loadRemote, loadSettings, loadStatus, pull, queueAll, queueChanges, saveQueue, saveRemote, saveSettings, saveStatus, type RemoteGame, type SyncQueue, type SyncSettings, type SyncStatus } from './sync';

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
}

export const PULL_EVERY_MS = 60_000;

/**
 * Keeps the unsent queue and sends it to the team spreadsheet, then pulls teammates' matches:
 * shortly after each change, when the app starts or comes back to the foreground, and when
 * the device goes online.
 */
export function useTeamSync(getMatches: () => Match[]): Sync {
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [queue, setQueue] = useState<SyncQueue>(emptyQueue());
  const [status, setStatus] = useState<SyncStatus>({});
  const [remote, setRemote] = useState<RemoteGame[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef({ settings: null as SyncSettings | null, queue: emptyQueue(), running: false, again: false, timer: 0, lastPull: 0 });

  const writeQueue = (q: SyncQueue) => {
    ref.current.queue = q;
    setQueue(q);
    saveQueue(q);
  };
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
    const needPush = q.put.length > 0 || q.del.length > 0;
    const needPull = forcePull || Date.now() - ref.current.lastPull > PULL_EVERY_MS;
    if (!needPush && !needPull) return;
    ref.current.running = true;
    setBusy(true);
    let error: string | undefined;
    let refused = false;
    if (needPush) {
      // Take each finished match off the queue at once, so a long send cut short still counts.
      const r = await flush(s, q, getMatches(), undefined, (done) => writeQueue(afterFlush(ref.current.queue, done, getMatches())));
      writeQueue(afterFlush(ref.current.queue, r, getMatches()));
      error = r.error;
      refused = r.refused.length > 0;
    }
    if (!error && needPull) {
      const p = await pull(s);
      if (p.games) {
        ref.current.lastPull = Date.now();
        setRemote(p.games);
        saveRemote(p.games);
      } else error = p.error;
    }
    writeStatus((prev) => (error
      ? { ...prev, lastError: error }
      : { lastSync: Date.now(), lastError: refused ? 'not-owner' : undefined }));
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
      setRemote(isConfigured(s) ? rm : []);
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
        setRemote([]);
        saveRemote([]);
      }
    },
    sendAll: () => {
      writeQueue(queueAll(ref.current.queue, getMatches()));
      void run();
    },
  };
}

export const clock = (t: number) => {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('sv-SE').slice(5)} ${time}`;
};

/** One-line sync state for the home screen. */
export function syncSummary(sync: Sync): string {
  if (!isConfigured(sync.settings)) return 'Off';
  const pending = sync.queue.put.length + sync.queue.del.length;
  if (sync.busy) return pending > 0 ? `Sending… ${pending} left` : 'Syncing…';
  if (sync.status.lastError && pending > 0) return `${pending} unsent · ${errorText(sync.status.lastError)}`;
  if (pending > 0) return `${pending} unsent`;
  return sync.status.lastSync ? `Synced ${clock(sync.status.lastSync)}` : 'On';
}
