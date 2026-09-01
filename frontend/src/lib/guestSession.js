// The room number and food PIN a guest signed in with, kept on their own phone
// so they don't retype it for every plate of food they order over a four-night
// stay.
//
// This is a remembered form, not a session. There is no token to hold because
// the server issues none — every guest request re-sends the pair and is checked
// afresh (see verifyRoomAccess in public.service.js). Three things follow, and
// all of them are the point:
//
//   - Nothing here expires on a clock. Reception clearing food_pin at check-out
//     is what ends it, and the next request 401s. The caller's job is to wipe
//     this the moment that happens, which is why clearGuestSession exists.
//   - Nor does it end on its own when a visit does. A room number and a PIN are
//     both reused, so a guest who comes back months later arrives holding a
//     pair that belongs to a stay long since checked out. stayTag is what makes
//     that detectable: the server names the current stay at sign-in, this
//     remembers the name, and the caller revalidates on load and wipes the
//     entry when the two names differ. See revalidate in OrderPage.
//   - The PIN is stored in the clear, because it is re-sent in the clear. It
//     buys a room's food to a room's bill for the length of one stay; it is not
//     a password and there is no account behind it. Anyone who can read this
//     storage is already holding the unlocked phone the PIN was written down
//     next to.
//
// Keyed per lodge: one phone can hold a QR from the place they're staying and
// the place they had lunch, and neither should sign the other out.
const KEY_PREFIX = 'lms.guest.';

function keyFor(slug) {
  return `${KEY_PREFIX}${slug}`;
}

export function getGuestSession(slug) {
  if (!slug) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // A half-written or hand-edited entry is treated as no entry — the guest
    // signs in again, which costs them one form and cannot fail any worse.
    if (!parsed?.roomNumber || !parsed?.pin) return null;
    return {
      roomNumber: parsed.roomNumber,
      pin: parsed.pin,
      guestName: parsed.guestName || '',
      // Absent on an entry written before stays were tagged. Treated as
      // unknown rather than mismatched, so an upgrade doesn't sign out a
      // guest mid-stay - revalidation fills it in on the next load.
      stayTag: parsed.stayTag || '',
    };
  } catch {
    return null;
  }
}

export function setGuestSession(slug, session) {
  try {
    window.localStorage.setItem(
      keyFor(slug),
      JSON.stringify({
        roomNumber: session.roomNumber,
        pin: session.pin,
        guestName: session.guestName || '',
        stayTag: session.stayTag || '',
      })
    );
  } catch {
    // Private browsing, or storage full. Ordering still works for as long as
    // the tab stays open — the identity lives in React state either way — so
    // this is deliberately not surfaced as an error.
  }
}

export function clearGuestSession(slug) {
  try {
    window.localStorage.removeItem(keyFor(slug));
  } catch {
    // Nothing to do: if it can't be removed it could never have been written.
  }
}
