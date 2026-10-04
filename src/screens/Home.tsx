// Home: tournaments and practice days, grouped and collapsible.
import { useState } from 'react';

import { download, setWinner, toCsv, tournamentKey, type AppData, type Match } from '../store';
import { isConfigured } from '../sync';
import { today, isPracticeGame, sidesLabel, teamNames, type Update, type Go } from '../ui';
import { type Sync, syncSummary } from '../useTeamSync';

const EXPANDED_KEY = 'molkky-expanded-groups';
/** Groups shown per section before "Show older". */
const RECENT_GROUPS = 5;

export function Home({ data, all, update, go, sync }: { data: AppData; all: Match[]; update: Update; go: Go; sync: Sync }) {
  const [showOlder, setShowOlder] = useState<Set<string>>(new Set());
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
  // Teammates' matches join by date so the newest still comes first.
  const ordered = [...all].sort((a, b) => b.date.localeCompare(a.date) || all.indexOf(b) - all.indexOf(a));
  for (const m of ordered) {
    const key = tournamentKey(m);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  // Groups start collapsed each time the app opens; ones opened stay open while it runs.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem(EXPANDED_KEY);
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch { /* storage unavailable */ }
    return new Set();
  });
  const toggleGroup = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key); else next.add(key);
    setExpanded(next);
    try { sessionStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
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
      {/* The three ways in, as one row of matching tiles. */}
      <nav className="actions">
        <button className="action main" onClick={() => go({ name: 'new' })}>
          <svg viewBox="0 0 24 24" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
          New match
        </button>
        <button className="action" onClick={() => go({ name: 'practice' })}>
          <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>
          Practice
        </button>
        <button className="action" onClick={() => go({ name: 'review' })}>
          <svg viewBox="0 0 24 24" aria-hidden><path d="M4 19h16M7 15l4-4 3 3 5-6" /></svg>
          Review
        </button>
      </nav>
      {(['tournament', 'practice'] as const).map((kind) => {
        const list = [...groups].filter(([, ms]) => ms[0].kind === kind);
        const older = showOlder.has(kind) ? 0 : Math.max(0, list.length - RECENT_GROUPS);
        return (
          <section key={kind} className="col gap4">
            <h2 className="section-title">{kind === 'tournament' ? 'Tournaments' : 'Practice'}</h2>
            {list.length === 0 && <div className="muted">{kind === 'tournament' ? 'No matches yet.' : 'No practice games yet.'}</div>}
            {list.slice(0, list.length - older).map(([key, ms]) => {
              const first = ms[0];
              const rs = ms.map(result).filter((r) => r.decided);
              const w = rs.filter((r) => r.won > r.lost).length;
              const l = rs.filter((r) => r.won < r.lost).length;
              const dr = rs.length - w - l;
              const isOpen = expanded.has(key);
              return (
                <section key={key} className="list">
                  <button className="group-head" aria-expanded={isOpen} onClick={() => toggleGroup(key)}>
                    <span className={`chev ${isOpen ? 'open' : ''}`} aria-hidden>›</span>
                    <div className="grow">
                      <div className="group-title">
                        <span className="group-date">{first.date}</span>
                        <span className="strong">{first.tournament || (first.kind === 'practice' ? 'Practice' : '(no tournament)')}</span>
                      </div>
                    </div>
                    <div className="sub nowrap">
                      {ms.every(isPracticeGame)
                        ? `${ms.length} ${ms.length === 1 ? 'game' : 'games'}`
                        : `${ms.length} ${ms.length === 1 ? 'match' : 'matches'} · ${w}W ${dr}D ${l}L`}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="card games">
                      {ms.map((m, i) => {
                        const { won, lost, winner, decided } = result(m);
                        const practice = isPracticeGame(m);
                        const names = teamNames(m);
                        const badge = !decided ? { cls: 'live', text: 'Live' }
                          : practice ? null
                          : won > lost ? { cls: 'win', text: `W ${won}-${lost}` }
                          : won < lost ? { cls: 'loss', text: `L ${won}-${lost}` }
                          : { cls: '', text: `D ${won}-${lost}` };
                        return (
                          <div key={m.id} className="game-row">
                            <button className="rowmain" onClick={() => go({ name: decided || m.remoteBy ? 'match' : 'play', matchId: m.id })}>
                              {/* Newest first, so the first row is the highest game number. */}
                              {practice && <span className="game-no">{ms.length - i}</span>}
                              <span className="grow col gap4">
                                <span className="strong ellipsis">
                                  {practice ? sidesLabel(m) : `vs ${m.opponent || 'Opponent'}`}
                                </span>
                                {(practice && winner || m.remoteBy) && (
                                  <span className="sub">
                                    {[practice && winner && `Winner: ${names[winner]}`, m.remoteBy && `by ${m.remoteBy}`].filter(Boolean).join(' · ')}
                                  </span>
                                )}
                              </span>
                              {badge && <span className={`badge ${badge.cls}`}>{badge.text}</span>}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
            {older > 0 && (
              <button className="link more" onClick={() => setShowOlder(new Set([...showOlder, kind]))}>
                Show {older} older {kind === 'tournament' ? (older === 1 ? 'tournament' : 'tournaments') : (older === 1 ? 'day' : 'days')}
              </button>
            )}
          </section>
        );
      })}
      <div className="spacer" />
      <button className="ghost sync-row" onClick={() => go({ name: 'sync' })}>
        <span>Team sync</span><span className="muted">{syncSummary(sync)}</span>
      </button>
      <div className="grid3">
        <button className="ghost small" onClick={() => download(`molkky-${today()}.csv`, toCsv(data), 'text/csv')}>Export CSV</button>
        <button className="ghost small" onClick={() => download(`molkky-backup-${today()}.json`, JSON.stringify(data), 'application/json')}>Save backup</button>
        <label className="ghost small filebtn">
          Load backup
          <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </label>
      </div>
      <div className="muted tiny">
        {isConfigured(sync.settings)
          ? 'Records are kept on this device and sent to the team sheet.'
          : 'Records are stored only on this device. Back up often, or set up Team sync.'}
      </div>
    </div>
  );
}
