// Member pickers: saved-member chips, the add box, the throwing-order editor and the first-team toggle.
import { useRef, useState } from 'react';
import { type Team } from '../rules';
import { type Names } from '../ui';

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
/** Light icon button for a member row: remove. */
export const Remove = ({ onClick, name }: { onClick: () => void; name: string }) => (
  <button className="icon-btn" aria-label={`Remove ${name}`} onClick={onClick}>{icon('M7 7l10 10M17 7 7 17')}</button>
);

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

/**
 * Members in throwing order, reordered by dragging a row's handle (pointer events, so touch works too;
 * arrow keys move the focused handle). Each row shows its number, the name and a remove button.
 */
export function OrderList({ items, onChange }: { items: string[]; onChange: (l: string[]) => void }) {
  const [drag, setDrag] = useState<{ from: number; startY: number; dy: number; h: number } | null>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const move = (from: number, to: number) => {
    if (to === from || to < 0 || to >= items.length) return;
    const l = [...items];
    l.splice(to, 0, ...l.splice(from, 1));
    onChange(l);
  };
  const target = drag ? Math.max(0, Math.min(items.length - 1, drag.from + Math.round(drag.dy / drag.h))) : -1;
  // Where each row would land if dropped now: the rows the held one passes step aside by one place.
  const pos = (i: number) => {
    if (!drag) return i;
    if (i === drag.from) return target;
    if (drag.from < i && i <= target) return i - 1;
    if (target <= i && i < drag.from) return i + 1;
    return i;
  };
  if (items.length === 0) return null;
  return (
    <div className="col">
      {items.map((p, i) => (
        <div key={p} ref={(el) => { rows.current[i] = el; }}
          className={`lineup ${drag?.from === i ? 'dragging' : ''} ${drag ? 'moving' : ''}`}
          style={drag ? { transform: `translateY(${i === drag.from ? drag.dy : (pos(i) - i) * drag.h}px)` } : undefined}>
          <span className="num">{pos(i) + 1}</span>
          <span className="grow">{p}</span>
          {items.length > 1 && (
            <button className="icon-btn handle" aria-label={`Reorder ${p}`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const [a, b] = rows.current;
                setDrag({ from: i, startY: e.clientY, dy: 0, h: a && b ? b.offsetTop - a.offsetTop : 54 });
              }}
              onPointerMove={(e) => drag && setDrag({ ...drag, dy: e.clientY - drag.startY })}
              onPointerUp={() => { if (drag) move(drag.from, target); setDrag(null); }}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); move(i, i + (e.key === 'ArrowUp' ? -1 : 1)); }
              }}>
              {icon('M5 9h14M5 15h14')}
            </button>
          )}
          <Remove name={p} onClick={() => onChange(items.filter((x) => x !== p))} />
        </div>
      ))}
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
      <OrderList items={lineup} onChange={onChange} />
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
