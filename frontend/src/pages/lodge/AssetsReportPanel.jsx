import { useEffect, useMemo, useState } from 'react';
import { formatPrice } from './priceFormat';
import { Donut, BarList, RankList } from './AnalyticsCharts';
import { downloadAssetsReportExcel, downloadAssetsReportPdf, buildAssetsReportPdf } from './assetReportFile';
import './AnalyticsCharts.css';
import './ExpensesReportPanel.css';

const STATUS_LABEL = { IN_USE: 'In use', UNDER_REPAIR: 'Under repair', RETIRED: 'Retired' };
const CATEGORY_COLORS = ['var(--brand)', 'var(--accent)', '#2FA0A0', '#C77D3A', '#7A5FD1', '#3A8FC7'];

function repairCost(wo) {
  return Number(wo.partsCost || 0) + Number(wo.laborCost || 0);
}

function expiringSoon(dateStr) {
  if (!dateStr) return false;
  const days = Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
  return days >= 0 && days <= 30;
}

// A full-view report, opened from "View Report" on the Asset Register —
// same shape as ExpensesReportPanel: pure client-side aggregation over data
// AssetsPanel already has loaded (assets, work orders), no new backend call.
export default function AssetsReportPanel({ assets, workOrders, onClose }) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const totals = useMemo(() => {
    const purchaseValue = assets.reduce((s, a) => s + Number(a.purchaseCost || 0), 0);
    const repairSpend = workOrders.reduce((s, wo) => s + repairCost(wo), 0);
    const openWorkOrders = workOrders.filter((wo) => wo.status !== 'CLOSED').length;
    const expiringSoonCount = assets.filter((a) => expiringSoon(a.warrantyExpiry) || expiringSoon(a.amcExpiry)).length;
    return {
      assetCount: assets.length,
      purchaseValue,
      repairSpend,
      totalSpend: purchaseValue + repairSpend,
      openWorkOrders,
      expiringSoonCount,
    };
  }, [assets, workOrders]);

  const byStatus = useMemo(() => {
    const map = { IN_USE: 0, UNDER_REPAIR: 0, RETIRED: 0 };
    for (const a of assets) map[a.status] = (map[a.status] || 0) + 1;
    return map;
  }, [assets]);

  const byCategory = useMemo(() => {
    const map = new Map();
    for (const a of assets) {
      const key = a.categoryName || 'Uncategorised';
      const entry = map.get(key) || { label: key, value: 0 };
      entry.value += Number(a.purchaseCost || 0);
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  }, [assets]);

  const byVendor = useMemo(() => {
    const map = new Map();
    for (const a of assets) {
      if (!a.vendorName || !a.purchaseCost) continue;
      const entry = map.get(a.vendorName) || { label: a.vendorName, value: 0, count: 0 };
      entry.value += Number(a.purchaseCost || 0);
      entry.count += 1;
      map.set(a.vendorName, entry);
    }
    for (const wo of workOrders) {
      if (!wo.vendorName || !repairCost(wo)) continue;
      const entry = map.get(wo.vendorName) || { label: wo.vendorName, value: 0, count: 0 };
      entry.value += repairCost(wo);
      entry.count += 1;
      map.set(wo.vendorName, entry);
    }
    return [...map.values()].sort((a, b) => b.value - a.value).slice(0, 8).map((v) => ({
      ...v,
      sub: `${v.count} entr${v.count === 1 ? 'y' : 'ies'}`,
    }));
  }, [assets, workOrders]);

  const donutSlices = byCategory.slice(0, 6).map((c, i) => ({ ...c, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }));

  const handlePreview = async () => {
    if (previewUrl) {
      setPreviewUrl('');
      return;
    }
    setActionError('');
    setPreviewBusy(true);
    try {
      setPreviewUrl(URL.createObjectURL(await buildAssetsReportPdf(assets, workOrders)));
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
      if (format === 'excel') await downloadAssetsReportExcel(assets, workOrders);
      else await downloadAssetsReportPdf(assets, workOrders);
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
          <h2 className="expense-report__title">Asset Report</h2>
          <p className="expense-report__sub">{totals.assetCount} asset{totals.assetCount === 1 ? '' : 's'} on the register</p>
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
          <iframe className="expense-report__preview" src={previewUrl} title="Asset report preview" />
        </div>
      )}

      <div className="kpi-row" style={{ marginBottom: 16 }}>
        <div className="kpi-card kpi-card--primary">
          <span className="kpi-label">Purchase value</span>
          <span className="kpi-value">{formatPrice(totals.purchaseValue)}</span>
          <span className="kpi-sub">Across {totals.assetCount} asset{totals.assetCount === 1 ? '' : 's'}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Repair spend</span>
          <span className="kpi-value">{formatPrice(totals.repairSpend)}</span>
          <span className="kpi-sub">Parts + labor, all work orders</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Open work orders</span>
          <span className="kpi-value">{totals.openWorkOrders}</span>
          <span className="kpi-sub">Not yet closed</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Warranty / AMC expiring</span>
          <span className="kpi-value">{totals.expiringSoonCount}</span>
          <span className="kpi-sub">Within 30 days</span>
        </div>
      </div>

      <div className="analytics-grid-2" style={{ marginBottom: 16 }}>
        <div className="analytics-card">
          <div className="analytics-card-head">
            <span className="analytics-card-title">By status</span>
          </div>
          <BarList
            rows={Object.entries(STATUS_LABEL).map(([key, label]) => ({ label, value: byStatus[key] || 0 }))}
            formatValue={(v) => `${v} asset${v === 1 ? '' : 's'}`}
            tone="brand"
          />
        </div>

        <div className="analytics-card">
          <div className="analytics-card-head">
            <span className="analytics-card-title">Purchase value by category</span>
          </div>
          {donutSlices.length > 0 ? (
            <div className="expense-report__donut-row">
              <Donut slices={donutSlices} size={160} centerLabel={formatPrice(totals.purchaseValue)} centerSub="Total" />
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
            <p className="inv-panel__hint">No purchase cost on file yet.</p>
          )}
        </div>
      </div>

      <div className="analytics-grid-2">
        <div className="analytics-card">
          <div className="analytics-card-head">
            <span className="analytics-card-title">Top categories</span>
          </div>
          {byCategory.length > 0 ? (
            <BarList rows={byCategory.slice(0, 8)} formatValue={formatPrice} tone="brand" />
          ) : (
            <p className="inv-panel__hint">No assets on the register yet.</p>
          )}
        </div>

        <div className="analytics-card">
          <div className="analytics-card-head">
            <span className="analytics-card-title">Top vendors</span>
            <span className="analytics-card-meta">Purchases + repairs</span>
          </div>
          {byVendor.length > 0 ? (
            <RankList rows={byVendor} formatValue={formatPrice} />
          ) : (
            <p className="inv-panel__hint">No vendor-billed purchases or repairs yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
