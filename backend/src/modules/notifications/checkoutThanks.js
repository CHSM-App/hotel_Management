const { getPool, sql } = require('../../config/connection');
const { logger } = require('../../config/logger');
const whatsapp = require('../../config/whatsapp');
const billingService = require('../billing/billing.service');
const { clean, formatMoment } = require('./checkinWelcome');

// The WhatsApp thank-you a guest gets the moment they are checked out.
//
// The template's five variables, in order:
//
//   {{1}} name              {{4}} final_bill_total
//   {{2}} hotel_name        {{5}} hotel_contact
//   {{3}} actual_checkout_datetime
//
// "Hello {{1}}, Thank you for staying with us at {{2}}! Your check-out is
//  complete. Check-out: {{3}} / Total bill: ₹{{4}} / ... call us on {{5}}. ..."
//
// Sent once, when the booking's LAST room leaves (booking.status becomes
// CHECKED_OUT) — checking rooms out one at a time must not thank the guest
// twice. {{4}} is the bill as billing would price it right now (food, extras,
// late charge, GST); the desk can still apply a discount when it issues the
// invoice, so this is the figure before that. Falls back to the booked total
// if the preview cannot be built.
//
// Best-effort, same reasoning as checkinWelcome.js: the checkout is already
// committed, and a provider outage must not become an error at the desk.

function lodgeContact(lodge) {
  return lodge.phone || lodge.whatsappNumber || '-';
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

// Pure, so it can be checked without a database. booking is getBooking()'s
// camelCase shape; billTotal is a number (see finalTotal).
function buildCheckoutSample(booking, lodge, billTotal) {
  const out = booking.actualCheckOutAt ? new Date(booking.actualCheckOutAt) : new Date();
  return [
    clean(booking.guestName),
    clean(lodge.name),
    clean(formatMoment(out)),
    clean(money(billTotal)),
    clean(lodgeContact(lodge)),
  ];
}

async function loadLodge(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query('SELECT name, phone, whatsapp_number AS whatsappNumber FROM dbo.lodges WHERE id = @lodgeId');
  return result.recordset[0] ?? null;
}

async function finalTotal(lodgeId, booking) {
  try {
    const preview = await billingService.previewBill(lodgeId, booking.id);
    return (preview.gst ?? preview.nonGst).totalAmount;
  } catch (err) {
    logger.warn({ bookingId: booking.id, lodgeId, err }, 'Could not price the checkout bill; using the booked total');
    return Number(booking.totalPrice || 0) + Number(booking.lateCheckoutCharge || 0);
  }
}

async function notifyCheckedOut(lodgeId, booking) {
  if (!whatsapp.isCheckoutTemplateConfigured()) return { status: 'skipped', reason: 'not configured' };
  if (booking.status !== 'CHECKED_OUT') return { status: 'skipped', reason: 'rooms still in house' };
  try {
    const lodge = await loadLodge(lodgeId);
    if (!lodge) return { status: 'skipped', reason: 'lodge not found' };
    if (!booking.guestPhone) return { status: 'skipped', reason: 'no guest phone' };

    const sample = buildCheckoutSample(booking, lodge, await finalTotal(lodgeId, booking));
    const { campaignId } = await whatsapp.sendTemplateMessage(
      booking.guestPhone,
      whatsapp.CHECKOUT_TEMPLATE_ID,
      sample.join(','),
      'checkout_thanks'
    );
    logger.info({ bookingId: booking.id, lodgeId, campaignId }, 'Checkout thank-you sent on WhatsApp');
    return { status: 'sent', campaignId };
  } catch (err) {
    logger.warn({ bookingId: booking.id, lodgeId, err }, 'Checkout thank-you could not be sent on WhatsApp');
    return { status: 'failed', error: err.message };
  }
}

module.exports = { notifyCheckedOut, buildCheckoutSample };
