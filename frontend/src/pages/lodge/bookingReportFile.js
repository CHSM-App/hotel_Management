// Turning a booking report into a file an owner can keep — an Excel workbook
// to sort and total, or a PDF to print and file. Both are built from the same
// report payload the Bookings tab already has on screen, so what downloads is
// exactly what was displayed.
//
// The report has three parts, and the document says so up front because they
// are counted on different dates and are not expected to agree:
//
//   1. Money received in the period — cash basis, dated by when each payment
//      came in, whichever stay it was for.
//   2. Stays checking in this period and the bills issued for them — every
//      bill's figures stated so that gross − discount = net, net − tax =
//      taxable value, and taxable value + tax + round off = billed total.
//   3. The register of those stays, one row each, footed under the same
//      headings as part 2.

export const BOOKING_STATUS_LABEL = {
  BOOKED: 'Booked',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
};

// Shorter forms for a register column a few points wide.
const BOOKING_STATUS_SHORT = {
  BOOKED: 'Booked',
  CHECKED_IN: 'In house',
  CHECKED_OUT: 'Checkout',
  CANCELLED: 'Cancelled',
};

export const PAYMENT_MODE_LABEL = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  UNRECORDED: 'Not recorded',
};

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'UNRECORDED'];

export const DOCUMENT_TYPE_LABEL = {
  TAX_INVOICE: 'Tax invoice',
  BILL_OF_SUPPLY: 'Bill of supply',
  CASH_RECEIPT: 'Cash receipt',
};

const DOCUMENT_TYPE_SHORT = {
  TAX_INVOICE: 'Tax inv.',
  BILL_OF_SUPPLY: 'Supply',
  CASH_RECEIPT: 'Receipt',
};

const DOCUMENT_TYPES = ['TAX_INVOICE', 'BILL_OF_SUPPLY', 'CASH_RECEIPT'];

// Services Accounting Codes the two supplies are filed under — the same ones
// the printed bill carries.
const SAC = { rooms: '996311', food: '996331' };

// Which side of the book a report covers, kept because the server still
// answers with one and the document is stamped accordingly. No longer offered
// as a choice on the reports page: every report covers every bill, so this
// resolves to "All" unless something starts asking for otherwise again.
const BILLING_SIDE_OPTIONS = [
  { key: 'ALL', label: 'All bills', short: 'All' },
  { key: 'GST', label: 'GST bills only', short: 'GST' },
  { key: 'NON_GST', label: 'Non-GST bills only', short: 'Non-GST' },
];

