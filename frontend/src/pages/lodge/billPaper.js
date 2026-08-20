// The paper a printed document lands on, and the machinery that fits it there.
//
// Shared by every document this system prints — the stay bill, the food bill
// and the advance receipt. They come off the same printer, out of the same
// tray, onto the same stock, so the sheet table, the fit formula and the PDF
// capture have to be one implementation: the moment a receipt fits its page
// differently from a bill, one of the two previews is lying about the paper.
//
// Lifted out of Billing.jsx unchanged when the advance receipt needed it.

// Fallback width for the PDF capture, in CSS pixels — roughly an A4 content
// column at 96dpi. Normally the capture copy is sized to the visible preview at
// download time, so the file shows exactly the layout the user was looking at;
// this only decides it if that preview couldn't be measured.
export const BILL_PDF_WIDTH = 760;

// The stock a bill can be printed on. One table drives both outputs: the
// browser's own print dialog, via a class on <html> that picks an @page rule
// (see BillDocument.css), and the downloaded PDF, via the jsPDF format.
//
// They have to come from the same row. A desk that picks A5, prints it, then
// downloads the same bill as an A4 PDF has been given two different documents
// and no reason to expect it.
//
// `format` is what jsPDF takes: a named size it knows, or [width, height] in
// points for one it doesn't. A roll has no page height, so it gets a nominal
// long sheet — the bill is scaled to fit whichever dimension is tighter, and
// on a roll that is always the width.
//
// `page` is the CSS `size`/`margin` pair for the browser's own print dialog.
// It cannot live in the stylesheet: @page is only legal at the top level, so
// it can't be nested under a class, and it is resolved before the cascade
// reaches any element, so it can't read a custom property either. The rule is
// therefore written into a <style> tag at print time and taken out again after.
// `pt` is the sheet in points, the same unit jsPDF works in. It is stated here
// even where `format` is a name jsPDF already knows, because the on-screen
// preview needs the proportions to draw the paper — and a second table of
// dimensions is a second thing to get out of step with this one.
export const PAPER_SIZES = [
  { id: 'a4', label: 'A4', hint: '210 × 297 mm', format: 'a4', page: 'A4', margin: '12mm', pt: [595.28, 841.89] },
  { id: 'a5', label: 'A5', hint: '148 × 210 mm', format: 'a5', page: 'A5', margin: '8mm', pt: [419.53, 595.28] },
  { id: 'a6', label: 'A6', hint: '105 × 148 mm', format: 'a6', page: 'A6', margin: '5mm', pt: [297.64, 419.53] },
  {
    id: 'letter',
    label: 'Letter',
    hint: '8.5 × 11 in',
    format: 'letter',
    page: 'letter',
    margin: '12mm',
    pt: [612, 792],
  },
  {
    id: 'half-letter',
    label: 'Half Letter',
    hint: '8.5 × 5.5 in',
    format: [612, 396],
    page: '8.5in 5.5in',
    margin: '8mm',
    pt: [612, 396],
  },
  {
    id: 'thermal-80',
    label: '80mm roll',
    hint: 'thermal receipt',
    // Width only — the height in the PDF is measured from the bill itself.
    // 226.77pt is 80mm. The second figure is a placeholder jsPDF never sees.
    format: [226.77, 850],
    continuous: true,
    // Height auto: a roll has no page to break against, and pinning one would
    // cut the memo off at whatever length was guessed.
    page: '80mm auto',
    margin: '3mm',
    // The preview draws a roll as a tall strip rather than a sheet — there is
    // no page height to be faithful to, so this is only how much of the roll
    // to show before it runs off the bottom.
    pt: [226.77, 560],
  },
];

// Margin on a roll, in points (~3mm) — matching the @page margin above, so the
// printed slip and the downloaded one have the same edge.
export const ROLL_MARGIN = 8.5;

// Device pixels per CSS pixel in the capture. Named because the PDF fit maths
// has to divide it back out to find the bill's natural size on paper.
export const CAPTURE_PIXEL_RATIO = 3;

// How wide a sheet is drawn in the paper picker, in CSS pixels. Wide enough
// that the memo's own structure is legible at a glance — masthead, ruled
// block, money column — without six of them filling the modal.
export const PAPER_PREVIEW_WIDTH = 190;

// The widest stock on offer, in points. Every preview is drawn against this so
// the sheets keep their sizes relative to each other.
export const WIDEST_PAPER_PT = Math.max(...PAPER_SIZES.map((p) => p.pt[0]));

