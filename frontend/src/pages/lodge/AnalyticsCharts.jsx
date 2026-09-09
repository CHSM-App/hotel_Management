import { formatPrice } from './priceFormat';

// Small reusable chart primitives shared by the analytics sections across
// Overview, Bookings, Events and Food orders — kept framework-free (plain
// inline SVG) so they read the same way the rest of this app's charts would
// if it had any, and carry no extra dependency.

const CHART_COLORS = {
  room: 'var(--brand)',
  function: 'var(--accent)',
  food: '#2FA0A0',
};

// A day-by-day line, drawn to whatever min/max the data actually reaches —
// never a hardcoded scale, so a slow week doesn't draw as a flat line pinned
// to the top of a chart sized for a busy one.
export function TrendChart({ points, priorPoints, height = 220, valueKey = 'totalRevenue', formatValue = formatPrice }) {
  const width = 720;
  const padLeft = 50;
  const padRight = 12;
  const padTop = 16;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const values = points.map((p) => Number(p[valueKey]) || 0);
  const priorValues = priorPoints ? priorPoints.map((p) => Number(p[valueKey]) || 0) : [];
  const maxValue = Math.max(1, ...values, ...priorValues);

  const x = (i, count) => padLeft + (count <= 1 ? 0 : (i / (count - 1)) * plotW);
  const y = (v) => padTop + plotH - (v / maxValue) * plotH;

  const linePath = (vals) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i, vals.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const areaPath = (vals) => `${linePath(vals)} L${x(vals.length - 1, vals.length).toFixed(1)},${(padTop + plotH).toFixed(1)} L${x(0, vals.length).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;

  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  const lastValue = values[values.length - 1] ?? 0;
  const firstLabel = points[0]?.date;
  const midLabel = points[Math.floor((points.length - 1) / 2)]?.date;
  const lastLabel = points[points.length - 1]?.date;

  const fmtAxisDate = (iso) => {
    if (!iso) return '';
    const d = new Date(`${iso}T00:00:00Z`);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Line chart of daily ${valueKey} across the selected period, reaching ${formatValue(lastValue)} on the final day`}
      style={{ width: '100%', height: 'auto', overflow: 'visible' }}
    >
      <g className="axis-line" strokeWidth="1">
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + plotH} />
        <line x1={padLeft} y1={padTop + plotH} x2={width - padRight} y2={padTop + plotH} />
        {gridLines.slice(1, -1).map((g) => (
          <line
            key={g}
            x1={padLeft}
            y1={padTop + plotH * (1 - g)}
            x2={width - padRight}
            y2={padTop + plotH * (1 - g)}
            strokeDasharray="2 4"
          />
        ))}
      </g>
      {gridLines.map((g) => (
        <text key={g} x={padLeft - 6} y={padTop + plotH * (1 - g) + 3} textAnchor="end" fontSize="10">
          {formatValue(Math.round(maxValue * g))}
        </text>
      ))}
      <text x={padLeft} y={height - 6} fontSize="10">{fmtAxisDate(firstLabel)}</text>
      {points.length > 2 && (
        <text x={x((points.length - 1) / 2, points.length)} y={height - 6} textAnchor="middle" fontSize="10">
          {fmtAxisDate(midLabel)}
        </text>
      )}
      <text x={width - padRight} y={height - 6} textAnchor="end" fontSize="10">{fmtAxisDate(lastLabel)}</text>

      {priorValues.length > 1 && (
        <path d={linePath(priorValues)} fill="none" stroke="var(--chart-grid, var(--border))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      )}

      <path d={areaPath(values)} fill="var(--brand-wash)" stroke="none" opacity="0.6" />
      <path d={linePath(values)} fill="none" stroke="var(--brand)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
      {values.length > 0 && (
        <>
          <circle cx={x(values.length - 1, values.length)} cy={y(lastValue)} r="4" fill="var(--brand)" />
          <text x={x(values.length - 1, values.length) - 6} y={y(lastValue) - 8} textAnchor="end" fontSize="11" fontWeight="700" fill="var(--ink)">
            {formatValue(lastValue)}
          </text>
        </>
      )}
    </svg>
  );
}

// A donut built from an ordered list of {label, value} slices. Percentages
// are derived from the values themselves rather than trusted from the
// caller, so the arcs always foot to 360 degrees exactly once.
export function Donut({ slices, size = 160, strokeWidth = 24, centerLabel, centerSub }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const { arcs } = slices
    .filter((s) => s.value > 0)
    .reduce(
      (acc, s) => {
        const frac = total > 0 ? s.value / total : 0;
        const dash = frac * circumference;
        acc.arcs.push({ ...s, dash, gap: circumference - dash, offset: acc.offset });
        acc.offset += dash;
        return acc;
      },
      { arcs: [], offset: 0 }
    );

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={`Donut chart: ${slices.map((s) => `${s.label} ${total > 0 ? Math.round((s.value / total) * 100) : 0} percent`).join(', ')}`}
    >
      <g transform={`translate(${size / 2},${size / 2}) rotate(-90)`}>
        {arcs.map((a) => (
          <circle
            key={a.label}
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${a.dash} ${a.gap}`}
            strokeDashoffset={-a.offset}
          />
        ))}
      </g>
      {centerLabel && (
        <text x={size / 2} y={size / 2 - (centerSub ? 4 : -5)} textAnchor="middle" fontSize={size >= 150 ? 20 : 15} fontWeight="700" fill="var(--ink)">
          {centerLabel}
        </text>
      )}
      {centerSub && (
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fontSize="10.5" fill="var(--text-muted)">
          {centerSub}
        </text>
      )}
    </svg>
  );
}

// A horizontal bar list ranked by value, each row's fill sized relative to
// the largest value in the set — so the top row is always full width and the
// rest read as fractions of it.
export function BarList({ rows, formatValue = formatPrice, tone = 'brand' }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bar-list">
      {rows.map((row) => (
        <div className="bar-row" key={row.label}>
          <div className="bar-row-top">
            <span className="name">{row.label}</span>
            <span className="val">{formatValue(row.value)}</span>
          </div>
          <div className="bar-track">
            <div className={`bar-fill bar-fill--${tone}`} style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// A simple ranked list — position, name, an optional secondary line, and a
// right-aligned value. Position 1-3 are set apart by weight/color, since a
// "top 3" is the part of a ranked list most owners actually act on.
export function RankList({ rows, formatValue = formatPrice }) {
  return (
    <div className="rank-list">
      {rows.map((row, i) => (
        <div className="rank-row" key={row.label}>
          <span className="rank-n">{i + 1}</span>
          <div>
            <div className="rank-name">{row.label}</div>
            {row.sub && <div className="rank-sub">{row.sub}</div>}
          </div>
          <span className="rank-val">{formatValue(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

export { CHART_COLORS };
