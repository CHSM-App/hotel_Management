import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE, apiGet, ApiError } from '../../lib/api';
import { formatPrice } from './priceFormat';
import './AssetQrPage.css';

const STATUS_LABEL = { IN_USE: 'In use', UNDER_REPAIR: 'Under repair', RETIRED: 'Retired' };
const STATUS_CLASS = { IN_USE: 'asset-qr-status--ok', UNDER_REPAIR: 'asset-qr-status--warn', RETIRED: 'asset-qr-status--off' };
const COVERAGE_LABEL = { WARRANTY: 'Warranty', AMC: 'AMC' };
const WO_STATUS_LABEL = { OPEN: 'Open', IN_PROGRESS: 'In progress', CLOSED: 'Closed' };
const WO_STATUS_CLASS = { OPEN: 'asset-qr-status--warn', IN_PROGRESS: 'asset-qr-status--warn', CLOSED: 'asset-qr-status--ok' };
const ISSUE_TYPE_LABEL = { BREAKDOWN: 'Breakdown', ROUTINE_SERVICE: 'Routine service' };

function formatDate(iso) {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Work order timestamps (openedAt/closedAt) are full datetimes, unlike the
// date-only coverage/warranty fields formatDate expects — appending a second
// T00:00:00 to one of those would break Date parsing.
function formatDateTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// What a scanned asset QR opens: one focused page with just that asset's
// record — no dashboard chrome, no sidebar, nothing to navigate. Whoever
// scanned the code (usually standing right next to the thing) came for its
// location, warranty/AMC status and service history, not the rest of the
// property's data.
export default function AssetQrPage() {
  const { token } = useParams();
  const [asset, setAsset] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    apiGet(`/public/assets/${token}`)
      .then((data) => {
        if (cancelled) return;
        setAsset(data.asset);
        setPeriods(data.periods || []);
        setWorkOrders(data.workOrders || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load this asset.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const viewBill = () => {
    window.open(`${API_BASE}/public/assets/${token}/bill`, '_blank');
  };

  if (loading) {
    return (
      <div className="asset-qr-page">
        <div className="asset-qr-card asset-qr-card--center">Loading…</div>
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className="asset-qr-page">
        <div className="asset-qr-card asset-qr-card--center">
          <p className="asset-qr-error">{error || 'Asset not found.'}</p>
        </div>
      </div>
    );
  }

  const location = asset.roomNumber
    ? `Room ${asset.roomNumber}`
    : [asset.floor ? `Floor ${asset.floor}` : null, asset.department].filter(Boolean).join(' · ');

  const facts = [
    { label: 'Location', value: location || 'Not set' },
    asset.brand || asset.model ? { label: 'Brand / model', value: [asset.brand, asset.model].filter(Boolean).join(' ') } : null,
    asset.serialNumber ? { label: 'Serial number', value: asset.serialNumber } : null,
    asset.purchaseDate
      ? { label: 'Purchased', value: [formatDate(asset.purchaseDate), asset.purchaseCost != null ? formatPrice(asset.purchaseCost) : null].filter(Boolean).join(' · ') }
      : null,
    { label: 'Warranty', value: asset.warrantyExpiry ? formatDate(asset.warrantyExpiry) : '—' },
    { label: 'AMC', value: asset.amcExpiry ? formatDate(asset.amcExpiry) : '—' },
    asset.vendorName ? { label: 'Vendor', value: asset.vendorName } : null,
    asset.locationNote ? { label: 'Note', value: asset.locationNote } : null,
  ].filter(Boolean);

  return (
    <div className="asset-qr-page">
      <div className="asset-qr-card">
        <header className="asset-qr-header">
          <div className="asset-qr-avatar">{asset.categoryName?.[0]?.toUpperCase() || asset.name[0].toUpperCase()}</div>
          <div className="asset-qr-heading">
            <h1>{asset.name}</h1>
            <p>{[asset.assetTag, asset.categoryName].filter(Boolean).join(' · ')}</p>
          </div>
          <span className={`asset-qr-status ${STATUS_CLASS[asset.status] || ''}`}>{STATUS_LABEL[asset.status] || asset.status}</span>
        </header>

        <dl className="asset-qr-facts">
          {facts.map((f) => (
            <div className="asset-qr-fact" key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
          <div className="asset-qr-fact">
            <dt>Purchase bill</dt>
            <dd>
              {asset.hasBillDocument ? (
                <button type="button" className="asset-qr-link" onClick={viewBill}>
                  View bill
                </button>
              ) : (
                'Not uploaded'
              )}
            </dd>
          </div>
        </dl>

        {periods.length > 0 && (
          <section className="asset-qr-coverage">
            <h2>Coverage history</h2>
            <ul>
              {periods.map((p) => (
                <li key={p.id}>
                  <span className="asset-qr-coverage-tag">{COVERAGE_LABEL[p.coverageType] || p.coverageType}</span>
                  <span className="asset-qr-coverage-when">
                    {p.startDate ? `${formatDate(p.startDate)} – ` : 'Until '}
                    {formatDate(p.endDate)}
                  </span>
                  {p.vendorName && <span className="asset-qr-coverage-vendor">{p.vendorName}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {workOrders.length > 0 && (
          <section className="asset-qr-coverage">
            <h2>Service history</h2>
            <ul>
              {workOrders.map((w) => (
                <li key={w.id}>
                  <span className={`asset-qr-coverage-tag ${WO_STATUS_CLASS[w.status] || ''}`}>
                    {WO_STATUS_LABEL[w.status] || w.status}
                  </span>
                  <span className="asset-qr-coverage-when">
                    {ISSUE_TYPE_LABEL[w.issueType] || w.issueType} · {formatDateTime(w.openedAt)}
                  </span>
                  {w.description && <span className="asset-qr-coverage-vendor">{w.description}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
