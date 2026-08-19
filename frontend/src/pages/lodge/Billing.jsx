import { useEffect, useMemo, useRef, useState } from 'react';
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

// Fallback width for the PDF capture, in CSS pixels — roughly an A4 content
// column at 96dpi. Normally the capture copy is sized to the visible preview at
// download time, so the file shows exactly the layout the user was looking at;
// this only decides it if that preview couldn't be measured.
const BILL_PDF_WIDTH = 760;

// The stock a bill can be printed on. One table drives both outputs: the
// browser's own print dialog, via a class on <html> that picks an @page rule
// (see BillDocument.css), and the downloaded PDF, via the jsPDF format.
//
// They have to come from the same row. A desk that picks A5, prints it, then
// downloads the same bill as an A4 PDF has been given two different documents
// and no reason to expect it.
//
// `format` is what jsPDF takes: a named size it knows, or [width, height] in
// points for one it doesn't. A roll has no page height, so it gets a nominal
// long sheet — the bill is scaled to fit whichever dimension is tighter, and
// on a roll that is always the width.
//
// `page` is the CSS `size`/`margin` pair for the browser's own print dialog.
// It cannot live in the stylesheet: @page is only legal at the top level, so
// it can't be nested under a class, and it is resolved before the cascade
// reaches any element, so it can't read a custom property either. The rule is
// therefore written into a <style> tag at print time and taken out again after.
// `pt` is the sheet in points, the same unit jsPDF works in. It is stated here
// even where `format` is a name jsPDF already knows, because the on-screen
// preview needs the proportions to draw the paper — and a second table of
// dimensions is a second thing to get out of step with this one.
const PAPER_SIZES = [
  { id: 'a4', label: 'A4', hint: '210 × 297 mm', format: 'a4', page: 'A4', margin: '12mm', pt: [595.28, 841.89] },
  { id: 'a5', label: 'A5', hint: '148 × 210 mm', format: 'a5', page: 'A5', margin: '8mm', pt: [419.53, 595.28] },
  { id: 'a6', label: 'A6', hint: '105 × 148 mm', format: 'a6', page: 'A6', margin: '5mm', pt: [297.64, 419.53] },
  {
    id: 'letter',
    label: 'Letter',
    hint: '8.5 × 11 in',
    format: 'letter',
    page: 'letter',
    margin: '12mm',
    pt: [612, 792],
  },
  {
    id: 'half-letter',
    label: 'Half Letter',
    hint: '8.5 × 5.5 in',
    format: [612, 396],
    page: '8.5in 5.5in',
    margin: '8mm',
    pt: [612, 396],
  },
  {
    id: 'thermal-80',
    label: '80mm roll',
    hint: 'thermal receipt',
    // Width only — the height in the PDF is measured from the bill itself.
    // 226.77pt is 80mm. The second figure is a placeholder jsPDF never sees.
    format: [226.77, 850],
    continuous: true,
    // Height auto: a roll has no page to break against, and pinning one would
    // cut the memo off at whatever length was guessed.
    page: '80mm auto',
    margin: '3mm',
    // The preview draws a roll as a tall strip rather than a sheet — there is
    // no page height to be faithful to, so this is only how much of the roll
    // to show before it runs off the bottom.
    pt: [226.77, 560],
  },
];

// Margin on a roll, in points (~3mm) — matching the @page margin above, so the
// printed slip and the downloaded one have the same edge.
const ROLL_MARGIN = 8.5;

// Device pixels per CSS pixel in the capture. Named because the PDF fit maths
// has to divide it back out to find the bill's natural size on paper.
const CAPTURE_PIXEL_RATIO = 3;

// How wide a sheet is drawn in the paper picker, in CSS pixels. Wide enough
// that the memo's own structure is legible at a glance — masthead, ruled
// block, money column — without six of them filling the modal.
const PAPER_PREVIEW_WIDTH = 190;

// The widest stock on offer, in points. Every preview is drawn against this so
// the sheets keep their sizes relative to each other.
const WIDEST_PAPER_PT = Math.max(...PAPER_SIZES.map((p) => p.pt[0]));

// The @page margins are written as CSS lengths; the fit maths needs them as
// numbers. Only mm and in appear in PAPER_SIZES, and an unrecognised unit
// falls back to no margin rather than throwing mid-print.
function mmToPt(value) {
  const m = /^([\d.]+)(mm|in)$/.exec(String(value).trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2] === 'in' ? n * 72 : (n * 72) / 25.4;
}

// Print CSS is laid out at 96 CSS pixels to the inch, whatever the printer's
// own resolution — so a point converts at 96/72.
const ptToPx = (pt) => (pt * 96) / 72;

// The stay block's own height before any sheet-filling stretch is added — the
// open space the printed form leaves under the entries. Kept in step with the
// .memo__stay rule in BillDocument.css.
const STAY_BASE_HEIGHT = 130;

