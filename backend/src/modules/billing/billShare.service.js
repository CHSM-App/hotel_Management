const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const { ApiError } = require('../../middleware/errorHandler');
const { UPLOAD_DIR } = require('../../middleware/billShareUpload');
const whatsapp = require('../../config/whatsapp');

// Handing a bill to a guest on WhatsApp, from the server rather than from the
// desk's own phone.
//
// The screen used to do this by downloading the PDF and opening wa.me with a
// message typed into it: the desk then attached the file by hand, in WhatsApp,
// having switched apps. Every step after the download was the operator's to
// remember, and nothing came back to say the guest had been sent anything. So
// "was this bill sent?" had no answer but asking whoever was on the counter.
//
// This route answers it. The browser posts the PDF it has already built, the
// file is stored under a random token, and an approved template goes out
// carrying the link to it. What comes back is the provider's verdict, which is
// what the screen reports.
//
// The honest limit of that verdict, and it is worth being plain about it: the
// provider accepting a message is not the guest reading it. SMSala reports
// acceptance, not delivery to the handset, so a send recorded here as SENT is
// "handed to the provider" — not "seen". Nothing in this file claims more.

// The template's five variables, in order:
//
//   {{1}} customer      {{4}} property name
//   {{2}} bill number   {{5}} link to the PDF
//   {{3}} amount
//
// "Dear {{1}}, your bill {{2}} for {{3}} from {{4}} is ready. You can view and
//  download it here: {{5}}"
const BILL_CAMPAIGN = 'bill_share';

// How long a shared bill stays reachable. A guest who is sent a bill should be
// able to open it again a week later from the same chat; past that the link is
// a document sitting on the internet behind nothing but a token that has
// already served its purpose.
const LINK_TTL_DAYS = 30;

// The link the guest taps. It has to be an address reachable from a phone on
// mobile data — not the LAN address the desk's browser uses — so it is
// configured rather than derived from the request: behind a proxy, Host is
// whatever the proxy was asked for, and a bill link built from it can point
// somewhere the guest cannot reach.
//
// PUBLIC_BASE_URL is therefore required for this feature and only this one.
function publicBaseUrl() {
  const base = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new ApiError(
      'Sharing a bill on WhatsApp needs PUBLIC_BASE_URL set to the address guests reach this site at.',
      503
    );
  }
  return base;
}

// The provider packs template variables into one comma-separated string, so a
// comma inside a value shifts every later variable along by one — the amount
// landing in the property-name slot. Same rule, and the same fix, as the
// booking confirmation: commas become a dash, and an empty value becomes a
// dash because the provider rejects a blank variable outright.
function clean(value) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ' - ')
    .trim();
  return text || '-';
}

// ₹1,23,456.00 has commas in it and would break the packing above, so the
// amount goes out in plain digits with the rupee word spelled out. A guest
// reading "Rs 12500.00" is in no doubt; a guest reading a bill whose property
// name is "00" because the thousands separator shifted it is.
function amountForTemplate(value) {
  return `Rs ${Number(value ?? 0).toFixed(2)}`;
}

function buildBillSample(invoice, link) {
  return [
    clean(invoice.guest_name || 'Guest'),
    clean(invoice.invoice_number),
    clean(amountForTemplate(invoice.total_amount)),
    clean(invoice.lodge_name),
    // Not cleaned: a URL has no commas and clean() would mangle one that did.
    link,
  ].join(',');
}

