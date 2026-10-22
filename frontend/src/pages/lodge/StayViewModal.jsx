import { useEffect, useState } from 'react';
import { apiGet, apiGetBlob, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import PageLoader from '../../components/PageLoader';
import StaySummary from './StaySummary';
import { BedIcon } from '../../components/StaySummaryIcons';
import './forms.css';
import './chartSections.css';
import './stayDetails.css';
import './Billing.css';
import './Bookings.css';

// The read-only "Stay Details" modal Billing opens from a Ready to bill row's
// View button, lifted out so the guest register can open the identical one.
// Fetches the stay itself and owns the ID-proof preview.
const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

// onAction(name) hands the stay to the booking screen's own modal to run the
// step — 'cancel' | 'advance' | 'edit' | 'checkin' | 'checkout' — so every
// button here does exactly what it did in the register's previous detail modal.
export default function StayViewModal({ bookingId, onClose, onAction }) {
  const token = getSession()?.token;
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState('');
  const [idProofUrl, setIdProofUrl] = useState('');
  const [idProofError, setIdProofError] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiGet(`/bookings/${bookingId}`, { token })
      .then((data) => !cancelled && setBooking(data.booking))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : 'Could not load this stay.'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  // Same revoke-on-close handling as Billing's own viewer.
  const closeIdProof = () =>
    setIdProofUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
  useEffect(() => () => idProofUrl && URL.revokeObjectURL(idProofUrl), [idProofUrl]);

  const openIdProof = async (guestId) => {
    setIdProofError('');
    try {
      const path = guestId
        ? `/bookings/${bookingId}/guests/${guestId}/id-proof`
        : `/bookings/${bookingId}/id-proof`;
      const blob = await apiGetBlob(path, { token });
      setIdProofUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (err) {
      setIdProofError(err instanceof ApiError ? err.message : 'Could not open the ID proof.');
    }
  };

  const close = () => {
    closeIdProof();
    onClose();
  };

  return (
    <div className="glass-backdrop billing-panel__backdrop" onClick={close}>
      <div className="glass-panel billing-panel__modal stay-view" onClick={(e) => e.stopPropagation()}>
        <div className="billing-panel__detail-header">
          <div className="stay-view__title">
            <span className="stay-view__title-icon">
              <BedIcon />
            </span>
            <h3>Stay Details{booking?.bookingNumber ? ` · ${booking.bookingNumber}` : ''}</h3>
          </div>
          <button type="button" className="bill-close" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        {error && <div className="form-banner form-banner--error">{error}</div>}
        {!error && !booking && <PageLoader inline label="Loading" />}
        {!error && booking && (
          <StaySummary
            booking={booking}
            idProofError={idProofError}
            onViewIdProof={booking.hasIdProofDocument ? () => openIdProof() : undefined}
            onViewGuestIdProof={openIdProof}
          />
        )}
        {idProofUrl && (
          <div className="glass-backdrop billing-panel__backdrop" onClick={closeIdProof}>
            <div className="glass-panel modal-form__panel" role="dialog" aria-modal="true" aria-label="ID proof" onClick={(e) => e.stopPropagation()}>
              <div className="modal-form">
                <div className="modal-form__head">
                  <div className="modal-form__head-row">
                    <h3>ID proof</h3>
                    <button type="button" className="btn-secondary" onClick={closeIdProof}>
                      Close
                    </button>
                  </div>
                </div>
                <iframe className="id-proof-preview__frame" src={idProofUrl} title="ID proof" />
              </div>
            </div>
          </div>
        )}
        {!error && booking && (
          <StayActions booking={booking} onAction={(a) => { closeIdProof(); onAction?.(a); }} onClose={close} />
        )}
      </div>
    </div>
  );
}

// The same footer buttons, with the same conditions, as the booking detail
// modal this replaces.
function StayActions({ booking, onAction, onClose }) {
  const roomsAwaiting = (booking.rooms ?? []).filter((r) => r.status === 'BOOKED');
  const hasRoomAwaiting = roomsAwaiting.length > 0 || booking.status === 'BOOKED';
  const canEdit = booking.status !== 'CANCELLED' && !booking.hasIssuedInvoice;
  const checkedInRooms = (booking.rooms ?? []).filter((r) => r.status === 'CHECKED_IN').length;
  const checkInLabel =
    roomsAwaiting.length > 1 || (booking.rooms?.length > 1 && booking.status !== 'BOOKED')
      ? 'Check in remaining rooms'
      : booking.rooms?.length > 1
        ? 'Check in all rooms'
        : 'Check in';
  const canCheckInNow = roomsAwaiting.length > 0
    ? roomsAwaiting.some((r) => r.checkInDate <= todayIso())
    : booking.checkInDate <= todayIso();
  return (
    <div className="billing-panel__actions stay-view__actions stay-view__actions--stay">
      {booking.status === 'BOOKED' && (
        <button type="button" className="bookings-panel__danger-link" onClick={() => onAction('cancel')}>
          Cancel booking
        </button>
      )}
      {booking.status === 'CHECKED_OUT' && !canEdit && (
        <span className="bookings-panel__hint">This stay has been billed — extras are locked.</span>
      )}
      <span className="stay-view__actions-spacer" />
      <button type="button" className="btn-secondary" onClick={onClose}>
        Close
      </button>
      {booking.status !== 'CANCELLED' && booking.status !== 'CHECKED_OUT' && (
        <button type="button" className="btn-secondary" onClick={() => onAction('advance')}>
          Advance receipt
        </button>
      )}
      {canEdit && (
        <button type="button" className="btn-secondary" onClick={() => onAction('edit')}>
          Edit booking
        </button>
      )}
      {hasRoomAwaiting && (
        <button
          type="button"
          className="btn-accent"
          title={canCheckInNow ? undefined : 'Check-in opens on the reserved date.'}
          onClick={() => onAction('checkin')}
        >
          {checkInLabel}
        </button>
      )}
      {booking.status === 'CHECKED_IN' && (
        <button type="button" className="btn-accent" onClick={() => onAction('checkout')}>
          {checkedInRooms > 1 ? 'Check out all rooms' : 'Check out'}
        </button>
      )}
    </div>
  );
}
