// Review: key numbers for the team and chosen players, and their trend over dates.
import { useState, type CSSProperties } from 'react';
import { type DerivedThrow } from '../rules';
import { KPIS, ourThrows, pct, type Kpi } from '../stats';
import { tournamentKey, type Match } from '../store';
import { type Go } from '../ui';
import { SERIES_COLORS, TEAM_COLOR, TrendChart } from '../components/TrendChart';

const kpiFmt = (k: Kpi, v: number, digits = 0) => (k.num ? (Number.isNaN(v) ? '—' : v.toFixed(1)) : pct(v, digits));

/** A player is flagged when this far from the team, on at least MIN_N throws. */
const kpiGap = (k: Kpi) => (k.num ? 0.5 : 0.05);

const MIN_N = 5;

/**
 * Review of tournaments and practice alike: pick the team and any players once; the KPI table and
 * the trend both follow. Each tournament or practice session is one point in time.
 * ▼ marks where a player is clearly below the team — the individual's focus.
 */
function ReviewBody({ matches }: { matches: Match[] }) {
  const [period, setPeriod] = useState<string>('');
  const [showTeam, setShowTeam] = useState(true);
  const [picked, setPicked] = useState<{ name: string; slot: number }[]>([]);
  const [kpiKey, setKpiKey] = useState('hit');

  const groups = new Map<string, Match[]>();
  for (const m of [...matches].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = tournamentKey(m);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const tours = [...groups].map(([key, ms]) => ({
    key,
    practice: ms[0].kind === 'practice',
    label: `${ms[0].date.slice(5)} ${ms[0].tournament || (ms[0].kind === 'practice' ? 'Practice' : '(no name)')}`,
    matches: ms.length,
    games: ms.reduce((a, m) => a + m.sets.length, 0),
    rows: ms.flatMap(ourThrows),
  }));
  if (tours.length === 0) return <div className="muted">Nothing recorded yet.</div>;

  // Players, most throws first.
  const counts = new Map<string, number>();
  tours.flatMap((t) => t.rows).forEach((r) => r.player && counts.set(r.player, (counts.get(r.player) ?? 0) + 1));
  const players = [...counts].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  const togglePlayer = (p: string) => {
    if (picked.some((x) => x.name === p)) setPicked(picked.filter((x) => x.name !== p));
    else if (picked.length < SERIES_COLORS.length) {
      const used = new Set(picked.map((x) => x.slot));
      setPicked([...picked, { name: p, slot: SERIES_COLORS.findIndex((_, k) => !used.has(k)) }]);
    }
  };
  const lines = [
    ...(showTeam ? [{ name: 'Team', color: TEAM_COLOR, dashed: true, only: (_: DerivedThrow) => true }] : []),
    ...picked.map(({ name, slot }) => ({ name, color: SERIES_COLORS[slot], dashed: false, only: (r: DerivedThrow) => r.player === name })),
  ];
  const swatch = (l: { color: string; dashed: boolean }) => <span className={`swatch ${l.dashed ? 'dashed' : ''}`} style={{ '--c': l.color } as CSSProperties} />;

  const current = tours.some((t) => t.key === period) ? period : '';
  const inPeriod = current ? tours.filter((t) => t.key === current) : tours;
  const periodRows = inPeriod.flatMap((t) => t.rows);
  const selIdx = current ? tours.findIndex((t) => t.key === current) : null;
  const kpi = KPIS.find((k) => k.key === kpiKey) ?? KPIS[0];

  const trendValues = (only: (r: DerivedThrow) => boolean) => tours.map((t) => kpi.pick(t.rows.filter(only)).v);
  const allValues = lines.flatMap((l) => trendValues(l.only)).filter((v) => !Number.isNaN(v));
  const domain: [number, number] = kpi.num
    ? [0, Math.max(6, Math.ceil(Math.max(...allValues, 0) / 2) * 2)]
    : kpi.key === 'finish' ? [0, 1] : [Math.min(0.5, Math.floor(Math.min(...allValues, 1) * 10) / 10), 1];

  return (
    <>
      <div className="card col">
        <div className="chips">
          <button className={`chip ${showTeam ? 'on-series' : ''}`} style={{ '--c': TEAM_COLOR } as CSSProperties} onClick={() => setShowTeam(!showTeam)}>Team</button>
          {players.map((p) => {
            const pk = picked.find((x) => x.name === p);
            return (
              <button key={p} className={`chip ${pk ? 'on-series' : ''}`} style={pk ? ({ '--c': SERIES_COLORS[pk.slot] } as CSSProperties) : undefined}
                disabled={!pk && picked.length >= SERIES_COLORS.length} onClick={() => togglePlayer(p)}>
                {p}
              </button>
            );
          })}
        </div>
        <select value={current} onChange={(e) => setPeriod(e.target.value)}>
          <option value="">All dates</option>
          {[...tours].reverse().map((t) => <option key={t.key} value={t.key}>{t.label}{t.practice ? ' (practice)' : ''}</option>)}
        </select>
        <div className="muted tiny">
          {inPeriod.reduce((a, t) => a + t.games, 0)} games · {periodRows.length} throws
        </div>
      </div>

      {lines.length === 0 ? <div className="muted">Pick Team or players.</div> : (
        <>
          <div className="card col">
            <div className="strong">Key numbers{current ? ` · ${tours[selIdx ?? 0].label}` : ''}</div>
            <div className="table-scroll">
              <table className="kpi">
                <thead>
                  <tr><th />{lines.map((l) => <th key={l.name} className="nowrap">{swatch(l)} {l.name}</th>)}</tr>
                </thead>
                <tbody>
                  {KPIS.map((k) => {
                    const team = k.pick(periodRows);
                    return (
                      <tr key={k.key} className={k.key === kpiKey ? 'on' : ''} onClick={() => setKpiKey(k.key)}>
                        <td>
                          <div>{k.label}</div>
                          <div className="muted tiny">{k.note}</div>
                        </td>
                        {lines.map((l) => {
                          const { v, n } = k.pick(periodRows.filter(l.only));
                          const isTeam = l.name === 'Team';
                          const diff = v - team.v;
                          const low = !isTeam && n >= MIN_N && diff <= -kpiGap(k);
                          const high = !isTeam && n >= MIN_N && diff >= kpiGap(k);
                          return (
                            <td key={l.name} className={low ? 'low' : high ? 'high' : ''}>
                              <span className="strong nowrap">{kpiFmt(k, v)}{low && '▼'}{high && '▲'}</span>
                              <div className="muted tiny">{n}</div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="muted tiny">
              Small figure = throws counted. ▼ / ▲ = {'≥'}5 points (0.5 for avg score) below / above the team, on {MIN_N}+ throws. Tap a row to see its trend.
            </div>
          </div>

          <div className="card col">
            <div className="strong">Trend</div>
            {/* Headline measures on the first row, situational hit rates below. */}
            {[['hit', 'avg', 'finish'], ['afterMiss', 'mid', 'zone']].map((row) => (
              <div key={row[0]} className="chips">
                {row.map((key) => KPIS.find((k) => k.key === key)!).map((k) => (
                  <button key={k.key} className={`chip ${k.key === kpiKey ? 'on' : ''}`} onClick={() => setKpiKey(k.key)}>{k.label}</button>
                ))}
              </div>
            ))}
            <div className="muted tiny">{kpi.label}: {kpi.note}</div>
            <TrendChart
              title={kpi.label}
              labels={tours.map((t) => t.label)}
              hollow={tours.some((t) => !t.practice) ? tours.map((t) => t.practice) : undefined}
              series={lines.map((l) => ({ name: l.name, color: l.color, dashed: l.dashed, values: trendValues(l.only) }))}
              fmt={(v) => kpiFmt(kpi, v, 1)} tick={(v) => (kpi.num ? v.toFixed(0) : pct(v, 0))}
              domain={domain}
              sel={selIdx} onSelect={(i) => setPeriod(tours[i].key)}
            />
            <div className="muted tiny">One point per tournament or practice day{tours.some((t) => t.practice) && tours.some((t) => !t.practice) ? ' (open circles = practice)' : ''}. Tap a point to show it in Key numbers; choose "All dates" above to go back.</div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Date</th>{lines.map((l) => <th key={l.name} className="nowrap">{swatch(l)} {l.name}</th>)}</tr></thead>
                <tbody>
                  {[...tours].reverse().map((t) => (
                    <tr key={t.key}>
                      <td>{t.label}{t.practice && <div className="muted tiny">Practice</div>}</td>
                      {lines.map((l) => {
                        const { v, n } = kpi.pick(t.rows.filter(l.only));
                        return <td key={l.name}>{kpiFmt(kpi, v)}<div className="muted tiny">{n}</div></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export function Review({ matches: all, go }: { matches: Match[]; go: Go }) {
  const [filter, setFilter] = useState<'all' | 'tournament' | 'practice'>('all');
  const matches = all.filter((m) => filter === 'all' || m.kind === filter);
  return (
    <div className="screen">
      <header className="head">
        <button className="back" onClick={() => go({ name: 'home' })}>← Back</button>
        <h1>Review</h1>
      </header>
      <div className="seg">
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
        <button className={filter === 'tournament' ? 'on' : ''} onClick={() => setFilter('tournament')}>Tournaments</button>
        <button className={filter === 'practice' ? 'on' : ''} onClick={() => setFilter('practice')}>Practice</button>
      </div>
      <ReviewBody matches={matches} />
    </div>
  );
}
