import { useEffect, useRef, useState } from 'react';
import { apiPost, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import AdvanceReceiptDocument from './AdvanceReceiptDocument';
import {
  BILL_PDF_WIDTH,
  DEFAULT_PAPER,
  PAPER_SIZES,
  buildDocumentPdfBlob,
  printDocumentOnPaper,
  shareOrDownloadPdf,
} from './billPaper';
import { formatPrice } from './priceFormat';
import './forms.css';
import './Billing.css';

// Issuing — and reprinting — the receipt for an advance taken at the desk.
//
// Two states in one modal, because they are one job: the desk types what the
// guest handed over, sees the document that produces, and issues it. Once
// issued the same modal becomes the print/share view, so "take the money" and
// "hand over the paper" are not two screens with a gap between them where the
// receipt never gets printed.
//
// The preview is fetched from the server rather than computed here on purpose:
// the tax inside an advance is banded off the stay's nightly tariff, and a
// second implementation of that in the browser would eventually disagree with
// the one that writes the document.

const ONLINE_PAYMENT_METHODS = ['UPI', 'CARD'];
const needsPaymentReference = (method) => ONLINE_PAYMENT_METHODS.includes(method);

function PaperSelect({ value, onChange }) {
  return (
    <label className="billing-panel__paper">
      <span className="billing-panel__paper-label">Paper</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Paper size for printing and PDF">
        {PAPER_SIZES.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label} — {p.hint}
          </option>
        ))}
      </select>
    </label>
  );
}

function LangSelect({ value, onChange }) {
  return (
    <label className="billing-panel__paper">
      <span className="billing-panel__paper-label">Language</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Receipt masthead language">
        <option value="en">English</option>
        <option value="mr">मराठी</option>
      </select>
    </label>
  );
}

