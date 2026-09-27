// Recording a game: scoreboard and score pad for whichever side throws next.
import { useMemo, useState } from 'react';
import { deriveSet, type SideId, type ThrowRecord } from '../rules';
import { setWinner, uid, type AppData, type Match } from '../store';
import { isPracticeGame, teamNames, type Update, type Go, patchMatch, patchCurrentSet } from '../ui';
import { Scoreboard, ThrowInput } from '../components/ThrowInput';
import { SetEnd } from './SetEnd';

export function Play({ match, update, go }: { match: Match; data: AppData; update: Update; go: Go }) {
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
        onThrow={add} canUndo={set.records.length > 0} onUndo={undo}
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
