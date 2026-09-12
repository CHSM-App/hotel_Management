const { z } = require('zod');
const publicService = require('./public.service');
const billShareService = require('../billing/billShare.service');
const receiptShareService = require('../billing/receiptShare.service');
const { orderItemsSchema } = require('../orders/orders.schema');
const { ApiError } = require('../../middleware/errorHandler');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const guestFields = {
  guestName: z.string().trim().max(200).optional().default(''),
  guestPhone: z.string().trim().max(20).optional().default(''),
  note: z.string().trim().max(300).optional().default(''),
  items: orderItemsSchema,
};

// roomNumber moved out of the URL and into the body when ordering went to a
// single link — the room is something the guest asserts, alongside the PIN that
// backs the assertion, not something the address identifies.
const roomIdentity = {
  roomNumber: z.string().trim().min(1, 'Enter your room number.').max(20),
  pin: z.string().trim().min(1, 'Enter the PIN reception gave you.'),
};

const roomOrderSchema = z.object({ ...guestFields, ...roomIdentity });

// Sign-in, and reading back the guest's own orders. Both carry the identity and
// nothing else.
const roomIdentitySchema = z.object(roomIdentity);

const editOrderSchema = z.object({ ...guestFields, ...roomIdentity });

const tableOrderSchema = z.object(guestFields);

function parse(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0].message, 400);
  }
  return parsed.data;
}

async function getLodgePageHandler(req, res, next) {
  try {
    const lodge = await publicService.getLodgeBySlug(String(req.params.slug || ''));

    const checkInDate = String(req.query.checkInDate || '');
    const checkOutDate = String(req.query.checkOutDate || '');
    // Malformed or missing dates just fall back to the plain rate-card view
    // (no availability column) rather than erroring the whole page.
    const hasValidRange =
      DATE_RE.test(checkInDate) && DATE_RE.test(checkOutDate) && checkOutDate > checkInDate;

    // Each part of the page is gated on what the property is: a rooms-only
    // lodge sends no venues and no menu, so the page has nothing to hide, and
    // the flags on `lodge` tell the client which sections to draw at all.
    const [roomTypes, roomAddons, venues, addons, menu] = await Promise.all([
      lodge.hasRooms
        ? publicService.listPublicRoomTypes(
            lodge.id,
            hasValidRange ? checkInDate : null,
            hasValidRange ? checkOutDate : null
          )
        : [],
      lodge.hasRooms ? publicService.listPublicRoomAddons(lodge.id) : [],
      lodge.hasEvents ? publicService.listPublicVenues(lodge.id) : [],
      lodge.hasEvents ? publicService.listPublicAddons(lodge.id) : [],
      lodge.servesFood ? publicService.getPublicMenu(lodge.id) : [],
    ]);
    res.json({ lodge, roomTypes, roomAddons, venues, addons, menu });
  } catch (err) {
    next(err);
  }
}

// The single ordering page for the whole property.
async function getMenuPageHandler(req, res, next) {
  try {
    const context = await publicService.getLodgeOrderingContext(String(req.params.slug || ''));
    res.json(context);
  } catch (err) {
    next(err);
  }
}

async function getTableOrderPageHandler(req, res, next) {
  try {
    const context = await publicService.getTableOrderingContext(String(req.params.token || ''));
    res.json(context);
  } catch (err) {
    next(err);
  }
}

