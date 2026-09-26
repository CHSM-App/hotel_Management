const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const { ApiError } = require('../../middleware/errorHandler');
const { UPLOAD_DIR } = require('../../middleware/receiptShareUpload');
const whatsapp = require('../../config/whatsapp');

// Handing an advance receipt to a guest on WhatsApp, from the server rather
// than from the desk's own phone. Same shape as billShare.service.js, and the
// same reasoning applies throughout — this file mirrors it deliberately
// rather than trying to generalise the two into one, because a receipt is not
// a bill: different template, different table, different guard on being
// voided later.

// The template's six variables, in order:
//
//   {{1}} name (guest)     {{4}} amt
//   {{2}} hotel_name       {{5}} payment_method
//   {{3}} receipt_number   {{6}} link to the PDF
//
// "Dear {{1}}, [hotel_name] {{2}}, We've received your advance payment.
//  Receipt No. {{3}} / Amount: {{4}} / Paid via: {{5}}
//  / View / Download Receipt: {{6}}"
const RECEIPT_CAMPAIGN = 'receipt_share';

// Same TTL as a shared bill — a guest reopening a receipt from the same chat
// a few weeks later is the ordinary case this window is sized for.
const LINK_TTL_DAYS = 30;

function publicBaseUrl() {
  const base = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new ApiError(
      'Sharing a receipt on WhatsApp needs PUBLIC_BASE_URL set to the address guests reach this site at.',
      503
    );
  }
  return base;
}

// Same packing rule as billShare.service.js: the provider joins a template's
// variables with commas, so a comma inside a value shifts every later one
// along, and a blank variable is rejected outright.
function clean(value) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ' - ')
    .trim();
  return text || '-';
}

function amountForTemplate(value) {
  return `Rs ${Number(value ?? 0).toFixed(2)}`;
}

const PAYMENT_METHOD_LABEL = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' };

function buildReceiptSample(receipt, link) {
  return [
    clean(receipt.guest_name || 'Guest'),
    clean(receipt.lodge_name),
    clean(receipt.receipt_number),
    clean(amountForTemplate(receipt.amount_received)),
    clean(PAYMENT_METHOD_LABEL[receipt.payment_method] || receipt.payment_method),
    // Not cleaned: a URL has no commas and clean() would mangle one that did.
    link,
  ].join(',');
}

// The receipt being shared, with only the fields the message needs. Read back
// rather than trusted from the request, same as a shared bill.
async function loadReceipt(lodgeId, receiptId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('receiptId', sql.BigInt, receiptId)
    .query(`
      SELECT ar.id, ar.receipt_number, ar.amount_received, ar.payment_method, ar.status,
             COALESCE(b.guest_name, eb.organiser_name) AS guest_name,
             COALESCE(b.guest_phone, eb.organiser_phone) AS guest_phone,
             l.name AS lodge_name
      FROM dbo.advance_receipts ar
      LEFT JOIN dbo.bookings b ON b.id = ar.booking_id
      LEFT JOIN dbo.event_bookings eb ON eb.id = ar.event_booking_id
      JOIN dbo.lodges l ON l.id = ar.lodge_id
      WHERE ar.id = @receiptId AND ar.lodge_id = @lodgeId
    `);
  const row = result.recordset[0];
  if (!row) throw new ApiError('Receipt not found.', 404);
  return row;
}

async function recordShare({ lodgeId, receiptId, token, filename, phone, channel, status, error, campaignId, userId }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('receiptId', sql.BigInt, receiptId)
    .input('token', sql.NVarChar(64), token)
    .input('filename', sql.NVarChar(120), filename)
    .input('phone', sql.NVarChar(20), phone)
    .input('channel', sql.NVarChar(20), channel)
    .input('status', sql.NVarChar(20), status)
    .input('error', sql.NVarChar(400), error ? String(error).slice(0, 400) : null)
    .input('campaignId', sql.NVarChar(100), campaignId ? String(campaignId).slice(0, 100) : null)
    .input('sentBy', sql.BigInt, userId ?? null)
    .query(`
      INSERT INTO dbo.receipt_shares
        (lodge_id, receipt_id, token, filename, phone, channel, status, error, campaign_id, sent_by)
      OUTPUT INSERTED.id, INSERTED.created_at
      VALUES
        (@lodgeId, @receiptId, @token, @filename, @phone, @channel, @status, @error, @campaignId, @sentBy)
    `);
  return result.recordset[0];
}

