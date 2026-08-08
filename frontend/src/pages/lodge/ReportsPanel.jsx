import { useEffect, useState } from 'react';
import { apiGet, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import '../internal/LodgesDashboard.css';
import './forms.css';
import './ReportsPanel.css';

const DOCUMENT_LABEL = {
  TAX_INVOICE: 'Tax invoice',
  BILL_OF_SUPPLY: 'Bill of supply',
  CASH_RECEIPT: 'Cash receipt',
};

const TABS = [
  { key: 'occupancy', label: 'Occupancy' },
  { key: 'gst', label: 'GST summary' },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonthIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

// For plain YYYY-MM-DD values (report day rows, the date pickers) — forced
// to UTC so the calendar date never shifts a day depending on the viewer's
// local timezone offset.
function formatDateOnly(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// For real timestamps (an invoice's issued-at) — has its own timezone
// offset already, so no UTC forcing needed.
function formatTimestamp(value) {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ReportsPanel() {
  const session = getSession();
  const token = session?.token;

  const [tab, setTab] = useState('occupancy');
  const [fromDate, setFromDate] = useState(startOfMonthIso());
  const [toDate, setToDate] = useState(todayIso());
  const validRange = Boolean(fromDate && toDate && toDate >= fromDate);

  const [occupancy, setOccupancy] = useState(null);
  const [occupancyError, setOccupancyError] = useState('');
  const [gst, setGst] = useState(null);
  const [gstError, setGstError] = useState('');

  useEffect(() => {
    if (!validRange) return;
    setOccupancy(null);
    setOccupancyError('');
    apiGet(`/reports/occupancy?fromDate=${fromDate}&toDate=${toDate}`, { token })
      .then((data) => setOccupancy(data))
      .catch((err) =>
        setOccupancyError(err instanceof ApiError ? err.message : 'Could not load the occupancy report.')
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  useEffect(() => {
    if (!validRange) return;
    setGst(null);
    setGstError('');
    apiGet(`/reports/gst-summary?fromDate=${fromDate}&toDate=${toDate}`, { token })
      .then((data) => setGst(data))
      .catch((err) => setGstError(err instanceof ApiError ? err.message : 'Could not load the GST summary.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  const documentTypeRows = gst ? Object.entries(gst.byDocumentType) : [];

  return (
    <div className="reports-panel">
      <div className="dash-card reports-panel__filters">
        <div className="field-row">
          <div className="field">
            <label htmlFor="reportsFromDate">From</label>
            <input
              id="reportsFromDate"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="reportsToDate">To</label>
            <input id="reportsToDate" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>
        {!validRange && <p className="reports-panel__hint">Choose a valid date range.</p>}
      </div>

      <div className="reports-panel__subtabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="reports-panel__subtabs-item"
            aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'occupancy' && (
        <>
          {occupancyError && (
            <div className="dash-card">
              <div className="dash-state">{occupancyError}</div>
            </div>
          )}
          {!occupancyError && validRange && !occupancy && (
            <div className="dash-card">
              <div className="dash-state">Loading…</div>
            </div>
          )}
          {!occupancyError && occupancy && (
            <>
              <div className="reports-panel__stat-grid">
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Average occupancy</span>
                  <span className="reports-panel__stat-value">{occupancy.summary.occupancyPercent}%</span>
                </div>
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Room-nights occupied</span>
                  <span className="reports-panel__stat-value">
                    {occupancy.summary.occupiedRoomNights} / {occupancy.summary.totalRoomNights}
                  </span>
                </div>
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Active rooms</span>
                  <span className="reports-panel__stat-value">{occupancy.totalRooms}</span>
                </div>
              </div>

              {occupancy.totalRooms === 0 ? (
                <div className="dash-card">
                  <div className="dash-state">Add rooms on the Rooms &amp; rates tab to see occupancy.</div>
                </div>
              ) : (
                <div className="dash-card">
                  <div className="dash-table-scroll">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Occupied</th>
                          <th>Occupancy</th>
                        </tr>
                      </thead>
                      <tbody>
                        {occupancy.days.map((d) => (
                          <tr key={d.date}>
                            <td>{formatDateOnly(d.date)}</td>
                            <td>
                              {d.occupiedRooms} / {d.totalRooms}
                            </td>
                            <td>{d.occupancyPercent}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === 'gst' && (
        <>
          {gstError && (
            <div className="dash-card">
              <div className="dash-state">{gstError}</div>
            </div>
          )}
          {!gstError && validRange && !gst && (
            <div className="dash-card">
              <div className="dash-state">Loading…</div>
            </div>
          )}
          {!gstError && gst && (
            <>
              <div className="reports-panel__stat-grid">
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Bills issued</span>
                  <span className="reports-panel__stat-value">{gst.totals.count}</span>
                </div>
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Room charges</span>
                  <span className="reports-panel__stat-value">{formatPrice(gst.totals.roomSubtotal)}</span>
                </div>
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">CGST</span>
                  <span className="reports-panel__stat-value">{formatPrice(gst.totals.cgstAmount)}</span>
                </div>
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">SGST</span>
                  <span className="reports-panel__stat-value">{formatPrice(gst.totals.sgstAmount)}</span>
                </div>
                <div className="reports-panel__stat reports-panel__stat--accent">
                  <span className="reports-panel__stat-label">Total revenue</span>
                  <span className="reports-panel__stat-value">{formatPrice(gst.totals.totalAmount)}</span>
                </div>
              </div>

              {documentTypeRows.length > 0 && (
                <div className="dash-card">
                  <div className="dash-table-scroll">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Document type</th>
                          <th>Count</th>
                          <th>Room charges</th>
                          <th>CGST</th>
                          <th>SGST</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {documentTypeRows.map(([type, t]) => (
                          <tr key={type}>
                            <td>{DOCUMENT_LABEL[type] || type}</td>
                            <td>{t.count}</td>
                            <td>{formatPrice(t.roomSubtotal)}</td>
                            <td>{formatPrice(t.cgstAmount)}</td>
                            <td>{formatPrice(t.sgstAmount)}</td>
                            <td>{formatPrice(t.totalAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {gst.invoices.length === 0 ? (
                <div className="dash-card">
                  <div className="dash-state">No bills issued in this date range.</div>
                </div>
              ) : (
                <div className="dash-card">
                  <div className="dash-table-scroll">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Invoice</th>
                          <th>Date</th>
                          <th>Guest</th>
                          <th>Type</th>
                          <th>CGST</th>
                          <th>SGST</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gst.invoices.map((inv) => (
                          <tr key={inv.id}>
                            <td>{inv.invoiceNumber}</td>
                            <td>{formatTimestamp(inv.createdAt)}</td>
                            <td>{inv.guestName}</td>
                            <td>{DOCUMENT_LABEL[inv.documentType] || inv.documentType}</td>
                            <td>{formatPrice(inv.cgstAmount)}</td>
                            <td>{formatPrice(inv.sgstAmount)}</td>
                            <td>{formatPrice(inv.totalAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