// How a bill lands on a sheet, answered once for all three outputs — the print
// dialog, the PDF, and each thumbnail. Width decides the scale, and the height
// left under the fitted bill goes to the open stay block, so the form runs the
// full page instead of stopping wherever its entries did. Height only binds
// when the bill is too tall even at full width (a landscape sheet, a long
// itemised tab); a roll has no bottom to fill and stretches nothing.
//
// Three callers, one formula, because they are three pictures of the same
// sheet: the moment one of them fits differently, the previews are lying about
// one of the other two.
function fitBillToSheet(availWidth, availHeight, naturalWidth, naturalHeight, continuous) {
  const fitWidth = availWidth / naturalWidth;
  const fitHeight = !continuous && naturalHeight > 0 ? availHeight / naturalHeight : Infinity;
  const scale = Math.min(fitWidth, fitHeight, 1);
  const slack = !continuous && naturalHeight > 0 ? availHeight / scale - naturalHeight : 0;
  return { scale, stayHeight: STAY_BASE_HEIGHT + (slack > 24 ? slack : 0) };
}

const DEFAULT_PAPER = 'a4';

const paperById = (id) => PAPER_SIZES.find((p) => p.id === id) ?? PAPER_SIZES[0];

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

  // Only the types this property actually issues get a chip — a property that
  // isn't GST registered only ever writes cash receipts, and should not be
  // offered a "Tax invoice" filter that matches nothing.
  const billFilters = invoices
    ? BILL_FILTERS.map((f) => ({
        ...f,
        count: invoices.filter((i) => f.match(i) && matchesDate(i) && matchesSearch(i)).length,
      })).filter((f) => f.count > 0)
    : [];
  // Looked up rather than trusted: voiding the last bill of a type empties its
  // chip, and the list falls back to everything instead of going blank.
  const activeFilter = billFilters.find((f) => f.key === billFilter) ?? null;

  const visibleInvoices =
    invoices &&
    invoices.filter((i) => (!activeFilter || activeFilter.match(i)) && matchesDate(i) && matchesSearch(i));
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

  // Print on the chosen stock: write the @page rule, mark <html> so the
  // stylesheet's per-paper rules apply, print, then undo both.
  //
  // window.print() blocks until the dialog closes in the browsers this runs on,
  // so tearing down straight after is safe. Both removals sit in a finally
  // regardless — a stranded rule would silently repaper every later print in
  // the app, which is a bug nobody would think to look here for.
  const handlePrint = () => {
    const paper = paperById(paperSize);

    // What the sheet can hold, in CSS pixels. @page margins are in real units,
    // so the printable area is the paper less its margins converted at 96dpi —
    // the ratio the browser itself lays print CSS out at.
    const [pwPt, phPt] = paper.pt;
    const marginPt = mmToPt(paper.margin);
    const pageWidthPx = ptToPx(pwPt - marginPt * 2);
    const pageHeightPx = ptToPx(phPt - marginPt * 2);

    // The bill as it actually measures, from the offscreen copy — laid out at
    // BILL_PDF_WIDTH and never restyled, so it is the one honest measurement
    // of the document. The visible copy is inside a modal whose width varies.
    const node = billRef.current;
    const naturalWidth = node?.offsetWidth || BILL_PDF_WIDTH;
    const naturalHeight = node?.offsetHeight || 0;

    const { scale, stayHeight } = fitBillToSheet(
      pageWidthPx,
      pageHeightPx,
      naturalWidth,
      naturalHeight,
      paper.continuous
    );

    const style = document.createElement('style');
    style.media = 'print';
    style.textContent =
      `@page { size: ${paper.page}; margin: ${paper.margin}; }
` +
      // Width is divided back out by the scale so the form still fills the
      // sheet edge to edge after shrinking — scaling alone would leave a
      // proportional strip of white down the right-hand side.
      `.bill-print-target { --bill-print-scale: ${scale}; width: ${100 / scale}%; ` +
      // The same variable the stay block is sized by everywhere — the
      // thumbnails set it per sheet, this sets it for the sheet being printed.
      `--memo-stay-h: ${Math.round(stayHeight)}px; }`;

    document.head.appendChild(style);
    try {
      window.print();
    } finally {
      style.remove();
    }
  };

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

  const buildBillPdfBlob = async () => {
    // html-to-image, not html2canvas — the difference is who paints the text.
    // html2canvas re-draws every glyph itself with its own baseline arithmetic,
    // which is known to sit text a few pixels below where the browser put it,
    // and to mis-advance tracked or tabular-figure runs. html-to-image
    // serialises the DOM into an SVG foreignObject and hands it back to the
    // browser to rasterise: the engine that painted the preview paints the
    // file, so the PDF cannot disagree with the screen about where a line of
    // text sits. It also means tabular figures and letter-spacing survive
    // capture, which under html2canvas they did not.
    const [{ jsPDF }, { toCanvas }] = await Promise.all([import('jspdf'), import('html-to-image')]);

    // Captured from the offscreen copy, laid out at the same width as the bill
    // the user is looking at — identical width means identical wrapping means
    // identical alignment. The copy exists so the visible bill is never
    // restyled mid-download, and so shadows and scroll clipping never reach
    // the sheet.
    const node = billRef.current;
    const shownWidth = billPreviewRef.current?.offsetWidth;
    node.parentElement.style.width = `${shownWidth || BILL_PDF_WIDTH}px`;

    // The webfonts must be resolved before capture: a capture raced against
    // Inter still loading would be laid out in one font and painted in another.
    await document.fonts.ready;

    // The capture is stretched to the chosen sheet before it is rasterised,
    // the same way the print dialog and the thumbnails fill theirs — the stay
    // block takes whatever height the fitted bill leaves on the page. Without
    // this the file was the odd one out: the printed sheet ran to its foot
    // while the PDF of the same bill stopped halfway down.
    //
    // Measured before the variable is set, then restored after the capture so
    // the copy stays an honest measurement for everything else that reads it.
    const paper = paperById(paperSize);
    const capturedWidth = node.offsetWidth;
    const capturedHeight = node.offsetHeight;
    if (!paper.continuous) {
      const [pwPt, phPt] = paper.pt;
      // The PDF page's own margin rule, below — proportional on small stocks.
      const marginPt = Math.min(24, pwPt * 0.04);
      const { stayHeight } = fitBillToSheet(
        ptToPx(pwPt - marginPt * 2),
        ptToPx(phPt - marginPt * 2),
        capturedWidth,
        capturedHeight,
        false
      );
      node.style.setProperty('--memo-stay-h', `${Math.round(stayHeight)}px`);
    }

    let canvas;
    try {
      canvas = await toCanvas(node, {
        // Three device pixels per CSS pixel. The text is rasterised, not
        // embedded, so resolution is all that stands between the reader and
        // visibly soft 9px captions.
        pixelRatio: CAPTURE_PIXEL_RATIO,
        backgroundColor: '#ffffff',
        // Screen furniture with no meaning on paper: a clipped box can crop a
        // border, a shadow becomes a grey smear down the edge of the sheet, and
        // rounded corners read as a web card. Applied to the capture clone only.
        style: { overflow: 'visible', boxShadow: 'none', borderRadius: '0' },
      });
    } finally {
      node.style.removeProperty('--memo-stay-h');
    }
    const imgData = canvas.toDataURL('image/png');

    // A roll is cut to length, not folded to a page. Its height is whatever
    // the bill came to, so the sheet is measured from the capture rather than
    // guessed: a fixed length would either cut a long bill off or spit out a
    // foot of blank paper after a short one, and on a receipt printer that
    // waste is per bill.
    const rollWidth = Array.isArray(paper.format) && paper.continuous ? paper.format[0] : null;
    const format = rollWidth
      ? [rollWidth, Math.max(120, (rollWidth - ROLL_MARGIN * 2) * (canvas.height / canvas.width) + ROLL_MARGIN * 2)]
      : paper.format;

    const pdf = new jsPDF({ unit: 'pt', format });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    // Scaled to the sheet. A flat 24pt margin is a tenth of an A6's width and
    // would leave the bill printing in the middle of it, so the smaller stocks
    // get a margin proportional to the page instead of a fixed one.
    const margin = rollWidth ? ROLL_MARGIN : Math.min(24, pageWidth * 0.04);

    // A bill is a single receipt, not a flowing document — scale it down to
    // whichever dimension is tighter so it always lands on one page, rather
    // than printing it at full width and letting the tail spill onto a
    // near-blank second page.
    //
    // Never scaled *up*: a small bill blown up to fill a Letter sheet is a
    // 30px masthead and a memo that reads as a poster. It sits at its natural
    // size, centred, and the paper simply has room to spare.
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;
    // The capture is at pixelRatio 3, so its natural size on paper is a third
    // of its pixel count converted from 96dpi CSS pixels to points.
    const naturalScale = (72 / 96) / CAPTURE_PIXEL_RATIO;
    const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height, naturalScale);
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
                    {visibleInvoices.length} of {invoices.length}
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
                      {invoices.filter((i) => matchesDate(i) && matchesSearch(i)).length}
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
                              identifies itself by the table it closed. The date
                              earns its place now the list filters by month —
                              without it a row can't say why it is on screen. */}
                          {inv.kind === 'FOOD'
                            ? inv.tableLabel || 'Counter'
                            : `${inv.guestName} · ${inv.roomNumber}`}
                          {inv.createdAt && ` · ${formatBillDate(inv.createdAt)}`}
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
