import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import BillDocument from './BillDocument';
import './forms.css';
import './chartSections.css';
import './Billing.css';

const DOCUMENT_LABEL = {
  TAX_INVOICE: 'Tax invoice',
  BILL_OF_SUPPLY: 'Bill of supply',
  CASH_RECEIPT: 'Cash receipt',
};

function formatDateLong(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const TABS = [
  { key: 'ready', label: 'Ready to bill' },
  { key: 'bills', label: 'Bills' },
];

export default function Billing() {
  const session = getSession();
  const token = session?.token;

  const [tab, setTab] = useState('ready');
  const [queue, setQueue] = useState(null);
  const [queueError, setQueueError] = useState('');
  const [invoices, setInvoices] = useState(null);
  const [invoicesError, setInvoicesError] = useState('');

  const loadQueue = () => {
    apiGet('/billing/queue', { token })
      .then((data) => {
        setQueue(data.bookings);
        setQueueError('');
      })
      .catch((err) => setQueueError(err instanceof ApiError ? err.message : 'Could not load bookings ready to bill.'));
  };

  const loadInvoices = () => {
    apiGet('/billing/invoices', { token })
      .then((data) => {
        setInvoices(data.invoices);
        setInvoicesError('');
      })
      .catch((err) => setInvoicesError(err instanceof ApiError ? err.message : 'Could not load bills.'));
  };

  useEffect(() => {
    loadQueue();
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAll = () => {
    loadQueue();
    loadInvoices();
  };

  // Bill modal
  const [billingBookingId, setBillingBookingId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [billingSide, setBillingSide] = useState('GST');
  const [collectedAmount, setCollectedAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [issueError, setIssueError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const openBilling = (bookingId) => {
    setBillingBookingId(bookingId);
    setPreview(null);
    setPreviewError('');
    setCollectedAmount('');
    setPaymentMethod('');
    setIssueError('');
  };

  const closeBilling = () => {
    if (submitting) return;
    setBillingBookingId(null);
  };

  useEffect(() => {
    if (!billingBookingId) return;
    apiGet(`/billing/bookings/${billingBookingId}/preview`, { token })
      .then((data) => {
        setPreview(data);
        setBillingSide(data.isGstRegistered ? 'GST' : 'NON_GST');
      })
      .catch((err) => setPreviewError(err instanceof ApiError ? err.message : 'Could not load the bill preview.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingBookingId]);

  const activeAmounts = preview ? (billingSide === 'GST' ? preview.gst : preview.nonGst) : null;
  const balanceDue = activeAmounts ? round2(activeAmounts.totalAmount - preview.advancePaid) : 0;

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  const handleIssue = async (e) => {
    e.preventDefault();
    setIssueError('');

    const hasAmount = collectedAmount.trim() !== '';
    if (hasAmount && !paymentMethod) {
      setIssueError('Choose a payment method for the amount collected.');
      return;
    }

    setSubmitting(true);
    try {
      await apiPost(
        `/billing/bookings/${billingBookingId}/invoice`,
        {
          billingSide,
          ...(hasAmount ? { collectedAmount: Number(collectedAmount), paymentMethod } : {}),
        },
        { token }
      );
      setBillingBookingId(null);
      refreshAll();
    } catch (err) {
      setIssueError(err instanceof ApiError ? err.message : 'Could not issue this bill.');
    } finally {
      setSubmitting(false);
    }
  };

  // Invoice detail / void modal
  const [detailInvoiceId, setDetailInvoiceId] = useState(null);
  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState('');
  const [voidSubmitting, setVoidSubmitting] = useState(false);

  const detailInvoice = invoices?.find((i) => i.id === detailInvoiceId);

  const openDetail = (invoiceId) => {
    setDetailInvoiceId(invoiceId);
    setShowVoidForm(false);
    setVoidReason('');
    setVoidError('');
    setPdfError('');
  };

  const closeDetail = () => {
    if (voidSubmitting) return;
    setDetailInvoiceId(null);
  };

  // Bill PDF share/download
  const billRef = useRef(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');

  const buildBillPdfBlob = async () => {
    const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
    const node = billRef.current;
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 24;

    // A bill is a single receipt, not a flowing document — scale it down to
    // whichever dimension is tighter so it always lands on one page, rather
    // than printing it at full width and letting the tail spill onto a
    // near-blank second page.
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;
    const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
    const imgWidth = canvas.width * scale;
    const imgHeight = canvas.height * scale;
    const x = (pageWidth - imgWidth) / 2;

    pdf.addImage(imgData, 'PNG', x, margin, imgWidth, imgHeight);
    return pdf.output('blob');
  };

  const handleSharePdf = async () => {
    setPdfError('');
    setPdfBusy(true);
    try {
      const blob = await buildBillPdfBlob();
      const filename = `${detailInvoice.invoiceNumber.replace(/[\\/]/g, '-')}.pdf`;
      const file = new File([blob], filename, { type: 'application/pdf' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setPdfError('Could not generate the bill PDF.');
      }
    } finally {
      setPdfBusy(false);
    }
  };

  const handleVoid = async (e) => {
    e.preventDefault();
    setVoidError('');
    if (!voidReason.trim()) {
      setVoidError('Enter a reason for voiding this bill.');
      return;
    }
    setVoidSubmitting(true);
    try {
      await apiPost(`/billing/invoices/${detailInvoiceId}/void`, { reason: voidReason.trim() }, { token });
      setDetailInvoiceId(null);
      refreshAll();
    } catch (err) {
      setVoidError(err instanceof ApiError ? err.message : 'Could not void this bill.');
    } finally {
      setVoidSubmitting(false);
    }
  };

  return (
    <div className="billing-panel">
      <div className="billing-panel__subtabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="billing-panel__subtabs-item"
            aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'ready' && queue && queue.length > 0 && (
              <span className="billing-panel__subtabs-count">{queue.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'ready' && (
        <div className="chart-section">
          <div className="chart-section__header">
            <h3>Ready to bill</h3>
            <span className="chart-section__hint">Checked-out stays waiting for a bill.</span>
          </div>

          {queueError && <div className="form-banner form-banner--error">{queueError}</div>}
          {!queueError && !queue && <div className="dash-state">Loading…</div>}
          {!queueError && queue && queue.length === 0 && (
            <div className="dash-state">Nothing waiting — every checked-out stay has a bill.</div>
          )}
          {!queueError && queue && queue.length > 0 && (
            <div className="chart-list">
              {queue.map((b) => (
                <div className="chart-row billing-panel__queue-row" key={b.id}>
                  <span className="chart-row__name">
                    {b.guestName}
                    <span className="chart-row__dates">
                      {b.roomNumber} · {b.categoryName} · {formatDateLong(b.checkInDate)} – {formatDateLong(b.checkOutDate)}
                    </span>
                  </span>
                  <span className="billing-panel__queue-actions">
                    <span className="chart-row__value">{formatPrice(b.totalPrice)}</span>
                    <button type="button" className="btn-accent" onClick={() => openBilling(b.id)}>
                      Bill
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'bills' && (
        <div className="chart-section">
          <div className="chart-section__header">
            <h3>Bills</h3>
            <span className="chart-section__hint">Most recent first.</span>
          </div>

          {invoicesError && <div className="form-banner form-banner--error">{invoicesError}</div>}
          {!invoicesError && !invoices && <div className="dash-state">Loading…</div>}
          {!invoicesError && invoices && invoices.length === 0 && (
            <div className="dash-state">No bills issued yet.</div>
          )}
          {!invoicesError && invoices && invoices.length > 0 && (
            <div className="chart-list">
              {invoices.map((inv) => (
                <button
                  type="button"
                  className="chart-row billing-panel__invoice-row"
                  key={inv.id}
                  onClick={() => openDetail(inv.id)}
                >
                  <span className="chart-row__name">
                    {inv.invoiceNumber}
                    <span className="chart-row__dates">
                      {inv.guestName} · {inv.roomNumber} · {DOCUMENT_LABEL[inv.documentType]}
                    </span>
                  </span>
                  <span className="billing-panel__queue-actions">
                    {inv.status === 'VOID' && <span className="badge badge--off">Void</span>}
                    <span className="chart-row__value">{formatPrice(inv.totalAmount)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {billingBookingId && (
        <div className="glass-backdrop billing-panel__backdrop" onClick={closeBilling}>
          <div className="glass-panel billing-panel__modal" onClick={(e) => e.stopPropagation()}>
            <h3>Issue bill</h3>

            {previewError && <div className="form-banner form-banner--error">{previewError}</div>}
            {!previewError && !preview && <div className="dash-state">Loading…</div>}

            {!previewError && preview && (
              <form onSubmit={handleIssue} noValidate>
                {issueError && <div className="form-banner form-banner--error">{issueError}</div>}
                {preview.alreadyInvoiced && (
                  <div className="form-banner form-banner--info">
                    This booking already has an issued bill. Void it first to reissue.
                  </div>
                )}

                <div className="form-section">
                  <div className="form-section__title">Stay</div>
                  <div className="chart-list">
                    <div className="chart-row">
                      <span className="chart-row__name">Guest</span>
                      <span className="chart-row__value">{preview.guestName}</span>
                    </div>
                    <div className="chart-row">
                      <span className="chart-row__name">Room</span>
                      <span className="chart-row__value">
                        {preview.roomNumber} · {preview.categoryName} · {preview.nights} night
                        {preview.nights === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="form-section">
                  <div className="form-section__title">Billing side</div>
                  {preview.isGstRegistered ? (
                    <div className="toggle-group">
                      <button
                        type="button"
                        aria-pressed={billingSide === 'GST'}
                        onClick={() => setBillingSide('GST')}
                      >
                        GST ({preview.gstin})
                      </button>
                      <button
                        type="button"
                        aria-pressed={billingSide === 'NON_GST'}
                        onClick={() => setBillingSide('NON_GST')}
                      >
                        Non-GST
                      </button>
                    </div>
                  ) : (
                    <p className="billing-panel__hint">
                      This lodge isn&apos;t GST registered — every bill is a cash receipt.
                    </p>
                  )}

                  {activeAmounts && (
                    <div className="sim-result">
                      <div className="sim-result__line">
                        <span>Room charges</span>
                        <span>{formatPrice(activeAmounts.subtotal)}</span>
                      </div>
                      {(activeAmounts.cgstAmount > 0 || activeAmounts.sgstAmount > 0) && (
                        <>
                          <div className="sim-result__line">
                            <span>CGST ({activeAmounts.cgstRatePercent}%)</span>
                            <span>{formatPrice(activeAmounts.cgstAmount)}</span>
                          </div>
                          <div className="sim-result__line">
                            <span>SGST ({activeAmounts.sgstRatePercent}%)</span>
                            <span>{formatPrice(activeAmounts.sgstAmount)}</span>
                          </div>
                        </>
                      )}
                      {activeAmounts.roundOff !== 0 && (
                        <div className="sim-result__line">
                          <span>Round off</span>
                          <span>{formatPrice(activeAmounts.roundOff)}</span>
                        </div>
                      )}
                      <div className="sim-result__total">
                        <span>{DOCUMENT_LABEL[activeAmounts.documentType]}</span>
                        <span>{formatPrice(activeAmounts.totalAmount)}</span>
                      </div>
                      {preview.advancePaid > 0 && (
                        <div className="sim-result__line">
                          <span>Advance already paid</span>
                          <span>-{formatPrice(preview.advancePaid)}</span>
                        </div>
                      )}
                      <div className="sim-result__total">
                        <span>Balance due</span>
                        <span>{formatPrice(balanceDue)}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-section">
                  <div className="form-section__title">Balance collected (optional)</div>
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="collectedAmount">Amount</label>
                      <input
                        id="collectedAmount"
                        type="number"
                        min="0"
                        value={collectedAmount}
                        onChange={(e) => setCollectedAmount(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="paymentMethod">Method</label>
                      <select
                        id="paymentMethod"
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                      >
                        <option value="">Choose one</option>
                        <option value="CASH">Cash</option>
                        <option value="UPI">UPI</option>
                        <option value="CARD">Card</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="billing-panel__actions">
                  <button type="button" className="btn-secondary" onClick={closeBilling} disabled={submitting}>
                    Cancel
                  </button>
                  <button className="btn-accent" type="submit" disabled={submitting || preview.alreadyInvoiced}>
                    {submitting ? 'Issuing…' : 'Issue bill'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {detailInvoiceId && detailInvoice && (
        <div className="glass-backdrop billing-panel__backdrop" onClick={closeDetail}>
          <div className="glass-panel billing-panel__modal" onClick={(e) => e.stopPropagation()}>
            <div className="billing-panel__detail-header">
              <h3>{detailInvoice.invoiceNumber}</h3>
              <span className={`badge ${detailInvoice.status === 'ISSUED' ? 'badge--on' : 'badge--off'}`}>
                {detailInvoice.status === 'ISSUED' ? DOCUMENT_LABEL[detailInvoice.documentType] : 'Void'}
              </span>
            </div>

            <BillDocument ref={billRef} invoice={detailInvoice} />

            {detailInvoice.status === 'VOID' && (
              <div className="chart-list">
                <div className="chart-row">
                  <span className="chart-row__name">Void reason</span>
                  <span className="chart-row__value">{detailInvoice.voidReason}</span>
                </div>
              </div>
            )}

            {voidError && <div className="form-banner form-banner--error">{voidError}</div>}
            {pdfError && <div className="form-banner form-banner--error">{pdfError}</div>}

            {detailInvoice.status === 'ISSUED' && !showVoidForm && (
              <div className="billing-panel__actions">
                <button
                  type="button"
                  className="billing-panel__danger-link"
                  onClick={() => setShowVoidForm(true)}
                >
                  Void this bill
                </button>
                <button type="button" className="btn-secondary" onClick={() => window.print()}>
                  Print
                </button>
                <button type="button" className="btn-accent" onClick={handleSharePdf} disabled={pdfBusy}>
                  {pdfBusy ? 'Preparing…' : 'Share / Download PDF'}
                </button>
              </div>
            )}

            {detailInvoice.status === 'ISSUED' && showVoidForm && (
              <form onSubmit={handleVoid} className="form-section">
                <div className="form-section__title">Reason for voiding</div>
                <div className="field">
                  <input
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="e.g. Guest wants a different billing side"
                    autoFocus
                  />
                </div>
                <div className="billing-panel__actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowVoidForm(false)}
                    disabled={voidSubmitting}
                  >
                    Back
                  </button>
                  <button className="btn-accent" type="submit" disabled={voidSubmitting}>
                    {voidSubmitting ? 'Voiding…' : 'Confirm void'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
