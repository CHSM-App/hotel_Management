// The GST register an accountant files a return from: every bill issued in the
// period, by bill date and in number order, with the tax split the return asks
// for. Unlike the booking report (stays by check-in date) this is dated by the
// bill itself, which is the date GST is owed on.
//
// Built from the same /reports/gst-summary payload the Tax & GST tab shows, and
// every table is summed from the invoice rows rather than read from the
// server's totals, so the register can never disagree with the figures above it.

import {
  CONTENT_WIDTH,
  DOCUMENT_TYPE_LABEL,
  INK,
  MARGIN,
  MUTED,
  RULE,
  clip,
  createLayout,
  formatAmount,
  formatDateOfTimestamp,
  formatDateTime,
  reportPeriodLabel,
  triggerDownload,
} from './bookingReportFile';

// Same Services Accounting Codes the printed bill carries.
const SAC = { rooms: '996311', food: '996331' };
const AGAINST_LABEL = { STAY: 'Stay', EVENT: 'Function', FOOD: 'Restaurant' };

const round2 = (n) => Math.round(n * 100) / 100;

function sumInvoices(list) {
  const t = { count: list.length, taxable: 0, cgst: 0, sgst: 0, roundOff: 0, total: 0 };
  for (const i of list) {
    t.taxable += i.taxableValue;
    t.cgst += i.cgstAmount;
    t.sgst += i.sgstAmount;
    t.roundOff += i.roundOff;
    t.total += i.totalAmount;
  }
  for (const k of ['taxable', 'cgst', 'sgst', 'roundOff', 'total']) t[k] = round2(t[k]);
  return t;
}

// One row per supply: what was sold, under which SAC, what tax it carried. A
// bill that carries rooms and food contributes to both rows.
function supplyRows(invoices) {
  const rows = [
    { label: 'Accommodation', sac: SAC.rooms, taxable: 0, cgst: 0, sgst: 0 },
    { label: 'Functions / venue', sac: '', taxable: 0, cgst: 0, sgst: 0 },
    { label: 'Food', sac: SAC.food, taxable: 0, cgst: 0, sgst: 0 },
    { label: 'Other services', sac: '', taxable: 0, cgst: 0, sgst: 0 },
  ];
  for (const i of invoices) {
    const main = rows[i.isEvent ? 1 : 0];
    main.taxable += i.taxableValue - i.foodTaxable - i.serviceTaxable;
    main.cgst += i.roomCgst;
    main.sgst += i.roomSgst;
    rows[2].taxable += i.foodTaxable;
    rows[2].cgst += i.foodCgst;
    rows[2].sgst += i.foodSgst;
    rows[3].taxable += i.serviceTaxable;
    rows[3].cgst += i.serviceCgst;
    rows[3].sgst += i.serviceSgst;
  }
  return rows
    .map((r) => ({ ...r, taxable: round2(r.taxable), cgst: round2(r.cgst), sgst: round2(r.sgst) }))
    .filter((r) => r.taxable || r.cgst || r.sgst);
}

const reportFilename = (report) => `GST-register-${report.fromDate}-to-${report.toDate}.pdf`;

const REGISTER_COLUMNS = [
  { label: 'Bill no.', width: 70 },
  { label: 'Bill date', width: 62 },
  { label: 'Document', width: 70 },
  { label: 'Against', width: 52 },
  { label: 'Party', width: 190 },
  { label: 'Taxable value', width: 80, align: 'right' },
  { label: 'CGST', width: 70, align: 'right' },
  { label: 'SGST', width: 70, align: 'right' },
  { label: 'Round off', width: 50, align: 'right' },
  { label: 'Billed total', width: 80, align: 'right' },
];

