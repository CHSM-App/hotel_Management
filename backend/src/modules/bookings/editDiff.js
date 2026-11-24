// What a booking edit changed, as [{field, from, to}]. Pure: takes two
// snapshots of the same shape (see snapshotOf) and lists only what differs.
const FIELDS = [
  ['guestName', 'Guest name'],
  ['guestPhone', 'Phone'],
  ['numGuests', 'Guests'],
  ['numChildren', 'Children'],
  ['discount', 'Discount'],
  ['advance', 'Advance'],
  ['totalPrice', 'Total price'],
];

const norm = (v) => (v == null ? '' : String(v).trim());
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : norm(d).slice(0, 10));

// Rows from bookings (+ booking_rooms joined to rooms) in either the "before"
// shape (snake_case rows already loaded by updateBooking) or re-read after.
function snapshotOf(b, rooms) {
  return {
    guestName: b.guest_name,
    guestPhone: b.guest_phone,
    numGuests: b.num_guests,
    numChildren: b.num_children,
    discount: Number(b.discount_amount) || 0,
    advance: Number(b.advance_amount) || 0,
    totalPrice: Number(b.total_price) || 0,
    rooms: rooms.map((r) => ({ roomNumber: r.room_number, checkIn: day(r.check_in_date), checkOut: day(r.check_out_date) })),
  };
}

function diffBookingEdit(before, after) {
  const out = [];
  for (const [key, label] of FIELDS) {
    if (norm(before[key]) !== norm(after[key])) out.push({ field: label, from: before[key] ?? null, to: after[key] ?? null });
  }
  const show = (r) => `${r.roomNumber}: ${r.checkIn} → ${r.checkOut}`;
  const a = before.rooms.map(show);
  const b = after.rooms.map(show);
  if (a.join('|') !== b.join('|')) out.push({ field: 'Rooms & dates', from: a.join('; '), to: b.join('; ') });
  return out;
}

module.exports = { snapshotOf, diffBookingEdit };