// The @page margins are written as CSS lengths; the fit maths needs them as
// numbers. Only mm and in appear in PAPER_SIZES, and an unrecognised unit
// falls back to no margin rather than throwing mid-print.
export function mmToPt(value) {
  const m = /^([\d.]+)(mm|in)$/.exec(String(value).trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2] === 'in' ? n * 72 : (n * 72) / 25.4;
}

// Print CSS is laid out at 96 CSS pixels to the inch, whatever the printer's
// own resolution — so a point converts at 96/72.
export const ptToPx = (pt) => (pt * 96) / 72;

// The stay block's own height before any sheet-filling stretch is added — the
// open space the printed form leaves under the entries. Kept in step with the
// .memo__stay rule in BillDocument.css.
export const STAY_BASE_HEIGHT = 130;

// How a bill lands on a sheet, answered once for all three outputs — the print
// dialog, the PDF, and each thumbnail. Width decides the scale, and the height
// left under the fitted bill goes to the open stay block, so the form runs the
// full page instead of stopping wherever its entries did. Height only binds
// when the bill is too tall even at full width (a landscape sheet, a long
// itemised tab); a roll has no bottom to fill and stretches nothing.
//
// Three callers, one formula, because they are three pictures of the same
// sheet: the moment one of them fits differently, the previews are lying about
// one of the other two.
export function fitBillToSheet(availWidth, availHeight, naturalWidth, naturalHeight, continuous) {
  const fitWidth = availWidth / naturalWidth;
  const fitHeight = !continuous && naturalHeight > 0 ? availHeight / naturalHeight : Infinity;
  const scale = Math.min(fitWidth, fitHeight, 1);
  const slack = !continuous && naturalHeight > 0 ? availHeight / scale - naturalHeight : 0;
  return { scale, stayHeight: STAY_BASE_HEIGHT + (slack > 24 ? slack : 0) };
}

export const DEFAULT_PAPER = 'a4';

export const paperById = (id) => PAPER_SIZES.find((p) => p.id === id) ?? PAPER_SIZES[0];

// Renders one document node to a PDF blob on the chosen stock.
//
// `node` is an offscreen copy laid out at a fixed width and never restyled —
// which is what makes it an honest measurement, and what keeps the visible
// document from being mutated mid-download. `shownWidth` is the width the user
// is actually looking at, so the capture wraps its text identically.
export async function buildDocumentPdfBlob(node, { paperSize, shownWidth }) {
  // html-to-image, not html2canvas — the difference is who paints the text.
  // html2canvas re-draws every glyph itself with its own baseline arithmetic,
  // which is known to sit text a few pixels below where the browser put it, and
  // to mis-advance tracked or tabular-figure runs. html-to-image serialises the
  // DOM into an SVG foreignObject and hands it back to the browser to
  // rasterise: the engine that painted the preview paints the file, so the PDF
  // cannot disagree with the screen about where a line of text sits.
  const [{ jsPDF }, { toCanvas }] = await Promise.all([import('jspdf'), import('html-to-image')]);

  node.parentElement.style.width = `${shownWidth || BILL_PDF_WIDTH}px`;

  // The webfonts must be resolved before capture: a capture raced against Inter
  // still loading would be laid out in one font and painted in another.
  await document.fonts.ready;

  // Stretched to the chosen sheet before rasterising, the same way the print
  // dialog and the thumbnails fill theirs — the stay block takes whatever
  // height the fitted document leaves. Measured before the variable is set and
  // restored after, so the copy stays an honest measurement for everything else
  // that reads it.
  const paper = paperById(paperSize);
  const capturedWidth = node.offsetWidth;
  const capturedHeight = node.offsetHeight;
  if (!paper.continuous) {
    const [pwPt, phPt] = paper.pt;
    const marginPt = Math.min(24, pwPt * 0.04);
    const { stayHeight } = fitBillToSheet(
      ptToPx(pwPt - marginPt * 2),
      ptToPx(phPt - marginPt * 2),
      capturedWidth,
      capturedHeight,
      false
    );
    node.style.setProperty('--memo-stay-h', `${Math.round(stayHeight)}px`);
  }

  let canvas;
  try {
    canvas = await toCanvas(node, {
      // Three device pixels per CSS pixel. The text is rasterised, not embedded,
      // so resolution is all that stands between the reader and visibly soft
      // 9px captions.
      pixelRatio: CAPTURE_PIXEL_RATIO,
      backgroundColor: '#ffffff',
      // Screen furniture with no meaning on paper: a clipped box can crop a
      // border, a shadow becomes a grey smear down the edge of the sheet, and
      // rounded corners read as a web card. Applied to the capture clone only.
      style: { overflow: 'visible', boxShadow: 'none', borderRadius: '0' },
    });
  } finally {
    node.style.removeProperty('--memo-stay-h');
  }
  const imgData = canvas.toDataURL('image/png');

  // A roll is cut to length, not folded to a page: its height is whatever the
  // document came to. A fixed length would either cut a long one off or spit
  // out a foot of blank paper after a short one, and on a receipt printer that
  // waste is per document.
  const rollWidth = Array.isArray(paper.format) && paper.continuous ? paper.format[0] : null;
  const format = rollWidth
    ? [rollWidth, Math.max(120, (rollWidth - ROLL_MARGIN * 2) * (canvas.height / canvas.width) + ROLL_MARGIN * 2)]
    : paper.format;

  const pdf = new jsPDF({ unit: 'pt', format });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  // A flat 24pt margin is a tenth of an A6's width and would leave the document
  // printing in the middle of it, so smaller stocks get a proportional margin.
  const margin = rollWidth ? ROLL_MARGIN : Math.min(24, pageWidth * 0.04);

  // A bill or a receipt is a single slip, not a flowing document — scaled down
  // to whichever dimension is tighter so it always lands on one page, rather
  // than printing at full width and spilling onto a near-blank second page.
  //
  // Never scaled *up*: a small slip blown up to fill a Letter sheet is a 30px
  // masthead and a memo that reads as a poster. It sits at its natural size,
  // centred, and the paper simply has room to spare.
  const maxWidth = pageWidth - margin * 2;
  const maxHeight = pageHeight - margin * 2;
  const naturalScale = (72 / 96) / CAPTURE_PIXEL_RATIO;
  const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height, naturalScale);
  const imgWidth = canvas.width * scale;
  const imgHeight = canvas.height * scale;
  const x = (pageWidth - imgWidth) / 2;

  pdf.addImage(imgData, 'PNG', x, margin, imgWidth, imgHeight);
  return pdf.output('blob');
}