export async function buildGstReportPdf(report) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const pageHeight = pdf.internal.pageSize.getHeight();
  const invoices = report.invoices;
  const voided = report.voided || [];
  const totals = sumInvoices(invoices);
  const period = reportPeriodLabel(report.fromDate, report.toDate);
  const name = report.lodgeName || 'GST register';
  const layout = createLayout(pdf, `${name} — GST register, ${period}`);

  // Masthead: the registered person on the left, what the document is on the right.
  let y = MARGIN + 4;
  pdf.setFont('helvetica', 'bold').setFontSize(16).setTextColor(INK);
  pdf.text(clip(pdf, name, CONTENT_WIDTH - 260), MARGIN, y);
  pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
  pdf.text(report.gstin ? `GSTIN  ${report.gstin}` : 'GSTIN  not registered', MARGIN, y + 13);
  pdf.setFont('helvetica', 'bold').setFontSize(11).setTextColor(INK);
  pdf.text('GST REGISTER — OUTWARD SUPPLIES', layout.right, y, { align: 'right' });
  pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
  pdf.text(`${period}   ·   by bill date`, layout.right, y + 13, { align: 'right' });
  pdf.text(`Generated ${formatDateTime(report.generatedAt || Date.now())}`, layout.right, y + 24, { align: 'right' });
  y += 34;
  pdf.setDrawColor(INK).setLineWidth(1.2);
  pdf.line(MARGIN, y, layout.right, y);
  layout.y = y + 16;

  layout.note(
    `Every bill issued ${period}, counted by the date on the bill and listed in bill-number order. Taxable value ` +
      'is the amount with the tax inside it taken out; taxable value + CGST + SGST + round off = billed total on ' +
      'every row. Voided bills are excluded from every figure and listed separately so the number series is ' +
      'accounted for. Figures cover stays, functions and restaurant bills together. All amounts in rupees.'
  );
  layout.tiles(
    [
      ['Bills issued', totals.count],
      ['Taxable value', formatAmount(totals.taxable)],
      ['CGST', formatAmount(totals.cgst)],
      ['SGST', formatAmount(totals.sgst)],
      ['Total tax', formatAmount(totals.cgst + totals.sgst)],
      ['Billed total', formatAmount(totals.total)],
    ],
    6
  );

  // ---- 1. Tax by supply ---------------------------------------------------
  layout.heading('1. Tax by supply', { subtitle: 'Taxable value and tax, by what was sold' });
  const supplies = supplyRows(invoices);
  layout.table({
    columns: [
      { label: 'Supply', width: 200 },
      { label: 'SAC', width: 70 },
      { label: 'Taxable value', width: 130, align: 'right' },
      { label: 'CGST', width: 110, align: 'right' },
      { label: 'SGST', width: 110, align: 'right' },
      { label: 'Total tax', width: 110, align: 'right' },
    ],
    rows: supplies.length
      ? supplies.map((r) => [r.label, r.sac, formatAmount(r.taxable), formatAmount(r.cgst), formatAmount(r.sgst), formatAmount(r.cgst + r.sgst)])
      : [['No bills issued', '', ...Array(4).fill(formatAmount(0))]],
    totals: supplies.length > 1
      ? ['Total', '', formatAmount(totals.taxable), formatAmount(totals.cgst), formatAmount(totals.sgst), formatAmount(totals.cgst + totals.sgst)]
      : null,
    fontSize: 8,
    rowHeight: 14,
  });

  // ---- 2. By document type ------------------------------------------------
  // A cash receipt or bill of supply carries no tax; blending it with tax
  // invoices would give a taxable value nobody can file.
  layout.heading('2. By document type');
  const docRow = (label, t) => [
    label,
    String(t.count),
    formatAmount(t.taxable),
    formatAmount(t.cgst),
    formatAmount(t.sgst),
    formatAmount(t.roundOff),
    formatAmount(t.total),
  ];
  const docTypes = Object.keys(DOCUMENT_TYPE_LABEL).filter((t) => invoices.some((i) => i.documentType === t));
  layout.table({
    columns: [
      { label: 'Document', width: 190 },
      { label: 'Bills', width: 60, align: 'right' },
      { label: 'Taxable value', width: 120, align: 'right' },
      { label: 'CGST', width: 100, align: 'right' },
      { label: 'SGST', width: 100, align: 'right' },
      { label: 'Round off', width: 80, align: 'right' },
      { label: 'Billed total', width: 110, align: 'right' },
    ],
    rows: docTypes.length
      ? docTypes.map((t) => docRow(DOCUMENT_TYPE_LABEL[t], sumInvoices(invoices.filter((i) => i.documentType === t))))
      : [['No bills issued', '0', ...Array(5).fill(formatAmount(0))]],
    totals: docTypes.length > 1 ? docRow('Total', totals) : null,
    fontSize: 8,
    rowHeight: 14,
  });

  // ---- 3. Register --------------------------------------------------------
  layout.newPage();
  layout.heading(`3. Bill register — ${totals.count} ${totals.count === 1 ? 'bill' : 'bills'}`, {
    subtitle: 'In bill-number order; totals foot the rows above them',
  });
  if (invoices.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    pdf.text('No bills issued in this period.', MARGIN, layout.y);
    pdf.setTextColor(INK);
  } else {
    layout.table({
      columns: REGISTER_COLUMNS,
      fontSize: 7.5,
      rowHeight: 13,
      rows: invoices.map((i) => [
        i.invoiceNumber || '—',
        formatDateOfTimestamp(i.createdAt),
        DOCUMENT_TYPE_LABEL[i.documentType] || i.documentType,
        AGAINST_LABEL[i.source] || '',
        i.guestName || '—',
        formatAmount(i.taxableValue),
        formatAmount(i.cgstAmount),
        formatAmount(i.sgstAmount),
        formatAmount(i.roundOff),
        formatAmount(i.totalAmount),
      ]),
      totals: ['Total', '', '', '', '', formatAmount(totals.taxable), formatAmount(totals.cgst), formatAmount(totals.sgst), formatAmount(totals.roundOff), formatAmount(totals.total)],
    });
  }

  // ---- 4. Voided ----------------------------------------------------------
  layout.heading('4. Voided bills', { subtitle: 'Not in any figure above', reserve: 50 });
  if (voided.length === 0) {
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
    pdf.text('No bills were voided in this period.', MARGIN, layout.y);
    pdf.setTextColor(INK);
    layout.y += 16;
  } else {
    layout.table({
      columns: [
        { label: 'Bill no.', width: 120 },
        { label: 'Bill date', width: 100 },
        { label: 'Document', width: 140 },
        { label: 'Amount voided', width: 110, align: 'right' },
      ],
      rows: voided.map((v) => [
        v.invoiceNumber || '—',
        formatDateOfTimestamp(v.createdAt),
        DOCUMENT_TYPE_LABEL[v.documentType] || v.documentType,
        formatAmount(v.totalAmount),
      ]),
      fontSize: 8,
      rowHeight: 14,
    });
  }

  // Sign-off: the page an accountant initials before it goes in the file.
  layout.ensure(60);
  layout.y += 24;
  pdf.setDrawColor(RULE).setLineWidth(0.6).setFont('helvetica', 'normal').setFontSize(8).setTextColor(MUTED);
  [['Prepared by', MARGIN], ['Checked by', MARGIN + 270], ['Date', MARGIN + 540]].forEach(([label, x]) => {
    pdf.line(x, layout.y, x + 200, layout.y);
    pdf.text(label, x, layout.y + 10);
  });
  pdf.setTextColor(INK);

  const pageCount = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(RULE).setLineWidth(0.5);
    pdf.line(MARGIN, pageHeight - MARGIN - 4, layout.right, pageHeight - MARGIN - 4);
    pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(MUTED);
    pdf.text(clip(pdf, `${name} · GST register, ${period} · All amounts in Rs. · Voided bills excluded`, CONTENT_WIDTH - 80), MARGIN, pageHeight - MARGIN + 6);
    pdf.text(`Page ${page} of ${pageCount}`, layout.right, pageHeight - MARGIN + 6, { align: 'right' });
  }

  return pdf.output('blob');
}

export async function downloadGstReportPdf(report) {
  triggerDownload(await buildGstReportPdf(report), reportFilename(report));
}
