// Edit mode's score pad: docked at the bottom, it writes into the selected cell of the score sheet.
import { deriveSet } from '../rules';
import { type Match } from '../store';
import { type Names } from '../ui';
import { type Cursor } from '../editDraft';

const SCORES = Array.from({ length: 13 }, (_, i) => i);

export function EditPad({ match, cursor, names, late, onScore, onPlayer, onClose }: {
  match: Match; cursor: Cursor; names: Names;
  /** The last tap tried to add a throw after the end of the game. */
  late: boolean;
  onScore: (n: number) => void; onPlayer: (p: string) => void; onClose: () => void;
}) {
  const set = match.sets.find((s) => s.id === cursor.setId);
  if (!set) return null;
  const st = deriveSet(set.config, set.records);
  const rec = 'recordId' in cursor ? set.records.find((r) => r.id === cursor.recordId) : undefined;
  const team = rec?.team ?? ('team' in cursor ? cursor.team : '');
  const row = rec && st.rows.find((r) => r.id === rec.id);
  const turn = row?.teamIdx ?? set.records.filter((r) => r.team === team).length + 1;
  const player = rec ? rec.player : 'team' in cursor ? cursor.player : undefined;
  const lineup = st.order.find((x) => x.id === team)?.lineup ?? [];
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
      <div className="score-grid">
        {SCORES.map((n) => (
          <button key={n} className={`pick ${rec?.score === n ? 'on' : ''} ${n === 0 ? 'zero' : ''}`} onClick={() => onScore(n)}>{n}</button>
        ))}
      </div>
      {late && <div className="warn-text tiny">The game is already over before this throw, so it cannot be added.</div>}
    </div>
  );
}
