// Turns the on-screen menu-card pages into a PDF, one PDF page per card page.
//
// The pages are captured from the very DOM the preview shows (html-to-image
// paints with the browser's own layout engine), so what is downloaded is what
// was previewed. Pages are rasterised at 3x — about 290 dpi on A4 — which keeps
// type and fine gold rules crisp in print; the text is therefore not
// selectable in the file. The webfonts are inlined into each capture so the
// faces used on screen are the ones painted.
import { PAPER } from './menuCardModel';

const PIXEL_RATIO = 3;

export async function imageToDataUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function buildMenuCardPdf(nodes, { paper, orient }) {
  const [{ jsPDF }, { toJpeg, getFontEmbedCSS }] = await Promise.all([import('jspdf'), import('html-to-image')]);
  await document.fonts.ready;

  const [pw, ph] = (PAPER[paper] || PAPER.A4).pdf;
  const landscape = orient === 'landscape';
  const pdf = new jsPDF({
    unit: 'pt',
    format: landscape ? [ph, pw] : [pw, ph],
    orientation: landscape ? 'landscape' : 'portrait',
    compress: true,
  });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();

  let fontEmbedCSS;
  try {
    fontEmbedCSS = await getFontEmbedCSS(nodes[0]);
  } catch {
    fontEmbedCSS = undefined;
  }

  for (let i = 0; i < nodes.length; i += 1) {
    const data = await toJpeg(nodes[i], {
      fontEmbedCSS,
      pixelRatio: PIXEL_RATIO,
      quality: 0.96,
      cacheBust: false,
      style: { transform: 'none', margin: '0' },
    });
    if (i > 0) pdf.addPage();
    pdf.addImage(data, 'JPEG', 0, 0, W, H, undefined, 'FAST');
  }
  return pdf.output('blob');
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
