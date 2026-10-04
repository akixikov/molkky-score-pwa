// Edit mode of a match: tap a cell, tap scores; every change waits in a draft until Save.
import { useEffect, useState } from 'react';
import { deriveSet } from '../rules';
import { type Match, type SetEntry } from '../store';
import { isPracticeGame, teamNames, type Go } from '../ui';
import { ScoreSheet } from '../components/ScoreSheet';
import { EditPad } from '../components/EditPad';
import { applyFirst, applyPlayer, applyScore, applyWinner, finalize, removeGame, type Cursor } from '../editDraft';

/**
 * `save` stores the edited match (own: on this device; a teammate's: through the team sheet). Without it,
 * a teammate's match can only be deleted here (the sheet script is too old to accept corrections).
 */
export function MatchEdit({ match, save, remove, go }: {
  match: Match; save?: (m: Match) => void; remove: () => void; go: Go;
}) {
  const [draft, setDraft] = useState(match);
  const [changes, setChanges] = useState(0);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [late, setLate] = useState(false);
  // Second taps that confirm: discarding changes, saving with throws removed, deleting the match or a game.
  const [armed, setArmed] = useState<string | null>(null);
  // Keep the selected cell in sight above the docked pad as the cursor moves down a column.
  useEffect(() => {
    document.querySelector('.sheet td.sel')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [cursor]);
  const own = !match.remoteBy;
  const canFix = !!save;
  const names = teamNames(draft);
  const back = () => go({ name: 'match', matchId: match.id });

  const change = (m: Match) => {
    setDraft(m);
    setChanges((n) => n + 1);
    setArmed(null);
  };
  const tapScore = (n: number) => {
    if (!cursor) return;
    const r = applyScore(draft, cursor, n);
    setLate(!!r.late);
    if (r.late) return;
    change(r.match);
    setCursor(r.next);
  };
  const select = (c: Cursor) => { setCursor(c); setLate(false); };

  const { match: toSave, dropped } = finalize(match, draft);
  const onSave = () => {
    if (dropped > 0 && armed !== 'save') { setArmed('save'); return; }
    save?.(toSave);
    back();
  };
  const onCancel = () => {
    if (changes > 0 && armed !== 'discard') { setArmed('discard'); return; }
    back();
  };

  // Which side threw first, often unknown in imported games; it decides who reached 50 first.
  const firstPicker = (set: SetEntry) => (
    <label className="inline game-winner muted">
      Game {set.setNo} first
      <select value={set.config.firstTeam} onChange={(e) => { change(applyFirst(draft, set.id, e.target.value)); setLate(false); }}>
        {(set.config.sides?.map((x) => x.id) ?? ['us', 'them']).map((id) => <option key={id} value={id}>{names[id]}</option>)}
      </select>
    </label>
  );
  const winnerPicker = (set: SetEntry) => {
    const st = deriveSet(set.config, set.records);
    return (
      <label className="inline game-winner muted">
        Game {set.setNo} winner
        <select value={set.manualWinner ?? ''} onChange={(e) => change(applyWinner(draft, set.id, e.target.value))}>
          <option value="">From the throws{st.winner ? ` (${names[st.winner]})` : ' (none)'}</option>
          {st.order.map((x) => <option key={x.id} value={x.id}>{names[x.id]}</option>)}
        </select>
      </label>
    );
  };
  const deleteGame = (set: SetEntry) => own && draft.sets.length > 1 && (
    <button className={armed === set.id ? 'danger small' : 'ghost small'}
      onClick={() => (armed === set.id ? (change(removeGame(draft, set.id)), setCursor(null)) : setArmed(set.id))}>
      {armed === set.id ? 'Really delete' : 'Delete'}
    </button>
  );

  return (
    <div className="screen">
      <div className="edit-bar">
        <button className={armed === 'discard' ? 'danger small' : 'ghost small'} onClick={onCancel}>
          {armed === 'discard' ? 'Discard changes' : 'Cancel'}
        </button>
        <span className="strong">Editing</span>
        <button className={armed === 'save' ? 'danger small' : 'primary small'} disabled={!canFix || changes === 0} onClick={onSave}>
          {armed === 'save' ? `Save, remove ${dropped}` : `Save${changes > 0 ? ` (${changes})` : ''}`}
        </button>
      </div>
      {armed === 'save' && (
        <div className="warn-text tiny">
          A fix ends a game earlier, so {dropped} later {dropped === 1 ? 'throw no longer fits and is' : 'throws no longer fit and are'} removed. Tap Save again to confirm.
        </div>
      )}
      {match.remoteBy && canFix && (
        <div className="muted tiny">
          Recorded by {match.remoteBy}. Saved fixes go to the team sheet and reach their phone when it syncs.
          Team names and games can only be changed on their phone.
        </div>
      )}
      {!canFix && (
        <div className="notice col gap4">
          <div className="strong">Scores can't be fixed here yet</div>
          <div className="tiny">
            This match was recorded on {match.remoteBy}'s phone (another device). Fixing it from here needs the team sheet's
            script updated to the latest version (see the setup guide). Until then, fix it on that phone. You can still delete it below.
          </div>
        </div>
      )}
      {own && !isPracticeGame(draft) && (
        <div className="card col">
          <label className="field">Our team<input value={draft.ourTeam ?? ''} onChange={(e) => change({ ...draft, ourTeam: e.target.value })} /></label>
          <label className="field">Opponent<input value={draft.opponent} onChange={(e) => change({ ...draft, opponent: e.target.value })} /></label>
        </div>
      )}
      {canFix && <div className="muted tiny">Tap a score, or the blank cell below a column to add a throw, then tap the new scores one after another.</div>}
      {draft.sets.map((set) => (
        <div key={set.id} className="col gap4">
          <ScoreSheet set={set} names={names} action={deleteGame(set)}
            selected={cursor?.setId === set.id ? cursor : undefined}
            onThrow={canFix ? (recordId) => select({ setId: set.id, recordId }) : undefined}
            onAdd={canFix ? (team, player) => select({ setId: set.id, team, player }) : undefined} />
          {canFix && firstPicker(set)}
          {canFix && winnerPicker(set)}
        </div>
      ))}
      <div className="spacer" />
      <button className={armed === 'match' ? 'danger' : 'ghost warn-text'} onClick={() => (armed === 'match' ? remove() : setArmed('match'))}>
        {armed === 'match' ? (match.remoteBy ? 'Delete for everyone' : 'Really delete this match') : isPracticeGame(match) ? 'Delete this game' : 'Delete this match'}
      </button>
      {armed === 'match' && match.remoteBy && (
        <div className="warn-text tiny">Recorded on {match.remoteBy}'s phone. Deleting removes it for everyone.</div>
      )}
      {cursor && (
        <>
          <div className="pad-room" />
          <EditPad match={draft} cursor={cursor} names={names} late={late} onScore={tapScore}
            onPlayer={(p) => ('recordId' in cursor ? change(applyPlayer(draft, cursor, p)) : setCursor({ ...cursor, player: p }))}
            onFirst={() => {
              if ('team' in cursor) change(applyFirst(draft, cursor.setId, cursor.team));
              setLate(false);
            }}
            onClose={() => setCursor(null)} />
        </>
      )}
    </div>
  );
}
