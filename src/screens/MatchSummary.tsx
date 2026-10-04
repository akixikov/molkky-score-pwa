// Match result: stats and score sheets. Corrections happen in the edit mode (MatchEdit).
import { matchResult, setWinner, type Match } from '../store';
import { isPracticeGame, sidesLabel, teamNames, type Go } from '../ui';
import { TeamStatsCard } from '../components/StatsCards';
import { ScoreSheet } from '../components/ScoreSheet';
import { TopBar } from '../components/TopBar';

/** Match result, read-only; Edit opens the edit mode (also for teammates' matches). */
export function MatchSummary({ match, go }: { match: Match; go: Go }) {
  const { won, lost, verdict } = matchResult(match);
  const readOnly = match.remoteBy && <div className="muted">Recorded by {match.remoteBy}.</div>;
  const editButton = <button className="ghost small" onClick={() => go({ name: 'match', matchId: match.id, edit: true })}>Edit</button>;
  const legend = <div className="muted tiny">× miss (incl. foul)　<span className="legend over">25</span> over 50, back to 25　<span className="legend fin">50</span> finish</div>;

  if (isPracticeGame(match)) {
    const set = match.sets[0];
    const w = setWinner(set);
    return (
      <div className="screen">
        <TopBar back="Matches" onBack={() => go({ name: 'home' })} title={match.tournament || 'Practice'} sub={match.date} action={editButton} />
        <div className="result">
          <div>{sidesLabel(match)}</div>
          <div className="result-title">{w ? `Winner: ${teamNames(match)[w]}` : 'No result'}</div>
        </div>
        {readOnly}
        {(set.config.sides ?? []).map((x) => <TeamStatsCard key={x.id} title={`${x.name} this game`} sets={match.sets} team={x.id} />)}
        <ScoreSheet set={set} names={teamNames(match)} />
        {legend}
        <div className="spacer" />
        {!match.remoteBy && <button className="ghost" onClick={() => go({ name: 'play', matchId: match.id })}>Continue recording</button>}
      </div>
    );
  }

  return (
    <div className="screen">
      <TopBar back="Matches" onBack={() => go({ name: 'home' })} title={match.tournament || '(no tournament)'}
        sub={`${match.date}${match.kind === 'practice' ? ' · Practice' : ''}`} action={editButton} />
      <div className={`result ${verdict === 'Loss' ? 'lose' : ''}`}>
        <div>{match.ourTeam ? `${match.ourTeam} ` : ''}vs {match.opponent || 'Opponent'}</div>
        <div className="result-title">{verdict} {won}-{lost}</div>
      </div>
      {readOnly}
      <TeamStatsCard title={`${teamNames(match).us} this match`} sets={match.sets} />
      {match.sets.map((set) => <ScoreSheet key={set.id} set={set} names={teamNames(match)} />)}
      {legend}
      <div className="spacer" />
      {!match.remoteBy && <button className="ghost" onClick={() => go({ name: 'play', matchId: match.id })}>Continue recording</button>}
    </div>
  );
}
