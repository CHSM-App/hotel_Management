// Turning the income list on screen into a file an owner can keep — same
// three-function shape as expenseReportFile.js, mirrored for income.

import { PAYMENT_METHOD_LABEL } from './paymentMethods';

const PAYMENT_STATUS_LABEL = { PAID: 'Received', PARTIAL: 'Partially received', PENDING: 'Pending' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
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

function reportFilename(extension) {
  const now = new Date();
  const stamp = `${MONTHS[now.getMonth()]}-${now.getFullYear()}`;
  return `Income-report-${stamp}.${extension}`;
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

// One totals object the summary tiles, the Excel sheet and the PDF tiles all
// read from, so the three documents can never disagree on a figure.
function computeTotals(income) {
  const total = income.reduce((s, e) => s + Number(e.amount || 0), 0);
  const received = income.reduce((s, e) => s + Number(e.amountReceived || 0), 0);
  const byStatus = { PAID: 0, PARTIAL: 0, PENDING: 0 };
  for (const e of income) byStatus[e.paymentStatus || 'PAID'] = (byStatus[e.paymentStatus || 'PAID'] || 0) + Number(e.amount || 0);
  return { count: income.length, total, received, outstanding: total - received, byStatus };
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

const MONEY = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';
const HEADER_FILL = '#E8E8E8';

const bold = (value, extra = {}) => ({ value, fontWeight: 'bold', ...extra });
const text = (value) => ({ value: value === '' || value == null ? null : value });
const money = (value) => ({ value: value ?? null, type: Number, format: MONEY, align: 'right' });
const count = (value) => ({ value: value ?? null, type: Number, align: 'right' });
const headerRow = (labels) => labels.map((label) => bold(label, { backgroundColor: HEADER_FILL, wrap: true }));
const totalsRow = (cells) => cells.map((c) => ({ ...c, fontWeight: 'bold' }));

function summarySheet(income) {
  const totals = computeTotals(income);
  const byCategory = groupByCategory(income);
  const byPayer = groupByPayer(income);

  const rows = [
    [bold('Income report', { fontSize: 14 })],
    [bold('Generated'), text(formatDateTime(Date.now()))],
    [],
    [bold('Entries logged'), count(totals.count)],
    [bold('Total income'), money(totals.total)],
    [bold('Received so far'), money(totals.received)],
    [bold('Outstanding'), money(totals.outstanding)],
    [],
    headerRow(['By status', 'Amount']),
    ...Object.entries(PAYMENT_STATUS_LABEL).map(([key, label]) => [text(label), money(totals.byStatus[key] || 0)]),
    [],
    headerRow(['By category', 'Amount', 'Entries']),
    ...byCategory.map((c) => [text(c.label), money(c.total), count(c.count)]),
    [],
    headerRow(['By payer', 'Amount', 'Entries']),
    ...byPayer.map((v) => [text(v.label), money(v.total), count(v.count)]),
  ];

  return {
    data: rows,
    sheet: 'Summary',
    columns: [{ width: 30 }, { width: 16 }, { width: 12 }],
  };
}

function groupByCategory(income) {
  const map = new Map();
  for (const e of income) {
    const key = e.categoryName || 'Uncategorised';
    const entry = map.get(key) || { label: key, total: 0, count: 0 };
    entry.total += Number(e.amount || 0);
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function groupByPayer(income) {
  const map = new Map();
  for (const e of income) {
    const key = e.payerName || 'No payer on file';
    const entry = map.get(key) || { label: key, total: 0, count: 0 };
    entry.total += Number(e.amount || 0);
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

const INCOME_COLUMNS = [
  { label: 'Date', width: 12, value: (e) => formatDate(e.incomeDate) },
  { label: 'Title', width: 26, value: (e) => e.title },
  { label: 'Category', width: 18, value: (e) => e.categoryName || '' },
  { label: 'Payer', width: 20, value: (e) => e.payerName || '' },
  { label: 'Amount', width: 14, kind: 'money', value: (e) => Number(e.amount || 0) },
  { label: 'Received via', width: 14, value: (e) => PAYMENT_METHOD_LABEL[e.paymentMethod] || e.paymentMethod || '' },
  { label: 'Status', width: 14, value: (e) => PAYMENT_STATUS_LABEL[e.paymentStatus] || e.paymentStatus || '' },
  { label: 'Received so far', width: 14, kind: 'money', value: (e) => Number(e.amountReceived || 0) },
];

function incomeSheet(income) {
  const rows = [headerRow(INCOME_COLUMNS.map((c) => c.label))];
  for (const e of income) {
    rows.push(INCOME_COLUMNS.map((c) => (c.kind === 'money' ? money(c.value(e)) : text(c.value(e)))));
  }
  const totals = computeTotals(income);
  rows.push(
    totalsRow(
      INCOME_COLUMNS.map((c) => {
        if (c.label === 'Date') return bold('Total');
        if (c.label === 'Amount') return money(totals.total);
        if (c.label === 'Received so far') return money(totals.received);
        return text('');
      })
    )
  );

  return {
    data: rows,
    sheet: 'Income',
    stickyRowsCount: 1,
    columns: INCOME_COLUMNS.map((c) => ({ width: c.width })),
  };
}

export async function downloadIncomeReportExcel(income) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const workbook = await writeXlsxFile([summarySheet(income), incomeSheet(income)], {
    fontFamily: 'Calibri',
    fontSize: 11,
  });
  triggerDownload(await workbook.toBlob(), reportFilename('xlsx'));
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const MARGIN = 24;
const CONTENT_WIDTH = 595 - MARGIN * 2; // Portrait A4 — one register, no wide GST columns.

const INK = 25;
const MUTED = 115;
const RULE = 170;
const BAND = 238;
const ZEBRA = 247;

function clip(pdf, value, width) {
  const str = String(value ?? '');
  if (!str) return '';
  if (pdf.getTextWidth(str) <= width) return str;
  let end = str.length;
  while (end > 1 && pdf.getTextWidth(`${str.slice(0, end)}…`) > width) end -= 1;
  return `${str.slice(0, end)}…`;
}

function createLayout(pdf, runningHead) {
  const pageHeight = pdf.internal.pageSize.getHeight();
  const right = MARGIN + CONTENT_WIDTH;
  const bottom = pageHeight - MARGIN - 16;
  let y = MARGIN;

  const layout = {
    right,
    bottom,
    get y() { return y; },
    set y(value) { y = value; },
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
    heading(txt, { reserve = 30 } = {}) {
      layout.ensure(24 + reserve);
      pdf.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(INK);
      pdf.text(txt.toUpperCase(), MARGIN, y);
      y += 4;
      pdf.setDrawColor(INK).setLineWidth(0.8);
      pdf.line(MARGIN, y, right, y);
      y += 13;
      pdf.setFont('helvetica', 'normal').setTextColor(INK);
    },
    tiles(entries, perRow = 4) {
      const tileWidth = CONTENT_WIDTH / perRow;
      const rows = Math.ceil(entries.length / perRow);
      layout.ensure(rows * 32);
      entries.forEach(([label, value], i) => {
        const x = MARGIN + (i % perRow) * tileWidth;
        const top = y + Math.floor(i / perRow) * 32;
        pdf.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(MUTED);
        pdf.text(clip(pdf, label.toUpperCase(), tileWidth - 8), x, top);
        pdf.setFont('helvetica', 'bold').setFontSize(11).setTextColor(INK);
        pdf.text(clip(pdf, String(value), tileWidth - 8), x, top + 13);
      });
      y += rows * 32 + 4;
      pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(INK);
    },
    table({ columns, rows, totals, fontSize = 8, rowHeight = 14, zebra = true }) {
      const width = columns.reduce((sum, c) => sum + c.width, 0);
      const paint = (cells, { boldRow = false, fill = null } = {}) => {
        if (fill !== null) {
          pdf.setFillColor(fill);
          pdf.rect(MARGIN, y - rowHeight + 4, width, rowHeight, 'F');
        }
        pdf.setFont('helvetica', boldRow ? 'bold' : 'normal').setTextColor(INK);
        let x = MARGIN;
        columns.forEach((column, i) => {
          const t = clip(pdf, cells[i], column.width - 4);
          if (column.align === 'right') pdf.text(t, x + column.width - 2, y, { align: 'right' });
          else pdf.text(t, x + 2, y);
          x += column.width;
        });
      };
      const columnHeader = () => {
        y += rowHeight - 4;
        pdf.setFillColor(BAND);
        pdf.rect(MARGIN, y - rowHeight + 4, width, rowHeight, 'F');
        pdf.setFontSize(fontSize);
        paint(columns.map((c) => c.label), { boldRow: true });
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
        paint(totals, { boldRow: true });
        y += rowHeight;
      }
      y += 8;
    },
  };

  return layout;
}

const REGISTER_COLUMNS = [
  { label: 'Date', width: 52 },
  { label: 'Title', width: 130 },
  { label: 'Category', width: 90 },
  { label: 'Payer', width: 100 },
  { label: 'Received via', width: 60 },
  { label: 'Status', width: 55 },
  { label: 'Amount', width: 60, align: 'right' },
];

export async function buildIncomeReportPdf(income) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pageHeight = pdf.internal.pageSize.getHeight();
  const totals = computeTotals(income);
  const layout = createLayout(pdf, 'Income report');

  let y = MARGIN + 4;
  pdf.setFont('helvetica', 'bold').setFontSize(16).setTextColor(INK);
  pdf.text('Income Report', MARGIN, y);
  pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
  pdf.text(`Generated ${formatDateTime(Date.now())}`, layout.right, y, { align: 'right' });
  y += 16;
  pdf.setDrawColor(INK).setLineWidth(1.2);
  pdf.line(MARGIN, y, layout.right, y);
  layout.y = y + 16;

  layout.tiles(
    [
      ['Entries logged', totals.count],
      ['Total income', formatAmount(totals.total)],
      ['Received so far', formatAmount(totals.received)],
      ['Outstanding', formatAmount(totals.outstanding)],
    ],
    4
  );

  layout.heading('By status');
  layout.table({
    columns: [{ label: 'Status', width: 200 }, { label: 'Amount', width: 150, align: 'right' }],
    rows: Object.entries(PAYMENT_STATUS_LABEL).map(([key, label]) => [label, formatAmount(totals.byStatus[key] || 0)]),
    fontSize: 8.5,
    rowHeight: 15,
  });

  const byCategory = groupByCategory(income).slice(0, 10);
  layout.heading('Top categories');
  layout.table({
    columns: [
      { label: 'Category', width: 260 },
      { label: 'Entries', width: 70, align: 'right' },
      { label: 'Amount', width: 100, align: 'right' },
    ],
    rows: byCategory.map((c) => [c.label, String(c.count), formatAmount(c.total)]),
    fontSize: 8.5,
    rowHeight: 15,
  });

  layout.newPage();
  layout.heading(`Register — ${totals.count} entr${totals.count === 1 ? 'y' : 'ies'}`);
  if (income.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    pdf.text('No income logged.', MARGIN, layout.y);
    pdf.setTextColor(INK);
  } else {
    layout.table({
      columns: REGISTER_COLUMNS,
      fontSize: 7.5,
      rowHeight: 13,
      rows: income.map((e) => [
        formatDate(e.incomeDate),
        e.title,
        e.categoryName || '—',
        e.payerName || '—',
        PAYMENT_METHOD_LABEL[e.paymentMethod] || e.paymentMethod || '—',
        PAYMENT_STATUS_LABEL[e.paymentStatus] || e.paymentStatus || '—',
        formatAmount(e.amount),
      ]),
      totals: ['Total', '', '', '', '', '', formatAmount(totals.total)],
    });
  }

  const pageCount = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(RULE).setLineWidth(0.5);
    pdf.line(MARGIN, pageHeight - MARGIN - 4, layout.right, pageHeight - MARGIN - 4);
    pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(MUTED);
    pdf.text('Income report · All amounts in Rs.', MARGIN, pageHeight - MARGIN + 6);
    pdf.text(`Page ${page} of ${pageCount}`, layout.right, pageHeight - MARGIN + 6, { align: 'right' });
  }

  return pdf.output('blob');
}

export async function downloadIncomeReportPdf(income) {
  triggerDownload(await buildIncomeReportPdf(income), reportFilename('pdf'));
}
