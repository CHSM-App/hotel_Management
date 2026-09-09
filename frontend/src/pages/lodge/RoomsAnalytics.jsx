import { useEffect, useState } from 'react';
import { apiGet, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import { TrendChart, BarList } from './AnalyticsCharts';
import './AnalyticsCharts.css';

const LOS_LABEL = { '1': '1 night', '2': '2 nights', '3': '3 nights', '4+': '4+ nights' };

// Sits above the existing booking register on the Bookings tab: the figures
// a register alone can't answer without an owner doing the arithmetic by
// hand — RevPAR, average stay length, cancellation rate, an occupancy trend,
// and how occupancy splits by room category.
export default function RoomsAnalytics({ fromDate, toDate, validRange, bookings }) {
  const session = getSession();
  const token = session?.token;

  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!validRange) return;
    setData(null);
    setError('');
    apiGet(`/reports/rooms-analytics?fromDate=${fromDate}&toDate=${toDate}`, { token })
      .then((d) => setData(d))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load room analytics.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  if (error) {
    return (
      <div className="dash-card">
        <div className="dash-state">{error}</div>
      </div>
    );
  }

  if (!data || !bookings) {
    return (
      <div className="dash-card">
        <div className="dash-state">Loading…</div>
      </div>
    );
  }

  const losRows = data.losHistogram.map((b) => ({ label: LOS_LABEL[b.bucket] || b.bucket, value: b.count }));
  const categoryRows = data.occupancyByCategory.map((c) => ({ label: c.categoryName, value: c.occupancyPercent }));

  return (
    <div className="analytics-section">
      <div className="kpi-row">
        <div className="kpi-card kpi-card--primary">
          <span className="kpi-label">RevPAR</span>
          <span className="kpi-value">{formatPrice(data.revpar)}</span>
          <span className="kpi-sub">Revenue per available room-night</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Avg. length of stay</span>
          <span className="kpi-value">{data.alos.toFixed(2)} <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>nights</span></span>
          <span className="kpi-sub">{bookings.summary.totalBookings} bookings in this period</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Cancellation rate</span>
          <span className="kpi-value">{data.cancellationRate}%</span>
          <span className="kpi-sub">{bookings.summary.byStatus.CANCELLED || 0} cancelled</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Room nights sold</span>
          <span className="kpi-value">{bookings.summary.roomNights}</span>
          <span className="kpi-sub">{formatPrice(bookings.summary.billedAmount)} billed</span>
        </div>
      </div>

      <p className="reports-panel__section-label">Occupancy trend</p>
      <div className="analytics-grid-2">
        <div className="analytics-card">
          <div className="analytics-card-head">
            <span className="analytics-card-title">Occupancy % across the period</span>
          </div>
          <TrendChart
            points={data.occupancyTrend}
            valueKey="occupancyPercent"
            formatValue={(v) => `${Math.round(v)}%`}
          />
        </div>

        <div className="analytics-card">
          <div className="analytics-card-head"><span className="analytics-card-title">Nights by length of stay</span></div>
          {losRows.some((r) => r.value > 0) ? (
            <BarList rows={losRows} formatValue={(v) => `${v} bookings`} />
          ) : (
            <p className="analytics-empty">No completed stays in this period.</p>
          )}
        </div>
      </div>

      {categoryRows.length > 0 && (
        <>
          <p className="reports-panel__section-label">Occupancy by room category</p>
          <div className="analytics-card">
            <BarList rows={categoryRows} formatValue={(v) => `${Math.round(v)}%`} />
          </div>
        </>
      )}
    </div>
  );
}
