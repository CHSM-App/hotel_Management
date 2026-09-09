import { formatPrice } from './priceFormat';
import { RankList } from './AnalyticsCharts';
import './AnalyticsCharts.css';

// Sits above the existing food orders register: when orders actually land
// through the day, what's selling, and how much delivered food is still
// unbilled — the last figure computed here rather than fetched again, since
// the food-orders report already loaded on this tab carries everything it
// needs (billedValue, deliveredValue).
export default function FoodAnalytics({ analytics, loading, error, foodOrders }) {
  if (error) {
    return (
      <div className="dash-card">
        <div className="dash-state">{error}</div>
      </div>
    );
  }
  if (loading || !analytics || !foodOrders) {
    return (
      <div className="dash-card">
        <div className="dash-state">Loading…</div>
      </div>
    );
  }

  const maxHourCount = Math.max(1, ...analytics.ordersByHour.map((h) => h.orderCount));
  const width = 700;
  const height = 180;
  const padLeft = 30;
  const padBottom = 24;
  const plotW = width - padLeft - 10;
  const plotH = height - padBottom - 10;
  const barGap = 4;
  const barW = plotW / 24 - barGap;

  const billedValue = Number(foodOrders.summary.billedValue || 0);
  const deliveredValue = Number(foodOrders.summary.deliveredValue || 0);
  const unbilledValue = Math.max(0, deliveredValue - billedValue);
  const billedPct = deliveredValue > 0 ? Math.round((billedValue / deliveredValue) * 100) : 0;
  const ringCircumference = 2 * Math.PI * 34;

  const topItemRows = analytics.topFoodItems.map((item) => ({
    label: item.itemName,
    sub: `${item.quantity} ${item.quantity === 1 ? 'order' : 'orders'}`,
    value: item.revenue,
  }));

  return (
    <div className="analytics-section">
      <div className="analytics-grid-2">
        <div className="analytics-card">
          <div className="analytics-card-head">
            <span className="analytics-card-title">Orders by hour of day</span>
            <span className="analytics-card-meta">This period</span>
          </div>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Bar chart of food orders by hour of day for the selected period"
            style={{ width: '100%', height: 'auto', overflow: 'visible' }}
          >
            <g className="axis-line" strokeWidth="1">
              <line x1={padLeft} y1={height - padBottom} x2={width - 10} y2={height - padBottom} />
            </g>
            {analytics.ordersByHour.map((h, i) => {
              const barH = (h.orderCount / maxHourCount) * plotH;
              const x = padLeft + i * (barW + barGap);
              const y = height - padBottom - barH;
              return (
                <rect
                  key={h.hour}
                  x={x}
                  y={y}
                  width={Math.max(1, barW)}
                  height={barH}
                  rx="2"
                  fill={h.orderCount === maxHourCount ? 'var(--accent)' : 'var(--brand)'}
                />
              );
            })}
            {[0, 4, 8, 12, 16, 20].map((hour) => (
              <text
                key={hour}
                x={padLeft + hour * (barW + barGap)}
                y={height - 6}
                fontSize="10"
                textAnchor="middle"
              >
                {hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`}
              </text>
            ))}
          </svg>
        </div>

        <div className="analytics-card">
          <div className="analytics-card-head"><span className="analytics-card-title">Billed vs. unbilled</span></div>
          <div className="ring-stat">
            <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`${billedPct} percent of delivered food orders have been billed`}>
              <circle cx="42" cy="42" r="34" fill="none" stroke="var(--neu-sunken)" strokeWidth="10" />
              <circle
                cx="42" cy="42" r="34" fill="none" stroke="var(--brand)" strokeWidth="10"
                strokeDasharray={`${(billedPct / 100) * ringCircumference} ${ringCircumference}`}
                strokeLinecap="round"
                transform="rotate(-90 42 42)"
              />
              <text x="42" y="47" textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--ink)">{billedPct}%</text>
            </svg>
            <div className="figures">
              <span className="big">{formatPrice(billedValue)}</span>
              <span className="lbl">billed of {formatPrice(deliveredValue)}</span>
              {unbilledValue > 0 && (
                <span className="lbl" style={{ color: 'var(--accent-ink)', fontWeight: 700, marginTop: 4 }}>
                  {formatPrice(unbilledValue)} unbilled
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <p className="reports-panel__section-label">What's selling</p>
      <div className="analytics-card">
        {topItemRows.length > 0 ? (
          <RankList rows={topItemRows} />
        ) : (
          <p className="analytics-empty">No food orders in this period.</p>
        )}
      </div>
    </div>
  );
}
