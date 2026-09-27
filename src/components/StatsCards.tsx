// Stat cards for a game or match: our team's headline numbers and per-player tables.
import { avgOf, finishers, hitOf, pct, throwsOf } from '../stats';
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
  const ours = throwsOf(sets, 'us');
  const avg = avgOf(ours).v;
  const fin = finishers(ours).map(([p, n]) => `${p} ×${n}`);
  return (
    <div className="card col">
      <div className="strong">{title}</div>
      <div className="grid2">
        <Stat label="Finisher" value={fin.length === 0 ? '—' : fin.join(', ')} />
        <Stat label="Throws" value={String(ours.length)} />
        <Stat label="Avg per throw" value={Number.isNaN(avg) ? '—' : avg.toFixed(1)} />
        <Stat label="Miss rate" value={pct(1 - hitOf(ours).v)} />
      </div>
    </div>
  );
}

/** Every player's headline stats over the given games (practice). */
export function PlayersCard({ title, sets }: { title: string; sets: SetEntry[] }) {
  const rows = throwsOf(sets, null).filter((r) => r.player);
  const players = [...new Set(rows.map((r) => r.player as string))];
  return (
    <div className="card col">
      <div className="strong">{title}</div>
      <table>
        <thead><tr><th>Player</th><th>Throws</th><th>Avg</th><th>Miss</th><th>Finish</th></tr></thead>
        <tbody>
          {players.map((p) => {
            const mine = rows.filter((r) => r.player === p);
            return (
              <tr key={p}>
                <td>{p}</td>
                <td>{mine.length}</td>
                <td>{avgOf(mine).v.toFixed(1)}</td>
                <td>{pct(1 - hitOf(mine).v, 0)}</td>
                <td>{mine.filter((r) => r.event === 'Finish').length}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
