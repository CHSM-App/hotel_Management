import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { formatPrice } from './priceFormat';
import { formatDateLong } from './stayFormat';
import BillDocument from './BillDocument';
import AdvanceReceiptModal from './AdvanceReceiptModal';
import StayDetails from './StayDetails';
import './forms.css';
import './chartSections.css';
import './stayDetails.css';
import './Billing.css';

// The paper, the fit maths and the print/PDF plumbing — shared with the advance
// receipt, which prints on the same stock out of the same tray. See billPaper.js
// for why they cannot be two implementations.
import {
  BILL_PDF_WIDTH,
  PAPER_SIZES,
  PAPER_PREVIEW_WIDTH,
  WIDEST_PAPER_PT,
  ROLL_MARGIN,
  fitBillToSheet,
  DEFAULT_PAPER,
  paperById,
  buildDocumentPdfBlob,
  printDocumentOnPaper,
  shareOrDownloadPdf,
} from './billPaper';

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
  // The two an advance receipt can be. Rule 50 names the taxable one; the other
  // is a plain acknowledgement, issued where there is no tax to state.
  RECEIPT_VOUCHER: 'Receipt voucher',
  ADVANCE_RECEIPT: 'Advance receipt',
};

// Colour suffix per document type, so the tag styling stays in the stylesheet
// instead of being derived from the enum name.
const DOCUMENT_TAG = {
  TAX_INVOICE: 'tax',
  BILL_OF_SUPPLY: 'supply',
  CASH_RECEIPT: 'cash',
  RECEIPT_VOUCHER: 'advance',
  ADVANCE_RECEIPT: 'advance',
};

// A bill differs on two axes and the list has to show both: what was sold, and
// which document GST law makes of it. A room tax invoice and a table cash
// receipt are the same wall of digits otherwise.
const SOURCE_LABEL = {
  ROOM: 'Room',
  ROOM_FOOD: 'Room + food',
  TABLE: 'Table',
  ADVANCE: 'Advance',
};

function billSource(inv) {
  if (inv.kind === 'ADVANCE') return 'ADVANCE';
  if (inv.kind === 'FOOD') return 'TABLE';
  // A stay whose guest ordered to the room is neither a plain stay bill nor a
  // food bill — it carries two taxed blocks, and staff reconciling the kitchen
  // against the front desk need to spot it without opening it.
  return inv.foodSubtotal > 0 ? 'ROOM_FOOD' : 'ROOM';
}

// An advance receipt, restated in the shape the bills list reads.
//
// The list, its search, its date range and its filters all speak one document
// shape. Rather than teach each of them that some rows are receipts — four
// places to get wrong, and a fifth the next time something is added — a receipt
// is mapped onto that shape once, here.
//
// `kind: 'ADVANCE'` is what everything downstream keys off, and the id is
// prefixed because an invoice and a receipt can both be row 7: React keys and
// the open-detail lookup would otherwise collide and show the wrong document.
//
// totalAmount is the money actually taken, which is what the list column means
// on every other row — for a receipt that is the advance, not the stay total.
function asDocument(receipt) {
  return {
    ...receipt,
    kind: 'ADVANCE',
    rowKey: `adv-${receipt.id}`,
    // The number the list shows and reception searches by.
    invoiceNumber: receipt.receiptNumber,
    totalAmount: receipt.amountReceived,
    // Read by billSource above and by the row's own markup; a receipt carries
    // no food, and saying so explicitly keeps the shared helpers honest.
    foodSubtotal: 0,
  };
}

function tagClass(key) {
  return key.toLowerCase().replace(/_/g, '-');
}

// What the list can be narrowed down to. What was sold stays visible as a tag
// on every row, but it is not something the list needs to be filtered by.
//
// "Advance receipts" and "Final bills" lead, because they answer different
// questions: what has been collected against stays not yet finished, versus
// what has been billed.
//
// Tax invoices have no chip of their own. On a GST-registered property they are
// very nearly the whole of "Final bills", so the two chips would pick out the
// same rows and the pair would read as a distinction where there isn't one —
// the document type is still tagged on every row for the cases that differ.
const BILL_FILTERS = [
  { key: 'ADVANCE', label: 'Advance receipts', match: (i) => i.kind === 'ADVANCE' },
  { key: 'FINAL', label: 'Final bills', match: (i) => i.kind !== 'ADVANCE' },
  { key: 'CASH_RECEIPT', label: 'Cash receipt', match: (i) => i.documentType === 'CASH_RECEIPT' },
];