function discard(filename) {
  if (!filename) return;
  fs.unlink(path.join(UPLOAD_DIR, filename), () => {});
}

// Sends the uploaded receipt to the guest and reports what the provider said.
// Throws, same as shareInvoiceOnWhatsApp and for the same reason: this is the
// action the desk asked for, not a message riding along with something else.
async function shareReceiptOnWhatsApp(lodgeId, userId, receiptId, { file, phone }) {
  if (!file) throw new ApiError('The receipt PDF is missing.', 400);

  try {
    if (!whatsapp.isReceiptTemplateConfigured()) {
      throw new ApiError('WhatsApp sending is not set up for this property yet.', 503);
    }

    const receipt = await loadReceipt(lodgeId, receiptId);
    // A voided receipt is not a receipt. Sending one would put a document the
    // property has cancelled into a guest's hands with nothing marking it.
    if (receipt.status !== 'ISSUED') {
      throw new ApiError('This receipt has been voided and cannot be shared.', 400);
    }

    const target = whatsapp.normalisePhone(phone || receipt.guest_phone);
    if (!target) {
      throw new ApiError('No WhatsApp number for this guest. Enter one to send the receipt.', 400);
    }

    const token = crypto.randomUUID().replace(/-/g, '');
    const link = `${publicBaseUrl()}/public/receipts/${token}`;

    const sample = buildReceiptSample(receipt, link);

    let sent;
    try {
      sent = await whatsapp.sendTemplateMessage(target, whatsapp.RECEIPT_TEMPLATE_ID, sample, RECEIPT_CAMPAIGN);
    } catch (err) {
      await recordShare({
        lodgeId,
        receiptId,
        token,
        filename: file.filename,
        phone: target,
        channel: 'WHATSAPP',
        status: 'FAILED',
        error: err.message,
        campaignId: null,
        userId,
      });
      logger.warn({ lodgeId, receiptId, phone: target, err }, 'Receipt could not be sent on WhatsApp');
      throw new ApiError(err.message || 'WhatsApp could not send the receipt.', 502);
    }

    const row = await recordShare({
      lodgeId,
      receiptId,
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
      { lodgeId, receiptId, phone: target, campaignId: sent.campaignId },
      'Receipt sent to guest on WhatsApp'
    );

    return {
      status: 'sent',
      phone: target,
      receiptNumber: receipt.receipt_number,
      sentAt: row.created_at,
    };
  } catch (err) {
    discard(file.filename);
    throw err;
  }
}

// The guest's end of the link. No authentication — the token is the whole of
// the credential, same as a shared bill.
async function readSharedReceipt(token) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('token', sql.NVarChar(64), token)
    .query(`
      SELECT s.filename, s.created_at, ar.receipt_number, l.name AS lodge_name
      FROM dbo.receipt_shares s
      JOIN dbo.advance_receipts ar ON ar.id = s.receipt_id
      JOIN dbo.lodges l ON l.id = ar.lodge_id
      -- A receipt voided after it was sent stops being downloadable, same
      -- reasoning as a voided bill.
      WHERE s.token = @token AND s.status = 'SENT' AND ar.status = 'ISSUED'
    `);
  const row = result.recordset[0];
  if (!row) throw new ApiError('This receipt link is no longer available.', 404);

  const age = Date.now() - new Date(row.created_at).getTime();
  if (age > LINK_TTL_DAYS * 24 * 60 * 60 * 1000) {
    throw new ApiError('This receipt link is no longer available.', 404);
  }

  const filePath = path.join(UPLOAD_DIR, row.filename);
  if (path.dirname(filePath) !== UPLOAD_DIR || !fs.existsSync(filePath)) {
    throw new ApiError('This receipt link is no longer available.', 404);
  }

  return { filePath, receiptNumber: row.receipt_number, lodgeName: row.lodge_name };
}

// What has been sent for one receipt, newest first.
async function listShares(lodgeId, receiptId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('receiptId', sql.BigInt, receiptId)
    .query(`
      SELECT id, phone, channel, status, error, created_at
      FROM dbo.receipt_shares
      WHERE lodge_id = @lodgeId AND receipt_id = @receiptId
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

function whatsAppAvailable() {
  return whatsapp.isReceiptTemplateConfigured() && Boolean((process.env.PUBLIC_BASE_URL || '').trim());
}

module.exports = {
  shareReceiptOnWhatsApp,
  readSharedReceipt,
  listShares,
  whatsAppAvailable,
  buildReceiptSample,
  clean,
  amountForTemplate,
  LINK_TTL_DAYS,
};
