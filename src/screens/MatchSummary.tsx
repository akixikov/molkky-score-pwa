// Match result: stats, score sheets, and corrections for own matches.
import { useState } from 'react';
import { deriveSet } from '../rules';
import { setWinner, type Match, type SetEntry } from '../store';
import { isPracticeGame, teamNames, type Update, type Go, patchMatch } from '../ui';
import { TeamStatsCard, PlayersCard } from '../components/StatsCards';
import { ScoreSheet } from '../components/ScoreSheet';

export function MatchSummary({ match, update, go }: { match: Match; update: Update; go: Go }) {
  const [armed, setArmed] = useState<string | null>(null);
  // Remove one game and renumber the rest; a match always keeps at least one game.
  const deleteGame = (id: string) => {
    update((d) => patchMatch(d, match.id, (m) => ({
      ...m, sets: m.sets.filter((x) => x.id !== id).map((x, i) => ({ ...x, setNo: i + 1 })),
    })));
    setArmed(null);
  };
  const [editNames, setEditNames] = useState(false);
  // Correct a game's winner afterwards (e.g. won on time, or the record ended early). '' = from the throws.
  const setGameWinner = (setId: string, w: string) =>
    update((d) => patchMatch(d, match.id, (m) => ({ ...m, sets: m.sets.map((x) => (x.id === setId ? { ...x, manualWinner: w || undefined, closed: true } : x)) })));
  const winnerPicker = (set: SetEntry) => {
    if (match.remoteBy) return null;
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
  const setField = (field: 'ourTeam' | 'opponent', v: string) => update((d) => patchMatch(d, match.id, (m) => ({ ...m, [field]: v })));
  const won = match.sets.filter((s) => setWinner(s) === 'us').length;
  const lost = match.sets.filter((s) => setWinner(s) === 'them').length;
  const verdict = won > lost ? 'Win' : won < lost ? 'Loss' : 'Draw';
  const readOnly = match.remoteBy && <div className="muted">Recorded by {match.remoteBy}. Only their phone can change it.</div>;
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
        {readOnly}
        <PlayersCard title="This game" sets={match.sets} />
        <ScoreSheet set={set} names={teamNames(match)} />
        {winnerPicker(set)}
        {legend}
        <div className="spacer" />
        {!match.remoteBy && <button className="ghost" onClick={() => go({ name: 'play', matchId: match.id })}>Continue / fix record</button>}
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
          <ScoreSheet set={set} names={teamNames(match)} action={match.sets.length > 1 && !match.remoteBy && (
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
      <div className="spacer" />
      {!match.remoteBy && <button className="ghost" onClick={() => go({ name: 'play', matchId: match.id })}>Continue / fix record</button>}
    </div>
  );
}
