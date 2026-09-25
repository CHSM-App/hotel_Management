// Turning the asset register on screen into a file an owner can keep — same
// three-function shape as expenseReportFile.js/bookingReportFile.js: build
// (used by both preview and download, so the two never disagree),
// download-Excel, download-PDF.

const STATUS_LABEL = { IN_USE: 'In use', UNDER_REPAIR: 'Under repair', RETIRED: 'Retired' };

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
  return `Asset-report-${MONTHS[now.getMonth()]}-${now.getFullYear()}.${extension}`;
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

function repairCost(wo) {
  return Number(wo.partsCost || 0) + Number(wo.laborCost || 0);
}

// One totals object the summary tiles, Excel and PDF all read from, so the
// documents can never disagree on a figure.
function computeTotals(assets, workOrders) {
  const purchaseValue = assets.reduce((s, a) => s + Number(a.purchaseCost || 0), 0);
  const repairSpend = workOrders.reduce((s, wo) => s + repairCost(wo), 0);
  const byStatus = { IN_USE: 0, UNDER_REPAIR: 0, RETIRED: 0 };
  for (const a of assets) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
  const openWorkOrders = workOrders.filter((wo) => wo.status !== 'CLOSED').length;
  return {
    assetCount: assets.length,
    purchaseValue,
    repairSpend,
    totalSpend: purchaseValue + repairSpend,
    byStatus,
    openWorkOrders,
  };
}

