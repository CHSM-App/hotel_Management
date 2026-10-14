import { triggerDownload } from './bookingReportFile';

// The Laundry report as a workbook: one sheet per block on the screen. Counts
// are numbers so they can be summed; the guest sheet is left out for a property
// that does not take guest laundry.

// Sent to wash, received back from the wash, handed to the guest.
const GUEST_STATUS = { RECEIVED: 'In wash', WASHING: 'In wash', READY: 'Received', DELIVERED: 'Handed over', CANCELLED: 'Cancelled' };

const stamp = (value) =>
  value
    ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';

function sheet(name, headings, rows, widths) {
  const head = headings.map((value) => ({ value, fontWeight: 'bold', backgroundColor: '#e8e6f5' }));
  const data = rows.map((r) =>
    r.map((v) => (typeof v === 'number' ? { value: v, type: Number, align: 'right' } : { value: v === '' ? null : v }))
  );
  return { data: [head, ...data], sheet: name, stickyRowsCount: 1, columns: widths.map((width) => ({ width })) };
}

export async function downloadLaundryReportExcel(report, { guestLaundry }) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const sheets = [
    sheet(
      'Linen by item',
      ['Item', 'Changed in rooms', 'Sent for washing', 'Received washed', 'Lost', 'Damaged', 'Owned now', 'In wash now'],
      report.linen.byItem.map((i) => [i.name, i.changed, i.sent, i.received, i.lost, i.damaged, i.owned, i.inWashNow]),
      [24, 18, 18, 18, 10, 10, 12, 14]
    ),
    sheet(
      'By washed by',
      ['Washed by', 'Sent', 'Received', 'Lost', 'Damaged', 'Not back', 'Charged (₹)'],
      report.linen.byWasher.map((w) => [w.washedBy || 'Not recorded', w.sent, w.received, w.lost, w.damaged, w.notBack, w.charge || 0]),
      [28, 10, 10, 10, 10, 10, 14]
    ),
  ];
  if (guestLaundry) {
    sheets.push(
      sheet(
        'Guest laundry',
        ['Tag', 'Guest', 'Room', 'Pieces', 'Status', 'Taken in', 'Handed over', 'Amount', 'Washed by', 'Vendor price (₹)', 'Profit (₹)'],
        report.guest.orders.map((o) => [
          o.tagNumber, o.guestName || '', o.roomNumber || 'Walk-in', o.pieces, GUEST_STATUS[o.status] || o.status,
          stamp(o.receivedAt), stamp(o.deliveredAt), o.total, o.washedBy || '', o.washCharge ?? '', o.profit ?? '',
        ]),
        [8, 24, 10, 8, 14, 22, 22, 12, 22, 16, 14]
      )
    );
  }
  const workbook = await writeXlsxFile(sheets, { fontFamily: 'Calibri', fontSize: 11 });
  triggerDownload(await workbook.toBlob(), `laundry-report-${report.fromDate}-to-${report.toDate}.xlsx`);
}

export { GUEST_STATUS as LAUNDRY_ORDER_STATUS_LABEL };

// ---------------------------------------------------------------------------
// PDF — mirrors foodOrderReportFile.js / servicesReportFile.js's layout
// engine; see those for the fuller explanation of each helper.
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

function formatAmount(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  return `Laundry-report-${period}.${extension}`;
}

const MARGIN = 24;
const CONTENT_WIDTH = 595 - MARGIN * 2;

const INK = 25;
const MUTED = 115;
const RULE = 170;
const BAND = 238;
const ZEBRA = 247;

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

