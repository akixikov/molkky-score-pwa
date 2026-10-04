// Match result: stats and score sheets. Corrections happen in the edit mode (MatchEdit).
import { matchResult, setWinner, type Match } from '../store';
import { isPracticeGame, sidesLabel, teamNames, type Go } from '../ui';
import { TeamStatsCard } from '../components/StatsCards';
import { ScoreSheet } from '../components/ScoreSheet';
import { TopBar } from '../components/TopBar';

/** Match result, read-only; Edit opens the edit mode (also for teammates' matches). */
export function MatchSummary({ match, go }: { match: Match; go: Go }) {
  const practice = isPracticeGame(match);
  const names = teamNames(match);
  const { won, lost, verdict } = matchResult(match);
  const w = setWinner(match.sets[0]);
  // A practice game has one set and any number of sides; a tournament match is us against them.
  const sets = practice ? match.sets.slice(0, 1) : match.sets;
  return (
    <div className="screen">
      <TopBar back="Matches" onBack={() => go({ name: 'home' })} title={match.tournament || (practice ? 'Practice' : '(no tournament)')}
        sub={practice ? match.date : `${match.date}${match.kind === 'practice' ? ' · Practice' : ''}`}
        action={<button className="ghost small" onClick={() => go({ name: 'match', matchId: match.id, edit: true })}>Edit</button>} />
      {practice ? (
        <div className="result">
          <div>{sidesLabel(match)}</div>
          <div className="result-title">{w ? `Winner: ${names[w]}` : 'No result'}</div>
        </div>
      ) : (
        <div className={`result ${verdict === 'Loss' ? 'lose' : verdict === 'Draw' ? 'draw' : ''}`}>
          <div>{match.ourTeam ? `${match.ourTeam} ` : ''}vs {match.opponent || 'Opponent'}</div>
          <div className="result-title">{verdict} {won}-{lost}</div>
        </div>
      )}
      {match.remoteBy && <div className="muted">Recorded by {match.remoteBy}.</div>}
      {practice
        ? (sets[0].config.sides ?? []).map((x) => <TeamStatsCard key={x.id} title={`${x.name} this game`} sets={match.sets} team={x.id} />)
        : <TeamStatsCard title={`${names.us} this match`} sets={match.sets} />}
      {sets.map((set) => <ScoreSheet key={set.id} set={set} names={names} />)}
      <div className="muted tiny">× miss (incl. foul)　<span className="legend over">25</span> over 50, back to 25　<span className="legend fin">50</span> finish</div>
      <div className="spacer" />
      {!match.remoteBy && <button className="ghost" onClick={() => go({ name: 'play', matchId: match.id })}>Continue recording</button>}
    </div>
  );
}
