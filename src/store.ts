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

/** One row per throw, with every derived column, for Sheets or pandas. */
export function toCsv(data: AppData): string {
  const head = [
    'Date', 'Tournament', 'Kind', 'Opponent', 'SetNo', 'FirstTeam', 'ThrowNo', 'Team', 'TeamThrowNo',
    'Player', 'Pins', 'Score', 'Before', 'After', 'Event', 'FaultStreakBefore', 'SetWinner', 'ThrowID', 'SideName',
  ];
  const lines = [head.join(',')];
  for (const m of data.matches) {
    for (const s of m.sets) {
      const d = deriveSet(s.config, s.records);
      const w = setWinner(s) ?? '';
      const sideName = (id: SideId) => d.order.find((x) => x.id === id)?.name ?? id;
      d.rows.forEach((r, i) => {
        lines.push(
          [
            m.date, m.tournament, m.kind, m.opponent, s.setNo, s.config.firstTeam, i + 1, r.team, r.teamIdx,
            r.player ?? '', r.pins?.join(' ') ?? '', r.score, r.before, r.after, r.event, r.faultStreak, w, r.id, sideName(r.team),
          ].map(esc).join(','),
        );
      });
    }
  }
  return '﻿' + lines.join('\n') + '\n';
}

export function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
