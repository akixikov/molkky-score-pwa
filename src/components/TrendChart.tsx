// Line chart of one measure across dates, one series per team or player.
import { useEffect, useRef, useState, type CSSProperties } from 'react';

/** Player line colours in fixed order (validated palette); a slot is kept while the player stays selected. */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

/** The team is a dark dashed reference line, distinct from every player colour. */
export const TEAM_COLOR = '#3d3c39';

export interface TrendSeries { name: string; color: string; dashed?: boolean; values: number[] }

/**
 * One measure across dates (tournaments and practice days), oldest on the left, one line per series.
 * Nothing is highlighted until a point is tapped; then every series is read out for that date.
 */
export function TrendChart({ title, labels, hollow, series, fmt, tick, domain, sel, onSelect }: {
  title: string; labels: string[]; series: TrendSeries[];
  /** Points drawn as open circles (practice days among tournaments). */
  hollow?: boolean[];
  fmt: (v: number) => string; tick: (v: number) => string; domain: [number, number];
  /** Selected date index, shared by the charts of one card. */
  sel: number | null; onSelect: (i: number) => void;
}) {
  const n = labels.length;
  // Drawn at real pixel size: the y-axis stays put while the plot scrolls sideways once
  // the dates no longer fit (every date keeps a vertical label).
  const AXIS = 34, PAD = 12, T = 8, PLOT_H = 76, LABEL_H = 78, MIN_SLOT = 24;
  const H = T + PLOT_H + LABEL_H;
  const wrap = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(280);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth - AXIS));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    // Open at the newest (right) end.
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [n, avail]);
  const PW = Math.max(avail, PAD * 2 + (n - 1) * MIN_SLOT);
  const x = (i: number) => (n === 1 ? PW / 2 : PAD + (i * (PW - PAD * 2)) / (n - 1));
  const y = (v: number) => T + (1 - (v - domain[0]) / (domain[1] - domain[0])) * PLOT_H;
  const ticks = [domain[0], (domain[0] + domain[1]) / 2, domain[1]];
  // Labels are cut to fit the label area; full-width (e.g. Japanese) characters count double.
  const short = (t: string) => {
    let w = 0;
    for (let i = 0; i < t.length; i++) {
      w += t.charCodeAt(i) > 0xff ? 2 : 1;
      if (w > 12) return `${t.slice(0, i)}…`;
    }
    return t;
  };
  const validOf = (vs: number[]) => vs.map((value, i) => ({ value, i })).filter((p) => !Number.isNaN(p.value));
  // Missing values (e.g. a player who skipped a tournament) break the line.
  const pathOf = (v: { i: number; value: number }[]) =>
    v.map((p, k) => `${k && v[k - 1].i === p.i - 1 ? 'L' : 'M'}${x(p.i)},${y(p.value)}`).join(' ');
  // Nothing is highlighted while "All dates" is chosen; tapping a point picks that date.
  const shown = sel;
  const slot = n > 1 ? (PW - PAD * 2) / (n - 1) : PW;
  return (
    <div className="trend">
      <div className="strong">{title}</div>
      {shown === null && <div className="readout muted tiny">Tap a point to see each date.</div>}
      {shown !== null && (
        <div className="readout muted tiny">
          <span>{labels[shown]}:</span>
          {series.map((sr) => (
            <span key={sr.name}>
              <span className={`swatch ${sr.dashed ? 'dashed' : ''}`} style={{ '--c': sr.color } as CSSProperties} /> {sr.name}{' '}
              <span className="strong">{Number.isNaN(sr.values[shown]) ? '—' : fmt(sr.values[shown])}</span>
            </span>
          ))}
        </div>
      )}
      <div className="trend-plot" ref={wrap}>
        <svg width={AXIS} height={H} aria-hidden>
          {ticks.map((v) => <text key={v} className="tick" x={AXIS - 6} y={y(v)}>{tick(v)}</text>)}
        </svg>
        <div className="trend-scroll" ref={scroller}>
          <svg width={PW} height={H} role="img" aria-label={`${title} by date`}>
            {ticks.map((v) => <line key={v} className="grid" x1={0} x2={PW} y1={y(v)} y2={y(v)} />)}
            {series.map((sr) => {
              const v = validOf(sr.values);
              return (
                <g key={sr.name} style={{ '--c': sr.color } as CSSProperties}>
                  <path className={`line ${sr.dashed ? 'dashed' : ''}`} d={pathOf(v)} />
                  {v.map((p) => <circle key={p.i} className={`dot ${hollow?.[p.i] ? 'open' : ''}`} cx={x(p.i)} cy={y(p.value)} r={p.i === shown ? 5 : 3.5} />)}
                </g>
              );
            })}
            {labels.map((l, i) => (
              <text key={i} className={`xlab ${i === shown ? 'on' : ''}`} transform={`translate(${x(i) + 4},${T + PLOT_H + 6}) rotate(-90)`} textAnchor="end">
                {short(l)}
              </text>
            ))}
            {labels.map((_, i) => (
              <rect key={i} className="hit" x={x(i) - slot / 2} y={0} width={slot} height={H} onClick={() => onSelect(i)} onMouseEnter={() => onSelect(i)} />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}
