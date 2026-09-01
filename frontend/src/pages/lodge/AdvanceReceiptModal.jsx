import { useMemo, useRef, useState } from 'react';
import { apiPost, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import AdvanceReceiptDocument from './AdvanceReceiptDocument';
import DownloadIcon from '../../components/DownloadIcon';
import ShareMenu from '../../components/ShareMenu';
import Req from '../../components/RequiredMark';
import {
  BILL_PDF_WIDTH,
  DEFAULT_PAPER,
  PAPER_SIZES,
  buildDocumentPdfBlob,
  printPdfBlob,
  downloadPdf,
  sharePdf,
  canShareFiles,
} from './billPaper';
import {
  buildMailLink,
  buildSmsLink,
  buildWhatsAppLink,
  openComposer,
  openExternal,
} from '../../lib/shareLinks';
import { formatPrice } from './priceFormat';
import PaymentLines from './PaymentLines';
import {
  emptyPaymentLine,
  needsPaymentReference,
  paymentLinesError,
  sumLines,
  toPaymentLines,
} from './paymentSplit';
import './forms.css';
import './Billing.css';

// Advances against a stay: what has been taken so far, and taking more.
//
// The advance entered on the booking form receipts itself — the server raises
// it the moment the money is recorded, so it is already here with its number by
// the time this opens. What this screen adds is the SECOND payment and the
// third: a guest who leaves ₹500 to hold a room in July and pays ₹500 more in
// August has taken two advances, and each is its own numbered document.
//
// Taking one here is a different act from the automatic one. There the money
// was already on the booking and the receipt only recorded it; here the money
// is arriving now, so the booking's advance goes up by what is taken.
//
// Opening it from a stay lands on the newest live receipt rather than a list,
// because most stays have exactly one and it was raised seconds ago. A stay
// that took its advance in two goes gets a picker above the document.
//
// Voiding stays here, and stays manual: an issued money document is corrected
// by a void that references it, never by deleting it or quietly re-issuing.

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
  onVoided,
  onTaken,
}) {
  const token = getSession()?.token;

  // The receipt on screen: a PREVIEW while the form is being filled, the issued
  // document once it exists. One piece of state because the printed sheet is
  // the same component either way — which is the point of previewing at all.
  const [receipt, setReceipt] = useState(initialReceipt);
  const [error, setError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  // Whether this device has a share sheet to hand the file to. A property of
  // the browser, not of the receipt, so it is asked once.
  const deviceShare = useMemo(() => canShareFiles(), []);
  const [paperSize, setPaperSize] = useState(DEFAULT_PAPER);
  const [lang, setLang] = useState('en');
  // Taking another advance. Blank rather than pre-filled with the booking's
  // figure: that number is money already taken, and offering it again is how a
  // desk accidentally doubles a deposit.
  const [form, setForm] = useState({ amountReceived: '' });
  // An advance handed over part cash, part UPI is still ONE receipt: one
  // number, one total, several ways it arrived.
  const [payLines, setPayLines] = useState([emptyPaymentLine()]);

  // Same rule as the booking form: what was received is however much the rows
  // add up to, so there is no separate Amount box to keep in agreement with
  // them. Blank rather than "0" when nothing has been entered, so the existing
  // "enter the amount received" check still fires on an empty form.
  const updatePayLines = (next) => {
    setPayLines(next);
    setForm((f) => ({ ...f, amountReceived: sumLines(next) > 0 ? String(sumLines(next)) : '' }));
  };
  const [taking, setTaking] = useState(false);
  const [showTakeForm, setShowTakeForm] = useState(false);

  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState('');
  const [voidSubmitting, setVoidSubmitting] = useState(false);

  const previewRef = useRef(null);
  const captureRef = useRef(null);

  // Anything that already exists on the server — issued or since voided — is
  // past the form stage and only prints from here.
  // Opened from a booking rather than on a particular receipt, the newest live
  // one is what the desk means — most stays have exactly one, and the money for
  // it was taken seconds ago. Derived rather than selected in an effect: it is
  // a function of the list, so making it state would mean a second render and
  // one more thing that can disagree with the list it came from.
  //
  // Voided receipts are never auto-picked. A void is not what anyone means by
  // "print the receipt", and landing on one reads as the money having gone back.
  const shownReceipt = receipt ?? existingReceipts.find((r) => r.status === 'ISSUED') ?? null;

  const existing = shownReceipt?.status === 'ISSUED' || shownReceipt?.status === 'VOID';
  const issued = shownReceipt?.status === 'ISSUED';

  // The figures the header line quotes, and that everything below is measured
  // against. Read off the booking rather than a form, because the money has
  // already been taken by the time this opens.
  //
  // Declared before what derives from them: const is not hoisted, and having
  // `remaining` sit above these threw the whole modal on every render.
  const alreadyHeld = Number(booking?.advanceAmount) || 0;
  // Rounded to the whole rupee, because that is what the final bill will ask
  // for and what the receipt below prints. Read raw, this line offered to take
  // 33 paise the bill would never charge, and stated a balance the receipt
  // printed underneath it as a different figure — the same stay, two amounts,
  // on one screen.
  const stayTotal = Math.round(Number(booking?.totalPrice) || 0);

  // What the stay still owes, and therefore the most another advance may be.
  // The server holds the same line; this is so the desk sees the ceiling rather
  // than discovering it.
  const remaining = Math.max(0, Math.round((stayTotal - alreadyHeld) * 100) / 100);

  // A cancelled stay takes no more money, and neither does one already paid up.
  // Reserved and checked-in both may — a second deposit before arrival is the
  // whole reason this exists.
  const canTakeMore = Boolean(booking) && booking.status !== 'CANCELLED' && remaining > 0;


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
        `/billing/advance-receipts/${shownReceipt.id}/void`,
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

  // Print and share build the same file the same way and differ only in what
  // they do with it, so the building — and the busy state, and the one error
  // message — lives here once.
  const runPdfAction = async (deliver) => {
    setPdfError('');
    setPdfBusy(true);
    try {
      const blob = await buildDocumentPdfBlob(captureRef.current, {
        paperSize,
        shownWidth: previewRef.current?.offsetWidth,
      });
      await deliver(blob, `${(shownReceipt.receiptNumber || 'advance-receipt').replace(/[\\/]/g, '-')}.pdf`);
    } catch (err) {
      // An aborted share sheet is the user changing their mind, not a failure.
      if (err?.name !== 'AbortError') {
        setPdfError('Could not generate the receipt PDF.');
      }
    } finally {
      setPdfBusy(false);
    }
  };

  // Print is the PDF sent to the printer instead of to disk, so the printed
  // receipt is the downloaded one — see printPdfBlob for why the page's own
  // print stylesheet stopped being trusted with this.
  const handlePrint = () => runPdfAction(printPdfBlob);

  // Download is now only a download. It used to be shareOrDownloadPdf, which
  // opened the OS sheet where there was one — so on a tablet this button could
  // not save the file, and there was nothing else here that could. Sharing has
  // its own control beside it now, and each does the one thing it says.
  const handleDownloadPdf = () => runPdfAction(downloadPdf);

  // What the desk is sending, in the words they would use saying it aloud.
  // An advance receipt is an acknowledgement of money already handed over, so
  // it says what was received rather than what is owed — a guest reading "for
  // ₹2,000" on a receipt would reasonably think they were being asked again.
  const shareMessage = () =>
    `${shownReceipt?.guestName ? `${shownReceipt.guestName}, here` : 'Here'} is your advance ` +
    `receipt ${shownReceipt?.receiptNumber || ''}`.trimEnd() +
    `${shownReceipt?.lodgeName ? ` from ${shownReceipt.lodgeName}` : ''}` +
    ` for the ${formatPrice(shownReceipt?.amountReceived || 0)} received. Thank you.`;

  const shareSubject = () =>
    `Advance receipt ${shownReceipt?.receiptNumber || ''}`.trimEnd() +
    `${shownReceipt?.lodgeName ? ` from ${shownReceipt.lodgeName}` : ''}`;

  // The receipt shares the way the bill does — same channels, same menu, same
  // save-then-compose order. It had no share control at all: the one icon here
  // was a download, so a guest who wanted their advance receipt sent had to be
  // mailed it by hand from the desk's own downloads folder.
  const handleShare = (channel) =>
    runPdfAction(async (blob, filename) => {
      if (channel === 'device') {
        await sharePdf(blob, filename);
        return;
      }
      downloadPdf(blob, filename);
      if (channel === 'email') {
        openComposer(buildMailLink('', shareSubject(), shareMessage()));
      } else if (channel === 'sms') {
        openComposer(buildSmsLink(shownReceipt?.guestPhone, shareMessage()));
      } else {
        openExternal(buildWhatsAppLink(shownReceipt?.guestPhone, shareMessage()));
      }
    });

  // Records the money AND raises its receipt, in one call. The server adds the
  // amount to the booking rather than replacing it, refuses to take the total
  // past what the stay costs, and refuses outright on a cancelled booking.
  const takeAdvance = async (e) => {
    e.preventDefault();
    const amount = Number(form.amountReceived);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter the amount received from the guest.');
      return;
    }
    // Covers the single-payment case unchanged — one line with no method is
    // still "choose how this was paid" — and every line of a split besides.
    const lineProblem = paymentLinesError(payLines);
    if (lineProblem) {
      setError(
        payLines.length === 1 && !payLines[0].method
          ? 'Choose how the advance was paid.'
          : lineProblem
      );
      return;
    }

    setError('');
    setTaking(true);
    try {
      const data = await apiPost(
        `/billing/bookings/${booking.id}/advance-receipt`,
        {
          amountReceived: amount,
          paymentMethod: payLines[0].method,
          // Dropped on cash: a reference typed before switching to cash would
          // otherwise file a transaction number against money that never had one.
          ...(needsPaymentReference(payLines[0].method)
            ? { paymentReference: payLines[0].reference.trim() }
            : {}),
          ...(payLines.length > 1 ? { paymentLines: toPaymentLines(payLines) } : {}),
        },
        { token }
      );
      setForm({ amountReceived: '' });
      setPayLines([emptyPaymentLine()]);
      setShowTakeForm(false);
      // Straight onto the new receipt — it is what the guest is waiting for.
      setReceipt(data.receipt);
      onTaken?.(data.receipt);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record this advance.');
    } finally {
      setTaking(false);
    }
  };

  // Show an earlier receipt instead of the newest, for a stay whose advance
  // arrived in more than one go.
  const showReceipt = (earlier) => {
    setReceipt(earlier);
    setError('');
  };

  return (
    <div className="glass-backdrop billing-panel__backdrop" onClick={onClose}>
      <div className="glass-panel billing-panel__modal" onClick={(e) => e.stopPropagation()}>
        <div className="billing-panel__detail-header">
          <h3>{existing ? shownReceipt.receiptNumber : 'Advance receipt'}</h3>
          <span className="billing-panel__detail-tags">
            <span className="bill-tag bill-tag--cash">
              {booking?.roomNumber ? `Room ${booking.roomNumber}` : 'Booking'}
            </span>
            {shownReceipt?.status === 'VOID' && <span className="bill-tag bill-tag--void">Void</span>}
          </span>
        </div>

        {booking && (
          <p className="bookings-panel__hint">
            {booking.guestName} · stay total {formatPrice(stayTotal)}
            {alreadyHeld > 0 ? ` · ${formatPrice(alreadyHeld)} advance held` : ''}
            {remaining > 0 ? ` · ${formatPrice(remaining)} still to pay` : ' · paid in full'}
          </p>
        )}

        {/* Outside the "no receipt showing" branch on purpose. Landing straight
            on the newest receipt is what the desk wants, but a stay that took
            its advance in two goes still has to be able to reach the first one —
            and inside that branch this vanished the moment a document appeared. */}
        {existingReceipts.length > 1 && (
          <div className="chart-list">
            {existingReceipts.map((earlier) => (
              <div className="chart-row" key={earlier.id}>
                <span className="chart-row__name">
                  {earlier.receiptNumber}
                  {earlier.status === 'VOID' && ' · void'}
                </span>
                <span className="chart-row__value">
                  {formatPrice(earlier.amountReceived)}
                  <button
                    type="button"
                    className={earlier.id === shownReceipt?.id ? 'btn-accent' : 'btn-secondary'}
                    onClick={() => showReceipt(earlier)}
                  >
                    {earlier.id === shownReceipt?.id ? 'Showing' : 'Print'}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Receipts are raised by the server the moment an advance is taken — at
            booking, at check-in, or when an edit increases it. There is nothing
            to issue by hand, so with no receipt there is simply nothing yet. */}
        {/* Said only when the two agree. A stay can hold an advance with no
            receipt behind it — bookings taken before receipts were raised
            automatically, and the one case where the advance was larger than
            the stay and the receipt was refused — and telling that desk "no
            advance has been taken" directly under a line reading "₹2,000
            advance held" is the screen arguing with itself. */}
        {!existing && existingReceipts.length === 0 && (
          <p className="bookings-panel__hint">
            {alreadyHeld > 0
              ? `${formatPrice(alreadyHeld)} is recorded against this stay but has no receipt — take it again below to raise one, or leave it and it will show on the bill as before.`
              : 'No advance has been taken against this stay yet.'}
          </p>
        )}

        {error && <div className="form-banner form-banner--error">{error}</div>}

        {/* Why this receipt was voided, said plainly and in the danger colour.
            The small "Void" chip up in the header said the state but never the
            reason, and the reason only appeared in the fine print at the foot
            of the printed document — so the desk had to read the receipt
            itself to find out why the money had gone back. */}
        {shownReceipt?.status === 'VOID' && (
          <div className="billing-panel__void-note" role="status">
            <span className="billing-panel__void-tag">Void</span>
            <span className="billing-panel__void-reason">
              {shownReceipt.voidReason || 'No reason recorded.'}
            </span>
          </div>
        )}

        {canTakeMore && showTakeForm && (
          <form onSubmit={takeAdvance} className="form-section">
            <div className="form-section__title">
              Advance received now
              {/* Both the amount and the payment type are refused when blank,
                  and neither control carries a visible label of its own — so
                  the mark goes on the heading that names the pair. */}
              <Req />
            </div>
            {/* The Amount box is handed to the editor rather than placed
                beside it: it keeps its spot next to the payment type on an
                ordinary advance, and moves above the list once the payment
                splits. Still one receipt either way — splitting how the money
                arrived must not burn a second serial on a single handover. */}
            <PaymentLines
              lines={payLines}
              onChange={updatePayLines}
              idPrefix="takeAdvance"
            >
              {/* The ceiling still has to be stated — the server refuses an
                  advance that would take the stay past its own total, and the
                  desk should know before it types, not after. */}
              <p className="bookings-panel__hint">Up to {formatPrice(remaining)} still to pay.</p>
            </PaymentLines>

            <div className="billing-panel__actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowTakeForm(false)}
                disabled={taking}
              >
                Back
              </button>
              <button className="btn-accent" type="submit" disabled={taking}>
                {taking ? 'Recording…' : 'Record & print receipt'}
              </button>
            </div>
          </form>
        )}

        {/* The same bar the bill carries, above the sheet for the same reason:
            the receipt is a full page, and with the controls under it printing
            meant scrolling past the whole thing to reach the button.

            Paper and language sit apart from the buttons because they govern
            two of them — Print and the download have to agree about the sheet.
            Voiding is last and a link, not a button: it is the one irreversible
            thing here and must not read as a peer of Print. */}
        {!showVoidForm && !showTakeForm && (
          <div className="bill-actions">
            {existing && (
              <div className="bill-actions__sheet">
                <PaperSelect value={paperSize} onChange={setPaperSize} />
                <LangSelect value={lang} onChange={setLang} />
              </div>
            )}
            <div className="bill-actions__buttons">
              {existing && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handlePrint}
                  disabled={pdfBusy}
                  title={pdfBusy ? 'Preparing…' : 'Print this receipt'}
                >
                  {pdfBusy ? 'Preparing…' : 'Print'}
                </button>
              )}
              {existing && (
                <button
                  type="button"
                  className="btn-accent bill-actions__icon-btn"
                  onClick={handleDownloadPdf}
                  disabled={pdfBusy}
                  aria-label={pdfBusy ? 'Preparing the PDF' : 'Download this receipt as a PDF'}
                  title={pdfBusy ? 'Preparing…' : 'Download PDF'}
                >
                  <DownloadIcon />
                </button>
              )}
              {/* Sharing, which this modal simply did not offer. The receipt is
                  the document a guest asks to be sent more often than the bill
                  is — it is proof they have already paid — and the only way to
                  send one was to download it and attach it by hand from
                  outside the app. Same control and same channels as the bill. */}
              {existing && (
                <ShareMenu
                  onShare={handleShare}
                  disabled={pdfBusy}
                  busy={pdfBusy}
                  canShareFiles={deviceShare}
                  label="Share this receipt"
                />
              )}
              {canTakeMore && (
                <button type="button" className="btn-secondary" onClick={() => setShowTakeForm(true)}>
                  Take another advance
                </button>
              )}
              <button type="button" className="btn-secondary" onClick={onClose}>
                Done
              </button>
              {issued && (
                <button
                  type="button"
                  className="billing-panel__danger-link"
                  onClick={() => setShowVoidForm(true)}
                >
                  Void this receipt
                </button>
              )}
            </div>
          </div>
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
