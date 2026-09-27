// Input screen parts: the scoreboard, strategy hints and the skittle score pad.
import { hintsFor, PIN_ROWS, WIN_SCORE, type SetState, type SideId, type ThrowRecord } from '../rules';
import { type Names, sideClass } from '../ui';

export function Scoreboard({ state, current, names }: { state: SetState; current: SideId | null; names: Names }) {
  // Tournament games keep us on the left; practice games follow the throwing order.
  const ids = 'us' in state.teams && 'them' in state.teams ? ['us', 'them'] : state.order.map((x) => x.id);
  return (
    <div className={ids.length > 2 ? 'grid3' : 'grid2'}>
      {ids.map((t) => {
        const s = state.teams[t];
        return (
          <div key={t} className={`card score ${sideClass(t)} ${current === t ? 'active' : ''} ${s.eliminated ? 'out' : ''}`}>
            <div className="label">{names[t]}</div>
            <div className="inline base">
              <span className="big-num">{s.eliminated ? 'DQ' : s.score}</span>
              {!s.eliminated && <span className="muted">{WIN_SCORE - s.score} to go</span>}
            </div>
            <div className="dots">{[0, 1, 2].map((i) => <span key={i} className={i < s.faultStreak ? 'dot on' : 'dot'} />)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function Hints({ state, team }: { state: SetState; team: SideId }) {
  const hints = hintsFor(state, team);
  if (hints.length === 0) return null;
  return (
    <div className="col gap8">
      {hints.map((h) => (
        <div key={h.title} className={`hint ${h.level}`}>
          <div className="strong">{h.title}</div>
          <div>{h.body}</div>
        </div>
      ))}
    </div>
  );
}

/** Score pad laid out like the initial pin setup; one tap records a throw of that score. */
export function ThrowInput({ state, team, name, player, lineup, onPlayer, hints, onThrow, canUndo, onUndo }: {
  state: SetState; team: SideId; name: string; player?: string; lineup?: string[];
  onPlayer?: (p: string) => void; hints: boolean; onThrow: (r: Omit<ThrowRecord, 'id' | 'ts'>) => void;
  canUndo: boolean; onUndo: () => void;
}) {
  const t = state.teams[team];
  const need = WIN_SCORE - t.score;
  const tap = (score: number) => onThrow(player ? { team, player, score } : { team, score });
  const pinClass = (n: number) => `pin ${n === need ? 'win' : n > need ? 'burst' : ''}`;
  return (
    <>
      <div className="col gap4">
        <div className="inline between turnhead">
          <div className="sub">{name} · turn {t.throws + 1}</div>
          {lineup && onPlayer && (
            <select value={player} onChange={(e) => onPlayer(e.target.value)}>
              {lineup.map((p) => <option key={p}>{p}</option>)}
            </select>
          )}
        </div>
        <div className="h2">{player ?? name}: tap the score</div>
      </div>
      <div className="pins">
        {[...PIN_ROWS].reverse().map((row, i, rows) => (
          <div key={i} className="pinrow">
            {i === 0 && (
              <button className="undo" aria-label="Undo last throw" title="Undo last throw" disabled={!canUndo} onClick={onUndo}>
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
                </svg>
              </button>
            )}
            {i === rows.length - 1 && <button className="pin miss" onClick={() => tap(0)}>0</button>}
            {row.map((p) => (
              <button key={p} className={pinClass(p)} onClick={() => tap(p)}>{p}</button>
            ))}
          </div>
        ))}
        <div className="muted tiny center">
          {need} to finish{need > 12 ? ' (2+ turns)' : ''} · misses in a row: {t.faultStreak}
        </div>
      </div>
      {hints && <Hints state={state} team={team} />}
    </>
  );
}
