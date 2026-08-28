// Handing a document to someone off the property, on WhatsApp.
//
// wa.me carries a message, never a file — no browser will attach a local PDF
// to one. So the caller saves the file first and the desk attaches it to the
// chat that opens. That is one manual step, and short of sending from the
// server it is the only route a browser leaves open.

// wa.me needs a country-code-prefixed, digits-only number. The desk writes
// them down every way a number gets written — ten digits, ten behind a leading
// zero, already carrying 91, spaced or hyphenated — and all of them are the
// same guest.
//
// Deliberately the same three cases the backend's normalisePhone accepts, so a
// number that reaches the guest on WhatsApp for an OTP reaches them for a bill
// too. Anything else is passed through as digits rather than guessed at: a
// wrong country code sends the bill to a stranger.
export function toWhatsAppDigits(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

// A chat with the guest, opened on their number where one is on file and on
// the picker where it isn't — a bill with no phone against it is still worth
// sending to whoever asks for it.
export function buildWhatsAppLink(phone, message) {
  const digits = toWhatsAppDigits(phone);
  const text = `?text=${encodeURIComponent(message)}`;
  return digits ? `https://wa.me/${digits}${text}` : `https://wa.me/${text}`;
}

// Opened in a new tab and severed from this one. Without noopener the target
// gets a handle on window.opener and can navigate the desk's session away.
export function openExternal(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}
