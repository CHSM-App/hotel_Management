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
export default function StayViewModal({ bookingId, onClose }) {
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
            <h3>Stay Details</h3>
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
          <div className="billing-panel__actions stay-view__actions">
            <button type="button" className="btn-secondary" onClick={close}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
