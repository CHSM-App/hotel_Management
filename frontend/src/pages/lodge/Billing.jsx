import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost, ApiError } from '../../lib/api';
import { useUrlState } from '../../lib/urlState';
import BillNumberingPanel from './BillNumberingPanel';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { formatPrice } from './priceFormat';
import { formatDateLong } from './stayFormat';
import BillDocument from './BillDocument';
import DownloadIcon from '../../components/DownloadIcon';
import ShareMenu from '../../components/ShareMenu';
import Req from '../../components/RequiredMark';
import {
  buildMailLink,
  buildWhatsAppLink,
  openComposer,
  openExternal,
} from '../../lib/shareLinks';
import { useToast } from '../../components/Toast';
import PaymentLines from './PaymentLines';
import {
  needsPaymentReference,
  paymentLinesError,
  sumLines,
  toPaymentLines,
} from './paymentSplit';
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
  printPdfBlob,
  downloadPdf,
  sharePdf,
} from './billPaper';

// What the bill says beside a discount given because a cycle-property guest
// left before their booked nights ran out.
const EARLY_DISCOUNT_REASON = 'Leaving early';

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
  EVENT: 'Function',
  ADVANCE: 'Advance',
};

function billSource(inv) {
  if (inv.kind === 'ADVANCE') return 'ADVANCE';
  if (inv.kind === 'EVENT') return 'EVENT';
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

// Clock time on an open food tab row — when it opened, or when a takeaway was
// placed. Only ever shown beside a tab that is still waiting to be billed, so
// the date is today's and would be noise.
function timeOf(value) {
  return new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
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
// The rendered height of a document node, kept current for as long as the
// node exists.
//
// Watched rather than measured once. The thumbnails stretch the memo's open
// stay block by exactly the slack between the bill's natural height and the
// sheet, so the figure has to be right *and* current: read a moment too early
// (before the webfonts settle, on the first paint) or left stale (the language
// toggle re-wraps every line; the draft re-prices as the form changes) and the
// stretched bill overshoots the sheet by the difference — which the sheet then
// clips, taking the signature row and the thank-you off the bottom. An
// observer reports every one of those changes; a one-shot effect keyed on the
// props it happened to know about missed all of them.
//
// Returns a callback ref, because the node it watches is mounted and unmounted
// with the fold it lives in — and the node itself, for the caller that needs
// to hand the same copy to the PDF capture.
//
// The observer fires its first report on observe(), so nothing is read
// synchronously here; a browser without it reads once, a frame after mount.
function useMeasuredHeight() {
  const [node, setNode] = useState(null);
  const [height, setHeight] = useState(0);
  const attach = useCallback((el) => setNode(el), []);

  useEffect(() => {
    if (!node) return undefined;
    if (typeof ResizeObserver === 'undefined') {
      const frame = requestAnimationFrame(() => setHeight(node.offsetHeight));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [attach, height, node];
}

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
  // Zero until the offscreen copy has been measured. fitBillToSheet treats an
  // unknown height as unconstrained — width-fit only, no stretch — so the
  // first paint shows the bill at its resting size rather than stretched
  // against a guess. The guess it replaced (an A4-ish ratio) was shorter than
  // a memo with its declaration and signature rows, and stretching against a
  // too-short figure overshot the sheet by the difference: the foot of the
  // bill was clipped off every thumbnail until something happened to
  // re-measure it.
  const naturalHeight = billHeight;
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

// modalOnly renders the bill modal and nothing else — no sub-tabs, no queue,
// no bills list. It is how another screen (the bookings tab, after a checkout)
// opens a bill without navigating here and without wrapping this page in an
// overlay of its own: the modal is already a self-contained full-viewport
// dialog that closes itself, so it needs no chrome around it.
//
// onClose lets the owner of that decision unmount this again. Without it,
// closing the modal would leave an invisible Billing mounted forever and a
// second attempt at the same booking would be a no-op — the parent's state
// would already hold that id, so nothing would re-render.
// billNowEventId is the same hand-over from the events diary: a function
// whose organiser is settling up opens its bill straight away.
// viewInvoiceId opens an already-issued bill's document straight away — a
// settled function's "View bill" — rather than asking for a new preview the
// server would rightly refuse.
export default function Billing({ lodge, billNowBookingId = null, billNowEventId = null, viewInvoiceId = null, modalOnly = false, onClose }) {
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
    // The key stays 'tables' so existing ?tab= links keep landing here; only
    // the wording widens, because rooms and takeaways sit in this list too.
    ...(billsTables ? [{ key: 'tables', label: 'Food to bill' }] : []),
    { key: 'bills', label: 'Bills' },
    // Last, and deliberately not first: numbering is set once at setup and
    // then left alone, while the other tabs are used every day.
    { key: 'numbering', label: 'Numbering' },
  ];

  // The landing tab depends on what this login can bill, so it is worked out
  // first and handed to the hook as the fallback — a URL with no tab lands
  // exactly where it did before.
  const defaultTab = billsStays ? 'ready' : billsTables ? 'tables' : 'bills';
  const [tab, setTab] = useUrlState('tab', defaultTab);
  // A ?tab= this screen doesn't own falls back to the landing tab rather than
  // matching nothing and rendering an empty page under an unselected strip.
  // Checked against `tabs`, not a fixed list: a property that bills no stays
  // has no "ready" tab, so a link to one has to land somewhere real too.
  const activeTab = tabs.some((t) => t.key === tab) ? tab : defaultTab;
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
  //   { kind: 'STAY', bookingId }  |  { kind: 'FOOD', tab, label }
  //
  // A stay handed straight over by a checkout opens its bill on mount: the
  // guest is at the desk about to pay, so reception shouldn't have to find them
  // again in the queue they were just added to. Every other value openBilling()
  // resets is already at that same initial state here, so seeding the target is
  // the whole of it. Closing the bill leaves them on the queue as usual.
  const [billTarget, setBillTarget] = useState(
    billNowBookingId != null
      ? { kind: 'STAY', bookingId: billNowBookingId }
      : billNowEventId != null
        ? { kind: 'EVENT', eventBookingId: billNowEventId }
        : null
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
  // How the guest is paying, as a list — one row per way the money came in.
  // null until the desk touches it, which is what lets an untouched bill show
  // the balance due; see payLines below.
  const [payLinesInput, setPayLinesInput] = useState(null);

  const [issueError, setIssueError] = useState('');
  // Which input the message belongs under, when it belongs under one. A bill
  // has three things that can be missing and they are in three different boxes;
  // one banner for all of them says something is wrong but not where.
  const [issueField, setIssueField] = useState(null);

  // Named to read like an assignment at the call site: fail the amount, fail
  // the method. Anything with no field behind it — a refusal from the server —
  // passes null and falls back to the banner above the buttons.
  //
  // The issue form scrolls (the stay/function summary, the discount fold, the
  // bill preview all sit above the payment rows), so a failure caught on
  // submit has to bring itself into view rather than rely on already being on
  // screen — same idea as failOn/reportFormError elsewhere in the app. A
  // field error scrolls to the DOM node it names; a fieldless one scrolls the
  // banner into view instead, once it exists on the next paint.
  const issueErrorRef = useRef(null);
  const failIssue = (message, field = null) => {
    setIssueError(message);
    setIssueField(field);
    if (field) {
      const el = document.getElementById(field);
      if (el) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    } else if (message) {
      requestAnimationFrame(() => {
        issueErrorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
  };

  const issueFieldError = (field) =>
    issueError && issueField === field ? <p className="field__error">{issueError}</p> : null;
  const [submitting, setSubmitting] = useState(false);
  // Whether the overstay charge reception agreed at the desk lands on this
  // bill. Starts as "yes" — it was already agreed with the guest — and the
  // person writing the bill is the one who can still take it back off.
  const [includeLateCheckout, setIncludeLateCheckout] = useState(true);
  // A discount the desk gives on a CYCLE stay, in rupees, with the reason that
  // prints beside it. Kept as the typed strings; the server caps the amount
  // and solves the document. An early departure pre-fills both; anything else
  // ("regular guest", "AC not working") is typed. Empty amount means nothing
  // off — the bill prices every night that was booked.
  const [discountInput, setDiscountInput] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const cycleDiscount = Number(discountInput) || 0;
  const isCycleStay = preview?.document?.checkinMode === 'CYCLE';
  const earlyReducing = discountReason === EARLY_DISCOUNT_REASON;
  // A discount is agreed as a percentage or as a round figure depending on who
  // is asking, so both boxes exist and each fills in the other. Only the amount
  // is ever sent — a percentage and an amount that disagree have no right
  // answer, and money is the half that gets collected.

  const openBilling = (target) => {
    setBillTarget(target);
    setPreview(null);
    setPreviewError('');
    setPayLinesInput(null);
    setIssueError('');
    setIncludeLateCheckout(true);
    setDiscountInput('');
    setDiscountReason('');
    setDetailStay(null);
    setDetailStayError('');
    setPreviewOpen(false);
    setIssuePaperOpen(false);
  };

  const closeBilling = () => {
    if (submitting) return;
    setBillTarget(null);
    // In modalOnly there is nothing left to look at once the modal is gone.
    onClose?.();
  };

  // The late charge is in the path rather than subtracted here on the client:
  // adding it can move the stay into a higher GST band and change the round
  // off, so the server re-derives the whole document instead.
  //
  // What the desk collects is deliberately NOT in here. The balance due is what
  // the stay costs, and a figure typed into "Balance collected" must not change
  // it — a total that moved while money was being counted is a total nobody can
  // check the till against.
  const previewPath = billTarget
    ? billTarget.kind === 'STAY'
      ? `/billing/bookings/${billTarget.bookingId}/preview?includeLateCheckout=${includeLateCheckout}${
          cycleDiscount > 0
            ? `&discountAmount=${cycleDiscount}&discountReason=${encodeURIComponent(discountReason.trim())}`
            : ''
        }`
      : billTarget.kind === 'EVENT'
        ? `/billing/events/${billTarget.eventBookingId}/preview${
            cycleDiscount > 0
              ? `?discountAmount=${cycleDiscount}&discountReason=${encodeURIComponent(discountReason.trim())}`
              : ''
          }`
        : `/billing/food-tabs/${billTarget.tab}/preview`
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
  // A stay paid in full up front. The bill still has to be issued — it is the
  // tax document — but there is no money changing hands at the desk, so
  // nothing about a payment is asked for: no amount, no method, no rows. The
  // server draws the same line (a zero collection needs no payment lines).
  // Compared in paise, like every other settlement figure on this form.
  const nothingDue = Math.round(balanceDue * 100) <= 0;

  // The desk collects exactly what is due on almost every bill, so the first
  // row starts there rather than empty and only the method is left to pick.
  //
  // Derived rather than seeded from an effect: the balance is only known once
  // the preview lands, and writing it into state from an effect would re-render
  // the modal an extra time on every open for a value that can just be
  // computed. Once anything is typed, payLinesInput takes over for good —
  // clearing a row still means "collect nothing" there.
  const payLines =
    payLinesInput ?? [{ method: '', amount: balanceDue > 0 ? String(balanceDue) : '', reference: '' }];

  // There is no Amount box any more: what the guest handed over is however much
  // the rows add up to. Kept as a string because everything downstream — the
  // "was anything collected" test, the preview overlay, the POST — was written
  // against the box's own value and reads exactly as it did.
  const collectedTotal = sumLines(payLines);
  const collectedAmount = collectedTotal > 0 ? String(collectedTotal) : '';

  // The first tender, which is what the invoice's own scalar columns record and
  // what the printed bill decorates its Net Payment line with.
  const paymentMethod = payLines[0].method;
  const paymentReference = payLines[0].reference;

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  // The server builds the document from everything it knows; the payment being
  // typed into the modal right now is the one thing it doesn't, so it is laid
  // over the top. Without this the preview would show "Balance due" in full on
  // a bill about to be marked paid.
  // And never while nothing is due: a row typed before a discount settled the
  // balance must not paint a collection onto a bill that has none.
  const collecting = !nothingDue && collectedAmount.trim() !== '';
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
        paymentLines: collecting && payLines.length > 1 ? toPaymentLines(payLines) : [],
      },
    [preview, collecting, collectedAmount, payLines, paymentMethod, paymentReference]
  );

  // What the desk has actually recorded, against what the stay costs.
  //
  // Compared in paise rather than as floats: 600 + 900.10 is 1500.0999999999999
  // in binary floating point, and a settlement refused for a rounding artefact
  // is worse than one that adds up.
  const paise = (n) => Math.round(Number(n) * 100);
  const collectedShort = round2(balanceDue - (Number(collectedAmount) || 0));
  const collectedMatches = paise(collectedAmount || 0) === paise(balanceDue);

  // The bill cannot be issued until the two agree. Said in the direction the
  // desk has to act in — how much is still missing, or how much too much has
  // been entered — rather than restating both figures and leaving the
  // subtraction to whoever is standing at the counter.
  //
  // Never a problem when nothing is due. A row typed before a discount brought
  // the balance to zero would otherwise read as an over-collection — with the
  // message inside an editor that is no longer on screen, and the button dead
  // for a reason nobody could see.
  const collectedProblem = nothingDue || collectedMatches
    ? null
    : collectedShort > 0
      ? `${formatPrice(collectedShort)} of the balance is still unaccounted for.`
      : `That is ${formatPrice(-collectedShort)} more than the balance due.`;

  const handleIssue = async (e) => {
    e.preventDefault();
    failIssue('');

    // A bill is written when the guest settles — the property extends no
    // credit, so there is no such thing as an issued bill with nothing
    // collected against it. Enforced on the server too; this is only so the
    // desk is told before the request goes out.
    //
    // Unless nothing is due: an advance that already covered the stay leaves a
    // bill to issue and no collection to record, and asking for one here was
    // a form that could not be submitted without inventing a payment.
    if (!nothingDue && collectedAmount.trim() === '') {
      failIssue('Enter the amount collected from the guest.', 'collectedAmount');
      return;
    }
    const collected = nothingDue ? 0 : Number(collectedAmount);
    if (!Number.isFinite(collected) || collected < 0) {
      failIssue('Enter a valid amount collected.', 'collectedAmount');
      return;
    }
    // Zero has no payment type because no payment happened — the only way to
    // get here is an advance that already covered the whole stay.
    if (collected > 0) {
      // Covers the single-payment case unchanged — one row with no method is
      // still "choose a payment type" — and every row of a split besides.
      const lineProblem = paymentLinesError(payLines);
      if (lineProblem) {
        failIssue(
          payLines.length === 1 && !paymentMethod
            ? 'Choose a payment type for the amount collected.'
            : lineProblem,
          'paymentLines'
        );
        return;
      }
    }
    // Checked here as well as on screen: the message below the rows is what the
    // desk reads, this is what actually stops the bill.
    if (collectedProblem) {
      failIssue(collectedProblem, 'paymentLines');
      return;
    }

    const path =
      billTarget.kind === 'STAY'
        ? `/billing/bookings/${billTarget.bookingId}/invoice`
        : billTarget.kind === 'EVENT'
          ? `/billing/events/${billTarget.eventBookingId}/invoice`
          : `/billing/food-tabs/${billTarget.tab}/invoice`;

    setSubmitting(true);
    try {
      const data = await apiPost(
        path,
        {
          billingSide,
          // What the server actually applied, read back off the preview —
          // never what was typed. With a target in force the typed discount is
          // blank and this solved figure is the only one that reproduces the
          // bill on screen. Still an amount and never a percentage: the server
          // re-derives that, so the two can't disagree on the document.
          discountAmount: preview.discountAmount ?? 0,
          // Printed beside the discount so the bill says why it was given.
          ...(cycleDiscount > 0 && discountReason.trim() ? { discountReason: discountReason.trim() } : {}),
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
          ...(collected > 0 && payLines.length > 1 ? { paymentLines: toPaymentLines(payLines) } : {}),
        },
        { token }
      );
      // Straight to the document. The bill exists, the guest is at the desk,
      // and the next thing anyone does with it is print it — closing back to a
      // queue and making them find it again is a step with one answer.
      setJustIssued(data.invoice);
      setDetailInvoiceId(data.invoice.id);
      setBillTarget(null);
      refreshAll();
    } catch (err) {
      failIssue(err instanceof ApiError ? err.message : 'Could not issue this bill.');
    } finally {
      setSubmitting(false);
    }
  };

  // Invoice detail / void modal
  const [detailInvoiceId, setDetailInvoiceId] = useState(null);
  // The bill just written, held so it can be shown the instant it exists.
  // refreshAll() re-fetches the lists in the background, and the detail modal
  // reads from those — so without this the document would blink in a moment
  // later, or not at all on the screen that has no lists to refresh.
  const [justIssued, setJustIssued] = useState(null);

  // The bill asked for by id, fetched on its own: on a modal-only screen the
  // lists above are not what the detail reads from in time, and the copy
  // held as "just issued" is the one source the detail modal falls back to.
  const [viewError, setViewError] = useState('');
  useEffect(() => {
    if (viewInvoiceId == null) return;
    apiGet(`/billing/invoices/${viewInvoiceId}`, { token })
      .then((data) => {
        setJustIssued(data.invoice);
        // Keyed on the id as the API returns it, not as it was asked for: a
        // BIGINT comes back from the driver as a string, while the function's
        // own record carries it as a number, and the detail lookup above is a
        // strict comparison. Asked for as 66, it has to be found as '66'.
        setDetailInvoiceId(data.invoice.id);
        setViewError('');
      })
      .catch((err) => setViewError(err instanceof ApiError ? err.message : 'Could not open this bill.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewInvoiceId]);
  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState('');
  const [voidSubmitting, setVoidSubmitting] = useState(false);
  const voidErrorRef = useRef(null);
  const reportVoidError = (message) => {
    setVoidError(message);
    requestAnimationFrame(() => {
      voidErrorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  // The list first — it carries whatever a void has since done to the bill —
  // falling back to the copy returned by the issue itself, which is the only
  // source on a screen with no lists behind it.
  const detailInvoice =
    invoices?.find((i) => i.id === detailInvoiceId) ??
    (justIssued?.id === detailInvoiceId ? justIssued : null);
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
    setJustIssued(null);
    // Opened over another tab there is nothing behind this to fall back to —
    // the queue and the bills list are not rendered — so closing the document
    // is closing the screen.
    if (modalOnly) onClose?.();
  };

  // Bill PDF share/download
  // The bill the user is actually looking at, measured at capture time so the
  // offscreen copy can be laid out at exactly the same width.
  // The visible bill, measured. Its height sizes the scaled preview box (see
  // .billing-panel__modal .bill-print-target); its width is what the PDF copy
  // is laid out at, so the file wraps its text exactly as the screen does.
  const [attachPreview, previewHeight, previewNode] = useMeasuredHeight();
  // Its twin on the issue form, for the draft's preview.
  const [attachIssuePreview, issuePreviewHeight] = useMeasuredHeight();
  // Which PDF action is in flight - 'download', 'share', or null. Not a plain
  // boolean: there are two buttons now and only the pressed one should say it
  // is working.
  const [pdfBusy, setPdfBusy] = useState(null);
  const [pdfError, setPdfError] = useState('');
  const toast = useToast();
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
  const [attachIssueMeasure, issueBillHeight] = useMeasuredHeight();
  // The bill's natural height at BILL_PDF_WIDTH, read off the offscreen capture
  // copy — which is already laid out at exactly that width for the PDF. The
  // previews need it to fit the document to a sheet the way the PDF does. The
  // PDF capture reads the same node.
  const [attachBill, billHeight, billNode] = useMeasuredHeight();



  const buildBillPdfBlob = () =>
    buildDocumentPdfBlob(billNode, {
      paperSize,
      // The width the user is actually looking at, so the offscreen copy wraps
      // its text identically and the file matches the preview line for line.
      shownWidth: previewNode?.offsetWidth,
    });

  // Both controls build the same file the same way and differ only in what
  // they do with it, so the building - and the busy state, and the one error
  // message - lives here once. Which of the two is running is tracked so only
  // the button that was pressed shows the wait; greying out both would suggest
  // the other one had also been asked for.
  const runPdfAction = async (kind, deliver) => {
    setPdfError('');
    setPdfBusy(kind);
    try {
      const blob = await buildBillPdfBlob();
      await deliver(blob, `${detailInvoice.invoiceNumber.replace(/[\\/]/g, '-')}.pdf`);
    } catch (err) {
      // An aborted share sheet is the user changing their mind, not a failure.
      if (err?.name !== 'AbortError') {
        // A server refusal carries a reason worth reading — "number not on
        // WhatsApp" and "template not approved" call for completely different
        // fixes, and flattening both to "could not generate the PDF" would be
        // wrong twice over: the PDF generated fine, and the desk is left with
        // nothing to act on. Only a genuine local failure keeps that wording.
        const message = err instanceof ApiError ? err.message : 'Could not generate the bill PDF.';
        setPdfError(message);
        // Sending is the one action here with no visible trace on the bill, so
        // its failure is raised the same way its success is. Print and Download
        // announce themselves by producing a file, and need no toast.
        if (kind === 'share') toast.show(message, 'error');
      }
    } finally {
      setPdfBusy(null);
    }
  };

  const handleDownloadPdf = () => runPdfAction('download', downloadPdf);

  // Print is the download, sent to the printer instead of to disk. Building
  // the same file the same way is what makes the printed bill match the
  // downloaded one line for line — see printPdfBlob for why the page's own
  // print stylesheet stopped being trusted with this.
  const handlePrint = () => runPdfAction('print', printPdfBlob);


  // What the desk is sending, in the words they would use saying it aloud.
  // The guest is named because a bill arriving from an unknown number with no
  // greeting reads as a scam, which is exactly the message a property does not
  // want to send along with its bill.
  // Greeting first where the bill has a guest behind it. A restaurant bill has
  // no booking and so no name — addressing that one to "null" is worse than
  // opening without a greeting at all.
  //
  // Says nothing about an attachment. The desk attaches the PDF by hand after
  // this opens, and a message promising a file that is not there yet is a
  // promise the desk has to remember to keep.
  const shareMessage = () =>
    `${detailInvoice.guestName ? `${detailInvoice.guestName}, here` : 'Here'} is your bill ` +
    `${detailInvoice.invoiceNumber}` +
    `${detailInvoice.lodgeName ? ` from ${detailInvoice.lodgeName}` : ''}` +
    ` for ${formatPrice(detailInvoice.totalAmount)}. ${detailInvoice.kind === 'EVENT' ? 'Thank you for celebrating with us.' : 'Thank you for staying with us.'}`;

  // The subject a bill arrives under in the guest's inbox. Bare enough to be
  // recognised at a glance in a list of unread mail, which is the only place
  // it is ever read.
  const shareSubject = () =>
    `Bill ${detailInvoice.invoiceNumber}` +
    `${detailInvoice.lodgeName ? ` from ${detailInvoice.lodgeName}` : ''}`;

  // Share, by channel. The two behave differently on purpose.
  //
  // Share means WhatsApp, and the desk's own WhatsApp is what sends it.
  //
  // The PDF is saved first and the chat opens second, in that order and
  // deliberately: wa.me carries text and never a file, so the desk attaches the
  // bill by hand once the chat is up, and doing the download first means the
  // file is already waiting in the attach dialog rather than being fetched
  // while WhatsApp has focus.
  //
  // The toast says the file was saved and does not claim the guest was sent
  // anything, because at this point nobody has been: the message is sitting in
  // a WhatsApp window that the desk still has to press send on. Overstating
  // that would make the toast worse than no toast — a desk that reads "sent"
  // and closes the tab has sent nothing.
  //
  // There is a server-side send too (billShare.service.js), which does deliver
  // and does report delivery, but it can only go out through an approved SMSala
  // template. This is the route that works today and on any desk with WhatsApp
  // to hand.
  //
  // 'device' and 'email' are unreachable from this screen — the button goes
  // straight to WhatsApp rather than opening a list of channels. They are kept
  // because neither is dead in any meaningful sense: 'device' is the browser's
  // own share sheet, the one route that attaches the file itself, and 'email'
  // saves the PDF and opens a mail draft. Restoring either is a menu item
  // rather than a rewrite.
  const handleShare = (channel, options = {}) =>
    runPdfAction('share', async (blob, filename) => {
      if (channel === 'device') {
        await sharePdf(blob, filename);
        return;
      }

      downloadPdf(blob, filename);

      if (channel === 'email') {
        openComposer(buildMailLink(options.email || '', shareSubject(), shareMessage()));
        toast.show(
          `Bill PDF saved. Attach it in the mail draft${options.email ? ` to ${options.email}` : ''}.`,
          'info'
        );
        return;
      }

      // A new tab rather than this one: the bill modal stays open behind it, so
      // closing WhatsApp puts the desk back on the bill they were sending.
      openExternal(buildWhatsAppLink(detailInvoice.guestPhone, shareMessage()));
      toast.show(
        detailInvoice.guestPhone
          ? `Bill PDF saved. Attach it in the WhatsApp chat that opened.`
          : `Bill PDF saved. Pick the guest in WhatsApp and attach it there.`,
        'info'
      );
    });

  const handleVoid = async (e) => {
    e.preventDefault();
    setVoidError('');
    if (!voidReason.trim()) {
      reportVoidError('Enter a reason for voiding this bill.');
      return;
    }
    setVoidSubmitting(true);
    try {
      await apiPost(`/billing/invoices/${detailInvoiceId}/void`, { reason: voidReason.trim() }, { token });
      setDetailInvoiceId(null);
      refreshAll();
    } catch (err) {
      reportVoidError(err instanceof ApiError ? err.message : 'Could not void this bill.');
    } finally {
      setVoidSubmitting(false);
    }
  };

  return (
    <div className={modalOnly ? 'billing-panel billing-panel--modal-only' : 'billing-panel'}>
      {/* Everything that makes this a page. In modalOnly none of it is
          wanted — see the note on the props. A fragment because the page is a
          run of siblings, not one element. */}
      {!modalOnly && (
        <>
      <div className="billing-panel__subtabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className="billing-panel__subtabs-item"
            aria-current={activeTab === t.key ? 'page' : undefined}
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

      {activeTab === 'numbering' && <BillNumberingPanel />}

      {activeTab === 'tables' && (
        <div className="chart-section">
          <div className="chart-section__header">
            <h3>Food to bill</h3>
            <span className="chart-section__hint">
              Delivered food nobody has paid for. A table and a room keep one running tab; each
              takeaway is listed on its own, since the next one is a different customer. Every
              row bills on its own document, sweeping in only what it names.
            </span>
          </div>

          {foodTabsError && <div className="form-banner form-banner--error">{foodTabsError}</div>}
          {!foodTabsError && !foodTabs && <div className="dash-state">Loading…</div>}
          {!foodTabsError && foodTabs && foodTabs.length === 0 && (
            <div className="dash-state">Nothing waiting — everything served has been billed.</div>
          )}
          {!foodTabsError && foodTabs && foodTabs.length > 0 && (
            <div className="chart-list">
              {foodTabs.map((t) => (
                <div className="chart-row billing-panel__queue-row" key={t.tab}>
                  <span className="chart-row__name">
                    {/* A room or counter tab is running for whoever is actually
                        behind it — named alongside the table label rather than
                        replacing it, so the row still says which tab it is. */}
                    {t.guestName ? `${t.tableLabel} · ${t.guestName}` : t.tableLabel}
                    <span className="chart-row__dates">
                      {/* "since" belongs to a tab that is still filling up. A
                          takeaway is one finished order, so it reads as the
                          time it was placed, not the start of a running total. */}
                      {t.tab.startsWith('counter-')
                        ? `Placed ${timeOf(t.openedAt)}`
                        : `${t.orderCount} order${t.orderCount === 1 ? '' : 's'} · since ${timeOf(t.openedAt)}`}
                    </span>
                  </span>
                  <span className="billing-panel__queue-actions">
                    <span className="chart-row__value">{formatPrice(t.subtotal)}</span>
                    <button
                      type="button"
                      className="btn-accent"
                      onClick={() => openBilling({ kind: 'FOOD', tab: t.tab, label: t.tableLabel })}
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

      {activeTab === 'ready' && (
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

      {activeTab === 'bills' && (
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
                            : inv.kind === 'EVENT'
                              ? `${inv.guestName} · ${inv.venueName || 'Function'}`
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

        </>
      )}

      {/* One modal, two steps: take the payment, then hand over the document.
          These were two dialogs, and issuing closed the first before opening the
          second — which read as the screen throwing the desk out and starting
          again, with the booking panel flashing up in between.
          The backdrop closes whichever step is showing, so a click outside
          always means the same thing. */}
      {viewError && modalOnly && (
        <div className="glass-backdrop billing-panel__backdrop" onClick={() => onClose?.()}>
          <div className="glass-panel billing-panel__modal" onClick={(e) => e.stopPropagation()}>
            <div className="form-banner form-banner--error">{viewError}</div>
            <button type="button" className="btn-secondary" onClick={() => onClose?.()}>
              Close
            </button>
          </div>
        </div>
      )}

      {(billTarget || (detailInvoiceId && detailInvoice)) && (
        <div
          className="glass-backdrop billing-panel__backdrop"
          onClick={billTarget ? closeBilling : closeDetail}
        >
          <div
            className="glass-panel billing-panel__modal billing-steps"
            onClick={(e) => e.stopPropagation()}
          >
            {/* key, so React remounts on the change of step rather than
                reconciling one into the other — without it the pane swaps its
                contents in place and the slide never plays. */}
            {billTarget ? (
              <div className="billing-steps__pane" key="collect">
            <h3>Issue bill</h3>

            {previewError && <div className="form-banner form-banner--error">{previewError}</div>}
            {!previewError && !preview && <div className="dash-state">Loading…</div>}

            {!previewError && preview && (
              <form onSubmit={handleIssue} noValidate>
                {preview.alreadyInvoiced && (
                  <div className="form-banner form-banner--info">
                    This booking already has an issued bill. Void it first to reissue.
                  </div>
                )}

                {billTarget.kind === 'EVENT' && (
                  <div className="form-section">
                    <div className="form-section__title">Function</div>
                    <div className="chart-list">
                      <div className="chart-row">
                        <span className="chart-row__name">Organiser</span>
                        <span className="chart-row__value">{preview.guestName}</span>
                      </div>
                      <div className="chart-row">
                        <span className="chart-row__name">Function</span>
                        <span className="chart-row__value">
                          {preview.eventTitle} · {preview.venueName}
                        </span>
                      </div>
                      {/* The larger of the final count and the guarantee —
                          what the kitchen bought for is what gets billed. */}
                      <div className="chart-row">
                        <span className="chart-row__name">Plates billed</span>
                        <span className="chart-row__value">{preview.billablePax}</span>
                      </div>
                      {(preview.roomCharges ?? []).map((line) => (
                        <div className="chart-row" key={line.label}>
                          <span className="chart-row__name">{line.label}</span>
                          <span className="chart-row__value">{formatPrice(line.amount)}</span>
                        </div>
                      ))}
                      {preview.quotedDiscount > 0 && (
                        <div className="chart-row">
                          <span className="chart-row__name">Concession agreed at quoting</span>
                          <span className="chart-row__value">−{formatPrice(preview.quotedDiscount)}</span>
                        </div>
                      )}
                    </div>
                    {/* What the desk wrote down while the function was on. Named
                        here so the biller checks it against what was actually
                        supplied before the total goes on paper. */}
                    {(preview.extrasOnDay ?? []).length > 0 && (
                      <div className="form-banner form-banner--info" style={{ marginTop: 10 }}>
                        <strong>Added on the day:</strong>{' '}
                        {preview.extrasOnDay
                          .map((x) => `${x.label}${x.quantity > 1 ? ` × ${x.quantity}` : ''} (${formatPrice(x.amount)})`)
                          .join(' · ')}
                        {' '}— included in the lines above.
                      </div>
                    )}
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

                    {/* A cycle-property guest who left before their booked
                        nights ran out. The bill still carries every night that
                        was sold; this is where the desk decides whether to
                        give the unused ones back. It fills the discount below. */}
                    {preview.earlyCheckout && (
                      <div
                        className={`billing-panel__early${earlyReducing ? ' billing-panel__early--on' : ''}`}
                        role="group"
                        aria-labelledby="earlyCheckoutTitle"
                      >
                        <div className="billing-panel__early-head">
                          <span className="billing-panel__early-icon" aria-hidden="true">
                            !
                          </span>
                          <div>
                            <div id="earlyCheckoutTitle" className="billing-panel__early-title">
                              Guest left early
                            </div>
                            <div className="billing-panel__early-sub">
                              Stayed {preview.earlyCheckout.actualNights} of{' '}
                              {preview.earlyCheckout.plannedNights} nights booked ·{' '}
                              {preview.earlyCheckout.unusedNights} night
                              {preview.earlyCheckout.unusedNights === 1 ? '' : 's'} unused
                            </div>
                          </div>
                          <strong className="billing-panel__early-amount">
                            {formatPrice(preview.earlyCheckout.unusedAmount)}
                          </strong>
                        </div>

                        <div className="billing-panel__early-row">
                          <label htmlFor="earlyDiscount" className="billing-panel__early-label">
                            Early-leaving discount
                            <span>Leave blank to charge in full</span>
                          </label>
                          <div className="billing-panel__early-input">
                            <span aria-hidden="true">₹</span>
                            <input
                              id="earlyDiscount"
                              type="number"
                              min="0"
                              step="1"
                              inputMode="decimal"
                              placeholder="0"
                              value={earlyReducing ? discountInput : ''}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '') {
                                  setDiscountInput('');
                                  setDiscountReason('');
                                } else {
                                  setDiscountInput(v);
                                  setDiscountReason(EARLY_DISCOUNT_REASON);
                                }
                              }}
                            />
                          </div>
                        </div>
                        <p className="billing-panel__early-status">
                          {earlyReducing && cycleDiscount > 0
                            ? `${formatPrice(preview.discountAmount ?? 0)} off · printed on the bill as "Discount – ${EARLY_DISCOUNT_REASON}"`
                            : `Charging in full · all ${preview.earlyCheckout.plannedNights} booked nights`}
                        </p>
                      </div>
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
                      {billTarget.kind === 'FOOD'
                        ? billTarget.label
                        : billTarget.kind === 'EVENT'
                          ? 'Catering'
                          : 'Food ordered during the stay'}
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
                    {(preview.orders ?? preview.foodOrders ?? []).length > 0 && (
                      <p className="billing-panel__hint">
                        From order{(preview.orders ?? preview.foodOrders).length === 1 ? '' : 's'}{' '}
                        {(preview.orders ?? preview.foodOrders).map((o) => `#${o.orderNumber}`).join(', ')}
                      </p>
                    )}
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
                          <span>
                            Discount ({activeAmounts.discountPercent}%)
                            {cycleDiscount > 0 && discountReason.trim() && ` · ${discountReason.trim()}`}
                          </span>
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

                {/* Only a cycle property discounts here: on the other two
                    modes the bill is what the stay costs and any concession
                    is settled through what the guest hands over. The reason
                    prints on the bill beside the amount, so a discount
                    reads as a rule ("Leaving early") and not a favour. */}
                {isCycleStay && (
                  <div className="form-section billing-panel__discount">
                    <div className="form-section__title">Discount</div>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor="cycleDiscount">Amount</label>
                        <input
                          id="cycleDiscount"
                          type="number"
                          min="0"
                          step="1"
                          inputMode="decimal"
                          placeholder="0"
                          value={discountInput}
                          onChange={(e) => setDiscountInput(e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="cycleDiscountReason">Reason (printed on bill)</label>
                        <input
                          id="cycleDiscountReason"
                          type="text"
                          maxLength={100}
                          placeholder="e.g. Leaving early, regular guest"
                          value={discountReason}
                          onChange={(e) => setDiscountReason(e.target.value)}
                        />
                      </div>
                    </div>
                    <p className="billing-panel__hint">
                      {cycleDiscount > 0
                        ? `Shown on the bill as "Discount${
                            discountReason.trim() ? ` – ${discountReason.trim()}` : ''
                          }" of ${formatPrice(preview.discountAmount ?? 0)}.${
                            preview.earlyCheckout
                              ? ` The booking keeps its ${preview.earlyCheckout.plannedNights} nights on record.`
                              : ''
                          }`
                        : 'No discount on this bill.'}
                    </p>
                  </div>
                )}

                {/* The decision as it is actually made at a counter: the guest
                    hands over a figure, and whatever the bill has to give up to
                    land there is the discount. Typing it here rather than
                    working out a discount first is the difference between
                    "he gave me 1500" and arithmetic. */}
                <div className="form-section">
                  {/* An instruction, not a heading. "Balance collected" sat
                      directly under "Balance due" and read as a second figure
                      the modal was reporting back — one more line of the
                      summary above it — rather than as the one thing on this
                      form the desk still has to answer. The rows below it went
                      unnoticed until the bill was refused for them. */}
                  <div className="form-section__title">
                    Record how the guest paid
                    {/* The rows below are the one thing on this form the desk
                        must answer, and they carry no label of their own to
                        hang the mark on — so it goes on the heading that names
                        them. Only inside the !nothingDue branch: with nothing
                        to collect there is nothing being required. */}
                    {!nothingDue && <Req />}
                  </div>
                  {/* Names the figure the rows have to reach. The amount is
                      prefilled with it, so this is confirmation of what is
                      being settled rather than a sum to work out — and when a
                      discount moves the balance, it moves here too. */}
                  <p className="billing-panel__hint billing-panel__collect-hint">
                    {nothingDue
                      ? 'The advance already covers this bill. Nothing is left to collect — issue it as it stands.'
                      : `${formatPrice(balanceDue)} is due. Choose the payment type for each amount taken.`}
                  </p>
                  {/* No Amount box: what the guest handed over is however much
                      these rows add up to. The discount the bill has to give up
                      to land on that figure is still solved server-side — see
                      the target effect, which waits for the rows to be complete
                      before moving it.

                      No rows at all when nothing is due. They used to sit here
                      empty, marked required, under a line saying there was
                      nothing to collect — a form contradicting itself, and one
                      that refused to submit until a payment was made up. */}
                  {!nothingDue && (
                  <PaymentLines
                    lines={payLines}
                    onChange={setPayLinesInput}
                    idPrefix="bill"
                    // A bill is written when the guest settles, so unlike an
                    // advance there is no such thing as leaving this blank —
                    // the rows say so on sight rather than at the failed
                    // submit.
                    required
                    error={
                      <>
                        {issueFieldError('collectedAmount')}
                        {issueFieldError('paymentLines')}
                        {collectedProblem && !issueError && (
                          <p className="field__error">{collectedProblem}</p>
                        )}
                      </>
                    }
                  />
                  )}
                </div>

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
                        <div
                          className="bill-print-target"
                          style={
                            issuePreviewHeight
                              ? { '--bill-preview-h': `${issuePreviewHeight}px` }
                              : undefined
                          }
                        >
                          <BillDocument ref={attachIssuePreview} invoice={documentPreview} lang={billLang} />
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
                          <BillDocument ref={attachIssueMeasure} invoice={documentPreview} lang={billLang} />
                        </div>
                      </>
                    )}
                  </details>
                )}

                {/* Only what has no single input behind it — a refusal from
                    the server, mostly. Anything about a box the desk can fix is
                    printed under that box instead: this form is long, and a
                    message down here about a field several sections up is a
                    message about something off-screen. */}
                {issueError && !issueField && (
                  <div ref={issueErrorRef} className="form-banner form-banner--error form-banner--flash">
                    {issueError}
                  </div>
                )}

                <div className="billing-panel__actions">
                  <button type="button" className="btn-secondary" onClick={closeBilling} disabled={submitting}>
                    Cancel
                  </button>
                  <button
                    className="btn-accent"
                    type="submit"
                    disabled={submitting || preview.alreadyInvoiced || Boolean(collectedProblem)}
                  >
                    {submitting ? 'Issuing…' : 'Issue bill'}
                  </button>
                </div>
              </form>
            )}
              </div>
            ) : (
              <div className="billing-steps__pane" key="issued">
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
            {/* Above the bill, not below it. The document is a full sheet of
                paper — with the actions underneath, printing meant scrolling
                past the whole thing to reach the button, every time. What the
                desk does here is act on the bill, so the actions sit where the
                eye already is when the modal opens.

                Paper and language ride with Print and the download because they
                govern both: the two have to agree about the sheet. */}
            {detailInvoice.status === 'ISSUED' && !showVoidForm && (
              <div className="bill-actions">
                <div className="bill-actions__sheet">
                  <PaperSelect value={paperSize} onChange={setPaperSize} />
                  <BillLangSelect value={billLang} onChange={setBillLang} />
                </div>
                <div className="bill-actions__buttons">
                  {/* An explicit way out. Backdrop-click alone is fine when this
                      sits over the bills list, but the desk reaches it straight
                      from a checkout now, with nothing behind it to click back
                      to. */}
                  <button type="button" className="btn-secondary" onClick={closeDetail}>
                    Done
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handlePrint}
                    disabled={pdfBusy !== null}
                    title={pdfBusy === 'print' ? 'Preparing…' : 'Print this bill'}
                  >
                    {pdfBusy === 'print' ? 'Preparing…' : 'Print'}
                  </button>
                  {/* Two actions, two buttons. The single control they
                      replaced could only ever do one of them: it opened the
                      OS share sheet where the device had one and downloaded
                      where it didn't, so a tablet could not save the file and
                      a desktop could not send it. The desk does both, often
                      for the same bill.

                      Download keeps the accent — it is the one that always
                      finishes on its own. */}
                  <button
                    type="button"
                    className="btn-accent bill-actions__icon-btn"
                    onClick={handleDownloadPdf}
                    disabled={pdfBusy !== null}
                    aria-label={
                      pdfBusy === 'download' ? 'Preparing the PDF' : 'Download this bill as a PDF'
                    }
                    title={pdfBusy === 'download' ? 'Preparing…' : 'Download PDF'}
                  >
                    <DownloadIcon />
                  </button>
                  {/* One press: the bill is saved and a WhatsApp chat with
                      the guest opens for the desk to attach it to. */}
                  <ShareMenu
                    onShare={handleShare}
                    disabled={pdfBusy !== null}
                    busy={pdfBusy === 'share'}
                    guestPhone={detailInvoice.guestPhone}
                    label="Send this bill to the guest on WhatsApp"
                  />
                  {/* Last, and a link rather than a button: voiding is the one
                      irreversible thing on this screen and must not read as a
                      peer of Print. */}
                  <button
                    type="button"
                    className="billing-panel__danger-link"
                    onClick={() => setShowVoidForm(true)}
                  >
                    Void this bill
                  </button>
                </div>
              </div>
            )}

            {/* The one copy that prints. The wrapper carries the marker the
                print stylesheet keys off — the modal holds other copies of the
                same document (the PDF source, the paper thumbnails) and only
                this one is the bill. */}
            <div
              className="bill-print-target"
              // The bill's own height, for the box it is scaled inside. Unset
              // until measured, and the box then falls back to its natural
              // (unscaled) height for that first frame rather than to a guess.
              style={previewHeight ? { '--bill-preview-h': `${previewHeight}px` } : undefined}
            >
              <BillDocument ref={attachPreview} invoice={detailInvoice} lang={billLang} />
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
              <BillDocument ref={attachBill} invoice={detailInvoice} lang={billLang} />
            </div>

            {/* A void reason is not another detail row. It was rendered as
                one — same weight, same grey as the guest's phone number — and
                the single most important fact about the document on screen,
                that it is cancelled and why, read as filler. It gets the
                danger treatment instead, above the document rather than under
                it, so it is seen before the amounts are. */}
            {detailInvoice.status === 'VOID' && (
              <div className="billing-panel__void-note" role="status">
                <span className="billing-panel__void-tag">Void</span>
                <span className="billing-panel__void-reason">
                  {detailInvoice.voidReason || 'No reason recorded.'}
                </span>
              </div>
            )}

            {voidError && (
              <div ref={voidErrorRef} className="form-banner form-banner--error form-banner--flash">
                {voidError}
              </div>
            )}
            {pdfError && <div className="form-banner form-banner--error">{pdfError}</div>}

            {detailInvoice.status === 'ISSUED' && showVoidForm && (
              <form onSubmit={handleVoid} className="form-section">
                <div className="form-section__title">
                  <label htmlFor="voidReason">
                    Reason for voiding
                    {/* Voiding is refused without one, so the field says so
                        before the submit does. A real label rather than a bare
                        heading, so the mark has something to belong to and the
                        input is named to anything reading the form. */}
                    <Req />
                  </label>
                </div>
                <div className="field">
                  <input
                    id="voidReason"
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

    </div>
  );
}
