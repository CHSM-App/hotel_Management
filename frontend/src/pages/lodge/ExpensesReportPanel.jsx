import { useEffect, useMemo, useState } from 'react';
import { formatPrice } from './priceFormat';
import { TrendChart, Donut, BarList, RankList } from './AnalyticsCharts';
import { downloadExpensesReportExcel, downloadExpensesReportPdf, buildExpensesReportPdf } from './expenseReportFile';
import './AnalyticsCharts.css';
import './ExpensesReportPanel.css';

const CATEGORY_COLORS = ['var(--brand)', 'var(--accent)', '#2FA0A0', '#C77D3A', '#7A5FD1', '#3A8FC7'];

const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A full-view report, opened from "View Report" on the Expenses tab —
// everything it needs (expenses, categories, vendors) is already loaded by
// ExpensesPanel, so this is pure client-side aggregation over data the page
// already has rather than a new backend round trip.
export default function ExpensesReportPanel({ expenses, onClose }) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const totals = useMemo(() => {
    const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const paid = expenses.reduce((s, e) => s + Number(e.amountPaid || 0), 0);
    return { count: expenses.length, total, paid, outstanding: total - paid };
  }, [expenses]);

  const byCategory = useMemo(() => {
    const map = new Map();
    for (const e of expenses) {
      const key = e.categoryName || 'Uncategorised';
      const entry = map.get(key) || { label: key, value: 0 };
      entry.value += Number(e.amount || 0);
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  }, [expenses]);

  const byVendor = useMemo(() => {
    const map = new Map();
    for (const e of expenses) {
      if (!e.vendorName) continue;
      const entry = map.get(e.vendorName) || { label: e.vendorName, value: 0, count: 0 };
      entry.value += Number(e.amount || 0);
      entry.count += 1;
      map.set(e.vendorName, entry);
    }
    return [...map.values()].sort((a, b) => b.value - a.value).slice(0, 8).map((v) => ({
      ...v,
      sub: `${v.count} expense${v.count === 1 ? '' : 's'}`,
    }));
  }, [expenses]);

  // Spend by month for the current calendar year — the same "12 points, one
  // per month" shape TrendChart already draws for revenue, so this reads as
  // the same chart language rather than a new one invented for expenses.
  const monthlyTrend = useMemo(() => {
    const year = new Date().getFullYear();
    const totalsByMonth = Array(12).fill(0);
    for (const e of expenses) {
      const d = new Date(e.expenseDate);
      if (d.getFullYear() === year) totalsByMonth[d.getMonth()] += Number(e.amount || 0);
    }
    return totalsByMonth.map((total, i) => ({ date: `${year}-${String(i + 1).padStart(2, '0')}-01`, total }));
  }, [expenses]);

  const donutSlices = byCategory.slice(0, 6).map((c, i) => ({ ...c, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }));

  const handlePreview = async () => {
    if (previewUrl) {
      setPreviewUrl('');
      return;
    }
    setActionError('');
    setPreviewBusy(true);
    try {
      setPreviewUrl(URL.createObjectURL(await buildExpensesReportPdf(expenses)));
    } catch {
      setActionError('Could not build the PDF preview.');
    } finally {
      setPreviewBusy(false);
    }
  };

  const handleDownload = async (format) => {
    setActionError('');
    setDownloadBusy(format);
    try {
      if (format === 'excel') await downloadExpensesReportExcel(expenses);
      else await downloadExpensesReportPdf(expenses);
    } catch {
      setActionError(`Could not build the ${format.toUpperCase()} file.`);
    } finally {
      setDownloadBusy('');
    }
  };

  return (
    <div className="expense-report">
      <div className="expense-report__head">
        <div>
          <h2 className="expense-report__title">Expense Report</h2>
          <p className="expense-report__sub">{totals.count} expense{totals.count === 1 ? '' : 's'} on file</p>
        </div>
        <div className="expense-report__actions">
          <button type="button" className="btn-secondary" disabled={previewBusy || Boolean(downloadBusy)} onClick={handlePreview}>
            {previewBusy ? 'Building…' : previewUrl ? 'Hide preview' : 'Preview PDF'}
          </button>
          <button type="button" className="btn-secondary" disabled={Boolean(downloadBusy)} onClick={() => handleDownload('excel')}>
            {downloadBusy === 'excel' ? 'Preparing…' : 'Export Excel'}
          </button>
          <button type="button" className="btn-secondary" disabled={Boolean(downloadBusy)} onClick={() => handleDownload('pdf')}>
            {downloadBusy === 'pdf' ? 'Preparing…' : 'Export PDF'}
          </button>
          {onClose && (
            <button type="button" className="btn-accent" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>

      {actionError && <div className="form-banner form-banner--error">{actionError}</div>}

      {previewUrl && (
        <div className="analytics-card expense-report__preview-card">
          <iframe className="expense-report__preview" src={previewUrl} title="Expense report preview" />
        </div>
      )}

      <div className="kpi-row" style={{ marginBottom: 16 }}>
        <div className="kpi-card kpi-card--primary">
          <span className="kpi-label">Total spend</span>
          <span className="kpi-value">{formatPrice(totals.total)}</span>
          <span className="kpi-sub">Across {totals.count} expense{totals.count === 1 ? '' : 's'}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Paid so far</span>
          <span className="kpi-value">{formatPrice(totals.paid)}</span>
          <span className="kpi-sub">{totals.total > 0 ? Math.round((totals.paid / totals.total) * 100) : 0}% settled</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Outstanding</span>
          <span className="kpi-value">{formatPrice(totals.outstanding)}</span>
          <span className="kpi-sub">Partial + pending bills</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Top category</span>
          <span className="kpi-value" style={{ fontSize: 18 }}>{byCategory[0]?.label || '—'}</span>
          <span className="kpi-sub">{byCategory[0] ? formatPrice(byCategory[0].value) : 'No expenses logged yet'}</span>
        </div>
      </div>

      <div className="analytics-grid-2" style={{ marginBottom: 16 }}>
        <div className="analytics-card">
          <div className="analytics-card-head">
            <span className="analytics-card-title">Spend by month, {new Date().getFullYear()}</span>
          </div>
          <TrendChart points={monthlyTrend} valueKey="total" formatValue={formatPrice} />
        </div>

        <div className="analytics-card">
          <div className="analytics-card-head">
            <span className="analytics-card-title">Where it's going</span>
          </div>
          {donutSlices.length > 0 ? (
            <div className="expense-report__donut-row">
              <Donut slices={donutSlices} size={160} centerLabel={formatPrice(totals.total)} centerSub="Total" />
              <ul className="expense-report__legend">
                {donutSlices.map((s) => (
                  <li key={s.label}>
                    <span className="expense-report__legend-dot" style={{ background: s.color }} />
                    {s.label}
                    <span className="expense-report__legend-value">{formatPrice(s.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="inv-panel__hint">No expenses logged yet.</p>
          )}
        </div>
      </div>

      <div className="analytics-grid-2" style={{ marginBottom: 16 }}>
        <div className="analytics-card">
          <div className="analytics-card-head">
            <span className="analytics-card-title">Top categories</span>
          </div>
          {byCategory.length > 0 ? (
            <BarList rows={byCategory.slice(0, 8)} formatValue={formatPrice} tone="brand" />
          ) : (
            <p className="inv-panel__hint">No expenses logged yet.</p>
          )}
        </div>

        <div className="analytics-card">
          <div className="analytics-card-head">
            <span className="analytics-card-title">Top vendors</span>
          </div>
          {byVendor.length > 0 ? (
            <RankList rows={byVendor} formatValue={formatPrice} />
          ) : (
            <p className="inv-panel__hint">No vendor-billed expenses yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
