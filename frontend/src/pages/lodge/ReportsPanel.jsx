import { useEffect, useMemo, useState } from 'react';
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
import {
  downloadEventsReportExcel,
  buildEventsReportPdf,
  downloadEventsReportPdf,
} from './eventReportFile';
import {
  downloadFoodOrdersReportExcel,
  buildFoodOrdersReportPdf,
  downloadFoodOrdersReportPdf,
} from './foodOrderReportFile';
import '../internal/LodgesDashboard.css';
import './forms.css';
import './ReportsPanel.css';

const DOCUMENT_LABEL = {
  TAX_INVOICE: 'Tax invoice',
  BILL_OF_SUPPLY: 'Bill of supply',
  CASH_RECEIPT: 'Cash receipt',
};

const ALL_TABS = [
  { key: 'bookings', label: 'Bookings', capability: 'hasRooms' },
  { key: 'occupancy', label: 'Occupancy', capability: 'hasRooms' },
  { key: 'gst', label: 'GST summary' },
  { key: 'events', label: 'Events & functions', capability: 'hasEvents' },
  { key: 'food', label: 'Food orders', capability: 'servesFood' },
];

const EVENT_TYPE_LABEL = {
  BIRTHDAY: 'Birthday',
  WEDDING: 'Wedding',
  RECEPTION: 'Reception',
  ENGAGEMENT: 'Engagement',
  CORPORATE: 'Corporate',
  OTHER: 'Other',
};

