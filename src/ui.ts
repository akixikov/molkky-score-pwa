// Screen routing types and small helpers shared by the screens.
import { type SetState, type SideId } from './rules';
import { type AppData, type Match, type SetEntry } from './store';

export type Screen =
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'practice' }
  | { name: 'play'; matchId: string }
  | { name: 'match'; matchId: string }
  | { name: 'review' }
  | { name: 'sync' };

export const today = () => new Date().toLocaleDateString('sv-SE');

export type Names = Record<SideId, string>;

/** Team names, falling back to generic labels when not entered. */
export const namesOf = (ourTeam: string | undefined, opponent: string): Names => ({ us: ourTeam || 'Us', them: opponent || 'Them' });

/** Practice games list every side (2–6); tournament games are us vs them. */
export const isPracticeGame = (m: Match) => !!m.sets[0]?.config.sides;

/** Side names: team names in tournament games, side names in practice games. */
export const teamNames = (m: Match): Names => {
  const sides = m.sets[0]?.config.sides;
  return sides ? Object.fromEntries(sides.map((x) => [x.id, x.name])) : namesOf(m.ourTeam, m.opponent);
};

/** Names of sides disqualified in a game, for end-of-game labels. */
export const dqNames = (st: SetState, names: Names) => st.order.filter((x) => st.teams[x.id].eliminated).map((x) => names[x.id]).join(', ');

export type Update = (fn: (d: AppData) => AppData) => void;

export type Go = (s: Screen) => void;

export function patchMatch(d: AppData, id: string, fn: (m: Match) => Match): AppData {
  return { ...d, matches: d.matches.map((m) => (m.id === id ? fn(m) : m)) };
}

export function patchCurrentSet(m: Match, fn: (s: SetEntry) => SetEntry): Match {
  const sets = [...m.sets];
  sets[sets.length - 1] = fn(sets[sets.length - 1]);
  return { ...m, sets };
}

/** Colour class of a side: our team, the opponent, or a practice side. */
export const sideClass = (id: SideId) => (id === 'us' || id === 'them' ? id : 'side');
