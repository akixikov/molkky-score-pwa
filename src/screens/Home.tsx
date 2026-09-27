// Home: tournaments and practice days, grouped and collapsible.
import { useState } from 'react';

import { download, setWinner, toCsv, tournamentKey, type AppData, type Match } from '../store';
import { isConfigured } from '../sync';
import { today, isPracticeGame, teamNames, type Update, type Go } from '../ui';
import { type Sync, syncSummary } from '../useTeamSync';

const EXPANDED_KEY = 'molkky-expanded-groups';

export function Home({ data, all, update, go, sync }: { data: AppData; all: Match[]; update: Update; go: Go; sync: Sync }) {
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
                    const confirming = armed === m.id;
                    return (
                      <div key={m.id} className={`card row ${confirming && m.remoteBy ? 'confirm-other' : ''}`}>
                        <button className="rowmain" onClick={() => go({ name: decided || m.remoteBy ? 'match' : 'play', matchId: m.id })}>
                          <div className="strong">
                            {practice
                              ? (m.sets[0].config.sides ?? []).map((x) => x.name).join(' · ')
                              : `vs ${m.opponent || 'Opponent'}  ${won}-${lost}`}
                          </div>
                          {!decided
                            ? <div className="sub">In progress</div>
                            : practice && winner && <div className="sub">Winner: {names[winner]}</div>}
                          {m.remoteBy && <div className="sub">by {m.remoteBy}</div>}
                          {confirming && m.remoteBy && (
                            <div className="warn-text tiny">Recorded on {m.remoteBy}'s phone. Deleting removes it for everyone.</div>
                          )}
                        </button>
                        <button
                          className={confirming ? 'danger small' : 'ghost small'}
                          onClick={() => {
                            if (!confirming) { setArmed(m.id); return; }
                            // Own matches go through the normal change queue; a teammate's is deleted on the sheet.
                            if (m.remoteBy) sync.deleteOther(m.id);
                            else update((d) => ({ ...d, matches: d.matches.filter((x) => x.id !== m.id) }));
                            setArmed(null);
                          }}
                        >
                          {confirming ? (m.remoteBy ? 'Delete for all' : 'Really delete') : 'Delete'}
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
      <button className="primary big" onClick={() => go({ name: 'review' })}>Review</button>
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
