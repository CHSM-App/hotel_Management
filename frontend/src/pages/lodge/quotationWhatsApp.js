import { formatPrice } from './priceFormat';

// ── The WhatsApp message for a quotation ─────────────────────────────────
// Used when the property's approved template is not set up and the desk opens a
// WhatsApp chat instead. Same wording and placeholders as the Flutter app's
// kQuotationWhatsAppTemplate. A placeholder with nothing to show drops its line.
//
//   {name} {hotel} {kind} {ref} {details} {total} {valid} {note} {link} {contact}
export const QUOTATION_WHATSAPP_TEMPLATE = `Dear {name},

Thank you for your enquiry with {hotel}. Here is your {kind} quotation.

Quotation No: {ref}
{details}
*Total: {total}*
{valid}
{note}
{link}

This is a quotation, not a bill. To confirm, just reply to this message{contact}.

Warm regards,
Reservations Team`;

const day = (iso) =>
  iso
    ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';

const KIND_WORD = { ROOM: 'room', EVENT: 'event', FOOD: 'restaurant', BAR: 'bar' };

function details(q) {
  const d = q.details || {};
  if (q.kind === 'ROOM') {
    return (q.rooms || [])
      .map(
        (r) =>
          `• Room ${r.roomNumber}${r.categoryName ? ` (${r.categoryName})` : ''}: ${day(r.fromDate)} to ${day(r.toDate)}, ${r.result.nightCount} night${r.result.nightCount === 1 ? '' : 's'} – ${formatPrice(r.result.total)}`
      )
      .join('\n');
  }
  if (q.kind === 'EVENT') {
    const start = d.input?.startAt ? new Date(d.input.startAt) : null;
    return [
      `Venue: ${d.venueName || ''}`,
      start && `Date: ${start.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
      `Guests: ${d.pricing?.billablePax ?? ''}`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return (d.lines || []).map((l) => `• ${l.itemName} × ${l.quantity} – ${formatPrice(l.lineTotal)}`).join('\n');
}

export function quotationWhatsAppMessage(q, { hotel = '', hotelPhone = '', link = '' } = {}) {
  const note = q.details?.note || '';
  const text = QUOTATION_WHATSAPP_TEMPLATE.replaceAll('{name}', (q.guestName || '').trim() || 'Sir/Madam')
    .replaceAll('{hotel}', hotel || 'us')
    .replaceAll('{kind}', KIND_WORD[q.kind] || 'room')
    .replaceAll('{ref}', q.referenceCode)
    .replaceAll('{details}', details(q))
    .replaceAll('{total}', formatPrice(q.total))
    .replaceAll('{valid}', q.validUntil ? `Valid until: ${day(q.validUntil)}` : '')
    .replaceAll('{note}', note ? `Note: ${note}` : '')
    .replaceAll('{link}', link ? `View your quotation: ${link}` : '')
    .replaceAll('{contact}', hotelPhone ? ` or call ${hotelPhone}` : '');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

// 10-digit numbers get the country code; anything else passes through as digits
// rather than guessed at — a wrong country code messages a stranger.
function waDigits(raw = '') {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

export function whatsAppChatUrl(q, opts) {
  const digits = waDigits(q.guestPhone);
  return `https://wa.me/${digits}?text=${encodeURIComponent(quotationWhatsAppMessage(q, opts))}`;
}
