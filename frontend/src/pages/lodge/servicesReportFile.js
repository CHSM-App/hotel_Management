// Turning an Other services report into a file an owner can keep — an Excel
// workbook to sort and total, or a PDF to print and file. Mirrors
// foodOrderReportFile.js / eventReportFile.js: built from the same report
// payload the Services tab already has on screen, so what downloads is
// exactly what was displayed.

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
  return `Other-services-report-${period}.${extension}`;
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

// Same words the screen uses for a usage's status (ServicesPanel/ReportsPanel).
function statusLabel(u) {
  if (u.voided) return 'Voided';
  if (u.status === 'CANCELLED') return 'Cancelled';
  if (u.status === 'IN_USE') return 'In use';
  if (u.status === 'COMPLETED') return 'Completed';
  return u.status;
}

function billedOn(u) {
  return u.invoiceNumber || (u.onRoomBill ? 'Room bill' : '—');
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
const headerRow = (labels) => labels.map((label) => bold(label, { backgroundColor: HEADER_FILL, wrap: true }));
const totalsRow = (cells) => cells.map((c) => ({ ...c, fontWeight: 'bold' }));

function summarySheet(report) {
  const { totals } = report;
  const period = reportPeriodLabel(report.fromDate, report.toDate);
  const rows = [
    [bold(report.lodgeName || 'Other services report', { fontSize: 14 })],
    [bold('Other services report'), text(period)],
    [bold('Generated'), text(formatDateTime(report.generatedAt || Date.now()))],
    [],
    [
      note(
        'A use is counted on the calendar day it started. Cancelled uses and voided bills are listed below but ' +
          'excluded from the totals here — the value they would have added is never counted.'
      ),
    ],
    [],
    sectionRow(`USES IN ${period.toUpperCase()}`),
    [bold('Total uses'), count(totals.count)],
    [bold('Cancelled'), count(totals.cancelledCount)],
    [bold('Voided bills'), count(totals.voidedCount)],
    [],
    sectionRow('VALUE'),
    [bold('Billed'), money(totals.billedValue)],
    [bold('Completed, not yet billed'), money(totals.unbilledValue)],
  ];

  return {
    data: rows,
    sheet: 'Summary',
    columns: [{ width: 32 }, { width: 16 }],
  };
}

function byServiceSheet(report) {
  const rows = [headerRow(['Service', 'Uses', 'Quantity', 'Value'])];
  for (const s of report.byService) {
    rows.push([text(s.serviceName), count(s.uses), count(s.quantity), money(s.value)]);
  }
  rows.push(
    totalsRow([
      bold('Total'),
      count(report.byService.reduce((sum, s) => sum + s.uses, 0)),
      count(report.byService.reduce((sum, s) => sum + s.quantity, 0)),
      money(report.byService.reduce((sum, s) => sum + s.value, 0)),
    ])
  );
  return { data: rows, sheet: 'By service', stickyRowsCount: 1, columns: [{ width: 28 }, { width: 10 }, { width: 12 }, { width: 14 }] };
}

function usagesSheet(report) {
  const columns = [
    { label: 'Started', width: 20, value: (u) => formatDateTime(u.startedAt) },
    { label: 'Service', width: 24, value: (u) => u.serviceName },
    { label: 'Quantity', width: 10, kind: 'count', value: (u) => u.quantity },
    { label: 'Guest', width: 20, value: (u) => u.guestName || '' },
    { label: 'Room', width: 10, value: (u) => u.roomNumber || '' },
    { label: 'Status', width: 12, value: (u) => statusLabel(u) },
    { label: 'Billed on', width: 14, value: (u) => billedOn(u) },
    { label: 'Amount', width: 12, kind: 'money', value: (u) => u.lineTotal },
  ];
  const rows = [headerRow(columns.map((c) => c.label))];
  for (const u of report.usages) {
    rows.push(
      columns.map((column) => {
        const raw = column.value(u);
        if (column.kind === 'money') return money(raw);
        if (column.kind === 'count') return count(raw);
        return text(raw);
      })
    );
  }
  // Cancelled and voided uses are listed for the record but add nothing —
  // matching the summary's billedValue/unbilledValue, which also never count them.
  const totalAmount = report.usages.reduce(
    (sum, u) => (u.status === 'CANCELLED' || u.voided ? sum : sum + Number(u.lineTotal || 0)),
    0
  );
  const totals = { Started: bold('Total'), Amount: money(totalAmount) };
  rows.push(totalsRow(columns.map((c) => totals[c.label] ?? text(''))));

  return { data: rows, sheet: 'Every use', stickyRowsCount: 1, columns: columns.map((c) => ({ width: c.width || 16 })) };
}

export async function downloadServicesReportExcel(report) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const workbook = await writeXlsxFile([summarySheet(report), byServiceSheet(report), usagesSheet(report)], {
    fontFamily: 'Calibri',
    fontSize: 11,
  });
  triggerDownload(await workbook.toBlob(), reportFilename(report, 'xlsx'));
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const MARGIN = 24;
const CONTENT_WIDTH = 595 - MARGIN * 2;

const INK = 25;
const MUTED = 115;
const RULE = 170;
const BAND = 238;
const ZEBRA = 247;

const REGISTER_COLUMNS = [
  { label: 'Started', width: 90 },
  { label: 'Service', width: 100 },
  { label: 'Qty', width: 30, align: 'right' },
  { label: 'Guest', width: 90 },
  { label: 'Room', width: 36 },
  { label: 'Status', width: 54 },
  { label: 'Amount', width: 47, align: 'right' },
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

export async function buildServicesReportPdf(report) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pageHeight = pdf.internal.pageSize.getHeight();
  const { totals } = report;
  const period = reportPeriodLabel(report.fromDate, report.toDate);
  const name = report.lodgeName || 'Other services report';
  const layout = createLayout(pdf, `${name} — other services report, ${period}`);

  let y = MARGIN + 4;
  pdf.setFont('helvetica', 'bold').setFontSize(16).setTextColor(INK);
  pdf.text(clip(pdf, name, CONTENT_WIDTH - 200), MARGIN, y);

  pdf.setFont('helvetica', 'bold').setFontSize(11).setTextColor(INK);
  pdf.text('OTHER SERVICES REPORT', layout.right, y, { align: 'right' });
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
    'A use is counted on the calendar day it started. Cancelled uses and voided bills are listed in the register ' +
      'but excluded from every total here — the value they would have added is never counted. All amounts in rupees.'
  );

  layout.tiles(
    [
      ['Total uses', totals.count],
      ['Cancelled', totals.cancelledCount],
      ['Voided bills', totals.voidedCount],
      ['Billed', formatAmount(totals.billedValue)],
      ['Completed, not billed', formatAmount(totals.unbilledValue)],
    ],
    3
  );

  layout.subheading('By service');
  if (report.byService.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    pdf.text('No services used in this period.', MARGIN, layout.y);
    layout.y += 14;
    pdf.setTextColor(INK);
  } else {
    layout.table({
      columns: [
        { label: 'Service', width: CONTENT_WIDTH - 200 },
        { label: 'Uses', width: 60, align: 'right' },
        { label: 'Quantity', width: 70, align: 'right' },
        { label: 'Value', width: 70, align: 'right' },
      ],
      rows: report.byService.map((s) => [s.serviceName, String(s.uses), String(s.quantity), formatAmount(s.value)]),
      totals: [
        'Total',
        String(report.byService.reduce((sum, s) => sum + s.uses, 0)),
        String(report.byService.reduce((sum, s) => sum + s.quantity, 0)),
        formatAmount(report.byService.reduce((sum, s) => sum + s.value, 0)),
      ],
      fontSize: 8,
      rowHeight: 14,
    });
  }

  layout.newPage();
  layout.heading(`Register — ${plural(report.usages.length, 'use')} started ${period}`, {
    subtitle: 'Totals foot the rows above them',
  });

  if (report.usages.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    pdf.text('No services used during this period.', MARGIN, layout.y);
    pdf.setTextColor(INK);
  } else {
    const totalAmount = report.usages.reduce(
      (sum, u) => (u.status === 'CANCELLED' || u.voided ? sum : sum + Number(u.lineTotal || 0)),
      0
    );
    layout.table({
      columns: REGISTER_COLUMNS,
      fontSize: 7,
      rowHeight: 12,
      rows: report.usages.map((u) => [
        formatDateTime(u.startedAt),
        u.serviceName,
        String(u.quantity),
        u.guestName || '—',
        u.roomNumber || '—',
        statusLabel(u),
        u.status === 'CANCELLED' || u.voided ? '—' : formatAmount(u.lineTotal),
      ]),
      totals: ['Total', '', '', '', '', '', formatAmount(totalAmount)],
    });
  }

  const pageCount = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(RULE).setLineWidth(0.5);
    pdf.line(MARGIN, pageHeight - MARGIN - 4, layout.right, pageHeight - MARGIN - 4);
    pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(MUTED);
    pdf.text(
      clip(pdf, `${name} · Other services report, ${period} · All amounts in Rs.`, CONTENT_WIDTH - 80),
      MARGIN,
      pageHeight - MARGIN + 6
    );
    pdf.text(`Page ${page} of ${pageCount}`, layout.right, pageHeight - MARGIN + 6, { align: 'right' });
  }

  return pdf.output('blob');
}

export async function downloadServicesReportPdf(report) {
  triggerDownload(await buildServicesReportPdf(report), reportFilename(report, 'pdf'));
}
