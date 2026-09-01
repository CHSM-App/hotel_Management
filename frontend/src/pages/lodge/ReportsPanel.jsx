import { useEffect, useState } from 'react';
import { apiGet, ApiError } from '../../lib/api';
import { useUrlState } from '../../lib/urlState';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import {
  BOOKING_STATUS_LABEL,
  DOCUMENT_TYPE_LABEL,
  tendersLabel,
  downloadBookingReportExcel,
  buildBookingReportPdf,
  downloadBookingReportPdf,
  reportPeriodLabel,
  wholeMonthLabel,
} from './bookingReportFile';
import '../internal/LodgesDashboard.css';
import './forms.css';
import './ReportsPanel.css';

const DOCUMENT_LABEL = {
  TAX_INVOICE: 'Tax invoice',
  BILL_OF_SUPPLY: 'Bill of supply',
  CASH_RECEIPT: 'Cash receipt',
};

const TABS = [
  { key: 'bookings', label: 'Bookings' },
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

function lastDayOfMonth(year, month) {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// For plain YYYY-MM-DD values (report day rows, the date pickers) — forced
// to UTC so the calendar date never shifts a day depending on the viewer's
// local timezone offset.
function formatDateOnly(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Actual arrival/departure clock time. The row already carries the date the
// stay was booked for, so only the time is shown; a stamp that fell on some
// other date (a checkout past midnight) carries its date too, or it would read
// as an impossibly early departure.
function formatClockTime(value, plannedDateIso) {
  const d = new Date(value);
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  const onDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (onDate === plannedDateIso) return time;
  return `${formatDateOnly(onDate)}, ${time}`;
}

// For real timestamps (an invoice's issued-at) — has its own timezone
// offset already, so no UTC forcing needed.
function formatTimestamp(value) {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ReportsPanel() {
  const session = getSession();
  const token = session?.token;

  const [tab, setTab] = useUrlState('tab', 'bookings');
  // A ?tab= this screen doesn't own falls back to the first tab rather than
  // matching nothing and rendering an empty page under an unselected strip.
  const activeTab = TABS.some((t) => t.key === tab) ? tab : 'bookings';
  const [fromDate, setFromDate] = useState(startOfMonthIso());
  const [toDate, setToDate] = useState(todayIso());
  const validRange = Boolean(fromDate && toDate && toDate >= fromDate);

  const [bookings, setBookings] = useState(null);
  const [bookingsError, setBookingsError] = useState('');
  // Drives the fetch, not just the download — an owner should see on screen
  // exactly the rows the file will contain.
  const [downloadBusy, setDownloadBusy] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [occupancy, setOccupancy] = useState(null);
  const [occupancyError, setOccupancyError] = useState('');
  const [gst, setGst] = useState(null);
  const [gstError, setGstError] = useState('');

  // The month picker and the From/To pair drive the same range — this reads
  // the range back as a month so picking "August 2026" keeps showing August
  // rather than blanking the moment the component re-renders.
  const monthValue = wholeMonthLabel(fromDate, toDate) ? fromDate.slice(0, 7) : '';

  const handleMonthChange = (value) => {
    if (!value) return;
    const [year, month] = value.split('-').map(Number);
    setFromDate(`${value}-01`);
    setToDate(`${value}-${String(lastDayOfMonth(year, month)).padStart(2, '0')}`);
  };

  useEffect(() => {
    if (!validRange) return;
    setBookings(null);
    setBookingsError('');
    setDownloadError('');
    apiGet(`/reports/bookings?fromDate=${fromDate}&toDate=${toDate}`, {
      token,
    })
      .then((data) => setBookings(data))
      .catch((err) =>
        setBookingsError(err instanceof ApiError ? err.message : 'Could not load the booking report.')
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  // The built PDF, held as an object URL so the browser's own viewer can show
  // it. Previewing the real file rather than an HTML lookalike means what is on
  // screen and what gets filed are the same bytes.
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);

  // An object URL pins its blob in memory until it is revoked, so the old one
  // goes whenever it is replaced and when the panel unmounts.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const handlePreview = async () => {
    if (!bookings) return;
    if (previewUrl) {
      setPreviewUrl('');
      return;
    }
    setDownloadError('');
    setPreviewBusy(true);
    try {
      setPreviewUrl(URL.createObjectURL(await buildBookingReportPdf(bookings)));
    } catch {
      setDownloadError('Could not build the PDF preview.');
    } finally {
      setPreviewBusy(false);
    }
  };

  const handleDownload = async (format) => {
    if (!bookings) return;
    setDownloadError('');
    setDownloadBusy(format);
    try {
      if (format === 'excel') {
        await downloadBookingReportExcel(bookings);
      } else {
        await downloadBookingReportPdf(bookings);
      }
    } catch {
      setDownloadError(`Could not build the ${format.toUpperCase()} file.`);
    } finally {
      setDownloadBusy('');
    }
  };

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
        <div className="field-row field-row--triple">
          <div className="field">
            <label htmlFor="reportsMonth">Month</label>
            <input
              id="reportsMonth"
              type="month"
              value={monthValue}
              onChange={(e) => handleMonthChange(e.target.value)}
            />
          </div>
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
        {!validRange ? (
          <p className="reports-panel__hint">Choose a valid date range.</p>
        ) : (
          <p className="reports-panel__hint">
            Showing {reportPeriodLabel(fromDate, toDate)}. Pick a month for a full monthly report, or
            set From and To for any other span.
          </p>
        )}
      </div>

      <div className="reports-panel__subtabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="reports-panel__subtabs-item"
            aria-current={activeTab === t.key ? 'page' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'bookings' && (
        <>
          {bookingsError && (
            <div className="dash-card">
              <div className="dash-state">{bookingsError}</div>
            </div>
          )}
          {!bookingsError && validRange && !bookings && (
            <div className="dash-card">
              <div className="dash-state">Loading…</div>
            </div>
          )}
          {!bookingsError && bookings && (
            <>
              <div className="reports-panel__stat-grid">
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Bookings</span>
                  <span className="reports-panel__stat-value">{bookings.summary.totalBookings}</span>
                </div>
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Checked out</span>
                  <span className="reports-panel__stat-value">
                    {bookings.summary.byStatus.CHECKED_OUT || 0}
                  </span>
                </div>
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Cancelled</span>
                  <span className="reports-panel__stat-value">
                    {bookings.summary.byStatus.CANCELLED || 0}
                  </span>
                </div>
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Room nights</span>
                  <span className="reports-panel__stat-value">{bookings.summary.roomNights}</span>
                </div>
                <div className="reports-panel__stat reports-panel__stat--accent">
                  <span className="reports-panel__stat-label">Billed</span>
                  <span className="reports-panel__stat-value">
                    {formatPrice(bookings.summary.billedAmount)}
                  </span>
                </div>
              </div>

              <div className="dash-card reports-panel__download">
                <div>
                  <p className="reports-panel__download-title">
                    Download the {reportPeriodLabel(fromDate, toDate)} booking report
                  </p>
                  <p className="reports-panel__hint">
                    Excel has a Summary sheet and a Bookings sheet, with real numbers you can total.
                    PDF is print-ready for filing or sharing.
                  </p>
                </div>
                <div className="reports-panel__download-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={previewBusy || Boolean(downloadBusy)}
                    onClick={handlePreview}
                  >
                    {previewBusy ? 'Building…' : previewUrl ? 'Hide preview' : 'Preview PDF'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={Boolean(downloadBusy)}
                    onClick={() => handleDownload('excel')}
                  >
                    {downloadBusy === 'excel' ? 'Preparing…' : 'Download Excel'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={Boolean(downloadBusy)}
                    onClick={() => handleDownload('pdf')}
                  >
                    {downloadBusy === 'pdf' ? 'Preparing…' : 'Download PDF'}
                  </button>
                </div>
                {downloadError && <p className="reports-panel__hint">{downloadError}</p>}
                {previewUrl && (
                  <iframe
                    className="reports-panel__preview"
                    src={previewUrl}
                    title="Booking report preview"
                  />
                )}
              </div>

              {bookings.bookings.length === 0 ? (
                <div className="dash-card">
                  <div className="dash-state">
                    No bookings arrived in this period.
                  </div>
                </div>
              ) : (
                <div className="dash-card">
                  <div className="dash-table-scroll">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Bill no.</th>
                          <th>Guest</th>
                          <th>Room</th>
                          <th>Check-in</th>
                          <th>Check-out</th>
                          <th>Nights</th>
                          <th>Status</th>
                          <th>Advance</th>
                          <th>Discount</th>
                          <th>Taxable value</th>
                          <th>CGST</th>
                          <th>SGST</th>
                          <th>Round off</th>
                          <th>Billed</th>
                          <th>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bookings.bookings.map((b) => (
                          <tr key={b.id}>
                            <td>{b.invoiceNumber || '—'}</td>
                            <td>
                              {b.guestName}
                              <br />
                              <span className="reports-panel__muted">{b.guestPhone}</span>
                            </td>
                            <td>
                              {b.roomNumber}
                              <br />
                              <span className="reports-panel__muted">{b.categoryName}</span>
                            </td>
                            <td>
                              {formatDateOnly(b.checkInDate)}
                              <br />
                              <span className="reports-panel__muted">
                                {b.actualCheckInAt
                                  ? `In ${formatClockTime(b.actualCheckInAt, b.checkInDate)}`
                                  : 'Not arrived'}
                              </span>
                            </td>
                            <td>
                              {formatDateOnly(b.checkOutDate)}
                              <br />
                              <span className="reports-panel__muted">
                                {b.actualCheckOutAt
                                  ? `Out ${formatClockTime(b.actualCheckOutAt, b.checkOutDate)}`
                                  : 'Not checked out'}
                              </span>
                            </td>
                            <td>{b.nights}</td>
                            <td>
                              <span
                                className={`badge ${b.status === 'CANCELLED' ? 'badge--off' : 'badge--on'}`}
                              >
                                {BOOKING_STATUS_LABEL[b.status] || b.status}
                              </span>
                            </td>
                            <td>
                              {b.advanceAmount ? formatPrice(b.advanceAmount) : '—'}
                              {Boolean(b.advanceAmount) && b.advanceTenders?.length > 0 && (
                                <>
                                  <br />
                                  <span className="reports-panel__muted">{tendersLabel(b.advanceTenders)}</span>
                                </>
                              )}
                            </td>
                            <td>{b.discountAmount != null ? formatPrice(b.discountAmount) : '—'}</td>
                            <td>{b.taxableValue != null ? formatPrice(b.taxableValue) : '—'}</td>
                            <td>{b.cgstAmount != null ? formatPrice(b.cgstAmount) : '—'}</td>
                            <td>{b.sgstAmount != null ? formatPrice(b.sgstAmount) : '—'}</td>
                            <td>{b.roundOff != null ? formatPrice(b.roundOff) : '—'}</td>
                            <td>
                              {b.billedAmount != null ? (
                                <>
                                  {formatPrice(b.billedAmount)}
                                  <br />
                                  <span className="reports-panel__muted">
                                    {DOCUMENT_TYPE_LABEL[b.documentType] || b.documentType}
                                  </span>
                                </>
                              ) : (
                                <>
                                  —
                                  <br />
                                  <span className="reports-panel__muted">
                                    Not billed · booked {formatPrice(b.totalPrice)}
                                  </span>
                                </>
                              )}
                            </td>
                            <td>
                              {b.balanceCollected ? formatPrice(b.balanceCollected) : '—'}
                              {Boolean(b.balanceCollected) && b.balanceTenders?.length > 0 && (
                                <>
                                  <br />
                                  <span className="reports-panel__muted">{tendersLabel(b.balanceTenders)}</span>
                                </>
                              )}
                            </td>
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

      {activeTab === 'occupancy' && (
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

      {activeTab === 'gst' && (
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