function billingSideOption(billingSide) {
  return BILLING_SIDE_OPTIONS.find((o) => o.key === billingSide) || BILLING_SIDE_OPTIONS[0];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// YYYY-MM-DD read as a calendar date, never shifted by the viewer's timezone.
export function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function formatAmount(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// A real timestamp, unlike the plain calendar dates above — shown in the
// viewer's own time so "generated at" means what they expect.
export function formatDateTime(value) {
  const d = new Date(value);
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${time}`;
}

export function formatDateOfTimestamp(value) {
  if (!value) return '';
  const d = new Date(value);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// DD/MM/YYYY — the register's date columns, where a month name would cost
// width better spent on the money columns beside it.
export function formatDateNumeric(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateOfTimestampNumeric(value) {
  if (!value) return '';
  const d = new Date(value);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// A stay is worth listing only once money has moved on it — a bill issued, an
// advance held, or, for a cancelled stay, a cancellation charge actually
// taken. A stay that is merely booked or checked in with nothing paid yet is
// left out: it carries nothing for an owner to reconcile against.
function hasMoneyActivity(b) {
  if (b.status === 'CANCELLED') return (b.cancellationCharge || 0) > 0;
  if (b.invoiceNumber) return true;
  return (b.advanceAmount || 0) > 0;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Totals footed from the rows actually listed, not from the server's summary
// — the summary covers every stay checking in this period, but the register
// now shows only the ones with money activity, so its footer has to foot
// that narrower set.
function registerRowTotals(bookings) {
  let nights = 0, discount = 0, taxable = 0, roomTaxable = 0, foodTaxable = 0;
  let cgst = 0, sgst = 0, roundOff = 0, billed = 0;
  let advance = 0, balance = 0, cancelCharge = 0;
  for (const b of bookings) {
    if (b.status === 'CANCELLED') {
      cancelCharge += b.cancellationCharge || 0;
      continue;
    }
    nights += b.nights || 0;
    advance += b.advanceAmount || 0;
    if (b.billedAmount != null) {
      discount += b.discountAmount || 0;
      taxable += b.taxableValue || 0;
      roomTaxable += b.roomTaxable || 0;
      foodTaxable += b.foodTaxable || 0;
      cgst += b.cgstAmount || 0;
      sgst += b.sgstAmount || 0;
      roundOff += b.roundOff || 0;
      billed += b.billedAmount || 0;
      balance += b.balanceCollected || 0;
    }
  }
  return {
    nights,
    discount: round2(discount),
    taxable: round2(taxable),
    roomTaxable: round2(roomTaxable),
    foodTaxable: round2(foodTaxable),
    cgst: round2(cgst),
    sgst: round2(sgst),
    roundOff: round2(roundOff),
    billed: round2(billed),
    advance: round2(advance),
    balance: round2(balance),
    cancelCharge: round2(cancelCharge),
  };
}

// Whole nights between two YYYY-MM-DD dates, read as calendar dates rather
// than shifted by the viewer's timezone — mirrors how checkInDate/
// checkOutDate are read everywhere else in this file.
function nightsBetween(checkInIso, checkOutIso) {
  const inD = new Date(`${checkInIso}T00:00:00Z`);
  const outD = new Date(`${checkOutIso}T00:00:00Z`);
  return Math.round((outD - inD) / 86400000);
}

// One Final-bills row per room a booking holds, not one row per booking — a
// multi-room booking's rooms can sit on different dates, and a single row
// forced them into one comma-joined, truncated room list that lost that
// information. The bill's own figures (bill no., tax, billed, advance,
// balance) ride on the first room's row only; the booking is billed once,
// not once per room, so repeating them on every room row would overstate
// the totals this table foots.
function billRowsFor(b) {
  const rooms = b.rooms && b.rooms.length ? b.rooms : [{ roomNumber: b.roomNumber, checkInDate: b.checkInDate, checkOutDate: b.checkOutDate }];
  return rooms.map((room, i) => {
    const first = i === 0;
    return [
      first ? b.invoiceNumber || '—' : '',
      first ? DOCUMENT_TYPE_SHORT[b.documentType] || b.documentType || '—' : '',
      first ? formatDateOfTimestampNumeric(b.invoiceDate) : '',
      first ? b.guestName : '',
      room.roomNumber || '',
      formatDateNumeric(room.checkInDate),
      formatDateNumeric(room.checkOutDate),
      nightsBetween(room.checkInDate, room.checkOutDate),
      first ? formatAmount(b.discountAmount) : '—',
      first ? formatAmount(b.taxableValue) : '—',
      first ? formatAmount(b.cgstAmount) : '—',
      first ? formatAmount(b.sgstAmount) : '—',
      first ? formatAmount(b.billedAmount) : '—',
      first && b.advanceAmount ? formatAmount(b.advanceAmount) : '—',
      first && b.balanceCollected ? formatAmount(b.balanceCollected) : '—',
      first ? paidByLabel(b) || '—' : '',
    ];
  });
}

// The whole calendar month, or nothing — used to title a report "August 2026"
// instead of spelling out both ends, which is how an owner asked for it.
export function wholeMonthLabel(fromDate, toDate) {
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  const [ty, tm, td] = toDate.split('-').map(Number);
  if (fy !== ty || fm !== tm || fd !== 1) return null;
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  if (td !== lastDay) return null;
  return `${MONTHS[fm - 1]} ${fy}`;
}

export function reportPeriodLabel(fromDate, toDate) {
  return wholeMonthLabel(fromDate, toDate) || `${formatDate(fromDate)} to ${formatDate(toDate)}`;
}

function reportFilename(report, extension) {
  const month = wholeMonthLabel(report.fromDate, report.toDate);
  const period = month ? month.replace(' ', '-') : `${report.fromDate}-to-${report.toDate}`;
  const side = report.billingSide && report.billingSide !== 'ALL'
    ? `-${billingSideOption(report.billingSide).short.replace('-', '')}`
    : '';
  return `Booking-report-${period}${side}.${extension}`;
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// "Cash 2,000.00 + UPI 3,000.00" for a split, just "Cash" when one tender
// carried the whole amount — the amount is already in the column beside it.
export function tendersLabel(tenders, { amounts = true } = {}) {
  if (!tenders || tenders.length === 0) return '';
  if (tenders.length === 1) return PAYMENT_MODE_LABEL[tenders[0].method] || tenders[0].method;
  return tenders
    .map((t) => {
      const name = PAYMENT_MODE_LABEL[t.method] || t.method;
      return amounts ? `${name} ${formatAmount(t.amount)}` : name;
    })
    .join(amounts ? ' + ' : ', ');
}

// The modes a stay was paid by, advance and balance together — "Cash, UPI".
function paidByLabel(b) {
  const methods = [];
  for (const t of [...(b.advanceTenders || []), ...(b.balanceTenders || [])]) {
    const name = PAYMENT_MODE_LABEL[t.method] || t.method;
    if (!methods.includes(name)) methods.push(name);
  }
  return methods.join('+');
}

// The bill-level totals — summary.bills, or one of summary.byDocumentType —
// laid out as label/value pairs in the order a reader checks them: what was
// sold, what came off, what was taxed, what was charged.
function billTotalPairs(bills, servesFood) {
  return [
    ['Bills issued', bills.count, 'count'],
    ['Gross amount (tax inside)', bills.grossAmount],
    ['Less: discount', bills.discountAmount],
    ['Net amount', bills.netAmount],
    ...(servesFood
      ? [
          ['Taxable value — rooms', bills.roomTaxable],
          ['Taxable value — food', bills.foodTaxable],
        ]
      : []),
    ['Taxable value', bills.taxableValue],
    ['CGST', bills.cgstAmount],
    ['SGST', bills.sgstAmount],
    ['Total tax', bills.totalTax],
    ['Round off', bills.roundOff],
    ['Billed total', bills.totalAmount],
  ];
}

// Column definitions rather than two parallel arrays: the header and the row
// are projected from one list, so a conditional column cannot shift the values
// out from under the headings. `kind` says how the workbook should type the
// cell — a money column is written as a number so it can be summed.
function detailColumns(servesFood) {
  const money = (get) => (b) => {
    const v = get(b);
    return v == null ? null : Number(v);
  };
  return [
    { label: 'Bill no.', width: 12, value: (b) => b.invoiceNumber || '' },
    { label: 'Document', width: 14, value: (b) => DOCUMENT_TYPE_LABEL[b.documentType] || '' },
    { label: 'Bill date', width: 12, value: (b) => formatDateOfTimestamp(b.invoiceDate) },
    { label: 'Guest', width: 26, value: (b) => b.guestName },
    { label: 'Phone', width: 14, value: (b) => b.guestPhone },
    { label: 'Guests', width: 8, kind: 'count', value: (b) => b.numGuests },
    { label: 'Room', width: 8, value: (b) => b.roomNumber },
    { label: 'Category', width: 16, value: (b) => b.categoryName },
    { label: 'Check-in', width: 12, value: (b) => formatDate(b.checkInDate) },
    { label: 'Check-out', width: 12, value: (b) => formatDate(b.checkOutDate) },
    { label: 'Actual check-in', width: 20, value: (b) => (b.actualCheckInAt ? formatDateTime(b.actualCheckInAt) : '') },
    { label: 'Actual check-out', width: 20, value: (b) => (b.actualCheckOutAt ? formatDateTime(b.actualCheckOutAt) : '') },
    { label: 'Nights', width: 8, kind: 'count', value: (b) => b.nights },
    { label: 'Status', width: 12, value: (b) => BOOKING_STATUS_LABEL[b.status] || b.status },
    { label: 'Booked value', width: 14, kind: 'money', value: money((b) => b.totalPrice) },
    { label: 'Advance held', width: 14, kind: 'money', value: money((b) => b.advanceAmount) },
    { label: 'Advance paid by', width: 24, value: (b) => (b.advanceAmount ? tendersLabel(b.advanceTenders) : '') },
    { label: 'Room gross', width: 14, kind: 'money', value: money((b) => b.grossAmount) },
    { label: 'Discount', width: 12, kind: 'money', value: money((b) => b.discountAmount) },
    { label: 'Room net', width: 14, kind: 'money', value: money((b) => b.netAmount) },
    ...(servesFood
      ? [
          { label: 'Taxable — rooms', width: 15, kind: 'money', value: money((b) => b.roomTaxable) },
          { label: 'Taxable — food', width: 15, kind: 'money', value: money((b) => b.foodTaxable) },
        ]
      : []),
    { label: 'Taxable value', width: 14, kind: 'money', value: money((b) => b.taxableValue) },
    { label: 'CGST', width: 12, kind: 'money', value: money((b) => b.cgstAmount) },
    { label: 'SGST', width: 12, kind: 'money', value: money((b) => b.sgstAmount) },
    { label: 'Round off', width: 10, kind: 'money', value: money((b) => b.roundOff) },
    { label: 'Room billed total', width: 14, kind: 'money', value: money((b) => b.billedAmount) },
    { label: 'Advance deducted on bill', width: 16, kind: 'money', value: money((b) => b.advancePaid) },
    { label: 'Balance collected', width: 15, kind: 'money', value: money((b) => b.balanceCollected) },
    { label: 'Balance paid by', width: 24, value: (b) => (b.balanceCollected ? tendersLabel(b.balanceTenders) : '') },
    { label: 'Balance due', width: 12, kind: 'money', value: money((b) => b.balanceDue) },
    { label: 'Cancellation charge', width: 16, kind: 'money', value: money((b) => b.cancellationCharge) },
  ];
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

// Lakh grouping, matching the PDF and every figure the app shows.
const MONEY = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';
const HEADER_FILL = '#E8E8E8';
const NOTE_COLOR = '#555555';

const bold = (value, extra = {}) => ({ value, fontWeight: 'bold', ...extra });
const text = (value) => ({ value: value === '' ? null : value });
const note = (value) => ({ value, color: NOTE_COLOR, fontStyle: 'italic', wrap: true });
// Written as a real number, not a formatted string: this is the whole point of
// an .xlsx over a .csv — the column can be summed, sorted and charted in Excel.
const money = (value) => ({ value: value ?? null, type: Number, format: MONEY, align: 'right' });
const count = (value) => ({ value: value ?? null, type: Number, align: 'right' });
const sectionRow = (title) => [bold(title, { backgroundColor: HEADER_FILL })];
const headerRow = (labels) =>
  labels.map((label) => bold(label, { backgroundColor: HEADER_FILL, wrap: true }));
const totalsRow = (cells) => cells.map((c) => ({ ...c, fontWeight: 'bold' }));

function summarySheet(report) {
  const { summary } = report;
  const period = reportPeriodLabel(report.fromDate, report.toDate);
  const bills = summary.bills;
  const rows = [
    [bold(report.lodgeName || 'Booking report', { fontSize: 14 })],
    [bold('Booking report'), text(period)],
    ...(report.gstin ? [[bold('GSTIN'), text(report.gstin)]] : []),
    [bold('Bills included'), text(billingSideOption(report.billingSide).label)],
    [bold('Generated'), text(formatDateTime(report.generatedAt || Date.now()))],
    [],
    [
      note(
        'Three parts. (1) Money received: counted on the date each payment came in, whichever stay it was for. ' +
          '(2) Stays checking in this period and the bills issued for them: counted by check-in date. ' +
          '(3) The Bookings sheet: one row per stay in part 2. Parts 1 and 2 are dated differently and are not ' +
          'expected to match. Cancelled bookings are excluded from every money figure, except the cancellation ' +
          'charges on them — money kept back from an advance, or collected while cancelling — which part 1 counts as income.'
      ),
    ],
    [],
    sectionRow(`1. MONEY RECEIVED IN ${period.toUpperCase()}`),
    [bold('Advances received'), money(summary.advanceCollected)],
    [bold('Final payments received'), money(summary.balanceCollected)],
    ...(summary.cancellationChargesKept
      ? [[bold('Cancellation charges kept'), money(summary.cancellationChargesKept)]]
      : []),
    totalsRow([bold('Total received'), money(summary.totalCollected)]),
    [
      note(
        'An advance is dated by its receipt; a final payment by the date of the bill it settled. ' +
          'Includes money for stays in other periods.'
      ),
    ],
    [],
    headerRow(['By payment mode', 'Advances', 'Final payments', 'Total']),
  ];

  for (const mode of PAYMENT_MODES) {
    const t = summary.byPaymentMode[mode];
    if (mode === 'UNRECORDED' && !t.total) continue;
    rows.push([text(PAYMENT_MODE_LABEL[mode]), money(t.advance), money(t.balance), money(t.total)]);
  }
  // Foots the two columns above it, which is what a totals row is for.
  // Cancellation charges ride outside the mode split — the advance they were
  // held back from may have arrived by more than one mode — so they appear in
  // the section total but not here.
  const modeSplitTotal = (summary.advanceCollected || 0) + (summary.balanceCollected || 0);
  rows.push(
    totalsRow([
      bold('Total by mode'),
      money(summary.advanceCollected),
      money(summary.balanceCollected),
      money(modeSplitTotal),
    ])
  );

  const stayPeriods = summary.collections?.byStayPeriod;
  if (stayPeriods) {
    rows.push([]);
    rows.push(headerRow(['By the stay it was for', 'Advances', 'Final payments', 'Total']));
    for (const [key, label] of [
      ['EARLIER', 'Stays that checked in before this period'],
      ['THIS', 'Stays checking in this period'],
      ['LATER', 'Stays checking in after this period'],
    ]) {
      const t = stayPeriods[key];
      rows.push([text(label), money(t.advance), money(t.balance), money(t.total)]);
    }
    rows.push(
      totalsRow([
        bold('Total by stay'),
        money(summary.advanceCollected),
        money(summary.balanceCollected),
        money(modeSplitTotal),
      ])
    );
  }

  rows.push([]);
  rows.push(sectionRow(`2. STAYS CHECKING IN ${period.toUpperCase()}`));
  rows.push([bold('Bookings'), count(summary.totalBookings)]);
  for (const [status, label] of Object.entries(BOOKING_STATUS_LABEL)) {
    rows.push([text(`  ${label}`), count(summary.byStatus[status] || 0)]);
  }
  rows.push([bold('Room nights (excluding cancelled)'), count(summary.roomNights)]);
  rows.push([bold('Booked value (excluding cancelled)'), money(summary.bookedValue)]);
  rows.push([bold('  Billed — bills issued'), count(summary.billedCount)]);
  rows.push([bold('  Billed total'), money(summary.billedAmount)]);
  rows.push([bold('  Not yet billed — stays'), count(summary.unbilledCount)]);
  rows.push([bold('  Not yet billed — booked value'), money(summary.unbilledValue)]);
  if (summary.cancelled?.count) {
    rows.push([bold('Cancelled — bookings'), count(summary.cancelled.count)]);
    rows.push([bold('Cancelled — booked value, not counted'), money(summary.cancelled.bookedValue)]);
    rows.push([bold('Cancelled — advance held'), money(summary.cancelled.advanceHeld)]);
    // Where the held money went, on the stays whose cancellation settled it.
    if (summary.cancelled.refunded || summary.cancelled.chargesKept) {
      rows.push([bold('Cancelled — refunded to guests'), money(summary.cancelled.refunded || 0)]);
      rows.push([bold('Cancelled — cancellation charges'), money(summary.cancelled.chargesKept || 0)]);
    }
  }

  rows.push([]);
  rows.push(sectionRow('BILLS ISSUED FOR THESE STAYS'));
  for (const [label, raw, kind] of billTotalPairs(bills, report.servesFood)) {
    rows.push([bold(label), kind === 'count' ? count(raw) : money(raw)]);
  }
  rows.push([
    note(
      'Prices are GST-inclusive. Taxable value is the net amount with the tax inside it taken out, so ' +
        'taxable value + CGST + SGST + round off = billed total.'
    ),
  ]);

  rows.push([]);
  rows.push(headerRow(['Tax by supply', 'SAC', 'Taxable value', 'CGST', 'SGST', 'Total tax']));
  rows.push([
    text('Accommodation'),
    text(SAC.rooms),
    money(bills.roomTaxable),
    money(bills.roomCgst),
    money(bills.roomSgst),
    money(bills.roomCgst + bills.roomSgst),
  ]);
  if (report.servesFood) {
    rows.push([
      text('Food'),
      text(SAC.food),
      money(bills.foodTaxable),
      money(bills.foodCgst),
      money(bills.foodSgst),
      money(bills.foodCgst + bills.foodSgst),
    ]);
    rows.push(
      totalsRow([
        bold('Total'),
        text(''),
        money(bills.taxableValue),
        money(bills.cgstAmount),
        money(bills.sgstAmount),
        money(bills.totalTax),
      ])
    );
  }

  rows.push([]);
  rows.push(
    headerRow([
      'By document',
      'Bills',
      'Gross amount',
      'Discount',
      'Taxable value',
      'CGST',
      'SGST',
      'Round off',
      'Billed total',
    ])
  );
  for (const type of DOCUMENT_TYPES) {
    const t = summary.byDocumentType?.[type];
    if (!t || !t.count) continue;
    rows.push([
      text(DOCUMENT_TYPE_LABEL[type]),
      count(t.count),
      money(t.grossAmount),
      money(t.discountAmount),
      money(t.taxableValue),
      money(t.cgstAmount),
      money(t.sgstAmount),
      money(t.roundOff),
      money(t.totalAmount),
    ]);
  }
  rows.push(
    totalsRow([
      bold('Total'),
      count(bills.count),
      money(bills.grossAmount),
      money(bills.discountAmount),
      money(bills.taxableValue),
      money(bills.cgstAmount),
      money(bills.sgstAmount),
      money(bills.roundOff),
      money(bills.totalAmount),
    ])
  );

  rows.push([]);
  rows.push(sectionRow('SETTLEMENT OF THESE BILLS'));
  rows.push([bold('Billed total'), money(summary.billedAmount)]);
  rows.push([bold('Less: advance deducted on the bills'), money(bills.advanceDeducted)]);
  rows.push([bold('Less: balance collected on the bills'), money(summary.stayBalance)]);
  rows.push(totalsRow([bold('Balance still due'), money(summary.stayBalanceDue)]));

  return {
    data: rows,
    sheet: 'Summary',
    columns: [{ width: 40 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 16 }],
  };
}

function bookingsSheet(report) {
  const columns = detailColumns(report.servesFood);
  const rows = [headerRow(columns.map((c) => c.label))];
  const listed = report.bookings.filter(hasMoneyActivity);

  for (const b of listed) {
    rows.push(
      columns.map((column) => {
        const raw = column.value(b);
        if (column.kind === 'money') return money(raw);
        if (column.kind === 'count') return count(raw);
        return text(raw);
      })
    );
  }

  // Footed from the listed rows themselves — the stays with no money
  // activity are left out of this sheet, so the server's summary (which
  // covers every stay checking in this period) no longer foots it.
  const t = registerRowTotals(listed);
  let bookedValue = 0, roomGross = 0, roomNet = 0, advanceDeducted = 0, balanceDue = 0;
  for (const b of listed) {
    if (b.status === 'CANCELLED') continue;
    bookedValue += b.totalPrice || 0;
    if (b.billedAmount != null) {
      roomGross += b.grossAmount || 0;
      roomNet += b.netAmount || 0;
      advanceDeducted += b.advancePaid || 0;
      balanceDue += b.balanceDue || 0;
    }
  }
  const totals = {
    'Bill no.': bold('Total'),
    Nights: count(t.nights),
    'Booked value': money(round2(bookedValue)),
    'Advance held': money(t.advance),
    'Room gross': money(round2(roomGross)),
    Discount: money(t.discount),
    'Room net': money(round2(roomNet)),
    'Taxable — rooms': money(t.roomTaxable),
    'Taxable — food': money(t.foodTaxable),
    'Taxable value': money(t.taxable),
    CGST: money(t.cgst),
    SGST: money(t.sgst),
    'Round off': money(t.roundOff),
    'Room billed total': money(t.billed),
    'Advance deducted on bill': money(round2(advanceDeducted)),
    'Balance collected': money(t.balance),
    'Balance due': money(round2(balanceDue)),
    'Cancellation charge': money(t.cancelCharge),
  };
  rows.push(totalsRow(columns.map((c) => totals[c.label] ?? text(''))));

  return {
    data: rows,
    sheet: 'Bookings',
    // Freeze the header so the labels stay put while an owner scrolls a
    // month's worth of rows — the reason the labels are bold in the first place.
    stickyRowsCount: 1,
    columns: columns.map((c) => ({ width: c.width || 16 })),
  };
}

// The advance the bills deducted is not in the server's bill totals by name;
// it is the sum of advancePaid over billed, non-cancelled rows. Derived once
// here so the PDF and the workbook print the same figure.
function withDerived(report) {
  const advanceDeducted = report.bookings.reduce(
    (sum, b) => (b.status !== 'CANCELLED' && b.advancePaid != null ? sum + b.advancePaid : sum),
    0
  );
  return {
    ...report,
    summary: {
      ...report.summary,
      bills: { ...report.summary.bills, advanceDeducted: Math.round(advanceDeducted * 100) / 100 },
    },
  };
}

export async function downloadBookingReportExcel(rawReport) {
  const report = withDerived(rawReport);
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const workbook = await writeXlsxFile([summarySheet(report), bookingsSheet(report)], {
    fontFamily: 'Calibri',
    fontSize: 11,
  });
  triggerDownload(await workbook.toBlob(), reportFilename(report, 'xlsx'));
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

// Landscape A4 (842 x 595pt): the register carries nineteen columns once the
// bill's figures are on it, and portrait would force either a wrapped row or
// unreadable type.
export const MARGIN = 24;
export const CONTENT_WIDTH = 842 - MARGIN * 2;

// Greys, not colours — this is a document that gets printed, often on a mono
// laser, and a tint that survives that is worth more than a brand hue.
export const INK = 25;
export const MUTED = 115;
export const RULE = 170;
const BAND = 238;
const ZEBRA = 247;

// Bill number leads: it is the document reference an owner files and searches
// by. The internal booking id is deliberately absent — it is never shown
// anywhere in the app, so it identifies nothing an owner could look up. A row
// with no bill yet is identified by guest, room and dates instead.
//
// The register is three tables, not one, because a bill, an advance and a
// cancellation settle on different documents and a reader checking one
// against its source should not have to pick it out of a mixed list.
// Widths are absolute points, sized against the widest string each column
// carries at 7pt Helvetica with 2pt of padding a side.
// Status and round off are dropped here — every row in this table has a
// bill, so "billed" is a given, and round off is a paise-level rounding
// memo that belongs in part 2's reconciliation, not a per-row column. A
// multi-room booking gets one row per room (see billRowsFor()), so Rm never
// has to carry a comma-joined, truncated room list.
const FINAL_BILL_COLUMNS = [
  { label: 'Bill no.', width: 44 },
  { label: 'Type', width: 32 },
  { label: 'Bill date', width: 48 },
  { label: 'Guest', width: 94 },
  { label: 'Rm', width: 36 },
  { label: 'Check-in', width: 48 },
  { label: 'Check-out', width: 48 },
  { label: 'Nts', width: 20, align: 'right' },
  { label: 'Discount', width: 46, align: 'right' },
  { label: 'Taxable', width: 50, align: 'right' },
  { label: 'CGST', width: 46, align: 'right' },
  { label: 'SGST', width: 46, align: 'right' },
  { label: 'Billed', width: 50, align: 'right' },
  { label: 'Advance', width: 48, align: 'right' },
  { label: 'Balance', width: 48, align: 'right' },
  { label: 'Paid by', width: 66 },
];

const ADVANCE_COLUMNS = [
  { label: 'Guest', width: 160 },
  { label: 'Rm', width: 30 },
  { label: 'Check-in', width: 55 },
  { label: 'Check-out', width: 55 },
  { label: 'Status', width: 50 },
  { label: 'Advance', width: 70, align: 'right' },
  { label: 'Paid by', width: 110 },
];

const CANCELLED_COLUMNS = [
  { label: 'Guest', width: 140 },
  { label: 'Rm', width: 28 },
  { label: 'Check-in', width: 50 },
  { label: 'Check-out', width: 50 },
  { label: 'Cancel reason', width: 180 },
  { label: 'Advance held', width: 70, align: 'right' },
  { label: 'Refunded', width: 70, align: 'right' },
  { label: 'Cancel chg.', width: 80, align: 'right' },
];

// jsPDF's built-in fonts have no glyph fallback, so an over-long guest name
// has to be clipped by measured width rather than character count.
export function clip(pdf, text, width) {
  const value = String(text ?? '');
  if (!value) return '';
  if (pdf.getTextWidth(value) <= width) return value;
  let end = value.length;
  while (end > 1 && pdf.getTextWidth(`${value.slice(0, end)}…`) > width) end -= 1;
  return `${value.slice(0, end)}…`;
}

// A thin layout cursor over jsPDF: it owns the y position and the page breaks,
// so each section below just says "draw a heading, draw a table" without
// tracking where the previous one landed.
export function createLayout(pdf, runningHead) {
  const pageHeight = pdf.internal.pageSize.getHeight();
  const right = MARGIN + CONTENT_WIDTH;
  const bottom = pageHeight - MARGIN - 16;
  let y = MARGIN;

  const layout = {
    right,
    bottom,
    get y() {
      return y;
    },
    set y(value) {
      y = value;
    },
    newPage() {
      pdf.addPage();
      y = MARGIN;
      pdf.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED);
      pdf.text(runningHead, MARGIN, y);
      pdf.setTextColor(INK);
      y += 18;
    },
    // Reserving the height a block needs *before* drawing it is what stops a
    // heading stranding at the foot of a page with its table overleaf.
    ensure(height) {
      if (y + height > bottom) layout.newPage();
    },
    // A section heading, with room reserved for the first block beneath it so
    // the two are never split by a page break.
    heading(text, { subtitle = null, reserve = 40 } = {}) {
      layout.ensure(30 + (subtitle ? 10 : 0) + reserve);
      pdf.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(INK);
      pdf.text(text.toUpperCase(), MARGIN, y);
      if (subtitle) {
        pdf.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED);
        pdf.text(subtitle, right, y, { align: 'right' });
      }
      y += 4;
      pdf.setDrawColor(INK).setLineWidth(0.8);
      pdf.line(MARGIN, y, right, y);
      y += 13;
      pdf.setFont('helvetica', 'normal').setTextColor(INK);
    },
    // A smaller heading for a table inside a section. `reserve` is the height
    // of the block that follows, so the two stay on one page together.
    subheading(text, { reserve = 40 } = {}) {
      layout.ensure(14 + reserve);
      pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(INK);
      pdf.text(text, MARGIN, y);
      y += 6;
      pdf.setFont('helvetica', 'normal');
    },
    // A line of explanation under a heading. Used where a section is counted on
    // a different basis to the one above it and would otherwise read as a
    // discrepancy — the reader has to be told, on the page, which is which.
    note(text, { width = CONTENT_WIDTH } = {}) {
      pdf.setFont('helvetica', 'italic').setFontSize(7);
      const lines = pdf.splitTextToSize(text, width);
      layout.ensure(lines.length * 9 + 6);
      pdf.setTextColor(MUTED);
      pdf.text(lines, MARGIN, y);
      y += lines.length * 9 + 6;
      pdf.setFont('helvetica', 'normal').setTextColor(INK);
    },
    // Label-above-value tiles. The summary is a handful of short facts, and a
    // full table around them would be all frame and no content.
    tiles(entries, perRow = 6) {
      const tileWidth = CONTENT_WIDTH / perRow;
      const rows = Math.ceil(entries.length / perRow);
      layout.ensure(rows * 30);
      entries.forEach(([label, value], i) => {
        const x = MARGIN + (i % perRow) * tileWidth;
        const top = y + Math.floor(i / perRow) * 30;
        pdf.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(MUTED);
        pdf.text(clip(pdf, label.toUpperCase(), tileWidth - 8), x, top);
        pdf.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
        pdf.text(clip(pdf, String(value), tileWidth - 8), x, top + 12);
      });
      y += rows * 30 + 2;
      pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(INK);
    },
    // A short arithmetic statement — "gross − discount = net" — as aligned
    // label/amount lines, with the result ruled off from its parts.
    equation(lines, { width = 300 } = {}) {
      const rowHeight = 12;
      // Text sits on its baseline at y, so the first line has to step down
      // past whatever was drawn at the current y — a subheading, usually.
      y += 8;
      layout.ensure(lines.length * rowHeight + 8);
      pdf.setFontSize(8);
      lines.forEach(([label, value, { result = false } = {}], i) => {
        if (result) {
          pdf.setDrawColor(RULE).setLineWidth(0.6);
          pdf.line(MARGIN, y - rowHeight + 4, MARGIN + width, y - rowHeight + 4);
        }
        pdf.setFont('helvetica', result ? 'bold' : 'normal').setTextColor(INK);
        pdf.text(label, MARGIN + (result ? 0 : 10), y);
        pdf.text(value, MARGIN + width, y, { align: 'right' });
        y += rowHeight;
        if (i === lines.length - 1) y += 2;
      });
      pdf.setFont('helvetica', 'normal');
    },
    // zebra defaults off: a shaded row's fill rect is painted flush against
    // the row above it, exactly where that row's grid line sits — the fill
    // silently erases the line underneath it, leaving every shaded row
    // missing its top border. Grid lines plus zebra don't combine safely in
    // this painter, and the grid lines are what the design actually wants.
    table({ columns, rows, totals, fontSize = 7.5, rowHeight = 13, zebra = false }) {
      const width = columns.reduce((sum, c) => sum + c.width, 0);
      const paint = (cells, { bold = false, fill = null } = {}) => {
        if (fill !== null) {
          pdf.setFillColor(fill);
          pdf.rect(MARGIN, y - rowHeight + 4, width, rowHeight, 'F');
        }
        pdf.setFont('helvetica', bold ? 'bold' : 'normal').setTextColor(INK);
        let x = MARGIN;
        columns.forEach((column, i) => {
          const text = clip(pdf, cells[i], column.width - 4);
          if (column.align === 'right') pdf.text(text, x + column.width - 2, y, { align: 'right' });
          else pdf.text(text, x + 2, y);
          x += column.width;
        });
      };
      // A full grid, like a spreadsheet — a rule under the row just painted
      // and a line down every column boundary across it, so every cell is
      // boxed rather than just every row.
      const grid = (weight) => {
        const boxTop = y - rowHeight + 4;
        const boxBottom = y + 4;
        pdf.setDrawColor(RULE).setLineWidth(weight);
        pdf.line(MARGIN, boxBottom, MARGIN + width, boxBottom);
        let x = MARGIN;
        pdf.line(x, boxTop, x, boxBottom);
        columns.forEach((column) => {
          x += column.width;
          pdf.line(x, boxTop, x, boxBottom);
        });
      };

      const columnHeader = () => {
        // The header box's top edge lands exactly at y as it stood before
        // this call — the increments below only move past it.
        pdf.setDrawColor(RULE).setLineWidth(0.6);
        pdf.line(MARGIN, y, MARGIN + width, y);
        y += rowHeight - 4;
        pdf.setFillColor(BAND);
        pdf.rect(MARGIN, y - rowHeight + 4, width, rowHeight, 'F');
        pdf.setFontSize(fontSize);
        paint(
          columns.map((c) => c.label),
          { bold: true }
        );
        grid(0.6);
        y += rowHeight;
      };

      pdf.setFontSize(fontSize);
      layout.ensure(rowHeight * 3);
      columnHeader();

      rows.forEach((row, i) => {
        if (y > bottom) {
          layout.newPage();
          pdf.setFontSize(fontSize);
          columnHeader();
        }
        paint(row, { fill: zebra && i % 2 === 1 ? ZEBRA : null });
        grid(0.3);
        y += rowHeight;
      });

      if (totals) {
        if (y > bottom - rowHeight) {
          layout.newPage();
          pdf.setFontSize(fontSize);
          columnHeader();
        }
        pdf.setDrawColor(RULE).setLineWidth(0.6);
        pdf.line(MARGIN, y - rowHeight + 4, MARGIN + width, y - rowHeight + 4);
        paint(totals, { bold: true });
        grid(0.6);
        y += rowHeight;
      }
      y += 8;
    },
  };

  return layout;
}

// Builds the report and hands back the file itself. Split out from the
// download so a preview shows the ACTUAL document rather than an HTML
// impression of it — two renderers for one report is how a preview starts
// quietly disagreeing with the file people file away.
export async function buildBookingReportPdf(rawReport) {
  const report = withDerived(rawReport);
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const pageHeight = pdf.internal.pageSize.getHeight();
  const { summary } = report;
  const bills = summary.bills;
  const period = reportPeriodLabel(report.fromDate, report.toDate);
  const name = report.lodgeName || 'Booking report';
  const layout = createLayout(pdf, `${name} — booking report, ${period}`);
  const cancelled = summary.cancelled || { count: 0 };

  // Masthead: the property on the left, what the document is on the right.
  let y = MARGIN + 4;
  pdf.setFont('helvetica', 'bold').setFontSize(16).setTextColor(INK);
  pdf.text(clip(pdf, name, CONTENT_WIDTH - 260), MARGIN, y);
  pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
  if (report.gstin) pdf.text(`GSTIN  ${report.gstin}`, MARGIN, y + 13);

  pdf.setFont('helvetica', 'bold').setFontSize(11).setTextColor(INK);
  pdf.text('BOOKING REPORT', layout.right, y, { align: 'right' });
  pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
  pdf.text(`${period}   ·   ${billingSideOption(report.billingSide).label}`, layout.right, y + 13, {
    align: 'right',
  });
  pdf.text(`Generated ${formatDateTime(report.generatedAt || Date.now())}`, layout.right, y + 24, {
    align: 'right',
  });

  y += 34;
  pdf.setDrawColor(INK).setLineWidth(1.2);
  pdf.line(MARGIN, y, layout.right, y);
  layout.y = y + 16;

  // What the reader is looking at, before any number. The two halves of this
  // report are dated differently, and a reader who is not told that on page
  // one will spend the rest of it looking for a mismatch that is not there.
  layout.note(
    'This report has three parts. Part 1 is the register — every stay checking in this period, split by what ' +
      'settled its money. Part 2 is money received in the period, counted on the date each payment came in, ' +
      'whichever stay it was for. Part 3 is the stays that checked in during the period and the bills issued ' +
      'for them, counted by check-in date — the same stays listed in part 1. Parts 2 and 3 are dated ' +
      'differently and are not expected to agree. Cancelled bookings are listed but excluded from every money ' +
      'figure, except the cancellation charges kept on them, which part 2 counts as income. ' +
      'This is a room report: food is reported under Restaurant. For GST returns use the GST register, which ' +
      'lists every bill by bill date. All amounts in rupees.'
  );

  // The headline figures, one line, before the detail.
  layout.tiles(
    [
      ['Money received in period', formatAmount(summary.totalCollected)],
      ['Stays checking in', summary.activeBookings ?? summary.totalBookings - cancelled.count],
      ['Room nights', summary.roomNights],
      ['Bills issued', bills.count],
      ['Billed total', formatAmount(bills.totalAmount)],
      ['Tax on bills (CGST + SGST)', formatAmount(bills.totalTax)],
    ],
    6
  );

  // ---- Part 1 -------------------------------------------------------------
  // Three registers, not one — a bill, an advance, and a cancellation settle
  // differently and a reader checking one against its source document should
  // not have to pick it out of a list mixing all three. Leads the report: it
  // is the part that gets printed and filed, the reason an owner opens this
  // PDF in the first place.
  const billedBookings = report.bookings.filter((b) => b.status !== 'CANCELLED' && b.invoiceNumber);
  const advanceOnlyBookings = report.bookings.filter(
    (b) => b.status !== 'CANCELLED' && !b.invoiceNumber && (b.advanceAmount || 0) > 0
  );
  const cancelledBookings = report.bookings.filter((b) => b.status === 'CANCELLED');
  layout.heading(`1. Register — stays checking in ${period}`, {
    subtitle: 'Split by what settled the money — a bill, an advance, or a cancellation',
  });

  // ---- 1A. Final bills -----------------------------------------------------
  layout.subheading(`A. Final bills — ${plural(billedBookings.length, 'bill')}`, { reserve: 60 });
  layout.note(
    'Every stay with a bill issued, billed or not yet checked out. Taxable + CGST + SGST + R/off = Billed. ' +
      'Advance is the advance held against the stay; Balance is what else was collected on the bill.'
  );
  if (billedBookings.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    pdf.text('No bills issued for stays checking in this period.', MARGIN, layout.y);
    pdf.setTextColor(INK);
    layout.y += 16;
  } else {
    const t = registerRowTotals(billedBookings);
    layout.table({
      columns: FINAL_BILL_COLUMNS,
      fontSize: 7,
      rowHeight: 12,
      rows: billedBookings.flatMap(billRowsFor),
      totals: [
        'Total', '', '', '', '', '', '', t.nights,
        formatAmount(t.discount), formatAmount(t.taxable), formatAmount(t.cgst), formatAmount(t.sgst),
        formatAmount(t.billed), formatAmount(t.advance), formatAmount(t.balance), '',
      ],
    });
  }

  // ---- 1B. Advance payments ------------------------------------------------
  layout.subheading(`B. Advance payments — ${plural(advanceOnlyBookings.length, 'stay')} not yet billed`, {
    reserve: 60,
  });
  layout.note(
    'Stays holding an advance with no bill issued yet. Once billed, the stay moves up into Final bills and ' +
      'this advance shows in that row’s Advance column instead.'
  );
  if (advanceOnlyBookings.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    pdf.text('No unbilled stays holding an advance.', MARGIN, layout.y);
    pdf.setTextColor(INK);
    layout.y += 16;
  } else {
    const advanceTotal = round2(advanceOnlyBookings.reduce((sum, b) => sum + (b.advanceAmount || 0), 0));
    layout.table({
      columns: ADVANCE_COLUMNS,
      fontSize: 7,
      rowHeight: 12,
      rows: advanceOnlyBookings.map((b) => [
        b.guestName,
        b.roomNumber,
        formatDate(b.checkInDate),
        formatDate(b.checkOutDate),
        BOOKING_STATUS_SHORT[b.status] || b.status,
        formatAmount(b.advanceAmount),
        tendersLabel(b.advanceTenders) || '—',
      ]),
      totals: ['Total', '', '', '', '', formatAmount(advanceTotal), ''],
    });
  }

  // ---- 1C. Cancelled settlements -------------------------------------------
  layout.subheading(`C. Cancelled settlements — ${plural(cancelledBookings.length, 'booking')}`, { reserve: 60 });
  layout.note(
    'Every cancelled booking that was checking in this period, and how the advance held on it was settled. ' +
      'Any cancellation charge kept is income in part 2; a refund is not.'
  );
  if (cancelledBookings.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    pdf.text('No cancelled bookings checking in this period.', MARGIN, layout.y);
    pdf.setTextColor(INK);
  } else {
    const held = round2(cancelledBookings.reduce((sum, b) => sum + (b.advanceAmount || 0), 0));
    const refunded = round2(cancelledBookings.reduce((sum, b) => sum + (b.refundAmount || 0), 0));
    const charged = round2(cancelledBookings.reduce((sum, b) => sum + (b.cancellationCharge || 0), 0));
    layout.table({
      columns: CANCELLED_COLUMNS,
      fontSize: 7,
      rowHeight: 12,
      rows: cancelledBookings.map((b) => [
        b.guestName,
        b.roomNumber,
        formatDate(b.checkInDate),
        formatDate(b.checkOutDate),
        b.cancelReason || '—',
        b.advanceAmount ? formatAmount(b.advanceAmount) : '—',
        b.refundAmount ? formatAmount(b.refundAmount) : '—',
        b.cancellationCharge ? formatAmount(b.cancellationCharge) : '—',
      ]),
      totals: ['Total', '', '', '', '', formatAmount(held), formatAmount(refunded), formatAmount(charged)],
    });
  }

  layout.newPage();

  // ---- Part 2 -------------------------------------------------------------
  layout.heading(`2. Money received in ${period}`, { subtitle: 'Cash basis — dated by when the money came in' });
  const chargesKeptInPeriod = summary.cancellationChargesKept || 0;
  layout.tiles(
    chargesKeptInPeriod
      ? [
          ['Advances received', formatAmount(summary.advanceCollected)],
          ['Final payments received', formatAmount(summary.balanceCollected)],
          ['Cancellation charges kept', formatAmount(chargesKeptInPeriod)],
          ['Total received', formatAmount(summary.totalCollected)],
        ]
      : [
          ['Advances received', formatAmount(summary.advanceCollected)],
          ['Final payments received', formatAmount(summary.balanceCollected)],
          ['Total received', formatAmount(summary.totalCollected)],
        ],
    chargesKeptInPeriod ? 4 : 3
  );
  layout.note(
    'An advance is dated by the receipt that acknowledged it; a final payment by the date of the bill it ' +
      'settled. This includes money received for stays in other periods, and excludes money for this ' +
      "period's stays that came in earlier or later." +
      (chargesKeptInPeriod
        ? ' A cancellation charge is money kept back from an advance, or collected from the guest while ' +
          'cancelling, dated by the day of cancellation. It sits outside the mode and stay tables below, ' +
          'which foot to advances plus final payments.'
        : '') +
      (cancelled.advanceHeld && !(cancelled.refunded || cancelled.chargesKept)
        ? ` Advances of ${formatAmount(cancelled.advanceHeld)} held on ${plural(cancelled.count, 'cancelled booking')} ` +
          'are not counted — those cancellations recorded no settlement, so that money is not reported as income.'
        : '')
  );

  const moneyColumns = (firstLabel) => [
    { label: firstLabel, width: 230 },
    { label: 'Advances', width: 110, align: 'right' },
    { label: 'Final payments', width: 110, align: 'right' },
    { label: 'Total', width: 110, align: 'right' },
  ];
  // Foots the two columns it sits under. Cancellation charges are in the
  // section's Total received tile but not in these tables — the advance they
  // were held back from may have arrived by more than one mode.
  const moneyTotals = [
    'Total (advances + final payments)',
    formatAmount(summary.advanceCollected),
    formatAmount(summary.balanceCollected),
    formatAmount((summary.advanceCollected || 0) + (summary.balanceCollected || 0)),
  ];

  layout.subheading('By payment mode');
  layout.table({
    columns: moneyColumns('Mode'),
    rows: PAYMENT_MODES.filter((m) => m !== 'UNRECORDED' || summary.byPaymentMode[m].total).map((mode) => [
      PAYMENT_MODE_LABEL[mode],
      formatAmount(summary.byPaymentMode[mode].advance),
      formatAmount(summary.byPaymentMode[mode].balance),
      formatAmount(summary.byPaymentMode[mode].total),
    ]),
    totals: moneyTotals,
    fontSize: 8,
    rowHeight: 14,
  });

  // Which stay each rupee was for. An owner reading a single advances figure
  // cannot tell how much of it is this month's business and how much is money
  // held for stays that have not happened yet — the two behave completely
  // differently at month end, and the gap between them is what reads as a
  // mismatch against the stay figures in part 3.
  const stayPeriods = summary.collections?.byStayPeriod;
  if (stayPeriods) {
    const periodRow = (key, label) => [
      label,
      formatAmount(stayPeriods[key].advance),
      formatAmount(stayPeriods[key].balance),
      formatAmount(stayPeriods[key].total),
    ];
    layout.subheading('By the stay it was for');
    layout.table({
      columns: moneyColumns('Money received was for'),
      rows: [
        periodRow('EARLIER', 'Stays that checked in before this period'),
        periodRow('THIS', 'Stays checking in this period'),
        periodRow('LATER', 'Stays checking in after this period'),
      ],
      totals: moneyTotals,
      fontSize: 8,
      rowHeight: 14,
    });
  }

  // ---- Part 3 -------------------------------------------------------------
  layout.heading(`3. Stays checking in ${period}`, { subtitle: 'By check-in date — the stays listed in part 1' });
  layout.tiles([
    ['Bookings', summary.totalBookings],
    ...Object.entries(BOOKING_STATUS_LABEL).map(([status, label]) => [label, summary.byStatus[status] || 0]),
    ['Room nights', summary.roomNights],
  ]);
  layout.tiles(
    [
      ['Booked value', formatAmount(summary.bookedValue)],
      ['Bills issued', bills.count],
      ['Billed total', formatAmount(bills.totalAmount)],
      ['Not yet billed', plural(summary.unbilledCount ?? 0, 'stay')],
      ['Not yet billed — booked value', formatAmount(summary.unbilledValue)],
      ['Advance held on these stays', formatAmount(summary.stayAdvance)],
    ],
    6
  );
  layout.note(
    'Booked value is what the stays were priced at; billed total is what the issued bills charged (after any ' +
      'discount). The two differ by the stays not yet billed and by discounts given.' +
      (cancelled.count
        ? ` ${plural(cancelled.count, 'cancelled booking')} worth ${formatAmount(cancelled.bookedValue)} ` +
          'is counted in the bookings above but excluded from room nights and from every money figure.'
        : '') +
      (cancelled.refunded || cancelled.chargesKept
        ? ` On them, ${formatAmount(cancelled.refunded || 0)} of advances was refunded and ` +
          `${formatAmount(cancelled.chargesKept || 0)} taken as cancellation charges.`
        : '')
  );

  layout.subheading('Bills issued for these stays', { reserve: 150 });
  layout.equation([
    ['Gross amount (tax inside)', formatAmount(bills.grossAmount)],
    ['Less: discount', formatAmount(bills.discountAmount)],
    ['Net amount', formatAmount(bills.netAmount), { result: true }],
    ['Less: CGST + SGST inside the net amount', formatAmount(bills.totalTax)],
    ['Taxable value', formatAmount(bills.taxableValue), { result: true }],
  ]);
  layout.equation([
    ['Taxable value', formatAmount(bills.taxableValue)],
    ['Add: CGST', formatAmount(bills.cgstAmount)],
    ['Add: SGST', formatAmount(bills.sgstAmount)],
    ['Add: round off', formatAmount(bills.roundOff)],
    ['Billed total', formatAmount(bills.totalAmount), { result: true }],
  ]);
  layout.note(
    'Prices are GST-inclusive, so the taxable value is the net amount with the tax inside it taken out — it ' +
      'is not the gross. Tax acknowledged on receipt vouchers for advances is not shown here; it is reported ' +
      "on each stay's final bill."
  );

  layout.subheading('Tax by supply');
  const supplyRow = (label, sac, taxable, cgst, sgst) => [
    label,
    sac,
    formatAmount(taxable),
    formatAmount(cgst),
    formatAmount(sgst),
    formatAmount(cgst + sgst),
  ];
  layout.table({
    columns: [
      { label: 'Supply', width: 160 },
      { label: 'SAC', width: 70 },
      { label: 'Taxable value', width: 110, align: 'right' },
      { label: 'CGST', width: 90, align: 'right' },
      { label: 'SGST', width: 90, align: 'right' },
      { label: 'Total tax', width: 100, align: 'right' },
    ],
    rows: [
      supplyRow('Accommodation', SAC.rooms, bills.roomTaxable, bills.roomCgst, bills.roomSgst),
      ...(report.servesFood ? [supplyRow('Food', SAC.food, bills.foodTaxable, bills.foodCgst, bills.foodSgst)] : []),
    ],
    // With one supply the totals row would restate the rooms row verbatim, so
    // it is only drawn when there is something to add up.
    totals: report.servesFood
      ? [
          'Total',
          '',
          formatAmount(bills.taxableValue),
          formatAmount(bills.cgstAmount),
          formatAmount(bills.sgstAmount),
          formatAmount(bills.totalTax),
        ]
      : null,
    fontSize: 8,
    rowHeight: 14,
  });

  // Split by the kind of document, which is what a return is filled in from:
  // a cash receipt carries no tax, and blending it with a tax invoice would
  // give a taxable value nobody can file.
  const docRow = (label, t) => [
    label,
    String(t.count),
    formatAmount(t.grossAmount),
    formatAmount(t.discountAmount),
    formatAmount(t.taxableValue),
    formatAmount(t.cgstAmount),
    formatAmount(t.sgstAmount),
    formatAmount(t.roundOff),
    formatAmount(t.totalAmount),
  ];
  const docRows = DOCUMENT_TYPES.filter((t) => summary.byDocumentType?.[t]?.count).map((t) =>
    docRow(DOCUMENT_TYPE_LABEL[t], summary.byDocumentType[t])
  );
  layout.subheading('By document type');
  layout.table({
    columns: [
      { label: 'Document', width: 120 },
      { label: 'Bills', width: 40, align: 'right' },
      { label: 'Gross', width: 82, align: 'right' },
      { label: 'Discount', width: 74, align: 'right' },
      { label: 'Taxable value', width: 90, align: 'right' },
      { label: 'CGST', width: 74, align: 'right' },
      { label: 'SGST', width: 74, align: 'right' },
      { label: 'Round off', width: 60, align: 'right' },
      { label: 'Billed total', width: 90, align: 'right' },
    ],
    rows: docRows.length ? docRows : [['No bills issued', '0', ...Array(7).fill(formatAmount(0))]],
    totals: docRows.length > 1 ? docRow('Total', bills) : null,
    fontSize: 8,
    rowHeight: 14,
  });

  layout.subheading('Settlement of these bills', { reserve: 90 });
  layout.equation([
    ['Billed total', formatAmount(bills.totalAmount)],
    ['Less: advance deducted on the bills', formatAmount(bills.advanceDeducted)],
    ['Less: balance collected on the bills', formatAmount(summary.stayBalance)],
    ['Balance still due', formatAmount(summary.stayBalanceDue), { result: true }],
  ]);
  layout.note(
    'The advance a bill deducted is the advance held when it was issued. Money received on these bills ' +
      'appears in part 2 only if it came in during this period.'
  );

  const pageCount = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(RULE).setLineWidth(0.5);
    pdf.line(MARGIN, pageHeight - MARGIN - 4, layout.right, pageHeight - MARGIN - 4);
    pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(MUTED);
    pdf.text(
      clip(
        pdf,
        `${name} · Booking report, ${period} · All amounts in Rs. · Cancelled bookings excluded from all money figures except cancellation charges kept.`,
        CONTENT_WIDTH - 80
      ),
      MARGIN,
      pageHeight - MARGIN + 6
    );
    pdf.text(`Page ${page} of ${pageCount}`, layout.right, pageHeight - MARGIN + 6, { align: 'right' });
  }

  return pdf.output('blob');
}

export async function downloadBookingReportPdf(report) {
  triggerDownload(await buildBookingReportPdf(report), reportFilename(report, 'pdf'));
}
