const path = require('path');
const PDFDocument = require('pdfkit');

// The same printed voucher the desk hands a guest at the counter
// (AdvanceReceiptDocument.jsx / BillDocument.css's ".memo" rules) — ruled
// masthead, dotted fill-in lines, boxed Rs/Ps totals, boxed amount, signature
// lines — rebuilt with pdfkit's drawing primitives rather than HTML/CSS,
// because this renders on the server with no browser behind it. It exists so
// the booking-confirmation WhatsApp message, which fires automatically right
// after the booking is saved, has a real receipt to link to rather than
// nothing: see receiptShare.service.js's createAutoReceiptLink.
//
// `receipt` is the object advanceReceipts.service.js's mapReceipt already
// returns — the same shape the browser's own document reads.

// Landscape, not A5 portrait: every field this layout lines up side by side
// ("No.- X  Date - Y", "Received with thanks from X  Mob. No. Y", ...) needs
// the room to actually sit on one line — at A5's 419.53pt width those pairs
// wrapped, so the WhatsApp copy read as a taller, more cramped document than
// the one the website renders at its natural (much wider) width. 612pt
// matches the width of "Half Letter", the one landscape stock in the paper
// picker (billPaper.js's PAPER_SIZES); the height is taller than that stock's
// 396pt because this is a single-column layout with no page to spill a second
// column onto — 580pt leaves a measured ~40-80pt of clearance under the
// signature line against the longest real receipt (a GST event receipt, a
// three-way split payment, booking id, long names) tried while sizing this.
const PAGE_W = 612;
const PAGE_H = 580;
const MARGIN = 24;
const INNER_L = MARGIN + 10;
const INNER_R = PAGE_W - MARGIN - 10;
const INNER_W = INNER_R - INNER_L;
const LINE_COLOR = '#2c3742'; // same ink as --bill-line in BillDocument.css

const DOCUMENT_LABEL = {
  RECEIPT_VOUCHER: 'Receipt Voucher',
  ADVANCE_RECEIPT: 'Advance Receipt',
};

const PAY_METHODS = [
  { key: 'CASH', label: 'Cash' },
  { key: 'UPI', label: 'UPI' },
  { key: 'CARD', label: 'Card' },
];

// A Unicode font registered once and used for exactly one glyph: pdfkit's
// standard fonts (Helvetica, Times) use WinAnsi encoding, which has no rupee
// sign — it would otherwise render as a garbled stray character. Mukta (SIL
// OFL, vendored at build time from @fontsource/mukta) is Google's Devanagari
// family for Indian currency/typesetting and carries it. Kept as its own font
// rather than folded into Inter below: a wider embed of this particular
// compiled font turned out to drop digits and most letters (a fontkit quirk
// with this file, not a licensing or coverage issue) — isolating it to the ₹
// sign alone sidesteps that entirely.
const RUPEE_FONT = path.join(__dirname, '../../assets/fonts/mukta-rupee-700.woff');
const RUPEE = '₹';

// Everything else on the page used to stay on pdfkit's standard, unembedded
// Helvetica/Times — fine in a desktop PDF viewer, but pdf.js (the renderer
// behind the preview on the landing page a WhatsApp guest actually taps
// through to) draws an unembedded standard font with its own generic
// substitute glyphs, which read visibly softer than the website's own text.
// Embedding the website's real faces — Inter (sans) and Fraunces (serif),
// same families frontend/index.css names as --sans/--serif — makes every
// viewer draw the actual outlines instead of guessing at a stand-in, so the
// WhatsApp copy reads as crisp as the page it was built to match. Vendored as
// static per-weight TTFs (Google's old css?family= endpoint, not the
// variable-font file the current css2 endpoint serves, which a single
// doc.registerFont call can't select a weight out of).
const SANS_FONT = path.join(__dirname, '../../assets/fonts/inter-400.ttf');
const SANS_BOLD_FONT = path.join(__dirname, '../../assets/fonts/inter-700.ttf');
const SERIF_BOLD_FONT = path.join(__dirname, '../../assets/fonts/fraunces-700.ttf');

