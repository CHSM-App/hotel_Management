import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { formatPrice } from './priceFormat';
import { formatDateLong } from './stayFormat';
import BillDocument from './BillDocument';
import StayDetails from './StayDetails';
import './forms.css';
import './chartSections.css';
import './stayDetails.css';
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

// Money that arrives this way leaves a reference the property reconciles
// against its settlement statement; cash doesn't. Mirrors ONLINE_METHODS on
// the server, which is what actually enforces it.
const ONLINE_PAYMENT_METHODS = ['UPI', 'CARD'];
const needsPaymentReference = (method) => ONLINE_PAYMENT_METHODS.includes(method);

const DOCUMENT_LABEL = {
  TAX_INVOICE: 'Tax invoice',
  BILL_OF_SUPPLY: 'Bill of supply',
  CASH_RECEIPT: 'Cash receipt',
};

// Colour suffix per document type, so the tag styling stays in the stylesheet
// instead of being derived from the enum name.
const DOCUMENT_TAG = {
  TAX_INVOICE: 'tax',
  BILL_OF_SUPPLY: 'supply',
  CASH_RECEIPT: 'cash',
};

// A bill differs on two axes and the list has to show both: what was sold, and
// which document GST law makes of it. A room tax invoice and a table cash
// receipt are the same wall of digits otherwise.
const SOURCE_LABEL = {
  ROOM: 'Room',
  ROOM_FOOD: 'Room + food',
  TABLE: 'Table',
};

function billSource(inv) {
  if (inv.kind === 'FOOD') return 'TABLE';
  // A stay whose guest ordered to the room is neither a plain stay bill nor a
  // food bill — it carries two taxed blocks, and staff reconciling the kitchen
  // against the front desk need to spot it without opening it.
  return inv.foodSubtotal > 0 ? 'ROOM_FOOD' : 'ROOM';
}

function tagClass(key) {
  return key.toLowerCase().replace(/_/g, '-');
}