// The bill being shared, with only the fields the message needs. Read back
// rather than trusted from the request: what the guest is told the bill says
// must be what the database says it says.
async function loadInvoice(lodgeId, invoiceId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('invoiceId', sql.BigInt, invoiceId)
    .query(`
      SELECT i.id, i.invoice_number, i.total_amount, i.status,
             COALESCE(b.guest_name, eb.organiser_name) AS guest_name,
             COALESCE(b.guest_phone, eb.organiser_phone) AS guest_phone,
             l.name AS lodge_name
      FROM dbo.invoices i
      -- LEFT on both, as everywhere else: a restaurant bill has no stay and a
      -- function's bill has no room.
      LEFT JOIN dbo.bookings b ON b.id = i.booking_id
      LEFT JOIN dbo.event_bookings eb ON eb.id = i.event_booking_id
      JOIN dbo.lodges l ON l.id = i.lodge_id
      WHERE i.id = @invoiceId AND i.lodge_id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) throw new ApiError('Bill not found.', 404);
  return row;
}

async function recordShare({ lodgeId, invoiceId, token, filename, phone, channel, status, error, campaignId, userId }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('invoiceId', sql.BigInt, invoiceId)
    .input('token', sql.NVarChar(64), token)
    .input('filename', sql.NVarChar(120), filename)
    .input('phone', sql.NVarChar(20), phone)
    .input('channel', sql.NVarChar(20), channel)
    .input('status', sql.NVarChar(20), status)
    // Truncated to the column: a provider that answers with a wall of text
    // must not fail the insert that is recording its own failure.
    .input('error', sql.NVarChar(400), error ? String(error).slice(0, 400) : null)
    .input('campaignId', sql.NVarChar(100), campaignId ? String(campaignId).slice(0, 100) : null)
    .input('sentBy', sql.BigInt, userId ?? null)
    .query(`
      INSERT INTO dbo.bill_shares
        (lodge_id, invoice_id, token, filename, phone, channel, status, error, campaign_id, sent_by)
      OUTPUT INSERTED.id, INSERTED.created_at
      VALUES
        (@lodgeId, @invoiceId, @token, @filename, @phone, @channel, @status, @error, @campaignId, @sentBy)
    `);
  return result.recordset[0];
}

// Best-effort cleanup of a file whose send never happened. The row is what
// makes a file reachable, so a file with no row is unreachable either way —
// this only stops the disk filling with them.
function discard(filename) {
  if (!filename) return;
  fs.unlink(path.join(UPLOAD_DIR, filename), () => {});
}

// Sends the uploaded bill to the guest and reports what the provider said.
//
// Throws, unlike the booking confirmation, and the difference is deliberate: a
// confirmation rides along with a booking that has already succeeded and must
// not fail it, whereas this IS the action the desk asked for. Someone standing
// at the counter having pressed "WhatsApp" needs to be told it did not go, in
// the words the provider used, while the guest is still in front of them.
async function shareInvoiceOnWhatsApp(lodgeId, userId, invoiceId, { file, phone }) {
  if (!file) throw new ApiError('The bill PDF is missing.', 400);

  try {
    if (!whatsapp.isBillTemplateConfigured()) {
      throw new ApiError('WhatsApp sending is not set up for this property yet.', 503);
    }

    const invoice = await loadInvoice(lodgeId, invoiceId);
    // A voided bill is not a bill. Sending one would put a document the
    // property has cancelled into a guest's hands with nothing marking it.
    if (invoice.status !== 'ISSUED') {
      throw new ApiError('This bill has been voided and cannot be shared.', 400);
    }

    // The number the desk typed wins over the one on file — a guest asking for
    // the bill on a different phone is the ordinary case, not an exception.
    const target = whatsapp.normalisePhone(phone || invoice.guest_phone);
    if (!target) {
      throw new ApiError('No WhatsApp number for this guest. Enter one to send the bill.', 400);
    }

    // The token is generated here rather than taken from the filename so the
    // two are independent: knowing one tells you nothing about the other.
    const token = crypto.randomUUID().replace(/-/g, '');
    // /public is where the guest-facing router is mounted (app.js), and the
    // path has to be the real one: this link is what goes out to the guest, and
    // a 404 in a WhatsApp message is not something the desk can correct after
    // the fact.
    const link = `${publicBaseUrl()}/public/bills/${token}`;

    // The row is written before the send, so a bill that goes out is always
    // reachable at the link it was sent with. Writing it after would leave a
    // window where the guest taps a link the database has never heard of.
    const sample = buildBillSample(invoice, link);

    let sent;
    try {
      sent = await whatsapp.sendTemplateMessage(target, whatsapp.BILL_TEMPLATE_ID, sample, BILL_CAMPAIGN);
    } catch (err) {
      // Recorded as an attempt, not swallowed. The desk is told, and the log
      // and the table both keep the provider's reason.
      await recordShare({
        lodgeId,
        invoiceId,
        token,
        filename: file.filename,
        phone: target,
        channel: 'WHATSAPP',
        status: 'FAILED',
        error: err.message,
        campaignId: null,
        userId,
      });
      logger.warn({ lodgeId, invoiceId, phone: target, err }, 'Bill could not be sent on WhatsApp');
      throw new ApiError(err.message || 'WhatsApp could not send the bill.', 502);
    }

    const row = await recordShare({
      lodgeId,
      invoiceId,
      token,
      filename: file.filename,
      phone: target,
      channel: 'WHATSAPP',
      status: 'SENT',
      error: null,
      campaignId: sent.campaignId,
      userId,
    });

    logger.info(
      { lodgeId, invoiceId, phone: target, campaignId: sent.campaignId },
      'Bill sent to guest on WhatsApp'
    );

    return {
      status: 'sent',
      // Echoed back so the screen can say which number it went to. A desk that
      // sent a bill to the wrong guest finds out here, not next week.
      phone: target,
      invoiceNumber: invoice.invoice_number,
      sentAt: row.created_at,
    };
  } catch (err) {
    // Anything that stopped the send leaves a file nobody can reach.
    discard(file.filename);
    throw err;
  }
}

// The guest's end of the link. No authentication — the token is the whole of
// the credential, which is why it is random and long, never reused, and never
// derived from anything about the bill.
async function readSharedBill(token) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('token', sql.NVarChar(64), token)
    .query(`
      SELECT s.filename, s.created_at, i.invoice_number
      FROM dbo.bill_shares s
      JOIN dbo.invoices i ON i.id = s.invoice_id
      -- A bill voided after it was sent stops being downloadable. The guest is
      -- holding a document the property has cancelled, and continuing to serve
      -- it is how a cancelled bill ends up being presented as a valid one.
      WHERE s.token = @token AND s.status = 'SENT' AND i.status = 'ISSUED'
    `);
  const row = result.recordset[0];
  // One message for "no such token", "voided" and "expired" alike. Telling
  // them apart would confirm to anyone guessing tokens which guesses were
  // close, and none of the three is actionable by the guest anyway.
  if (!row) throw new ApiError('This bill link is no longer available.', 404);

  const age = Date.now() - new Date(row.created_at).getTime();
  if (age > LINK_TTL_DAYS * 24 * 60 * 60 * 1000) {
    throw new ApiError('This bill link is no longer available.', 404);
  }

  const filePath = path.join(UPLOAD_DIR, row.filename);
  // path.basename first: the filename comes from our own storage, but joining
  // an unchecked value onto a directory is the shape of a traversal bug and it
  // costs nothing to close it here rather than trust the whole write path.
  if (path.dirname(filePath) !== UPLOAD_DIR || !fs.existsSync(filePath)) {
    throw new ApiError('This bill link is no longer available.', 404);
  }

  return { filePath, invoiceNumber: row.invoice_number };
}

// What has been sent for one bill, newest first. The billing screen shows it
// so the desk can see a bill has already gone out and to which number, instead
// of sending it a second time because nobody could remember.
async function listShares(lodgeId, invoiceId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('invoiceId', sql.BigInt, invoiceId)
    .query(`
      SELECT id, phone, channel, status, error, created_at
      FROM dbo.bill_shares
      WHERE lodge_id = @lodgeId AND invoice_id = @invoiceId
      ORDER BY id DESC
    `);
  return result.recordset.map((row) => ({
    id: Number(row.id),
    phone: row.phone,
    channel: row.channel,
    status: row.status,
    error: row.error,
    sentAt: row.created_at,
  }));
}

// Whether the screen should offer WhatsApp at all. Two separate reasons it
// might not work, and the desk can act on neither, so this reports only that
// it is unavailable — the operator reads the log or the env for why.
function whatsAppAvailable() {
  return whatsapp.isBillTemplateConfigured() && Boolean((process.env.PUBLIC_BASE_URL || '').trim());
}

module.exports = {
  shareInvoiceOnWhatsApp,
  readSharedBill,
  listShares,
  whatsAppAvailable,
  buildBillSample,
  clean,
  amountForTemplate,
  LINK_TTL_DAYS,
};
