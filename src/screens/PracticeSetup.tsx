// Practice game setup: individual or teams, every player recorded.
import { useState } from 'react';
import { MAX_PRACTICE_PLAYERS, type Side } from '../rules';
import { uid, type AppData, type Match } from '../store';
import { today, isPracticeGame, type Update, type Go } from '../ui';
import { RosterChips, MemberInput, LineupEditor } from '../components/Lineup';

export const MAX_TEAMS = 3;

/** Practice game with every player recorded: individual (one player per side) or teams. */
export function PracticeSetup({ data, update, go }: { data: AppData; update: Update; go: Go }) {
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