export async function buildLaundryReportPdf(report, { guestLaundry }) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pageHeight = pdf.internal.pageSize.getHeight();
  const period = reportPeriodLabel(report.fromDate, report.toDate);
  const name = report.lodgeName || 'Laundry report';
  const layout = createLayout(pdf, `${name} — laundry report, ${period}`);

  let y = MARGIN + 4;
  pdf.setFont('helvetica', 'bold').setFontSize(16).setTextColor(INK);
  pdf.text(clip(pdf, name, CONTENT_WIDTH - 200), MARGIN, y);

  pdf.setFont('helvetica', 'bold').setFontSize(11).setTextColor(INK);
  pdf.text('LAUNDRY REPORT', layout.right, y, { align: 'right' });
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
    'Linen is counted, not valued — a movement belongs to the period by the day it was recorded. Guest laundry ' +
      'is already counted in Other services and on guests’ bills; the figures below are for information only ' +
      'and must not be added to any sales total.'
  );

  layout.subheading('Hotel laundry this period');
  layout.tiles(
    [
      ['Sent for washing', report.linen.totals.sent],
      ['Received washed', report.linen.totals.received],
      ['Lost', report.linen.totals.lost],
      ['Damaged', report.linen.totals.damaged],
      ['In wash now', report.linen.totals.inWashNow],
    ],
    3
  );

  layout.subheading('By linen item');
  if (report.linen.byItem.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    pdf.text('No linen items recorded yet.', MARGIN, layout.y);
    layout.y += 14;
    pdf.setTextColor(INK);
  } else {
    layout.table({
      columns: [
        { label: 'Item', width: 140 },
        { label: 'Changed', width: 60, align: 'right' },
        { label: 'Sent', width: 55, align: 'right' },
        { label: 'Received', width: 60, align: 'right' },
        { label: 'Lost', width: 45, align: 'right' },
        { label: 'Damaged', width: 60, align: 'right' },
        { label: 'Owned', width: 55, align: 'right' },
        { label: 'In wash', width: 52, align: 'right' },
      ],
      rows: report.linen.byItem.map((i) => [
        i.name,
        String(i.changed),
        String(i.sent),
        String(i.received),
        String(i.lost),
        String(i.damaged),
        String(i.owned),
        String(i.inWashNow),
      ]),
      fontSize: 7.5,
      rowHeight: 13,
    });
  }

  layout.subheading('By who washed it');
  if (report.linen.byWasher.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    pdf.text('Nothing was sent for washing in this period.', MARGIN, layout.y);
    layout.y += 14;
    pdf.setTextColor(INK);
  } else {
    layout.table({
      columns: [
        { label: 'Washed by', width: 160 },
        { label: 'Sent', width: 56, align: 'right' },
        { label: 'Received', width: 60, align: 'right' },
        { label: 'Lost', width: 46, align: 'right' },
        { label: 'Damaged', width: 60, align: 'right' },
        { label: 'Not back', width: 56, align: 'right' },
        { label: 'Charged', width: 55, align: 'right' },
      ],
      rows: report.linen.byWasher.map((w) => [
        w.washedBy || 'Not recorded',
        String(w.sent),
        String(w.received),
        String(w.lost),
        String(w.damaged),
        String(w.notBack),
        w.charge > 0 ? formatAmount(w.charge) : '—',
      ]),
      fontSize: 7.5,
      rowHeight: 13,
    });
  }

  if (guestLaundry) {
    const { guest } = report;
    layout.newPage();
    layout.heading('Guest laundry taken in this period');
    layout.note(
      'Handed over, Still open and Vendor prices are already counted in Other services and on the bills — shown ' +
        'here for information only. The vendor price itself is also logged under the Laundry expense category.'
    );
    layout.tiles(
      [
        ['Orders taken in', guest.totals.takenIn],
        ['Cancelled', guest.totals.cancelled],
        ['Pieces', guest.totals.pieces],
        ['Handed over', `${formatAmount(guest.totals.handedOverValue)} (${guest.totals.handedOver})`],
        ['Still open', `${formatAmount(guest.totals.openValue)} (${guest.totals.open})`],
        ['Profit', formatAmount(guest.totals.profit)],
      ],
      3
    );

    layout.subheading(`Register — ${guest.orders.length} order${guest.orders.length === 1 ? '' : 's'} taken in`);
    if (guest.orders.length === 0) {
      pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
      pdf.text('No guest laundry taken in during this period.', MARGIN, layout.y);
      pdf.setTextColor(INK);
    } else {
      layout.table({
        columns: [
          { label: 'Tag', width: 40 },
          { label: 'Guest', width: 90 },
          { label: 'Room', width: 40 },
          { label: 'Pcs', width: 28, align: 'right' },
          { label: 'Status', width: 56 },
          { label: 'Taken in', width: 88 },
          { label: 'Handed over', width: 88 },
          { label: 'Amount', width: 45, align: 'right' },
        ],
        rows: guest.orders.map((o) => [
          String(o.tagNumber),
          o.guestName || '—',
          o.roomNumber || 'Walk-in',
          String(o.pieces),
          GUEST_STATUS[o.status] || o.status,
          formatDateTime(o.receivedAt),
          o.deliveredAt ? formatDateTime(o.deliveredAt) : '—',
          formatAmount(o.total),
        ]),
        fontSize: 7,
        rowHeight: 12,
      });
    }
  }

  const pageCount = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(RULE).setLineWidth(0.5);
    pdf.line(MARGIN, pageHeight - MARGIN - 4, layout.right, pageHeight - MARGIN - 4);
    pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(MUTED);
    pdf.text(
      clip(pdf, `${name} · Laundry report, ${period} · All amounts in Rs.`, CONTENT_WIDTH - 80),
      MARGIN,
      pageHeight - MARGIN + 6
    );
    pdf.text(`Page ${page} of ${pageCount}`, layout.right, pageHeight - MARGIN + 6, { align: 'right' });
  }

  return pdf.output('blob');
}

export async function downloadLaundryReportPdf(report, { guestLaundry }) {
  triggerDownload(await buildLaundryReportPdf(report, { guestLaundry }), reportFilename(report, 'pdf'));
}
