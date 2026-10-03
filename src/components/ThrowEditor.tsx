// Correcting one recorded throw, or adding one in a blank cell, with what the change does to the game.
import { useState, type ReactNode } from 'react';
import { deriveSet, inTurnOrder, playableLength, type SideId, type ThrowRecord } from '../rules';
import { uid, type SetEntry } from '../store';
import { type Names } from '../ui';

const SCORES = Array.from({ length: 13 }, (_, i) => i);

/** A recorded throw to correct, or the next throw of a side to add (e.g. opponent scores filled in later). */
export type ThrowTarget = { recordId: string } | { team: SideId; player?: string };

/**
 * Bottom panel over the match result. Saving replaces (or adds) the throw; when the change ends the
 * game earlier (or disqualifies a side sooner), the throws that no longer fit are dropped after a warning.
 * `onSave(records, next)` — next: the user wants to add the same side's following throw right away.
 */
export function ThrowEditor({ set, target, names, note, onSave, onClose }: {
  set: SetEntry; target: ThrowTarget; names: Names;
  /** Shown above the save button, e.g. when the match is a teammate's. */
  note?: ReactNode;
  onSave: (records: ThrowRecord[], next: boolean) => void; onClose: () => void;
}) {
  const adding = !('recordId' in target);
  const [base] = useState<ThrowRecord>(() => ('recordId' in target
    ? set.records.find((r) => r.id === target.recordId)!
    : { id: uid(), team: target.team, ...(target.player ? { player: target.player } : {}), score: 0, ts: Date.now() }));
  const [score, setScore] = useState<number | null>(adding ? null : base.score);
  const [player, setPlayer] = useState(base.player);

  const before = deriveSet(set.config, set.records);
  const lineup = before.order.find((x) => x.id === base.team)?.lineup ?? [];
  const players = [...new Set([...lineup, ...(base.player ? [base.player] : [])])];
  const turn = adding ? set.records.filter((r) => r.team === base.team).length + 1 : before.rows.find((r) => r.id === base.id)?.teamIdx;

  const rec: ThrowRecord = { ...base, score: score ?? 0, player };
  const edited = adding ? inTurnOrder(set.config, [...set.records, rec]) : set.records.map((r) => (r.id === base.id ? rec : r));
  // Only drop what this change puts out of turn; records that never fitted stay as they were.
  const fits = playableLength(set.config, edited);
  const next = fits < playableLength(set.config, set.records) ? edited.slice(0, fits) : edited;
  const after = deriveSet(set.config, next);
  const dropped = edited.length - next.length;
  const oldRow = before.rows.find((r) => r.id === base.id);
  const newRow = after.rows.find((r) => r.id === base.id);
  // Throws kept but no longer counted, because the game now ends before them (the new throw aside).
  const uncounted = (next.length - after.rows.length) - (set.records.length - before.rows.length) - (adding && !newRow ? 1 : 0);
  const changed = adding ? score !== null : score !== base.score || player !== base.player;
  const lateAdd = adding && score !== null && !newRow;
  const winnerLost = !set.manualWinner && before.winner && !after.winner;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="panel col" role="dialog" aria-label={adding ? 'Add a throw' : 'Fix a throw'} onClick={(e) => e.stopPropagation()}>
        <div className="inline between">
          <div className="strong">{adding ? 'Add · ' : ''}Game {set.setNo} · {names[base.team]} · turn {turn ?? '?'}</div>
          <button className="link" onClick={onClose}>Cancel</button>
        </div>
        {players.length > 1 && (
          <label className="inline between">
            <span className="muted">Thrown by</span>
            <select value={player ?? ''} onChange={(e) => setPlayer(e.target.value)}>
              {players.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
        )}
        <div className="score-grid">
          {SCORES.map((n) => (
            <button key={n} className={`pick ${n === score ? 'on' : ''} ${n === 0 ? 'zero' : ''}`} onClick={() => setScore(n)}>{n}</button>
          ))}
        </div>
        <div className="muted">
          Total {oldRow ? `${oldRow.before} → ${oldRow.after}` : adding ? '' : '—'}
          {newRow && changed && <>{oldRow ? ', now ' : ''}<span className="strong">{newRow.before} → {newRow.event === 'Eliminated' ? 'DQ' : newRow.after}</span></>}
        </div>
        {lateAdd && <div className="warn-text tiny">The game is already over before this throw, so it would not count.</div>}
        {dropped > 0 && (
          <div className="warn-text tiny">
            {after.winner ? `This ends the game (${names[after.winner]} wins)` : 'This puts later throws out of turn'};
            the {dropped} {dropped === 1 ? 'throw' : 'throws'} after it will be removed.
          </div>
        )}
        {dropped === 0 && uncounted > 0 && (
          <div className="warn-text tiny">The game now ends earlier; {uncounted} later {uncounted === 1 ? 'throw no longer counts' : 'throws no longer count'}.</div>
        )}
        {winnerLost && <div className="warn-text tiny">The game no longer has a winner from the throws. Set the winner below the score sheet.</div>}
        {note && <div className="warn-text tiny">{note}</div>}
        <div className={adding ? 'grid2' : 'col'}>
          <button className={dropped > 0 ? 'danger' : 'primary'} disabled={!changed || lateAdd} onClick={() => onSave(next, false)}>
            {dropped > 0 ? `Save and remove ${dropped}` : 'Save'}
          </button>
          {adding && (
            <button className="ghost" disabled={!changed || lateAdd || dropped > 0} onClick={() => onSave(next, true)}>Save, add next</button>
          )}
        </div>
      </div>
    </div>
  );
}
