import { useEffect, useMemo, useState } from 'react';
import { formatPrice } from './priceFormat';
import { TrendChart, Donut, BarList, RankList } from './AnalyticsCharts';
import { downloadIncomeReportExcel, downloadIncomeReportPdf, buildIncomeReportPdf } from './incomeReportFile';
import './AnalyticsCharts.css';
import './ExpensesReportPanel.css';

const CATEGORY_COLORS = ['var(--brand)', 'var(--accent)', '#2FA0A0', '#C77D3A', '#7A5FD1', '#3A8FC7'];

// A full-view report, opened from "View Report" on the Income tab —
// everything it needs is already loaded by IncomePanel, so this is pure
// client-side aggregation, same shape as ExpensesReportPanel.jsx.
export default function IncomeReportPanel({ income: allIncome, onClose }) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const income = useMemo(() => {
    if (!fromDate && !toDate) return allIncome;
    return allIncome.filter((e) => {
      if (fromDate && e.incomeDate < fromDate) return false;
      if (toDate && e.incomeDate > toDate) return false;
      return true;
    });
  }, [allIncome, fromDate, toDate]);

  const totals = useMemo(() => {
    const total = income.reduce((s, e) => s + Number(e.amount || 0), 0);
    const received = income.reduce((s, e) => s + Number(e.amountReceived || 0), 0);
    return { count: income.length, total, received, outstanding: total - received };
  }, [income]);

  const byCategory = useMemo(() => {
    const map = new Map();
    for (const e of income) {
      const key = e.categoryName || 'Uncategorised';
      const entry = map.get(key) || { label: key, value: 0 };
      entry.value += Number(e.amount || 0);
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  }, [income]);

  const byPayer = useMemo(() => {
    const map = new Map();
    for (const e of income) {
      if (!e.payerName) continue;
      const entry = map.get(e.payerName) || { label: e.payerName, value: 0, count: 0 };
      entry.value += Number(e.amount || 0);
      entry.count += 1;
      map.set(e.payerName, entry);
    }
    return [...map.values()].sort((a, b) => b.value - a.value).slice(0, 8).map((v) => ({
      ...v,
      sub: `${v.count} entr${v.count === 1 ? 'y' : 'ies'}`,
    }));
  }, [income]);

  const monthlyTrend = useMemo(() => {
    const year = new Date().getFullYear();
    const totalsByMonth = Array(12).fill(0);
    for (const e of income) {
      const d = new Date(e.incomeDate);
      if (d.getFullYear() === year) totalsByMonth[d.getMonth()] += Number(e.amount || 0);
    }
    return totalsByMonth.map((total, i) => ({ date: `${year}-${String(i + 1).padStart(2, '0')}-01`, total }));
  }, [income]);

  const donutSlices = byCategory.slice(0, 6).map((c, i) => ({ ...c, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }));

  const handlePreview = async () => {
    if (previewUrl) {
      setPreviewUrl('');
      return;
    }
    setActionError('');
    setPreviewBusy(true);
    try {
      setPreviewUrl(URL.createObjectURL(await buildIncomeReportPdf(income)));
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
      if (format === 'excel') await downloadIncomeReportExcel(income);
      else await downloadIncomeReportPdf(income);
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
          <h2 className="expense-report__title">Income Report</h2>
          <p className="expense-report__sub">{totals.count} entr{totals.count === 1 ? 'y' : 'ies'} on file</p>
        </div>
        <div className="expense-report__actions">
          <div className="expense-report__range">
            <input aria-label="From date" type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} />
            <span>–</span>
            <input aria-label="To date" type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
          </div>
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
          <iframe className="expense-report__preview" src={previewUrl} title="Income report preview" />
        </div>
      )}

      <div className="kpi-row" style={{ marginBottom: 16 }}>
        <div className="kpi-card kpi-card--primary">
          <span className="kpi-label">Total income</span>
          <span className="kpi-value">{formatPrice(totals.total)}</span>
          <span className="kpi-sub">Across {totals.count} entr{totals.count === 1 ? 'y' : 'ies'}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Received so far</span>
          <span className="kpi-value">{formatPrice(totals.received)}</span>
          <span className="kpi-sub">{totals.total > 0 ? Math.round((totals.received / totals.total) * 100) : 0}% settled</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Outstanding</span>
          <span className="kpi-value">{formatPrice(totals.outstanding)}</span>
          <span className="kpi-sub">Partial + pending entries</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Top category</span>
          <span className="kpi-value" style={{ fontSize: 18 }}>{byCategory[0]?.label || '—'}</span>
          <span className="kpi-sub">{byCategory[0] ? formatPrice(byCategory[0].value) : 'No income logged yet'}</span>
        </div>
      </div>

      <div className="analytics-grid-2" style={{ marginBottom: 16 }}>
        <div className="analytics-card">
          <div className="analytics-card-head">
            <span className="analytics-card-title">Income by month, {new Date().getFullYear()}</span>
          </div>
          <TrendChart points={monthlyTrend} valueKey="total" formatValue={formatPrice} />
        </div>

        <div className="analytics-card">
          <div className="analytics-card-head">
            <span className="analytics-card-title">Where it's coming from</span>
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
            <p className="inv-panel__hint">No income logged yet.</p>
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
            <p className="inv-panel__hint">No income logged yet.</p>
          )}
        </div>

        <div className="analytics-card">
          <div className="analytics-card-head">
            <span className="analytics-card-title">Top payers</span>
          </div>
          {byPayer.length > 0 ? (
            <RankList rows={byPayer} formatValue={formatPrice} />
          ) : (
            <p className="inv-panel__hint">No payer-linked income yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
