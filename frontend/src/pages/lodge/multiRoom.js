import { chargesPayload } from './chargeSelections.js';

// A booking of several rooms, as the form holds it: the first room lives in the
// form's own fields (roomId, bedIds, switchableCharges, the two dates), and every
// further room is one entry in form.extraRooms. form.sameDates says whether those
// further rooms follow the form's dates or carry their own.

let keySeed = 0;

export function blankExtraRoom(dates) {
  keySeed += 1;
  return {
    // Only for React — a room's identity in the list before it has an id of its own.
    key: `x${Date.now()}-${keySeed}`,
    // The booking_rooms row this is, on an edit; null for a room being added.
    bookingRoomId: null,
    roomId: '',
    bedIds: [],
    switchableCharges: [],
    // Per night, blank for the category's own rate.
    basePriceOverride: '',
    checkInDate: dates.checkInDate,
    checkOutDate: dates.checkOutDate,
    // BOOKED / CHECKED_IN / CHECKED_OUT for a room already on the booking.
    status: null,
    // Filled in by the card once it knows the room: { roomNumber, maxOccupancy,
    // isDormitory }. Kept so the form can total capacity and name the room
    // without holding every card's room list.
    meta: null,
  };
}

// The dates a further room is actually booked for.
export function roomDates(form, room) {
  return form.sameDates
    ? { checkInDate: form.checkInDate, checkOutDate: form.checkOutDate }
    : {
        checkInDate: room.checkInDate || form.checkInDate,
        checkOutDate: room.checkOutDate || form.checkOutDate,
      };
}

// The rooms the desk has actually picked among the further ones.
export function pickedExtraRooms(form) {
  return (form.extraRooms ?? []).filter((r) => r.roomId);
}

// The whole stay: earliest arrival to latest departure across every room.
export function bookingWindow(form) {
  const dates = [
    { checkInDate: form.checkInDate, checkOutDate: form.checkOutDate },
    ...pickedExtraRooms(form).map((r) => roomDates(form, r)),
  ];
  return {
    checkInDate: dates.map((d) => d.checkInDate).sort()[0],
    checkOutDate: dates.map((d) => d.checkOutDate).sort().reverse()[0],
  };
}

const rateOrNull = (value) => (value === '' || value == null ? null : Number(value));

// The `rooms` list the API takes, for a booking that has more than one room (or
// is being brought back down from more than one to fewer).
export function roomsPayload(form) {
  const first = {
    ...(form.primaryBookingRoomId ? { bookingRoomId: Number(form.primaryBookingRoomId) } : {}),
    roomId: Number(form.roomId),
    bedIds: form.bedIds.map(Number),
    checkInDate: form.checkInDate,
    checkOutDate: form.checkOutDate,
    basePriceOverride: rateOrNull(form.basePriceOverride),
    switchableCharges: chargesPayload(form.switchableCharges),
  };
  const rest = pickedExtraRooms(form).map((r) => ({
    ...(r.bookingRoomId ? { bookingRoomId: Number(r.bookingRoomId) } : {}),
    roomId: Number(r.roomId),
    bedIds: r.bedIds.map(Number),
    ...roomDates(form, r),
    basePriceOverride: rateOrNull(r.basePriceOverride),
    switchableCharges: chargesPayload(r.switchableCharges),
  }));
  return [first, ...rest];
}

// The form reads one quote shape everywhere — charges, nights, gross and payable
// totals. The several-room quote comes back per room, so it is folded into that
// shape: the first room's lines stay editable as they always were, and each
// further room's lines are labelled with its room number and read-only.
export function combineQuote(response, roomNumbers) {
  const [first, ...rest] = response.rooms;
  const nightDates = new Set();
  for (const room of response.rooms) for (const n of room.nights) nightDates.add(n.date);
  const charges = [
      // Each line says how many nights it covers: rooms on their own dates stay for
      // different lengths, so the stay's night count is wrong for most of them.
      ...first.charges.map((c) => ({
        ...c,
        label: `Room ${roomNumbers[0] ?? ''} · ${c.label}`.replace('Room  ·', 'Room ·'),
        nights: first.nights.length,
      })),
      // Each further room's lines keep their ids so the form can edit them, and
      // say which room they belong to (1 is the first further room).
      ...rest.flatMap((room, i) =>
        room.charges.map((c) => ({
          label: `Room ${roomNumbers[i + 1] ?? ''} · ${c.label}`.replace('Room  ·', 'Room ·'),
            amount: c.amount,
          isBase: Boolean(c.isBase),
          chargeId: c.chargeId,
          quantity: c.quantity,
          roomIndex: i + 1,
          nights: room.nights.length,
        }))
      ),
  ];
  return {
    charges,
    nights: Array.from(nightDates).map((date) => ({ date })),
    grossTotal: response.grossTotal,
    discountAmount: response.discountAmount,
    totalPrice: response.totalPrice,
    rooms: response.rooms,
  };
}

