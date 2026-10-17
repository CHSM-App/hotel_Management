// Turns the simulator's quotation sheet into an A4 PDF.
//
// A sibling of billPaper.js rather than a caller of it: a bill is one slip
// scaled to fit whatever stock is in the printer, and a quotation is an A4
// letter that runs to as many pages as it has rooms. The capture itself is the
// same — html-to-image, so the engine that laid the sheet out is the one that
// paints it.

// A4 at 96 CSS pixels to the inch. The sheet is laid out at exactly this width,
// so one CSS pixel is the same fraction of the page in the file as on screen.
export const QUOTE_PAGE_WIDTH = 794;
export const QUOTE_PAGE_HEIGHT = 1123;

// Device pixels per CSS pixel. Two rather than the bill's three: a long
// quotation is captured as one tall canvas before it is cut into pages, and a
// browser caps a canvas at 32,767px a side.
const PIXEL_RATIO = 2;

// White space above and below the cut on every page after the first, in CSS
// pixels. The first page needs none above: the sheet opens with its own band.
const CUT_MARGIN = 40;

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const underHundred = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const underThousand = (n) =>
  n < 100 ? underHundred(n) : `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${underHundred(n % 100)}` : ''}`;

// Whole numbers in the Indian grouping — thousand, lakh, crore.
function wholeInWords(n) {
  if (n === 0) return 'zero';
  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${wholeInWords(crore)} crore`);
  if (lakh) parts.push(`${underHundred(lakh)} lakh`);
  if (thousand) parts.push(`${underHundred(thousand)} thousand`);
  if (rest) parts.push(underThousand(rest));
  return parts.join(' ');
}

// "Rupees four thousand four hundred only", the line a quotation is expected to
// carry under its total.
export function rupeesInWords(amount) {
  const paiseTotal = Math.round(Number(amount) * 100);
  if (!Number.isFinite(paiseTotal) || paiseTotal < 0) return '';
  const rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  return `Rupees ${wholeInWords(rupees)}${paise ? ` and ${underHundred(paise)} paise` : ''} only`;
}

// The logo as a data: URI, so the capture carries it rather than reaching for
// it. html-to-image draws inside an SVG, which cannot fetch across origins on
// its own; null (and the monogram) when the image cannot be had.
export async function imageAsDataUrl(url) {
  try {
    const blob = await (await fetch(url)).blob();
    if (!blob.type.startsWith('image/')) return null;
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// `node` is the offscreen sheet, laid out at QUOTE_PAGE_WIDTH. Anything inside
// it marked data-quote-break is a place the page may be cut after — the end of
// a table row or of a block — so a line of figures is never sliced in half.
export async function buildQuotationPdfBlob(node) {
  const [{ jsPDF }, { toCanvas, getFontEmbedCSS }] = await Promise.all([import('jspdf'), import('html-to-image')]);

  // A capture raced against the webfonts would be laid out in one face and
  // painted in another.
  await document.fonts.ready;

  // One page: the sheet is stretched to the full A4 so its sign-off sits at the
  // foot. Longer than that and it keeps its own length, to be cut below.
  const singlePage = node.offsetHeight <= QUOTE_PAGE_HEIGHT;
  if (singlePage) node.style.minHeight = `${QUOTE_PAGE_HEIGHT}px`;

  const top = node.getBoundingClientRect().top;
  const breaks = [...node.querySelectorAll('[data-quote-break]')]
    .map((el) => Math.round(el.getBoundingClientRect().bottom - top))
    .sort((a, b) => a - b);
  const height = node.offsetHeight;

  let fontEmbedCSS;
  try {
    fontEmbedCSS = await getFontEmbedCSS(node);
  } catch {
    fontEmbedCSS = undefined;
  }

  let canvas;
  try {
    canvas = await toCanvas(node, {
      fontEmbedCSS,
      pixelRatio: PIXEL_RATIO,
      backgroundColor: '#ffffff',
      style: { boxShadow: 'none' },
    });
  } finally {
    if (singlePage) node.style.minHeight = '';
  }

  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  // Points per CSS pixel: the sheet's width is the page's width.
  const pt = pageWidth / QUOTE_PAGE_WIDTH;
  const ratio = canvas.width / QUOTE_PAGE_WIDTH;

  if (singlePage) {
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageWidth, (canvas.height / ratio) * pt);
    return pdf.output('blob');
  }

  // Cut at the last allowed break that still fits, page after page.
  const cuts = [];
  let from = 0;
  while (from < height) {
    const room = QUOTE_PAGE_HEIGHT - CUT_MARGIN - (cuts.length ? CUT_MARGIN : 0);
    const limit = from + room;
    let to = height;
    if (limit < height) {
      const fitting = breaks.filter((b) => b > from && b <= limit);
      to = fitting.length ? fitting[fitting.length - 1] : limit;
    }
    cuts.push([from, to]);
    from = to;
  }

  cuts.forEach(([start, end], index) => {
    if (index > 0) pdf.addPage();
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = Math.max(1, Math.round((end - start) * ratio));
    const ctx = slice.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, Math.round(start * ratio), canvas.width, slice.height, 0, 0, canvas.width, slice.height);
    const y = index === 0 ? 0 : CUT_MARGIN * pt;
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, y, pageWidth, (end - start) * pt);
    pdf.setFontSize(8);
    pdf.setTextColor(122, 132, 151);
    pdf.text(`Page ${index + 1} of ${cuts.length}`, pageWidth / 2, pageHeight - 14, { align: 'center' });
  });
  return pdf.output('blob');
}
