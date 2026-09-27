// Local persistence (IndexedDB via idb-keyval) and exports.
import { get, set } from 'idb-keyval';
import { deriveSet, type SetConfig, type SideId, type ThrowRecord } from './rules';

export type MatchKind = 'tournament' | 'practice';

export interface SetEntry {
  id: string;
  setNo: number;
  config: SetConfig;
  records: ThrowRecord[];
  /** Winner decided outside the rules (time limit, judge). */
  manualWinner?: SideId;
  closed: boolean;
}

export interface Match {
  id: string;
  date: string;
  tournament: string;
  opponent: string;
  /** Our team's name. Missing in older records. */
  ourTeam?: string;
  kind: MatchKind;
  sets: SetEntry[];
  /** Last local change (ms). Used by team sync. */
  updatedAt?: number;
}

export interface AppData {
  version: 1;
  roster: string[];
  matches: Match[];
}

const KEY = 'molkky-data-v1';

export const emptyData = (): AppData => ({ version: 1, roster: [], matches: [] });

export async function loadData(): Promise<AppData> {
  try {
    return (await get<AppData>(KEY)) ?? emptyData();
  } catch {
    return emptyData();
  }
}

export async function saveData(data: AppData): Promise<void> {
  await set(KEY, data);
  // Ask the browser not to evict our data under storage pressure.
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}

/** Stamps updatedAt on every match that changed (by identity) between two versions of the data. */
export function stampChanged(prev: AppData, next: AppData): AppData {
  const before = new Map(prev.matches.map((m) => [m.id, m]));
  const now = Date.now();
  return { ...next, matches: next.matches.map((m) => (before.get(m.id) === m ? m : { ...m, updatedAt: now })) };
}

/** Groups matches of one tournament: same date, name and kind. */
export const tournamentKey = (m: Pick<Match, 'date' | 'tournament' | 'kind'>) => `${m.date}|${m.tournament}|${m.kind}`;

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function setWinner(s: SetEntry): SideId | null {
  return s.manualWinner ?? deriveSet(s.config, s.records).winner;
}

const esc = (v: unknown) => {
  const x = String(v ?? '');
  return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
};

/** Columns of the team spreadsheet's Throws sheet (must match THROW_COLUMNS in apps-script/Code.gs). */
export const SHEET_COLUMNS = [
  'MatchID', 'SetID', 'Date', 'Tournament', 'Kind', 'Opponent', 'SetNo', 'FirstTeam', 'ThrowNo', 'Team',
  'TeamThrowNo', 'Player', 'Pins', 'Score', 'Before', 'After', 'Event', 'FaultStreakBefore', 'SetWinner',
  'ThrowID', 'SideName',
] as const;
export type ThrowRow = Record<(typeof SHEET_COLUMNS)[number], string | number>;

/** One row per throw with every derived column; shared by the CSV export and team sync. */
export function rowsForMatch(m: Match): ThrowRow[] {
  return m.sets.flatMap((s) => {
    const d = deriveSet(s.config, s.records);
    const w = setWinner(s) ?? '';
    const sideName = (id: SideId) => d.order.find((x) => x.id === id)?.name ?? id;
    return d.rows.map((r, i) => ({
      MatchID: m.id, SetID: s.id, Date: m.date, Tournament: m.tournament, Kind: m.kind, Opponent: m.opponent,
      SetNo: s.setNo, FirstTeam: s.config.firstTeam, ThrowNo: i + 1, Team: r.team, TeamThrowNo: r.teamIdx,
      Player: r.player ?? '', Pins: r.pins?.join(' ') ?? '', Score: r.score, Before: r.before, After: r.after,
      Event: r.event, FaultStreakBefore: r.faultStreak, SetWinner: w, ThrowID: r.id, SideName: sideName(r.team),
    }));
  });
}

const CSV_COLUMNS = SHEET_COLUMNS.filter((c) => c !== 'MatchID' && c !== 'SetID');

/** One row per throw, with every derived column, for Sheets or pandas. */
export function toCsv(data: AppData): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of data.matches.flatMap(rowsForMatch)) lines.push(CSV_COLUMNS.map((c) => esc(r[c])).join(','));
  return '\ufeff' + lines.join('\n') + '\n';
}

export function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
