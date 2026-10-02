// Stat cards for a game or match: a side's headline numbers.
import { KPIS, avgOf, finishers, hitOf, pct, throwsOf } from '../stats';
import { type SideId } from '../rules';
import { type SetEntry } from '../store';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="muted tiny">{label}</div>
      <div className="strong">{value}</div>
    </div>
  );
}

/** One side's headline stats over the given games: our team in tournaments, any side in practice. */
export function TeamStatsCard({ title, sets, team = 'us' }: { title: string; sets: SetEntry[]; team?: SideId }) {
  const ours = throwsOf(sets, team);
  const avg = avgOf(ours).v;
  const fin = finishers(ours).map(([p, n]) => `${p} ×${n}`);
  const zone = KPIS.find((k) => k.key === 'zone')!.pick(ours);
  const hit = hitOf(ours);
  // Few throws in one game, so rates also show the counts behind them.
  const rate = (v: number, k: number, n: number, digits = 1) => (n === 0 ? '—' : `${pct(v, digits)} (${k}/${n})`);
  return (
    <div className="card col">
      <div className="strong">{title}</div>
      {/* Same order as Key numbers in Review, then who finished. */}
      <div className="grid2">
        <Stat label="Hit rate" value={rate(hit.v, Math.round(hit.v * hit.n), hit.n)} />
        <Stat label="Avg per throw" value={Number.isNaN(avg) ? '—' : avg.toFixed(1)} />
        <Stat label="Finishing zone" value={rate(zone.v, Math.round(zone.v * zone.n), zone.n, 0)} />
        <Stat label="Finish" value={fin.length === 0 ? '—' : fin.join(', ')} />
      </div>
    </div>
  );
}