// `booking` opens the modal ready to take an advance. `initialReceipt` opens it
// on a receipt that already exists — how the bills list reprints one — in which
// case there is no form, because the money was taken long ago.
export default function AdvanceReceiptModal({
  booking,
  initialReceipt = null,
  existingReceipts = [],
  onClose,
  onIssued,
  onVoided,
}) {
  const token = getSession()?.token;

  // The receipt on screen: a PREVIEW while the form is being filled, the issued
  // document once it exists. One piece of state because the printed sheet is
  // the same component either way — which is the point of previewing at all.
  const [receipt, setReceipt] = useState(initialReceipt);
  const [form, setForm] = useState({
    // Pre-filled with whatever advance the booking form already recorded, since
    // that is almost always the figure a receipt is now wanted for. The desk
    // can still change it — a guest paying in two goes is a real case.
    amountReceived: booking?.advanceAmount != null ? String(booking.advanceAmount) : '',
    paymentMethod: booking?.advancePaymentMethod ?? '',
    // Deliberately NOT pre-filled, unlike the two above. A transaction number
    // identifies one payment: carried over from an earlier one it would print a
    // reference that belongs to different money, and the settlement statement
    // would be reconciled against a number that was never charged. It has to be
    // read off the terminal for the payment actually being receipted.
    paymentReference: '',
  });
  const [error, setError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [paperSize, setPaperSize] = useState(DEFAULT_PAPER);
  const [lang, setLang] = useState('en');
  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState('');
  const [voidSubmitting, setVoidSubmitting] = useState(false);

  const previewRef = useRef(null);
  const captureRef = useRef(null);

  // Anything that already exists on the server — issued or since voided — is
  // past the form stage and only prints from here.
  const existing = receipt?.status === 'ISSUED' || receipt?.status === 'VOID';
  const issued = receipt?.status === 'ISSUED';
  // Only a booking can be billed an advance. Opened on an existing receipt
  // there is nothing to fill in, so the form never appears.
  const canIssue = Boolean(booking) && !existing;

  // What the desk is about to take, held against what the stay costs — shown
  // before the server is asked, so the obvious slip is caught under the cursor
  // rather than as a red banner after a round trip. The server enforces the
  // same rule; this is only the earlier, quieter half of it.
  const amount = Number(form.amountReceived);
  const alreadyHeld = Number(booking?.advanceAmount) || 0;
  const stayTotal = Number(booking?.totalPrice) || 0;

  // Whether there is enough on the form to price anything at all. Derived
  // rather than cleared inside the effect: a half-filled form has no receipt by
  // definition, and expressing that as state to be blanked means an extra
  // render pass on every keystroke that leaves the form incomplete.
  const formComplete =
    amount > 0 &&
    Boolean(form.paymentMethod) &&
    (!needsPaymentReference(form.paymentMethod) || form.paymentReference.trim() !== '');

  // What the document should show right now. Once issued it is the issued
  // receipt and the form no longer governs it; before that, a preview only
  // counts while the figures behind it are still complete.
  const shownReceipt = existing || formComplete ? receipt : null;

  // Re-previewed as the form changes, so the document on screen is always the
  // one the figures produce. Debounced: this is a network call per keystroke in
  // the amount box otherwise.
  useEffect(() => {
    if (!canIssue || !formComplete) return undefined;

    let cancelled = false;
    const timer = setTimeout(() => {
      setPreviewing(true);
      apiPost(
        `/billing/bookings/${booking.id}/advance-receipt/preview`,
        {
          amountReceived: amount,
          paymentMethod: form.paymentMethod,
          ...(needsPaymentReference(form.paymentMethod)
            ? { paymentReference: form.paymentReference.trim() }
            : {}),
        },
        { token }
      )
        .then((data) => {
          if (cancelled) return;
          setReceipt(data.receipt);
          setError('');
        })
        .catch((err) => {
          if (cancelled) return;
          setReceipt(null);
          setError(err instanceof ApiError ? err.message : 'Could not price this advance.');
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, form.paymentMethod, form.paymentReference, canIssue, formComplete, booking?.id]);

  const handleIssue = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const data = await apiPost(
        `/billing/bookings/${booking.id}/advance-receipt`,
        {
          amountReceived: amount,
          paymentMethod: form.paymentMethod,
          ...(needsPaymentReference(form.paymentMethod)
            ? { paymentReference: form.paymentReference.trim() }
            : {}),
        },
        { token }
      );
      setReceipt(data.receipt);
      // The booking now holds more advance than it did, and the screen behind
      // this modal is showing the old figure.
      onIssued?.(data.receipt);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not issue the receipt.');
    } finally {
      setSubmitting(false);
    }
  };

  // Voided in place, never deleted — an issued money document that vanishes is
  // a gap in the series nobody can account for. The server takes the advance
  // back off the booking with it.
  const handleVoid = async (e) => {
    e.preventDefault();
    if (voidReason.trim() === '') {
      setVoidError('Enter a reason for voiding this receipt.');
      return;
    }
    setVoidError('');
    setVoidSubmitting(true);
    try {
      const data = await apiPost(
        `/billing/advance-receipts/${receipt.id}/void`,
        { reason: voidReason.trim() },
        { token }
      );
      setReceipt(data.receipt);
      setShowVoidForm(false);
      setVoidReason('');
      onVoided?.(data.receipt);
    } catch (err) {
      setVoidError(err instanceof ApiError ? err.message : 'Could not void this receipt.');
    } finally {
      setVoidSubmitting(false);
    }
  };

  const handlePrint = () => printDocumentOnPaper(captureRef.current, paperSize);

  const handleSharePdf = async () => {
    setPdfError('');
    setPdfBusy(true);
    try {
      const blob = await buildDocumentPdfBlob(captureRef.current, {
        paperSize,
        shownWidth: previewRef.current?.offsetWidth,
      });
      await shareOrDownloadPdf(blob, `${(receipt.receiptNumber || 'advance-receipt').replace(/[\\/]/g, '-')}.pdf`);
    } catch (err) {
      // An aborted share sheet is the user changing their mind, not a failure.
      if (err?.name !== 'AbortError') {
        setPdfError('Could not generate the receipt PDF.');
      }
    } finally {
      setPdfBusy(false);
    }
  };

  // Reprint an earlier receipt against this booking, rather than issuing a
  // second one for money already acknowledged — the mistake this list exists to
  // prevent.
  const reprint = (earlier) => {
    setReceipt(earlier);
    setError('');
  };

  return (
    <div className="glass-backdrop billing-panel__backdrop" onClick={onClose}>
      <div className="glass-panel billing-panel__modal" onClick={(e) => e.stopPropagation()}>
        <div className="billing-panel__detail-header">
          <h3>{existing ? receipt.receiptNumber : 'Advance receipt'}</h3>
          <span className="billing-panel__detail-tags">
            <span className="bill-tag bill-tag--cash">
              {booking?.roomNumber ? `Room ${booking.roomNumber}` : 'Booking'}
            </span>
            {receipt?.status === 'VOID' && <span className="bill-tag bill-tag--void">Void</span>}
          </span>
        </div>

        {canIssue && (
          <>
            <p className="bookings-panel__hint">
              {booking?.guestName} · stay total {formatPrice(stayTotal)}
              {alreadyHeld > 0 ? ` · ${formatPrice(alreadyHeld)} advance already recorded` : ''}
            </p>

            <form onSubmit={handleIssue} className="form-section">
              <div className="field-row">
                <div className="field">
                  <label htmlFor="advanceReceiptAmount">Amount received</label>
                  <input
                    id="advanceReceiptAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amountReceived}
                    onChange={(e) => setForm((f) => ({ ...f, amountReceived: e.target.value }))}
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label htmlFor="advanceReceiptMethod">Payment type</label>
                  <select
                    id="advanceReceiptMethod"
                    value={form.paymentMethod}
                    onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                  >
                    <option value="">Choose one</option>
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="CARD">Card</option>
                  </select>
                </div>
              </div>

              {/* Only for money that left a trail. Asking for a reference
                  against cash would be asking for one to be invented. */}
              {needsPaymentReference(form.paymentMethod) && (
                <div className="field">
                  <label htmlFor="advanceReceiptReference">Transaction number</label>
                  <input
                    id="advanceReceiptReference"
                    value={form.paymentReference}
                    maxLength={64}
                    // Off on purpose. The browser would otherwise offer the
                    // last reference typed into this box on any booking, which
                    // is the same mistake as pre-filling it: one keystroke from
                    // printing a receipt carrying another payment's number.
                    autoComplete="off"
                    placeholder={form.paymentMethod === 'UPI' ? 'UPI reference / UTR' : 'Approval code'}
                    onChange={(e) => setForm((f) => ({ ...f, paymentReference: e.target.value }))}
                  />
                  <p className="bookings-panel__hint">
                    Printed on the receipt, and what the settlement statement is matched against at month end.
                  </p>
                </div>
              )}

              {error && <div className="form-banner form-banner--error">{error}</div>}

              {/* Every receipt already written against this stay. Shown while
                  the form is open rather than after, because the point of it is
                  to stop a second receipt being issued for the first one's
                  money. */}
              {existingReceipts.length > 0 && (
                <div className="chart-list">
                  {existingReceipts.map((earlier) => (
                    <div className="chart-row" key={earlier.id}>
                      <span className="chart-row__name">
                        {earlier.receiptNumber}
                        {earlier.status === 'VOID' && ' · void'}
                      </span>
                      <span className="chart-row__value">
                        {formatPrice(earlier.amountReceived)}
                        <button type="button" className="btn-secondary" onClick={() => reprint(earlier)}>
                          Reprint
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="billing-panel__actions">
                <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
                  Cancel
                </button>
                <button className="btn-accent" type="submit" disabled={submitting || !shownReceipt || previewing}>
                  {submitting ? 'Issuing…' : previewing ? 'Pricing…' : 'Issue receipt'}
                </button>
              </div>
            </form>
          </>
        )}

        {/* The document itself — the preview while the form is open, the issued
            receipt after. The wrapper carries the marker the print stylesheet
            keys off: the modal holds a second copy for the PDF, and only this
            one is the receipt. */}
        {shownReceipt && (
          <div className="bill-print-target">
            <AdvanceReceiptDocument ref={previewRef} receipt={shownReceipt} lang={lang} />
          </div>
        )}

        {/* What the PDF is rasterised from: the same document again, parked
            offscreen and sized at capture time to the width of the visible copy
            above — so the file shows exactly the layout the desk approved. The
            initial width matters, not just the capture-time one: a fixed box
            parked offscreen with width:auto can stretch to the viewport edge. */}
        {shownReceipt && (
          <div className="billing-panel__pdf-source" style={{ width: BILL_PDF_WIDTH }} aria-hidden="true">
            <AdvanceReceiptDocument ref={captureRef} receipt={shownReceipt} lang={lang} />
          </div>
        )}

        {pdfError && <div className="form-banner form-banner--error">{pdfError}</div>}

        {voidError && <div className="form-banner form-banner--error">{voidError}</div>}

        {existing && !showVoidForm && (
          <div className="billing-panel__actions">
            {/* Only a live receipt can be voided; a void one is already there. */}
            {issued && (
              <button
                type="button"
                className="billing-panel__danger-link"
                onClick={() => setShowVoidForm(true)}
              >
                Void this receipt
              </button>
            )}
            {/* Beside the two buttons it governs, because it governs both —
                printing and the download have to agree about the sheet. */}
            <PaperSelect value={paperSize} onChange={setPaperSize} />
            <LangSelect value={lang} onChange={setLang} />
            <button type="button" className="btn-secondary" onClick={onClose}>
              Done
            </button>
            <button type="button" className="btn-secondary" onClick={handlePrint}>
              Print
            </button>
            <button type="button" className="btn-accent" onClick={handleSharePdf} disabled={pdfBusy}>
              {pdfBusy ? 'Preparing…' : 'Share / Download PDF'}
            </button>
          </div>
        )}

        {existing && showVoidForm && (
          <form onSubmit={handleVoid} className="form-section">
            <div className="form-section__title">Reason for voiding</div>
            <div className="field">
              <input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g. Advance refunded to the guest"
                autoFocus
              />
              <p className="bookings-panel__hint">
                The advance comes back off the booking, so the balance at checkout is the full amount again.
              </p>
            </div>
            <div className="billing-panel__actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowVoidForm(false)}
                disabled={voidSubmitting}
              >
                Cancel
              </button>
              <button className="btn-accent" type="submit" disabled={voidSubmitting}>
                {voidSubmitting ? 'Voiding…' : 'Void receipt'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
