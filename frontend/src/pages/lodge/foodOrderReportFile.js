// Turning a food orders report into a file an owner can keep — an Excel
// workbook to sort and total, or a PDF to print and file. Mirrors
// bookingReportFile.js / eventReportFile.js: built from the same report
// payload the Food orders tab already has on screen, so what downloads is
// exactly what was displayed.

export const ORDER_STATUS_LABEL = {
  PENDING: 'Pending',
  QUEUED: 'Queued',
  PREPARING: 'Preparing',
  READY: 'Ready',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

const ORDER_STATUSES = ['PENDING', 'QUEUED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'];

export const ORDER_SOURCE_LABEL = {
  ROOM: 'Room',
  TABLE: 'Table',
  COUNTER: 'Counter',
};

const ORDER_SOURCES = ['ROOM', 'TABLE', 'COUNTER'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

function formatAmount(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function formatDateTime(value) {
  const d = new Date(value);
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${time}`;
}

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
  return `Food-orders-report-${period}.${extension}`;
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

function placeOf(order) {
  return order.roomNumber || order.tableLabel || '—';
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

const MONEY = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';
const HEADER_FILL = '#E8E8E8';
const NOTE_COLOR = '#555555';

const bold = (value, extra = {}) => ({ value, fontWeight: 'bold', ...extra });
const text = (value) => ({ value: value === '' ? null : value });
const note = (value) => ({ value, color: NOTE_COLOR, fontStyle: 'italic', wrap: true });
const money = (value) => ({ value: value ?? null, type: Number, format: MONEY, align: 'right' });
const count = (value) => ({ value: value ?? null, type: Number, align: 'right' });
const sectionRow = (title) => [bold(title, { backgroundColor: HEADER_FILL })];
const headerRow = (labels) =>
  labels.map((label) => bold(label, { backgroundColor: HEADER_FILL, wrap: true }));
const totalsRow = (cells) => cells.map((c) => ({ ...c, fontWeight: 'bold' }));

function summarySheet(report) {
  const { summary } = report;
  const period = reportPeriodLabel(report.fromDate, report.toDate);
  const rows = [
    [bold(report.lodgeName || 'Food orders report', { fontSize: 14 })],
    [bold('Food orders report'), text(period)],
    [bold('Generated'), text(formatDateTime(report.generatedAt || Date.now()))],
    [],
    [
      note(
        'An order is counted on the calendar day it was placed on. Delivered and cancelled orders are both ' +
          'counted; a live order still in the kitchen queue when this report is pulled counts too, under ' +
          'whatever status it is currently in.'
      ),
    ],
    [],
    sectionRow(`ORDERS PLACED IN ${period.toUpperCase()}`),
    [bold('Total orders'), count(summary.totalOrders)],
  ];
  for (const status of ORDER_STATUSES) {
    rows.push([text(`  ${ORDER_STATUS_LABEL[status]}`), count(summary.byStatus[status] || 0)]);
  }
  rows.push([]);
  rows.push(headerRow(['By source', 'Count']));
  for (const source of ORDER_SOURCES) {
    rows.push([text(ORDER_SOURCE_LABEL[source]), count(summary.bySource[source] || 0)]);
  }
  rows.push([]);
  rows.push(sectionRow('VALUE'));
  rows.push([bold('Delivered — count'), count(summary.deliveredCount)]);
  rows.push([bold('Delivered — value'), money(summary.deliveredValue)]);
  rows.push([bold('Billed — count'), count(summary.billedCount)]);
  rows.push([bold('Billed — value'), money(summary.billedValue)]);
  rows.push([bold('Delivered but not yet billed'), money(summary.unbilledDeliveredValue)]);
  rows.push([bold('Cancelled — count'), count(summary.cancelledCount)]);

  return {
    data: rows,
    sheet: 'Summary',
    columns: [{ width: 30 }, { width: 16 }],
  };
}

function ordersSheet(report) {
  const columns = [
    { label: 'Order no.', width: 12, value: (o) => `#${o.orderNumber}` },
    { label: 'Placed at', width: 20, value: (o) => formatDateTime(o.placedAt) },
    { label: 'Source', width: 12, value: (o) => ORDER_SOURCE_LABEL[o.source] || o.source },
    { label: 'Room/Table', width: 12, value: (o) => placeOf(o) },
    { label: 'Guest', width: 20, value: (o) => o.guestName || '' },
    { label: 'Phone', width: 14, value: (o) => o.guestPhone || '' },
    { label: 'Items', width: 8, kind: 'count', value: (o) => o.itemCount },
    { label: 'Status', width: 12, value: (o) => ORDER_STATUS_LABEL[o.status] || o.status },
    { label: 'Delivered at', width: 20, value: (o) => (o.deliveredAt ? formatDateTime(o.deliveredAt) : '') },
    { label: 'Cancelled at', width: 20, value: (o) => (o.cancelledAt ? formatDateTime(o.cancelledAt) : '') },
    { label: 'Bill no.', width: 12, value: (o) => o.invoiceNumber || '' },
    { label: 'Document', width: 14, value: (o) => o.documentType || '' },
    { label: 'Amount', width: 12, kind: 'money', value: (o) => o.subtotal },
  ];
  const rows = [headerRow(columns.map((c) => c.label))];

  for (const o of report.orders) {
    rows.push(
      columns.map((column) => {
        const raw = column.value(o);
        if (column.kind === 'money') return money(raw);
        if (column.kind === 'count') return count(raw);
        return text(raw);
      })
    );
  }

  // Cancelled orders are listed for the record but never billed, so their
  // subtotal is excluded from the footed total — matching the summary's
  // deliveredValue/billedValue, which also never counts a cancelled order.
  const totals = {
    'Order no.': bold('Total'),
    Amount: money(
      report.orders.reduce((sum, o) => (o.status === 'CANCELLED' ? sum : sum + Number(o.subtotal || 0)), 0)
    ),
  };
  rows.push(totalsRow(columns.map((c) => totals[c.label] ?? text(''))));

  return {
    data: rows,
    sheet: 'Orders',
    stickyRowsCount: 1,
    columns: columns.map((c) => ({ width: c.width || 16 })),
  };
}

export async function downloadFoodOrdersReportExcel(report) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const workbook = await writeXlsxFile([summarySheet(report), ordersSheet(report)], {
    fontFamily: 'Calibri',
    fontSize: 11,
  });
  triggerDownload(await workbook.toBlob(), reportFilename(report, 'xlsx'));
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

// Portrait A4 is plenty here — the register carries far fewer columns than
// the booking report's, none of them tax figures.
const MARGIN = 24;
const CONTENT_WIDTH = 595 - MARGIN * 2;

const INK = 25;
const MUTED = 115;
const RULE = 170;
const BAND = 238;
const ZEBRA = 247;

const REGISTER_COLUMNS = [
  { label: 'Order', width: 40 },
  { label: 'Placed', width: 90 },
  { label: 'Source', width: 46 },
  { label: 'Room/Tbl', width: 48 },
  { label: 'Guest', width: 90 },
  { label: 'Items', width: 32, align: 'right' },
  { label: 'Status', width: 54 },
  { label: 'Bill no.', width: 48 },
  { label: 'Amount', width: 49, align: 'right' },
];

function clip(pdf, text, width) {
  const value = String(text ?? '');
  if (!value) return '';
  if (pdf.getTextWidth(value) <= width) return value;
  let end = value.length;
  while (end > 1 && pdf.getTextWidth(`${value.slice(0, end)}…`) > width) end -= 1;
  return `${value.slice(0, end)}…`;
}

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
    ensure(height) {
      if (y + height > bottom) layout.newPage();
    },
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
    subheading(text, { reserve = 40 } = {}) {
      layout.ensure(14 + reserve);
      pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(INK);
      pdf.text(text, MARGIN, y);
      y += 6;
      pdf.setFont('helvetica', 'normal');
    },
    note(text, { width = CONTENT_WIDTH } = {}) {
      pdf.setFont('helvetica', 'italic').setFontSize(7);
      const lines = pdf.splitTextToSize(text, width);
      layout.ensure(lines.length * 9 + 6);
      pdf.setTextColor(MUTED);
      pdf.text(lines, MARGIN, y);
      y += lines.length * 9 + 6;
      pdf.setFont('helvetica', 'normal').setTextColor(INK);
    },
    tiles(entries, perRow = 3) {
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
    table({ columns, rows, totals, fontSize = 7.5, rowHeight = 13, zebra = true }) {
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

      const columnHeader = () => {
        y += rowHeight - 4;
        pdf.setFillColor(BAND);
        pdf.rect(MARGIN, y - rowHeight + 4, width, rowHeight, 'F');
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
        pdf.line(MARGIN, y - rowHeight + 3, MARGIN + width, y - rowHeight + 3);
        paint(totals, { bold: true });
        y += rowHeight;
      }
      y += 8;
    },
  };

  return layout;
}

export async function buildFoodOrdersReportPdf(report) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pageHeight = pdf.internal.pageSize.getHeight();
  const { summary } = report;
  const period = reportPeriodLabel(report.fromDate, report.toDate);
  const name = report.lodgeName || 'Food orders report';
  const layout = createLayout(pdf, `${name} — food orders report, ${period}`);

  let y = MARGIN + 4;
  pdf.setFont('helvetica', 'bold').setFontSize(16).setTextColor(INK);
  pdf.text(clip(pdf, name, CONTENT_WIDTH - 200), MARGIN, y);

  pdf.setFont('helvetica', 'bold').setFontSize(11).setTextColor(INK);
  pdf.text('FOOD ORDERS REPORT', layout.right, y, { align: 'right' });
  pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
  pdf.text(period, layout.right, y + 13, { align: 'right' });
  pdf.text(`Generated ${formatDateTime(report.generatedAt || Date.now())}`, layout.right, y + 24, {
    align: 'right',
  });

  y += 34;
  pdf.setDrawColor(INK).setLineWidth(1.2);
  pdf.line(MARGIN, y, layout.right, y);
  layout.y = y + 16;

  layout.note(
    'An order is counted on the calendar day it was placed on. Delivered and cancelled orders are both ' +
      'counted; a live order still in the kitchen queue when this report is pulled counts too, under whatever ' +
      'status it is currently in. All amounts in rupees.'
  );

  layout.tiles(
    [
      ['Total orders', summary.totalOrders],
      ['Delivered', summary.deliveredCount],
      ['Cancelled', summary.cancelledCount],
      ['Delivered value', formatAmount(summary.deliveredValue)],
      ['Billed', `${summary.billedCount} · ${formatAmount(summary.billedValue)}`],
      ['Not yet billed', formatAmount(summary.unbilledDeliveredValue)],
    ],
    3
  );

  layout.subheading('By status');
  layout.table({
    columns: [
      { label: 'Status', width: CONTENT_WIDTH - 100 },
      { label: 'Orders', width: 100, align: 'right' },
    ],
    rows: ORDER_STATUSES.map((status) => [ORDER_STATUS_LABEL[status], String(summary.byStatus[status] || 0)]),
    totals: ['Total', String(summary.totalOrders)],
    fontSize: 8,
    rowHeight: 14,
  });

  layout.subheading('By source');
  layout.table({
    columns: [
      { label: 'Source', width: CONTENT_WIDTH - 100 },
      { label: 'Orders', width: 100, align: 'right' },
    ],
    rows: ORDER_SOURCES.map((source) => [ORDER_SOURCE_LABEL[source], String(summary.bySource[source] || 0)]),
    totals: ['Total', String(summary.totalOrders)],
    fontSize: 8,
    rowHeight: 14,
  });

  layout.newPage();
  layout.heading(`Register — ${plural(report.orders.length, 'order')} placed ${period}`, {
    subtitle: 'Totals foot the rows above them',
  });

  if (report.orders.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    pdf.text('No orders placed during this period.', MARGIN, layout.y);
    pdf.setTextColor(INK);
  } else {
    // Cancelled orders are listed for the record with their amount blank —
    // they are never billed, so the footed total excludes them, matching the
    // summary's deliveredValue/billedValue above.
    const totalAmount = report.orders.reduce(
      (sum, o) => (o.status === 'CANCELLED' ? sum : sum + Number(o.subtotal || 0)),
      0
    );
    layout.table({
      columns: REGISTER_COLUMNS,
      fontSize: 7,
      rowHeight: 12,
      rows: report.orders.map((o) => {
        const isCancelled = o.status === 'CANCELLED';
        return [
          `#${o.orderNumber}`,
          formatDateTime(o.placedAt),
          ORDER_SOURCE_LABEL[o.source] || o.source,
          placeOf(o),
          o.guestName || '—',
          String(o.itemCount),
          ORDER_STATUS_LABEL[o.status] || o.status,
          o.invoiceNumber || '—',
          isCancelled ? '—' : formatAmount(o.subtotal),
        ];
      }),
      totals: ['Total', '', '', '', '', '', '', '', formatAmount(totalAmount)],
    });
  }

  const pageCount = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(RULE).setLineWidth(0.5);
    pdf.line(MARGIN, pageHeight - MARGIN - 4, layout.right, pageHeight - MARGIN - 4);
    pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(MUTED);
    pdf.text(
      clip(pdf, `${name} · Food orders report, ${period} · All amounts in Rs.`, CONTENT_WIDTH - 80),
      MARGIN,
      pageHeight - MARGIN + 6
    );
    pdf.text(`Page ${page} of ${pageCount}`, layout.right, pageHeight - MARGIN + 6, { align: 'right' });
  }

  return pdf.output('blob');
}

export async function downloadFoodOrdersReportPdf(report) {
  triggerDownload(await buildFoodOrdersReportPdf(report), reportFilename(report, 'pdf'));
}
