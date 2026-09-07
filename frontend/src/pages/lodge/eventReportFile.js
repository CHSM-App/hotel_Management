// Turning an events & functions report into a file an owner can keep — an
// Excel workbook to sort and total, or a PDF to print and file. Mirrors
// bookingReportFile.js: built from the same report payload the Events tab
// already has on screen, so what downloads is exactly what was displayed.

export const EVENT_TYPE_LABEL = {
  BIRTHDAY: 'Birthday',
  WEDDING: 'Wedding',
  RECEPTION: 'Reception',
  ENGAGEMENT: 'Engagement',
  CORPORATE: 'Corporate',
  OTHER: 'Other',
};

export const EVENT_STATUS_LABEL = {
  ENQUIRY: 'Enquiry',
  TENTATIVE: 'Tentative',
  CONFIRMED: 'Confirmed',
  SETTLED: 'Settled',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

const EVENT_STATUS_SHORT = {
  ENQUIRY: 'Enquiry',
  TENTATIVE: 'Tentative',
  CONFIRMED: 'Confirmed',
  SETTLED: 'Settled',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

const EVENT_STATUSES = ['ENQUIRY', 'TENTATIVE', 'CONFIRMED', 'SETTLED', 'CANCELLED', 'EXPIRED'];

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

// Same helper as bookingReportFile's wholeMonthLabel/reportPeriodLabel — kept
// local rather than shared so this file has no import-time dependency on the
// booking report module.
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
  return `Events-report-${period}.${extension}`;
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

function paxOf(ev) {
  return ev.finalPax ?? ev.guaranteedPax ?? ev.expectedPax;
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
  const totals = summary.totals;
  const cancelled = summary.cancelled || { count: 0 };
  const rows = [
    [bold(report.lodgeName || 'Events & functions report', { fontSize: 14 })],
    [bold('Events & functions report'), text(period)],
    [bold('Generated'), text(formatDateTime(report.generatedAt || Date.now()))],
    [],
    [
      note(
        'Functions are counted by the day they start. A function running past midnight is counted once, on the ' +
          'evening it begins. Cancelled and expired functions are listed for the record but excluded from every ' +
          'money figure, except cancellation charges kept, which are shown separately.'
      ),
    ],
    [],
    sectionRow(`FUNCTIONS STARTING IN ${period.toUpperCase()}`),
    [bold('Total functions'), count(summary.totalEvents)],
  ];
  for (const status of EVENT_STATUSES) {
    rows.push([text(`  ${EVENT_STATUS_LABEL[status]}`), count(summary.byStatus[status] || 0)]);
  }
  rows.push([]);
  rows.push(sectionRow('VALUE OF CONFIRMED / SETTLED FUNCTIONS'));
  rows.push([bold('Functions counted'), count(totals.count)]);
  rows.push([bold('Venue charge'), money(totals.venueCharge)]);
  rows.push([bold('Catering amount'), money(totals.cateringAmount)]);
  rows.push([bold('Add-ons'), money(totals.addonsTotal)]);
  rows.push([bold('Less: discount'), money(totals.discountAmount)]);
  rows.push(totalsRow([bold('Total value'), money(totals.totalAmount)]));
  rows.push([bold('Advance held'), money(totals.advanceAmount)]);
  rows.push(totalsRow([bold('Balance due'), money(totals.balanceDue)]));

  if (cancelled.count) {
    rows.push([]);
    rows.push(sectionRow('CANCELLED FUNCTIONS'));
    rows.push([bold('Cancelled — count'), count(cancelled.count)]);
    rows.push([bold('Cancelled — advance held'), money(cancelled.advanceHeld)]);
    if (cancelled.refunded || cancelled.chargesKept) {
      rows.push([bold('Cancelled — refunded to organiser'), money(cancelled.refunded || 0)]);
      rows.push([bold('Cancelled — cancellation charges kept'), money(cancelled.chargesKept || 0)]);
    }
  }

  const typeEntries = Object.entries(summary.byEventType || {});
  if (typeEntries.length > 0) {
    rows.push([]);
    rows.push(
      headerRow(['By function type', 'Count', 'Venue charge', 'Catering', 'Add-ons', 'Discount', 'Total', 'Advance', 'Balance due'])
    );
    for (const [type, t] of typeEntries) {
      rows.push([
        text(EVENT_TYPE_LABEL[type] || type),
        count(t.count),
        money(t.venueCharge),
        money(t.cateringAmount),
        money(t.addonsTotal),
        money(t.discountAmount),
        money(t.totalAmount),
        money(t.advanceAmount),
        money(t.balanceDue),
      ]);
    }
    rows.push(
      totalsRow([
        bold('Total'),
        count(totals.count),
        money(totals.venueCharge),
        money(totals.cateringAmount),
        money(totals.addonsTotal),
        money(totals.discountAmount),
        money(totals.totalAmount),
        money(totals.advanceAmount),
        money(totals.balanceDue),
      ])
    );
  }

  return {
    data: rows,
    sheet: 'Summary',
    columns: [{ width: 34 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }],
  };
}

function eventsSheet(report) {
  const columns = [
    { label: 'Bill no.', width: 12, value: (ev) => ev.invoiceNumber || '' },
    { label: 'Function', width: 26, value: (ev) => ev.title },
    { label: 'Type', width: 14, value: (ev) => EVENT_TYPE_LABEL[ev.eventType] || ev.eventType },
    { label: 'Organiser', width: 22, value: (ev) => ev.organiserName },
    { label: 'Phone', width: 14, value: (ev) => ev.organiserPhone },
    { label: 'Venue', width: 18, value: (ev) => ev.venueName },
    { label: 'Start', width: 20, value: (ev) => formatDateTime(ev.startAt) },
    { label: 'End', width: 20, value: (ev) => formatDateTime(ev.endAt) },
    { label: 'Pax', width: 8, kind: 'count', value: (ev) => paxOf(ev) },
    { label: 'Status', width: 12, value: (ev) => EVENT_STATUS_LABEL[ev.status] || ev.status },
    { label: 'Venue charge', width: 14, kind: 'money', value: (ev) => ev.venueCharge },
    { label: 'Catering', width: 14, kind: 'money', value: (ev) => ev.cateringAmount },
    { label: 'Add-ons', width: 12, kind: 'money', value: (ev) => ev.addonsTotal },
    { label: 'Discount', width: 12, kind: 'money', value: (ev) => ev.discountAmount },
    { label: 'Total', width: 14, kind: 'money', value: (ev) => ev.totalAmount },
    { label: 'Advance', width: 14, kind: 'money', value: (ev) => ev.advanceAmount },
    { label: 'Balance due', width: 14, kind: 'money', value: (ev) => ev.balanceDue },
    { label: 'Document', width: 14, value: (ev) => ev.documentType || '' },
  ];
  const rows = [headerRow(columns.map((c) => c.label))];

  for (const ev of report.events) {
    const isCancelled = ev.status === 'CANCELLED' || ev.status === 'EXPIRED';
    rows.push(
      columns.map((column) => {
        const raw = column.value(ev);
        if (column.kind === 'money') return isCancelled ? text('') : money(raw);
        if (column.kind === 'count') return count(raw);
        return text(raw);
      })
    );
  }

  const totals = report.summary.totals;
  const totalsMap = {
    'Bill no.': bold('Total'),
    'Venue charge': money(totals.venueCharge),
    Catering: money(totals.cateringAmount),
    'Add-ons': money(totals.addonsTotal),
    Discount: money(totals.discountAmount),
    Total: money(totals.totalAmount),
    Advance: money(totals.advanceAmount),
    'Balance due': money(totals.balanceDue),
  };
  rows.push(totalsRow(columns.map((c) => totalsMap[c.label] ?? text(''))));

  return {
    data: rows,
    sheet: 'Functions',
    stickyRowsCount: 1,
    columns: columns.map((c) => ({ width: c.width || 16 })),
  };
}

export async function downloadEventsReportExcel(report) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const workbook = await writeXlsxFile([summarySheet(report), eventsSheet(report)], {
    fontFamily: 'Calibri',
    fontSize: 11,
  });
  triggerDownload(await workbook.toBlob(), reportFilename(report, 'xlsx'));
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const MARGIN = 24;
const CONTENT_WIDTH = 842 - MARGIN * 2;

const INK = 25;
const MUTED = 115;
const RULE = 170;
const BAND = 238;
const ZEBRA = 247;

const REGISTER_COLUMNS = [
  { label: 'Bill no.', width: 44 },
  { label: 'Function', width: 100 },
  { label: 'Type', width: 56 },
  { label: 'Organiser', width: 90 },
  { label: 'Venue', width: 70 },
  { label: 'Start', width: 80 },
  { label: 'Pax', width: 28, align: 'right' },
  { label: 'Status', width: 52 },
  { label: 'Venue chg', width: 52, align: 'right' },
  { label: 'Catering', width: 52, align: 'right' },
  { label: 'Discount', width: 48, align: 'right' },
  { label: 'Total', width: 52, align: 'right' },
  { label: 'Advance', width: 52, align: 'right' },
  { label: 'Bal. due', width: 46, align: 'right' },
];

function clip(pdf, text, width) {
  const value = String(text ?? '');
  if (!value) return '';
  if (pdf.getTextWidth(value) <= width) return value;
  let end = value.length;
  while (end > 1 && pdf.getTextWidth(`${value.slice(0, end)}…`) > width) end -= 1;
  return `${value.slice(0, end)}…`;
}

// Layout cursor — identical in shape to bookingReportFile's createLayout, kept
// as its own copy rather than shared so each report file can evolve without
// touching the other's PDF.
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
    equation(lines, { width = 300 } = {}) {
      const rowHeight = 12;
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

export async function buildEventsReportPdf(report) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const pageHeight = pdf.internal.pageSize.getHeight();
  const { summary } = report;
  const totals = summary.totals;
  const cancelled = summary.cancelled || { count: 0 };
  const period = reportPeriodLabel(report.fromDate, report.toDate);
  const name = report.lodgeName || 'Events & functions report';
  const layout = createLayout(pdf, `${name} — events & functions report, ${period}`);

  let y = MARGIN + 4;
  pdf.setFont('helvetica', 'bold').setFontSize(16).setTextColor(INK);
  pdf.text(clip(pdf, name, CONTENT_WIDTH - 260), MARGIN, y);

  pdf.setFont('helvetica', 'bold').setFontSize(11).setTextColor(INK);
  pdf.text('EVENTS & FUNCTIONS REPORT', layout.right, y, { align: 'right' });
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
    'Functions are counted by the day they start — a function running past midnight is counted once, on the ' +
      'evening it begins. Cancelled and expired functions are listed in the register for the record but ' +
      'excluded from every money figure below, except cancellation charges kept, which are shown separately. ' +
      'All amounts in rupees.'
  );

  layout.tiles(
    [
      ['Functions', summary.totalEvents],
      ['Confirmed', summary.byStatus.CONFIRMED || 0],
      ['Settled', summary.byStatus.SETTLED || 0],
      ['Cancelled', cancelled.count],
      ['Total value', formatAmount(totals.totalAmount)],
      ['Balance due', formatAmount(totals.balanceDue)],
    ],
    6
  );

  layout.heading(`Functions starting in ${period}`, { subtitle: 'By status' });
  layout.tiles([
    ['Total functions', summary.totalEvents],
    ...EVENT_STATUSES.map((status) => [EVENT_STATUS_LABEL[status], summary.byStatus[status] || 0]),
  ]);

  layout.subheading('Value of confirmed / settled functions', { reserve: 90 });
  layout.equation([
    ['Venue charge', formatAmount(totals.venueCharge)],
    ['Add: catering amount', formatAmount(totals.cateringAmount)],
    ['Add: add-ons', formatAmount(totals.addonsTotal)],
    ['Less: discount', formatAmount(totals.discountAmount)],
    ['Total value', formatAmount(totals.totalAmount), { result: true }],
  ]);
  layout.equation([
    ['Total value', formatAmount(totals.totalAmount)],
    ['Less: advance held', formatAmount(totals.advanceAmount)],
    ['Balance due', formatAmount(totals.balanceDue), { result: true }],
  ]);
  layout.note(
    'Enquiry and tentative functions are counted above by status but excluded from these value totals — ' +
      'nothing has been confirmed yet to bill against.' +
      (cancelled.count
        ? ` ${plural(cancelled.count, 'cancelled function')} held ${formatAmount(cancelled.advanceHeld)} of ` +
          'advance, excluded from the totals above.'
        : '') +
      (cancelled.refunded || cancelled.chargesKept
        ? ` Of that, ${formatAmount(cancelled.refunded || 0)} was refunded and ` +
          `${formatAmount(cancelled.chargesKept || 0)} kept as cancellation charges.`
        : '')
  );

  const typeEntries = Object.entries(summary.byEventType || {});
  if (typeEntries.length > 0) {
    layout.subheading('By function type');
    layout.table({
      columns: [
        { label: 'Type', width: 130 },
        { label: 'Count', width: 50, align: 'right' },
        { label: 'Venue charge', width: 100, align: 'right' },
        { label: 'Catering', width: 90, align: 'right' },
        { label: 'Add-ons', width: 80, align: 'right' },
        { label: 'Discount', width: 80, align: 'right' },
        { label: 'Total', width: 90, align: 'right' },
        { label: 'Advance', width: 90, align: 'right' },
        { label: 'Balance due', width: 84, align: 'right' },
      ],
      rows: typeEntries.map(([type, t]) => [
        EVENT_TYPE_LABEL[type] || type,
        String(t.count),
        formatAmount(t.venueCharge),
        formatAmount(t.cateringAmount),
        formatAmount(t.addonsTotal),
        formatAmount(t.discountAmount),
        formatAmount(t.totalAmount),
        formatAmount(t.advanceAmount),
        formatAmount(t.balanceDue),
      ]),
      totals:
        typeEntries.length > 1
          ? [
              'Total',
              String(totals.count),
              formatAmount(totals.venueCharge),
              formatAmount(totals.cateringAmount),
              formatAmount(totals.addonsTotal),
              formatAmount(totals.discountAmount),
              formatAmount(totals.totalAmount),
              formatAmount(totals.advanceAmount),
              formatAmount(totals.balanceDue),
            ]
          : null,
      fontSize: 8,
      rowHeight: 14,
    });
  }

  layout.newPage();
  layout.heading(`Register — ${plural(report.events.length, 'function')} starting ${period}`, {
    subtitle: 'Money columns blank on cancelled/expired rows; totals foot the rows above them',
  });

  if (report.events.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    pdf.text('No functions started during this period.', MARGIN, layout.y);
    pdf.setTextColor(INK);
  } else {
    const totalsRowValues = [
      'Total',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      formatAmount(totals.venueCharge),
      formatAmount(totals.cateringAmount),
      formatAmount(totals.discountAmount),
      formatAmount(totals.totalAmount),
      formatAmount(totals.advanceAmount),
      formatAmount(totals.balanceDue),
    ];
    layout.table({
      columns: REGISTER_COLUMNS,
      fontSize: 7,
      rowHeight: 12,
      rows: report.events.map((ev) => {
        const excluded = ev.status === 'CANCELLED' || ev.status === 'EXPIRED';
        const val = (v) => (excluded ? '—' : formatAmount(v));
        return [
          ev.invoiceNumber || '—',
          ev.title,
          EVENT_TYPE_LABEL[ev.eventType] || ev.eventType,
          ev.organiserName,
          ev.venueName,
          formatDateTime(ev.startAt),
          String(paxOf(ev)),
          EVENT_STATUS_SHORT[ev.status] || ev.status,
          val(ev.venueCharge),
          val(ev.cateringAmount),
          val(ev.discountAmount),
          val(ev.totalAmount),
          excluded ? '—' : ev.advanceAmount ? formatAmount(ev.advanceAmount) : '—',
          excluded ? '—' : ev.balanceDue ? formatAmount(ev.balanceDue) : '—',
        ];
      }),
      totals: totalsRowValues,
    });
  }

  const pageCount = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(RULE).setLineWidth(0.5);
    pdf.line(MARGIN, pageHeight - MARGIN - 4, layout.right, pageHeight - MARGIN - 4);
    pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(MUTED);
    pdf.text(
      clip(
        pdf,
        `${name} · Events & functions report, ${period} · All amounts in Rs. · Cancelled/expired functions excluded from all money figures.`,
        CONTENT_WIDTH - 80
      ),
      MARGIN,
      pageHeight - MARGIN + 6
    );
    pdf.text(`Page ${page} of ${pageCount}`, layout.right, pageHeight - MARGIN + 6, { align: 'right' });
  }

  return pdf.output('blob');
}

export async function downloadEventsReportPdf(report) {
  triggerDownload(await buildEventsReportPdf(report), reportFilename(report, 'pdf'));
}
