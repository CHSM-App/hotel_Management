// A hotel's booking code is the 3-4 LETTER start of every booking number
// (SKR2610001). This mirrors the server's derivation
// (backend/src/modules/lodges/bookingCode.js) so the form can pre-fill what the
// server would pick: initials of the name's words (Sagar Kinara Residency ->
// SKR), padded from the name's letters when short (Hotel -> HOT). Whether it is
// taken is the server's call.
export function suggestBookingCode(name) {
  const words = String(name || '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
  const letters = words.join('');
  if (letters.length === 0) return '';
  const initials = words.map((w) => w[0]).join('').slice(0, 4);
  if (initials.length >= 3) return initials;
  return (initials + letters.slice(1)).slice(0, 3).padEnd(3, 'X');
}

export const BOOKING_CODE_PATTERN = /^[A-Z]{3,4}$/;
