// Edit mode for a match: changes collect in a draft and are saved together.
import { deriveSet, inTurnOrder, playableLength, type SideId, type ThrowRecord } from './rules';
import { uid, type Match, type SetEntry } from './store';

/** The selected cell: a recorded throw, or the next throw of a side (its blank cell). */
export type Cursor = { setId: string; recordId: string } | { setId: string; team: SideId; player?: string };

const patchSet = (m: Match, setId: string, fn: (s: SetEntry) => SetEntry): Match => ({ ...m, sets: m.sets.map((s) => (s.id === setId ? fn(s) : s)) });

/** Throws recorded for a side (shown or not). */
const recorded = (s: SetEntry, team: SideId) => s.records.filter((r) => r.team === team).length;

/** Next thrower of a side by its lineup, when it has one. */
export function nextPlayer(s: SetEntry, team: SideId): string | undefined {
  const lineup = deriveSet(s.config, s.records).order.find((x) => x.id === team)?.lineup ?? [];
  return lineup.length > 0 ? lineup[recorded(s, team) % lineup.length] : undefined;
}

/** Records with a throw added at the end of its side's column. */
const withThrow = (s: SetEntry, rec: ThrowRecord) => inTurnOrder(s.config, [...s.records, rec]);

/** A throw added there would still count: the game is not over before it. */
const counts = (s: SetEntry, rec: ThrowRecord) => deriveSet(s.config, withThrow(s, rec)).rows.some((r) => r.id === rec.id);

/** The side can take another throw at the end of its column (the game is not over before it). */
export const canAdd = (s: SetEntry, team: SideId): boolean => counts(s, { id: '?', team, score: 0, ts: 0 });

/**
 * The side's blank cell takes a throw: it would count, or would if the side had thrown first
 * (the pad then offers to switch, for games recorded without who threw first).
 */
export const canOffer = (s: SetEntry, team: SideId): boolean => canAdd(s, team) || addsIfFirst(s, team);

/** The cell after this one in the same side's column: its next throw, else its blank cell. */
function below(s: SetEntry, team: SideId, after?: string): Cursor | null {
  const col = s.records.filter((r) => r.team === team);
  const i = after ? col.findIndex((r) => r.id === after) : -1;
  if (after && i >= 0 && i + 1 < col.length) return { setId: s.id, recordId: col[i + 1].id };
  return canOffer(s, team) ? { setId: s.id, team, player: nextPlayer(s, team) } : null;
}

/**
 * Puts a score in the selected cell and moves down the same side's column, so a column is filled
 * by tapping scores one after another. `late`: an added throw would come after the game is over.
 */
export function applyScore(m: Match, cur: Cursor, score: number): { match: Match; next: Cursor | null; late?: boolean } {
  const set = m.sets.find((s) => s.id === cur.setId);
  if (!set) return { match: m, next: null };
  if ('recordId' in cur) {
    const rec = set.records.find((r) => r.id === cur.recordId);
    if (!rec) return { match: m, next: null };
    const match = patchSet(m, set.id, (s) => ({ ...s, records: s.records.map((r) => (r.id === rec.id ? { ...r, score } : r)) }));
    return { match, next: below(match.sets.find((s) => s.id === set.id)!, rec.team, rec.id) };
  }
  const rec: ThrowRecord = { id: uid(), team: cur.team, ...(cur.player ? { player: cur.player } : {}), score, ts: Date.now() };
  if (!counts(set, rec)) return { match: m, next: cur, late: true };
  const match = patchSet(m, set.id, (s) => ({ ...s, records: withThrow(s, rec) }));
  return { match, next: below(match.sets.find((s) => s.id === set.id)!, cur.team) };
}

/** Changes who threw the selected throw. */
export const applyPlayer = (m: Match, cur: Cursor & { recordId: string }, player: string): Match =>
  patchSet(m, cur.setId, (s) => ({ ...s, records: s.records.map((r) => (r.id === cur.recordId ? { ...r, player } : r)) }));

/**
 * Changes which side threw first in a game (often unknown in imported records) and puts the throws
 * back in turn order for it, which decides who reached 50 first.
 */
export const applyFirst = (m: Match, setId: string, team: SideId): Match => patchSet(m, setId, (s) => withFirst(s, team));

function withFirst(s: SetEntry, team: SideId): SetEntry {
  const config = { ...s.config, firstTeam: team };
  return { ...s, config, records: inTurnOrder(config, s.records) };
}

/** Making this side throw first would let it take another throw (the game is not over before it then). */
export const addsIfFirst = (s: SetEntry, team: SideId): boolean => s.config.firstTeam !== team && canAdd(withFirst(s, team), team);

/** Sets or clears ('') a game's winner decided outside the throws. */
export const applyWinner = (m: Match, setId: string, w: string): Match =>
  patchSet(m, setId, (s) => ({ ...s, manualWinner: w || undefined, closed: true }));

/** Removes one game and renumbers the rest. */
export const removeGame = (m: Match, setId: string): Match =>
  ({ ...m, sets: m.sets.filter((s) => s.id !== setId).map((s, i) => ({ ...s, setNo: i + 1 })) });

/**
 * The draft as it will be saved. A change that ends a game earlier (or disqualifies a side sooner)
 * leaves later throws out of turn; those are dropped, and counted so the user can confirm first.
 * Games that were out of turn before the edit (e.g. imported without opponent throws) keep everything.
 */
export function finalize(original: Match, draft: Match): { match: Match; dropped: number } {
  let dropped = 0;
  const sets = draft.sets.map((s) => {
    const before = original.sets.find((x) => x.id === s.id);
    const fits = playableLength(s.config, s.records);
    if (!before || fits >= playableLength(before.config, before.records)) return s;
    dropped += s.records.length - fits;
    return { ...s, records: s.records.slice(0, fits) };
  });
  return { match: { ...draft, sets }, dropped };
}
