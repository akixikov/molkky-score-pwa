// Input screen parts: the scoreboard and the skittle score pad.
import { type ReactNode } from 'react';
import { PIN_ROWS, WIN_SCORE, type SetState, type SideId, type ThrowRecord } from '../rules';
import { type Names, sideClass } from '../ui';

const dots = (n: number) => <div className="dots">{[0, 1, 2].map((i) => <span key={i} className={i < n ? 'dot on' : 'dot'} />)}</div>;

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
            {/* Compact cards (3+ sides) put the dots beside the score. */}
            <div className="inline base">
              <span className="big-num">{s.eliminated ? 'DQ' : s.score}</span>
              {!s.eliminated && <span className="muted">{WIN_SCORE - s.score} to go</span>}
              {ids.length > 2 && dots(s.faultStreak)}
            </div>
            {ids.length <= 2 && dots(s.faultStreak)}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Score buttons laid out like the initial pin setup, 0 to the left of the front row. Marks the score
 * that finishes (`need`) and the ones that go over 50; `on` highlights a current score (edit mode).
 */
export function PinPad({ need, on, onTap, undo, children }: {
  need: number; on?: number; onTap: (score: number) => void; undo?: ReactNode; children?: ReactNode;
}) {
  const pinClass = (n: number) => `pin ${n === need ? 'win' : n > need ? 'burst' : ''} ${n === on ? 'on' : ''}`;
  return (
    <div className="pins">
      {[...PIN_ROWS].reverse().map((row, i, rows) => (
        <div key={i} className="pinrow">
          {i === 0 && undo}
          {i === rows.length - 1 && <button className={`pin miss ${on === 0 ? 'on' : ''}`} onClick={() => onTap(0)}>0</button>}
          {row.map((p) => (
            <button key={p} className={pinClass(p)} onClick={() => onTap(p)}>{p}</button>
          ))}
        </div>
      ))}
      {children}
    </div>
  );
}

/** Score pad for the next throw; one tap records a throw of that score. */
export function ThrowInput({ state, team, name, player, lineup, onPlayer, onThrow, canUndo, onUndo }: {
  state: SetState; team: SideId; name: string; player?: string; lineup?: string[];
  onPlayer?: (p: string) => void; onThrow: (r: Omit<ThrowRecord, 'id' | 'ts'>) => void;
  canUndo: boolean; onUndo: () => void;
}) {
  const t = state.teams[team];
  const need = WIN_SCORE - t.score;
  const tap = (score: number) => onThrow(player ? { team, player, score } : { team, score });
  return (
    <>
      {/* Whose turn, in one line: the side and turn, then the thrower (changeable when the side has a lineup). */}
      <div className="inline between turnhead">
        <div className="sub">{name} · turn {t.throws + 1}</div>
        {lineup && onPlayer
          ? (
            <select className="thrower" aria-label="Thrower" value={player} onChange={(e) => onPlayer(e.target.value)}>
              {lineup.map((p) => <option key={p}>{p}</option>)}
            </select>
          )
          : player && player !== name && <span className="thrower">{player}</span>}
      </div>
      <PinPad need={need} onTap={tap} undo={
        <button className="undo" aria-label="Undo last throw" title="Undo last throw" disabled={!canUndo} onClick={onUndo}>
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
          </svg>
        </button>
      } />
    </>
  );
}
