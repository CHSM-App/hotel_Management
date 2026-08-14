// How a stay's facts are worded, in one place. A stay opened from the tape
// chart, from the guest register and from the billing queue is the same stay,
// and three copies of "how do we print a date" is how it stops reading like
// one record.

export const VEHICLE_TYPE_LABEL = {
  TWO_WHEELER: 'Two wheeler',
  FOUR_WHEELER: 'Four wheeler',
  TRAVELLER: 'Traveller',
  BUS: 'Bus',
};

export const STAY_STATUS_LABEL = {
  BOOKED: 'Booked',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
};

export function formatDateLong(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// When the guest actually walked in or out, as against the dates they booked.
export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Just the night's date — the year is already on the stay's date range above,
// and repeating it on every line of a five-night tariff is noise.
export function formatNightDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// Reads after its label ("Left late by — 2h 15m"), so no "late" in the value.
export function formatLateBy(minutes) {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours} hours` : `${hours}h ${mins}m`;
}

export function describeParty(adultCount, childCount) {
  const adults = `${adultCount} adult${adultCount === 1 ? '' : 's'}`;
  if (childCount === 0) return adults;
  return `${adults} and ${childCount} child${childCount === 1 ? '' : 'ren'}`;
}

export function idProofLabel(type) {
  return type.charAt(0) + type.slice(1).toLowerCase().replace('_', ' ');
}

// What is owed on an unbilled stay, in the same terms reception took the money
// in: the room charge and whatever was agreed for leaving late, less the
// advance. Deliberately before tax and rounding — the bill computes GST per
// night against its own slabs, so a figure worked out here would differ from
// the one the guest is eventually handed. Callers say so on screen.
export function outstandingBeforeTax(booking) {
  if (!booking) return 0;
  const total =
    booking.totalPrice + (booking.lateCheckoutCharge || 0) - (booking.advanceAmount || 0);
  return Math.round(total * 100) / 100;
}
