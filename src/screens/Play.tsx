// Recording a game, in one of two ways: turn by turn as it is played (scoreboard and score pad for
// whichever side throws next), or down the columns of the score sheet (e.g. copying a paper sheet).
import { useEffect, useMemo, useState } from 'react';
import { deriveSet, inTurnOrder, lineupOf, playableLength, sidesOf, type SideId, type ThrowRecord } from '../rules';
import { setWinner, uid, type AppData, type Match } from '../store';
import { isPracticeGame, teamNames, type Update, type Go, patchMatch, patchCurrentSet } from '../ui';
import { Scoreboard, ThrowInput, UndoButton } from '../components/ThrowInput';
import { ScoreSheet } from '../components/ScoreSheet';
import { EditPad } from '../components/EditPad';
import { applyFirst, applyPlayer, applyScore, canOffer, firstBlank, withoutLatest, type Cursor } from '../editDraft';
import { SetEnd } from './SetEnd';
import { TopBar } from '../components/TopBar';

type Mode = 'turn' | 'sheet';
const MODE_KEY = 'molkky-entry-mode';

function savedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'turn' ? 'turn' : 'sheet';
  } catch {
    return 'sheet';
  }
}

export function Play({ match, update, go }: { match: Match; data: AppData; update: Update; go: Go }) {
  const set = match.sets[match.sets.length - 1];
  // Throws that fit the turn order so far; columns filled ahead on the sheet wait for the others.
  const fit = useMemo(() => playableLength(set.config, set.records), [set]);
  const state = useMemo(() => deriveSet(set.config, set.records.slice(0, fit)), [set, fit]);
  const ahead = set.records.length - fit;
  const winner = setWinner(set);
  const [mode, setModeState] = useState<Mode>(savedMode);
  const [override, setOverride] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  // Selected cell in sheet mode; undefined picks the first open column, null hides the pad.
  const [picked, setPicked] = useState<Cursor | null | undefined>(undefined);
  const [late, setLate] = useState(false);
  const cursor = picked === undefined || (picked && picked.setId !== set.id) ? firstBlank(set) : picked;

  useEffect(() => {
    if (mode === 'sheet') document.querySelector('.sheet td.sel')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [mode, cursor]);

  const setMode = (m: Mode) => {
    setModeState(m);
    setPicked(undefined);
    setLate(false);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* storage unavailable */ }
  };
  const put = (m: Match) => update((d) => patchMatch(d, match.id, () => m));
  const add = (rec: Omit<ThrowRecord, 'id' | 'ts'>) => {
    // Into the side's column, so a sheet filled ahead keeps its turn order.
    update((d) => patchMatch(d, match.id, (m) => patchCurrentSet(m, (s) => ({
      ...s, records: inTurnOrder(s.config, [...s.records, { ...rec, id: uid(), ts: Date.now() }]),
    }))));
    setOverride(null);
  };
  const undo = () => {
    update((d) => patchMatch(d, match.id, (m) => patchCurrentSet(m, (s) => ({
      ...s, records: withoutLatest(s.records), manualWinner: undefined, closed: false,
    }))));
    setPicked(undefined);
    setLate(false);
  };
  const tapScore = (n: number) => {
    if (!cursor) return;
    const r = applyScore(match, cursor, n);
    setLate(!!r.late);
    if (r.late) return;
    put(r.match);
    // Down the same column; once it is done, on to the next side's column.
    const s = r.match.sets.find((x) => x.id === set.id)!;
    const team = 'team' in cursor ? cursor.team : set.records.find((x) => x.id === cursor.recordId)?.team;
    setPicked(r.next ?? firstBlank(s, team));
  };

  const practice = isPracticeGame(match);
  const title = practice ? `${match.tournament || 'Practice'} · ${match.date}` : `vs ${match.opponent || 'Opponent'} · Game ${set.setNo}`;
  const names = teamNames(match);

  if (set.closed || set.manualWinner || (winner && ahead === 0)) {
    return <SetEnd match={match} set={set} state={state} winner={winner} update={update} go={go} undo={undo} title={title} />;
  }

  const next = state.nextTeam as SideId;
  const nextLineup = lineupOf(set.config, next);
  const player = override ?? state.nextPlayer ?? undefined;
  const last = state.rows.at(-1);

  return (
    <div className="screen">
      <TopBar back="Matches" onBack={() => go({ name: 'home' })} title={title} sub={`${names[set.config.firstTeam]} first`}
        action={<button className="ghost small" onClick={() => go({ name: 'match', matchId: match.id, edit: true })}>Edit</button>} />
      <div className="seg" role="group" aria-label="How to enter">
        <button className={mode === 'turn' ? 'on' : ''} onClick={() => setMode('turn')}>Turn by turn</button>
        <button className={mode === 'sheet' ? 'on' : ''} onClick={() => setMode('sheet')}>Score sheet</button>
      </div>
      {winner && ahead > 0 && (
        // A column was filled past the end of the game (a score is likely wrong).
        <div className="notice col gap4">
          <div className="strong">The game ends at {names[winner]}{last ? ` turn ${last.teamIdx}` : ''}</div>
          <div className="tiny">
            {ahead} later {ahead === 1 ? 'throw comes' : 'throws come'} after the end and {ahead === 1 ? "doesn't" : "don't"} count.
            Fix a score on the sheet, or remove {ahead === 1 ? 'it' : 'them'}.
          </div>
          <button className="ghost small" onClick={() => update((d) => patchMatch(d, match.id, (m) => patchCurrentSet(m, (s) => ({ ...s, records: s.records.slice(0, fit) }))))}>
            Remove {ahead} {ahead === 1 ? 'throw' : 'throws'}
          </button>
        </div>
      )}
      {mode === 'turn' ? (
        winner ? null : (
          <>
            <Scoreboard state={state} current={next} names={names} />
            {ahead > 0 && (
              <div className="muted tiny">
                {ahead} {ahead === 1 ? 'throw is' : 'throws are'} entered ahead on the score sheet; the scoreboard counts up to the throws before {names[next]}'s turn.
              </div>
            )}
            <ThrowInput
              key={next} state={state} team={next} name={names[next]} player={player}
              lineup={nextLineup.length > 1 ? nextLineup : undefined} onPlayer={setOverride}
              onThrow={add} canUndo={set.records.length > 0} onUndo={undo}
            />
          </>
        )
      ) : (
        <>
          <div className="muted tiny">Tap scores down a column. Tap a cell to fix it, or a blank cell to add there.</div>
          <ScoreSheet set={set} names={names}
            selected={cursor ?? undefined}
            onThrow={(recordId) => { setPicked({ setId: set.id, recordId }); setLate(false); }}
            onAdd={(team, p) => { setPicked({ setId: set.id, team, player: p }); setLate(false); }}
            addTo={sidesOf(set.config).map((x) => x.id).filter((t) => canOffer(set, t))} />
          {!cursor && (
            <div className="inline gap8">
              <button className="ghost small" onClick={() => setPicked(undefined)}>Show score pad</button>
              <button className="ghost small" disabled={set.records.length === 0} onClick={undo}>Undo last throw</button>
            </div>
          )}
        </>
      )}
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
      {mode === 'sheet' && cursor && (
        <>
          <div className="pad-room" />
          <EditPad match={match} cursor={cursor} names={names} late={late} onScore={tapScore}
            undo={<UndoButton disabled={set.records.length === 0} onClick={undo} />}
            onPlayer={(p) => ('recordId' in cursor ? put(applyPlayer(match, cursor, p)) : setPicked({ ...cursor, player: p }))}
            onFirst={() => {
              if ('team' in cursor) put(applyFirst(match, cursor.setId, cursor.team));
              setLate(false);
            }}
            onClose={() => setPicked(null)} />
        </>
      )}
    </div>
  );
}
