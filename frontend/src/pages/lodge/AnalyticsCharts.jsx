import { useEffect, useRef, useState } from 'react';
import { animate, motion, useReducedMotion } from 'framer-motion';
import { formatPrice } from './priceFormat';

// Small reusable chart primitives shared by the analytics sections across
// Overview, Bookings, Events and Food orders — kept framework-free (plain
// inline SVG) so they read the same way the rest of this app's charts would
// if it had any, and carry no extra dependency.

// Motion. Every chart draws itself in once, in about a second, and then stays
// still: the point is to let the eye follow the data in, not to keep moving
// while someone reads it. Nothing animates for someone who asks their system
// for reduced motion; the charts simply appear, as they did before.
const EASE = [0.4, 0, 0.2, 1];
const EASE_OUT = [0.2, 0.7, 0.2, 1];

// A figure that counts up from zero to its value. Takes the same formatter the
// chart already uses, so the number reads the same at every step as it will at
// the end.
function CountUp({ to, format, duration = 0.8, delay = 0 }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  // Where the last count ended. A refresh with new data counts on from there
  // instead of dropping back to zero and starting again.
  const from = useRef(0);
  useEffect(() => {
    if (reduce || !ref.current) return undefined;
    const controls = animate(from.current, to, {
      duration,
      delay,
      ease: 'easeOut',
      onUpdate: (v) => {
        from.current = v;
        if (ref.current) ref.current.textContent = format(v);
      },
    });
    return () => controls.stop();
  }, [to, duration, delay, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref}>{format(reduce ? to : 0)}</span>;
}

// For a figure that is already a formatted string, such as a KPI tile's
// "₹1,24,000" or "78%". Finds the first number in it, counts that up, and
// keeps whatever surrounds it (currency sign, percent, a trailing unit) and the
// number's own grouping and decimals. Text with no number in it passes through.
export function CountText({ value, duration = 1 }) {
  const text = String(value ?? '');
  const m = text.match(/-?\d[\d,]*\.?\d*/);
  if (!m) return text;
  const raw = m[0];
  const num = parseFloat(raw.replace(/,/g, ''));
  if (!Number.isFinite(num)) return text;
  const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
  const grouped = raw.includes(',');
  const pre = text.slice(0, m.index);
  const post = text.slice(m.index + raw.length);
  const format = (v) =>
    pre +
    (grouped
      ? v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : v.toFixed(decimals)) +
    post;
  return <CountUp to={num} format={format} duration={duration} />;
}

const CHART_COLORS = {
  room: 'var(--brand)',
  function: 'var(--accent)',
  food: '#2FA0A0',
};

// A day-by-day line, drawn to whatever min/max the data actually reaches —
// never a hardcoded scale, so a slow week doesn't draw as a flat line pinned
// to the top of a chart sized for a busy one.
export function TrendChart({ points, priorPoints, height = 220, valueKey = 'totalRevenue', formatValue = formatPrice }) {
  const reduce = useReducedMotion();
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
      // New period or metric, new drawing; a plain data refresh does not replay it.
      key={`${valueKey}-${points.length}-${points[0]?.date}-${points[points.length - 1]?.date}`}
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

      {/* The line draws left to right, the area fades in under it, and the last
          point pops with its label once the line gets there. */}
      <motion.path
        d={areaPath(values)}
        fill="var(--brand-wash)"
        stroke="none"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 0.6 }}
        transition={{ duration: 0.6, delay: 0.8 }}
      />
      <motion.path
        d={linePath(values)}
        fill="none"
        stroke="var(--brand)"
        strokeWidth="2.25"
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: EASE }}
      />
      {values.length > 0 && (
        <>
          <motion.circle
            cx={x(values.length - 1, values.length)}
            cy={y(lastValue)}
            fill="var(--brand)"
            initial={reduce ? false : { r: 0 }}
            animate={{ r: [0, 7, 4] }}
            transition={{ duration: 0.45, delay: 1.15 }}
          />
          <motion.text
            x={x(values.length - 1, values.length) - 6}
            y={y(lastValue) - 8}
            textAnchor="end"
            fontSize="11"
            fontWeight="700"
            fill="var(--ink)"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 1.3 }}
          >
            {formatValue(lastValue)}
          </motion.text>
        </>
      )}
    </svg>
  );
}

