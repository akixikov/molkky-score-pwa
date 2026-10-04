// End of a game: result, stats and the next game (or play again for practice).
import { useState } from 'react';
import { deriveSet, other, type SetState, type SideId, type Team } from '../rules';
import { uid, type Match, type SetEntry } from '../store';
import { isPracticeGame, teamNames, dqNames, type Update, type Go, patchMatch, patchCurrentSet } from '../ui';
import { LineupEditor, TeamToggle } from '../components/Lineup';
import { TeamStatsCard } from '../components/StatsCards';
import { TopBar } from '../components/TopBar';

export function SetEnd({ match, set, state, winner, update, go, undo, title }: {
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
        <TopBar back="Matches" onBack={() => go({ name: 'home' })} title={title} />
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
        {state.order.map((x) => <TeamStatsCard key={x.id} title={`${names[x.id]} this game`} sets={[set]} team={x.id} />)}
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
      <TopBar back="Matches" onBack={() => go({ name: 'home' })} title={title} />
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
