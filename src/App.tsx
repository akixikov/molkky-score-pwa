import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from 'react';
import './App.css';
import {
  deriveSet, hintsFor, MAX_PRACTICE_PLAYERS, other, PIN_ROWS, WIN_SCORE,
  type DerivedThrow, type SetState, type Side, type SideId, type Team, type ThrowRecord,
} from './rules';
import { pct, teamStats } from './stats';
import {
  download, emptyData, loadData, saveData, setWinner, stampChanged, toCsv, tournamentKey, uid,
  type AppData, type Match, type SetEntry,
} from './store';
import {
  afterFlush, emptyQueue, errorText, flush, isConfigured, loadQueue, loadSettings, loadStatus, newSettings, ping,
  queueAll, queueChanges, saveQueue, saveSettings, saveStatus, URL_RE,
  type SyncQueue, type SyncSettings, type SyncStatus,
} from './sync';

type Screen =
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'practice' }
  | { name: 'play'; matchId: string }
  | { name: 'match'; matchId: string }
  | { name: 'review' }
  | { name: 'sync' };

const today = () => new Date().toLocaleDateString('sv-SE');
type Names = Record<SideId, string>;
/** Team names, falling back to generic labels when not entered. */
const namesOf = (ourTeam: string | undefined, opponent: string): Names => ({ us: ourTeam || 'Us', them: opponent || 'Them' });
/** Practice games list every side (2–6); tournament games are us vs them. */
const isPracticeGame = (m: Match) => !!m.sets[0]?.config.sides;
/** Side names: team names in tournament games, side names in practice games. */
const teamNames = (m: Match): Names => {
  const sides = m.sets[0]?.config.sides;
  return sides ? Object.fromEntries(sides.map((x) => [x.id, x.name])) : namesOf(m.ourTeam, m.opponent);
};
/** Names of sides disqualified in a game, for end-of-game labels. */
const dqNames = (st: SetState, names: Names) => st.order.filter((x) => st.teams[x.id].eliminated).map((x) => names[x.id]).join(', ');

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  // The latest data, so consecutive updates and the sync see every change in order.
  const dataRef = useRef<AppData | null>(null);
  const sync = useTeamSync(() => dataRef.current?.matches ?? []);

  useEffect(() => {
    loadData().then((d) => {
      dataRef.current = d;
      setData(d);
    });
  }, []);

  const update = (fn: (d: AppData) => AppData) => {
    const prev = dataRef.current ?? emptyData();
    const next = stampChanged(prev, fn(prev));
    dataRef.current = next;
    setData(next);
    saveData(next);
    sync.onChange(prev, next);
  };

  if (!data) return <div className="screen">Loading…</div>;

  switch (screen.name) {
    case 'home':
      return <Home data={data} update={update} go={setScreen} sync={sync} />;
    case 'sync':
      return <TeamSync sync={sync} matches={data.matches} go={setScreen} />;
    case 'new':
      return <NewMatch data={data} update={update} go={setScreen} />;
    case 'practice':
      return <PracticeSetup data={data} update={update} go={setScreen} />;
    case 'review':
      return <Review data={data} go={setScreen} />;
    case 'play': {
      const m = data.matches.find((x) => x.id === screen.matchId);
      if (!m) return <Home data={data} update={update} go={setScreen} sync={sync} />;
      return <Play match={m} data={data} update={update} go={setScreen} />;
    }
    case 'match': {
      const m = data.matches.find((x) => x.id === screen.matchId);
      if (!m) return <Home data={data} update={update} go={setScreen} sync={sync} />;
      return <MatchSummary match={m} update={update} go={setScreen} />;
    }
  }
}

type Update = (fn: (d: AppData) => AppData) => void;
type Go = (s: Screen) => void;

/* ---------------- Team sync ---------------- */

interface Sync {
  settings: SyncSettings | null;
  queue: SyncQueue;
  status: SyncStatus;
  busy: boolean;
  onChange: (prev: AppData, next: AppData) => void;
  save: (s: SyncSettings) => void;
  run: () => Promise<void>;
  sendAll: () => void;
}

/**
 * Keeps the unsent queue and sends it to the team spreadsheet: shortly after each change,
 * when the app starts or comes back to the foreground, and when the device goes online.
 */