// A donut built from an ordered list of {label, value} slices. Percentages
// are derived from the values themselves rather than trusted from the
// caller, so the arcs always foot to 360 degrees exactly once.
export function Donut({ slices, size = 160, strokeWidth = 24, centerLabel, centerSub }) {
  const reduce = useReducedMotion();
  // The slice under the pointer, by label. It grows, the rest fade, and the
  // centre reads that slice instead of the total.
  const [active, setActive] = useState(null);
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
        {/* All slices sweep in together over a second. Offsets stay fixed, so
            each one simply grows from nothing to its length. */}
        {arcs.map((a) => (
          <motion.circle
            key={a.label}
            r={r}
            fill="none"
            stroke={a.color}
            strokeDashoffset={-a.offset}
            initial={reduce ? false : { strokeDasharray: `0 ${circumference}`, strokeWidth, opacity: 1 }}
            animate={{
              strokeDasharray: `${a.dash} ${a.gap}`,
              strokeWidth: active === a.label ? strokeWidth + 8 : strokeWidth,
              opacity: active == null || active === a.label ? 1 : 0.35,
            }}
            transition={{
              strokeDasharray: { duration: 1, ease: EASE },
              strokeWidth: { type: 'spring', stiffness: 300, damping: 22 },
              opacity: { duration: 0.15 },
            }}
            onPointerEnter={() => setActive(a.label)}
            onPointerLeave={() => setActive(null)}
          />
        ))}
      </g>
      {(() => {
        const hit = active != null ? arcs.find((a) => a.label === active) : null;
        const mainText = hit ? hit.label : centerLabel;
        const subText = hit ? `${Math.round((hit.value / total) * 100)}%` : centerSub;
        return (
          <>
            {mainText && (
              <text x={size / 2} y={size / 2 - (subText ? 4 : -5)} textAnchor="middle" fontSize={size >= 150 ? 20 : 15} fontWeight="700" fill="var(--ink)">
                {mainText}
              </text>
            )}
            {subText && (
              <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fontSize="10.5" fill="var(--text-muted)">
                {subText}
              </text>
            )}
          </>
        );
      })()}
    </svg>
  );
}

