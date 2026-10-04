// Edit mode's score pad: docked at the bottom, it writes into the selected cell of the score sheet.
import { deriveSet, lineupOf, WIN_SCORE } from '../rules';
import { PinPad } from './ThrowInput';
import { type Match } from '../store';
import { type Names } from '../ui';
import { canAdd, type Cursor } from '../editDraft';

export function EditPad({ match, cursor, names, late, onScore, onPlayer, onFirst, onClose }: {
  match: Match; cursor: Cursor; names: Names;
  /** The last tap tried to add a throw after the end of the game. */
  late: boolean;
  onScore: (n: number) => void; onPlayer: (p: string) => void;
  /** Makes the selected side throw first in this game (when that lets its throw count). */
  onFirst: () => void; onClose: () => void;
}) {
  const set = match.sets.find((s) => s.id === cursor.setId);
  if (!set) return null;
  const st = deriveSet(set.config, set.records);
  const rec = 'recordId' in cursor ? set.records.find((r) => r.id === cursor.recordId) : undefined;
  const team = rec?.team ?? ('team' in cursor ? cursor.team : '');
  const row = rec && st.rows.find((r) => r.id === rec.id);
  // Points still needed before this throw, as on the recording screen.
  const need = WIN_SCORE - (row ? row.before : st.teams[team]?.score ?? 0);
  const turn = row?.teamIdx ?? set.records.filter((r) => r.team === team).length + 1;
  const player = rec ? rec.player : 'team' in cursor ? cursor.player : undefined;
  const lineup = lineupOf(set.config, team);
  const players = [...new Set([...lineup, ...(player ? [player] : [])])];
  return (
    <div className="edit-pad col gap8" role="group" aria-label="Score pad">
      <div className="inline between">
        <span className="strong ellipsis">{rec ? '' : 'Add · '}Game {set.setNo} · {names[team]} · turn {turn}</span>
        <button className="link" onClick={onClose}>Done</button>
      </div>
      {players.length > 1 && (
        <label className="inline between">
          <span className="muted">Thrown by</span>
          <select value={player ?? ''} onChange={(e) => onPlayer(e.target.value)}>
            {players.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
      )}
      <PinPad need={need} on={rec?.score} onTap={onScore} />
      {!rec && !canAdd(set, team) ? (
        // Only offered when making this side first lets the throw count (see canOffer).
        <div className="warn-text tiny">
          With {names[set.config.firstTeam]} throwing first, the game is over before this throw.
          If {names[team]} actually threw first, <button className="link tiny" onClick={onFirst}>make {names[team]} first</button>.
        </div>
      ) : late && <div className="warn-text tiny">The game is already over before this throw, so it cannot be added.</div>}
    </div>
  );
}
