// Turning a booking report into a file an owner can keep — a CSV to open in
// Excel, or a PDF to file and share. Both are built from the same report
// payload the Bookings tab already has on screen, so what downloads is exactly
// what was displayed.

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Written as an escape, not the literal character — a bare U+FEFF in source is
// invisible and gets stripped by well-meaning editors.
const BOM = '\uFEFF';

// YYYY-MM-DD read as a calendar date, never shifted by the viewer's timezone.
function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

function formatAmount(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Matches the backend's rounding, so a figure this file derives from two
// server totals reads the same as one the server sent whole.
function round2(n) {
  return Math.round(n * 100) / 100;
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
  return `Booking-report-${period}.${extension}`;
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

// Quote every field rather than only the ones that need it: guest names carry
// commas and the odd stray quote, and a uniformly quoted row is one less thing
// to get wrong.
function csvCell(value) {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

// Room and food are separate supplies on separate SACs, so the halves are
// listed as well as the combined figure — that is the shape a CA needs, and
// the combined line is what the guest actually paid.
function taxPairs(tax) {
  return [
    ['Room subtotal', formatAmount(tax.roomSubtotal)],
    ['Food subtotal', formatAmount(tax.foodSubtotal)],
    ['CGST on rooms', formatAmount(tax.roomCgst)],
    ['SGST on rooms', formatAmount(tax.roomSgst)],
    ['CGST on food', formatAmount(tax.foodCgst)],
    ['SGST on food', formatAmount(tax.foodSgst)],
    ['Total CGST', formatAmount(tax.cgstAmount)],
    ['Total SGST', formatAmount(tax.sgstAmount)],
    ['Round off', formatAmount(tax.roundOff)],
    ['Invoice total', formatAmount(tax.totalAmount)],
  ];
}

export function downloadBookingReportCsv(report) {
  const { summary } = report;
  const lines = [
    csvRow([report.lodgeName || 'Booking report']),
    csvRow(['Booking report', reportPeriodLabel(report.fromDate, report.toDate)]),
    '',
    csvRow([
      'Bill no.',
      'Guest',
      'Phone',
      'Guests',
      'Room',
      'Category',
      'Check-in',
      'Check-out',
      'Nights',
      'Status',
      'Booked amount',
      'Advance',
      'Advance mode',
      'Room subtotal',
      'CGST',
      'SGST',
      'Round off',
      'Billed amount',
      'Balance collected',
      'Balance mode',
    ]),
  ];

  for (const b of report.bookings) {
    lines.push(
      csvRow([
        b.invoiceNumber || '',
        b.guestName,
        b.guestPhone,
        b.numGuests,
        b.roomNumber,
        b.categoryName,
        b.checkInDate,
        b.checkOutDate,
        b.nights,
        BOOKING_STATUS_LABEL[b.status] || b.status,
        b.totalPrice.toFixed(2),
        b.advanceAmount.toFixed(2),
        b.advancePaymentMethod ? PAYMENT_MODE_LABEL[b.advancePaymentMethod] : '',
        b.roomSubtotal != null ? b.roomSubtotal.toFixed(2) : '',
        b.cgstAmount != null ? b.cgstAmount.toFixed(2) : '',
        b.sgstAmount != null ? b.sgstAmount.toFixed(2) : '',
        b.roundOff != null ? b.roundOff.toFixed(2) : '',
        b.billedAmount != null ? b.billedAmount.toFixed(2) : '',
        b.balanceCollected != null ? b.balanceCollected.toFixed(2) : '',
        b.balancePaymentMethod ? PAYMENT_MODE_LABEL[b.balancePaymentMethod] : '',
      ])
    );
  }

  lines.push('');
  lines.push(csvRow(['Total bookings', summary.totalBookings]));
  for (const [status, label] of Object.entries(BOOKING_STATUS_LABEL)) {
    lines.push(csvRow([label, summary.byStatus[status] || 0]));
  }
  lines.push(csvRow(['Room nights', summary.roomNights]));
  lines.push(csvRow(['Booked value', summary.bookedValue.toFixed(2)]));
  lines.push(csvRow(['Billed amount', summary.billedAmount.toFixed(2)]));

  lines.push('');
  lines.push(csvRow(['PAYMENTS BY MODE']));
  lines.push(csvRow(['Mode', 'Advance', 'Balance', 'Total']));
  for (const mode of PAYMENT_MODES) {
    const t = summary.byPaymentMode[mode];
    lines.push(csvRow([PAYMENT_MODE_LABEL[mode], t.advance.toFixed(2), t.balance.toFixed(2), t.total.toFixed(2)]));
  }
  lines.push(
    csvRow([
      'Total',
      summary.advanceCollected.toFixed(2),
      summary.balanceCollected.toFixed(2),
      summary.totalCollected.toFixed(2),
    ])
  );

  lines.push('');
  lines.push(csvRow(['TAX — ISSUED BILLS ONLY']));
  for (const [label, value] of taxPairs(summary.tax)) lines.push(csvRow([label, value]));

  // A BOM, or Excel on Windows opens the file in the system codepage and
  // mangles every non-ASCII guest name.
  const blob = new Blob([BOM, `${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, reportFilename(report, 'csv'));
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
const COLUMNS = [
  { label: 'Bill no.', width: 78 },
  { label: 'Guest', width: 122 },
  { label: 'Phone', width: 64 },
  { label: 'Room', width: 40 },
  { label: 'Check-in', width: 54 },
  { label: 'Check-out', width: 54 },
  { label: 'Nights', width: 34, align: 'right' },
  { label: 'Guests', width: 38, align: 'right' },
  { label: 'Status', width: 56 },
  { label: 'Advance', width: 52, align: 'right' },
  { label: 'Mode', width: 40 },
  { label: 'CGST', width: 46, align: 'right' },
  { label: 'SGST', width: 46, align: 'right' },
  { label: 'Total', width: 58, align: 'right' },
];

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
  pdf.text(period, layout.right, y + 13, { align: 'right' });
  pdf.text(`Generated ${formatDateTime(report.generatedAt || Date.now())}`, layout.right, y + 24, {
    align: 'right',
  });

  y += 34;
  pdf.setDrawColor(INK).setLineWidth(1.2);
  pdf.line(MARGIN, y, layout.right, y);
  layout.y = y + 20;

  layout.heading('Summary');
  layout.tiles([
    ['Bookings', summary.totalBookings],
    ['Room nights', summary.roomNights],
    ['Booked value', formatAmount(summary.bookedValue)],
    ['Bills issued', summary.billedCount],
    ['Billed amount', formatAmount(summary.billedAmount)],
    ['Total collected', formatAmount(summary.totalCollected)],
  ]);
  layout.tiles([
    ...Object.entries(BOOKING_STATUS_LABEL).map(([status, label]) => [
      label,
      summary.byStatus[status] || 0,
    ]),
    ['Advance collected', formatAmount(summary.advanceCollected)],
    ['Balance collected', formatAmount(summary.balanceCollected)],
  ]);

  layout.heading('Payments by mode');
  layout.table({
    columns: [
      { label: 'Mode', width: 160 },
      { label: 'Advance', width: 130, align: 'right' },
      { label: 'Balance on checkout', width: 130, align: 'right' },
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
      'Total collected',
      formatAmount(summary.advanceCollected),
      formatAmount(summary.balanceCollected),
      formatAmount(summary.totalCollected),
      '',
    ],
    fontSize: 8,
    rowHeight: 14,
  });

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
      ['Food', formatAmount(tax.foodSubtotal), formatAmount(tax.foodCgst), formatAmount(tax.foodSgst), ''],
    ],
    totals: [
      'Total',
      formatAmount(round2(tax.roomSubtotal + tax.foodSubtotal)),
      formatAmount(tax.cgstAmount),
      formatAmount(tax.sgstAmount),
      '',
    ],
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

  if (report.bookings.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    pdf.text('No bookings arrived in this period.', MARGIN, layout.y);
    pdf.setTextColor(INK);
  } else {
    layout.table({
      columns: COLUMNS,
      rows: report.bookings.map((b) => [
        b.invoiceNumber || '—',
        b.guestName,
        b.guestPhone,
        b.roomNumber,
        formatDate(b.checkInDate),
        formatDate(b.checkOutDate),
        b.nights,
        b.numGuests,
        BOOKING_STATUS_LABEL[b.status] || b.status,
        b.advanceAmount ? formatAmount(b.advanceAmount) : '—',
        b.advancePaymentMethod ? PAYMENT_MODE_LABEL[b.advancePaymentMethod] : '—',
        formatAmount(b.cgstAmount),
        formatAmount(b.sgstAmount),
        formatAmount(b.billedAmount != null ? b.billedAmount : b.totalPrice),
      ]),
      // Only the columns that legitimately sum are totalled. Nights and the
      // money columns add up; a column of phone numbers does not.
      totals: [
        'Total',
        '',
        '',
        '',
        '',
        '',
        summary.roomNights,
        '',
        '',
        formatAmount(summary.advanceCollected),
        '',
        formatAmount(tax.cgstAmount),
        formatAmount(tax.sgstAmount),
        formatAmount(summary.billedAmount),
      ],
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
