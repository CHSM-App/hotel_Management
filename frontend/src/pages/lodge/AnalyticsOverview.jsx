import { formatPrice } from './priceFormat';
import { TrendChart, Donut, BarList } from './AnalyticsCharts';
import './AnalyticsCharts.css';

const EVENT_TYPE_LABEL = {
  BIRTHDAY: 'Birthday',
  WEDDING: 'Wedding',
  RECEPTION: 'Reception',
  ENGAGEMENT: 'Engagement',
  CORPORATE: 'Corporate',
  OTHER: 'Other',
};

const PAYMENT_METHOD_LABEL = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', UNRECORDED: 'Other' };
const PAYMENT_METHOD_COLOR = {
  CASH: 'var(--color-success)',
  UPI: 'var(--brand)',
  CARD: 'var(--accent)',
  UNRECORDED: 'var(--border)',
};

function pctDelta(current, prior) {
  if (!prior) return null;
  return ((current - prior) / prior) * 100;
}

function DeltaBadge({ current, prior, suffix = 'vs. prior period' }) {
  const delta = pctDelta(current, prior);
  if (delta == null) return <span className="kpi-delta kpi-delta--flat">No prior data</span>;
  const rounded = Math.round(Math.abs(delta) * 10) / 10;
  if (rounded < 0.1) return <span className="kpi-delta kpi-delta--flat">Flat {suffix}</span>;
  const up = delta > 0;
  return (
    <span className={`kpi-delta ${up ? 'kpi-delta--up' : 'kpi-delta--down'}`}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        {up ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
      </svg>
      {rounded}% {suffix}
    </span>
  );
}

// Overview's analytics: takes the cross-stream aggregate (/reports/analytics-
// overview) as a prop — ReportsPanel fetches it once and shares it with the
// Functions and Food tabs too — and combines it with the bookings/occupancy/
// gst/events/food reports the panel already has loaded.
export default function AnalyticsOverview({ lodge, bookings, occupancy, gst, events, foodOrders, analytics: data, analyticsError, showComparison = true }) {
  if (analyticsError) {
    return (
      <div className="dash-card">
        <div className="dash-state">{analyticsError}</div>
      </div>
    );
  }

  const ready = data && bookings && occupancy && gst &&
    (!lodge?.hasEvents || events || events === null) &&
    (!lodge?.servesFood || foodOrders || foodOrders === null);

  if (!ready) {
    return (
      <div className="dash-card">
        <div className="dash-state">Loading…</div>
      </div>
    );
  }

  // Revenue actually billed this period, by stream — the same basis the old
  // Overview hero used, kept here so the headline figure a returning owner
  // is used to reading does not silently change definition. A cancellation
  // charge is real, settled income on a booking that otherwise contributes
  // nothing here (cancelled stays are excluded from billedAmount entirely),
  // so it's added in on its own rather than lost between the two categories.
  // Kept separate from stayRevenue below: it corresponds to zero room-nights,
  // and folding it into the rate math would inflate ADR/RevPAR.
  const stayRevenue = Number(bookings.summary.billedAmount || 0);
  const cancellationChargesKept = Number(bookings.summary.cancellationChargesKept || 0);
  const roomsBilled = stayRevenue + cancellationChargesKept;
  const roomsUnbilled = Number(bookings.summary.unbilledValue || 0);
  let eventsBilled = 0;
  let eventsUnbilled = 0;
  if (lodge?.hasEvents && events) {
    for (const ev of events.events) {
      if (ev.status === 'CANCELLED' || ev.status === 'EXPIRED') continue;
      if (ev.invoiceNumber) eventsBilled += Number(ev.totalAmount || 0);
      else eventsUnbilled += Number(ev.totalAmount || 0);
    }
  }
  const foodBilled = lodge?.servesFood && foodOrders ? Number(foodOrders.summary.billedValue || 0) : 0;
  const foodUnbilled = lodge?.servesFood && foodOrders ? Number(foodOrders.summary.unbilledDeliveredValue || 0) : 0;
  const totalRevenue = roomsBilled + eventsBilled + foodBilled;
  const totalUnbilled = roomsUnbilled + eventsUnbilled + foodUnbilled;

  const priorTotal = data.priorPeriod.dailyTrend.reduce((sum, d) => sum + d.totalRevenue, 0);
  const currentTrendTotal = data.dailyTrend.reduce((sum, d) => sum + d.totalRevenue, 0);

  const adr = bookings.summary.roomNights > 0 ? stayRevenue / bookings.summary.roomNights : 0;
  const revpar = occupancy.totalRooms > 0 && data.dailyTrend.length > 0
    ? stayRevenue / (occupancy.totalRooms * data.dailyTrend.length)
    : 0;

  const revenueMixSlices = [
    { label: 'Rooms', value: roomsBilled, color: 'var(--brand)' },
    ...(lodge?.hasEvents ? [{ label: 'Functions', value: eventsBilled, color: 'var(--accent)' }] : []),
    ...(lodge?.servesFood ? [{ label: 'Food', value: foodBilled, color: '#2FA0A0' }] : []),
  ];

  const categoryBars = data.revenueByRoomCategory.map((c) => ({ label: c.categoryName, value: c.revenue }));
  const functionTypeBars = data.revenueByFunctionType.map((f) => ({
    label: EVENT_TYPE_LABEL[f.eventType] || f.eventType,
    value: f.revenue,
  }));
  const paymentMixTotal = data.paymentMix.reduce((sum, p) => sum + p.amount, 0);

  // Plain-language flags an owner can act on, derived from figures already
  // on the page rather than a separate rules engine — each one names the
  // number it is talking about so it can be checked against the tiles above.
  const insights = [];
  if (totalUnbilled > 0) {
    insights.push({
      tone: 'warn',
      title: `${formatPrice(totalUnbilled)} sitting unbilled`,
      body: 'Stays, functions or food orders that are complete but have not been converted to a bill yet — worth clearing before the month closes.',
    });
  }
  if (showComparison && currentTrendTotal > priorTotal && priorTotal > 0) {
    insights.push({
      tone: 'good',
      title: `Revenue up ${Math.round(((currentTrendTotal - priorTotal) / priorTotal) * 100)}% on the prior period`,
      body: `${formatPrice(currentTrendTotal)} billed this period against ${formatPrice(priorTotal)} in the one before it.`,
    });
  } else if (showComparison && priorTotal > 0 && currentTrendTotal < priorTotal) {
    insights.push({
      tone: 'info',
      title: `Revenue down ${Math.round(((priorTotal - currentTrendTotal) / priorTotal) * 100)}% on the prior period`,
      body: `${formatPrice(currentTrendTotal)} billed this period against ${formatPrice(priorTotal)} in the one before it.`,
    });
  }
  if (data.topGuests.length > 0) {
    const top = data.topGuests[0];
    insights.push({
      tone: 'info',
      title: `${top.guestName} is this period's top guest`,
      body: `${formatPrice(top.totalSpend)} across ${top.bookingCount} ${top.bookingCount === 1 ? 'stay' : 'stays'}.`,
    });
  }

  return (
    <div className="analytics-section">
      <div className="kpi-row">
        <div className="kpi-card kpi-card--primary">
          <span className="kpi-label">Revenue billed</span>
          <span className="kpi-value">{formatPrice(totalRevenue)}</span>
          {showComparison && <DeltaBadge current={currentTrendTotal} prior={priorTotal} />}
          <span className="kpi-sub">Rooms + functions + food · billed only</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Occupancy</span>
          <span className="kpi-value">{occupancy.summary.occupancyPercent}%</span>
          <span className="kpi-sub">{occupancy.summary.occupiedRoomNights} of {occupancy.summary.totalRoomNights} room-nights sold</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Avg. daily rate</span>
          <span className="kpi-value">{formatPrice(adr)}</span>
          <span className="kpi-sub">RevPAR {formatPrice(revpar)}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Not yet billed</span>
          <span className="kpi-value" style={{ fontSize: 18 }}>{formatPrice(totalUnbilled)}</span>
          <span className="kpi-sub">Follow up before month close</span>
        </div>
      </div>

      <p className="reports-panel__section-label">Revenue &amp; occupancy trend</p>
      <div className="analytics-grid-2">
        <div className="analytics-card">
          <div className="analytics-card-head">
            <span className="analytics-card-title">Daily revenue</span>
            {showComparison && (
              <div className="analytics-legend">
                <span className="analytics-legend-item"><span className="analytics-legend-dot" style={{ background: 'var(--brand)' }} />This period</span>
                <span className="analytics-legend-item"><span className="analytics-legend-dot" style={{ background: 'var(--border)' }} />Prior period</span>
              </div>
            )}
          </div>
          <TrendChart points={data.dailyTrend} priorPoints={showComparison ? data.priorPeriod.dailyTrend : null} />
          {showComparison && (
            <div className="analytics-card-meta">
              Prior period: {data.priorPeriod.fromDate} to {data.priorPeriod.toDate}, {formatPrice(priorTotal)} billed.
            </div>
          )}
        </div>

        <div className="analytics-card">
          <div className="analytics-card-head">
            <span className="analytics-card-title">Revenue mix</span>
            <span className="analytics-card-meta">{formatPrice(totalRevenue)} total</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Donut slices={revenueMixSlices} centerLabel={formatPrice(totalRevenue)} centerSub="this period" />
          </div>
          <div className="mix-rows">
            {revenueMixSlices.map((s) => (
              <div className="mix-row" key={s.label}>
                <span className="mix-dot" style={{ background: s.color }} />
                <span className="mix-name">{s.label}</span>
                <span className="mix-val">{formatPrice(s.value)}</span>
                <span className="mix-pct">{totalRevenue > 0 ? Math.round((s.value / totalRevenue) * 100) : 0}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="reports-panel__section-label">Where it's coming from</p>
      <div className="analytics-grid-3">
        <div className="analytics-card">
          <div className="analytics-card-head"><span className="analytics-card-title">Revenue by room category</span></div>
          {categoryBars.length > 0 ? <BarList rows={categoryBars} /> : <p className="analytics-empty">No billed room revenue in this period.</p>}
        </div>

        {lodge?.hasEvents && (
          <div className="analytics-card">
            <div className="analytics-card-head"><span className="analytics-card-title">Top function types</span></div>
            {functionTypeBars.length > 0 ? <BarList rows={functionTypeBars} tone="gold" /> : <p className="analytics-empty">No billed functions in this period.</p>}
          </div>
        )}

        <div className="analytics-card">
          <div className="analytics-card-head"><span className="analytics-card-title">Payment mix</span></div>
          {data.paymentMix.length > 0 ? (
            <>
              <div style={{ display: 'flex', height: 20, borderRadius: 7, overflow: 'hidden' }}>
                {data.paymentMix.map((p) => (
                  <div
                    key={p.method}
                    style={{ width: `${(p.amount / paymentMixTotal) * 100}%`, background: PAYMENT_METHOD_COLOR[p.method] }}
                  />
                ))}
              </div>
              <div className="mix-rows" style={{ marginTop: 2 }}>
                {data.paymentMix.map((p) => (
                  <div className="mix-row" key={p.method}>
                    <span className="mix-dot" style={{ background: PAYMENT_METHOD_COLOR[p.method] }} />
                    <span className="mix-name">{PAYMENT_METHOD_LABEL[p.method] || p.method}</span>
                    <span className="mix-val">{formatPrice(p.amount)}</span>
                    <span className="mix-pct">{Math.round((p.amount / paymentMixTotal) * 100)}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="analytics-empty">No payments recorded in this period.</p>
          )}
        </div>
      </div>

      {insights.length > 0 && (
        <>
          <p className="reports-panel__section-label">What needs a look</p>
          <div className="analytics-card">
            <div className="insight-list">
              {insights.map((ins) => (
                <div className={`insight-item insight-item--${ins.tone}`} key={ins.title}>
                  <span className="ico">
                    {ins.tone === 'warn' && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
                    )}
                    {ins.tone === 'good' && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m22 4-10 10-3-3" /></svg>
                    )}
                    {ins.tone === 'info' && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
                    )}
                  </span>
                  <div className="body">
                    <strong>{ins.title}</strong>
                    <p>{ins.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