const EVENT_STATUS_LABEL = {
  ENQUIRY: 'Enquiry',
  TENTATIVE: 'Tentative',
  CONFIRMED: 'Confirmed',
  SETTLED: 'Settled',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

const ORDER_STATUS_LABEL = {
  PENDING: 'Pending',
  QUEUED: 'Queued',
  PREPARING: 'Preparing',
  READY: 'Ready',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

const ORDER_SOURCE_LABEL = {
  ROOM: 'Room',
  TABLE: 'Table',
  COUNTER: 'Counter',
};

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

// Sorting a report table by clicking its header. `accessors` maps a column
// key to a function reading the value that column sorts by — not what the
// cell renders, since several columns (guest name + phone, amount + tenders)
// print more than one field in one <td>. Undefined/null sink to the bottom
// regardless of direction, so an empty balance or a not-yet-billed row never
// jumps to the top just because "ascending" treats it as smaller than zero.
function useSortedRows(rows, accessors, initialKey) {
  const [sort, setSort] = useState({ key: initialKey ?? null, dir: 'asc' });

  const sorted = useMemo(() => {
    if (!sort.key || !rows) return rows;
    const getValue = accessors[sort.key];
    if (!getValue) return rows;
    const withIndex = rows.map((row, index) => ({ row, index }));
    withIndex.sort((a, b) => {
      const av = getValue(a.row);
      const bv = getValue(b.row);
      const aEmpty = av == null || av === '';
      const bEmpty = bv == null || bv === '';
      if (aEmpty && bEmpty) return a.index - b.index;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      let cmp;
      if (typeof av === 'string' || typeof bv === 'string') {
        cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true });
      } else {
        cmp = av < bv ? -1 : av > bv ? 1 : 0;
      }
      if (cmp === 0) cmp = a.index - b.index;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return withIndex.map((w) => w.row);
  }, [rows, accessors, sort]);

  const toggle = (key) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  };

  return [sorted, sort, toggle];
}

// A <th> that sorts its table on click. Plain header cells (nothing worth
// ordering by, like a co-guest breakdown) just render the label as before by
// leaving sortKey unset.
function SortTh({ label, sortKey, sort, onSort, className }) {
  if (!sortKey) return <th className={className}>{label}</th>;
  const active = sort.key === sortKey;
  return (
    <th className={className}>
      <button
        type="button"
        className="reports-panel__sort-th"
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        onClick={() => onSort(sortKey)}
      >
        {label}
        <span className="reports-panel__sort-icon" aria-hidden="true">
          {active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </button>
    </th>
  );
}

export default function ReportsPanel({ lodge }) {
  const session = getSession();
  const token = session?.token;

  // A property only sees the reports its own capabilities can produce — a
  // restaurant with no rooms gets no Bookings tab, a lodge with no function
  // hall gets no Events tab. Same gate OwnerDashboard applies to the sidebar.
  const TABS = ALL_TABS.filter((t) => !t.capability || Boolean(lodge?.[t.capability]));
  const [tab, setTab] = useUrlState('tab', 'bookings');
  // A ?tab= this screen doesn't own falls back to the first available tab
  // rather than matching nothing and rendering an empty page under an
  // unselected strip.
  const activeTab = TABS.some((t) => t.key === tab) ? tab : TABS[0]?.key;
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
  const [events, setEvents] = useState(null);
  const [eventsError, setEventsError] = useState('');
  const [foodOrders, setFoodOrders] = useState(null);
  const [foodOrdersError, setFoodOrdersError] = useState('');

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

  // Events tab's own preview/download pair — same shape as the booking
  // report's, kept separate since each builds a different document from a
  // different report payload.
  const [eventsDownloadBusy, setEventsDownloadBusy] = useState('');
  const [eventsDownloadError, setEventsDownloadError] = useState('');
  const [eventsPreviewUrl, setEventsPreviewUrl] = useState('');
  const [eventsPreviewBusy, setEventsPreviewBusy] = useState(false);

  useEffect(() => () => { if (eventsPreviewUrl) URL.revokeObjectURL(eventsPreviewUrl); }, [eventsPreviewUrl]);

  const handleEventsPreview = async () => {
    if (!events) return;
    if (eventsPreviewUrl) {
      setEventsPreviewUrl('');
      return;
    }
    setEventsDownloadError('');
    setEventsPreviewBusy(true);
    try {
      setEventsPreviewUrl(URL.createObjectURL(await buildEventsReportPdf(events)));
    } catch {
      setEventsDownloadError('Could not build the PDF preview.');
    } finally {
      setEventsPreviewBusy(false);
    }
  };

  const handleEventsDownload = async (format) => {
    if (!events) return;
    setEventsDownloadError('');
    setEventsDownloadBusy(format);
    try {
      if (format === 'excel') {
        await downloadEventsReportExcel(events);
      } else {
        await downloadEventsReportPdf(events);
      }
    } catch {
      setEventsDownloadError(`Could not build the ${format.toUpperCase()} file.`);
    } finally {
      setEventsDownloadBusy('');
    }
  };

  // Food orders tab's own preview/download pair.
  const [foodDownloadBusy, setFoodDownloadBusy] = useState('');
  const [foodDownloadError, setFoodDownloadError] = useState('');
  const [foodPreviewUrl, setFoodPreviewUrl] = useState('');
  const [foodPreviewBusy, setFoodPreviewBusy] = useState(false);

  useEffect(() => () => { if (foodPreviewUrl) URL.revokeObjectURL(foodPreviewUrl); }, [foodPreviewUrl]);

  const handleFoodPreview = async () => {
    if (!foodOrders) return;
    if (foodPreviewUrl) {
      setFoodPreviewUrl('');
      return;
    }
    setFoodDownloadError('');
    setFoodPreviewBusy(true);
    try {
      setFoodPreviewUrl(URL.createObjectURL(await buildFoodOrdersReportPdf(foodOrders)));
    } catch {
      setFoodDownloadError('Could not build the PDF preview.');
    } finally {
      setFoodPreviewBusy(false);
    }
  };

  const handleFoodDownload = async (format) => {
    if (!foodOrders) return;
    setFoodDownloadError('');
    setFoodDownloadBusy(format);
    try {
      if (format === 'excel') {
        await downloadFoodOrdersReportExcel(foodOrders);
      } else {
        await downloadFoodOrdersReportPdf(foodOrders);
      }
    } catch {
      setFoodDownloadError(`Could not build the ${format.toUpperCase()} file.`);
    } finally {
      setFoodDownloadBusy('');
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

  useEffect(() => {
    if (!validRange || activeTab !== 'events') return;
    setEvents(null);
    setEventsError('');
    apiGet(`/reports/events?fromDate=${fromDate}&toDate=${toDate}`, { token })
      .then((data) => setEvents(data))
      .catch((err) => setEventsError(err instanceof ApiError ? err.message : 'Could not load the events report.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, activeTab]);

  useEffect(() => {
    if (!validRange || activeTab !== 'food') return;
    setFoodOrders(null);
    setFoodOrdersError('');
    apiGet(`/reports/food-orders?fromDate=${fromDate}&toDate=${toDate}`, { token })
      .then((data) => setFoodOrders(data))
      .catch((err) => setFoodOrdersError(err instanceof ApiError ? err.message : 'Could not load the food orders report.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, activeTab]);

  const bookingSortAccessors = useMemo(
    () => ({
      invoiceNumber: (b) => b.invoiceNumber,
      guestName: (b) => b.guestName,
      roomNumber: (b) => b.roomNumber,
      checkInDate: (b) => b.checkInDate,
      checkOutDate: (b) => b.checkOutDate,
      nights: (b) => b.nights,
      status: (b) => b.status,
      advanceAmount: (b) => b.advanceAmount,
      discountAmount: (b) => b.discountAmount,
      taxableValue: (b) => b.taxableValue,
      cgstAmount: (b) => b.cgstAmount,
      sgstAmount: (b) => b.sgstAmount,
      roundOff: (b) => b.roundOff,
      billedAmount: (b) => b.billedAmount,
      balanceCollected: (b) => b.balanceCollected,
    }),
    []
  );
  const [sortedBookings, bookingSort, toggleBookingSort] = useSortedRows(
    bookings?.bookings,
    bookingSortAccessors
  );

  const occupancySortAccessors = useMemo(
    () => ({
      date: (d) => d.date,
      occupiedRooms: (d) => d.occupiedRooms,
      occupancyPercent: (d) => d.occupancyPercent,
    }),
    []
  );
  const [sortedOccupancyDays, occupancySort, toggleOccupancySort] = useSortedRows(
    occupancy?.days,
    occupancySortAccessors
  );

  const documentTypeRowObjects = useMemo(
    () => (gst ? Object.entries(gst.byDocumentType).map(([type, t]) => ({ type, ...t })) : []),
    [gst]
  );
  const documentTypeSortAccessors = useMemo(
    () => ({
      type: (r) => DOCUMENT_LABEL[r.type] || r.type,
      count: (r) => r.count,
      roomSubtotal: (r) => r.roomSubtotal,
      cgstAmount: (r) => r.cgstAmount,
      sgstAmount: (r) => r.sgstAmount,
      totalAmount: (r) => r.totalAmount,
    }),
    []
  );
  const [sortedDocumentTypeRows, documentTypeSort, toggleDocumentTypeSort] = useSortedRows(
    documentTypeRowObjects,
    documentTypeSortAccessors
  );

  const gstInvoiceSortAccessors = useMemo(
    () => ({
      invoiceNumber: (inv) => inv.invoiceNumber,
      createdAt: (inv) => inv.createdAt,
      guestName: (inv) => inv.guestName,
      documentType: (inv) => DOCUMENT_LABEL[inv.documentType] || inv.documentType,
      cgstAmount: (inv) => inv.cgstAmount,
      sgstAmount: (inv) => inv.sgstAmount,
      totalAmount: (inv) => inv.totalAmount,
    }),
    []
  );
  const [sortedGstInvoices, gstInvoiceSort, toggleGstInvoiceSort] = useSortedRows(
    gst?.invoices,
    gstInvoiceSortAccessors
  );

  const eventSortAccessors = useMemo(
    () => ({
      invoiceNumber: (ev) => ev.invoiceNumber,
      title: (ev) => ev.title,
      organiserName: (ev) => ev.organiserName,
      venueName: (ev) => ev.venueName,
      startAt: (ev) => ev.startAt,
      pax: (ev) => ev.finalPax ?? ev.guaranteedPax ?? ev.expectedPax,
      status: (ev) => ev.status,
      advanceAmount: (ev) => ev.advanceAmount,
      totalAmount: (ev) => ev.totalAmount,
      balanceDue: (ev) => ev.balanceDue,
    }),
    []
  );
  const [sortedEvents, eventSort, toggleEventSort] = useSortedRows(events?.events, eventSortAccessors);

  const foodOrderSortAccessors = useMemo(
    () => ({
      orderNumber: (o) => o.orderNumber,
      placedAt: (o) => o.placedAt,
      source: (o) => o.source,
      guestName: (o) => o.guestName,
      itemCount: (o) => o.itemCount,
      status: (o) => o.status,
      invoiceNumber: (o) => o.invoiceNumber,
      subtotal: (o) => o.subtotal,
    }),
    []
  );
  const [sortedFoodOrders, foodOrderSort, toggleFoodOrderSort] = useSortedRows(
    foodOrders?.orders,
    foodOrderSortAccessors
  );

  return (
    <div className="reports-panel">
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

      <div className="dash-card reports-panel__filters">
        <p className="reports-panel__filters-heading">Report period</p>
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
            <input
              id="reportsToDate"
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
        </div>
        {!validRange ? (
          <p className="reports-panel__hint">Choose a valid date range.</p>
        ) : (
          <p className="reports-panel__hint">
            Showing <strong>{reportPeriodLabel(fromDate, toDate)}</strong>. Pick a month for a full monthly
            report, or set From and To for any other span.
          </p>
        )}
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
                <div className="reports-panel__stat reports-panel__stat--positive">
                  <span className="reports-panel__stat-label">Advance collected</span>
                  <span className="reports-panel__stat-value">
                    {formatPrice(bookings.summary.collections.advanceCollected)}
                  </span>
                </div>
                <div className="reports-panel__stat reports-panel__stat--positive">
                  <span className="reports-panel__stat-label">Total collected</span>
                  <span className="reports-panel__stat-value">
                    {formatPrice(bookings.summary.collections.totalCollected)}
                  </span>
                </div>
                {/* Only when a cancellation actually kept money — a zero here
                    would just make the grid wider on every quiet month. */}
                {Number(bookings.summary.cancellationChargesKept) > 0 && (
                  <div className="reports-panel__stat reports-panel__stat--warning">
                    <span className="reports-panel__stat-label">Cancellation charges</span>
                    <span className="reports-panel__stat-value">
                      {formatPrice(bookings.summary.cancellationChargesKept)}
                    </span>
                  </div>
                )}
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

              <p className="reports-panel__section-label">Booking register</p>

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
                          <SortTh label="Bill no." sortKey="invoiceNumber" sort={bookingSort} onSort={toggleBookingSort} />
                          <SortTh label="Guest" sortKey="guestName" sort={bookingSort} onSort={toggleBookingSort} />
                          <SortTh label="Room" sortKey="roomNumber" sort={bookingSort} onSort={toggleBookingSort} />
                          <SortTh label="Check-in" sortKey="checkInDate" sort={bookingSort} onSort={toggleBookingSort} />
                          <SortTh label="Check-out" sortKey="checkOutDate" sort={bookingSort} onSort={toggleBookingSort} />
                          <SortTh label="Nights" sortKey="nights" sort={bookingSort} onSort={toggleBookingSort} />
                          <SortTh label="Status" sortKey="status" sort={bookingSort} onSort={toggleBookingSort} />
                          <SortTh label="Advance" sortKey="advanceAmount" sort={bookingSort} onSort={toggleBookingSort} />
                          <SortTh label="Discount" sortKey="discountAmount" sort={bookingSort} onSort={toggleBookingSort} />
                          <SortTh label="Taxable value" sortKey="taxableValue" sort={bookingSort} onSort={toggleBookingSort} />
                          <SortTh label="CGST" sortKey="cgstAmount" sort={bookingSort} onSort={toggleBookingSort} />
                          <SortTh label="SGST" sortKey="sgstAmount" sort={bookingSort} onSort={toggleBookingSort} />
                          <SortTh label="Round off" sortKey="roundOff" sort={bookingSort} onSort={toggleBookingSort} />
                          <SortTh label="Billed" sortKey="billedAmount" sort={bookingSort} onSort={toggleBookingSort} />
                          <SortTh label="Balance" sortKey="balanceCollected" sort={bookingSort} onSort={toggleBookingSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedBookings.map((b) => (
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
                <div className="reports-panel__stat reports-panel__stat--accent">
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

              <p className="reports-panel__section-label">Daily occupancy</p>

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
                          <SortTh label="Date" sortKey="date" sort={occupancySort} onSort={toggleOccupancySort} />
                          <SortTh label="Occupied" sortKey="occupiedRooms" sort={occupancySort} onSort={toggleOccupancySort} />
                          <SortTh label="Occupancy" sortKey="occupancyPercent" sort={occupancySort} onSort={toggleOccupancySort} />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedOccupancyDays.map((d) => (
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

              {documentTypeRowObjects.length > 0 && (
                <>
                  <p className="reports-panel__section-label">By document type</p>
                  <div className="dash-card">
                    <div className="dash-table-scroll">
                      <table className="dash-table">
                        <thead>
                          <tr>
                            <SortTh label="Document type" sortKey="type" sort={documentTypeSort} onSort={toggleDocumentTypeSort} />
                            <SortTh label="Count" sortKey="count" sort={documentTypeSort} onSort={toggleDocumentTypeSort} />
                            <SortTh label="Room charges" sortKey="roomSubtotal" sort={documentTypeSort} onSort={toggleDocumentTypeSort} />
                            <SortTh label="CGST" sortKey="cgstAmount" sort={documentTypeSort} onSort={toggleDocumentTypeSort} />
                            <SortTh label="SGST" sortKey="sgstAmount" sort={documentTypeSort} onSort={toggleDocumentTypeSort} />
                            <SortTh label="Total" sortKey="totalAmount" sort={documentTypeSort} onSort={toggleDocumentTypeSort} />
                          </tr>
                        </thead>
                        <tbody>
                          {sortedDocumentTypeRows.map((t) => (
                            <tr key={t.type}>
                              <td>{DOCUMENT_LABEL[t.type] || t.type}</td>
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
                </>
              )}

              <p className="reports-panel__section-label">Bills issued</p>

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
                          <SortTh label="Invoice" sortKey="invoiceNumber" sort={gstInvoiceSort} onSort={toggleGstInvoiceSort} />
                          <SortTh label="Date" sortKey="createdAt" sort={gstInvoiceSort} onSort={toggleGstInvoiceSort} />
                          <SortTh label="Guest" sortKey="guestName" sort={gstInvoiceSort} onSort={toggleGstInvoiceSort} />
                          <SortTh label="Type" sortKey="documentType" sort={gstInvoiceSort} onSort={toggleGstInvoiceSort} />
                          <SortTh label="CGST" sortKey="cgstAmount" sort={gstInvoiceSort} onSort={toggleGstInvoiceSort} />
                          <SortTh label="SGST" sortKey="sgstAmount" sort={gstInvoiceSort} onSort={toggleGstInvoiceSort} />
                          <SortTh label="Total" sortKey="totalAmount" sort={gstInvoiceSort} onSort={toggleGstInvoiceSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedGstInvoices.map((inv) => (
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

      {activeTab === 'events' && (
        <>
          {eventsError && (
            <div className="dash-card">
              <div className="dash-state">{eventsError}</div>
            </div>
          )}
          {!eventsError && validRange && !events && (
            <div className="dash-card">
              <div className="dash-state">Loading…</div>
            </div>
          )}
          {!eventsError && events && (
            <>
              <div className="reports-panel__stat-grid">
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Functions</span>
                  <span className="reports-panel__stat-value">{events.summary.totalEvents}</span>
                </div>
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Settled</span>
                  <span className="reports-panel__stat-value">{events.summary.byStatus.SETTLED || 0}</span>
                </div>
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Confirmed</span>
                  <span className="reports-panel__stat-value">{events.summary.byStatus.CONFIRMED || 0}</span>
                </div>
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Cancelled</span>
                  <span className="reports-panel__stat-value">{events.summary.cancelled.count}</span>
                </div>
                <div className="reports-panel__stat reports-panel__stat--accent">
                  <span className="reports-panel__stat-label">Total value</span>
                  <span className="reports-panel__stat-value">{formatPrice(events.summary.totals.totalAmount)}</span>
                </div>
                <div className="reports-panel__stat reports-panel__stat--positive">
                  <span className="reports-panel__stat-label">Advance held</span>
                  <span className="reports-panel__stat-value">{formatPrice(events.summary.totals.advanceAmount)}</span>
                </div>
              </div>

              <div className="dash-card reports-panel__download">
                <div>
                  <p className="reports-panel__download-title">
                    Download the {reportPeriodLabel(fromDate, toDate)} events &amp; functions report
                  </p>
                  <p className="reports-panel__hint">
                    Excel has a Summary sheet and a Functions sheet, with real numbers you can total.
                    PDF is print-ready for filing or sharing.
                  </p>
                </div>
                <div className="reports-panel__download-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={eventsPreviewBusy || Boolean(eventsDownloadBusy)}
                    onClick={handleEventsPreview}
                  >
                    {eventsPreviewBusy ? 'Building…' : eventsPreviewUrl ? 'Hide preview' : 'Preview PDF'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={Boolean(eventsDownloadBusy)}
                    onClick={() => handleEventsDownload('excel')}
                  >
                    {eventsDownloadBusy === 'excel' ? 'Preparing…' : 'Download Excel'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={Boolean(eventsDownloadBusy)}
                    onClick={() => handleEventsDownload('pdf')}
                  >
                    {eventsDownloadBusy === 'pdf' ? 'Preparing…' : 'Download PDF'}
                  </button>
                </div>
                {eventsDownloadError && <p className="reports-panel__hint">{eventsDownloadError}</p>}
                {eventsPreviewUrl && (
                  <iframe
                    className="reports-panel__preview"
                    src={eventsPreviewUrl}
                    title="Events report preview"
                  />
                )}
              </div>

              <p className="reports-panel__section-label">Functions &amp; events</p>

              {events.events.length === 0 ? (
                <div className="dash-card">
                  <div className="dash-state">No functions in this period.</div>
                </div>
              ) : (
                <div className="dash-card">
                  <div className="dash-table-scroll">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <SortTh label="Bill no." sortKey="invoiceNumber" sort={eventSort} onSort={toggleEventSort} />
                          <SortTh label="Function" sortKey="title" sort={eventSort} onSort={toggleEventSort} />
                          <SortTh label="Organiser" sortKey="organiserName" sort={eventSort} onSort={toggleEventSort} />
                          <SortTh label="Venue" sortKey="venueName" sort={eventSort} onSort={toggleEventSort} />
                          <SortTh label="Date" sortKey="startAt" sort={eventSort} onSort={toggleEventSort} />
                          <SortTh label="Pax" sortKey="pax" sort={eventSort} onSort={toggleEventSort} />
                          <SortTh label="Status" sortKey="status" sort={eventSort} onSort={toggleEventSort} />
                          <SortTh label="Advance" sortKey="advanceAmount" sort={eventSort} onSort={toggleEventSort} />
                          <SortTh label="Total" sortKey="totalAmount" sort={eventSort} onSort={toggleEventSort} />
                          <SortTh label="Balance due" sortKey="balanceDue" sort={eventSort} onSort={toggleEventSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedEvents.map((ev) => (
                          <tr key={ev.id}>
                            <td>{ev.invoiceNumber || '—'}</td>
                            <td>
                              {ev.title}
                              <br />
                              <span className="reports-panel__muted">
                                {EVENT_TYPE_LABEL[ev.eventType] || ev.eventType}
                              </span>
                            </td>
                            <td>
                              {ev.organiserName}
                              <br />
                              <span className="reports-panel__muted">{ev.organiserPhone}</span>
                            </td>
                            <td>{ev.venueName}</td>
                            <td>{formatTimestamp(ev.startAt)}</td>
                            <td>{ev.finalPax ?? ev.guaranteedPax ?? ev.expectedPax}</td>
                            <td>
                              <span
                                className={`badge ${ev.status === 'CANCELLED' || ev.status === 'EXPIRED' ? 'badge--off' : 'badge--on'}`}
                              >
                                {EVENT_STATUS_LABEL[ev.status] || ev.status}
                              </span>
                            </td>
                            <td>{ev.advanceAmount ? formatPrice(ev.advanceAmount) : '—'}</td>
                            <td>{formatPrice(ev.totalAmount)}</td>
                            <td>{ev.balanceDue ? formatPrice(ev.balanceDue) : '—'}</td>
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

      {activeTab === 'food' && (
        <>
          {foodOrdersError && (
            <div className="dash-card">
              <div className="dash-state">{foodOrdersError}</div>
            </div>
          )}
          {!foodOrdersError && validRange && !foodOrders && (
            <div className="dash-card">
              <div className="dash-state">Loading…</div>
            </div>
          )}
          {!foodOrdersError && foodOrders && (
            <>
              <div className="reports-panel__stat-grid">
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Orders</span>
                  <span className="reports-panel__stat-value">{foodOrders.summary.totalOrders}</span>
                </div>
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Delivered</span>
                  <span className="reports-panel__stat-value">{foodOrders.summary.deliveredCount}</span>
                </div>
                <div className="reports-panel__stat">
                  <span className="reports-panel__stat-label">Cancelled</span>
                  <span className="reports-panel__stat-value">{foodOrders.summary.cancelledCount}</span>
                </div>
                <div className="reports-panel__stat reports-panel__stat--accent">
                  <span className="reports-panel__stat-label">Delivered value</span>
                  <span className="reports-panel__stat-value">{formatPrice(foodOrders.summary.deliveredValue)}</span>
                </div>
                <div className="reports-panel__stat reports-panel__stat--positive">
                  <span className="reports-panel__stat-label">Billed</span>
                  <span className="reports-panel__stat-value">
                    {foodOrders.summary.billedCount} · {formatPrice(foodOrders.summary.billedValue)}
                  </span>
                </div>
              </div>

              <div className="dash-card reports-panel__download">
                <div>
                  <p className="reports-panel__download-title">
                    Download the {reportPeriodLabel(fromDate, toDate)} food orders report
                  </p>
                  <p className="reports-panel__hint">
                    Excel has a Summary sheet and an Orders sheet, with real numbers you can total.
                    PDF is print-ready for filing or sharing.
                  </p>
                </div>
                <div className="reports-panel__download-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={foodPreviewBusy || Boolean(foodDownloadBusy)}
                    onClick={handleFoodPreview}
                  >
                    {foodPreviewBusy ? 'Building…' : foodPreviewUrl ? 'Hide preview' : 'Preview PDF'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={Boolean(foodDownloadBusy)}
                    onClick={() => handleFoodDownload('excel')}
                  >
                    {foodDownloadBusy === 'excel' ? 'Preparing…' : 'Download Excel'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={Boolean(foodDownloadBusy)}
                    onClick={() => handleFoodDownload('pdf')}
                  >
                    {foodDownloadBusy === 'pdf' ? 'Preparing…' : 'Download PDF'}
                  </button>
                </div>
                {foodDownloadError && <p className="reports-panel__hint">{foodDownloadError}</p>}
                {foodPreviewUrl && (
                  <iframe
                    className="reports-panel__preview"
                    src={foodPreviewUrl}
                    title="Food orders report preview"
                  />
                )}
              </div>

              <p className="reports-panel__section-label">Food orders</p>

              {foodOrders.orders.length === 0 ? (
                <div className="dash-card">
                  <div className="dash-state">No food orders in this period.</div>
                </div>
              ) : (
                <div className="dash-card">
                  <div className="dash-table-scroll">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <SortTh label="Order" sortKey="orderNumber" sort={foodOrderSort} onSort={toggleFoodOrderSort} />
                          <SortTh label="Placed" sortKey="placedAt" sort={foodOrderSort} onSort={toggleFoodOrderSort} />
                          <SortTh label="Source" sortKey="source" sort={foodOrderSort} onSort={toggleFoodOrderSort} />
                          <SortTh label="Guest" sortKey="guestName" sort={foodOrderSort} onSort={toggleFoodOrderSort} />
                          <SortTh label="Items" sortKey="itemCount" sort={foodOrderSort} onSort={toggleFoodOrderSort} />
                          <SortTh label="Status" sortKey="status" sort={foodOrderSort} onSort={toggleFoodOrderSort} />
                          <SortTh label="Bill no." sortKey="invoiceNumber" sort={foodOrderSort} onSort={toggleFoodOrderSort} />
                          <SortTh label="Amount" sortKey="subtotal" sort={foodOrderSort} onSort={toggleFoodOrderSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedFoodOrders.map((o) => (
                          <tr key={o.id}>
                            <td>#{o.orderNumber}</td>
                            <td>{formatTimestamp(o.placedAt)}</td>
                            <td>
                              {ORDER_SOURCE_LABEL[o.source] || o.source}
                              <br />
                              <span className="reports-panel__muted">
                                {o.roomNumber || o.tableLabel || '—'}
                              </span>
                            </td>
                            <td>{o.guestName || '—'}</td>
                            <td>{o.itemCount}</td>
                            <td>
                              <span
                                className={`badge ${o.status === 'CANCELLED' ? 'badge--off' : 'badge--on'}`}
                              >
                                {ORDER_STATUS_LABEL[o.status] || o.status}
                              </span>
                            </td>
                            <td>{o.invoiceNumber || '—'}</td>
                            <td>{formatPrice(o.subtotal)}</td>
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
