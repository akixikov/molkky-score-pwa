// Stat cards for a game or match: our team's headline numbers and per-player tables.
import { deriveSet } from '../rules';
import { pct, teamStats } from '../stats';
import { type SetEntry } from '../store';

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="muted tiny">{label}</div>
      <div className="strong">{value}</div>
    </div>
  );
}

/** Our team's headline stats over the given games. */
export function TeamStatsCard({ title, sets }: { title: string; sets: SetEntry[] }) {
  const s = teamStats(sets);
  const ours = sets.flatMap((set) => deriveSet(set.config, set.records).rows.filter((r) => r.team === 'us'));
  const avg = ours.length === 0 ? '—' : (ours.reduce((a, r) => a + r.score, 0) / ours.length).toFixed(1);
  // Our players who reached exactly 50, with how many times.
  const finishCount = new Map<string, number>();
  ours.filter((r) => r.event === 'Finish').forEach((r) => finishCount.set(r.player ?? '', (finishCount.get(r.player ?? '') ?? 0) + 1));
  const finishers = [...finishCount].map(([p, n]) => `${p} ×${n}`);
  return (
    <div className="card col">
      <div className="strong">{title}</div>
      <div className="grid2">
        <Stat label="Finisher" value={finishers.length === 0 ? '—' : finishers.join(', ')} />
        <Stat label="Throws" value={String(s.throws)} />
        <Stat label="Avg per throw" value={avg} />
        <Stat label="Miss rate" value={pct(s.overall.fault)} />
      </div>
    </div>
  );
}

/** Every player's headline stats over the given games (practice). */
export function PlayersCard({ title, sets }: { title: string; sets: SetEntry[] }) {
  const rows = sets.flatMap((set) => deriveSet(set.config, set.records).rows.filter((r) => r.player));
  const players = [...new Set(rows.map((r) => r.player as string))];
  return (
    <div className="card col">
      <div className="strong">{title}</div>
      <table>
        <thead><tr><th>Player</th><th>Throws</th><th>Avg</th><th>Miss</th><th>Finish</th></tr></thead>
        <tbody>
          {players.map((p) => {
            const mine = rows.filter((r) => r.player === p);
            const misses = mine.filter((r) => r.score === 0).length;
            return (
              <tr key={p}>
                <td>{p}</td>
                <td>{mine.length}</td>
                <td>{(mine.reduce((a, r) => a + r.score, 0) / mine.length).toFixed(1)}</td>
                <td>{pct(misses / mine.length, 0)}</td>
                <td>{mine.filter((r) => r.event === 'Finish').length}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