// ---------------------------------------------------------------------------
// Ticking rooms in the "same dates" list
// ---------------------------------------------------------------------------

const RESET_DISCOUNT = { discountAmount: '', discountPercent: '', discountSource: '' };

// What the form keeps about a room it did not pick from a card of its own.
export function roomMeta(room) {
  return {
    roomNumber: room.roomNumber,
    maxOccupancy: room.maxOccupancy ?? null,
    isDormitory: Boolean(room.isDormitory),
    categoryName: room.categoryName,
  };
}

// The first room is the form's own fields, so taking it off means the next room
// steps up into them. With no other room, the form is back to having none chosen.
export function promoteFirstExtra(form) {
  const [next, ...rest] = form.extraRooms ?? [];
  if (!next) {
    return {
      ...form,
      roomId: '',
      bedIds: [],
      buyout: false,
      switchableCharges: [],
      basePriceOverride: '',
      primaryBookingRoomId: null,
      primaryStatus: null,
      ...RESET_DISCOUNT,
    };
  }
  return {
    ...form,
    roomId: String(next.roomId),
    bedIds: next.bedIds,
    buyout: false,
    switchableCharges: next.switchableCharges,
    basePriceOverride: next.basePriceOverride,
    primaryBookingRoomId: next.bookingRoomId,
    primaryStatus: next.status,
    extraRooms: rest,
    ...RESET_DISCOUNT,
  };
}

// One tick in the room list. Unticking a room takes it off, whichever slot it was
// in; ticking one puts it in the first empty slot — the form's own room if none is
// chosen yet, otherwise a new card. `room` is the row the list showed.
export function toggleRoomChoice(form, room) {
  const id = String(room.id);
  if (String(form.roomId) === id) return promoteFirstExtra(form);

  const extras = form.extraRooms ?? [];
  if (extras.some((r) => String(r.roomId) === id)) {
    return { ...form, extraRooms: extras.filter((r) => String(r.roomId) !== id), ...RESET_DISCOUNT };
  }
  if (!form.roomId) {
    return { ...form, roomId: id, bedIds: [], buyout: false, switchableCharges: [], ...RESET_DISCOUNT };
  }
  return {
    ...form,
    extraRooms: [
      ...extras,
      {
        ...blankExtraRoom({ checkInDate: form.checkInDate, checkOutDate: form.checkOutDate }),
        roomId: id,
        meta: roomMeta(room),
      },
    ],
    ...RESET_DISCOUNT,
  };
}

// Every room the form has picked, the first included, by id.
export function pickedRoomIds(form) {
  return [form.roomId, ...(form.extraRooms ?? []).map((r) => r.roomId)].filter(Boolean).map(String);
}

// A booking of several rooms stores each room's lines as "Room 101 · Standard
// ₹1,200" (see mergeRoomNights). Split back into one block per room — the first
// line of a room is its nightly rate, the rest are its extras. Null for a
// single-room bill, or an older one whose lines carry no room.
export function roomSections(roomCharges = []) {
  const rooms = new Map();
  for (const line of roomCharges) {
    const m = /^Room (.+?) · (.*)$/.exec(line.label);
    if (!m) return null;
    if (!rooms.has(m[1])) rooms.set(m[1], []);
    rooms.get(m[1]).push({ ...line, label: m[2] });
  }
  return rooms.size > 1 ? Array.from(rooms, ([room, lines]) => ({ room, base: lines[0], extras: lines.slice(1) })) : null;
}