// Filtering is by document type only — that is the split staff hand over to an
// accountant. What was sold stays visible as a tag on every row, but it is not
// something the list needs to be narrowed down to.
const BILL_FILTERS = [
  { key: 'TAX_INVOICE', label: 'Tax invoice', match: (i) => i.documentType === 'TAX_INVOICE' },
  { key: 'CASH_RECEIPT', label: 'Cash receipt', match: (i) => i.documentType === 'CASH_RECEIPT' },
];

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
  const [queue, setQueue] = useState(() => readCache('/billing/queue'));
  const [queueError, setQueueError] = useState('');
  const [foodTabs, setFoodTabs] = useState(() => readCache('/billing/food-tabs'));
  const [foodTabsError, setFoodTabsError] = useState('');
  const [invoices, setInvoices] = useState(() => readCache('/billing/invoices'));
  const [invoicesError, setInvoicesError] = useState('');
  const [billFilter, setBillFilter] = useState('ALL');

  const loadQueue = () => {
    if (!billsStays) return;
    apiGet('/billing/queue', { token })
      .then((data) => {
        setQueue(writeCache('/billing/queue', data.bookings));
        setQueueError('');
      })
      .catch((err) => setQueueError(err instanceof ApiError ? err.message : 'Could not load bookings ready to bill.'));
  };

  const loadFoodTabs = () => {
    if (!billsTables) return;
    apiGet('/billing/food-tabs', { token })
      .then((data) => {
        setFoodTabs(writeCache('/billing/food-tabs', data.tabs));
        setFoodTabsError('');
      })
      .catch((err) => setFoodTabsError(err instanceof ApiError ? err.message : 'Could not load open tables.'));
  };

  const loadInvoices = () => {
    apiGet('/billing/invoices', { token })
      .then((data) => {
        setInvoices(writeCache('/billing/invoices', data.invoices));
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

  // Only the types this property actually issues get a chip — a property that
  // isn't GST registered only ever writes cash receipts, and should not be
  // offered a "Tax invoice" filter that matches nothing.
  const billFilters = invoices
    ? BILL_FILTERS.map((f) => ({ ...f, count: invoices.filter(f.match).length })).filter((f) => f.count > 0)
    : [];
  // Looked up rather than trusted: voiding the last bill of a type empties its
  // chip, and the list falls back to everything instead of going blank.
  const activeFilter = billFilters.find((f) => f.key === billFilter) ?? null;
  const visibleInvoices = invoices && (activeFilter ? invoices.filter(activeFilter.match) : invoices);

  // Bill modal. One modal serves both kinds — the amounts and the payment
  // capture are identical; only the endpoints and the header differ, so
  // `billTarget` carries which is being billed.
  //   { kind: 'STAY', bookingId }  |  { kind: 'FOOD', tableId, label }
  const [billTarget, setBillTarget] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');

  // The stay behind a queue row, read-only. Billing decides what to charge for
  // a stay it can't see otherwise — the queue row carries a name, a room and a
  // total, and every question beyond that ("how many nights", "what advance did
  // they leave", "what were the extras") needed another screen until now.
  const [detailStay, setDetailStay] = useState(null);
  const [detailStayError, setDetailStayError] = useState('');

  // Fetched the first time the section is opened, not when the bill modal is —
  // most bills are issued without anyone needing to ask, and the queue row
  // already carries the name, the room and the total.
  const loadStayDetails = () => {
    if (detailStay || detailStayError || billTarget?.kind !== 'STAY') return;
    apiGet(`/bookings/${billTarget.bookingId}`, { token })
      .then((data) => setDetailStay(data.booking))
      .catch((err) =>
        setDetailStayError(err instanceof ApiError ? err.message : 'Could not load this stay.')
      );
  };

  const [previewOpen, setPreviewOpen] = useState(false);
  const [collectedAmount, setCollectedAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [issueError, setIssueError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Whether the overstay charge reception agreed at the desk lands on this
  // bill. Starts as "yes" — it was already agreed with the guest — and the
  // person writing the bill is the one who can still take it back off.
  const [includeLateCheckout, setIncludeLateCheckout] = useState(true);
  // A discount is agreed as a percentage or as a round figure depending on who
  // is asking, so both boxes exist and each fills in the other. Only the amount
  // is ever sent — a percentage and an amount that disagree have no right
  // answer, and money is the half that gets collected.

  // The amount the preview on screen was actually built for. Lags the box by a
  // beat: the server re-derives the whole document for a discount, since taking
  // money off can move a night into a lower GST band and change the round off.

  // What the preview on screen was built for. Lags the collected box by a beat.
  const [appliedTarget, setAppliedTarget] = useState(0);

  const openBilling = (target) => {
    setBillTarget(target);
    setPreview(null);
    setPreviewError('');
    setCollectedAmount('');
    setPaymentMethod('');
    setPaymentReference('');
    setIssueError('');
    setIncludeLateCheckout(true);
    setDetailStay(null);
    setDetailStayError('');
    setPreviewOpen(false);
    setAppliedTarget(0);
  };

  const closeBilling = () => {
    if (submitting) return;
    setBillTarget(null);
  };

  // "counter" rather than an id — the till tab has no table row behind it.
  const foodTabPath = (tableId) => (tableId == null ? 'counter' : tableId);

  // The late charge and the discount are both in the path rather than
  // subtracted here on the client: taking money off can move the stay into a
  // lower GST band and change the round off, so the server re-derives the whole
  // document instead.
  const previewPath = billTarget
    ? billTarget.kind === 'STAY'
      ? `/billing/bookings/${billTarget.bookingId}/preview?includeLateCheckout=${includeLateCheckout}&targetTotal=${appliedTarget}`
      : `/billing/food-tabs/${foodTabPath(billTarget.tableId)}/preview?targetTotal=${appliedTarget}`
    : null;

  useEffect(() => {
    if (!previewPath) return;
    apiGet(previewPath, { token })
      .then((data) => setPreview(data))
      .catch((err) => setPreviewError(err instanceof ApiError ? err.message : 'Could not load the bill preview.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewPath]);

  // Decided by the property, not by the desk. A registered lodge always issues
  // on the GST side; an unregistered one has no other document to issue, which
  // is why the non-GST path stays and only the choice goes.
  const billingSide = preview?.isGstRegistered ? 'GST' : 'NON_GST';
  const activeAmounts = preview ? (billingSide === 'GST' ? preview.gst : preview.nonGst) : null;
  // A table bill has no advance — nobody pays a deposit to sit down.
  const advancePaid = preview?.advancePaid ?? 0;
  const balanceDue = activeAmounts ? round2(activeAmounts.totalAmount - advancePaid) : 0;

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  // The server builds the document from everything it knows; the payment being
  // typed into the modal right now is the one thing it doesn't, so it is laid
  // over the top. Without this the preview would show "Balance due" in full on
  // a bill about to be marked paid.
  const collecting = collectedAmount.trim() !== '';
  const documentPreview = preview?.document && {
    ...preview.document,
    balanceCollected: collecting ? Number(collectedAmount) || 0 : 0,
    balancePaymentMethod: collecting ? paymentMethod || null : null,
    balanceReference: collecting && needsPaymentReference(paymentMethod) ? paymentReference.trim() : null,
  };

  // Everything on the bill before tax — a discount comes off what was sold,
  // never off the tax the government is owed, so this is what a percentage is
  // a percentage of.
  const discountBase = preview?.discountBase ?? 0;
  // What the solver actually reached. Often not the exact figure typed — the
  // total steps at every GST band boundary and rounds to the rupee.
  const targetAchieved = preview?.targetAchieved ?? null;

  // The desk types what it took from the guest; the discount is whatever makes
  // the bill land there. That is the decision as it is actually made at a
  // counter — "he gave me 1500" — rather than a discount worked out first and
  // a total that falls out of it.
  //
  // Solved server-side, before tax, because a discount shown on an invoice has
  // to come off the taxable value: GST is due on what the guest actually paid.
  const typedCollected = collectedAmount.trim() === '' ? 0 : Number(collectedAmount);

  // True while the box says one thing and the bill below still shows another.
  // Issuing is blocked for that beat rather than quietly writing the bill the
  // desk was looking at a moment ago.
  const discountSettling =
    !Number.isFinite(typedCollected) || round2(typedCollected) !== appliedTarget;

  useEffect(() => {
    const next = !Number.isFinite(typedCollected) || typedCollected < 0 ? 0 : round2(typedCollected);
    if (next === appliedTarget) return undefined;
    const timer = setTimeout(() => setAppliedTarget(next), 350);
    return () => clearTimeout(timer);
  }, [typedCollected, appliedTarget]);

  const handleIssue = async (e) => {
    e.preventDefault();
    setIssueError('');

    // A bill is written when the guest settles — the property extends no
    // credit, so there is no such thing as an issued bill with nothing
    // collected against it. Enforced on the server too; this is only so the
    // desk is told before the request goes out.
    if (collectedAmount.trim() === '') {
      setIssueError('Enter the amount collected from the guest.');
      return;
    }
    const collected = Number(collectedAmount);
    if (!Number.isFinite(collected) || collected < 0) {
      setIssueError('Enter a valid amount collected.');
      return;
    }
    // Zero has no payment type because no payment happened — the only way to
    // get here is an advance that already covered the whole stay.
    if (collected > 0 && !paymentMethod) {
      setIssueError('Choose a payment type for the amount collected.');
      return;
    }
    if (collected > 0 && needsPaymentReference(paymentMethod) && paymentReference.trim() === '') {
      setIssueError('Enter the transaction number for a UPI or card payment.');
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
          // What the server actually applied, read back off the preview —
          // never what was typed. With a target in force the typed discount is
          // blank and this solved figure is the only one that reproduces the
          // bill on screen. Still an amount and never a percentage: the server
          // re-derives that, so the two can't disagree on the document.
          discountAmount: preview.discountAmount ?? 0,
          // Sent only for a stay — a table has no checkout to be late for.
          ...(billTarget.kind === 'STAY' ? { includeLateCheckout } : {}),
          collectedAmount: collected,
          ...(collected > 0 ? { paymentMethod } : {}),
          // Dropped on cash: switching UPI → Cash after typing a reference
          // would file a transaction number against a payment that never had
          // one.
          ...(collected > 0 && needsPaymentReference(paymentMethod)
            ? { paymentReference: paymentReference.trim() }
            : {}),
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
            <span className="chart-section__hint">
              Most recent first. Tags show what was billed and which document was issued.
            </span>
          </div>

          {invoicesError && <div className="form-banner form-banner--error">{invoicesError}</div>}
          {!invoicesError && !invoices && <div className="dash-state">Loading…</div>}
          {!invoicesError && invoices && invoices.length === 0 && (
            <div className="dash-state">No bills issued yet.</div>
          )}
          {!invoicesError && invoices && invoices.length > 0 && (
            <>
              {/* Skipped when everything issued is of one type — a single chip
                  filters nothing and only costs a row of screen. */}
              {billFilters.length > 1 && (
                <div className="billing-panel__filters">
                  <button
                    type="button"
                    className="billing-panel__filter"
                    aria-pressed={activeFilter == null}
                    onClick={() => setBillFilter('ALL')}
                  >
                    All
                    <span className="billing-panel__filter-count">{invoices.length}</span>
                  </button>
                  {billFilters.map((f) => (
                    <button
                      type="button"
                      key={f.key}
                      className="billing-panel__filter"
                      aria-pressed={activeFilter?.key === f.key}
                      onClick={() => setBillFilter(f.key)}
                    >
                      <span className={`bill-tag__dot bill-tag__dot--${tagClass(f.key)}`} aria-hidden="true" />
                      {f.label}
                      <span className="billing-panel__filter-count">{f.count}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="chart-list">
                {visibleInvoices.map((inv) => {
                  const source = billSource(inv);
                  return (
                    <button
                      type="button"
                      className={`chart-row billing-panel__invoice-row billing-panel__invoice-row--${tagClass(source)}${
                        inv.status === 'VOID' ? ' billing-panel__invoice-row--void' : ''
                      }`}
                      key={inv.id}
                      onClick={() => openDetail(inv.id)}
                    >
                      <span className="chart-row__name">
                        <span className="billing-panel__invoice-id">
                          {inv.invoiceNumber}
                          <span className={`bill-tag bill-tag--${tagClass(source)}`}>{SOURCE_LABEL[source]}</span>
                        </span>
                        <span className="chart-row__dates">
                          {/* A food bill has no guest and no room to name, so it
                              identifies itself by the table it closed. */}
                          {inv.kind === 'FOOD'
                            ? inv.tableLabel || 'Counter'
                            : `${inv.guestName} · ${inv.roomNumber}`}
                        </span>
                      </span>
                      <span className="billing-panel__queue-actions">
                        <span className={`bill-tag bill-tag--${DOCUMENT_TAG[inv.documentType]}`}>
                          {DOCUMENT_LABEL[inv.documentType]}
                        </span>
                        {inv.status === 'VOID' && <span className="bill-tag bill-tag--void">Void</span>}
                        <span className="chart-row__value">{formatPrice(inv.totalAmount)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
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
                      {/* Only when reception agreed one at the desk. The
                          amount stays legible even when it is being dropped —
                          the decision here is whether to bill it, and that
                          can't be taken with the number hidden. */}
                      {preview.lateCheckoutAgreed > 0 && (
                        <div className="chart-row">
                          <span className="chart-row__name">
                            Late checkout
                            {preview.lateCheckoutMinutes != null && (
                              <span className="chart-row__dates">
                                {lateLabel(preview.lateCheckoutMinutes)}
                              </span>
                            )}
                          </span>
                          <span
                            className={`chart-row__value${
                              includeLateCheckout ? '' : ' billing-panel__late--dropped'
                            }`}
                          >
                            {formatPrice(preview.lateCheckoutAgreed)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Reception agreed this with the guest at the door, but
                        the bill is written here — a manager who decides the
                        overstay isn't worth charging drops it without sending
                        the guest back to the desk. Dropping it affects this
                        document only: the booking keeps what was agreed and
                        how late the guest actually was. */}
                    {preview.lateCheckoutAgreed > 0 && (
                      <>
                        <div className="toggle-group">
                          <button
                            type="button"
                            aria-pressed={includeLateCheckout}
                            onClick={() => setIncludeLateCheckout(true)}
                          >
                            Add to bill
                          </button>
                          <button
                            type="button"
                            aria-pressed={!includeLateCheckout}
                            onClick={() => setIncludeLateCheckout(false)}
                          >
                            Leave it off
                          </button>
                        </div>
                        <p className="billing-panel__hint">
                          {includeLateCheckout
                            ? 'Charged as part of the room, so it is taxed at the room’s own rate.'
                            : `Not charged on this bill. The stay stays on record as ${lateLabel(
                                preview.lateCheckoutMinutes ?? 0
                              )}.`}
                        </p>
                      </>
                    )}

                    {/* Shut by default and loaded only when opened. Most bills
                        are issued off the three rows above; this is for the
                        one where the guest queries a figure and the desk needs
                        the whole stay — the party, the extras, the advance,
                        night by night — without leaving the bill it is halfway
                        through writing.

                        The same component the tape chart renders, so a stay
                        read here and read there is one record, not two
                        summaries of it. Its own "still to collect" line is
                        turned off: the real balance due, with tax, is a few
                        rows further down this very modal. */}
                    <details
                      className="form-section--collapsible billing-panel__stay-details"
                      onToggle={(e) => e.currentTarget.open && loadStayDetails()}
                    >
                      <summary>View full stay details</summary>
                      {detailStayError && (
                        <div className="form-banner form-banner--error">{detailStayError}</div>
                      )}
                      {!detailStayError && !detailStay && <div className="dash-state">Loading…</div>}
                      {!detailStayError && detailStay && (
                        <StayDetails booking={detailStay} showOutstanding={false} />
                      )}
                    </details>
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

                {/* Which side a bill is issued on isn't the desk's call — it
                    follows the property's registration. Offering the choice
                    only invited a cash receipt to be cut by mistake, which
                    would open a second, parallel invoice series and produce a
                    document sitting outside the GST returns. */}
                <div className="form-section">
                  <div className="form-section__title">Bill</div>
                  <p className="billing-panel__hint">
                    {preview.isGstRegistered
                      ? `Issued under GSTIN ${preview.gstin}.`
                      : 'This property isn’t GST registered — every bill is a cash receipt.'}
                  </p>

                  {activeAmounts && (
                    <div className="sim-result">
                      {/* Room and food are shown as separate taxed blocks
                          because they are separate supplies on different SACs
                          at different rates — merging them would hide the very
                          split GSTR-1 reports on. */}
                      {activeAmounts.subtotal > 0 && (
                        <>
                          {/* What the room charge is actually made of — base
                              rate, season uplift, each switched-on extra —
                              read back from the booking's own snapshot. Staff
                              are asked here to commit to a document they can
                              only void, and a guest querying the total asks
                              about these lines, not the sum of them.

                              Empty for stays booked before the breakdown was
                              snapshotted, which fall through to the subtotal
                              line below on its own, exactly as before. */}
                          {preview.roomCharges?.map((line) => (
                            <div className="sim-result__line sim-result__line--part" key={line.label}>
                              <span>
                                {line.label}
                                {/* Rates only — a concession is one decision
                                    on the whole stay, not one taken per night. */}
                                {line.nights > 1 && line.amount > 0 && (
                                  <span className="sim-result__part-nights">× {line.nights} nights</span>
                                )}
                              </span>
                              <span>{formatPrice(line.amount)}</span>
                            </div>
                          ))}
                          {/* Sits with the parts rather than the totals: it is
                              inside this subtotal and taxed at the room's rate.
                              Absent, not struck through, when the desk drops it
                              — the toggle above is where that decision reads. */}
                          {preview.roomCharges?.length > 0 && preview.lateCheckoutCharge > 0 && (
                            <div className="sim-result__line sim-result__line--part">
                              <span>Late checkout</span>
                              <span>{formatPrice(preview.lateCheckoutCharge)}</span>
                            </div>
                          )}
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
                      {/* After both blocks and before the round off: the
                          subtotals above are what was sold, and this is the
                          one line where money comes off them. The tax lines
                          were already computed on the discounted amounts, so
                          the column still adds up to the total. */}
                      {activeAmounts.discountAmount > 0 && (
                        <div className="sim-result__line">
                          <span>Discount ({activeAmounts.discountPercent}%)</span>
                          <span>-{formatPrice(activeAmounts.discountAmount)}</span>
                        </div>
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

                {/* The decision as it is actually made at a counter: the guest
                    hands over a figure, and whatever the bill has to give up to
                    land there is the discount. Typing it here rather than
                    working out a discount first is the difference between
                    "he gave me 1500" and arithmetic. */}
                <div className="form-section">
                  <div className="form-section__title">Balance collected</div>
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor="collectedAmount">Amount</label>
                      <input
                        id="collectedAmount"
                        type="number"
                        min="0"
                        placeholder={balanceDue ? String(balanceDue) : '0'}
                        value={collectedAmount}
                        onChange={(e) => setCollectedAmount(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="paymentMethod">Payment type</label>
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
                  {/* Only for money that left a trail — what the settlement
                      statement gets matched against at month end. */}
                  {needsPaymentReference(paymentMethod) && (
                    <div className="field">
                      <label htmlFor="paymentReference">Transaction number</label>
                      <input
                        id="paymentReference"
                        value={paymentReference}
                        maxLength={64}
                        placeholder={paymentMethod === 'UPI' ? 'UPI reference / UTR' : 'Approval code'}
                        onChange={(e) => setPaymentReference(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {/* Not typed — worked out. The desk said what it took; this is
                    what the bill had to give up to get there, taken off before
                    tax so GST is charged on what the guest actually paid.
                    Shown in both readings because a guest asks for one and an
                    owner asks for the other. */}
                {activeAmounts && activeAmounts.discountAmount > 0 && (
                  <div className="form-section">
                    <div className="form-section__title">Discount applied</div>
                    <div className="detail-facts">
                      <div className="detail-fact">
                        <span className="detail-fact__label">Amount</span>
                        <span className="detail-fact__value">
                          {formatPrice(activeAmounts.discountAmount)}
                        </span>
                      </div>
                      <div className="detail-fact">
                        <span className="detail-fact__label">Percent</span>
                        <span className="detail-fact__value">{activeAmounts.discountPercent}%</span>
                      </div>
                    </div>
                    <p className="billing-panel__hint">
                      {targetAchieved != null && round2(typedCollected) !== targetAchieved
                        ? `Nearest reachable is ${formatPrice(targetAchieved)} — GST bands each night and the total rounds to the rupee.`
                        : `Taken off ${formatPrice(discountBase)} before tax, so GST is charged on what the guest actually pays.`}
                    </p>
                  </div>
                )}

                {/* Last on the form, because everything above it changes what
                    prints — the discount, whether the overstay is billed, what
                    was collected. Opened before committing to a document that
                    can then only be voided, never edited.

                    Built by the same code that shapes an issued bill and drawn
                    by the same component, so this is the document, not an
                    impression of it. */}
                {preview.document && (
                  <details
                    className="form-section--collapsible billing-panel__bill-preview"
                    onToggle={(e) => setPreviewOpen(e.currentTarget.open)}
                  >
                    <summary>Preview the bill</summary>
                    {previewOpen && (
                      <>
                        <p className="billing-panel__hint">
                          The number and date are stamped on when it is issued.
                        </p>
                        <BillDocument invoice={documentPreview} />
                      </>
                    )}
                  </details>
                )}

                <div className="billing-panel__actions">
                  <button type="button" className="btn-secondary" onClick={closeBilling} disabled={submitting}>
                    Cancel
                  </button>
                  <button
                    className="btn-accent"
                    type="submit"
                    disabled={submitting || preview.alreadyInvoiced || discountSettling}
                  >
                    {submitting ? 'Issuing…' : discountSettling ? 'Recalculating…' : 'Issue bill'}
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
              {/* Both tags, in the same colours as the list row that opened
                  this — the document type alone left a voided bill and a live
                  one looking identical until you read the word. */}
              <span className="billing-panel__detail-tags">
                <span className={`bill-tag bill-tag--${tagClass(billSource(detailInvoice))}`}>
                  {SOURCE_LABEL[billSource(detailInvoice)]}
                </span>
                <span className={`bill-tag bill-tag--${DOCUMENT_TAG[detailInvoice.documentType]}`}>
                  {DOCUMENT_LABEL[detailInvoice.documentType]}
                </span>
                {detailInvoice.status === 'VOID' && <span className="bill-tag bill-tag--void">Void</span>}
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
