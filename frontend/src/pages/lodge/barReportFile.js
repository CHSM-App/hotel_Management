// The Bar report as a file: an Excel workbook to sort and total, or a PDF to print and file.
// Built from the same payload the screen already shows, so what downloads is what was displayed.
import { triggerDownload } from './bookingReportFile';
import { stockParts } from './barFormat';

const PAY = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' };
const day = (d) => String(d).slice(0, 10);
const money = (n) => Number(n || 0);

// One sheet = a title and its rows. Numbers stay numbers in Excel; the PDF formats them.
function sheetsFor(view, d) {
  if (view === 'stock') {
    return [{
      name: 'Stock',
      head: ['Product', 'Opening', 'Received', 'Sold', 'Wastage', 'Closing', 'Now', 'Low'],
      rows: d.products.map((p) => [p.name, stockParts(p.opening), stockParts(p.purchased), stockParts(p.sold), stockParts(p.wastage), stockParts(p.closing), stockParts(p.current), p.isLow ? 'Low' : '']),
    }];
  }
  if (view === 'bills') {
    return [{
      name: 'Bills',
      head: ['Bill', 'Date', 'Customer', 'Drinks tax', 'Food GST', 'Total'],
      rows: d.bills.map((b) => [b.billNumber, day(b.billDate), b.customerName || '', money(b.taxAmount), money(b.foodTaxAmount), money(b.total)]),
    }];
  }
  return [
    {
      name: 'Summary',
      head: ['Measure', 'Amount'],
      rows: [
        ['Total sales', money(d.total)],
        ['Bills', d.bills],
        ['Drinks', money(d.drinks)],
        ['Food (kitchen)', money(d.food)],
        ['Drinks tax (incl.)', money(d.tax)],
        ['Food GST', money(d.foodTax)],
        ['Billed to rooms (included in total)', money(d.onRoomBill?.total)],
        ...d.byPayment.map((p) => [`Paid by ${PAY[p.method] || p.method}`, money(p.amount)]),
      ],
    },
    { name: 'By day', head: ['Day', 'Bills', 'Sales'], rows: d.byDay.map((x) => [day(x.date), x.bills, money(x.total)]) },
    { name: 'By category', head: ['Category', 'ml sold', 'Sales'], rows: d.byCategory.map((x) => [x.category, x.ml, money(x.amount)]) },
    { name: 'Bar items', head: ['Item', 'Size', 'Qty sold', 'ml sold', 'Sale amount'], rows: d.byItem.filter((x) => x.kind !== 'FOOD').map((x) => [x.name, x.size || '', x.quantity, x.ml, money(x.amount)]) },
    { name: 'Restaurant items', head: ['Item', 'Portion', 'Qty sold', 'Sale amount'], rows: d.byItem.filter((x) => x.kind === 'FOOD').map((x) => [x.name, x.size || '', x.quantity, money(x.amount)]) },
  ];
}

const titleOf = (view) => ({ sales: 'Sales', stock: 'Stock', bills: 'Bills' }[view] || 'Report');
const filenameOf = (view, range, ext) => `bar-${view}-report-${range.from}-to-${range.to}.${ext}`;

export async function downloadBarReportExcel(view, data, range) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const sheets = sheetsFor(view, data).map((s) => ({
    sheet: s.name,
    stickyRowsCount: 1,
    columns: s.head.map((_, i) => ({ width: i === 0 ? 30 : 16 })),
    data: [
      s.head.map((value) => ({ value, fontWeight: 'bold', backgroundColor: '#e6edf4' })),
      ...s.rows.map((r) => r.map((v) => (typeof v === 'number' ? { value: v, type: Number, align: 'right' } : { value: v === '' ? null : String(v) }))),
    ],
  }));
  const workbook = await writeXlsxFile(sheets, { fontFamily: 'Calibri', fontSize: 11 });
  triggerDownload(await workbook.toBlob(), filenameOf(view, range, 'xlsx'));
}

const inr = (n) => (typeof n === 'number' ? n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(n));