// Two bars per group — e.g. rooms sold vs. in house, per day — on one shared
// axis. Same width/padding/axis-line conventions as TrendChart, so the two
// sit comfortably in matching card widths; legend is left to the caller's
// card header, the same way Donut leaves its legend to callers too.
export function GroupedBarChart({
  data,
  seriesAKey,
  seriesBKey,
  colorA = 'var(--brand)',
  colorB = 'var(--text-muted)',
  height = 220,
  formatValue = (n) => String(n),
}) {
  const reduce = useReducedMotion();
  // The day under the pointer. Its pair stays full strength and shows both
  // values; the other days fade back.
  const [hovered, setHovered] = useState(null);
  const width = 720;
  const padLeft = 34;
  const padRight = 12;
  const padTop = 16;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const aValues = data.map((d) => Number(d[seriesAKey]) || 0);
  const bValues = data.map((d) => Number(d[seriesBKey]) || 0);
  const maxValue = Math.max(1, ...aValues, ...bValues);

  const groupW = data.length > 0 ? plotW / data.length : plotW;
  const barW = Math.min(16, groupW * 0.28);
  const gap = Math.max(2, barW * 0.25);

  const y = (v) => padTop + plotH - (v / maxValue) * plotH;
  const barH = (v) => (v / maxValue) * plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  const fmtAxisDate = (iso) => {
    if (!iso) return '';
    const d = new Date(`${iso}T00:00:00Z`);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Grouped bar chart comparing ${seriesAKey} and ${seriesBKey} across ${data.length} days`}
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
      {data.map((d, i) => {
        const centerX = padLeft + groupW * (i + 0.5);
        const dim = hovered != null && hovered !== i;
        // Each bar grows up from the baseline, a little after the one before
        // it, so the chart fills in left to right. The pivot is the bar's own
        // bottom edge.
        const grow = (n) => ({
          initial: reduce ? false : { scaleY: 0, opacity: 1 },
          animate: { scaleY: 1, opacity: dim ? 0.35 : 1 },
          transition: {
            scaleY: { duration: 0.55, ease: EASE_OUT, delay: (i * 2 + n) * 0.04 },
            opacity: { duration: 0.15 },
          },
          style: { originX: 0.5, originY: 1 },
        });
        return (
          <g
            key={d.date || i}
            onPointerEnter={() => setHovered(i)}
            onPointerLeave={() => setHovered(null)}
          >
            {/* A full-height, invisible column so the hover works over the gap
                above a short bar, not only on the bar itself. */}
            <rect x={padLeft + groupW * i} y={padTop} width={groupW} height={plotH} fill="transparent" />
            <motion.rect x={centerX - gap / 2 - barW} y={y(aValues[i])} width={barW} height={barH(aValues[i])} rx="1.5" fill={colorA} {...grow(0)} />
            <motion.rect x={centerX + gap / 2} y={y(bValues[i])} width={barW} height={barH(bValues[i])} rx="1.5" fill={colorB} {...grow(1)} />
            <text x={centerX} y={height - 6} textAnchor="middle" fontSize="10">
              {fmtAxisDate(d.date)}
            </text>
            <motion.text
              x={centerX}
              y={y(Math.max(aValues[i], bValues[i])) - 6}
              textAnchor="middle"
              fontSize="10.5"
              fontWeight="700"
              fill="var(--ink)"
              initial={false}
              animate={{ opacity: hovered === i ? 1 : 0, y: hovered === i ? 0 : 4 }}
              transition={{ duration: 0.18 }}
              pointerEvents="none"
            >
              {formatValue(aValues[i])} / {formatValue(bValues[i])}
            </motion.text>
          </g>
        );
      })}
    </svg>
  );
}

// A horizontal bar list ranked by value, each row's fill sized relative to
// the largest value in the set — so the top row is always full width and the
// rest read as fractions of it.
export function BarList({ rows, formatValue = formatPrice, tone = 'brand' }) {
  const reduce = useReducedMotion();
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bar-list">
      {rows.map((row, i) => (
        <div className="bar-row" key={row.label}>
          <div className="bar-row-top">
            <span className="name">{row.label}</span>
            <span className="val">
              <CountUp to={row.value} format={formatValue} delay={i * 0.08} />
            </span>
          </div>
          <div className="bar-track">
            {/* Fills left to right, one row after the next, while the figure
                above counts up with it. */}
            <motion.div
              className={`bar-fill bar-fill--${tone}`}
              style={{ width: `${Math.max(2, (row.value / max) * 100)}%`, originX: 0 }}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.8, ease: EASE_OUT, delay: i * 0.08 }}
            />
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
  const reduce = useReducedMotion();
  return (
    <div className="rank-list">
      {rows.map((row, i) => (
        // Rows fade in one after another; then each rank number pops on a
        // spring, so the order is the first thing the eye picks up.
        <motion.div
          className="rank-row"
          key={row.label}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: i * 0.08 }}
        >
          <motion.span
            className="rank-n"
            initial={reduce ? false : { scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 12, delay: 0.15 + i * 0.1 }}
          >
            {i + 1}
          </motion.span>
          <div>
            <div className="rank-name">{row.label}</div>
            {row.sub && <div className="rank-sub">{row.sub}</div>}
          </div>
          <span className="rank-val">
            <CountUp to={row.value} format={formatValue} delay={i * 0.1} />
          </span>
        </motion.div>
      ))}
    </div>
  );
}

export { CHART_COLORS };
