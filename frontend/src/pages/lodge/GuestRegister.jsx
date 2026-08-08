import { useEffect, useState } from 'react';
import { apiGet, apiGetBlob, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import '../internal/LodgesDashboard.css';
import './forms.css';
import './GuestRegister.css';

const STATUS_LABEL = { BOOKED: 'Booked', CHECKED_IN: 'Checked in', CHECKED_OUT: 'Checked out', CANCELLED: 'Cancelled' };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonthIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function formatDateLong(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Actual check-in/out timestamps — null until that event has actually
// happened (a BOOKED reservation has neither yet).
function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function GuestRegister() {
  const session = getSession();
  const token = session?.token;

  const [fromDate, setFromDate] = useState(startOfMonthIso());
  const [toDate, setToDate] = useState(todayIso());
  const [search, setSearch] = useState('');
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');

  const validRange = fromDate && toDate && toDate >= fromDate;

  useEffect(() => {
    if (!validRange) return;
    apiGet(`/bookings?fromDate=${fromDate}&toDate=${toDate}`, { token })
      .then((data) => {
        setBookings(data.bookings);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the guest register.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  const query = search.trim().toLowerCase();
  const filtered = bookings?.filter((b) => {
    if (!query) return true;
    return (
      b.guestName.toLowerCase().includes(query) ||
      b.roomNumber.toLowerCase().includes(query) ||
      (b.invoiceNumber || '').toLowerCase().includes(query) ||
      (b.guestPhone || '').includes(query)
    );
  });

  // Detail modal — fetches the full booking record on demand rather than
  // carrying every field (other guests, extras, ID proof) on every register
  // row, most of which a staffer never opens.
  const [detailBookingId, setDetailBookingId] = useState(null);
  const [detailBooking, setDetailBooking] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [idProofError, setIdProofError] = useState('');

  const openDetail = (bookingId) => {
    setDetailBookingId(bookingId);
    setDetailBooking(null);
    setDetailError('');
    setIdProofError('');
  };

  const closeDetail = () => setDetailBookingId(null);

  useEffect(() => {
    if (!detailBookingId) return;
    apiGet(`/bookings/${detailBookingId}`, { token })
      .then((data) => setDetailBooking(data.booking))
      .catch((err) => setDetailError(err instanceof ApiError ? err.message : 'Could not load this stay.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailBookingId]);

  const handleViewIdProof = async () => {
    setIdProofError('');
    try {
      const blob = await apiGetBlob(`/bookings/${detailBookingId}/id-proof`, { token });
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (err) {
      setIdProofError(err instanceof ApiError ? err.message : 'Could not open the ID proof.');
    }
  };

  const handleViewGuestIdProof = async (guestId) => {
    setIdProofError('');
    try {
      const blob = await apiGetBlob(`/bookings/${detailBookingId}/guests/${guestId}/id-proof`, { token });
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (err) {
      setIdProofError(err instanceof ApiError ? err.message : 'Could not open the ID proof.');
    }
  };

  const detailRow = detailBookingId ? bookings?.find((b) => b.id === detailBookingId) : null;

  return (
    <div className="guest-register">
      <div className="dash-card">
        <div className="field-row field-row--triple">
          <div className="field">
            <label htmlFor="fromDate">From</label>
            <input id="fromDate" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="toDate">To</label>
            <input id="toDate" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="search">Search</label>
            <input
              id="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Guest name, room, phone or bill no"
            />
          </div>
        </div>
        {!validRange && <p className="guest-register__hint">Choose a valid date range.</p>}
      </div>

      {error && (
        <div className="dash-card">
          <div className="dash-state">{error}</div>
        </div>
      )}

      {!error && validRange && !bookings && (
        <div className="dash-card">
          <div className="dash-state">Loading…</div>
        </div>
      )}

      {!error && bookings && filtered.length === 0 && (
        <div className="dash-card">
          <div className="dash-state">No guests in this date range.</div>
        </div>
      )}

      {!error && bookings && filtered.length > 0 && (
        <div className="dash-card">
          <div className="dash-table-scroll">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Bill No</th>
                  <th>Room</th>
                  <th>Guest</th>
                  <th>Amount</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.id}>
                    <td>{b.invoiceNumber || '—'}</td>
                    <td>
                      {b.roomNumber} · {b.categoryName}
                    </td>
                    <td>{b.guestName}</td>
                    <td>{formatPrice(b.billAmount)}</td>
                    <td>{formatDateTime(b.actualCheckInAt)}</td>
                    <td>{formatDateTime(b.actualCheckOutAt)}</td>
                    <td>
                      <span className={`badge ${b.status === 'CHECKED_IN' ? 'badge--on' : 'badge--off'}`}>
                        {STATUS_LABEL[b.status]}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="guest-register__view-details-btn"
                        onClick={() => openDetail(b.id)}
                      >
                        View details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailBookingId && (
        <div className="glass-backdrop guest-register__backdrop" onClick={closeDetail}>
          <div className="glass-panel guest-register__modal" onClick={(e) => e.stopPropagation()}>
            {detailError && <div className="form-banner form-banner--error">{detailError}</div>}

            {!detailError && !detailBooking && <div className="dash-state">Loading…</div>}

            {!detailError && detailBooking && (
              <>
                <div className="guest-register__detail-header">
                  <h3>{detailBooking.guestName}</h3>
                  <span className={`badge ${detailBooking.status === 'CHECKED_IN' ? 'badge--on' : 'badge--off'}`}>
                    {STATUS_LABEL[detailBooking.status]}
                  </span>
                </div>

                <div className="chart-list">
                  {detailRow?.invoiceNumber && (
                    <div className="chart-row">
                      <span className="chart-row__name">Bill No</span>
                      <span className="chart-row__value">{detailRow.invoiceNumber}</span>
                    </div>
                  )}
                  <div className="chart-row">
                    <span className="chart-row__name">Room</span>
                    <span className="chart-row__value">
                      {detailBooking.roomNumber} · {detailBooking.categoryName}
                    </span>
                  </div>
                  <div className="chart-row">
                    <span className="chart-row__name">Dates</span>
                    <span className="chart-row__value">
                      {formatDateLong(detailBooking.checkInDate)} – {formatDateLong(detailBooking.checkOutDate)}
                    </span>
                  </div>
                  <div className="chart-row">
                    <span className="chart-row__name">Check-in</span>
                    <span className="chart-row__value">{formatDateTime(detailBooking.actualCheckInAt)}</span>
                  </div>
                  <div className="chart-row">
                    <span className="chart-row__name">Check-out</span>
                    <span className="chart-row__value">{formatDateTime(detailBooking.actualCheckOutAt)}</span>
                  </div>
                  <div className="chart-row">
                    <span className="chart-row__name">Phone</span>
                    <span className="chart-row__value">{detailBooking.guestPhone}</span>
                  </div>
                  <div className="chart-row">
                    <span className="chart-row__name">Guests</span>
                    <span className="chart-row__value">{detailBooking.numGuests}</span>
                  </div>
                  {detailBooking.idProofType && (
                    <div className="chart-row">
                      <span className="chart-row__name">ID proof</span>
                      <span className="chart-row__value">
                        {detailBooking.idProofType}
                        {detailBooking.hasIdProofDocument && (
                          <button type="button" className="guest-register__view-btn" onClick={handleViewIdProof}>
                            View
                          </button>
                        )}
                      </span>
                    </div>
                  )}
                  {detailBooking.guests.length > 0 && (
                    <div className="chart-row">
                      <span className="chart-row__name">Other guests</span>
                      <span className="chart-row__value">
                        <div className="guest-register__guest-detail-list">
                          {detailBooking.guests.map((g) => (
                            <div key={g.id} className="guest-register__guest-detail">
                              {g.name}
                              {g.phone ? ` · ${g.phone}` : ''}
                              {g.idProofType ? ` · ${g.idProofType}` : ''}
                              {g.hasIdProofDocument && (
                                <button
                                  type="button"
                                  className="guest-register__view-btn"
                                  onClick={() => handleViewGuestIdProof(g.id)}
                                >
                                  View
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </span>
                    </div>
                  )}
                  {idProofError && (
                    <div className="chart-row">
                      <span className="chart-row__value form-banner form-banner--error">{idProofError}</span>
                    </div>
                  )}
                  {detailBooking.vehicleNumbers.length > 0 && (
                    <div className="chart-row">
                      <span className="chart-row__name">Vehicles</span>
                      <span className="chart-row__value">{detailBooking.vehicleNumbers.join(' · ')}</span>
                    </div>
                  )}
                  {detailBooking.switchableCharges.length > 0 && (
                    <div className="chart-row">
                      <span className="chart-row__name">Extras</span>
                      <span className="chart-row__value">
                        {detailBooking.switchableCharges.map((c) => c.name).join(' · ')}
                      </span>
                    </div>
                  )}
                  <div className="chart-row">
                    <span className="chart-row__name">Total price</span>
                    <span className="chart-row__value">{formatPrice(detailBooking.totalPrice)}</span>
                  </div>
                  {detailRow && detailRow.invoiceNumber && (
                    <div className="chart-row">
                      <span className="chart-row__name">Billed amount</span>
                      <span className="chart-row__value">{formatPrice(detailRow.billAmount)}</span>
                    </div>
                  )}
                  {detailBooking.advanceAmount != null && (
                    <div className="chart-row">
                      <span className="chart-row__name">Advance paid</span>
                      <span className="chart-row__value">
                        {formatPrice(detailBooking.advanceAmount)} ({detailBooking.advancePaymentMethod})
                      </span>
                    </div>
                  )}
                </div>

                <div className="guest-register__actions">
                  <button type="button" className="btn-secondary" onClick={closeDetail}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
