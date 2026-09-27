// Paper-style score sheet of one game.
import { type ReactNode } from 'react';
import { deriveSet, type DerivedThrow, type SideId } from '../rules';
import { setWinner, type SetEntry } from '../store';
import { type Names, dqNames, sideClass } from '../ui';

function endLabel(s: SetEntry, names: Names): string {
  const st = deriveSet(s.config, s.records);
  if (s.manualWinner) return 'Manual';
  if (st.endReason === 'finish') return 'Reached 50';
  if (st.endReason === 'opponent-eliminated') return `${dqNames(st, names)} DQ`;
  return '—';
}

/** Paper-style score sheet of one set: one row per turn, sides in throwing order. */
export function ScoreSheet({ set, names, action }: { set: SetEntry; names: Names; action?: ReactNode }) {
  const st = deriveSet(set.config, set.records);
  const w = setWinner(set);
  const order = st.order.map((x) => x.id);
  const byTeam = (t: SideId) => st.rows.filter((r) => r.team === t);
  const cols = order.map(byTeam);
  const turns = Math.max(0, ...cols.map((c) => c.length));
  // Sides with several players get one score column per player; others a single score column.
  const scoreCols = (t: SideId) => {
    const lineup = st.order.find((x) => x.id === t)?.lineup ?? [];
    const players = [...new Set([...lineup, ...byTeam(t).map((r) => r.player ?? '')])];
    return t === 'us' || lineup.length > 1 ? players : [''];
  };
  const cells = (t: SideId, r: DerivedThrow | undefined) => {
    const perPlayer = scoreCols(t)[0] !== '';
    const miss = r?.score === 0;
    return [
      ...scoreCols(t).map((p) => (r && (!perPlayer || r.player === p)
        ? <td key={`${t}s${p}`} className={miss ? 'miss' : ''}>{miss ? '×' : r.score}</td>
        : <td key={`${t}s${p}`} className={perPlayer ? 'idle' : ''} />)),
      !r ? <td key={`${t}t`} className="tot" /> :
      <td key={`${t}t`} className={`tot ${r.event === 'Over' ? 'over' : ''} ${r.event === 'Finish' ? 'fin' : ''}`}>
        {r.event === 'Eliminated' ? 'DQ' : <span>{r.after}</span>}
      </td>,
    ];
  };
  return (
    <div className="sheet">
      <div className="sheet-head">
        <span className="strong">Game {set.setNo}</span>
        <span className="inline">
          <span className="muted">{w ? `Winner: ${names[w]} · ${endLabel(set, names)}` : 'In progress'}</span>
          {action}
        </span>
      </div>
      <div className="sheet-scroll">
        <table>
          <thead>
            <tr>
              <th rowSpan={2} className="turn">Turn</th>
              {order.map((t) => (
                <th key={t} colSpan={scoreCols(t).length + 1} className={`team ${sideClass(t)} ${w === t ? 'won' : ''}`}>
                  {names[t]}{t === set.config.firstTeam ? ' (1st)' : ''}
                </th>
              ))}
            </tr>
            <tr>
              {order.flatMap((t) => [
                ...scoreCols(t).map((p) => <th key={`${t}s${p}`} className={p ? 'who' : ''}>{p || 'Pts'}</th>),
                <th key={`${t}t`} className="tot">Total</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: turns }, (_, i) => (
              <tr key={i}>
                <td className="turn">{i + 1}</td>
                {order.flatMap((t, k) => cells(t, cols[k][i]))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="turn">Σ</td>
              {order.map((t) => (
                <td key={t} colSpan={scoreCols(t).length + 1} className={`final ${w === t ? 'won' : ''}`}>
                  {st.teams[t].eliminated ? 'DQ' : byTeam(t).length === 0 ? '—' : st.teams[t].score}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
