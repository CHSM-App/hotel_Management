// Renders the first page of the shared bill/receipt PDF onto the <canvas> in
// the landing page (public.controller.js's shareLandingPage). An external,
// same-origin module rather than an inline <script>: the app's CSP locks
// script-src to 'self' with no 'unsafe-inline', so an inline block here would
// be silently dropped just like the cdnjs <script src> this replaced.
//
// Reads its target from the page itself (a data attribute on #preview)
// instead of a query string, so the PDF URL never has to round-trip through
// this file's own src="" attribute.
import * as pdfjsLib from './pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;

const container = document.getElementById('preview');
const hint = document.getElementById('previewHint');
const viewHref = container.dataset.viewHref;

pdfjsLib.getDocument(viewHref).promise
  .then((pdf) => pdf.getPage(1))
  .then((page) => {
    const unscaled = page.getViewport({ scale: 1 });
    // The canvas is displayed at container width via CSS (width: 100%), but
    // its pixel buffer is sized separately below — on a high-DPI phone
    // screen, matching only the CSS width leaves the buffer at roughly a
    // third of the physical pixels the screen actually has, so the browser
    // upscales it and the bill reads as blurry. Multiplying by
    // devicePixelRatio renders at the screen's real pixel density instead.
    const dpr = window.devicePixelRatio || 1;
    const cssScale = (container.clientWidth || 320) / unscaled.width;
    const scale = Math.min(4, cssScale * dpr);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width / dpr}px`;
    canvas.style.height = `${viewport.height / dpr}px`;
    const ctx = canvas.getContext('2d');
    return page.render({ canvasContext: ctx, viewport }).promise.then(() => {
      container.innerHTML = '';
      container.appendChild(canvas);
    });
  })
  .catch(() => {
    hint.textContent = 'Preview unavailable. Use Download below.';
  });