// Prints one document on the chosen stock: write the @page rule, mark <html> so
// the stylesheet's per-paper rules apply, print, then undo both.
//
// window.print() blocks until the dialog closes in the browsers this runs on,
// so tearing down straight after is safe. The removal sits in a finally
// regardless — a stranded rule would silently repaper every later print in the
// app, which is a bug nobody would think to look here for.
export function printDocumentOnPaper(node, paperSize) {
  const paper = paperById(paperSize);

  // What the sheet can hold, in CSS pixels. @page margins are in real units, so
  // the printable area is the paper less its margins converted at 96dpi — the
  // ratio the browser itself lays print CSS out at.
  const [pwPt, phPt] = paper.pt;
  const marginPt = mmToPt(paper.margin);
  const pageWidthPx = ptToPx(pwPt - marginPt * 2);
  const pageHeightPx = ptToPx(phPt - marginPt * 2);

  const naturalWidth = node?.offsetWidth || BILL_PDF_WIDTH;
  const naturalHeight = node?.offsetHeight || 0;

  const { scale, stayHeight } = fitBillToSheet(
    pageWidthPx,
    pageHeightPx,
    naturalWidth,
    naturalHeight,
    paper.continuous
  );

  const style = document.createElement('style');
  style.media = 'print';
  style.textContent =
    `@page { size: ${paper.page}; margin: ${paper.margin}; }\n` +
    // Width is divided back out by the scale so the form still fills the sheet
    // edge to edge after shrinking — scaling alone would leave a proportional
    // strip of white down the right-hand side.
    `.bill-print-target { --bill-print-scale: ${scale}; width: ${100 / scale}%; ` +
    // The same variable the stay block is sized by everywhere — the thumbnails
    // set it per sheet, this sets it for the sheet being printed.
    `--memo-stay-h: ${Math.round(stayHeight)}px; }`;

  document.head.appendChild(style);
  try {
    window.print();
  } finally {
    style.remove();
  }
}

// Hands a finished PDF blob to the user: the OS share sheet where there is one
// (a desk on a tablet messages the guest their receipt), a download otherwise.
export async function shareOrDownloadPdf(blob, filename) {
  const file = new File([blob], filename, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: filename });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