// Bills are filed by the month they were issued in, and the timestamp arrives
// in UTC. Every property on this system is in India, so a bill raised at half
// past midnight on the 1st has to count as the new month, not as the old one it
// still is in UTC — hence the shift before the date is read off.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istOf(value) {
  return new Date(new Date(value).getTime() + IST_OFFSET_MS);
}

// The calendar day a bill was issued on, which is what every date control here
// compares against. Taken from when the bill was raised rather than when the
// guest stayed: a bill raised in April for a March stay is April's business,
// which is the month an accountant asks for it in.
function billDateOf(inv) {
  return inv.createdAt ? istOf(inv.createdAt).toISOString().slice(0, 10) : '';
}

function istTodayIso() {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDaysIso(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function firstOfMonth(monthKey) {
  return `${monthKey}-01`;
}

// Day 0 of the next month is the last day of this one, which saves knowing
// which months are 30, 31 or 28 days long.
function lastOfMonth(monthKey) {
  const d = new Date(`${monthKey}-01T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function addMonthsToKey(monthKey, n) {
  const d = new Date(`${monthKey}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n, 1);
  return d.toISOString().slice(0, 7);
}

// The ranges a desk actually asks for, so the common questions cost one click
// instead of typing two dates. Same four the guest register offers, in the same
// order — the two screens are read by the same people on the same day.
const BILL_DATE_PRESETS = [
  { key: 'today', label: 'Today', range: () => [istTodayIso(), istTodayIso()] },
  { key: 'week', label: 'Last 7 days', range: () => [addDaysIso(istTodayIso(), -6), istTodayIso()] },
  {
    key: 'month',
    label: 'This month',
    range: () => [firstOfMonth(istTodayIso().slice(0, 7)), istTodayIso()],
  },
  {
    key: 'prev',
    label: 'Last month',
    range: () => {
      const key = addMonthsToKey(istTodayIso().slice(0, 7), -1);
      return [firstOfMonth(key), lastOfMonth(key)];
    },
  },
];

// Short, because it rides at the end of a row that already carries a name and a
// room — it is there to show why a bill fell into the month on screen.
function formatBillDate(value) {
  if (!value) return '';
  return istOf(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// What reception actually has in hand when they go looking for a bill: the
// number off the printed copy, the guest's name, the room, the table, or the
// phone number the guest is quoting down the line.
function billMatchesSearch(inv, query) {
  if (!query) return true;
  return [inv.invoiceNumber, inv.guestName, inv.roomNumber, inv.tableLabel, inv.guestPhone].some(
    (field) => field && String(field).toLowerCase().includes(query)
  );
}

// The bill drawn on the sheet it will print on.
//
// Not a styled box around the document: the paper is drawn at its real aspect
// ratio and the bill is scaled into it by the same fit the PDF uses, so what
// the desk sees is the proportion of ink to paper they will actually get. A
// bill that overflows its sheet on screen is a bill that would have overflowed
// on paper.
//
// The document itself is never re-laid-out — it renders at its natural width
// and is shrunk with a transform. Restyling it per paper would mean the
// preview and the printed sheet disagreed about line breaks, which is the one
// thing a preview exists to rule out.
function PaperPreview({ paper, invoice, width, billHeight, lang }) {
  const [pw, ph] = paper.pt;
  // Every sheet is drawn at one scale, not each fitted to the same box. Drawn
  // to a common width they all come out the same size, and A4, A5 and A6 —
  // whose proportions are nearly identical by design — became three
  // indistinguishable thumbnails. Sizing them against the widest stock is what
  // makes an A6 look like the slip it is, and shows the thing the desk is
  // actually choosing between: how much paper the same bill covers.
  const pxPerPt = width / WIDEST_PAPER_PT;
  const sheetWidth = pw * pxPerPt;
  const sheetHeight = ph * pxPerPt;

  // Same margin rule as the PDF: proportional on the small stocks, capped at
  // 24pt on the large ones, so the preview's white border is the real one.
  const marginPt = paper.continuous ? ROLL_MARGIN : Math.min(24, pw * 0.04);
  const inset = marginPt * pxPerPt;

  // The bill renders at its natural CSS width and is scaled to the space inside
  // the margins — down only, never up, and fitted on both dimensions exactly as
  // buildBillPdfBlob does. Fitting on width alone would have shown the bill
  // clipped at the foot of a landscape sheet when the PDF in fact shrinks it to
  // fit: a preview that disagrees with the file it is previewing is worse than
  // no preview.
  //
  // A roll is the one exception — its height is cut to the bill, so there is no
  // height for the fit to be constrained by.
  const availableWidth = sheetWidth - inset * 2;
  const availableHeight = sheetHeight - inset * 2;
  const naturalWidth = BILL_PDF_WIDTH;
  const naturalHeight = billHeight || naturalWidth * 1.3;
  // The same fit and fill as the print dialog and the PDF, so the thumbnail is
  // a picture of the sheet that will actually come out.
  const { scale, stayHeight } = fitBillToSheet(
    availableWidth,
    availableHeight,
    naturalWidth,
    naturalHeight,
    paper.continuous
  );

  return (
    <div className="paper-preview">
      <div
        className={`paper-preview__sheet${paper.continuous ? ' paper-preview__sheet--roll' : ''}`}
        style={{ width: sheetWidth, height: sheetHeight }}
      >
        <div
          className="paper-preview__ink"
          style={{
            top: inset,
            left: inset,
            width: naturalWidth,
            '--memo-stay-h': `${Math.round(stayHeight)}px`,
            transform: `scale(${scale})`,
            // Scaled from its own top-left so the bill sits against the
            // margin, not floating from the middle of the sheet.
            transformOrigin: 'top left',
            // The scale above already fits the bill inside the sheet, so this
            // only guards the case where the natural height was still being
            // measured on the first paint.
            maxHeight: paper.continuous ? 'none' : availableHeight / scale,
          }}
        >
          <BillDocument invoice={invoice} lang={lang} />
        </div>
      </div>
      <div className="paper-preview__caption">
        {paper.label} · {paper.hint}
      </div>
    </div>
  );
}

// The six stocks side by side, each a clickable sheet. One component because
// it now hangs in two places — the issued bill's detail modal, and the issue
// form while the bill is still being put together — and the two must offer
// the same choice the same way.
// The compact dropdown form of the same choice. One component for the same
// reason as the grid below: it appears beside the Print button and inside the
// issue form's paper fold, and the two must always list the same stocks.
function PaperSelect({ value, onChange }) {
  return (
    <label className="billing-panel__paper">
      <span className="billing-panel__paper-label">Paper</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Paper size for printing and PDF"
      >
        {PAPER_SIZES.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label} · {p.hint}
          </option>
        ))}
      </select>
    </label>
  );
}

// English or Marathi masthead. A dropdown rather than a flag toggle so the
// control names both states — a lone "मराठी" button reads as decoration to
// staff who don't know it is a switch.
function BillLangSelect({ value, onChange }) {
  return (
    <label className="billing-panel__paper">
      <span className="billing-panel__paper-label">Language</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Bill masthead language">
        <option value="en">English</option>
        <option value="mr">मराठी</option>
      </select>
    </label>
  );
}

function PaperSizeGrid({ invoice, billHeight, value, onChange, lang }) {
  return (
    <div className="paper-preview__grid">
      {PAPER_SIZES.map((p) => (
        <button
          type="button"
          key={p.id}
          className={`paper-preview__choice${p.id === value ? ' paper-preview__choice--on' : ''}`}
          onClick={() => onChange(p.id)}
          aria-pressed={p.id === value}
        >
          <PaperPreview paper={p} invoice={invoice} width={PAPER_PREVIEW_WIDTH} billHeight={billHeight} lang={lang} />
        </button>
      ))}
    </div>
  );
}

export default function Billing({ lodge, billNowBookingId = null }) {
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
  // Advance receipts share the bills list with invoices — both are money taken,
  // and a month's takings that showed only invoices would understate what the
  // property actually collected. Held apart in state and merged for display, so
  // a failure to load one kind still shows the other.
  const [receipts, setReceipts] = useState(() => readCache('/billing/advance-receipts'));
  const [billFilter, setBillFilter] = useState('ALL');
  const [billSearch, setBillSearch] = useState('');
  // One range is the whole date filter. The month picker, the presets and the
  // two date boxes are three ways of setting these two values rather than three
  // filters that could disagree with each other — which is what a month
  // dropdown sitting next to its own from/to inputs would otherwise be.
  // Empty means unbounded on that end, so '' / '' is "every bill".
  const [billFrom, setBillFrom] = useState('');
  const [billTo, setBillTo] = useState('');

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

  // Swallowed rather than banner-ed: receipts are one part of the list, and a
  // property that has never issued one still wants its bills. The list simply
  // shows what loaded.
  const loadReceipts = () => {
    apiGet('/billing/advance-receipts', { token })
      .then((data) => setReceipts(writeCache('/billing/advance-receipts', data.receipts)))
      .catch(() => {});
  };

  useEffect(() => {
    loadQueue();
    loadFoodTabs();
    loadInvoices();
    loadReceipts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAll = () => {
    loadQueue();
    loadFoodTabs();
    loadInvoices();
    loadReceipts();
  };

  // The three ways the bills list narrows: what kind of document it is, when it
  // was issued, and a search over the things staff have in hand when they come
  // looking. Each counts over the set the *other two* leave, so a chip never
  // advertises a number that turns into an empty list when it is clicked, and
  // the month picker never offers a month that has been searched out of
  // existence.
  const billQuery = billSearch.trim().toLowerCase();
  const matchesDate = (inv) => {
    const day = billDateOf(inv);
    if (!day) return !billFrom && !billTo;
    return (!billFrom || day >= billFrom) && (!billTo || day <= billTo);
  };
  const matchesSearch = (inv) => billMatchesSearch(inv, billQuery);

  // Which of the three date controls is showing the range that is actually set.
  // Derived from the range rather than remembered alongside it, so typing a
  // date un-highlights the preset it no longer matches instead of leaving two
  // controls both claiming to be in charge.
  const activePreset = BILL_DATE_PRESETS.find((p) => {
    const [from, to] = p.range();
    return from === billFrom && to === billTo;
  });
  // A range nobody can satisfy. Left to filter to nothing rather than silently
  // ignored — the note beside the boxes says why the list emptied.
  const invalidRange = Boolean(billFrom && billTo && billTo < billFrom);

  const applyPreset = (preset) => {
    const [from, to] = preset.range();
    setBillFrom(from);
    setBillTo(to);
  };

  const clearBillDates = () => {
    setBillFrom('');
    setBillTo('');
  };

  // Everything the bills list shows: invoices and advance receipts as one set of
  // documents, newest first. Sorted after merging rather than concatenated —
  // each list arrives sorted on its own, and appending one to the other would
  // put every receipt below every bill regardless of date.
  //
  // Null only while nothing has loaded at all; once either kind is in hand the
  // list renders what it has, so a receipts fetch that failed doesn't hide the
  // bills.
  const documents =
    invoices || receipts
      ? [...(invoices ?? []), ...(receipts ?? []).map(asDocument)].sort((a, b) =>
          String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
        )
      : null;

  // Only the types this property actually issues get a chip — a property that
  // isn't GST registered only ever writes cash receipts, and should not be
  // offered a "Tax invoice" filter that matches nothing. Same rule retires the
  // advance/final split on a property that has only ever issued one of them.
  const billFilters = documents
    ? BILL_FILTERS.map((f) => ({
        ...f,
        count: documents.filter((i) => f.match(i) && matchesDate(i) && matchesSearch(i)).length,
      })).filter((f) => f.count > 0)
    : [];
  // Looked up rather than trusted: voiding the last bill of a type empties its
  // chip, and the list falls back to everything instead of going blank.
  const activeFilter = billFilters.find((f) => f.key === billFilter) ?? null;

  const visibleInvoices =
    documents &&
    documents.filter((i) => (!activeFilter || activeFilter.match(i)) && matchesDate(i) && matchesSearch(i));
  const billsFiltered = Boolean(billQuery) || Boolean(billFrom) || Boolean(billTo) || activeFilter != null;

  const clearBillFilters = () => {
    setBillFilter('ALL');
    setBillSearch('');
    setBillFrom('');
    setBillTo('');
  };

  // Bill modal. One modal serves both kinds — the amounts and the payment
  // capture are identical; only the endpoints and the header differ, so
  // `billTarget` carries which is being billed.
  //   { kind: 'STAY', bookingId }  |  { kind: 'FOOD', tableId, label }
  //
  // A stay handed straight over by a checkout opens its bill on mount: the
  // guest is at the desk about to pay, so reception shouldn't have to find them
  // again in the queue they were just added to. Every other value openBilling()
  // resets is already at that same initial state here, so seeding the target is
  // the whole of it. Closing the bill leaves them on the queue as usual.
  const [billTarget, setBillTarget] = useState(
    billNowBookingId != null ? { kind: 'STAY', bookingId: billNowBookingId } : null
  );
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
    setIssuePaperOpen(false);
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
  // Memoised so its identity only moves when its inputs do: the paper fold's
  // measuring effect keys off this object, and a fresh one per render would
  // re-measure the offscreen copy — a forced reflow — on every keystroke in
  // the modal.
  const documentPreview = useMemo(
    () =>
      preview?.document && {
        ...preview.document,
        balanceCollected: collecting ? Number(collectedAmount) || 0 : 0,
        balancePaymentMethod: collecting ? paymentMethod || null : null,
        balanceReference: collecting && needsPaymentReference(paymentMethod) ? paymentReference.trim() : null,
      },
    [preview, collecting, collectedAmount, paymentMethod, paymentReference]
  );

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
  // An advance receipt opened from the list. It gets the receipt modal rather
  // than the bill modal below: the two documents are voided differently, print
  // from different components, and a receipt has no food tab or balance to
  // collect. One modal serving both would be a pile of conditionals over two
  // documents that only share a shape by coincidence.
  const [detailReceipt, setDetailReceipt] = useState(null);

  // The list holds both kinds, so the row hands over the document itself rather
  // than an id — ids collide across the two tables.
  const openDetail = (doc) => {
    if (doc.kind === 'ADVANCE') {
      setDetailReceipt(doc);
      return;
    }
    setDetailInvoiceId(doc.id);
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
  // The bill the user is actually looking at, measured at capture time so the
  // offscreen copy can be laid out at exactly the same width.
  const billPreviewRef = useRef(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  // The stock this bill goes out on. Held per-session rather than saved: a
  // desk prints on what is in the tray today, and the tray is what changes.
  const [paperSize, setPaperSize] = useState(DEFAULT_PAPER);
  // Which language the masthead prints in. Session state like the paper —
  // the house that bills in Marathi bills in Marathi all day.
  const [billLang, setBillLang] = useState('en');
  // Rendering six full bills is six full documents in the DOM. Kept shut until
  // asked for, the way the issue-form preview is.
  const [paperPreviewsOpen, setPaperPreviewsOpen] = useState(false);
  // The same fold on the issue form, so the sheet is chosen while the bill is
  // being put together rather than after it exists. Its thumbnails need the
  // draft bill's natural height, measured off an offscreen copy of the
  // preview document — the issued bill's copy doesn't exist yet.
  const [issuePaperOpen, setIssuePaperOpen] = useState(false);
  const [issueBillHeight, setIssueBillHeight] = useState(0);
  const issueMeasureRef = useRef(null);
  // The bill's natural height at BILL_PDF_WIDTH, measured off the offscreen
  // capture copy — which is already laid out at exactly that width for the PDF.
  // The previews need it to fit the document to a sheet the way the PDF does;
  // until it is known they fall back to a nominal A4-ish ratio, which is only
  // ever on screen for the first paint.
  const [billHeight, setBillHeight] = useState(0);

  // Print on the chosen stock. The measurement comes off the offscreen copy —
  // laid out at a fixed width and never restyled, so it is the one honest
  // measurement of the document; the visible copy sits in a modal whose width
  // varies.
  const handlePrint = () => printDocumentOnPaper(billRef.current, paperSize);

  // Measured when the previews are opened rather than on every render: the
  // node is offscreen and fixed-width, so its height only changes when the
  // bill itself does — and reading offsetHeight in a layout effect on each
  // pass would be a forced reflow for a number that did not move.
  useEffect(() => {
    if (!paperPreviewsOpen) return;
    const node = billRef.current;
    if (node) setBillHeight(node.offsetHeight);
  }, [paperPreviewsOpen, detailInvoice]);

  // Its twin on the issue form, reading the offscreen copy of the draft. The
  // draft re-prices as the form changes — discount, overstay, collection — so
  // the height follows the preview document, not just the fold opening.
  useEffect(() => {
    if (!issuePaperOpen) return;
    const node = issueMeasureRef.current;
    if (node) setIssueBillHeight(node.offsetHeight);
  }, [issuePaperOpen, documentPreview]);

  const buildBillPdfBlob = () =>
    buildDocumentPdfBlob(billRef.current, {
      paperSize,
      // The width the user is actually looking at, so the offscreen copy wraps
      // its text identically and the file matches the preview line for line.
      shownWidth: billPreviewRef.current?.offsetWidth,
    });

  const handleSharePdf = async () => {
    setPdfError('');
    setPdfBusy(true);
    try {
      const blob = await buildBillPdfBlob();
      await shareOrDownloadPdf(blob, `${detailInvoice.invoiceNumber.replace(/[\\/]/g, '-')}.pdf`);
    } catch (err) {
      // An aborted share sheet is the user changing their mind, not a failure.
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
          {!invoicesError && !documents && <div className="dash-state">Loading…</div>}
          {!invoicesError && documents && documents.length === 0 && (
            <div className="dash-state">No bills issued yet.</div>
          )}
          {!invoicesError && documents && documents.length > 0 && (
            <>
              {/* The dates a bill was issued between, with the shortcuts for the
                  common answers underneath. Search sits alongside for the one
                  bill somebody is holding a copy of. */}
              <div className="billing-panel__bill-tools">
                <div className="billing-panel__bill-range">
                  <div className="field">
                    <input
                      type="date"
                      aria-label="Bills issued from"
                      value={billFrom}
                      onChange={(e) => setBillFrom(e.target.value)}
                    />
                  </div>
                  <span className="billing-panel__bill-range-dash" aria-hidden="true">
                    –
                  </span>
                  <div className="field">
                    <input
                      type="date"
                      aria-label="Bills issued up to"
                      value={billTo}
                      onChange={(e) => setBillTo(e.target.value)}
                    />
                  </div>
                </div>

                <div className="field billing-panel__bill-search">
                  <svg
                    className="billing-panel__bill-search-icon"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    aria-label="Search bills"
                    value={billSearch}
                    onChange={(e) => setBillSearch(e.target.value)}
                    placeholder="Bill number, guest, room, table or phone"
                  />
                  {billSearch && (
                    <button
                      type="button"
                      className="billing-panel__bill-search-clear"
                      onClick={() => setBillSearch('')}
                      aria-label="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>

                {billsFiltered && (
                  <span className="billing-panel__bill-count">
                    {visibleInvoices.length} of {documents.length}
                    <button type="button" className="billing-panel__bill-clear" onClick={clearBillFilters}>
                      Clear
                    </button>
                  </span>
                )}
              </div>

              {/* Shortcuts into the same range the controls above hold — the
                  four questions asked often enough that typing two dates for
                  them is work nobody should be doing twice a day. */}
              <div className="billing-panel__bill-presets">
                {BILL_DATE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className="billing-panel__bill-preset"
                    aria-pressed={activePreset?.key === p.key}
                    onClick={() => applyPreset(p)}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="billing-panel__bill-preset"
                  aria-pressed={!billFrom && !billTo}
                  onClick={clearBillDates}
                >
                  All time
                </button>
              </div>

              {invalidRange && (
                <p className="billing-panel__bill-note">
                  The “to” date is before the “from” date, so nothing can match. Swap them or clear
                  the dates.
                </p>
              )}

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
                    {/* Counted within the dates and search on screen, like every
                        other chip — "All 42" above a list of six would be
                        describing a list nobody is looking at. */}
                    <span className="billing-panel__filter-count">
                      {documents.filter((i) => matchesDate(i) && matchesSearch(i)).length}
                    </span>
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

              {/* Nothing left after filtering is a different thing from having
                  issued no bills, and says so — with the way out beside it. */}
              {visibleInvoices.length === 0 && (
                <div className="dash-state">
                  No bills match these filters.{' '}
                  <button type="button" className="billing-panel__bill-clear" onClick={clearBillFilters}>
                    Clear filters
                  </button>
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
                      key={inv.rowKey ?? inv.id}
                      onClick={() => openDetail(inv)}
                    >
                      <span className="chart-row__name">
                        <span className="billing-panel__invoice-id">
                          {inv.invoiceNumber}
                          <span className={`bill-tag bill-tag--${tagClass(source)}`}>{SOURCE_LABEL[source]}</span>
                        </span>
                        <span className="chart-row__dates">
                          {/* A food bill has no guest and no room to name, so it
                              identifies itself by the table it closed. The date
                              earns its place now the list filters by month —
                              without it a row can't say why it is on screen. */}
                          {inv.kind === 'FOOD'
                            ? inv.tableLabel || 'Counter'
                            : `${inv.guestName} · ${inv.roomNumber}`}
                          {inv.createdAt && ` · ${formatBillDate(inv.createdAt)}`}
                          {/* Why anybody looks a receipt up again: what is
                              still to come on the stay it was taken against. */}
                          {inv.kind === 'ADVANCE' &&
                            inv.balanceDue > 0 &&
                            ` · ${formatPrice(inv.balanceDue)} due`}
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
                        </>
                      )}

                      {activeAmounts.foodSubtotal > 0 && (
                        <div className="sim-result__line">
                          <span>Food</span>
                          <span>{formatPrice(activeAmounts.foodSubtotal)}</span>
                        </div>
                      )}

                      {/* Before every tax line, because that is where it is
                          actually applied: GST is computed on the subtotal
                          less this, not on the subtotal. Printed under the tax
                          it had already reduced, it read as a deduction from
                          the taxed total — which is the one thing a discount
                          on an invoice must not appear to be. */}
                      {activeAmounts.discountAmount > 0 && (
                        <div className="sim-result__line">
                          <span>Discount ({activeAmounts.discountPercent}%)</span>
                          <span>-{formatPrice(activeAmounts.discountAmount)}</span>
                        </div>
                      )}

                      {/* Room and food taxed separately — different SACs at
                          different rates, which is the split GSTR-1 reports
                          on. Both sit below the discount because both were
                          computed on the amounts left after it. */}
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

                      {(activeAmounts.foodCgstAmount > 0 || activeAmounts.foodSgstAmount > 0) && (
                        <>
                          <div className="sim-result__line">
                            <span>CGST ({activeAmounts.foodCgstRatePercent}%) on food</span>
                            <span>{formatPrice(activeAmounts.foodCgstAmount)}</span>
                          </div>
                          <div className="sim-result__line">
                            <span>SGST ({activeAmounts.foodSgstRatePercent}%) on food</span>
                            <span>{formatPrice(activeAmounts.foodSgstAmount)}</span>
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
                        {/* Marked as the print target too: staff do print
                            from the issue form to check a bill before
                            committing to it. */}
                        <div className="bill-print-target">
                          <BillDocument invoice={documentPreview} lang={billLang} />
                        </div>
                      </>
                    )}
                  </details>
                )}

                {/* The sheet is chosen here, while the bill is still being put
                    together — by the time the issued bill's own modal opens,
                    the desk already has the paper in the tray. The choice is
                    one piece of state, so whatever is picked here is what
                    Print and the PDF use afterwards. */}
                {preview.document && (
                  <details
                    className="form-section--collapsible billing-panel__paper-previews"
                    onToggle={(e) => setIssuePaperOpen(e.currentTarget.open)}
                  >
                    <summary>
                      Paper size
                      <span className="billing-panel__paper-current">{paperById(paperSize).label}</span>
                    </summary>
                    {issuePaperOpen && (
                      <>
                        <p className="billing-panel__hint">
                          How this bill sits on each sheet. The pick carries through to Print and the PDF once
                          the bill is issued.
                        </p>
                        {/* The same choice twice on purpose: the dropdown for
                            a desk that already knows its stock, the sheets
                            below for one deciding by eye. */}
                        <div className="billing-panel__print-options">
                          <PaperSelect value={paperSize} onChange={setPaperSize} />
                <BillLangSelect value={billLang} onChange={setBillLang} />
                          <BillLangSelect value={billLang} onChange={setBillLang} />
                        </div>
                        <PaperSizeGrid
                          invoice={documentPreview}
                          billHeight={issueBillHeight}
                          value={paperSize}
                          onChange={setPaperSize}
                          lang={billLang}
                        />
                        {/* What the thumbnails measure from: the draft at the
                            same fixed width the PDF captures at. Offscreen —
                            the copies on screen are inside modals whose width
                            varies with the viewport. */}
                        <div
                          className="billing-panel__pdf-source"
                          style={{ width: BILL_PDF_WIDTH }}
                          aria-hidden="true"
                        >
                          <BillDocument ref={issueMeasureRef} invoice={documentPreview} lang={billLang} />
                        </div>
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

      {/* An advance receipt opened from the list: reprint, share, or void. No
          booking is passed, so it opens straight on the document with no form —
          the money was taken when the booking was made. */}
      {detailReceipt && (
        <AdvanceReceiptModal
          initialReceipt={detailReceipt}
          onClose={() => setDetailReceipt(null)}
          onVoided={() => {
            loadReceipts();
            loadQueue();
          }}
        />
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

            {/* The bill at full size, and the ref the PDF capture measures to
                size its offscreen copy. It has to stay unscaled: offsetWidth
                on a transformed node reports the drawn width, and the capture
                would be laid out to a figure the document never used. */}
            {/* The one copy that prints. The wrapper carries the marker the
                print stylesheet keys off — the modal holds other copies of the
                same document (the PDF source, the paper thumbnails) and only
                this one is the bill. */}
            <div className="bill-print-target">
              <BillDocument ref={billPreviewRef} invoice={detailInvoice} lang={billLang} />
            </div>

            {/* The same bill on each stock it can be printed on, drawn to the
                real proportions of the sheet. The picker below chooses one; a
                desk deciding between them needs to see the choice, not read
                two sets of millimetres and imagine it. */}
            <details
              className="form-section--collapsible billing-panel__paper-previews"
              onToggle={(e) => setPaperPreviewsOpen(e.currentTarget.open)}
            >
              <summary>Preview on each paper size</summary>
              {paperPreviewsOpen && (
                <>
                  <p className="billing-panel__hint">
                    How the bill sits on each sheet. Selecting one here sets the paper for Print and the PDF.
                  </p>
                  <PaperSizeGrid
                    invoice={detailInvoice}
                    billHeight={billHeight}
                    value={paperSize}
                    onChange={setPaperSize}
                    lang={billLang}
                  />
                </>
              )}
            </details>

            {/* What the PDF is rasterised from: the same document again, parked
                offscreen and sized by buildBillPdfBlob to the width of the
                visible copy above — so the file shows exactly the layout the
                user approved, without restyling the bill under them while it
                downloads. */}
            {/* The initial width matters, not just the capture-time one: a
                position:fixed box parked at -10000px with width:auto may
                stretch from that offset to the viewport edge, so without this
                the copy laid itself out ~10,000px wide and its amount column
                poked into the page. buildBillPdfBlob overwrites this same
                inline style with the preview's measured width. */}
            <div
              className="billing-panel__pdf-source"
              style={{ width: BILL_PDF_WIDTH }}
              aria-hidden="true"
            >
              <BillDocument ref={billRef} invoice={detailInvoice} lang={billLang} />
            </div>

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
                {/* Beside the two buttons it governs, because it governs both
                    — printing and the download have to agree about the sheet,
                    and a control parked elsewhere reads as belonging to
                    whichever one is nearer. */}
                <PaperSelect value={paperSize} onChange={setPaperSize} />
                <BillLangSelect value={billLang} onChange={setBillLang} />
                <button type="button" className="btn-secondary" onClick={handlePrint}>
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
