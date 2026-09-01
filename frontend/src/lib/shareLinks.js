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

// The other two channels a desk actually sends a document on. Neither carries
// a file either — same as wa.me — so the caller saves the PDF first and these
// only open the composed message for the attachment to be added.

// A mail draft. Subject and body are separate fields rather than one blob
// because a mail client shows the subject in the guest's inbox list, and a
// bill arriving with an empty subject line reads as spam.
export function buildMailLink(email, subject, body) {
  const to = encodeURIComponent(String(email || '').trim());
  const q = `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${to}${q}`;
}

// An SMS draft. The body separator is '?' on Android and '&' on iOS; '?' is
// the one both accept when there is no other parameter, which there never is
// here.
export function buildSmsLink(phone, message) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  return `sms:${digits}?body=${encodeURIComponent(message)}`;
}

// A mail or sms draft opens in the mail client, not in a browsing context, so
// window.open would leave a blank tab behind on desktop. Same-tab navigation
// hands the URL to the OS handler and leaves this page where it is.
export function openComposer(url) {
  window.location.href = url;
}