async function placeRoomOrderHandler(req, res, next) {
  try {
    const input = parse(roomOrderSchema, req.body);
    const result = await publicService.placeRoomOrder(
      String(req.params.slug || ''),
      input.roomNumber,
      input
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function openSessionHandler(req, res, next) {
  try {
    const input = parse(roomIdentitySchema, req.body);
    const session = await publicService.openGuestSession(
      String(req.params.slug || ''),
      input.roomNumber,
      input.pin
    );
    res.json(session);
  } catch (err) {
    next(err);
  }
}

// A read, sent as a POST, because what authorises it is a secret — and a secret
// in a query string is a secret in the browser history, in the proxy log and in
// the referrer of the next image the page loads.
async function listGuestOrdersHandler(req, res, next) {
  try {
    const input = parse(roomIdentitySchema, req.body);
    const result = await publicService.listGuestOrders(
      String(req.params.slug || ''),
      input.roomNumber,
      input.pin
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function updateGuestOrderHandler(req, res, next) {
  try {
    const input = parse(editOrderSchema, req.body);
    const result = await publicService.updateGuestOrder(
      String(req.params.slug || ''),
      input.roomNumber,
      input.pin,
      String(req.params.token || ''),
      input
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function cancelGuestOrderHandler(req, res, next) {
  try {
    const input = parse(roomIdentitySchema, req.body);
    const result = await publicService.cancelGuestOrder(
      String(req.params.slug || ''),
      input.roomNumber,
      input.pin,
      String(req.params.token || '')
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function placeTableOrderHandler(req, res, next) {
  try {
    const input = parse(tableOrderSchema, req.body);
    const result = await publicService.placeTableOrder(String(req.params.token || ''), input);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function getOrderStatusHandler(req, res, next) {
  try {
    const status = await publicService.getPublicOrderStatus(String(req.params.token || ''));
    res.json(status);
  } catch (err) {
    next(err);
  }
}

// Escapes the handful of characters that would otherwise let a guest name or
// invoice number break out of the HTML this handler writes by hand. The
// landing page has no templating engine behind it — it's one static-shaped
// string — so this is the whole of its defence against a stored value that
// happens to contain '<' or '&'.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

// The page a guest lands on when they tap the bill link in WhatsApp.
//
// An embedded preview (like the desk's own billing screen shows before
// sending) rather than just a download button: the guest can see the bill is
// theirs and looks right before saving anything, the same way the desk does.
// The download button stays alongside it — a phone's in-app browser PDF
// viewer varies by app, and the save control inside it is sometimes buried
// behind a menu, so a button the property controls is still the one place
// guaranteed to save the file.
//
// The preview is drawn onto a <canvas> with pdf.js rather than embedded via
// <iframe src="...pdf">: WhatsApp's in-app browser (and iOS Safari's
// webview generally) has no built-in PDF renderer to hand an iframe, so an
// iframe there shows a broken-file icon instead of the bill. Rendering the
// first page to a canvas draws it as a plain image, which every browser can
// do.
//
// pdf.js is vendored and served same-origin at /vendor/pdfjs (see app.js),
// not pulled from a CDN — the app's CSP locks script-src to 'self' as its
// XSS defence, so a <script src="https://cdnjs...">  (or an inline <script>
// block) is silently dropped rather than loaded. bill-preview.mjs there does
// the actual rendering; this page only points a module script at it.
//
// No-store — this is one guest's bill and the one place it must not be left
// is a shared proxy cache — and no styling library beyond pdf.js itself:
// this loads in a chat's in-app browser, on whatever connection the guest
// has, and has exactly one job.
// The one landing page both a shared bill and a shared receipt use, parked in
// one place so the two never quietly diverge in markup while meaning the same
// thing. `label` is what the page calls the document ("Bill" / "Receipt");
// `viewHref` is the inline-PDF route the preview canvas fetches and renders;
// `downloadHref` is the forced-download route the button points at.
function shareLandingPage({ label, docNumber, lodgeName, viewHref, downloadHref }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(docNumber)} — ${escapeHtml(lodgeName)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center;
         background: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); padding: 20px;
          width: 100%; max-width: 480px; text-align: center; margin: 16px; }
  .card p.lodge { margin: 0 0 4px; font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
  .card h1 { margin: 0 0 16px; font-size: 20px; color: #111827; }
  .preview { position: relative; width: 100%; min-height: 360px; border-radius: 8px;
             overflow: hidden; border: 1px solid #e5e7eb; margin-bottom: 16px; background: #f9fafb;
             display: flex; align-items: center; justify-content: center; }
  .preview canvas { display: block; max-width: 100%; height: auto; }
  .preview .hint { font-size: 13px; color: #9ca3af; padding: 24px; }
  .card a.btn { display: block; background: #111827; color: #fff; text-decoration: none; font-weight: 600;
                font-size: 15px; padding: 14px 20px; border-radius: 8px; }
  .card a.btn:active { background: #000; }
</style>
</head>
<body>
  <div class="card">
    <p class="lodge">${escapeHtml(lodgeName)}</p>
    <h1>${escapeHtml(label)} ${escapeHtml(docNumber)}</h1>
    <div class="preview" id="preview" data-view-href="${escapeHtml(viewHref)}">
      <p class="hint" id="previewHint">Loading preview…</p>
    </div>
    <a class="btn" href="${downloadHref}">Download ${escapeHtml(label)} (PDF)</a>
  </div>
  <script type="module" src="/vendor/pdfjs/bill-preview.mjs"></script>
</body>
</html>`;
}

async function getSharedBillHandler(req, res, next) {
  try {
    const { invoiceNumber, lodgeName } = await billShareService.readSharedBill(String(req.params.token || ''));
    const token = String(req.params.token || '');
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(
      shareLandingPage({
        label: 'Bill',
        docNumber: invoiceNumber,
        lodgeName,
        viewHref: `/public/bills/${encodeURIComponent(token)}/view`,
        downloadHref: `/public/bills/${encodeURIComponent(token)}/download`,
      })
    );
  } catch (err) {
    next(err);
  }
}

// The PDF rendered inline, for the preview frame on the landing page above.
// `inline` rather than `attachment`: this is the document shown *in* the
// page, not a save prompt — the download button below the frame is what
// hands the guest the file.
async function viewSharedBillHandler(req, res, next) {
  try {
    const { filePath } = await billShareService.readSharedBill(String(req.params.token || ''));
    res.type('application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
}

// The PDF itself, as a forced download — the button on the landing page above
// points here. `attachment` rather than `inline`: the guest already chose to
// download from the page, so the phone should save it, not reopen the same
// choice inside a PDF viewer.
async function downloadSharedBillHandler(req, res, next) {
  try {
    const { filePath, invoiceNumber } = await billShareService.readSharedBill(String(req.params.token || ''));
    res.type('application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    // The bill's own number, so the saved file is named after the document
    // rather than after our storage key.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${String(invoiceNumber).replace(/[\/"]/g, '-')}.pdf"`
    );
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
}

// Same two-step landing as a shared bill, against a shared advance receipt.
async function getSharedReceiptHandler(req, res, next) {
  try {
    const { receiptNumber, lodgeName } = await receiptShareService.readSharedReceipt(String(req.params.token || ''));
    const token = String(req.params.token || '');
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(
      shareLandingPage({
        label: 'Receipt',
        docNumber: receiptNumber,
        lodgeName,
        viewHref: `/public/receipts/${encodeURIComponent(token)}/view`,
        downloadHref: `/public/receipts/${encodeURIComponent(token)}/download`,
      })
    );
  } catch (err) {
    next(err);
  }
}

// Same inline-preview handler as the bill's, against a shared advance receipt.
async function viewSharedReceiptHandler(req, res, next) {
  try {
    const { filePath } = await receiptShareService.readSharedReceipt(String(req.params.token || ''));
    res.type('application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
}

async function downloadSharedReceiptHandler(req, res, next) {
  try {
    const { filePath, receiptNumber } = await receiptShareService.readSharedReceipt(String(req.params.token || ''));
    res.type('application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${String(receiptNumber).replace(/[\/"]/g, '-')}.pdf"`
    );
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSharedBillHandler,
  viewSharedBillHandler,
  downloadSharedBillHandler,
  getSharedReceiptHandler,
  viewSharedReceiptHandler,
  downloadSharedReceiptHandler,
  getLodgePageHandler,
  getMenuPageHandler,
  getTableOrderPageHandler,
  openSessionHandler,
  listGuestOrdersHandler,
  updateGuestOrderHandler,
  cancelGuestOrderHandler,
  placeRoomOrderHandler,
  placeTableOrderHandler,
  getOrderStatusHandler,
};
