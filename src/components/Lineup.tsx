// Member pickers: saved-member chips, the add box, the throwing-order editor and the first-team toggle.
import { useState } from 'react';
import { type Team } from '../rules';
import { type Names } from '../ui';

/** Saved members to pick from. In edit mode a tap removes a (mistyped) name from the saved list. */
export function RosterChips({ names, onPick, onDelete }: { names: string[]; onPick: (n: string) => void; onDelete?: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (names.length === 0) return null;
  return (
    <div className="col gap4">
      <div className="chips">
        {names.map((r) => (editing && onDelete
          ? <button key={r} className="chip del" onClick={() => { onDelete(r); if (names.length === 1) setEditing(false); }}>× {r}</button>
          : <button key={r} className="chip" onClick={() => onPick(r)}>＋ {r}</button>))}
      </div>
      {onDelete && (
        <button className="link tiny" onClick={() => setEditing(!editing)}>
          {editing ? 'Done editing' : 'Edit saved members'}
        </button>
      )}
      {editing && <div className="muted tiny">Tap a name to remove it from the saved list. Past records keep it.</div>}
    </div>
  );
}

/**
 * Name box for adding a member. It is swapped for a fresh input after each add, so an
 * unfinished IME or predictive-text composition cannot write the previous name back in.
 */
export function MemberInput({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  const [round, setRound] = useState(0);
  const add = () => {
    const n = name.trim();
    if (!n) return;
    onAdd(n);
    setName('');
    setRound((r) => r + 1);
  };
  return (
    <div className="inline">
      <input
        key={round} autoFocus={round > 0} value={name} placeholder="Add member"
        onChange={(e) => setName(e.target.value)}
        // Enter while converting kana only confirms the conversion.
        onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
      />
      <button className="ghost small" onClick={add}>Add</button>
    </div>
  );
}

export function LineupEditor({ roster, lineup, onChange, onAddRoster, onRemoveRoster, max }: {
  roster: string[]; lineup: string[]; onChange: (l: string[]) => void; onAddRoster: (n: string) => void;
  onRemoveRoster?: (n: string) => void; max?: number;
}) {
  const full = max !== undefined && lineup.length >= max;
  const add = (n: string) => {
    if (full) return;
    if (!roster.includes(n)) onAddRoster(n);
    if (!lineup.includes(n)) onChange([...lineup, n]);
  };
  return (
    <div className="card col">
      <div className="strong">Throwing order</div>
      {lineup.length === 0 && <div className="muted">Tap members below to add them in order</div>}
      {lineup.map((p, i) => (
        <div key={p} className="lineup">
          <span className="num">{i + 1}</span>
          <span className="grow">{p}{i === 0 ? ' (1st)' : ''}</span>
          <button className="ghost small" disabled={i === 0} onClick={() => {
            const l = [...lineup];
            [l[i - 1], l[i]] = [l[i], l[i - 1]];
            onChange(l);
          }}>↑</button>
          <button className="ghost small" onClick={() => onChange(lineup.filter((x) => x !== p))}>×</button>
        </div>
      ))}
      {full ? <div className="muted tiny">Up to {max} players.</div> : (
        <>
          <RosterChips names={roster.filter((r) => !lineup.includes(r))} onPick={(r) => onChange([...lineup, r])} onDelete={onRemoveRoster} />
          <MemberInput onAdd={add} />
        </>
      )}
    </div>
  );
}

export function TeamToggle({ value, onChange, names }: { value: Team; onChange: (t: Team) => void; names: Names }) {
  return (
    <div className="seg">
      {(['us', 'them'] as Team[]).map((t) => (
        <button key={t} className={value === t ? 'on' : ''} onClick={() => onChange(t)}>{names[t]} first</button>
      ))}
    </div>
  );
}