// Indian numbering (Lakh/Crore), matching the words the printed pad uses —
// ported from frontend/src/pages/lodge/numberToWords.js so the server-
// rendered copy reads the same sentence a guest would see on paper.
const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${TENS[tens]}${ones ? ` ${ONES[ones]}` : ''}`;
}

function threeDigits(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return twoDigits(rest);
  return `${ONES[hundreds]} Hundred${rest ? ` ${twoDigits(rest)}` : ''}`;
}

function integerToWords(n) {
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = n;

  const parts = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));
  return parts.join(' ');
}

function amountInWords(amount) {
  const n = Math.round(Math.abs(Number(amount) || 0) * 100) / 100;
  const rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);
  let words = `Rupees ${integerToWords(rupees)}`;
  if (paise > 0) words += ` and ${integerToWords(paise)} Paise`;
  return `${words} Only`;
}

// Accommodation's place of supply is the property's own state; the code is
// the first two digits of the GSTIN by definition, same rule billing.service.js
// and the printed document both follow.
function placeOfSupply(receipt) {
  if (!receipt.lodgeState) return null;
  const code = /^\d{2}/.exec(receipt.gstin || '');
  return code ? `${receipt.lodgeState} (${code[0]})` : receipt.lodgeState;
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function nightsOf(receipt) {
  if (!receipt.checkInDate || !receipt.checkOutDate) return null;
  const from = new Date(`${receipt.checkInDate}T00:00:00Z`);
  const to = new Date(`${receipt.checkOutDate}T00:00:00Z`);
  const n = Math.round((to - from) / 86400000);
  return n > 0 ? n : 1;
}

function formatHeadCount(numGuests, childCount) {
  if (!numGuests) return null;
  const children = Number(childCount) || 0;
  if (children <= 0 || children >= numGuests) return String(numGuests);
  const adults = numGuests - children;
  const adultWord = adults === 1 ? 'Adult' : 'Adults';
  const childWord = children === 1 ? 'Child' : 'Children';
  return `${numGuests} (${adults} ${adultWord}, ${children} ${childWord})`;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function renderReceiptPdf(receipt) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    // Registered fresh on every document: pdfkit's font registry is per
    // PDFDocument instance, not global — registering this once at module
    // load would leave every document after the first with no 'Rupee' font
    // to find.
    doc.registerFont('Rupee', RUPEE_FONT);
    doc.registerFont('Inter', SANS_FONT);
    doc.registerFont('Inter-Bold', SANS_BOLD_FONT);
    doc.registerFont('Fraunces-Bold', SERIF_BOLD_FONT);

    // The ruled border the whole voucher sits inside, same as the printed
    // pad's own box (.bill-doc's 1px frame).
    doc.rect(MARGIN, MARGIN, PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN).lineWidth(1).strokeColor(LINE_COLOR).stroke();

    const isGst = receipt.billingSide === 'GST';
    const isVoid = receipt.status === 'VOID';
    const isEvent = receipt.kind === 'EVENT';
    const kindLabel = DOCUMENT_LABEL[receipt.documentType] || DOCUMENT_LABEL.ADVANCE_RECEIPT;
    const nights = nightsOf(receipt);
    const paidInFull = Number(receipt.balanceDue) <= 0.005;

    const paymentLines = receipt.paymentLines?.length
      ? receipt.paymentLines
      : [{ method: receipt.paymentMethod, amount: receipt.amountReceived, reference: receipt.paymentReference }];
    const split = paymentLines.length > 1;
    const paidBy = new Set(paymentLines.map((line) => line.method));
    const splitSummary = [
      ...paymentLines.map((line) => `${PAY_METHODS.find((m) => m.key === line.method)?.label || line.method} ${line.amount}`),
      ...paymentLines.filter((line) => line.reference).map((line) => `Txn No. ${line.reference}`),
    ].join(' · ');

    let y = MARGIN;

    // Every section below ends by calling this: a full-width rule, the same
    // "border-top on the next row" look every .memo__row/.memo__fill carries
    // in the printed document, rather than fields just floating in open space.
    function ruleUnder() {
      doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.75).strokeColor(LINE_COLOR).stroke();
    }

    // --- Masthead --------------------------------------------------------
    y += 10;
    doc.font('Inter').fontSize(9).fillColor('#000');
    if (receipt.lodgePhone) {
      doc.text(`Mob. ${receipt.lodgePhone}`, INNER_L, y, { width: INNER_W, align: 'right' });
    }
    // Serif + underline, matching .memo__kind's font-family: var(--serif);
    // text-decoration: underline.
    doc.font('Fraunces-Bold').fontSize(12).text(kindLabel, INNER_L, y, { width: INNER_W, align: 'center', underline: true });
    y += 17;

    // Serif display weight, matching .memo__name's heavy uppercase masthead.
    doc.font('Fraunces-Bold').fontSize(19).text((receipt.lodgeName || '').toUpperCase(), INNER_L, y, {
      width: INNER_W,
      align: 'center',
    });
    y = doc.y + 6;

    const addrLine = [receipt.lodgeAddress, receipt.lodgeCity, receipt.lodgeState].filter(Boolean).join(', ');
    if (addrLine) {
      doc.font('Inter').fontSize(9).text(addrLine, INNER_L, y, { width: INNER_W, align: 'center' });
      y = doc.y;
    }
    y += 6;
    ruleUnder();

    // --- No. / Date --------------------------------------------------------
    const halfW = INNER_W / 2;
    y += 6;
    doc.font('Inter').fontSize(9.5);
    doc.text('No.-', INNER_L, y, { continued: true }).font('Inter-Bold').text(` ${receipt.receiptNumber || '-'}`, {
      continued: false,
    });
    doc
      .font('Inter')
      .text('Date -', INNER_L + halfW, y, { continued: true })
      .font('Inter-Bold')
      .text(` ${formatDate(receipt.createdAt) || '-'}`);
    y += 13;
    ruleUnder();

    // --- Booking ID --------------------------------------------------------
    if (receipt.bookingNumber) {
      y += 6;
      doc
        .font('Inter')
        .fontSize(9.5)
        .text('Booking ID', INNER_L, y, { continued: true })
        .font('Inter-Bold')
        .text(`  ${receipt.bookingNumber}`);
      y += 13;
      ruleUnder();
    }

    // --- Received from / Mob. No. -------------------------------------------
    y += 6;
    doc
      .font('Inter')
      .fontSize(9.5)
      .text('Received with thanks from', INNER_L, y, { continued: true })
      .font('Inter-Bold')
      .text(` ${receipt.guestName || '-'}`);
    if (receipt.guestPhone) {
      doc
        .font('Inter')
        .text('Mob. No.', INNER_L + halfW + 20, y, { continued: true })
        .font('Inter-Bold')
        .text(` ${receipt.guestPhone}`);
    }
    y += 13;
    ruleUnder();

    // --- What the advance is against -----------------------------------------
    y += 6;
    doc.font('Inter-Bold').fontSize(9.5);
    if (isEvent) {
      const line = [
        receipt.venueName,
        receipt.eventTitle,
        formatDate(receipt.eventStartAt) ? `dt. ${formatDate(receipt.eventStartAt)}` : null,
      ]
        .filter(Boolean)
        .join('  ');
      doc.text(line || '-', INNER_L, y, { width: INNER_W });
      y = doc.y;
    } else {
      const line = [
        receipt.roomNumber ? `Room No. ${receipt.roomNumber}` : null,
        formatDate(receipt.checkInDate) ? `dt. ${formatDate(receipt.checkInDate)}` : null,
        nights ? `(${nights} Days)` : null,
        receipt.numGuests ? `Persons - ${formatHeadCount(receipt.numGuests, receipt.childCount)}` : null,
      ]
        .filter(Boolean)
        .join('  ');
      doc.text(line || '-', INNER_L, y, { width: INNER_W });
      y = doc.y;
      if (receipt.isDormitory) {
        const bedLine = receipt.bedLabel ? `Dormitory bed — ${receipt.bedLabel}` : 'Dormitory (whole room)';
        doc.font('Inter').fontSize(8.5).text(`Bed: ${bedLine}`, INNER_L, y, { width: INNER_W });
        y = doc.y;
      }
    }
    y += 6;
    ruleUnder();

    // --- Sum of rupees in words --------------------------------------------
    y += 6;
    doc
      .font('Inter')
      .fontSize(9.5)
      .text('the sum of Rupees', INNER_L, y, { continued: true })
      .font('Inter-Bold')
      .text(` ${amountInWords(receipt.amountReceived)}`, { width: INNER_W });
    y = doc.y + 6;
    ruleUnder();

    // --- Payment method checkboxes ------------------------------------------
    y += 6;
    doc.font('Inter').fontSize(9.5).text('by', INNER_L, y, { continued: false });
    let boxX = INNER_L + 16;
    const boxY = y + 1;
    for (const { key, label } of PAY_METHODS) {
      const checked = paidBy.has(key);
      doc.rect(boxX, boxY, 8, 8).lineWidth(0.8).strokeColor('#000').stroke();
      if (checked) {
        doc
          .moveTo(boxX + 1.5, boxY + 4)
          .lineTo(boxX + 3.2, boxY + 7)
          .lineTo(boxX + 6.5, boxY + 1)
          .lineWidth(1.1)
          .stroke();
      }
      doc.font('Inter').fontSize(9).text(label, boxX + 11, y, { continued: false });
      boxX += 11 + doc.widthOfString(label) + 14;
    }
    if (split) {
      doc.font('Inter').fontSize(8.5).text(splitSummary, boxX, y, { width: INNER_R - boxX });
    } else if (paymentLines[0]?.reference) {
      doc.font('Inter').fontSize(9).text(`Txn No. ${paymentLines[0].reference}`, boxX, y, { width: INNER_R - boxX });
    }
    y += 13;
    ruleUnder();

    // --- Against bill (left blank at issue, same as the printed pad) ---------
    y += 6;
    doc
      .font('Inter')
      .fontSize(8.5)
      .fillColor('#555')
      .text('against full/part payment of our Bill No. ____________   Dated ____________', INNER_L, y, { width: INNER_W });
    doc.fillColor('#000');
    y += 12;
    ruleUnder();

    // --- Place of supply / reverse charge -----------------------------------
    if (isGst) {
      y += 6;
      const supply = placeOfSupply(receipt);
      doc
        .font('Inter')
        .fontSize(8.5)
        .text('Place of Supply', INNER_L, y, { continued: true })
        .font('Inter-Bold')
        .text(`  ${supply || '-'}`, { continued: false });
      doc
        .font('Inter')
        .text('Reverse Charge', INNER_L + halfW, y, { continued: true })
        .font('Inter-Bold')
        .text('  No');
      y += 13;
      ruleUnder();
    }

    // --- Totals table ---------------------------------------------------------
    // A boxed block on the right, with its own vertical divider between the
    // label and the Rs/Ps columns — same shape as .memo__totals's bordered
    // money column.
    const stayTotal = Number(receipt.stayTotal) || 0;
    const roundOff = Number(receipt.roundOff) || 0;

    const totalRows = [];
    if (stayTotal > 0) {
      if (roundOff !== 0) totalRows.push(['Sub Total', round2(stayTotal - roundOff), false]);
      if (roundOff !== 0) totalRows.push(['Round off', roundOff, false]);
      totalRows.push(['Stay Total', stayTotal, false]);
      totalRows.push(['Less: Advance Received', receipt.amountReceived, false]);
      totalRows.push(['BALANCE DUE', receipt.balanceDue, true]);
    }

    if (totalRows.length > 0) {
      const rowH = 15;
      const tblTop = y;
      const tblH = rowH * totalRows.length;
      const totalsX = INNER_L + INNER_W * 0.42;
      // dividerX used to sit only 76pt from the right edge, leaving the whole-
      // rupees column (psColX - dividerX - 8) just 38pt wide — enough for a
      // four-digit stay total but not a six/seven-digit one (a lakh-plus
      // function advance, easily over this page's digits with the Indian
      // comma grouping), which wrapped onto a second line and collided with
      // the paise column above or below it.
      const dividerX = INNER_R - 100;
      const psColX = INNER_R - 32;

      doc.rect(totalsX, tblTop, INNER_R - totalsX, tblH).lineWidth(0.75).strokeColor(LINE_COLOR).stroke();
      doc
        .moveTo(dividerX, tblTop)
        .lineTo(dividerX, tblTop + tblH)
        .lineWidth(0.75)
        .strokeColor(LINE_COLOR)
        .stroke();
      doc
        .moveTo(psColX, tblTop)
        .lineTo(psColX, tblTop + tblH)
        .lineWidth(0.5)
        .strokeColor('#8d99a4')
        .stroke();

      totalRows.forEach(([label, amount, bold], i) => {
        const rowY = tblTop + i * rowH;
        if (i > 0) {
          doc.moveTo(totalsX, rowY).lineTo(INNER_R, rowY).lineWidth(0.5).strokeColor('#8d99a4').stroke();
        }
        const n = Number(amount) || 0;
        const sign = n < 0 ? '-' : '';
        const paiseTotal = Math.round(Math.abs(n) * 100);
        const whole = Math.floor(paiseTotal / 100);
        const paise = paiseTotal % 100;
        const font = bold ? 'Inter-Bold' : 'Inter';
        const textY = rowY + 3;
        doc.font(font).fontSize(9).text(label, totalsX + 6, textY, { width: dividerX - totalsX - 10 });
        doc.font(font).fontSize(9).text(`${sign}${whole.toLocaleString('en-IN')}`, dividerX + 4, textY, {
          width: psColX - dividerX - 8,
          align: 'right',
        });
        doc.font(font).fontSize(9).text(String(paise).padStart(2, '0'), psColX, textY, {
          width: INNER_R - psColX,
          align: 'right',
        });
      });
      y = tblTop + tblH + 10;
    } else {
      y += 6;
    }

    // --- Boxed advance amount ------------------------------------------------
    const boxW = 110;
    const boxH = 32;
    doc.rect(INNER_L, y, boxW, boxH).lineWidth(1).strokeColor('#000').stroke();
    const advanceWhole = Math.floor(Math.round(Number(receipt.amountReceived || 0) * 100) / 100);
    const advancePaise = Math.round(Number(receipt.amountReceived || 0) * 100) % 100;
    const figure = `${advanceWhole.toLocaleString('en-IN')}${advancePaise ? `.${String(advancePaise).padStart(2, '0')}` : '/-'}`;
    const rupeeW = doc.font('Rupee').fontSize(15).widthOfString(RUPEE);
    const figureW = doc.font('Inter-Bold').fontSize(15).widthOfString(` ${figure}`);
    const startX = INNER_L + (boxW - rupeeW - figureW) / 2;
    const textY = y + 8;
    doc.font('Rupee').fontSize(15).fillColor('#000').text(RUPEE, startX, textY, { lineBreak: false });
    doc.font('Inter-Bold').fontSize(15).text(` ${figure}`, startX + rupeeW, textY, { lineBreak: false });
    y += boxH + 12;

    // --- Footer terms ----------------------------------------------------------
    doc.font('Inter').fontSize(7.5).fillColor('#444');
    const adjustNote = isEvent
      ? paidInFull
        ? 'This payment settles the function named above in full. Please keep this receipt.'
        : 'This advance is adjusted against the final bill for the function named above. Please keep this receipt for settlement.'
      : paidInFull
        ? 'This payment settles the stay named above in full. Please present this receipt at check-in.'
        : 'This advance is adjusted against the final bill for the stay named above. Please present this receipt at check-in.';
    doc.text(adjustNote, INNER_L, y, { width: INNER_W });
    y = doc.y + 1;
    if (isGst) {
      doc.text('This is a receipt voucher for an advance, not a tax invoice.', INNER_L, y, { width: INNER_W });
      y = doc.y + 1;
    }
    if (receipt.lodgeCity) {
      doc.text(`Subject to ${receipt.lodgeCity} Jurisdiction.`, INNER_L, y, { width: INNER_W });
      y = doc.y + 1;
    }
    if (isVoid) {
      doc
        .font('Inter-Bold')
        .fillColor('#b00')
        .text(`VOID${receipt.voidReason ? ` — ${receipt.voidReason}` : ''}`, INNER_L, y, { width: INNER_W });
      y = doc.y + 1;
    }
    doc.fillColor('#000');

    // --- Signatures --------------------------------------------------------
    const signY = y + 24;
    doc.font('Fraunces-Bold').fontSize(11).text('THANK YOU!', INNER_L, signY - 15, { width: INNER_W, align: 'center' });

    doc.font('Inter').fontSize(9);
    doc
      .moveTo(INNER_L, signY)
      .lineTo(INNER_L + 90, signY)
      .lineWidth(0.7)
      .strokeColor('#000')
      .stroke();
    doc.text('Guest’s Sign.', INNER_L, signY + 3, { width: 90, align: 'center' });

    doc
      .moveTo(INNER_R - 110, signY)
      .lineTo(INNER_R, signY)
      .lineWidth(0.7)
      .stroke();
    doc.text('For Prop. / Manager', INNER_R - 110, signY + 3, { width: 110, align: 'center' });

    doc.end();
  });
}

module.exports = { renderReceiptPdf };