function groupByCategory(assets) {
  const map = new Map();
  for (const a of assets) {
    const key = a.categoryName || 'Uncategorised';
    const entry = map.get(key) || { label: key, total: 0, count: 0 };
    entry.total += Number(a.purchaseCost || 0);
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function groupByVendor(assets, workOrders) {
  const map = new Map();
  for (const a of assets) {
    if (!a.vendorName || !a.purchaseCost) continue;
    const entry = map.get(a.vendorName) || { label: a.vendorName, total: 0, count: 0 };
    entry.total += Number(a.purchaseCost || 0);
    entry.count += 1;
    map.set(a.vendorName, entry);
  }
  for (const wo of workOrders) {
    if (!wo.vendorName || !repairCost(wo)) continue;
    const entry = map.get(wo.vendorName) || { label: wo.vendorName, total: 0, count: 0 };
    entry.total += repairCost(wo);
    entry.count += 1;
    map.set(wo.vendorName, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
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

function summarySheet(assets, workOrders) {
  const totals = computeTotals(assets, workOrders);
  const byCategory = groupByCategory(assets);
  const byVendor = groupByVendor(assets, workOrders);

  const rows = [
    [bold('Asset report', { fontSize: 14 })],
    [bold('Generated'), text(formatDateTime(Date.now()))],
    [],
    [bold('Assets on register'), count(totals.assetCount)],
    [bold('Purchase value'), money(totals.purchaseValue)],
    [bold('Repair spend'), money(totals.repairSpend)],
    [bold('Total spend'), money(totals.totalSpend)],
    [bold('Open work orders'), count(totals.openWorkOrders)],
    [],
    headerRow(['By status', 'Assets']),
    ...Object.entries(STATUS_LABEL).map(([key, label]) => [text(label), count(totals.byStatus[key] || 0)]),
    [],
    headerRow(['By category', 'Purchase value', 'Assets']),
    ...byCategory.map((c) => [text(c.label), money(c.total), count(c.count)]),
    [],
    headerRow(['By vendor', 'Amount (purchases + repairs)', 'Entries']),
    ...byVendor.map((v) => [text(v.label), money(v.total), count(v.count)]),
  ];

  return { data: rows, sheet: 'Summary', columns: [{ width: 32 }, { width: 20 }, { width: 12 }] };
}

const ASSET_COLUMNS = [
  { label: 'Tag', width: 10, value: (a) => a.assetTag || '' },
  { label: 'Name', width: 24, value: (a) => a.name },
  { label: 'Category', width: 16, value: (a) => a.categoryName || '' },
  { label: 'Location', width: 20, value: (a) => a.roomNumber ? `Room ${a.roomNumber}` : a.locationNote || a.department || '' },
  { label: 'Status', width: 12, value: (a) => STATUS_LABEL[a.status] || a.status },
  { label: 'Purchase date', width: 12, value: (a) => formatDate(a.purchaseDate) },
  { label: 'Purchase cost', width: 14, kind: 'money', value: (a) => Number(a.purchaseCost || 0) },
  { label: 'Vendor', width: 20, value: (a) => a.vendorName || '' },
  { label: 'Warranty expiry', width: 14, value: (a) => formatDate(a.warrantyExpiry) },
  { label: 'AMC expiry', width: 14, value: (a) => formatDate(a.amcExpiry) },
  { label: 'Open work orders', width: 12, kind: 'count', value: (a) => a.openWorkOrders || 0 },
];

function assetsSheet(assets) {
  const rows = [headerRow(ASSET_COLUMNS.map((c) => c.label))];
  for (const a of assets) {
    rows.push(ASSET_COLUMNS.map((c) => (c.kind === 'money' ? money(c.value(a)) : c.kind === 'count' ? count(c.value(a)) : text(c.value(a)))));
  }
  const totalPurchase = assets.reduce((s, a) => s + Number(a.purchaseCost || 0), 0);
  rows.push(
    totalsRow(
      ASSET_COLUMNS.map((c) => {
        if (c.label === 'Tag') return bold('Total');
        if (c.label === 'Purchase cost') return money(totalPurchase);
        return text('');
      })
    )
  );

  return { data: rows, sheet: 'Assets', stickyRowsCount: 1, columns: ASSET_COLUMNS.map((c) => ({ width: c.width })) };
}

const WORK_ORDER_COLUMNS = [
  { label: 'Asset', width: 22, value: (wo) => wo.assetName || '' },
  { label: 'Issue', width: 16, value: (wo) => (wo.issueType === 'ROUTINE_SERVICE' ? 'Routine service' : 'Breakdown') },
  { label: 'Status', width: 12, value: (wo) => wo.status },
  { label: 'Vendor', width: 20, value: (wo) => wo.vendorName || '' },
  { label: 'Opened', width: 14, value: (wo) => formatDate(wo.openedAt) },
  { label: 'Closed', width: 14, value: (wo) => formatDate(wo.closedAt) },
  { label: 'Parts cost', width: 12, kind: 'money', value: (wo) => Number(wo.partsCost || 0) },
  { label: 'Labor cost', width: 12, kind: 'money', value: (wo) => Number(wo.laborCost || 0) },
  { label: 'Total cost', width: 12, kind: 'money', value: (wo) => repairCost(wo) },
];

function workOrdersSheet(workOrders) {
  const rows = [headerRow(WORK_ORDER_COLUMNS.map((c) => c.label))];
  for (const wo of workOrders) {
    rows.push(WORK_ORDER_COLUMNS.map((c) => (c.kind === 'money' ? money(c.value(wo)) : text(c.value(wo)))));
  }
  const total = workOrders.reduce((s, wo) => s + repairCost(wo), 0);
  rows.push(
    totalsRow(
      WORK_ORDER_COLUMNS.map((c) => (c.label === 'Asset' ? bold('Total') : c.label === 'Total cost' ? money(total) : text('')))
    )
  );
  return { data: rows, sheet: 'Work orders', stickyRowsCount: 1, columns: WORK_ORDER_COLUMNS.map((c) => ({ width: c.width })) };
}

export async function downloadAssetsReportExcel(assets, workOrders) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const workbook = await writeXlsxFile([summarySheet(assets, workOrders), assetsSheet(assets), workOrdersSheet(workOrders)], {
    fontFamily: 'Calibri',
    fontSize: 11,
  });
  triggerDownload(await workbook.toBlob(), reportFilename('xlsx'));
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
  { label: 'Tag', width: 44 },
  { label: 'Name', width: 110 },
  { label: 'Category', width: 75 },
  { label: 'Status', width: 60 },
  { label: 'Vendor', width: 90 },
  { label: 'Purchase date', width: 55 },
  { label: 'Cost', width: 60, align: 'right' },
];

export async function buildAssetsReportPdf(assets, workOrders) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pageHeight = pdf.internal.pageSize.getHeight();
  const totals = computeTotals(assets, workOrders);
  const layout = createLayout(pdf, 'Asset report');

  let y = MARGIN + 4;
  pdf.setFont('helvetica', 'bold').setFontSize(16).setTextColor(INK);
  pdf.text('Asset Report', MARGIN, y);
  pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
  pdf.text(`Generated ${formatDateTime(Date.now())}`, layout.right, y, { align: 'right' });
  y += 16;
  pdf.setDrawColor(INK).setLineWidth(1.2);
  pdf.line(MARGIN, y, layout.right, y);
  layout.y = y + 16;

  layout.tiles(
    [
      ['Assets on register', totals.assetCount],
      ['Purchase value', formatAmount(totals.purchaseValue)],
      ['Repair spend', formatAmount(totals.repairSpend)],
      ['Open work orders', totals.openWorkOrders],
    ],
    4
  );

  layout.heading('By status');
  layout.table({
    columns: [{ label: 'Status', width: 200 }, { label: 'Assets', width: 150, align: 'right' }],
    rows: Object.entries(STATUS_LABEL).map(([key, label]) => [label, String(totals.byStatus[key] || 0)]),
    fontSize: 8.5,
    rowHeight: 15,
  });

  const byCategory = groupByCategory(assets).slice(0, 10);
  layout.heading('Top categories by purchase value');
  layout.table({
    columns: [
      { label: 'Category', width: 260 },
      { label: 'Assets', width: 70, align: 'right' },
      { label: 'Value', width: 100, align: 'right' },
    ],
    rows: byCategory.map((c) => [c.label, String(c.count), formatAmount(c.total)]),
    fontSize: 8.5,
    rowHeight: 15,
  });

  layout.newPage();
  layout.heading(`Register — ${totals.assetCount} asset${totals.assetCount === 1 ? '' : 's'}`);
  if (assets.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    pdf.text('No assets on the register.', MARGIN, layout.y);
    pdf.setTextColor(INK);
  } else {
    layout.table({
      columns: REGISTER_COLUMNS,
      fontSize: 7.5,
      rowHeight: 13,
      rows: assets.map((a) => [
        a.assetTag || '—',
        a.name,
        a.categoryName || '—',
        STATUS_LABEL[a.status] || a.status,
        a.vendorName || '—',
        formatDate(a.purchaseDate),
        formatAmount(a.purchaseCost),
      ]),
      totals: ['Total', '', '', '', '', '', formatAmount(totals.purchaseValue)],
    });
  }

  const pageCount = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(RULE).setLineWidth(0.5);
    pdf.line(MARGIN, pageHeight - MARGIN - 4, layout.right, pageHeight - MARGIN - 4);
    pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(MUTED);
    pdf.text('Asset report · All amounts in Rs.', MARGIN, pageHeight - MARGIN + 6);
    pdf.text(`Page ${page} of ${pageCount}`, layout.right, pageHeight - MARGIN + 6, { align: 'right' });
  }

  return pdf.output('blob');
}

export async function downloadAssetsReportPdf(assets, workOrders) {
  triggerDownload(await buildAssetsReportPdf(assets, workOrders), reportFilename('pdf'));
}
