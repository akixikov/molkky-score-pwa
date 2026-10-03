// Match result: stats, score sheets, and corrections (throws and winners also on teammates' matches).
import { useState } from 'react';
import { deriveSet, type ThrowRecord } from '../rules';
import { setWinner, type Match, type SetEntry } from '../store';
import { isPracticeGame, sidesLabel, teamNames, type Go } from '../ui';
import { TeamStatsCard } from '../components/StatsCards';
import { ScoreSheet } from '../components/ScoreSheet';
import { ThrowEditor, type ThrowTarget } from '../components/ThrowEditor';

/**
 * `edit` changes the match: an own one on this device, a teammate's through the team sheet.
 * Without it (a teammate's match while the sheet script is too old to accept fixes) the match is read-only.
 */
export function MatchSummary({ match, edit: maybeEdit, go }: { match: Match; edit?: (fn: (m: Match) => Match) => void; go: Go }) {
  const edit = maybeEdit ?? (() => {});
  const canEdit = !!maybeEdit;
  const [armed, setArmed] = useState<string | null>(null);
  // Remove one game and renumber the rest; a match always keeps at least one game.
  const deleteGame = (id: string) => {
    edit((m) => ({ ...m, sets: m.sets.filter((x) => x.id !== id).map((x, i) => ({ ...x, setNo: i + 1 })) }));
    setArmed(null);
  };
  const [editNames, setEditNames] = useState(false);
  // The throw being corrected or added, if any.
  const [fixing, setFixing] = useState<{ setId: string; target: ThrowTarget; key: number } | null>(null);
  const open = (setId: string, target: ThrowTarget) => setFixing({ setId, target, key: Date.now() });
  const fixThrow = (setId: string) => (canEdit ? (recordId: string) => open(setId, { recordId }) : undefined);
  const addThrow = (setId: string) => (canEdit ? (team: string, player?: string) => open(setId, { team, player }) : undefined);
  const patchSet = (setId: string, fn: (s: SetEntry) => SetEntry) => edit((m) => ({ ...m, sets: m.sets.map((x) => (x.id === setId ? fn(x) : x)) }));
  const saveThrows = (set: SetEntry, records: ThrowRecord[], next: boolean) => {
    patchSet(set.id, (x) => ({ ...x, records }));
    if (!next || !fixing || 'recordId' in fixing.target) { setFixing(null); return; }
    // Straight on to the same side's following throw, the lineup moving on.
    const team = fixing.target.team;
    const lineup = deriveSet(set.config, records).order.find((x) => x.id === team)?.lineup ?? [];
    const count = records.filter((r) => r.team === team).length;
    open(set.id, { team, player: lineup.length > 0 ? lineup[count % lineup.length] : undefined });
  };
  const fixingSet = fixing && match.sets.find((x) => x.id === fixing.setId);
  const editor = fixing && fixingSet && (
    <ThrowEditor key={fixing.key} set={fixingSet} target={fixing.target} names={teamNames(match)}
      note={match.remoteBy && `Recorded on ${match.remoteBy}'s phone. Saving changes it for everyone.`}
      onSave={(records, next) => saveThrows(fixingSet, records, next)} onClose={() => setFixing(null)} />
  );
  const fixHint = canEdit && <div className="muted tiny">Tap a score in the sheet to fix it, or + to add a missing throw.</div>;
  // Correct a game's winner afterwards (e.g. won on time, or the record ended early). '' = from the throws.
  const setGameWinner = (setId: string, w: string) => patchSet(setId, (x) => ({ ...x, manualWinner: w || undefined, closed: true }));
  const winnerPicker = (set: SetEntry) => {
    if (!canEdit) return null;
    const st = deriveSet(set.config, set.records);
    const names = teamNames(match);
    return (
      <label className="inline game-winner muted">
        Game {set.setNo} winner
        <select value={set.manualWinner ?? ''} onChange={(e) => setGameWinner(set.id, e.target.value)}>
          <option value="">From the throws{st.winner ? ` (${names[st.winner]})` : ' (none)'}</option>
          {st.order.map((x) => <option key={x.id} value={x.id}>{names[x.id]}</option>)}
        </select>
      </label>
    );
  };
  const setField = (field: 'ourTeam' | 'opponent', v: string) => edit((m) => ({ ...m, [field]: v }));
  const won = match.sets.filter((s) => setWinner(s) === 'us').length;
  const lost = match.sets.filter((s) => setWinner(s) === 'them').length;
  const verdict = won > lost ? 'Win' : won < lost ? 'Loss' : 'Draw';
  const readOnly = match.remoteBy && (
    <div className="muted">
      Recorded by {match.remoteBy}.{' '}
      {canEdit
        ? 'Fixes to throws and winners go to the team sheet and reach their phone when it syncs.'
        : "To fix it here, the team sheet's script needs updating (see the setup guide)."}
    </div>
  );
  const legend = <div className="muted tiny">× miss (incl. foul)　<span className="legend over">25</span> over 50, back to 25　<span className="legend fin">50</span> finish</div>;

  if (isPracticeGame(match)) {
    const set = match.sets[0];
    const w = setWinner(set);
    return (
      <div className="screen">
        <div className="topline">
          <button className="back" onClick={() => go({ name: 'home' })}>← Matches</button>
          <span>{match.tournament || 'Practice'} · {match.date}</span>
          <span />
        </div>
        <div className="result">
          <div>{sidesLabel(match)}</div>
          <div className="result-title">{w ? `Winner: ${teamNames(match)[w]}` : 'No result'}</div>
        </div>
        {readOnly}
        {(set.config.sides ?? []).map((x) => <TeamStatsCard key={x.id} title={`${x.name} this game`} sets={match.sets} team={x.id} />)}
        <ScoreSheet set={set} names={teamNames(match)} onThrow={fixThrow(set.id)} onAdd={addThrow(set.id)} />
        {winnerPicker(set)}
        {legend}
        {fixHint}
        {editor}
        <div className="spacer" />
        {!match.remoteBy && <button className="ghost" onClick={() => go({ name: 'play', matchId: match.id })}>Continue / fix record</button>}
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="topline">
        <button className="back" onClick={() => go({ name: 'home' })}>← Matches</button>
        <span>{match.date} · {match.tournament || '(no tournament)'}{match.kind === 'practice' ? ' · Practice' : ''}</span>
        <span />
      </div>
      <div className={`result ${won < lost ? 'lose' : ''}`}>
        <div>{match.ourTeam ? `${match.ourTeam} ` : ''}vs {match.opponent || 'Opponent'}</div>
        <div className="result-title">{verdict} {won}-{lost}</div>
      </div>
      {readOnly}
      {match.remoteBy ? null : editNames ? (
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
        <div key={set.id} className="col gap4">
          <ScoreSheet set={set} names={teamNames(match)} onThrow={fixThrow(set.id)} onAdd={addThrow(set.id)} action={match.sets.length > 1 && !match.remoteBy && (
            <button
              className={armed === set.id ? 'danger small' : 'ghost small'}
              onClick={() => (armed === set.id ? deleteGame(set.id) : setArmed(set.id))}
            >
              {armed === set.id ? 'Really delete' : 'Delete'}
            </button>
          )} />
          {winnerPicker(set)}
        </div>
      ))}
      {legend}
      {fixHint}
      {editor}
      <div className="spacer" />
      {!match.remoteBy && <button className="ghost" onClick={() => go({ name: 'play', matchId: match.id })}>Continue / fix record</button>}
    </div>
  );
}
