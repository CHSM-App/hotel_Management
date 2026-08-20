// Turning a booking report into a file an owner can keep — an Excel workbook
// to sort and total, or a PDF to print and file. Both are built from the same
// report payload the Bookings tab already has on screen, so what downloads is
// exactly what was displayed.

export const BOOKING_STATUS_LABEL = {
  BOOKED: 'Booked',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
};

export const PAYMENT_MODE_LABEL = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  UNRECORDED: 'Not recorded',
};

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'UNRECORDED'];

// Which side of the book a report covers. Two downloads of the same month can
// hold completely different rows, so the choice is stamped on the document and
// into the filename — otherwise they are indistinguishable once saved.
export const BILLING_SIDE_OPTIONS = [
  { key: 'ALL', label: 'All bills', short: 'All' },
  { key: 'GST', label: 'GST bills only', short: 'GST' },
  { key: 'NON_GST', label: 'Non-GST bills only', short: 'Non-GST' },
];

function billingSideOption(billingSide) {
  return BILLING_SIDE_OPTIONS.find((o) => o.key === billingSide) || BILLING_SIDE_OPTIONS[0];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// YYYY-MM-DD read as a calendar date, never shifted by the viewer's timezone.
function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

function formatAmount(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// An actual arrival/departure stamp against the date it was booked for. Nearly
// always the same day, so the time alone is enough; a late checkout that rolls
// past midnight gets its date spelled out rather than silently reading as an
// impossibly early departure. 24-hour clock — compact, and unambiguous on a
// document someone may read months later.
function formatActualStamp(value, plannedDateIso) {
  if (!value) return '—';
  const d = new Date(value);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const onDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (onDate === plannedDateIso) return time;
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${time}`;
}

// A real timestamp, unlike the plain calendar dates above — shown in the
// viewer's own time so "generated at" means what they expect.
function formatDateTime(value) {
  const d = new Date(value);
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${time}`;
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

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Room and food are separate supplies on separate SACs, so a property that
// serves both gets the halves listed as well as the combined figure — that is
// the shape a CA needs. A rooms-only lodge has one supply: splitting it would
// print a column of zeroes and repeat the same number under three headings.
// Each entry is [label, displayString, rawNumber] — the PDF wants the string,
// the workbook wants the number so the cell can be summed.
function taxPairs(tax, servesFood) {
  const pair = (label, value) => [label, formatAmount(value), value];
  if (!servesFood) {
    return [
      pair('Subtotal before tax', tax.taxableValue),
      pair('CGST', tax.cgstAmount),
      pair('SGST', tax.sgstAmount),
      pair('Round off', tax.roundOff),
      pair('Invoice total', tax.totalAmount),
    ];
  }
  return [
    pair('Room subtotal', tax.roomSubtotal),
    pair('Food subtotal', tax.foodSubtotal),
    pair('Subtotal before tax', tax.taxableValue),
    pair('CGST on rooms', tax.roomCgst),
    pair('SGST on rooms', tax.roomSgst),
    pair('CGST on food', tax.foodCgst),
    pair('SGST on food', tax.foodSgst),
    pair('Total CGST', tax.cgstAmount),
    pair('Total SGST', tax.sgstAmount),
    pair('Round off', tax.roundOff),
    pair('Invoice total', tax.totalAmount),
  ];
}

// Column definitions rather than two parallel arrays: the header and the row
// are projected from one list, so a conditional column cannot shift the values
// out from under the headings.
function detailColumns(servesFood) {
  const money = (n) => (n != null ? n.toFixed(2) : '');
  return [
    { label: 'Bill no.', width: 20, value: (b) => b.invoiceNumber || '' },
    { label: 'Guest', width: 28, value: (b) => b.guestName },
    { label: 'Phone', width: 15, value: (b) => b.guestPhone },
    { label: 'Guests', width: 8, value: (b) => b.numGuests },
    { label: 'Room', width: 8, value: (b) => b.roomNumber },
    { label: 'Category', width: 16, value: (b) => b.categoryName },
    { label: 'Check-in', width: 12, value: (b) => b.checkInDate },
    { label: 'Check-out', width: 12, value: (b) => b.checkOutDate },
    { label: 'Actual check-in', width: 22, value: (b) => (b.actualCheckInAt ? formatDateTime(b.actualCheckInAt) : '') },
    { label: 'Actual check-out', width: 22, value: (b) => (b.actualCheckOutAt ? formatDateTime(b.actualCheckOutAt) : '') },
    { label: 'Nights', width: 8, value: (b) => b.nights },
    { label: 'Status', width: 13, value: (b) => BOOKING_STATUS_LABEL[b.status] || b.status },
    { label: 'Booked amount', width: 15, value: (b) => b.totalPrice.toFixed(2) },
    { label: 'Advance', width: 12, value: (b) => b.advanceAmount.toFixed(2) },
    {
      // A mode is only meaningful next to money that moved — a booking with no
      // advance reads "0.00, Cash" otherwise, implying a payment.
      label: 'Advance mode',
      width: 14,
      value: (b) => (b.advanceAmount && b.advancePaymentMethod ? PAYMENT_MODE_LABEL[b.advancePaymentMethod] : ''),
    },
    // Room and food subtotals only earn their place when both supplies exist;
    // otherwise the room subtotal and the taxable subtotal are the same number.
    ...(servesFood
      ? [
          { label: 'Room subtotal', width: 15, value: (b) => money(b.roomSubtotal) },
          { label: 'Food subtotal', width: 15, value: (b) => money(b.foodSubtotal) },
        ]
      : []),
    { label: 'Subtotal before tax', width: 18, value: (b) => money(b.subtotal) },
    { label: 'CGST', width: 12, value: (b) => money(b.cgstAmount) },
    { label: 'SGST', width: 12, value: (b) => money(b.sgstAmount) },
    { label: 'Round off', width: 11, value: (b) => money(b.roundOff) },
    { label: 'Billed amount', width: 15, value: (b) => money(b.billedAmount) },
    { label: 'Balance collected', width: 17, value: (b) => money(b.balanceCollected) },
    {
      label: 'Balance mode',
      width: 14,
      value: (b) => (b.balancePaymentMethod ? PAYMENT_MODE_LABEL[b.balancePaymentMethod] : ''),
    },
  ];
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

const MONEY = '#,##0.00';
const HEADER_FILL = '#E8E8E8';

const bold = (value, extra = {}) => ({ value, fontWeight: 'bold', ...extra });
const text = (value) => ({ value: value === '' ? null : value });
// Written as a real number, not a formatted string: this is the whole point of
// an .xlsx over a .csv — the column can be summed, sorted and charted in Excel.
const money = (value) => ({ value: value ?? null, type: Number, format: MONEY, align: 'right' });
const count = (value) => ({ value: value ?? null, type: Number, align: 'right' });
const sectionRow = (title) => [bold(title, { backgroundColor: HEADER_FILL })];
const headerRow = (labels) =>
  labels.map((label) => bold(label, { backgroundColor: HEADER_FILL, wrap: true }));

// Money columns come through the CSV column definitions as fixed-2 strings so
// the same list can serve both. In the workbook they have to go back to being
// numbers, which is what these labels identify.
const MONEY_COLUMNS = new Set([
  'Booked amount',
  'Advance',
  'Room subtotal',
  'Food subtotal',
  'Subtotal before tax',
  'CGST',
  'SGST',
  'Round off',
  'Billed amount',
  'Balance collected',
]);
const COUNT_COLUMNS = new Set(['Guests', 'Nights']);

function summarySheet(report) {
  const { summary } = report;
  const rows = [
    [bold(report.lodgeName || 'Booking report', { fontSize: 14 })],
    [bold('Booking report'), text(reportPeriodLabel(report.fromDate, report.toDate))],
    [bold('Bills included'), text(billingSideOption(report.billingSide).label)],
    [bold('Generated'), text(formatDateTime(report.generatedAt || Date.now()))],
    [],
    // Money first, same order as the PDF, so the two read alike.
    sectionRow('MONEY RECEIVED'),
    [bold('Advances'), money(summary.advanceCollected)],
    [bold('Final payments'), money(summary.balanceCollected)],
    [bold('Total received'), money(summary.totalCollected)],
    [
      text(
        'Counted on the day the money came in — an advance on its booking date, a final payment on its bill date. ' +
          'Cancelled stays are excluded from every figure in this report.'
      ),
    ],
    [],
    headerRow(['Mode', 'Advances', 'Final payments', 'Total']),
  ];

  for (const mode of PAYMENT_MODES) {
    const t = summary.byPaymentMode[mode];
    rows.push([bold(PAYMENT_MODE_LABEL[mode]), money(t.advance), money(t.balance), money(t.total)]);
  }
  rows.push([
    bold('Total received'),
    { ...money(summary.advanceCollected), fontWeight: 'bold' },
    { ...money(summary.balanceCollected), fontWeight: 'bold' },
    { ...money(summary.totalCollected), fontWeight: 'bold' },
  ]);

  // Which stay the money was for — see the PDF's copy of this table.
  const stayPeriods = summary.collections?.byStayPeriod;
  if (stayPeriods) {
    rows.push([]);
    rows.push(headerRow(['Money received was for', 'Advances', 'Final payments', 'Total']));
    for (const [key, label] of [
      ['EARLIER', 'Stays before this period'],
      ['THIS', 'Stays in this period'],
      ['LATER', 'Stays after this period'],
    ]) {
      const t = stayPeriods[key];
      rows.push([bold(label), money(t.advance), money(t.balance), money(t.total)]);
    }
    rows.push([
      bold('Total received'),
      { ...money(summary.advanceCollected), fontWeight: 'bold' },
      { ...money(summary.balanceCollected), fontWeight: 'bold' },
      { ...money(summary.totalCollected), fontWeight: 'bold' },
    ]);
  }

  // Stay counts and values. The advance and balance attached to these stays are
  // the register sheet's own columns, and are not repeated here.
  rows.push([]);
  rows.push(sectionRow('STAYS CHECKING IN THIS PERIOD'));
  rows.push([bold('Total bookings'), count(summary.totalBookings)]);
  for (const [status, label] of Object.entries(BOOKING_STATUS_LABEL)) {
    rows.push([bold(label), count(summary.byStatus[status] || 0)]);
  }
  rows.push([bold('Room nights'), count(summary.roomNights)]);
  rows.push([bold('Booked value'), money(summary.bookedValue)]);
  rows.push([bold('Bills issued'), count(summary.billedCount)]);
  rows.push([bold('Billed amount'), money(summary.billedAmount)]);
  if (summary.cancelled?.count) {
    rows.push([]);
    rows.push([bold('Cancelled bookings'), count(summary.cancelled.count)]);
    rows.push([bold('— value not counted'), money(summary.cancelled.bookedValue)]);
    rows.push([bold('— advances not counted'), money(summary.cancelled.advanceHeld)]);
  }

  rows.push([]);
  rows.push(sectionRow('TAX — ISSUED BILLS ONLY'));
  for (const [label, , raw] of taxPairs(summary.tax, report.servesFood)) {
    rows.push([bold(label), money(raw)]);
  }

  return {
    data: rows,
    sheet: 'Summary',
    columns: [{ width: 26 }, { width: 18 }, { width: 18 }, { width: 18 }],
  };
}

function bookingsSheet(report) {
  const columns = detailColumns(report.servesFood);
  const rows = [headerRow(columns.map((c) => c.label))];

  for (const b of report.bookings) {
    rows.push(
      columns.map((column) => {
        const raw = column.value(b);
        if (MONEY_COLUMNS.has(column.label)) {
          return money(raw === '' || raw === null ? null : Number(raw));
        }
        if (COUNT_COLUMNS.has(column.label)) return count(raw);
        return text(raw);
      })
    );
  }

  return {
    data: rows,
    sheet: 'Bookings',
    // Freeze the header so the labels stay put while an owner scrolls a
    // month's worth of rows — the reason the labels are bold in the first place.
    stickyRowsCount: 1,
    columns: columns.map((c) => ({ width: c.width || 16 })),
  };
}

export async function downloadBookingReportExcel(report) {
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

// Landscape A4 (842 x 595pt): the register carries fourteen columns once the
// tax and payment detail is on it, and portrait would force either a wrapped
// row or unreadable type.
const MARGIN = 30;
const CONTENT_WIDTH = 842 - MARGIN * 2;

// Greys, not colours — this is a document that gets printed, often on a mono
// laser, and a tint that survives that is worth more than a brand hue.
const INK = 25;
const MUTED = 115;
const RULE = 170;
const BAND = 238;
const ZEBRA = 247;

// Bill number leads: it is the document reference an owner files and searches
// by. The internal booking id is deliberately absent — it is never shown
// anywhere in the app, so it identifies nothing an owner could look up. A row
// with no bill yet is identified by guest, room and dates instead.
// Widths are absolute points and must total CONTENT_WIDTH exactly. "In at" and
// "Out at" carry the actual arrival/departure clock time beside the dates the
// stay was booked for, so a late arrival or an overstay is visible on the row
// rather than only in the billing screen.
const COLUMNS = [
  { label: 'Bill no.', width: 70 },
  { label: 'Guest', width: 84 },
  { label: 'Room', width: 34 },
  { label: 'Check-in', width: 51 },
  { label: 'In at', width: 53 },
  { label: 'Check-out', width: 51 },
  { label: 'Out at', width: 53 },
  { label: 'Nights', width: 34, align: 'right' },
  { label: 'Guests', width: 36, align: 'right' },
  { label: 'Status', width: 54 },
  { label: 'Advance', width: 44, align: 'right' },
  { label: 'Mode', width: 34 },
  // Subtotal sits immediately before the tax pair so the row reads as the bill
  // does: taxable value, then what was charged on it, then the total.
  { label: 'Subtotal', width: 48, align: 'right' },
  { label: 'CGST', width: 44, align: 'right' },
  { label: 'SGST', width: 44, align: 'right' },
  { label: 'Total', width: 48, align: 'right' },
];

const TOTALS_BY_COLUMN = (summary, tax) => ({
  'Bill no.': 'Total',
  Nights: summary.roomNights,
  // Foots the Advance column of the rows above it, so it must be the advance
  // attached to these stays — not the period's cash-basis advance total, which
  // covers a different set of bookings entirely.
  Advance: formatAmount(summary.stayAdvance),
  Subtotal: formatAmount(tax.taxableValue),
  CGST: formatAmount(tax.cgstAmount),
  SGST: formatAmount(tax.sgstAmount),
  Total: formatAmount(summary.billedAmount),
});

// jsPDF's built-in fonts have no glyph fallback, so an over-long guest name
// has to be clipped by measured width rather than character count.
function clip(pdf, text, width) {
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
function createLayout(pdf, runningHead) {
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
    heading(text) {
      layout.ensure(30);
      pdf.setFont('helvetica', 'bold').setFontSize(9).setTextColor(INK);
      pdf.text(text.toUpperCase(), MARGIN, y);
      y += 4;
      pdf.setDrawColor(INK).setLineWidth(0.8);
      pdf.line(MARGIN, y, right, y);
      y += 13;
      pdf.setFont('helvetica', 'normal');
    },
    // A line of explanation under a heading. Used where a section is counted on
    // a different basis to the one above it and would otherwise read as a
    // discrepancy — the reader has to be told, on the page, which is which.
    note(text) {
      const lines = pdf.splitTextToSize(text, CONTENT_WIDTH);
      layout.ensure(lines.length * 9 + 6);
      pdf.setFont('helvetica', 'italic').setFontSize(7).setTextColor(MUTED);
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
        pdf.text(label.toUpperCase(), x, top);
        pdf.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK);
        pdf.text(clip(pdf, String(value), tileWidth - 8), x, top + 12);
      });
      y += rows * 30 + 2;
      pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(INK);
    },
    table({ columns, rows, totals, fontSize = 7.5, rowHeight = 13, zebra = true }) {
      const paint = (cells, { bold = false, fill = null } = {}) => {
        if (fill !== null) {
          pdf.setFillColor(fill);
          pdf.rect(MARGIN, y - rowHeight + 4, CONTENT_WIDTH, rowHeight, 'F');
        }
        pdf.setFont('helvetica', bold ? 'bold' : 'normal').setTextColor(INK);
        let x = MARGIN;
        columns.forEach((column, i) => {
          const text = clip(pdf, cells[i], column.width - 8);
          if (column.align === 'right') pdf.text(text, x + column.width - 5, y, { align: 'right' });
          else pdf.text(text, x + 4, y);
          x += column.width;
        });
      };

      const columnHeader = () => {
        y += rowHeight - 4;
        pdf.setFillColor(BAND);
        pdf.rect(MARGIN, y - rowHeight + 4, CONTENT_WIDTH, rowHeight, 'F');
        pdf.setFontSize(fontSize);
        paint(
          columns.map((c) => c.label),
          { bold: true }
        );
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
        y += rowHeight;
      });

      if (totals) {
        if (y > bottom - rowHeight) {
          layout.newPage();
          pdf.setFontSize(fontSize);
          columnHeader();
        }
        pdf.setDrawColor(RULE).setLineWidth(0.6);
        pdf.line(MARGIN, y - rowHeight + 3, right, y - rowHeight + 3);
        paint(totals, { bold: true });
        y += rowHeight;
      }
      y += 8;
    },
  };

  return layout;
}

export async function downloadBookingReportPdf(report) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const pageHeight = pdf.internal.pageSize.getHeight();
  const { summary } = report;
  const tax = summary.tax;
  const period = reportPeriodLabel(report.fromDate, report.toDate);
  const name = report.lodgeName || 'Booking report';
  const layout = createLayout(pdf, `${name} — booking report, ${period}`);

  // Masthead: the property on the left, what the document is on the right.
  let y = MARGIN + 4;
  pdf.setFont('helvetica', 'bold').setFontSize(16).setTextColor(INK);
  pdf.text(clip(pdf, name, CONTENT_WIDTH - 220), MARGIN, y);
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
  layout.y = y + 20;

  // Money you received, first and on its own — it is the number an owner opens
  // the report for. One line of plain English says what dates it counts on; the
  // detail of why lives in the mode table's own columns, not in a paragraph.
  layout.heading('Money received');
  layout.tiles(
    [
      ['Advances', formatAmount(summary.advanceCollected)],
      ['Final payments', formatAmount(summary.balanceCollected)],
      ['Total received', formatAmount(summary.totalCollected)],
    ],
    3
  );
  layout.note(
    'Counted on the day the money came in — an advance on its booking date, a final payment on its ' +
      'bill date. Cancelled stays are excluded' +
      (summary.cancelled?.advanceHeld
        ? `, including ${formatAmount(summary.cancelled.advanceHeld)} of advances taken on ` +
          `${summary.cancelled.count} cancelled ${summary.cancelled.count === 1 ? 'booking' : 'bookings'}` +
          ' — refunds are not tracked, so that money is not reported as income here.'
        : '.')
  );

  // Which stay each rupee was for. An owner reading a single advances figure
  // cannot tell how much of it is this month's business and how much is money
  // held for stays that have not happened yet — the two behave completely
  // differently at month end, and the gap between them is what reads as a
  // mismatch against the stay figures below.
  const stayPeriods = summary.collections?.byStayPeriod;
  if (stayPeriods) {
    const periodRow = (key, label) => [
      label,
      formatAmount(stayPeriods[key].advance),
      formatAmount(stayPeriods[key].balance),
      formatAmount(stayPeriods[key].total),
      '',
    ];
    layout.table({
      columns: [
        { label: 'Money received was for', width: 200 },
        { label: 'Advances', width: 120, align: 'right' },
        { label: 'Final payments', width: 120, align: 'right' },
        { label: 'Total', width: 120, align: 'right' },
        { label: '', width: 192 },
      ],
      rows: [
        periodRow('EARLIER', 'Stays before this period'),
        periodRow('THIS', 'Stays in this period'),
        periodRow('LATER', 'Stays after this period'),
      ],
      totals: [
        'Total received',
        formatAmount(summary.advanceCollected),
        formatAmount(summary.balanceCollected),
        formatAmount(summary.totalCollected),
        '',
      ],
      fontSize: 8,
      rowHeight: 14,
    });
  }

  layout.table({
    columns: [
      { label: 'Mode', width: 160 },
      { label: 'Advances', width: 130, align: 'right' },
      { label: 'Final payments', width: 130, align: 'right' },
      { label: 'Total', width: 130, align: 'right' },
      { label: '', width: 232 },
    ],
    rows: PAYMENT_MODES.map((mode) => [
      PAYMENT_MODE_LABEL[mode],
      formatAmount(summary.byPaymentMode[mode].advance),
      formatAmount(summary.byPaymentMode[mode].balance),
      formatAmount(summary.byPaymentMode[mode].total),
      '',
    ]),
    totals: [
      'Total received',
      formatAmount(summary.advanceCollected),
      formatAmount(summary.balanceCollected),
      formatAmount(summary.totalCollected),
      '',
    ],
    fontSize: 8,
    rowHeight: 14,
  });

  // The stays themselves — counts and what they were worth. The advance and
  // balance attached to them are deliberately not repeated here: they are the
  // register's own columns, footed at the bottom of it, and a second copy under
  // a heading that means something subtly different is what made this confusing.
  layout.heading('Stays checking in this period');
  layout.tiles([
    ['Bookings', summary.totalBookings],
    ...Object.entries(BOOKING_STATUS_LABEL).map(([status, label]) => [
      label,
      summary.byStatus[status] || 0,
    ]),
    ['Room nights', summary.roomNights],
  ]);
  layout.tiles(
    [
      ['Booked value', formatAmount(summary.bookedValue)],
      ['Bills issued', summary.billedCount],
      ['Billed amount', formatAmount(summary.billedAmount)],
    ],
    3
  );
  // The cancelled count above is a count, not money — so the value they would
  // have brought in is named here explicitly. Otherwise "Cancelled 3" sits next
  // to a booked value that quietly does not include them.
  if (summary.cancelled?.count) {
    layout.note(
      `Booked value excludes ${summary.cancelled.count} cancelled ` +
        `${summary.cancelled.count === 1 ? 'booking' : 'bookings'} worth ` +
        `${formatAmount(summary.cancelled.bookedValue)}. Cancelled stays are counted above but ` +
        'contribute no money to this report.'
    );
  }

  layout.heading('Tax charged — issued bills only');
  layout.table({
    columns: [
      { label: 'Supply', width: 160 },
      { label: 'Taxable value', width: 130, align: 'right' },
      { label: 'CGST', width: 130, align: 'right' },
      { label: 'SGST', width: 130, align: 'right' },
      { label: '', width: 232 },
    ],
    rows: [
      ['Rooms', formatAmount(tax.roomSubtotal), formatAmount(tax.roomCgst), formatAmount(tax.roomSgst), ''],
      ...(report.servesFood
        ? [['Food', formatAmount(tax.foodSubtotal), formatAmount(tax.foodCgst), formatAmount(tax.foodSgst), '']]
        : []),
    ],
    // With one supply the totals row would restate the rooms row verbatim, so
    // it is only drawn when there is something to add up.
    totals: report.servesFood
      ? ['Total', formatAmount(tax.taxableValue), formatAmount(tax.cgstAmount), formatAmount(tax.sgstAmount), '']
      : null,
    fontSize: 8,
    rowHeight: 14,
  });

  layout.ensure(20);
  pdf.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED);
  pdf.text(
    `Round off ${formatAmount(tax.roundOff)}   ·   Invoice total ${formatAmount(tax.totalAmount)}`,
    MARGIN,
    layout.y
  );
  layout.y += 20;
  pdf.setTextColor(INK);

  // The register starts on its own page: it is the part that gets printed and
  // filed, and it should not begin three rows above a page break.
  layout.newPage();
  layout.heading(`Booking register — ${report.bookings.length} bookings`);
  if (summary.cancelled?.count) {
    layout.note(
      'Cancelled bookings are listed for the record with their money columns left blank — they are ' +
        'excluded from every total in this report.'
    );
  }

  if (report.bookings.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    pdf.text('No bookings arrived in this period.', MARGIN, layout.y);
    pdf.setTextColor(INK);
  } else {
    layout.table({
      columns: COLUMNS,
      // A cancelled stay is listed — an owner wants to see it happened — but
      // carries no money on its row. Its nights and its advance are excluded
      // from every total in this report, so printing them in the columns would
      // leave an Advance column that visibly does not add up to its own total.
      rows: report.bookings.map((b) => {
        const isCancelled = b.status === 'CANCELLED';
        return [
          b.invoiceNumber || '—',
          b.guestName,
          b.roomNumber,
          formatDate(b.checkInDate),
          formatActualStamp(b.actualCheckInAt, b.checkInDate),
          formatDate(b.checkOutDate),
          formatActualStamp(b.actualCheckOutAt, b.checkOutDate),
          isCancelled ? '—' : b.nights,
          b.numGuests,
          BOOKING_STATUS_LABEL[b.status] || b.status,
          !isCancelled && b.advanceAmount ? formatAmount(b.advanceAmount) : '—',
          !isCancelled && b.advanceAmount && b.advancePaymentMethod
            ? PAYMENT_MODE_LABEL[b.advancePaymentMethod]
            : '—',
          isCancelled ? '—' : formatAmount(b.subtotal),
          isCancelled ? '—' : formatAmount(b.cgstAmount),
          isCancelled ? '—' : formatAmount(b.sgstAmount),
          isCancelled ? '—' : formatAmount(b.billedAmount != null ? b.billedAmount : b.totalPrice),
        ];
      }),
      // Only the columns that legitimately sum are totalled — nights and the
      // money columns add up, a column of phone numbers does not. Keyed by
      // label and projected through COLUMNS so adding or reordering a column
      // can never silently slide the totals under the wrong headings.
      totals: COLUMNS.map((column) => TOTALS_BY_COLUMN(summary, tax)[column.label] ?? ''),
    });
  }

  const pageCount = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(RULE).setLineWidth(0.5);
    pdf.line(MARGIN, pageHeight - MARGIN - 4, layout.right, pageHeight - MARGIN - 4);
    pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(MUTED);
    pdf.text('All amounts in Rs. Unbilled stays show their booked price.', MARGIN, pageHeight - MARGIN + 6);
    pdf.text(`Page ${page} of ${pageCount}`, layout.right, pageHeight - MARGIN + 6, { align: 'right' });
  }

  triggerDownload(pdf.output('blob'), reportFilename(report, 'pdf'));
}
