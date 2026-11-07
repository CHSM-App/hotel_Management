// A hotel's booking code: the 3-4 LETTER start of every booking number
// (SKR2610001). Unique across the platform, set by Vengurla Tech staff.
// Letters only, so the digits after it can always be told apart from it.
//
// suggestBookingCode is what the registration form pre-fills (the frontend has
// a mirror in src/lib/bookingCode.js): initials of the name's words (Sagar
// Kinara Residency -> SKR), padded from the name's letters when short (Hotel ->
// HOT). A clash swaps the last letter (SKR -> SKRA, SKRB...).

const CODE_RE = /^[A-Z]{3,4}$/;

function baseFromName(name) {
  const words = String(name || '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
  const letters = words.join('');
  if (letters.length === 0) return 'LDG';
  const initials = words
    .map((w) => w[0])
    .join('')
    .slice(0, 4);
  if (initials.length >= 3) return initials;
  return (initials + letters.slice(1)).slice(0, 3).padEnd(3, 'X');
}

// `isTaken(code)` is async so the caller decides how uniqueness is checked.
async function suggestBookingCode(name, isTaken) {
  const base = baseFromName(name);
  if (!(await isTaken(base))) return base;
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const candidate = base.slice(0, 3) + letter;
    if (!(await isTaken(candidate))) return candidate;
  }
  return null;
}

module.exports = { CODE_RE, baseFromName, suggestBookingCode };
