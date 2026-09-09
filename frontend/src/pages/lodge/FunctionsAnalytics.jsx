import { formatPrice } from './priceFormat';
import { BarList } from './AnalyticsCharts';
import './AnalyticsCharts.css';

const EVENT_STATUS_LABEL = {
  ENQUIRY: 'Enquiry',
  TENTATIVE: 'Tentative',
  CONFIRMED: 'Confirmed',
  SETTLED: 'Settled',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

const EVENT_TYPE_LABEL = {
  BIRTHDAY: 'Birthday',
  WEDDING: 'Wedding',
  RECEPTION: 'Reception',
  ENGAGEMENT: 'Engagement',
  CORPORATE: 'Corporate',
  OTHER: 'Other',
};

const STAGE_DOT = {
  ENQUIRY: 'var(--text-muted)',
  TENTATIVE: 'var(--color-warning, var(--accent))',
  CONFIRMED: 'var(--brand)',
  SETTLED: 'var(--color-success)',
  CANCELLED: 'var(--color-danger)',
  EXPIRED: 'var(--border)',
};

function formatUpcomingDate(iso) {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('en-IN', { day: 'numeric' }),
    month: d.toLocaleDateString('en-IN', { month: 'short' }),
  };
}

// Sits above the existing events register: the booking pipeline (what's
// moving through each stage, and its value), what's coming up regardless of
// the report's own date range, and which venues are actually booked out.
// Fed by the same /reports/analytics-overview payload Overview already
// fetched, passed down rather than requested a second time.
export default function FunctionsAnalytics({ analytics, loading, error }) {
  if (error) {
    return (
      <div className="dash-card">
        <div className="dash-state">{error}</div>
      </div>
    );
  }
  if (loading || !analytics) {
    return (
      <div className="dash-card">
        <div className="dash-state">Loading…</div>
      </div>
    );
  }

  const venueBars = analytics.venueUtilization.map((v) => ({ label: v.venueName, value: v.eventCount }));

  return (
    <div className="analytics-section">
      <p className="reports-panel__section-label">Booking pipeline</p>
      <div className="analytics-card">
        <div className="pipeline-row">
          {analytics.functionsPipeline.map((stage) => (
            <div className="pipe-stage" key={stage.status}>
              <span className="dot" style={{ background: STAGE_DOT[stage.status] }} />
              <span className="stage-name">{EVENT_STATUS_LABEL[stage.status] || stage.status}</span>
              <span className="stage-count">{stage.count}</span>
              <span className="stage-val">{formatPrice(stage.value)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="analytics-grid-2">
        <div className="analytics-card">
          <div className="analytics-card-head"><span className="analytics-card-title">Upcoming functions</span></div>
          {analytics.upcomingFunctions.length > 0 ? (
            <div className="upcoming-list">
              {analytics.upcomingFunctions.slice(0, 8).map((f) => {
                const { day, month } = formatUpcomingDate(f.startAt);
                return (
                  <div className="upcoming-row" key={f.id}>
                    <div className="upcoming-date">
                      <span className="d">{day}</span>
                      <span className="m">{month}</span>
                    </div>
                    <div className="upcoming-info">
                      <div className="title">{f.title}</div>
                      <div className="sub">{f.venueName} · {EVENT_TYPE_LABEL[f.eventType] || f.eventType} · {f.status === 'CONFIRMED' ? 'Confirmed' : 'Tentative'}</div>
                    </div>
                    <div className="upcoming-amt">
                      {formatPrice(f.totalAmount)}
                      <span className="sub">{f.advanceAmount > 0 ? `${formatPrice(f.advanceAmount)} advance held` : 'Not held yet'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="analytics-empty">Nothing confirmed or tentative coming up.</p>
          )}
        </div>

        <div className="analytics-card">
          <div className="analytics-card-head"><span className="analytics-card-title">Venue utilisation</span></div>
          {venueBars.length > 0 ? (
            <BarList rows={venueBars} tone="gold" formatValue={(v) => `${v} booking${v === 1 ? '' : 's'}`} />
          ) : (
            <p className="analytics-empty">No functions in this period.</p>
          )}
        </div>
      </div>
    </div>
  );
}