// The headline figures for the PDF's overview block: [label, value] pairs.
function overviewFor(view, d) {
  const rs = (n) => `Rs ${inr(money(n))}`;
  if (view === 'stock') {
    const low = d.products.filter((p) => p.isLow).length;
    return [['Products', String(d.products.length)], ['Low stock', String(low)]];
  }
  if (view === 'bills') {
    const total = d.bills.reduce((s, b) => s + b.total, 0);
    return [
      ['Bills', String(d.bills.length)],
      ['Total', rs(total)],
      ['Drinks tax', rs(d.bills.reduce((s, b) => s + b.taxAmount, 0))],
      ['Food GST', rs(d.bills.reduce((s, b) => s + b.foodTaxAmount, 0))],
    ];
  }
  const onRoom = money(d.onRoomBill?.total);
  return [
    ['Total sales', rs(d.total)],
    ['Bills', String(d.bills) + (onRoom > 0 ? ` (+ ${rs(onRoom)} on room bills)` : '')],
    ['Drinks', rs(d.drinks)],
    ['Food (kitchen)', rs(d.food)],
    ['Drinks tax', rs(d.tax)],
    ['Food GST', rs(d.foodTax)],
    ['Avg. bill', rs(d.bills ? Math.round((d.total - onRoom) / d.bills) : 0)],
    ...d.byPayment.map((p) => [`Paid by ${PAY[p.method] || p.method}`, rs(p.amount)]),
  ];
}

export async function buildBarReportPdf(view, data, range, lodgeName = '') {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: view === 'stock' ? 'landscape' : 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  let y = M;

  doc.setFont('helvetica', 'bold').setFontSize(15).text(`${lodgeName ? `${lodgeName} · ` : ''}Bar ${titleOf(view).toLowerCase()} report`, M, y);
  y += 16;
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90).text(`${range.from} to ${range.to}`, M, y);
  doc.setTextColor(0);
  y += 20;

  // Overview: the headline figures in tiles, before the detail tables.
  doc.setFont('helvetica', 'bold').setFontSize(11).text('Overview', M, y);
  y += 10;
  const tiles = overviewFor(view, data);
  const perRow = 4;
  const gap = 8;
  const tileW = (W - M * 2 - gap * (perRow - 1)) / perRow;
  const tileH = 40;
  tiles.forEach(([label, value], i) => {
    const col = i % perRow;
    const rowIdx = Math.floor(i / perRow);
    const x = M + col * (tileW + gap);
    const top = y + rowIdx * (tileH + gap);
    doc.setFillColor(230, 237, 244).setDrawColor(199, 214, 230).roundedRect(x, top, tileW, tileH, 4, 4, 'FD');
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(72, 86, 106).text(label.toUpperCase(), x + 8, top + 13);
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(10, 58, 107).text(doc.splitTextToSize(value, tileW - 12)[0], x + 8, top + 30);
  });
  y += Math.ceil(tiles.length / perRow) * (tileH + gap) + 14;
  doc.setTextColor(0);

  // The Excel Summary sheet is the same figures; the overview above replaces it here.
  for (const s of sheetsFor(view, data).filter((sheet) => sheet.name !== 'Summary')) {
    if (y > H - 80) { doc.addPage(); y = M; }
    doc.setFont('helvetica', 'bold').setFontSize(11).text(s.name, M, y);
    y += 8;
    const colW = (W - M * 2) / s.head.length;
    const row = (cells, bold) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(8.5);
      cells.forEach((c, i) => {
        const text = String(typeof c === 'number' && i > 0 ? inr(c) : c ?? '');
        const x = M + i * colW;
        const fitted = doc.splitTextToSize(text, colW - 6)[0] || '';
        if (typeof c === 'number' && i > 0) doc.text(fitted, x + colW - 6, y, { align: 'right' });
        else doc.text(fitted, x + 2, y);
      });
      y += 14;
    };
    y += 8;
    doc.setDrawColor(200).line(M, y - 11, W - M, y - 11);
    row(s.head, true);
    doc.line(M, y - 10, W - M, y - 10);
    for (const r of s.rows) {
      if (y > H - M) { doc.addPage(); y = M + 8; row(s.head, true); }
      row(r, false);
    }
    if (s.rows.length === 0) row(['Nothing in this period.'], false);
    y += 14;
  }
  return doc.output('blob');
}

export async function downloadBarReportPdf(view, data, range, lodgeName) {
  triggerDownload(await buildBarReportPdf(view, data, range, lodgeName), filenameOf(view, range, 'pdf'));
}

// Preview = the PDF opened in a new tab.
export async function previewBarReportPdf(view, data, range, lodgeName) {
  const url = URL.createObjectURL(await buildBarReportPdf(view, data, range, lodgeName));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
