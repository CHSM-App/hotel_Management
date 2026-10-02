// Pure helpers for bookings that hold more than one room (dbo.booking_rooms,
// migration 104). No I/O here so the money and status rules can be unit tested.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Splits one booking-level concession across rooms in proportion to what each
// room cost, the remainder landing on the last room so the shares sum to the
// concession to the paisa (same drift rule spreadConcession uses per night).
function apportionDiscount(grossTotals, discount) {
  const gross = grossTotals.reduce((sum, n) => sum + n, 0);
  if (!(discount > 0) || !(gross > 0)) return grossTotals.map(() => 0);
  let remaining = discount;
  return grossTotals.map((g, i) => {
    const share = i === grossTotals.length - 1 ? remaining : round2((discount * g) / gross);
    remaining = round2(remaining - share);
    return share;
  });
}

// The booking-level nightly snapshot from each room's own. Billing bands GST
// on every entry's own rate and merges lines by label, so an entry per room
// per night keeps each room's rate banded on its own, and prefixing the labels
// with the room number keeps "Room rate" of two rooms from merging into one
// line. An extra (AC, extra bed) is the exception: it keeps its plain label so
// the same extra on several rooms bills as one line with a room count. A
// single-room booking is passed through untouched.
function mergeRoomNights(rooms) {
  if (rooms.length === 1) return rooms[0].nights;
  return rooms.flatMap((room) =>
    room.nights.map((night) => ({
      date: night.date,
      total: night.total,
      lines: night.lines.map((line) =>
        line.chargeId != null ? line : { ...line, label: `Room ${room.roomNumber} · ${line.label}` }
      ),
    }))
  );
}

// What the booking as a whole is, given its rooms. Cancelled rooms are ignored
// (a booking whose every room is cancelled is cancelled). A stay is under way
// as soon as any room is in, or one has left while another has yet to arrive.
function rollUpStatus(roomStatuses) {
  const live = roomStatuses.filter((s) => s !== 'CANCELLED');
  if (live.length === 0) return 'CANCELLED';
  if (live.every((s) => s === 'CHECKED_OUT')) return 'CHECKED_OUT';
  if (live.some((s) => s === 'CHECKED_IN' || s === 'CHECKED_OUT')) return 'CHECKED_IN';
  return 'BOOKED';
}

module.exports = { apportionDiscount, mergeRoomNights, rollUpStatus };
