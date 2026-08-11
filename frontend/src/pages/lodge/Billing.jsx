import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import BillDocument from './BillDocument';
import './forms.css';
import './chartSections.css';
import './Billing.css';

// How overdue the guest was, in words. Duplicated from the server's own
// lateLabel rather than shipped down with the preview, because it is four
// lines and the bill needs it for a number it already has.
function lateLabel(minutes) {
  if (minutes <= 0) return 'on time';
  if (minutes < 60) return `${minutes} min late`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours}h late` : `${hours}h ${mins}m late`;
}

const DOCUMENT_LABEL = {
  TAX_INVOICE: 'Tax invoice',
  BILL_OF_SUPPLY: 'Bill of supply',
  CASH_RECEIPT: 'Cash receipt',
};

function formatDateLong(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export default function Billing({ lodge }) {
  const session = getSession();
  const token = session?.token;

  // What this property can bill decides which tabs exist. A lodge bills stays,
  // a restaurant bills closed tables, and a lodge with meals does both — the
  // food a room-service guest ate rides on their stay bill rather than
  // appearing as a separate tab.
  const billsStays = lodge?.hasRooms !== false;
  const billsTables = Boolean(lodge?.servesFood);

  const tabs = [
    ...(billsStays ? [{ key: 'ready', label: 'Ready to bill' }] : []),
    ...(billsTables ? [{ key: 'tables', label: 'Tables to bill' }] : []),
    { key: 'bills', label: 'Bills' },
  ];

  const [tab, setTab] = useState(billsStays ? 'ready' : billsTables ? 'tables' : 'bills');
  const [queue, setQueue] = useState(null);
  const [queueError, setQueueError] = useState('');
  const [foodTabs, setFoodTabs] = useState(null);
  const [foodTabsError, setFoodTabsError] = useState('');
  const [invoices, setInvoices] = useState(null);
  const [invoicesError, setInvoicesError] = useState('');

  const loadQueue = () => {
    if (!billsStays) return;
    apiGet('/billing/queue', { token })
      .then((data) => {
        setQueue(data.bookings);
        setQueueError('');
      })
      .catch((err) => setQueueError(err instanceof ApiError ? err.message : 'Could not load bookings ready to bill.'));
  };

  const loadFoodTabs = () => {
    if (!billsTables) return;
    apiGet('/billing/food-tabs', { token })
      .then((data) => {
        setFoodTabs(data.tabs);
        setFoodTabsError('');
      })
      .catch((err) => setFoodTabsError(err instanceof ApiError ? err.message : 'Could not load open tables.'));
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
    loadFoodTabs();
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAll = () => {
    loadQueue();
    loadFoodTabs();
    loadInvoices();
  };

  // Bill modal. One modal serves both kinds — the amounts, the GST toggle and
  // the payment capture are identical; only the endpoints and the header
  // differ, so `billTarget` carries which is being billed.
  //   { kind: 'STAY', bookingId }  |  { kind: 'FOOD', tableId, label }
  const [billTarget, setBillTarget] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [billingSide, setBillingSide] = useState('GST');
  const [collectedAmount, setCollectedAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [issueError, setIssueError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const openBilling = (target) => {
    setBillTarget(target);
    setPreview(null);
    setPreviewError('');
    setCollectedAmount('');
    setPaymentMethod('');
    setIssueError('');
  };

  const closeBilling = () => {
    if (submitting) return;
    setBillTarget(null);
  };

  // "counter" rather than an id — the till tab has no table row behind it.
  const foodTabPath = (tableId) => (tableId == null ? 'counter' : tableId);

  const previewPath = billTarget
    ? billTarget.kind === 'STAY'
      ? `/billing/bookings/${billTarget.bookingId}/preview`
      : `/billing/food-tabs/${foodTabPath(billTarget.tableId)}/preview`
    : null;

  useEffect(() => {
    if (!previewPath) return;
    apiGet(previewPath, { token })
      .then((data) => {
        setPreview(data);
        setBillingSide(data.isGstRegistered ? 'GST' : 'NON_GST');
      })
      .catch((err) => setPreviewError(err instanceof ApiError ? err.message : 'Could not load the bill preview.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewPath]);

  const activeAmounts = preview ? (billingSide === 'GST' ? preview.gst : preview.nonGst) : null;
  // A table bill has no advance — nobody pays a deposit to sit down.
  const advancePaid = preview?.advancePaid ?? 0;
  const balanceDue = activeAmounts ? round2(activeAmounts.totalAmount - advancePaid) : 0;

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

    const path =
      billTarget.kind === 'STAY'
        ? `/billing/bookings/${billTarget.bookingId}/invoice`
        : `/billing/food-tabs/${foodTabPath(billTarget.tableId)}/invoice`;

    setSubmitting(true);
    try {
      await apiPost(
        path,
        {
          billingSide,
          ...(hasAmount ? { collectedAmount: Number(collectedAmount), paymentMethod } : {}),
        },
        { token }
      );
      setBillTarget(null);
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
        {tabs.map((t) => (
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
            {t.key === 'tables' && foodTabs && foodTabs.length > 0 && (
              <span className="billing-panel__subtabs-count">{foodTabs.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'tables' && (
        <div className="chart-section">
          <div className="chart-section__header">
            <h3>Tables to bill</h3>
            <span className="chart-section__hint">
              Delivered food nobody has paid for. Billing a table sweeps everything it has ordered
              into one document.
            </span>
          </div>

          {foodTabsError && <div className="form-banner form-banner--error">{foodTabsError}</div>}
          {!foodTabsError && !foodTabs && <div className="dash-state">Loading…</div>}
          {!foodTabsError && foodTabs && foodTabs.length === 0 && (
            <div className="dash-state">No open tables — everything served has been billed.</div>
          )}
          {!foodTabsError && foodTabs && foodTabs.length > 0 && (
            <div className="chart-list">
              {foodTabs.map((t) => (
                <div className="chart-row billing-panel__queue-row" key={t.tableId ?? 'counter'}>
                  <span className="chart-row__name">
                    {t.tableLabel}
                    <span className="chart-row__dates">
                      {t.orderCount} order{t.orderCount === 1 ? '' : 's'} · since{' '}
                      {new Date(t.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </span>
                  <span className="billing-panel__queue-actions">
                    <span className="chart-row__value">{formatPrice(t.subtotal)}</span>
                    <button
                      type="button"
                      className="btn-accent"
                      onClick={() => openBilling({ kind: 'FOOD', tableId: t.tableId, label: t.tableLabel })}
                    >
                      Bill
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
                    <button type="button" className="btn-accent" onClick={() => openBilling({ kind: 'STAY', bookingId: b.id })}>
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
                      {/* A food bill has no guest and no room to name, so it
                          identifies itself by the table it closed. */}
                      {inv.kind === 'FOOD'
                        ? `${inv.tableLabel || 'Counter'} · ${DOCUMENT_LABEL[inv.documentType]}`
                        : `${inv.guestName} · ${inv.roomNumber} · ${DOCUMENT_LABEL[inv.documentType]}`}
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

      {billTarget && (
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

                {billTarget.kind === 'STAY' && (
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
                      {/* Only when there is one. Reception agreed this at the
                          desk during checkout; it is surfaced here so it can be
                          spotted before a document that can only be voided. */}
                      {preview.lateCheckoutCharge > 0 && (
                        <div className="chart-row">
                          <span className="chart-row__name">
                            Late checkout
                            {preview.lateCheckoutMinutes != null && (
                              <span className="chart-row__dates">
                                {lateLabel(preview.lateCheckoutMinutes)}
                              </span>
                            )}
                          </span>
                          <span className="chart-row__value">
                            {formatPrice(preview.lateCheckoutCharge)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* What's being swept onto this bill, itemised — staff read
                    this back against what actually went to the table before
                    committing to a document they can only void. The order
                    numbers are noted alongside so a query can be traced back to
                    a specific ticket. */}
                {preview.foodItems?.length > 0 && (
                  <div className="form-section">
                    <div className="form-section__title">
                      {billTarget.kind === 'FOOD' ? billTarget.label : 'Food ordered during the stay'}
                    </div>
                    <div className="chart-list">
                      {preview.foodItems.map((item, index) => (
                        <div className="chart-row" key={`${item.name}-${item.unitPrice}-${index}`}>
                          <span className="chart-row__name">
                            {item.name}
                            <span className="chart-row__dates">
                              {item.quantity} × {formatPrice(item.unitPrice)}
                            </span>
                          </span>
                          <span className="chart-row__value">{formatPrice(item.lineTotal)}</span>
                        </div>
                      ))}
                    </div>
                    <p className="billing-panel__hint">
                      From order{(preview.orders ?? preview.foodOrders).length === 1 ? '' : 's'}{' '}
                      {(preview.orders ?? preview.foodOrders).map((o) => `#${o.orderNumber}`).join(', ')}
                    </p>
                  </div>
                )}

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
                      This property isn&apos;t GST registered — every bill is a cash receipt.
                    </p>
                  )}

                  {activeAmounts && (
                    <div className="sim-result">
                      {/* Room and food are shown as separate taxed blocks
                          because they are separate supplies on different SACs
                          at different rates — merging them would hide the very
                          split GSTR-1 reports on. */}
                      {activeAmounts.subtotal > 0 && (
                        <>
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
                        </>
                      )}

                      {activeAmounts.foodSubtotal > 0 && (
                        <>
                          <div className="sim-result__line">
                            <span>Food</span>
                            <span>{formatPrice(activeAmounts.foodSubtotal)}</span>
                          </div>
                          {(activeAmounts.foodCgstAmount > 0 || activeAmounts.foodSgstAmount > 0) && (
                            <>
                              <div className="sim-result__line">
                                <span>CGST ({activeAmounts.foodCgstRatePercent}%)</span>
                                <span>{formatPrice(activeAmounts.foodCgstAmount)}</span>
                              </div>
                              <div className="sim-result__line">
                                <span>SGST ({activeAmounts.foodSgstRatePercent}%)</span>
                                <span>{formatPrice(activeAmounts.foodSgstAmount)}</span>
                              </div>
                            </>
                          )}
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
                      {advancePaid > 0 && (
                        <div className="sim-result__line">
                          <span>Advance already paid</span>
                          <span>-{formatPrice(advancePaid)}</span>
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