function useTeamSync(getMatches: () => Match[]): Sync {
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [queue, setQueue] = useState<SyncQueue>(emptyQueue());
  const [status, setStatus] = useState<SyncStatus>({});
  const [busy, setBusy] = useState(false);
  const ref = useRef({ settings: null as SyncSettings | null, queue: emptyQueue(), running: false, again: false, timer: 0 });

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

  const run = async () => {
    const s = ref.current.settings;
    if (!isConfigured(s)) return;
    if (ref.current.running) { ref.current.again = true; return; }
    const q = ref.current.queue;
    if (q.put.length === 0 && q.del.length === 0) return;
    ref.current.running = true;
    setBusy(true);
    const r = await flush(s, q, getMatches());
    writeQueue(afterFlush(ref.current.queue, r, getMatches()));
    writeStatus((prev) => (r.error
      ? { ...prev, lastError: r.error }
      : { lastSync: Date.now(), lastError: r.refused.length > 0 ? 'not-owner' : undefined }));
    ref.current.running = false;
    setBusy(false);
    if (ref.current.again) { ref.current.again = false; void run(); }
  };

  useEffect(() => {
    Promise.all([loadSettings(), loadQueue(), loadStatus()]).then(([s, q, st]) => {
      ref.current.settings = s;
      ref.current.queue = q;
      setSettings(s);
      setQueue(q);
      setStatus(st);
      if (s?.auto) void run();
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
    settings, queue, status, busy, run,
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
      if (!isConfigured(s)) writeQueue(emptyQueue());
    },
    sendAll: () => {
      writeQueue(queueAll(ref.current.queue, getMatches()));
      void run();
    },
  };
}

const clock = (t: number) => {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('sv-SE').slice(5)} ${time}`;
};

/** One-line sync state for the home screen. */
function syncSummary(sync: Sync): string {
  if (!isConfigured(sync.settings)) return 'Off';
  const pending = sync.queue.put.length + sync.queue.del.length;
  if (sync.busy) return 'Sending…';
  if (sync.status.lastError && pending > 0) return `${pending} unsent · ${errorText(sync.status.lastError)}`;
  if (pending > 0) return `${pending} unsent`;
  return sync.status.lastSync ? `Synced ${clock(sync.status.lastSync)}` : 'On';
}

/** Connects this phone to the team spreadsheet's web app. */
function TeamSync({ sync, matches, go }: { sync: Sync; matches: Match[]; go: Go }) {
  const [form, setForm] = useState<SyncSettings>(() => sync.settings ?? newSettings());
  const [test, setTest] = useState('');
  const [armed, setArmed] = useState(false);
  const clean = { ...form, url: form.url.trim(), token: form.token.trim(), recorder: form.recorder.trim() };
  const urlOk = URL_RE.test(clean.url);
  const valid = urlOk && !!clean.token && !!clean.recorder;
  const on = isConfigured(sync.settings);
  const pending = sync.queue.put.length + sync.queue.del.length;
  const field = (k: 'url' | 'token' | 'recorder') => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const testConnection = async () => {
    setTest('Testing…');
    const r = await ping(clean);
    setTest(r.ok ? 'Connected.' : errorText(r.error));
  };
  return (
    <div className="screen">
      <header className="head">
        <button className="link" onClick={() => go({ name: 'home' })}>← Back</button>
        <h1>Team sync</h1>
      </header>
      <div className="muted">
        Sends the matches recorded on this phone to the team spreadsheet. Ask the person who set up the sheet for the web app URL and the passphrase.
      </div>
      <div className="card col">
        <label className="field">
          Web app URL
          <input value={form.url} onChange={field('url')} placeholder="https://script.google.com/macros/s/…/exec" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
        {form.url.trim() && !urlOk && <div className="muted tiny warn-text">The URL should start with https://script.google.com/macros/s/ and end with /exec.</div>}
        <label className="field">Passphrase<input type="password" value={form.token} onChange={field('token')} autoCapitalize="off" autoCorrect="off" /></label>
        <label className="field">Your name<input value={form.recorder} onChange={field('recorder')} placeholder="Shown to teammates, e.g. Aki" /></label>
        <label className="inline check"><input type="checkbox" checked={form.auto} onChange={(e) => setForm({ ...form, auto: e.target.checked })} /> Sync automatically</label>
        <div className="grid2">
          <button className="ghost" disabled={!urlOk || !clean.token} onClick={testConnection}>Test connection</button>
          <button className="primary" disabled={!valid} onClick={() => { sync.save(clean); setTest(''); }}>Save</button>
        </div>
        {test && <div className="muted">{test}</div>}
      </div>
      {on && (
        <div className="card col">
          <div className="strong">Status</div>
          <div>{pending} unsent · {sync.status.lastSync ? `last sync ${clock(sync.status.lastSync)}` : 'not synced yet'}</div>
          {sync.status.lastError && pending > 0 && <div className="warn-text">{errorText(sync.status.lastError)}</div>}
          <div className="grid2">
            <button className="ghost" disabled={sync.busy || pending === 0} onClick={() => void sync.run()}>{sync.busy ? 'Sending…' : 'Sync now'}</button>
            <button className="ghost" disabled={sync.busy || matches.length === 0} onClick={sync.sendAll}>Send all my records ({matches.length})</button>
          </div>
          <div className="muted tiny">
            New changes are sent automatically. "Send all my records" also sends matches recorded before sync was set up.
          </div>
          <button className={armed ? 'danger small' : 'link'} onClick={() => {
            if (armed) { sync.save({ ...clean, url: '', token: '' }); setForm({ ...form, url: '', token: '' }); setArmed(false); } else setArmed(true);
          }}>
            {armed ? 'Really turn off sync' : 'Turn off sync'}
          </button>
        </div>
      )}
    </div>
  );
}

function patchMatch(d: AppData, id: string, fn: (m: Match) => Match): AppData {
  return { ...d, matches: d.matches.map((m) => (m.id === id ? fn(m) : m)) };
}

function patchCurrentSet(m: Match, fn: (s: SetEntry) => SetEntry): Match {
  const sets = [...m.sets];
  sets[sets.length - 1] = fn(sets[sets.length - 1]);
  return { ...m, sets };
}

/* ---------------- Home ---------------- */

const COLLAPSED_KEY = 'molkky-collapsed-groups';

function Home({ data, update, go, sync }: { data: AppData; update: Update; go: Go; sync: Sync }) {
  const [armed, setArmed] = useState<string | null>(null);
  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as AppData;
      if (parsed.version !== 1 || !Array.isArray(parsed.matches)) throw new Error('bad');
      update(() => parsed);
    } catch {
      alert('Could not read the backup file.');
    }
  };
  // Newest first, grouped by tournament (same date, name and kind).
  const groups = new Map<string, Match[]>();
  for (const m of [...data.matches].reverse()) {
    const key = tournamentKey(m);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  // Collapsed groups, remembered on this device. New groups start expanded;
  // on first use only the newest group of each section is expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(COLLAPSED_KEY);
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch { /* storage unavailable */ }
    const newest = new Set(['tournament', 'practice'].map((k) => [...groups].find(([, ms]) => ms[0].kind === k)?.[0]));
    return new Set([...groups.keys()].filter((k) => !newest.has(k)));
  });
  const toggleGroup = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key); else next.add(key);
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  };
  const result = (m: Match) => {
    const won = m.sets.filter((s) => setWinner(s) === 'us').length;
    const lost = m.sets.filter((s) => setWinner(s) === 'them').length;
    const last = m.sets[m.sets.length - 1];
    return { won, lost, winner: setWinner(last), decided: !!setWinner(last) || last.closed };
  };
  return (
    <div className="screen">
      <header className="head">
        <h1>Mölkky Scorer</h1>
      </header>
      <div className="grid2">
        <button className="primary big" onClick={() => go({ name: 'new' })}>New match</button>
        <button className="ghost big" onClick={() => go({ name: 'practice' })}>Practice game</button>
      </div>
      {(['tournament', 'practice'] as const).map((kind) => {
        const list = [...groups].filter(([, ms]) => ms[0].kind === kind);
        return (
          <section key={kind} className="col">
            <h2 className="section-title">{kind === 'tournament' ? 'Tournaments' : 'Practice'}</h2>
            {list.length === 0 && <div className="muted">{kind === 'tournament' ? 'No matches yet.' : 'No practice games yet.'}</div>}
            {list.map(([key, ms]) => {
              const first = ms[0];
              const rs = ms.map(result).filter((r) => r.decided);
              const w = rs.filter((r) => r.won > r.lost).length;
              const l = rs.filter((r) => r.won < r.lost).length;
              const isOpen = !collapsed.has(key);
              return (
                <section key={key} className="list">
                  <button className="group-head" aria-expanded={isOpen} onClick={() => toggleGroup(key)}>
                    <span className={`chev ${isOpen ? 'open' : ''}`} aria-hidden>›</span>
                    <div className="grow">
                      <div className="strong">{first.tournament || (first.kind === 'practice' ? first.date : '(no tournament)')}</div>
                      {(first.kind === 'tournament' || first.tournament) && <div className="sub">{first.date}</div>}
                    </div>
                    <div className="sub">
                      {ms.every(isPracticeGame)
                        ? `${ms.length} ${ms.length === 1 ? 'game' : 'games'}`
                        : `${ms.length} ${ms.length === 1 ? 'match' : 'matches'} · ${w}W ${l}L`}
                    </div>
                  </button>
                  {isOpen && ms.map((m) => {
                    const { won, lost, winner, decided } = result(m);
                    const practice = isPracticeGame(m);
                    const names = teamNames(m);
                    return (
                      <div key={m.id} className="card row">
                        <button className="rowmain" onClick={() => go({ name: decided ? 'match' : 'play', matchId: m.id })}>
                          <div className="strong">
                            {practice
                              ? (m.sets[0].config.sides ?? []).map((x) => x.name).join(' · ')
                              : `vs ${m.opponent || 'Opponent'}  ${won}-${lost}`}
                          </div>
                          {!decided
                            ? <div className="sub">In progress</div>
                            : practice && winner && <div className="sub">Winner: {names[winner]}</div>}
                        </button>
                        <button
                          className={armed === m.id ? 'danger small' : 'ghost small'}
                          onClick={() => {
                            if (armed === m.id) {
                              update((d) => ({ ...d, matches: d.matches.filter((x) => x.id !== m.id) }));
                              setArmed(null);
                            } else setArmed(m.id);
                          }}
                        >
                          {armed === m.id ? 'Really delete' : 'Delete'}
                        </button>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </section>
        );
      })}
      <div className="spacer" />
      <button className="ghost sync-row" onClick={() => go({ name: 'sync' })}>
        <span>Team sync</span><span className="muted">{syncSummary(sync)}</span>
      </button>
      <div className="grid2">
        <button className="ghost" onClick={() => go({ name: 'review' })}>Review</button>
        <button className="ghost" onClick={() => download(`molkky-${today()}.csv`, toCsv(data), 'text/csv')}>Export CSV</button>
        <button className="ghost" onClick={() => download(`molkky-backup-${today()}.json`, JSON.stringify(data), 'application/json')}>Save backup</button>
        <label className="ghost filebtn">
          Load backup
          <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </label>
      </div>
      <div className="muted tiny">Records are stored only on this device. Back up often.</div>
    </div>
  );
}

/* ---------------- Lineup editor ---------------- */

/** Saved members to pick from. In edit mode a tap removes a (mistyped) name from the saved list. */
function RosterChips({ names, onPick, onDelete }: { names: string[]; onPick: (n: string) => void; onDelete?: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (names.length === 0) return null;
  return (
    <div className="col gap4">
      <div className="chips">
        {names.map((r) => (editing && onDelete
          ? <button key={r} className="chip del" onClick={() => { onDelete(r); if (names.length === 1) setEditing(false); }}>× {r}</button>
          : <button key={r} className="chip" onClick={() => onPick(r)}>＋ {r}</button>))}
      </div>
      {onDelete && (
        <button className="link tiny" onClick={() => setEditing(!editing)}>
          {editing ? 'Done editing' : 'Edit saved members'}
        </button>
      )}
      {editing && <div className="muted tiny">Tap a name to remove it from the saved list. Past records keep it.</div>}
    </div>
  );
}

/**
 * Name box for adding a member. It is swapped for a fresh input after each add, so an
 * unfinished IME or predictive-text composition cannot write the previous name back in.
 */
function MemberInput({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  const [round, setRound] = useState(0);
  const add = () => {
    const n = name.trim();
    if (!n) return;
    onAdd(n);
    setName('');
    setRound((r) => r + 1);
  };
  return (
    <div className="inline">
      <input
        key={round} autoFocus={round > 0} value={name} placeholder="Add member"
        onChange={(e) => setName(e.target.value)}
        // Enter while converting kana only confirms the conversion.
        onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
      />
      <button className="ghost small" onClick={add}>Add</button>
    </div>
  );
}

function LineupEditor({ roster, lineup, onChange, onAddRoster, onRemoveRoster, max }: {
  roster: string[]; lineup: string[]; onChange: (l: string[]) => void; onAddRoster: (n: string) => void;
  onRemoveRoster?: (n: string) => void; max?: number;
}) {
  const full = max !== undefined && lineup.length >= max;
  const add = (n: string) => {
    if (full) return;
    if (!roster.includes(n)) onAddRoster(n);
    if (!lineup.includes(n)) onChange([...lineup, n]);
  };
  return (
    <div className="card col">
      <div className="strong">Throwing order</div>
      {lineup.length === 0 && <div className="muted">Tap members below to add them in order</div>}
      {lineup.map((p, i) => (
        <div key={p} className="lineup">
          <span className="num">{i + 1}</span>
          <span className="grow">{p}{i === 0 ? ' (1st)' : ''}</span>
          <button className="ghost small" disabled={i === 0} onClick={() => {
            const l = [...lineup];
            [l[i - 1], l[i]] = [l[i], l[i - 1]];
            onChange(l);
          }}>↑</button>
          <button className="ghost small" onClick={() => onChange(lineup.filter((x) => x !== p))}>×</button>
        </div>
      ))}
      {full ? <div className="muted tiny">Up to {max} players.</div> : (
        <>
          <RosterChips names={roster.filter((r) => !lineup.includes(r))} onPick={(r) => onChange([...lineup, r])} onDelete={onRemoveRoster} />
          <MemberInput onAdd={add} />
        </>
      )}
    </div>
  );
}

function TeamToggle({ value, onChange, names }: { value: Team; onChange: (t: Team) => void; names: Names }) {
  return (
    <div className="seg">
      {(['us', 'them'] as Team[]).map((t) => (
        <button key={t} className={value === t ? 'on' : ''} onClick={() => onChange(t)}>{names[t]} first</button>
      ))}
    </div>
  );
}

/* ---------------- New match ---------------- */

function NewMatch({ data, update, go }: { data: AppData; update: Update; go: Go }) {
  const last = data.matches.filter((m) => !isPracticeGame(m)).at(-1);
  const [date, setDate] = useState(today());
  const [tournament, setTournament] = useState(last?.date === today() ? last.tournament : '');
  const [opponent, setOpponent] = useState('');
  // Our team name rarely changes, so start from the previous match.
  const [ourTeam, setOurTeam] = useState(last?.ourTeam ?? '');
  const [firstTeam, setFirstTeam] = useState<Team>('us');
  const [lineup, setLineup] = useState<string[]>(last?.sets.at(-1)?.config.lineup ?? []);

  const start = () => {
    const m: Match = {
      id: uid(), date, tournament, opponent, ourTeam, kind: 'tournament',
      sets: [{ id: uid(), setNo: 1, config: { firstTeam, lineup }, records: [], closed: false }],
    };
    update((d) => ({ ...d, matches: [...d.matches, m] }));
    go({ name: 'play', matchId: m.id });
  };

  return (
    <div className="screen">
      <header className="head">
        <button className="link" onClick={() => go({ name: 'home' })}>← Back</button>
        <h1>New match</h1>
      </header>
      <div className="card col">
        <label className="field">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field">Tournament<input value={tournament} onChange={(e) => setTournament(e.target.value)} placeholder="e.g. Yamatokoriyama Open" /></label>
        <label className="field">Our team<input value={ourTeam} onChange={(e) => setOurTeam(e.target.value)} /></label>
        <label className="field">Opponent<input value={opponent} onChange={(e) => setOpponent(e.target.value)} /></label>
      </div>
      <div className="card col">
        <div className="strong">Game 1</div>
        <TeamToggle value={firstTeam} onChange={setFirstTeam} names={namesOf(ourTeam, opponent)} />
      </div>
      <LineupEditor
        roster={data.roster}
        lineup={lineup}
        onChange={setLineup}
        onAddRoster={(n) => update((d) => ({ ...d, roster: [...d.roster, n] }))}
        onRemoveRoster={(n) => update((d) => ({ ...d, roster: d.roster.filter((x) => x !== n) }))}
      />
      <div className="spacer" />
      <button className="primary big" disabled={lineup.length === 0} onClick={start}>Start match</button>
    </div>
  );
}

/* ---------------- Practice setup ---------------- */

const MAX_TEAMS = 3;

/** Practice game with every player recorded: individual (one player per side) or teams. */
function PracticeSetup({ data, update, go }: { data: AppData; update: Update; go: Go }) {
  // Start from the previous practice game's players (and its name, on the same day).
  const lastGame = [...data.matches].reverse().find(isPracticeGame);
  const lastSides = lastGame?.sets[0].config.sides;
  const [date, setDate] = useState(today());
  const [session, setSession] = useState(lastGame?.date === today() ? lastGame.tournament : '');
  const lastWasTeams = !!lastSides?.some((x) => x.lineup.length > 1);
  const [format, setFormat] = useState<'solo' | 'teams'>(lastWasTeams ? 'teams' : 'solo');
  const [solo, setSolo] = useState<string[]>(lastSides && !lastWasTeams ? lastSides.map((x) => x.lineup[0]) : []);
  const [teams, setTeams] = useState<string[][]>(lastSides && lastWasTeams ? lastSides.map((x) => x.lineup) : [[], []]);
  const [firstIdx, setFirstIdx] = useState(0);

  const assigned = teams.flat();
  const teamsFull = assigned.length >= MAX_PRACTICE_PLAYERS;
  const addRoster = (n: string) => update((d) => ({ ...d, roster: [...d.roster, n] }));
  const removeRoster = (n: string) => update((d) => ({ ...d, roster: d.roster.filter((x) => x !== n) }));
  const setTeam = (i: number, members: string[]) => setTeams(teams.map((t, k) => (k === i ? members : t)));
  const addMember = (n: string) => {
    if (!data.roster.includes(n)) addRoster(n);
  };

  const groups = format === 'solo' ? solo.map((p) => [p]) : teams;
  const valid = groups.length >= 2 && groups.every((g) => g.length > 0) && groups.flat().length <= MAX_PRACTICE_PLAYERS;

  const start = () => {
    const sides: Side[] = groups.map((g, i) => ({ id: `s${i + 1}`, name: g.join(' & '), lineup: g }));
    const firstTeam = format === 'solo' ? 's1' : `s${Math.min(firstIdx, sides.length - 1) + 1}`;
    const m: Match = {
      id: uid(), date, tournament: session, opponent: '', kind: 'practice',
      sets: [{ id: uid(), setNo: 1, config: { firstTeam, lineup: [], sides }, records: [], closed: false }],
    };
    update((d) => ({ ...d, matches: [...d.matches, m] }));
    go({ name: 'play', matchId: m.id });
  };

  return (
    <div className="screen">
      <header className="head">
        <button className="link" onClick={() => go({ name: 'home' })}>← Back</button>
        <h1>Practice game</h1>
      </header>
      <div className="card col">
        <label className="field">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field">Name<input value={session} onChange={(e) => setSession(e.target.value)} placeholder="e.g. Tuesday club practice" /></label>
      </div>
      <div className="seg">
        <button className={format === 'solo' ? 'on' : ''} onClick={() => setFormat('solo')}>Individual</button>
        <button className={format === 'teams' ? 'on' : ''} onClick={() => setFormat('teams')}>Teams</button>
      </div>
      {format === 'solo' ? (
        <LineupEditor roster={data.roster} lineup={solo} onChange={setSolo} onAddRoster={addRoster} onRemoveRoster={removeRoster} max={MAX_PRACTICE_PLAYERS} />
      ) : (
        <>
          {teams.map((members, i) => (
            <div key={i} className="card col">
              <div className="inline between">
                <span className="strong">Team {i + 1}</span>
                {teams.length > 2 && <button className="link" onClick={() => setTeams(teams.filter((_, k) => k !== i))}>Remove</button>}
              </div>
              {members.length === 0 && <div className="muted">Tap members below to add them in order</div>}
              {members.map((p, j) => (
                <div key={p} className="lineup">
                  <span className="num">{j + 1}</span>
                  <span className="grow">{p}</span>
                  <button className="ghost small" onClick={() => setTeam(i, members.filter((x) => x !== p))}>×</button>
                </div>
              ))}
              {!teamsFull && (
                <RosterChips names={data.roster.filter((r) => !assigned.includes(r))} onPick={(r) => setTeam(i, [...members, r])} onDelete={removeRoster} />
              )}
            </div>
          ))}
          <MemberInput onAdd={addMember} />
          {teams.length < MAX_TEAMS && <button className="ghost" onClick={() => setTeams([...teams, []])}>＋ Add team</button>}
          <div className="card col">
            <div className="strong">First to throw</div>
            <div className="seg">
              {teams.map((members, i) => (
                <button key={i} className={firstIdx === i ? 'on' : ''} onClick={() => setFirstIdx(i)}>
                  {members.length > 0 ? members.join(' & ') : `Team ${i + 1}`}
                </button>
              ))}
            </div>
          </div>
          {teamsFull && <div className="muted tiny">Up to {MAX_PRACTICE_PLAYERS} players.</div>}
        </>
      )}
      <div className="spacer" />
      <button className="primary big" disabled={!valid} onClick={start}>Start game</button>
    </div>
  );
}

/* ---------------- Play ---------------- */

/** Colour class of a side: our team, the opponent, or a practice side. */
const sideClass = (id: SideId) => (id === 'us' || id === 'them' ? id : 'side');

function Scoreboard({ state, current, names }: { state: SetState; current: SideId | null; names: Names }) {
  // Tournament games keep us on the left; practice games follow the throwing order.
  const ids = 'us' in state.teams && 'them' in state.teams ? ['us', 'them'] : state.order.map((x) => x.id);
  return (
    <div className={ids.length > 2 ? 'grid3' : 'grid2'}>
      {ids.map((t) => {
        const s = state.teams[t];
        return (
          <div key={t} className={`card score ${sideClass(t)} ${current === t ? 'active' : ''} ${s.eliminated ? 'out' : ''}`}>
            <div className="label">{names[t]}</div>
            <div className="inline base">
              <span className="big-num">{s.eliminated ? 'DQ' : s.score}</span>
              {!s.eliminated && <span className="muted">{WIN_SCORE - s.score} to go</span>}
            </div>
            <div className="dots">{[0, 1, 2].map((i) => <span key={i} className={i < s.faultStreak ? 'dot on' : 'dot'} />)}</div>
          </div>
        );
      })}
    </div>
  );
}

function Play({ match, update, go }: { match: Match; data: AppData; update: Update; go: Go }) {
  const set = match.sets[match.sets.length - 1];
  const state = useMemo(() => deriveSet(set.config, set.records), [set]);
  const winner = setWinner(set);
  const [override, setOverride] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const add = (rec: Omit<ThrowRecord, 'id' | 'ts'>) => {
    update((d) => patchMatch(d, match.id, (m) => patchCurrentSet(m, (s) => ({
      ...s, records: [...s.records, { ...rec, id: uid(), ts: Date.now() }],
    }))));
    setOverride(null);
  };
  const undo = () => update((d) => patchMatch(d, match.id, (m) => patchCurrentSet(m, (s) => ({
    ...s, records: s.records.slice(0, -1), manualWinner: undefined, closed: false,
  }))));

  const practice = isPracticeGame(match);
  const title = practice ? `${match.tournament || 'Practice'} · ${match.date}` : `vs ${match.opponent || 'Opponent'} · Game ${set.setNo}`;
  const names = teamNames(match);

  if (winner || set.closed) {
    return <SetEnd match={match} set={set} state={state} winner={winner} update={update} go={go} undo={undo} title={title} />;
  }

  const next = state.nextTeam as SideId;
  const nextLineup = state.order.find((x) => x.id === next)?.lineup ?? [];
  const player = override ?? state.nextPlayer ?? undefined;

  return (
    <div className="screen">
      <div className="topline">
        <button className="link" onClick={() => go({ name: 'home' })}>← Matches</button>
        <span>{title}</span>
        <span>{names[set.config.firstTeam]} first</span>
      </div>
      <Scoreboard state={state} current={next} names={names} />
      <ThrowInput
        key={next} state={state} team={next} name={names[next]} player={player}
        lineup={nextLineup.length > 1 ? nextLineup : undefined} onPlayer={setOverride}
        hints={practice || next === 'us'} onThrow={add} canUndo={set.records.length > 0} onUndo={undo}
      />
      <div className="spacer" />
      {manual ? (
        <div className="card col">
          <div className="strong">End the game (time limit, etc.)</div>
          <div className="grid2">
            {state.order.filter((x) => !state.teams[x.id].eliminated).map(({ id: t }) => (
              <button key={t} className="ghost" onClick={() => update((d) => patchMatch(d, match.id, (m) => patchCurrentSet(m, (s) => ({ ...s, manualWinner: t, closed: true }))))}>
                Winner: {names[t]}
              </button>
            ))}
          </div>
          <button className="link" onClick={() => setManual(false)}>Cancel</button>
        </div>
      ) : (
        <button className="ghost" onClick={() => setManual(true)}>End game…</button>
      )}
    </div>
  );
}

function Hints({ state, team }: { state: SetState; team: SideId }) {
  const hints = hintsFor(state, team);
  if (hints.length === 0) return null;
  return (
    <div className="col gap8">
      {hints.map((h) => (
        <div key={h.title} className={`hint ${h.level}`}>
          <div className="strong">{h.title}</div>
          <div>{h.body}</div>
        </div>
      ))}
    </div>
  );
}

/** Score pad laid out like the initial pin setup; one tap records a throw of that score. */
function ThrowInput({ state, team, name, player, lineup, onPlayer, hints, onThrow, canUndo, onUndo }: {
  state: SetState; team: SideId; name: string; player?: string; lineup?: string[];
  onPlayer?: (p: string) => void; hints: boolean; onThrow: (r: Omit<ThrowRecord, 'id' | 'ts'>) => void;
  canUndo: boolean; onUndo: () => void;
}) {
  const t = state.teams[team];
  const need = WIN_SCORE - t.score;
  const tap = (score: number) => onThrow(player ? { team, player, score } : { team, score });
  const pinClass = (n: number) => `pin ${n === need ? 'win' : n > need ? 'burst' : ''}`;
  return (
    <>
      <div className="col gap4">
        <div className="inline between turnhead">
          <div className="sub">{name} · turn {t.throws + 1}</div>
          {lineup && onPlayer && (
            <select value={player} onChange={(e) => onPlayer(e.target.value)}>
              {lineup.map((p) => <option key={p}>{p}</option>)}
            </select>
          )}
        </div>
        <div className="h2">{player ?? name}: tap the score</div>
      </div>
      <div className="pins">
        {[...PIN_ROWS].reverse().map((row, i, rows) => (
          <div key={i} className="pinrow">
            {i === 0 && (
              <button className="undo" aria-label="Undo last throw" title="Undo last throw" disabled={!canUndo} onClick={onUndo}>
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
                </svg>
              </button>
            )}
            {i === rows.length - 1 && <button className="pin miss" onClick={() => tap(0)}>0</button>}
            {row.map((p) => (
              <button key={p} className={pinClass(p)} onClick={() => tap(p)}>{p}</button>
            ))}
          </div>
        ))}
        <div className="muted tiny center">
          {need} to finish{need > 12 ? ' (2+ turns)' : ''} · misses in a row: {t.faultStreak}
        </div>
      </div>
      {hints && <Hints state={state} team={team} />}
    </>
  );
}

/* ---------------- Set end ---------------- */

function SetEnd({ match, set, state, winner, update, go, undo, title }: {
  match: Match; set: SetEntry; state: SetState; winner: SideId | null;
  update: Update; go: Go; undo: () => void; title: string;
}) {
  const last = state.rows.at(-1);
  const names = teamNames(match);
  const reason = set.manualWinner
    ? 'Decided manually (time limit, etc.)'
    : state.endReason === 'finish'
      ? `Reached exactly 50${last?.player ? ` (${last.player})` : ''}`
      : `${dqNames(state, names)} disqualified (3 misses in a row)`;
  const practice = isPracticeGame(match);

  // Next set's first team: sets 1→2 alternate; set 3 goes to the higher 1+2 total.
  const defaultFirst = (): Team => {
    if (practice) return 'us';
    if (match.sets.length === 1) return other(set.config.firstTeam as Team);
    const tot = (t: Team) => match.sets.slice(0, 2).reduce((a, s) => a + deriveSet(s.config, s.records).teams[t].score, 0);
    const us = tot('us'), them = tot('them');
    return us === them ? other(set.config.firstTeam as Team) : us > them ? 'us' : 'them';
  };
  const [first, setFirst] = useState<Team>(defaultFirst);
  const [lineup, setLineup] = useState(set.config.lineup);
  const [editLineup, setEditLineup] = useState(false);

  const nextSet = () => {
    update((d) => patchMatch(d, match.id, (m) => ({
      ...patchCurrentSet(m, (s) => ({ ...s, closed: true })),
      sets: [
        ...m.sets.slice(0, -1), { ...set, closed: true },
        { id: uid(), setNo: set.setNo + 1, config: { firstTeam: first, lineup }, records: [], closed: false },
      ],
    })));
  };
  const finishMatch = () => {
    update((d) => patchMatch(d, match.id, (m) => patchCurrentSet(m, (s) => ({ ...s, closed: true }))));
    go({ name: 'home' });
  };
  // Practice: a new game with the same sides; the next side in order throws first.
  const playAgain = () => {
    const again: Match = {
      ...match, id: uid(),
      sets: [{ id: uid(), setNo: 1, config: { ...set.config, firstTeam: state.order[1 % state.order.length].id }, records: [], closed: false }],
    };
    update((d) => {
      const closed = patchMatch(d, match.id, (m) => patchCurrentSet(m, (s) => ({ ...s, closed: true })));
      return { ...closed, matches: [...closed.matches, again] };
    });
    go({ name: 'play', matchId: again.id });
  };

  if (practice) {
    return (
      <div className="screen">
        <div className="topline"><button className="link" onClick={() => go({ name: 'home' })}>← Matches</button><span>{title}</span><span /></div>
        <div className="result">
          <div>Game over (auto)</div>
          <div className="result-title">{winner ? `Winner: ${names[winner]}` : 'No result'}</div>
          <div>Decided by: {reason}</div>
          <div className="finals">
            {state.order.map((x) => (
              <span key={x.id}><span className="dim">{x.name}</span> <span className="strong">{state.teams[x.id].eliminated ? 'DQ' : state.teams[x.id].score}</span></span>
            ))}
          </div>
        </div>
        <PlayersCard title="This game" sets={[set]} />
        <div className="spacer" />
        <div className="grid3">
          <button className="ghost" onClick={undo}>Fix last throw</button>
          <button className="ghost" onClick={finishMatch}>Done</button>
          <button className="primary" onClick={playAgain}>Play again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="topline"><button className="link" onClick={() => go({ name: 'home' })}>← Matches</button><span>{title}</span><span /></div>
      <div className={`result ${winner === 'them' ? 'lose' : ''}`}>
        <div>Game over (auto)</div>
        <div className="result-title">{winner ? `Winner: ${names[winner]}` : 'No result'}</div>
        <div>Decided by: {reason}</div>
        <div className="inline base gap12">
          <span className="huge">{state.teams.us.score}</span><span>–</span><span className="huge dim">{state.teams.them.score}</span>
        </div>
      </div>
      <TeamStatsCard title={`${names.us} this game`} sets={[set]} />
      <div className="card col">
        <div className="strong">Game {set.setNo + 1}</div>
        <TeamToggle value={first} onChange={setFirst} names={names} />
        {editLineup
          ? <LineupEditor roster={lineup} lineup={lineup} onChange={setLineup} onAddRoster={() => {}} />
          : <div className="inline between"><span>Order: {lineup.join(' → ')}</span><button className="link" onClick={() => setEditLineup(true)}>Change</button></div>}
      </div>
      <div className="spacer" />
      <div className="grid3">
        <button className="ghost" onClick={undo}>Fix last throw</button>
        <button className="ghost" onClick={finishMatch}>End match</button>
        <button className="primary" onClick={nextSet}>Next game</button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="muted tiny">{label}</div>
      <div className="strong">{value}</div>
    </div>
  );
}

/* ---------------- Match summary ---------------- */

function endLabel(s: SetEntry, names: Names): string {
  const st = deriveSet(s.config, s.records);
  if (s.manualWinner) return 'Manual';
  if (st.endReason === 'finish') return 'Reached 50';
  if (st.endReason === 'opponent-eliminated') return `${dqNames(st, names)} DQ`;
  return '—';
}

/** Paper-style score sheet of one set: one row per turn, sides in throwing order. */
function ScoreSheet({ set, names, action }: { set: SetEntry; names: Names; action?: ReactNode }) {
  const st = deriveSet(set.config, set.records);
  const w = setWinner(set);
  const order = st.order.map((x) => x.id);
  const byTeam = (t: SideId) => st.rows.filter((r) => r.team === t);
  const cols = order.map(byTeam);
  const turns = Math.max(0, ...cols.map((c) => c.length));
  // Sides with several players get one score column per player; others a single score column.
  const scoreCols = (t: SideId) => {
    const lineup = st.order.find((x) => x.id === t)?.lineup ?? [];
    const players = [...new Set([...lineup, ...byTeam(t).map((r) => r.player ?? '')])];
    return t === 'us' || lineup.length > 1 ? players : [''];
  };
  const cells = (t: SideId, r: DerivedThrow | undefined) => {
    const perPlayer = scoreCols(t)[0] !== '';
    const miss = r?.score === 0;
    return [
      ...scoreCols(t).map((p) => (r && (!perPlayer || r.player === p)
        ? <td key={`${t}s${p}`} className={miss ? 'miss' : ''}>{miss ? '×' : r.score}</td>
        : <td key={`${t}s${p}`} className={perPlayer ? 'idle' : ''} />)),
      !r ? <td key={`${t}t`} className="tot" /> :
      <td key={`${t}t`} className={`tot ${r.event === 'Over' ? 'over' : ''} ${r.event === 'Finish' ? 'fin' : ''}`}>
        {r.event === 'Eliminated' ? 'DQ' : <span>{r.after}</span>}
      </td>,
    ];
  };
  return (
    <div className="sheet">
      <div className="sheet-head">
        <span className="strong">Game {set.setNo}</span>
        <span className="inline">
          <span className="muted">{w ? `Winner: ${names[w]} · ${endLabel(set, names)}` : 'In progress'}</span>
          {action}
        </span>
      </div>
      <div className="sheet-scroll">
        <table>
          <thead>
            <tr>
              <th rowSpan={2} className="turn">Turn</th>
              {order.map((t) => (
                <th key={t} colSpan={scoreCols(t).length + 1} className={`team ${sideClass(t)} ${w === t ? 'won' : ''}`}>
                  {names[t]}{t === set.config.firstTeam ? ' (1st)' : ''}
                </th>
              ))}
            </tr>
            <tr>
              {order.flatMap((t) => [
                ...scoreCols(t).map((p) => <th key={`${t}s${p}`} className={p ? 'who' : ''}>{p || 'Pts'}</th>),
                <th key={`${t}t`} className="tot">Total</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: turns }, (_, i) => (
              <tr key={i}>
                <td className="turn">{i + 1}</td>
                {order.flatMap((t, k) => cells(t, cols[k][i]))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="turn">Σ</td>
              {order.map((t) => (
                <td key={t} colSpan={scoreCols(t).length + 1} className={`final ${w === t ? 'won' : ''}`}>{st.teams[t].eliminated ? 'DQ' : st.teams[t].score}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Our team's headline stats over the given games. */
function TeamStatsCard({ title, sets }: { title: string; sets: SetEntry[] }) {
  const s = teamStats(sets);
  const ours = sets.flatMap((set) => deriveSet(set.config, set.records).rows.filter((r) => r.team === 'us'));
  const avg = ours.length === 0 ? '—' : (ours.reduce((a, r) => a + r.score, 0) / ours.length).toFixed(1);
  // Our players who reached exactly 50, with how many times.
  const finishCount = new Map<string, number>();
  ours.filter((r) => r.event === 'Finish').forEach((r) => finishCount.set(r.player ?? '', (finishCount.get(r.player ?? '') ?? 0) + 1));
  const finishers = [...finishCount].map(([p, n]) => `${p} ×${n}`);
  return (
    <div className="card col">
      <div className="strong">{title}</div>
      <div className="grid2">
        <Stat label="Finisher" value={finishers.length === 0 ? '—' : finishers.join(', ')} />
        <Stat label="Throws" value={String(s.throws)} />
        <Stat label="Avg per throw" value={avg} />
        <Stat label="Miss rate" value={pct(s.overall.fault)} />
      </div>
    </div>
  );
}

/** Every player's headline stats over the given games (practice). */
function PlayersCard({ title, sets }: { title: string; sets: SetEntry[] }) {
  const rows = sets.flatMap((set) => deriveSet(set.config, set.records).rows.filter((r) => r.player));
  const players = [...new Set(rows.map((r) => r.player as string))];
  return (
    <div className="card col">
      <div className="strong">{title}</div>
      <table>
        <thead><tr><th>Player</th><th>Throws</th><th>Avg</th><th>Miss</th><th>Finish</th></tr></thead>
        <tbody>
          {players.map((p) => {
            const mine = rows.filter((r) => r.player === p);
            const misses = mine.filter((r) => r.score === 0).length;
            return (
              <tr key={p}>
                <td>{p}</td>
                <td>{mine.length}</td>
                <td>{(mine.reduce((a, r) => a + r.score, 0) / mine.length).toFixed(1)}</td>
                <td>{pct(misses / mine.length, 0)}</td>
                <td>{mine.filter((r) => r.event === 'Finish').length}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MatchSummary({ match, update, go }: { match: Match; update: Update; go: Go }) {
  const [armed, setArmed] = useState<string | null>(null);
  // Remove one game and renumber the rest; a match always keeps at least one game.
  const deleteGame = (id: string) => {
    update((d) => patchMatch(d, match.id, (m) => ({
      ...m, sets: m.sets.filter((x) => x.id !== id).map((x, i) => ({ ...x, setNo: i + 1 })),
    })));
    setArmed(null);
  };
  const [editNames, setEditNames] = useState(false);
  const setField = (field: 'ourTeam' | 'opponent', v: string) => update((d) => patchMatch(d, match.id, (m) => ({ ...m, [field]: v })));
  const won = match.sets.filter((s) => setWinner(s) === 'us').length;
  const lost = match.sets.filter((s) => setWinner(s) === 'them').length;
  const verdict = won > lost ? 'Win' : won < lost ? 'Loss' : 'Draw';
  const legend = <div className="muted tiny">× miss (incl. foul)　<span className="legend over">25</span> over 50, back to 25　<span className="legend fin">50</span> finish</div>;

  if (isPracticeGame(match)) {
    const set = match.sets[0];
    const w = setWinner(set);
    return (
      <div className="screen">
        <div className="topline">
          <button className="link" onClick={() => go({ name: 'home' })}>← Matches</button>
          <span>{match.tournament || 'Practice'} · {match.date}</span>
          <span />
        </div>
        <div className="result">
          <div>{(set.config.sides ?? []).map((x) => x.name).join(' · ')}</div>
          <div className="result-title">{w ? `Winner: ${teamNames(match)[w]}` : 'No result'}</div>
        </div>
        <PlayersCard title="This game" sets={match.sets} />
        <ScoreSheet set={set} names={teamNames(match)} />
        {legend}
        <div className="spacer" />
        <button className="ghost" onClick={() => go({ name: 'play', matchId: match.id })}>Continue / fix record</button>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="topline">
        <button className="link" onClick={() => go({ name: 'home' })}>← Matches</button>
        <span>{match.date} · {match.tournament || '(no tournament)'}{match.kind === 'practice' ? ' · Practice' : ''}</span>
        <span />
      </div>
      <div className={`result ${won < lost ? 'lose' : ''}`}>
        <div>{match.ourTeam ? `${match.ourTeam} ` : ''}vs {match.opponent || 'Opponent'}</div>
        <div className="result-title">{verdict} {won}-{lost}</div>
      </div>
      {editNames ? (
        <div className="card col">
          <label className="field">Our team<input value={match.ourTeam ?? ''} onChange={(e) => setField('ourTeam', e.target.value)} /></label>
          <label className="field">Opponent<input value={match.opponent} onChange={(e) => setField('opponent', e.target.value)} /></label>
          <button className="link" onClick={() => setEditNames(false)}>Done</button>
        </div>
      ) : (
        <button className="link" onClick={() => setEditNames(true)}>{match.ourTeam ? 'Edit team names' : 'Add our team name'}</button>
      )}
      <TeamStatsCard title={`${teamNames(match).us} this match`} sets={match.sets} />
      {match.sets.map((set) => (
        <ScoreSheet key={set.id} set={set} names={teamNames(match)} action={match.sets.length > 1 && (
          <button
            className={armed === set.id ? 'danger small' : 'ghost small'}
            onClick={() => (armed === set.id ? deleteGame(set.id) : setArmed(set.id))}
          >
            {armed === set.id ? 'Really delete' : 'Delete'}
          </button>
        )} />
      ))}
      {legend}
      <div className="spacer" />
      <button className="ghost" onClick={() => go({ name: 'play', matchId: match.id })}>Continue / fix record</button>
    </div>
  );
}

/* ---------------- Review ---------------- */

/** Player line colours in fixed order (validated palette); a slot is kept while the player stays selected. */
const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
/** The team is a dark dashed reference line, distinct from every player colour. */
const TEAM_COLOR = '#3d3c39';

interface TrendSeries { name: string; color: string; dashed?: boolean; values: number[] }

/**
 * One measure across tournaments, oldest on the left, one line per series.
 * Tap a point to read every series at that tournament; the latest is shown by default.
 */
function TrendChart({ title, labels, hollow, series, fmt, tick, domain, sel, onSelect }: {
  title: string; labels: string[]; series: TrendSeries[];
  /** Points drawn as open circles (practice days among tournaments). */
  hollow?: boolean[];
  fmt: (v: number) => string; tick: (v: number) => string; domain: [number, number];
  /** Selected date index, shared by the charts of one card. */
  sel: number | null; onSelect: (i: number) => void;
}) {
  const n = labels.length;
  // Drawn at real pixel size: the y-axis stays put while the plot scrolls sideways once
  // the dates no longer fit (every date keeps a vertical label).
  const AXIS = 34, PAD = 12, T = 8, PLOT_H = 76, LABEL_H = 78, MIN_SLOT = 24;
  const H = T + PLOT_H + LABEL_H;
  const wrap = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(280);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth - AXIS));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    // Open at the newest (right) end.
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [n, avail]);
  const PW = Math.max(avail, PAD * 2 + (n - 1) * MIN_SLOT);
  const x = (i: number) => (n === 1 ? PW / 2 : PAD + (i * (PW - PAD * 2)) / (n - 1));
  const y = (v: number) => T + (1 - (v - domain[0]) / (domain[1] - domain[0])) * PLOT_H;
  const ticks = [domain[0], (domain[0] + domain[1]) / 2, domain[1]];
  const short = (t: string) => (t.length > 13 ? `${t.slice(0, 12)}…` : t);
  const validOf = (vs: number[]) => vs.map((value, i) => ({ value, i })).filter((p) => !Number.isNaN(p.value));
  // Missing values (e.g. a player who skipped a tournament) break the line.
  const pathOf = (v: { i: number; value: number }[]) =>
    v.map((p, k) => `${k && v[k - 1].i === p.i - 1 ? 'L' : 'M'}${x(p.i)},${y(p.value)}`).join(' ');
  const shown = sel ?? (n > 0 ? n - 1 : null);
  const slot = n > 1 ? (PW - PAD * 2) / (n - 1) : PW;
  return (
    <div className="trend">
      <div className="strong">{title}</div>
      {shown !== null && (
        <div className="readout muted tiny">
          <span>{labels[shown]}:</span>
          {series.map((sr) => (
            <span key={sr.name}>
              <span className={`swatch ${sr.dashed ? 'dashed' : ''}`} style={{ '--c': sr.color } as CSSProperties} /> {sr.name}{' '}
              <span className="strong">{Number.isNaN(sr.values[shown]) ? '—' : fmt(sr.values[shown])}</span>
            </span>
          ))}
        </div>
      )}
      <div className="trend-plot" ref={wrap}>
        <svg width={AXIS} height={H} aria-hidden>
          {ticks.map((v) => <text key={v} className="tick" x={AXIS - 6} y={y(v)}>{tick(v)}</text>)}
        </svg>
        <div className="trend-scroll" ref={scroller}>
          <svg width={PW} height={H} role="img" aria-label={`${title} by date`}>
            {ticks.map((v) => <line key={v} className="grid" x1={0} x2={PW} y1={y(v)} y2={y(v)} />)}
            {series.map((sr) => {
              const v = validOf(sr.values);
              return (
                <g key={sr.name} style={{ '--c': sr.color } as CSSProperties}>
                  <path className={`line ${sr.dashed ? 'dashed' : ''}`} d={pathOf(v)} />
                  {v.map((p) => <circle key={p.i} className={`dot ${hollow?.[p.i] ? 'open' : ''}`} cx={x(p.i)} cy={y(p.value)} r={p.i === shown ? 5 : 3.5} />)}
                </g>
              );
            })}
            {labels.map((l, i) => (
              <text key={i} className={`xlab ${i === shown ? 'on' : ''}`} transform={`translate(${x(i) + 4},${T + PLOT_H + 6}) rotate(-90)`} textAnchor="end">
                {short(l)}
              </text>
            ))}
            {labels.map((_, i) => (
              <rect key={i} className="hit" x={x(i) - slot / 2} y={0} width={slot} height={H} onClick={() => onSelect(i)} onMouseEnter={() => onSelect(i)} />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Review: KPIs for the team and each player ---------------- */

interface KpiValue { v: number; n: number }
interface Kpi {
  key: string; label: string; note: string;
  /** Points per throw rather than a rate. */
  num?: boolean;
  pick: (rows: DerivedThrow[]) => KpiValue;
}

const hitOf = (rows: DerivedThrow[]): KpiValue => ({ v: rows.length === 0 ? NaN : rows.filter((r) => r.score > 0).length / rows.length, n: rows.length });

/** The key numbers, all counted over every throw (first throws included). */
const KPIS: Kpi[] = [
  { key: 'hit', label: 'Hit rate', note: 'throws scoring 1+', pick: hitOf },
  { key: 'afterMiss', label: 'After a miss', note: 'hit rate after 1 miss', pick: (rows) => hitOf(rows.filter((r) => r.faultStreak === 1)) },
  { key: 'mid', label: 'Mid-game', note: 'hit rate, turns 4–6', pick: (rows) => hitOf(rows.filter((r) => r.teamIdx >= 4 && r.teamIdx <= 6)) },
  { key: 'zone', label: 'Finishing zone', note: 'hit rate from 38+', pick: (rows) => hitOf(rows.filter((r) => r.before >= 38)) },
  {
    key: 'avg', label: 'Avg score', note: 'points per throw', num: true,
    pick: (rows) => ({ v: rows.length === 0 ? NaN : rows.reduce((a, r) => a + r.score, 0) / rows.length, n: rows.length }),
  },
  {
    key: 'finish', label: 'Finish rate', note: 'exactly 50 ÷ throws from 38+',
    pick: (rows) => {
      const zone = rows.filter((r) => r.before >= 38);
      return { v: zone.length === 0 ? NaN : zone.filter((r) => r.event === 'Finish').length / zone.length, n: zone.length };
    },
  },
];
const kpiFmt = (k: Kpi, v: number, digits = 0) => (k.num ? (Number.isNaN(v) ? '—' : v.toFixed(1)) : pct(v, digits));
/** A player is flagged when this far from the team, on at least MIN_N throws. */
const kpiGap = (k: Kpi) => (k.num ? 0.5 : 0.05);
const MIN_N = 5;

/** Our throws in a match: our side in tournaments; every side in practice games (all are our players). */
const ourRows = (m: Match): DerivedThrow[] =>
  m.sets.flatMap((x) => deriveSet(x.config, x.records).rows.filter((r) => (isPracticeGame(m) ? !!r.player : r.team === 'us')));

/**
 * Review of tournaments and practice alike: pick the team and any players once; the KPI table and
 * the trend both follow. Each tournament or practice session is one point in time.
 * ▼ marks where a player is clearly below the team — the individual's focus.
 */
function ReviewBody({ matches }: { matches: Match[] }) {
  const [period, setPeriod] = useState<string>('');
  const [showTeam, setShowTeam] = useState(true);
  const [picked, setPicked] = useState<{ name: string; slot: number }[]>([]);
  const [kpiKey, setKpiKey] = useState('hit');

  const groups = new Map<string, Match[]>();
  for (const m of [...matches].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = tournamentKey(m);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const tours = [...groups].map(([key, ms]) => ({
    key,
    practice: ms[0].kind === 'practice',
    label: `${ms[0].date.slice(5)} ${ms[0].tournament || (ms[0].kind === 'practice' ? 'Practice' : '(no name)')}`,
    matches: ms.length,
    games: ms.reduce((a, m) => a + m.sets.length, 0),
    rows: ms.flatMap(ourRows),
  }));
  if (tours.length === 0) return <div className="muted">Nothing recorded yet.</div>;

  // Players, most throws first.
  const counts = new Map<string, number>();
  tours.flatMap((t) => t.rows).forEach((r) => r.player && counts.set(r.player, (counts.get(r.player) ?? 0) + 1));
  const players = [...counts].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  const togglePlayer = (p: string) => {
    if (picked.some((x) => x.name === p)) setPicked(picked.filter((x) => x.name !== p));
    else if (picked.length < SERIES_COLORS.length) {
      const used = new Set(picked.map((x) => x.slot));
      setPicked([...picked, { name: p, slot: SERIES_COLORS.findIndex((_, k) => !used.has(k)) }]);
    }
  };
  const lines = [
    ...(showTeam ? [{ name: 'Team', color: TEAM_COLOR, dashed: true, only: (_: DerivedThrow) => true }] : []),
    ...picked.map(({ name, slot }) => ({ name, color: SERIES_COLORS[slot], dashed: false, only: (r: DerivedThrow) => r.player === name })),
  ];
  const swatch = (l: { color: string; dashed: boolean }) => <span className={`swatch ${l.dashed ? 'dashed' : ''}`} style={{ '--c': l.color } as CSSProperties} />;

  const current = tours.some((t) => t.key === period) ? period : '';
  const inPeriod = current ? tours.filter((t) => t.key === current) : tours;
  const periodRows = inPeriod.flatMap((t) => t.rows);
  const selIdx = current ? tours.findIndex((t) => t.key === current) : null;
  const kpi = KPIS.find((k) => k.key === kpiKey) ?? KPIS[0];

  const trendValues = (only: (r: DerivedThrow) => boolean) => tours.map((t) => kpi.pick(t.rows.filter(only)).v);
  const allValues = lines.flatMap((l) => trendValues(l.only)).filter((v) => !Number.isNaN(v));
  const domain: [number, number] = kpi.num
    ? [0, Math.max(6, Math.ceil(Math.max(...allValues, 0) / 2) * 2)]
    : kpi.key === 'finish' ? [0, 1] : [Math.min(0.5, Math.floor(Math.min(...allValues, 1) * 10) / 10), 1];

  return (
    <>
      <div className="card col">
        <div className="chips">
          <button className={`chip ${showTeam ? 'on-series' : ''}`} style={{ '--c': TEAM_COLOR } as CSSProperties} onClick={() => setShowTeam(!showTeam)}>Team</button>
          {players.map((p) => {
            const pk = picked.find((x) => x.name === p);
            return (
              <button key={p} className={`chip ${pk ? 'on-series' : ''}`} style={pk ? ({ '--c': SERIES_COLORS[pk.slot] } as CSSProperties) : undefined}
                disabled={!pk && picked.length >= SERIES_COLORS.length} onClick={() => togglePlayer(p)}>
                {p}
              </button>
            );
          })}
        </div>
        <select value={current} onChange={(e) => setPeriod(e.target.value)}>
          <option value="">All dates</option>
          {[...tours].reverse().map((t) => <option key={t.key} value={t.key}>{t.label}{t.practice ? ' (practice)' : ''}</option>)}
        </select>
        <div className="muted tiny">
          {inPeriod.reduce((a, t) => a + t.games, 0)} games · {periodRows.length} throws
        </div>
      </div>

      {lines.length === 0 ? <div className="muted">Pick Team or players.</div> : (
        <>
          <div className="card col">
            <div className="strong">Key numbers{current ? ` · ${tours[selIdx ?? 0].label}` : ''}</div>
            <div className="table-scroll">
              <table className="kpi">
                <thead>
                  <tr><th />{lines.map((l) => <th key={l.name} className="nowrap">{swatch(l)} {l.name}</th>)}</tr>
                </thead>
                <tbody>
                  {KPIS.map((k) => {
                    const team = k.pick(periodRows);
                    return (
                      <tr key={k.key} className={k.key === kpiKey ? 'on' : ''} onClick={() => setKpiKey(k.key)}>
                        <td>
                          <div>{k.label}</div>
                          <div className="muted tiny">{k.note}</div>
                        </td>
                        {lines.map((l) => {
                          const { v, n } = k.pick(periodRows.filter(l.only));
                          const isTeam = l.name === 'Team';
                          const diff = v - team.v;
                          const low = !isTeam && n >= MIN_N && diff <= -kpiGap(k);
                          const high = !isTeam && n >= MIN_N && diff >= kpiGap(k);
                          return (
                            <td key={l.name} className={low ? 'low' : high ? 'high' : ''}>
                              <span className="strong nowrap">{kpiFmt(k, v)}{low && '▼'}{high && '▲'}</span>
                              <div className="muted tiny">{n}</div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="muted tiny">
              Small figure = throws counted. ▼ / ▲ = {'≥'}5 points (0.5 for avg score) below / above the team, on {MIN_N}+ throws. Tap a row to see its trend.
            </div>
          </div>

          <div className="card col">
            <div className="strong">Trend</div>
            <div className="chips">
              {KPIS.map((k) => <button key={k.key} className={`chip ${k.key === kpiKey ? 'on' : ''}`} onClick={() => setKpiKey(k.key)}>{k.label}</button>)}
            </div>
            <div className="muted tiny">{kpi.label}: {kpi.note}</div>
            <TrendChart
              title={kpi.label}
              labels={tours.map((t) => t.label)}
              hollow={tours.some((t) => !t.practice) ? tours.map((t) => t.practice) : undefined}
              series={lines.map((l) => ({ name: l.name, color: l.color, dashed: l.dashed, values: trendValues(l.only) }))}
              fmt={(v) => kpiFmt(kpi, v, 1)} tick={(v) => (kpi.num ? v.toFixed(0) : pct(v, 0))}
              domain={domain}
              sel={selIdx} onSelect={(i) => setPeriod(tours[i].key)}
            />
            <div className="muted tiny">One point per tournament or practice day{tours.some((t) => t.practice) && tours.some((t) => !t.practice) ? ' (open circles = practice)' : ''}. Tap a point to show it in Key numbers; choose "All dates" above to go back.</div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Date</th>{lines.map((l) => <th key={l.name} className="nowrap">{swatch(l)} {l.name}</th>)}</tr></thead>
                <tbody>
                  {[...tours].reverse().map((t) => (
                    <tr key={t.key}>
                      <td>{t.label}{t.practice && <div className="muted tiny">Practice</div>}</td>
                      {lines.map((l) => {
                        const { v, n } = kpi.pick(t.rows.filter(l.only));
                        return <td key={l.name}>{kpiFmt(kpi, v)}<div className="muted tiny">{n}</div></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Review({ data, go }: { data: AppData; go: Go }) {
  const [filter, setFilter] = useState<'all' | 'tournament' | 'practice'>('all');
  const matches = data.matches.filter((m) => filter === 'all' || m.kind === filter);
  return (
    <div className="screen">
      <header className="head">
        <button className="link" onClick={() => go({ name: 'home' })}>← Back</button>
        <h1>Review</h1>
      </header>
      <div className="seg">
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
        <button className={filter === 'tournament' ? 'on' : ''} onClick={() => setFilter('tournament')}>Tournaments</button>
        <button className={filter === 'practice' ? 'on' : ''} onClick={() => setFilter('practice')}>Practice</button>
      </div>
      <ReviewBody matches={matches} />
    </div>
  );
}
