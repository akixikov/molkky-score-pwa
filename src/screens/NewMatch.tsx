// Tournament match setup.
import { useState } from 'react';
import { type Team } from '../rules';
import { uid, type AppData, type Match } from '../store';
import { today, namesOf, isPracticeGame, type Update, type Go } from '../ui';
import { LineupEditor, TeamToggle } from '../components/Lineup';

export function NewMatch({ data, update, go }: { data: AppData; update: Update; go: Go }) {
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
