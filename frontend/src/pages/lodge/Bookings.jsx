import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPatchForm, apiPostForm, apiGetBlob, apiDelete, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import './forms.css';
import './chartSections.css';
import './tapeChart.css';
import './Bookings.css';

// The chart lands on a rolling window, not on the 1st of the month: two days
// of hindsight so a guest who checked in before today is still on screen, and
// a month of nights ahead of it to sell into.
const LOOKBACK_DAYS = 2;
const ROLLING_DAYS = 31;
const ID_PROOF_TYPES = ['AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID', 'OTHER'];
const ID_PROOF_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const ID_PROOF_MAX_BYTES = 5 * 1024 * 1024;
const STATUS_LABEL = { BOOKED: 'Booked', CHECKED_IN: 'Checked in', CHECKED_OUT: 'Checked out', CANCELLED: 'Cancelled' };
const BED_SIZE_LABEL = { SINGLE: 'Single', DOUBLE: 'Double', QUEEN: 'Queen', KING: 'King' };
const BATHROOM_TYPE_LABEL = { ATTACHED: 'Attached bathroom', COMMON: 'Common bathroom' };
const VEHICLE_TYPE_LABEL = {
  TWO_WHEELER: 'Two wheeler',
  FOUR_WHEELER: 'Four wheeler',
  TRAVELLER: 'Traveller',
  BUS: 'Bus',
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Check-in eligibility has to go by the IST calendar date specifically —
// every lodge on this system is in India, and UTC lags IST by up to 5.5
// hours, so plain todayIso() would still read "yesterday" for the first
// few hours of an IST day. Kept separate from todayIso() (used elsewhere
// just for UI defaults) so this stays matched to the backend's own guard.
function todayIsoIST() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromStr, toStr) {
  const from = new Date(`${fromStr}T00:00:00Z`);
  const to = new Date(`${toStr}T00:00:00Z`);
  return Math.round((to - from) / 86400000);
}

function formatDateHead(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return {
    weekday: d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }),
    day: d.getUTCDate(),
  };
}

function formatDateLong(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// The chart is anchored to a whole calendar month, so every date that drives
// it is normalised to the 1st before anything else looks at it.
function monthStartOf(dateStr) {
  return `${dateStr.slice(0, 7)}-01`;
}

function addMonths(monthStart, n) {
  const d = new Date(`${monthStart}T00:00:00Z`);
  // Setting the day to 1 in the same call keeps a 31st from rolling into the
  // month after the one being asked for.
  d.setUTCMonth(d.getUTCMonth() + n, 1);
  return d.toISOString().slice(0, 10);
}

function daysInMonth(monthStart) {
  const d = new Date(`${monthStart}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

function formatDayShort(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// The stepper's label, split in two so the dates carry the emphasis and the
// year sits back from them — the year is the part nobody is actually reading.
// A whole month names itself; a rolling window has to state its two ends.
function formatViewLabel(view, dates) {
  if (view.mode === 'month') {
    const d = new Date(`${view.start}T00:00:00Z`);
    return {
      primary: d.toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' }),
      secondary: String(d.getUTCFullYear()),
    };
  }
  const first = dates[0];
  const last = dates[dates.length - 1];
  const startYear = first.slice(0, 4);
  const endYear = last.slice(0, 4);
  return {
    primary: `${formatDayShort(first)} – ${formatDayShort(last)}`,
    // A window that crosses new year has to show both, or the dates are a lie.
    secondary: startYear === endYear ? startYear : `${startYear}–${endYear}`,
  };
}

function isWeekend(dateStr) {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

// A stay occupies the nights from check-in up to (not including) check-out —
// the check-out day itself is free for the next guest, which is what makes
// back-to-back bookings on one room possible.
function nightsOf(booking) {
  return Math.max(0, daysBetween(booking.checkInDate, booking.checkOutDate));
}

const emptyGuest = { name: '', phone: '', idProofType: '', idProofFile: null };
// Children are the same row minus the phone — a child travelling with the
// party has no number of their own to reach them on.
const emptyChild = { name: '', idProofType: '', idProofFile: null };
// Type starts unset so reception picks what actually pulled up rather than
// accepting whichever option happened to be listed first.
const emptyVehicle = { number: '', type: '' };

// "4 adults and 2 children" reads better on the desk than "6 guests", but
// the children half only earns its place when there are any.
function describeParty(adultCount, childCount) {
  const adults = `${adultCount} adult${adultCount === 1 ? '' : 's'}`;
  if (childCount === 0) return adults;
  return `${adults} and ${childCount} child${childCount === 1 ? '' : 'ren'}`;
}

// A row someone added and then thought better of is dropped rather than
// rejected — clicking "+ Add vehicle" and changing your mind shouldn't block
// the booking. Anything half-filled is a real mistake and gets reported.
function cleanVehicles(vehicles) {
  return vehicles
    .map((v) => ({ number: v.number.trim(), type: v.type }))
    .filter((v) => v.number || v.type);
}

function vehicleRowError(vehicles) {
  if (vehicles.some((v) => !v.number)) return 'Enter a vehicle number, or remove the empty row.';
  if (vehicles.some((v) => !v.type)) return 'Choose a type for each vehicle.';
  return '';
}

// An extra is carried as { id, quantity }: the checkbox owns whether it's on
// the booking at all, the count beside it owns how many. quantity is held as
// typed so the field can be cleared mid-edit, and read back through
// selectionCount, which is what every consumer of it actually wants.
function selectionCount(value) {
  const count = Math.floor(Number(value));
  return Number.isFinite(count) && count >= 1 ? count : 1;
}

function toggleSelection(selections, chargeId) {
  return selections.some((c) => c.id === chargeId)
    ? selections.filter((c) => c.id !== chargeId)
    : [...selections, { id: chargeId, quantity: '1' }];
}

function withQuantity(selections, chargeId, quantity) {
  return selections.map((c) => (c.id === chargeId ? { ...c, quantity } : c));
}

function selectionOf(selections, chargeId) {
  return selections.find((c) => c.id === chargeId);
}

// "7:3,8" — the id alone when there's just one of it, so the common case reads
// the same as it always did.
function chargesParam(selections) {
  return selections
    .map((c) => (selectionCount(c.quantity) > 1 ? `${c.id}:${selectionCount(c.quantity)}` : String(c.id)))
    .join(',');
}

function chargesPayload(selections) {
  return selections.map((c) => ({ id: c.id, quantity: selectionCount(c.quantity) }));
}

// A blank or nonsense override is simply not sent, which lets the quote fall
// back to the room category's own price — the same thing the booking will do
// when it's saved.
function overrideParam(value) {
  const amount = Number(value);
  return value !== '' && Number.isFinite(amount) && amount > 0 ? `&basePriceOverride=${amount}` : '';
}

const initialNewBooking = {
  bookingType: 'WALK_IN',
  checkInDate: todayIso(),
  checkOutDate: addDays(todayIso(), 1),
  roomId: '',
  switchableCharges: [],
  // Blank means "charge the category's price" — reception only fills this in
  // when they've agreed something else for this stay.
  basePriceOverride: '',
  // The party is the guest count — adults[0] is the primary guest, and the
  // total is however many names reception actually types in.
  adults: [{ ...emptyGuest }],
  children: [],
  advanceAmount: '',
  advancePaymentMethod: '',
  vehicles: [],
};

export default function Bookings({ onCheckedOut }) {
  const session = getSession();
  const token = session?.token;

  // The chart opens on the days around now rather than on the 1st: the desk
  // wants to see who is still in-house and everything coming, so the window
  // starts a couple of days back and runs a month forward. Stepping the arrows
  // leaves that window behind and moves whole calendar months instead.
  const [view, setView] = useState(() => ({ mode: 'rolling', start: addDays(todayIso(), -LOOKBACK_DAYS) }));
  const [tapeData, setTapeData] = useState(null);
  const [tapeError, setTapeError] = useState('');
  // The tile that's under the pointer right now, with the screen position to
  // float its card at. Guest names live only in here — never on the tiles.
  const [hoverTile, setHoverTile] = useState(null);

  const dates = useMemo(() => {
    const length = view.mode === 'month' ? daysInMonth(view.start) : ROLLING_DAYS;
    return Array.from({ length }, (_, i) => addDays(view.start, i));
  }, [view]);

  const rangeStart = view.start;
  const rangeEnd = useMemo(() => addDays(view.start, dates.length), [view.start, dates.length]);

  const loadTapeChart = () => {
    apiGet(`/bookings/tape-chart?startDate=${rangeStart}&endDate=${rangeEnd}`, { token })
      .then((data) => {
        setTapeData(data);
        setTapeError('');
      })
      .catch((err) => {
        setTapeError(err instanceof ApiError ? err.message : 'Could not load the tape chart.');
      });
  };

  useEffect(() => {
    loadTapeChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart, rangeEnd]);

  // Changing the window unmounts the tile the pointer is on, and an unmounted
  // tile never fires its mouseleave — so the card is dismissed with the move.
  const goToMonth = (monthStart) => {
    setHoverTile(null);
    setView({ mode: 'month', start: monthStart });
  };

  const goToNow = () => {
    setHoverTile(null);
    setView({ mode: 'rolling', start: addDays(todayIso(), -LOOKBACK_DAYS) });
  };

  // Rooms are shown category by category rather than in one long list, so the
  // desk can see at a glance which grade of room is still sellable. Insertion
  // order follows the room ordering the API already sorted.
  const categorySections = useMemo(() => {
    if (!tapeData) return [];
    const groups = new Map();
    for (const room of tapeData.rooms) {
      const name = room.categoryName || 'Uncategorised';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(room);
    }
    return Array.from(groups, ([categoryName, rooms]) => ({ categoryName, rooms }));
  }, [tapeData]);

  // room id -> (date -> booking), covering only the nights on screen. Building
  // it once per load keeps the render a plain lookup per tile instead of a scan
  // of every booking for every day of every room.
  const occupancy = useMemo(() => {
    const byRoom = new Map();
    if (!tapeData) return byRoom;
    for (const booking of tapeData.bookings) {
      const key = String(booking.roomId);
      let byDate = byRoom.get(key);
      if (!byDate) {
        byDate = new Map();
        byRoom.set(key, byDate);
      }
      // Clamped to the visible window: a stay can start before it or run past
      // the end of it, and neither needs walking day by day.
      const from = booking.checkInDate > rangeStart ? booking.checkInDate : rangeStart;
      const to = booking.checkOutDate < rangeEnd ? booking.checkOutDate : rangeEnd;
      for (let d = from; d < to; d = addDays(d, 1)) byDate.set(d, booking);
    }
    return byRoom;
  }, [tapeData, rangeStart, rangeEnd]);

  // How much of each category is sold across the window, as room-nights. It
  // answers the question the desk actually opens this screen with — "what's
  // left in the deluxe rooms?" — without them counting tiles.
  const categoryStats = useMemo(() => {
    const stats = new Map();
    for (const section of categorySections) {
      let sold = 0;
      for (const room of section.rooms) sold += occupancy.get(String(room.id))?.size || 0;
      const capacity = section.rooms.length * dates.length;
      stats.set(section.categoryName, {
        sold,
        capacity,
        percent: capacity ? Math.round((sold / capacity) * 100) : 0,
      });
    }
    return stats;
  }, [categorySections, occupancy, dates.length]);

  // New booking modal
  const [showNewBooking, setShowNewBooking] = useState(false);
  const [newBooking, setNewBooking] = useState(initialNewBooking);
  const [availableRooms, setAvailableRooms] = useState(null);
  const [availableRoomsError, setAvailableRoomsError] = useState('');
  const [quote, setQuote] = useState(null);
  const [newBookingError, setNewBookingError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const openNewBooking = (presetRoomId, presetDate) => {
    const checkInDate = presetDate || todayIso();
    setNewBooking({
      ...initialNewBooking,
      checkInDate,
      checkOutDate: addDays(checkInDate, 1),
      roomId: presetRoomId ? String(presetRoomId) : '',
      // Walk-in means "the guest is here now" — not a valid concept for a
      // future date, so a tape-chart click on a later day starts the form
      // as a pre-reservation instead of silently offering an option that
      // would fail at check-in time.
      bookingType: checkInDate > todayIso() ? 'RESERVATION' : 'WALK_IN',
    });
    setNewBookingError('');
    setAvailableRooms(null);
    setQuote(null);
    setShowNewBooking(true);
  };

  const closeNewBooking = () => {
    if (submitting) return;
    setShowNewBooking(false);
  };

  const validRange =
    newBooking.checkInDate && newBooking.checkOutDate && newBooking.checkOutDate > newBooking.checkInDate;
  const isFutureCheckIn = newBooking.checkInDate > todayIso();
  // A pre-reservation can be held without ID proof; a walk-in is standing at
  // the desk, so theirs is captured on the spot.
  const idProofOptional = newBooking.bookingType === 'RESERVATION';

  useEffect(() => {
    if (!showNewBooking || !validRange) return;
    apiGet(
      `/bookings/available-rooms?checkInDate=${newBooking.checkInDate}&checkOutDate=${newBooking.checkOutDate}`,
      { token }
    )
      .then((data) => {
        setAvailableRooms(data.rooms);
        setAvailableRoomsError('');
        setNewBooking((f) =>
          f.roomId && data.rooms.some((r) => String(r.id) === f.roomId)
            ? f
            : { ...f, roomId: '', switchableCharges: [], basePriceOverride: '' }
        );
      })
      .catch((err) => {
        setAvailableRooms([]);
        setAvailableRoomsError(err instanceof ApiError ? err.message : 'Could not load available rooms.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNewBooking, newBooking.checkInDate, newBooking.checkOutDate]);

  useEffect(() => {
    if (!showNewBooking || !validRange || !newBooking.roomId) {
      setQuote(null);
      return;
    }
    const chargeIds = chargesParam(newBooking.switchableCharges);
    const basePrice = overrideParam(newBooking.basePriceOverride);
    // Typing a rate fires a quote per keystroke, so a slower earlier reply
    // must not land on top of a newer one and show a total for a price that
    // is no longer in the box.
    let current = true;
    apiGet(
      `/bookings/price-quote?roomId=${newBooking.roomId}&checkInDate=${newBooking.checkInDate}&checkOutDate=${newBooking.checkOutDate}${chargeIds ? `&chargeIds=${chargeIds}` : ''}${basePrice}`,
      { token }
    )
      .then((data) => current && setQuote(data))
      .catch(() => current && setQuote(null));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showNewBooking,
    newBooking.roomId,
    newBooking.checkInDate,
    newBooking.checkOutDate,
    newBooking.switchableCharges,
    newBooking.basePriceOverride,
  ]);

  const selectedRoom = availableRooms?.find((r) => String(r.id) === newBooking.roomId);
  const numGuests = newBooking.adults.length + newBooking.children.length;
  const overOccupancy = Boolean(selectedRoom?.maxOccupancy && numGuests > selectedRoom.maxOccupancy);

  const toggleCharge = (chargeId) => {
    setNewBooking((f) => ({ ...f, switchableCharges: toggleSelection(f.switchableCharges, chargeId) }));
  };

  const setChargeQuantity = (chargeId, quantity) => {
    setNewBooking((f) => ({ ...f, switchableCharges: withQuantity(f.switchableCharges, chargeId, quantity) }));
  };

  // Adults and children are both plain repeating rows; the only asymmetries
  // are the phone column (adults only) and the fact that adults[0] is the
  // primary guest, so it can't be removed.
  const addParty = (key, blank) => {
    setNewBooking((f) => ({ ...f, [key]: [...f[key], { ...blank }] }));
  };

  const removeParty = (key, index) => {
    setNewBooking((f) => ({ ...f, [key]: f[key].filter((_, i) => i !== index) }));
  };

  const updateParty = (key, index, patch) => {
    setNewBooking((f) => ({
      ...f,
      [key]: f[key].map((g, i) => (i === index ? { ...g, ...patch } : g)),
    }));
  };

  const addVehicle = () => {
    setNewBooking((f) => ({ ...f, vehicles: [...f.vehicles, { ...emptyVehicle }] }));
  };

  const removeVehicle = (index) => {
    setNewBooking((f) => ({ ...f, vehicles: f.vehicles.filter((_, i) => i !== index) }));
  };

  const updateVehicle = (index, patch) => {
    setNewBooking((f) => ({
      ...f,
      vehicles: f.vehicles.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    }));
  };

  const handleCreateBooking = async (e) => {
    e.preventDefault();
    setNewBookingError('');

    if (!validRange) {
      setNewBookingError('Check-out date must be after check-in date.');
      return;
    }
    // Belt-and-braces: the UI already hides Walk-in for a future date, but
    // a walk-in for a date that hasn't arrived would try to check itself in
    // immediately after creating the booking — and the backend's check-in
    // guard would reject that, leaving the booking created but the form
    // showing an error, as if it had failed outright.
    if (newBooking.bookingType === 'WALK_IN' && isFutureCheckIn) {
      setNewBookingError('Walk-in isn’t available for a future check-in date — switch to pre-reservation.');
      return;
    }
    if (!newBooking.roomId) {
      setNewBookingError('Choose a room.');
      return;
    }
    if (newBooking.basePriceOverride !== '' && !(Number(newBooking.basePriceOverride) > 0)) {
      setNewBookingError('Enter a rate greater than 0, or leave it blank for the category rate.');
      return;
    }
    // adults[0] is the primary guest — the only one whose phone is required.
    const primary = newBooking.adults[0];
    if (!primary.name.trim()) {
      setNewBookingError('Enter the guest name.');
      return;
    }
    if (!primary.phone.trim()) {
      setNewBookingError('Enter the guest phone number.');
      return;
    }
    // A walk-in guest is here now, so their ID proof is captured immediately;
    // a pre-reservation defers it to whenever they actually check in.
    if (newBooking.bookingType === 'WALK_IN') {
      if (!primary.idProofType) {
        setNewBookingError('Choose the ID proof type.');
        return;
      }
      if (!primary.idProofFile) {
        setNewBookingError('Upload the guest’s ID proof (image or PDF).');
        return;
      }
    }
    const hasAdvanceAmount = newBooking.advanceAmount.trim() !== '';
    if (hasAdvanceAmount && !newBooking.advancePaymentMethod) {
      setNewBookingError('Choose a payment method for the advance amount.');
      return;
    }
    if (newBooking.adults.slice(1).some((g) => !g.name.trim())) {
      setNewBookingError('Enter a name for each adult, or remove the empty row.');
      return;
    }
    if (newBooking.children.some((g) => !g.name.trim())) {
      setNewBookingError('Enter a name for each child, or remove the empty row.');
      return;
    }
    const allParty = [...newBooking.adults, ...newBooking.children];
    if (allParty.some((g) => g.idProofFile && g.idProofFile.size > ID_PROOF_MAX_BYTES)) {
      setNewBookingError('Each ID proof file must be 5MB or smaller.');
      return;
    }
    const vehicles = cleanVehicles(newBooking.vehicles);
    const vehicleError = vehicleRowError(vehicles);
    if (vehicleError) {
      setNewBookingError(vehicleError);
      return;
    }

    setSubmitting(true);
    try {
      // Everyone after the primary guest travels in the `guests` array, adults
      // first, each tagged so the split survives into the booking record.
      const otherGuests = [
        ...newBooking.adults.slice(1).map((g) => ({ ...g, isChild: false })),
        ...newBooking.children.map((g) => ({ ...g, phone: '', isChild: true })),
      ];

      const formData = new FormData();
      formData.append('roomId', String(Number(newBooking.roomId)));
      formData.append('checkInDate', newBooking.checkInDate);
      formData.append('checkOutDate', newBooking.checkOutDate);
      formData.append('guestName', primary.name.trim());
      formData.append('guestPhone', primary.phone.trim());
      formData.append('numGuests', String(numGuests));
      formData.append('switchableCharges', JSON.stringify(chargesPayload(newBooking.switchableCharges)));
      if (newBooking.basePriceOverride !== '') {
        formData.append('basePriceOverride', String(Number(newBooking.basePriceOverride)));
      }
      if (primary.idProofType) formData.append('idProofType', primary.idProofType);
      if (primary.idProofFile) formData.append('idProofDocument', primary.idProofFile);
      if (hasAdvanceAmount) {
        formData.append('advanceAmount', String(Number(newBooking.advanceAmount)));
        formData.append('advancePaymentMethod', newBooking.advancePaymentMethod);
      }

      formData.append('vehicles', JSON.stringify(vehicles));

      formData.append(
        'guests',
        JSON.stringify(
          otherGuests.map((g) => ({
            name: g.name.trim(),
            phone: g.phone.trim(),
            isChild: g.isChild,
            ...(g.idProofType ? { idProofType: g.idProofType } : {}),
          }))
        )
      );
      otherGuests.forEach((g, i) => {
        if (g.idProofFile) formData.append(`guestIdProofDocument_${i}`, g.idProofFile);
      });

      const created = await apiPostForm('/bookings', formData, { token });
      if (newBooking.bookingType === 'WALK_IN') {
        await apiPatch(`/bookings/${created.id}/check-in`, {}, { token });
      }
      setShowNewBooking(false);
      loadTapeChart();
    } catch (err) {
      setNewBookingError(err instanceof ApiError ? err.message : 'Could not create the booking.');
    } finally {
      setSubmitting(false);
    }
  };

  // Booking detail modal
  const [selectedBookingId, setSelectedBookingId] = useState(null);
  const [bookingDetail, setBookingDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [showCheckInForm, setShowCheckInForm] = useState(false);
  const initialCheckInForm = {
    advanceAmount: '',
    advancePaymentMethod: '',
    idProofType: '',
    idProofFile: null,
    guests: [],
    vehicles: [],
  };
  const [checkInForm, setCheckInForm] = useState(initialCheckInForm);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [clearingLockout, setClearingLockout] = useState(false);

  // Non-null only while the late-checkout decision is on screen. The amount is
  // held as a string so the field can be cleared to empty while typing without
  // snapping back to 0 under the receptionist's cursor.
  const [lateCheckout, setLateCheckout] = useState(null);
  const [lateChargeInput, setLateChargeInput] = useState('');

  // A booking stays editable for its whole life, right up until its bill is
  // issued — a guest might extend their stay, switch rooms, add someone to
  // the party, or the front desk just mistyped a phone number. Room and
  // check-out date edits are further restricted to BOOKED/CHECKED_IN by the
  // backend — once checked out there's no "stay" left to move or extend,
  // only extras can still be corrected.
  const [showEditBooking, setShowEditBooking] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editAvailableRooms, setEditAvailableRooms] = useState(null);
  const [editAvailableRoomsError, setEditAvailableRoomsError] = useState('');
  const [editQuote, setEditQuote] = useState(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState('');

  const canEditBooking = Boolean(
    bookingDetail && bookingDetail.status !== 'CANCELLED' && !bookingDetail.hasIssuedInvoice
  );
  const canEditStayDetails = Boolean(
    canEditBooking && (bookingDetail.status === 'BOOKED' || bookingDetail.status === 'CHECKED_IN')
  );

  // A pre-reservation holds the room for a future date — check-in only
  // opens once that date arrives, matching the backend's own guard.
  const canCheckInNow = Boolean(bookingDetail && bookingDetail.checkInDate <= todayIsoIST());

  const openEditBooking = () => {
    setEditForm({
      checkOutDate: bookingDetail.checkOutDate,
      roomId: String(bookingDetail.roomId),
      numGuests: String(bookingDetail.numGuests),
      guestName: bookingDetail.guestName,
      guestPhone: bookingDetail.guestPhone,
      switchableCharges: bookingDetail.switchableCharges.map((c) => ({ id: c.id, quantity: String(c.quantity ?? 1) })),
      // Blank here means the stay was never negotiated off the category price,
      // and clearing the box is how it goes back to it.
      basePriceOverride:
        bookingDetail.basePriceOverride != null ? String(bookingDetail.basePriceOverride) : '',
    });
    setEditAvailableRooms(null);
    setEditAvailableRoomsError('');
    setEditQuote(null);
    setEditError('');
    setShowCheckInForm(false);
    setShowEditBooking(true);
  };

  const toggleEditFormCharge = (chargeId) => {
    setEditForm((f) => ({ ...f, switchableCharges: toggleSelection(f.switchableCharges, chargeId) }));
  };

  const setEditFormChargeQuantity = (chargeId, quantity) => {
    setEditForm((f) => ({ ...f, switchableCharges: withQuantity(f.switchableCharges, chargeId, quantity) }));
  };

  useEffect(() => {
    if (!showEditBooking || !canEditStayDetails || !editForm?.checkOutDate) return;
    apiGet(`/bookings/${selectedBookingId}/available-rooms?checkOutDate=${editForm.checkOutDate}`, { token })
      .then((data) => {
        setEditAvailableRooms(data.rooms);
        setEditAvailableRoomsError('');
      })
      .catch((err) => {
        setEditAvailableRooms([]);
        setEditAvailableRoomsError(err instanceof ApiError ? err.message : 'Could not load available rooms.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEditBooking, editForm?.checkOutDate]);

  useEffect(() => {
    if (!showEditBooking || !editForm?.roomId || !bookingDetail) {
      setEditQuote(null);
      return;
    }
    const chargeIds = chargesParam(editForm.switchableCharges);
    const basePrice = overrideParam(editForm.basePriceOverride);
    let current = true;
    apiGet(
      `/bookings/price-quote?roomId=${editForm.roomId}&checkInDate=${bookingDetail.checkInDate}&checkOutDate=${editForm.checkOutDate}${chargeIds ? `&chargeIds=${chargeIds}` : ''}${basePrice}`,
      { token }
    )
      .then((data) => current && setEditQuote(data))
      .catch(() => current && setEditQuote(null));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showEditBooking,
    editForm?.roomId,
    editForm?.checkOutDate,
    editForm?.switchableCharges,
    editForm?.basePriceOverride,
  ]);

  const handleSaveEditBooking = async (e) => {
    e.preventDefault();
    setEditError('');

    if (canEditStayDetails) {
      if (!editForm.checkOutDate || editForm.checkOutDate <= bookingDetail.checkInDate) {
        setEditError('Check-out date must be after check-in date.');
        return;
      }
      if (!editForm.roomId) {
        setEditError('Choose a room.');
        return;
      }
      if (!editForm.numGuests || Number(editForm.numGuests) <= 0) {
        setEditError('Enter a guest count greater than 0.');
        return;
      }
      if (!editForm.guestName.trim()) {
        setEditError('Enter the guest name.');
        return;
      }
      if (!editForm.guestPhone.trim()) {
        setEditError('Enter the guest phone number.');
        return;
      }
      if (editForm.basePriceOverride !== '' && !(Number(editForm.basePriceOverride) > 0)) {
        setEditError('Enter a rate greater than 0, or leave it blank for the category rate.');
        return;
      }
    }

    setEditSubmitting(true);
    try {
      const body = canEditStayDetails
        ? {
            checkOutDate: editForm.checkOutDate,
            roomId: Number(editForm.roomId),
            numGuests: Number(editForm.numGuests),
            guestName: editForm.guestName.trim(),
            guestPhone: editForm.guestPhone.trim(),
            switchableCharges: chargesPayload(editForm.switchableCharges),
            // null, not omitted — an emptied box means "go back to the
            // category price", which the backend can only tell apart from
            // "leave the agreed rate alone" if it's sent explicitly.
            basePriceOverride:
              editForm.basePriceOverride === '' ? null : Number(editForm.basePriceOverride),
          }
        : { switchableCharges: chargesPayload(editForm.switchableCharges) };

      const { booking } = await apiPatch(`/bookings/${selectedBookingId}`, body, { token });
      setBookingDetail(booking);
      setShowEditBooking(false);
      loadTapeChart();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Could not save these changes.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const openDetail = (bookingId) => {
    setSelectedBookingId(bookingId);
    setBookingDetail(null);
    setDetailError('');
    setShowCheckInForm(false);
    setCheckInForm(initialCheckInForm);
    setActionError('');
    setIdProofError('');
    setShowEditBooking(false);
    setEditForm(null);
    setEditError('');
  };

  // At booking time only the primary guest is required — a pre-booked stay
  // might arrive with more guests or a vehicle the guest couldn't name in
  // advance, so check-in can add to whatever guests/vehicles already exist.
  const maxAdditionalGuestsAtCheckIn = bookingDetail
    ? Math.max(0, bookingDetail.numGuests - 1 - bookingDetail.guests.length - checkInForm.guests.length)
    : 0;

  // A walk-in booking already has its ID proof on file; a pre-reservation
  // doesn't, so check-in is where it becomes required.
  const needsIdProofAtCheckIn = Boolean(bookingDetail && !bookingDetail.idProofType);

  const addCheckInGuest = () => {
    setCheckInForm((f) =>
      maxAdditionalGuestsAtCheckIn <= 0 ? f : { ...f, guests: [...f.guests, { ...emptyGuest }] }
    );
  };

  const removeCheckInGuest = (index) => {
    setCheckInForm((f) => ({ ...f, guests: f.guests.filter((_, i) => i !== index) }));
  };

  const updateCheckInGuest = (index, patch) => {
    setCheckInForm((f) => ({
      ...f,
      guests: f.guests.map((g, i) => (i === index ? { ...g, ...patch } : g)),
    }));
  };

  const addCheckInVehicle = () => {
    setCheckInForm((f) => ({ ...f, vehicles: [...f.vehicles, { ...emptyVehicle }] }));
  };

  const removeCheckInVehicle = (index) => {
    setCheckInForm((f) => ({ ...f, vehicles: f.vehicles.filter((_, i) => i !== index) }));
  };

  const updateCheckInVehicle = (index, patch) => {
    setCheckInForm((f) => ({
      ...f,
      vehicles: f.vehicles.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    }));
  };

  const closeDetail = () => {
    if (actionSubmitting) return;
    setSelectedBookingId(null);
  };

  const [idProofError, setIdProofError] = useState('');

  const handleViewIdProof = async () => {
    setIdProofError('');
    try {
      const blob = await apiGetBlob(`/bookings/${selectedBookingId}/id-proof`, { token });
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (err) {
      setIdProofError(err instanceof ApiError ? err.message : 'Could not open the ID proof.');
    }
  };

  const handleViewGuestIdProof = async (guestId) => {
    setIdProofError('');
    try {
      const blob = await apiGetBlob(`/bookings/${selectedBookingId}/guests/${guestId}/id-proof`, { token });
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (err) {
      setIdProofError(err instanceof ApiError ? err.message : 'Could not open the ID proof.');
    }
  };

  useEffect(() => {
    if (!selectedBookingId) return;
    apiGet(`/bookings/${selectedBookingId}`, { token })
      .then((data) => setBookingDetail(data.booking))
      .catch((err) => setDetailError(err instanceof ApiError ? err.message : 'Could not load this booking.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBookingId]);

  // A guest who mistypes their PIN five times locks their own room out of
  // ordering for fifteen minutes, then rings the desk about it. Reception
  // clears it from here rather than waiting out the timer.
  const handleClearFoodLockout = async () => {
    if (!bookingDetail) return;
    setClearingLockout(true);
    try {
      await apiDelete(`/orders/pin-lockouts/${encodeURIComponent(bookingDetail.roomNumber)}`, { token });
      const data = await apiGet(`/bookings/${selectedBookingId}`, { token });
      setBookingDetail(data.booking);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : 'Could not unlock food ordering.');
    } finally {
      setClearingLockout(false);
    }
  };

  const handleCheckIn = async (e) => {
    e.preventDefault();
    setActionError('');

    const hasAmount = checkInForm.advanceAmount.trim() !== '';
    if (hasAmount && !checkInForm.advancePaymentMethod) {
      setActionError('Choose a payment method for the advance amount.');
      return;
    }
    if (needsIdProofAtCheckIn && !checkInForm.idProofType) {
      setActionError('Choose the ID proof type.');
      return;
    }
    if (needsIdProofAtCheckIn && !checkInForm.idProofFile) {
      setActionError('Upload the guest’s ID proof (image or PDF).');
      return;
    }
    if (checkInForm.idProofFile && checkInForm.idProofFile.size > ID_PROOF_MAX_BYTES) {
      setActionError('ID proof file must be 5MB or smaller.');
      return;
    }
    if (checkInForm.guests.some((g) => !g.name.trim())) {
      setActionError('Enter a name for each additional guest, or remove the empty row.');
      return;
    }
    if (checkInForm.guests.some((g) => g.idProofFile && g.idProofFile.size > ID_PROOF_MAX_BYTES)) {
      setActionError('Each ID proof file must be 5MB or smaller.');
      return;
    }
    const checkInVehicles = cleanVehicles(checkInForm.vehicles);
    const checkInVehicleError = vehicleRowError(checkInVehicles);
    if (checkInVehicleError) {
      setActionError(checkInVehicleError);
      return;
    }

    setActionSubmitting(true);
    try {
      const formData = new FormData();
      if (hasAmount) {
        formData.append('advanceAmount', String(Number(checkInForm.advanceAmount)));
        formData.append('advancePaymentMethod', checkInForm.advancePaymentMethod);
      }
      if (checkInForm.idProofType) formData.append('idProofType', checkInForm.idProofType);
      if (checkInForm.idProofFile) formData.append('idProofDocument', checkInForm.idProofFile);
      formData.append('vehicles', JSON.stringify(checkInVehicles));
      formData.append(
        'guests',
        JSON.stringify(
          checkInForm.guests.map((g) => ({
            name: g.name.trim(),
            phone: g.phone.trim(),
            ...(g.idProofType ? { idProofType: g.idProofType } : {}),
          }))
        )
      );
      checkInForm.guests.forEach((g, i) => {
        if (g.idProofFile) formData.append(`guestIdProofDocument_${i}`, g.idProofFile);
      });

      await apiPatchForm(`/bookings/${selectedBookingId}/check-in`, formData, { token });
      setSelectedBookingId(null);
      loadTapeChart();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not check in this guest.');
    } finally {
      setActionSubmitting(false);
    }
  };

  // Checking out is two steps whenever the guest has run past their deadline:
  // ask the server how late they are and what the policy says that is worth,
  // then let reception decide. A guest who is on time never sees the detour.
  const openCheckOut = async () => {
    setActionError('');
    setActionSubmitting(true);
    try {
      const data = await apiGet(`/bookings/${selectedBookingId}/late-checkout`, { token });
      if (!data.lateCheckout.isChargeable) {
        await commitCheckOut(0);
        return;
      }
      setLateCheckout(data.lateCheckout);
      setLateChargeInput(String(data.lateCheckout.suggestedCharge));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not check out this guest.');
    } finally {
      setActionSubmitting(false);
    }
  };

  const commitCheckOut = async (lateCharge) => {
    setActionError('');
    setActionSubmitting(true);
    try {
      await apiPatch(`/bookings/${selectedBookingId}/check-out`, { lateCharge }, { token });
      setLateCheckout(null);
      setSelectedBookingId(null);
      loadTapeChart();
      onCheckedOut?.();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not check out this guest.');
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setActionError('');
    setActionSubmitting(true);
    try {
      await apiPatch(`/bookings/${selectedBookingId}/cancel`, {}, { token });
      setSelectedBookingId(null);
      loadTapeChart();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not cancel this booking.');
    } finally {
      setActionSubmitting(false);
    }
  };

  const today = todayIso();

  // The card floats above the chart in fixed coordinates rather than inside a
  // tile, because the grid scrolls sideways under its own overflow and would
  // otherwise clip a tooltip belonging to a tile near either edge.
  const showTileHover = (event, tile) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const HALF_WIDTH = 116;
    // Tiles in the first category sit close to the top of the window; theirs
    // hangs below so it isn't cut off by the top edge.
    const below = rect.top < 150;
    setHoverTile({
      ...tile,
      below,
      x: Math.min(Math.max(rect.left + rect.width / 2, HALF_WIDTH + 8), window.innerWidth - HALF_WIDTH - 8),
      y: below ? rect.bottom + 8 : rect.top - 8,
    });
  };

  const viewLabel = formatViewLabel(view, dates);
  // The arrows always step calendar months, measured from whichever month the
  // window currently opens in — so one click off the rolling view lands on a
  // clean month either side of now.
  const anchorMonth = monthStartOf(view.start);

  // Each category prints the same month, so the header of dates is built once
  // here and repeated at the top of every category's own calendar. The hovered
  // date lights up in every one of them, which is what makes it possible to
  // read the same night across categories without counting columns.
  const renderDateHead = () => (
    <div className="tape-month__head">
      <div className="tape-month__corner">Room</div>
      {dates.map((d) => {
        const { weekday, day } = formatDateHead(d);
        const classes = ['tape-month__date'];
        if (d === today) classes.push('tape-month__date--today');
        if (isWeekend(d)) classes.push('tape-month__date--weekend');
        if (hoverTile?.date === d) classes.push('tape-month__date--active');
        return (
          <div key={d} className={classes.join(' ')}>
            <span>{weekday.slice(0, 1)}</span>
            <strong>{day}</strong>
          </div>
        );
      })}
    </div>
  );

  const renderRoomRow = (room) => {
    const byDate = occupancy.get(String(room.id));
    const rowClasses = ['tape-month__row'];
    if (hoverTile?.room.id === room.id) rowClasses.push('tape-month__row--active');
    return (
      <div key={room.id} className={rowClasses.join(' ')}>
        <div className="tape-month__room">
          <strong>{room.roomNumber}</strong>
          {room.floor != null && <span>Floor {room.floor}</span>}
        </div>
        {dates.map((d) => {
          const booking = byDate?.get(d);
          // A vacant night is a plain grey slot that starts a booking for that
          // room and date.
          if (!booking) {
            const classes = ['tape-tile', 'tape-tile--vacant'];
            if (isWeekend(d)) classes.push('tape-tile--weekend');
            if (d === today) classes.push('tape-tile--today');
            return (
              <button
                key={d}
                type="button"
                className={classes.join(' ')}
                onClick={() => openNewBooking(room.id, d)}
                onMouseEnter={(e) => showTileHover(e, { room, date: d, booking: null })}
                onFocus={(e) => showTileHover(e, { room, date: d, booking: null })}
                onMouseLeave={() => setHoverTile(null)}
                onBlur={() => setHoverTile(null)}
                aria-label={`${room.roomNumber} vacant on ${formatDateLong(d)}`}
              />
            );
          }
          // A stay reads as one continuous strip: only its first and last night
          // get rounded ends, so a room let twice in a row still shows as two
          // separate blocks.
          const classes = ['tape-tile'];
          classes.push(booking.status === 'CHECKED_IN' ? 'tape-tile--checked-in' : 'tape-tile--booked');
          if (d === booking.checkInDate) classes.push('tape-tile--start');
          if (d === addDays(booking.checkOutDate, -1)) classes.push('tape-tile--end');
          if (d === today) classes.push('tape-tile--today');
          // Pointing at any night of a stay lifts the whole stay, so its real
          // extent is obvious even where it runs off the edge of the month.
          if (hoverTile?.booking?.id === booking.id) classes.push('tape-tile--active');
          return (
            <button
              key={d}
              type="button"
              className={classes.join(' ')}
              onClick={() => openDetail(booking.id)}
              onMouseEnter={(e) => showTileHover(e, { room, date: d, booking })}
              onFocus={(e) => showTileHover(e, { room, date: d, booking })}
              onMouseLeave={() => setHoverTile(null)}
              onBlur={() => setHoverTile(null)}
              aria-label={`${room.roomNumber} ${STATUS_LABEL[booking.status]} on ${formatDateLong(d)}`}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="bookings-panel">
      <div className="bookings-panel__toolbar">
        <div className="tape-nav">
          {/* One control, not three loose buttons: arrows flank the month they
              move, so the whole thing reads as a single month stepper. */}
          <div className="tape-nav__stepper">
            <button
              type="button"
              className="tape-nav__arrow"
              aria-label="Previous month"
              onClick={() => goToMonth(addMonths(anchorMonth, -1))}
            >
              ‹
            </button>
            <span
              className={`tape-nav__label${view.mode === 'rolling' ? ' tape-nav__label--range' : ''}`}
              title={
                view.mode === 'rolling'
                  ? `${formatDateLong(dates[0])} to ${formatDateLong(dates[dates.length - 1])}`
                  : undefined
              }
            >
              <strong>{viewLabel.primary}</strong>
              <span>{viewLabel.secondary}</span>
            </span>
            <button
              type="button"
              className="tape-nav__arrow"
              aria-label="Next month"
              onClick={() => goToMonth(addMonths(anchorMonth, 1))}
            >
              ›
            </button>
          </div>
          {view.mode !== 'rolling' && (
            <button type="button" className="tape-nav__today" onClick={goToNow}>
              Back to now
            </button>
          )}
        </div>
        <button type="button" className="btn-accent" onClick={() => openNewBooking()}>
          + New booking
        </button>
      </div>

      <div className="tape-legend">
        <span className="tape-legend__item">
          <i className="tape-legend__swatch tape-legend__swatch--vacant" />Vacant
        </span>
        <span className="tape-legend__item">
          <i className="tape-legend__swatch tape-legend__swatch--booked" />Reserved
        </span>
        <span className="tape-legend__item">
          <i className="tape-legend__swatch tape-legend__swatch--checked-in" />Checked in
        </span>
        <span className="tape-legend__hint">Hover any tile to see the guest · click to open</span>
      </div>

      {tapeError && (
        <div className="dash-card">
          <div className="dash-state">{tapeError}</div>
        </div>
      )}

      {/* A skeleton of the shape that's coming, rather than a line of text that
          the chart then shoves down the page when it lands. */}
      {!tapeError && !tapeData && (
        <div className="tape-skeleton" aria-busy="true" aria-label="Loading the tape chart">
          {[0, 1].map((card) => (
            <div key={card} className="tape-skeleton__card">
              <div className="tape-skeleton__head" />
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="tape-skeleton__row" />
              ))}
            </div>
          ))}
        </div>
      )}

      {!tapeError && tapeData && tapeData.rooms.length === 0 && (
        <div className="dash-card">
          <div className="dash-state">Add rooms on the Rooms &amp; rates tab first.</div>
        </div>
      )}

      {/* Every category is a self-contained calendar — its own header of dates
          over its own rooms — rather than sections sharing one long grid, so a
          category can be read (and scrolled) without the others in the way. */}
      {!tapeError && tapeData && tapeData.rooms.length > 0 && (
        <div className="tape-months">
          {categorySections.map((section) => {
            const stats = categoryStats.get(section.categoryName);
            return (
              <section key={section.categoryName} className="tape-month-card">
                <div className="tape-month-card__head">
                  <div className="tape-month-card__title">
                    <h4>{section.categoryName}</h4>
                    <span>
                      {section.rooms.length} room{section.rooms.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div
                    className="tape-month-card__meter"
                    title={`${stats.sold} of ${stats.capacity} room-nights sold this month`}
                  >
                    <span className="tape-month-card__meter-track">
                      <span className="tape-month-card__meter-fill" style={{ width: `${stats.percent}%` }} />
                    </span>
                    <span className="tape-month-card__meter-value">{stats.percent}% sold</span>
                  </div>
                </div>
                <div className="tape-chart-scroll" onScroll={() => setHoverTile(null)}>
                  {/* The column track is built here because the number of
                      columns is the length of the month — February and August
                      don't hold the same count, and every row lines up with
                      the dates. */}
                  <div
                    className="tape-month"
                    style={{ '--tape-cols': `var(--tape-room-col) repeat(${dates.length}, var(--tape-tile))` }}
                  >
                    {renderDateHead()}
                    {section.rooms.map(renderRoomRow)}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {hoverTile && (
        <div
          className={`tape-tooltip${hoverTile.below ? ' tape-tooltip--below' : ''}`}
          role="tooltip"
          style={{ left: `${hoverTile.x}px`, top: `${hoverTile.y}px` }}
        >
          {hoverTile.booking ? (
            <>
              <span className="tape-tooltip__top">
                <span
                  className={`tape-tooltip__dot tape-tooltip__dot--${
                    hoverTile.booking.status === 'CHECKED_IN' ? 'checked-in' : 'booked'
                  }`}
                />
                {hoverTile.booking.status === 'CHECKED_IN' ? 'Checked in' : 'Reserved'}
              </span>
              <strong>{hoverTile.booking.guestName}</strong>
              <span className="tape-tooltip__meta">
                Room {hoverTile.room.roomNumber} · {hoverTile.room.categoryName}
              </span>
              <span className="tape-tooltip__dates">
                {formatDateLong(hoverTile.booking.checkInDate)}
                <i>→</i>
                {formatDateLong(hoverTile.booking.checkOutDate)}
              </span>
              <span className="tape-tooltip__meta">
                {nightsOf(hoverTile.booking)} night{nightsOf(hoverTile.booking) === 1 ? '' : 's'}
                {hoverTile.booking.guestPhone ? ` · ${hoverTile.booking.guestPhone}` : ''}
              </span>
            </>
          ) : (
            <>
              <span className="tape-tooltip__top">
                <span className="tape-tooltip__dot tape-tooltip__dot--vacant" />
                Vacant
              </span>
              <strong>Room {hoverTile.room.roomNumber}</strong>
              <span className="tape-tooltip__meta">{hoverTile.room.categoryName}</span>
              <span className="tape-tooltip__dates">{formatDateLong(hoverTile.date)}</span>
              <span className="tape-tooltip__hint">Click to book this night</span>
            </>
          )}
        </div>
      )}

      {showNewBooking && (
        <div className="glass-backdrop bookings-panel__backdrop" onClick={closeNewBooking}>
          <div
            className="glass-panel bookings-panel__modal bookings-panel__modal--form"
            onClick={(e) => e.stopPropagation()}
          >
            <form className="booking-form" onSubmit={handleCreateBooking} noValidate>
              {/* Header stays put while the body scrolls: the booking type
                  changes what the rest of the form requires, so it shouldn't
                  scroll out of sight. */}
              <div className="booking-form__head">
                <div className="booking-form__head-row">
                  <h3>New booking</h3>
                  <div className="toggle-group">
                    {!isFutureCheckIn && (
                      <button
                        type="button"
                        aria-pressed={newBooking.bookingType === 'WALK_IN'}
                        onClick={() => setNewBooking((f) => ({ ...f, bookingType: 'WALK_IN' }))}
                      >
                        Walk-in
                      </button>
                    )}
                    <button
                      type="button"
                      aria-pressed={newBooking.bookingType === 'RESERVATION'}
                      onClick={() => setNewBooking((f) => ({ ...f, bookingType: 'RESERVATION' }))}
                    >
                      Pre-reservation
                    </button>
                  </div>
                </div>
                <p className="bookings-panel__hint">
                  {isFutureCheckIn
                    ? 'Walk-in isn’t available for a future check-in date — this holds the room for a guest arriving later.'
                    : newBooking.bookingType === 'WALK_IN'
                    ? 'Guest is here now — creates the booking and checks them in immediately.'
                    : 'Holds the room for a guest arriving later. ID proof can be added at check-in.'}
                </p>
              </div>

              <div className="booking-form__body">
                {newBookingError && <div className="form-banner form-banner--error">{newBookingError}</div>}

                <div className="form-section">
                  <div className="form-section__title">
                    <span className="form-section__num">1</span>Stay &amp; room
                  </div>
                  <div className="field-row">
                  <div className="field">
                    <label htmlFor="checkInDate">Check-in</label>
                    <input
                      id="checkInDate"
                      type="date"
                      value={newBooking.checkInDate}
                      onChange={(e) => {
                        const checkInDate = e.target.value;
                        setNewBooking((f) => ({
                          ...f,
                          checkInDate,
                          bookingType: checkInDate > todayIso() ? 'RESERVATION' : f.bookingType,
                        }));
                      }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="checkOutDate">Check-out</label>
                    <input
                      id="checkOutDate"
                      type="date"
                      value={newBooking.checkOutDate}
                      onChange={(e) => setNewBooking((f) => ({ ...f, checkOutDate: e.target.value }))}
                    />
                  </div>
                </div>

                {!validRange && <p className="bookings-panel__hint">Choose a valid date range first.</p>}
                {validRange && availableRoomsError && (
                  <div className="form-banner form-banner--error">{availableRoomsError}</div>
                )}
                {/* Room and its rate sit on one line once a room is picked —
                    the rate only ever qualifies the room above it. */}
                {validRange && !availableRoomsError && (
                  <div className={selectedRoom ? 'field-row booking-form__room-row' : undefined}>
                    <div className="field">
                      <label htmlFor="roomId">Available rooms</label>
                      <select
                        id="roomId"
                        value={newBooking.roomId}
                        onChange={(e) =>
                          setNewBooking((f) => ({
                            ...f,
                            roomId: e.target.value,
                            switchableCharges: [],
                            // A rate was agreed for a particular room; picking a
                            // different one is a fresh negotiation.
                            basePriceOverride: '',
                          }))
                        }
                        disabled={!availableRooms}
                      >
                        <option value="">
                          {availableRooms ? 'Choose a room' : 'Loading…'}
                        </option>
                        {availableRooms?.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.roomNumber} — {r.categoryName}
                            {r.floor ? ` · Floor ${r.floor}` : ''}
                          </option>
                        ))}
                      </select>
                      {availableRooms && availableRooms.length === 0 && (
                        <p className="bookings-panel__hint">No rooms are free for this date range.</p>
                      )}
                    </div>
                    {selectedRoom && (
                      <div className="field">
                        <label htmlFor="basePriceOverride">Rate per night</label>
                        <input
                          id="basePriceOverride"
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          placeholder={`${selectedRoom.categoryBasePrice} (category rate)`}
                          value={newBooking.basePriceOverride}
                          onChange={(e) =>
                            setNewBooking((f) => ({ ...f, basePriceOverride: e.target.value }))
                          }
                        />
                        <p className="bookings-panel__hint">
                          Blank charges {formatPrice(selectedRoom.categoryBasePrice)}. Season and
                          extras still apply on top.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Room facts as chips rather than a label/value table — this
                    is reference detail being skimmed, not data being entered,
                    and the table form cost four rows of height for it. */}
                {selectedRoom && (
                  <div className="booking-form__room-meta">
                    <div className="booking-form__chips">
                      <span className="booking-form__chip booking-form__chip--rate">
                        {formatPrice(selectedRoom.categoryBasePrice)}/night
                      </span>
                      <span className="booking-form__chip">{selectedRoom.categoryName}</span>
                      {selectedRoom.bedSize && (
                        <span className="booking-form__chip">{BED_SIZE_LABEL[selectedRoom.bedSize]} bed</span>
                      )}
                      {selectedRoom.bathroomType && (
                        <span className="booking-form__chip">
                          {BATHROOM_TYPE_LABEL[selectedRoom.bathroomType]}
                        </span>
                      )}
                      {selectedRoom.maxOccupancy && (
                        <span className="booking-form__chip">
                          Sleeps {selectedRoom.maxOccupancy}
                        </span>
                      )}
                    </div>
                    {selectedRoom.description && (
                      <p className="booking-form__room-note">{selectedRoom.description}</p>
                    )}
                  </div>
                )}

                {selectedRoom && selectedRoom.switchableCharges.length > 0 && (
                  <div className="field">
                    <label>Extras</label>
                    <div className="checkbox-grid">
                      {selectedRoom.switchableCharges.map((charge) => {
                        const selection = selectionOf(newBooking.switchableCharges, charge.id);
                        return (
                          <label className="checkbox-chip" key={charge.id}>
                            <input
                              type="checkbox"
                              checked={Boolean(selection)}
                              onChange={() => toggleCharge(charge.id)}
                            />
                            {charge.name} ({formatPrice(charge.chargePerNight)}/night)
                            {/* Only counted extras get a box, and only once the
                                extra is on the booking — an unticked row has
                                nothing to count, and AC is on or it isn't. */}
                            {selection && charge.isCounter && (
                              <input
                                className="checkbox-chip__qty"
                                type="number"
                                min="1"
                                step="1"
                                inputMode="numeric"
                                aria-label={`How many ${charge.name}`}
                                value={selection.quantity}
                                onChange={(e) => setChargeQuantity(charge.id, e.target.value)}
                              />
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {quote && (
                  <div className="sim-result">
                    {quote.charges.map((charge, i) => (
                      <div className="sim-result__line" key={i}>
                        <span>
                          {charge.label}
                          {quote.nights.length > 1 ? ` (${quote.nights.length} nights)` : ''}
                        </span>
                        <span>{formatPrice(charge.amount)}</span>
                      </div>
                    ))}
                    <div className="sim-result__total">
                      <span>
                        Total · {quote.nights.length} night{quote.nights.length === 1 ? '' : 's'}
                      </span>
                      <span>{formatPrice(quote.totalPrice)}</span>
                    </div>
                  </div>
                )}
              </div>

                <div className="form-section">
                  <div className="form-section__title">
                    <span className="form-section__num">2</span>Guest details
                  </div>

                  {/* The party count is whatever reception typed in, not a
                      number they set separately and then contradict. */}
                  <div className="booking-form__party-summary">
                    <span className="booking-form__party-total">
                      {numGuests} guest{numGuests === 1 ? '' : 's'}
                    </span>
                    <span className="booking-form__party-split">
                      {describeParty(newBooking.adults.length, newBooking.children.length)}
                    </span>
                  </div>
                  {overOccupancy && (
                    <p className="booking-form__warn">
                      Room {selectedRoom.roomNumber} sleeps {selectedRoom.maxOccupancy}.
                    </p>
                  )}

                  {/* The add button rides in the sub-heading rather than sitting
                      as a full-width bar under the list — same reach, two fewer
                      rows of height across the two party lists. */}
                  <div className="booking-form__subhead">
                    <span className="booking-form__subhead-label">
                      Adults
                      <span className="booking-form__subhead-count">
                        {newBooking.adults.length}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="booking-form__add-inline"
                      onClick={() => addParty('adults', emptyGuest)}
                    >
                      + Add adult
                    </button>
                  </div>
                  <div className="bookings-panel__repeat-list">
                    {newBooking.adults.map((adult, index) => {
                      const isPrimary = index === 0;
                      return (
                        <div className="bookings-panel__party-row" key={index}>
                          <div className="field">
                            <label htmlFor={`adultName-${index}`}>
                              {isPrimary ? 'Name (primary guest)' : 'Name'}
                            </label>
                            <input
                              id={`adultName-${index}`}
                              value={adult.name}
                              onChange={(e) => updateParty('adults', index, { name: e.target.value })}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`adultPhone-${index}`}>
                              Mobile{isPrimary ? '' : ' (optional)'}
                            </label>
                            <input
                              id={`adultPhone-${index}`}
                              value={adult.phone}
                              onChange={(e) => updateParty('adults', index, { phone: e.target.value })}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`adultIdProofType-${index}`}>
                              ID type{isPrimary && !idProofOptional ? '' : ' (optional)'}
                            </label>
                            <select
                              id={`adultIdProofType-${index}`}
                              value={adult.idProofType}
                              onChange={(e) => updateParty('adults', index, { idProofType: e.target.value })}
                            >
                              <option value="">{isPrimary ? 'Choose one' : 'None'}</option>
                              {ID_PROOF_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {t.charAt(0) + t.slice(1).toLowerCase().replace('_', ' ')}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field">
                            <label htmlFor={`adultIdProofFile-${index}`}>
                              Document{isPrimary && !idProofOptional ? '' : ' (optional)'}
                            </label>
                            <input
                              id={`adultIdProofFile-${index}`}
                              type="file"
                              accept={ID_PROOF_ACCEPT}
                              onChange={(e) =>
                                updateParty('adults', index, { idProofFile: e.target.files[0] || null })
                              }
                            />
                          </div>
                          {/* The primary guest is the booking itself — there's
                              no booking left to remove them from. */}
                          {isPrimary ? (
                            <span className="bookings-panel__row-spacer" />
                          ) : (
                            <button
                              type="button"
                              className="bookings-panel__row-remove-btn"
                              onClick={() => removeParty('adults', index)}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="booking-form__subhead">
                    <span className="booking-form__subhead-label">
                      Children
                      <span className="booking-form__subhead-count">
                        {newBooking.children.length}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="booking-form__add-inline"
                      onClick={() => addParty('children', emptyChild)}
                    >
                      + Add child
                    </button>
                  </div>
                  {newBooking.children.length > 0 && (
                    <div className="bookings-panel__repeat-list">
                      {newBooking.children.map((child, index) => (
                        <div
                          className="bookings-panel__party-row bookings-panel__party-row--child"
                          key={index}
                        >
                          <div className="field">
                            <label htmlFor={`childName-${index}`}>Name</label>
                            <input
                              id={`childName-${index}`}
                              value={child.name}
                              onChange={(e) => updateParty('children', index, { name: e.target.value })}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`childIdProofType-${index}`}>ID type (optional)</label>
                            <select
                              id={`childIdProofType-${index}`}
                              value={child.idProofType}
                              onChange={(e) =>
                                updateParty('children', index, { idProofType: e.target.value })
                              }
                            >
                              <option value="">None</option>
                              {ID_PROOF_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {t.charAt(0) + t.slice(1).toLowerCase().replace('_', ' ')}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field">
                            <label htmlFor={`childIdProofFile-${index}`}>Document (optional)</label>
                            <input
                              id={`childIdProofFile-${index}`}
                              type="file"
                              accept={ID_PROOF_ACCEPT}
                              onChange={(e) =>
                                updateParty('children', index, { idProofFile: e.target.files[0] || null })
                              }
                            />
                          </div>
                          <button
                            type="button"
                            className="bookings-panel__row-remove-btn"
                            onClick={() => removeParty('children', index)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="bookings-panel__hint">
                    Documents accept an image (JPG/PNG/WEBP) or PDF, up to 5MB.
                  </p>
                </div>

              {/* The two optional sections share a row — both are usually left
                  shut, and stacked they pushed the guest list off screen. */}
              <div className="booking-form__optional">
              <details className="form-section form-section--collapsible">
                <summary>
                  <span className="form-section__num">3</span>
                  Advance payment
                  {newBooking.advanceAmount.trim() !== '' && (
                    <span className="form-section__badge">{formatPrice(Number(newBooking.advanceAmount))}</span>
                  )}
                </summary>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="newBookingAdvanceAmount">Amount</label>
                    <input
                      id="newBookingAdvanceAmount"
                      type="number"
                      min="0"
                      value={newBooking.advanceAmount}
                      onChange={(e) => setNewBooking((f) => ({ ...f, advanceAmount: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="newBookingAdvancePaymentMethod">Method</label>
                    <select
                      id="newBookingAdvancePaymentMethod"
                      value={newBooking.advancePaymentMethod}
                      onChange={(e) => setNewBooking((f) => ({ ...f, advancePaymentMethod: e.target.value }))}
                    >
                      <option value="">Choose one</option>
                      <option value="CASH">Cash</option>
                      <option value="UPI">UPI</option>
                      <option value="CARD">Card</option>
                    </select>
                  </div>
                </div>
              </details>

              <details className="form-section form-section--collapsible">
                <summary>
                  <span className="form-section__num">4</span>
                  Vehicles
                  {newBooking.vehicles.length > 0 && (
                    <span className="form-section__badge">{newBooking.vehicles.length}</span>
                  )}
                </summary>
                {newBooking.vehicles.length > 0 && (
                  <div className="bookings-panel__repeat-list">
                    {newBooking.vehicles.map((vehicle, index) => (
                      <div className="bookings-panel__vehicle-row" key={index}>
                        <input
                          value={vehicle.number}
                          onChange={(e) => updateVehicle(index, { number: e.target.value })}
                          placeholder="MH07AB1234"
                          aria-label={`Vehicle number ${index + 1}`}
                        />
                        <select
                          value={vehicle.type}
                          onChange={(e) => updateVehicle(index, { type: e.target.value })}
                          aria-label={`Vehicle type ${index + 1}`}
                        >
                          <option value="">Type</option>
                          {Object.entries(VEHICLE_TYPE_LABEL).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="bookings-panel__remove-btn"
                          onClick={() => removeVehicle(index)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" className="bookings-panel__add-btn" onClick={addVehicle}>
                  + Add vehicle
                </button>
              </details>
              </div>

              </div>

              {/* Total and actions pinned below the scroll area. The itemised
                  breakdown still lives up in the form, but the figure being
                  charged has to stay visible while filling in guest details —
                  otherwise you commit to a price you can no longer see. */}
              <div className="booking-form__foot">
                <div className="booking-form__total">
                  {quote ? (
                    <>
                      <span className="booking-form__total-label">
                        {quote.nights.length} night{quote.nights.length === 1 ? '' : 's'}
                      </span>
                      <span className="booking-form__total-value">{formatPrice(quote.totalPrice)}</span>
                    </>
                  ) : (
                    <span className="booking-form__total-label">Pick dates and a room</span>
                  )}
                </div>
                <div className="booking-form__foot-actions">
                  <button type="button" className="btn-secondary" onClick={closeNewBooking} disabled={submitting}>
                    Cancel
                  </button>
                  <button className="btn-accent" type="submit" disabled={submitting}>
                    {submitting
                      ? 'Booking…'
                      : newBooking.bookingType === 'WALK_IN'
                      ? 'Add and check in'
                      : 'Create reservation'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedBookingId && (
        <div className="glass-backdrop bookings-panel__backdrop" onClick={closeDetail}>
          <div className="glass-panel bookings-panel__modal" onClick={(e) => e.stopPropagation()}>
            {detailError && <div className="form-banner form-banner--error">{detailError}</div>}

            {!detailError && !bookingDetail && <div className="dash-state">Loading…</div>}

            {!detailError && bookingDetail && (
              <>
                <div className="bookings-panel__detail-header">
                  <h3>{bookingDetail.guestName}</h3>
                  <span
                    className={`badge ${bookingDetail.status === 'CHECKED_IN' ? 'badge--on' : 'badge--off'}`}
                  >
                    {STATUS_LABEL[bookingDetail.status]}
                  </span>
                </div>

                <div className="chart-list">
                  <div className="chart-row">
                    <span className="chart-row__name">Room</span>
                    <span className="chart-row__value">
                      {bookingDetail.roomNumber} · {bookingDetail.categoryName}
                    </span>
                  </div>
                  <div className="chart-row">
                    <span className="chart-row__name">Dates</span>
                    <span className="chart-row__value">
                      {formatDateLong(bookingDetail.checkInDate)} – {formatDateLong(bookingDetail.checkOutDate)}
                    </span>
                  </div>
                  <div className="chart-row">
                    <span className="chart-row__name">Phone</span>
                    <span className="chart-row__value">{bookingDetail.guestPhone}</span>
                  </div>
                  <div className="chart-row">
                    <span className="chart-row__name">Guests</span>
                    <span className="chart-row__value">
                      {bookingDetail.numGuests} ·{' '}
                      {describeParty(
                        bookingDetail.numGuests - bookingDetail.childCount,
                        bookingDetail.childCount
                      )}
                    </span>
                  </div>
                  {bookingDetail.idProofType && (
                    <div className="chart-row">
                      <span className="chart-row__name">ID proof</span>
                      <span className="chart-row__value">
                        {bookingDetail.idProofType}
                        {bookingDetail.hasIdProofDocument && (
                          <button type="button" className="bookings-panel__link-btn" onClick={handleViewIdProof}>
                            View
                          </button>
                        )}
                      </span>
                    </div>
                  )}
                  {bookingDetail.status === 'CHECKED_IN' && bookingDetail.foodPin && (
                    <div className="chart-row">
                      <span className="chart-row__name">Food PIN</span>
                      <span className="chart-row__value">
                        <div className="bookings-panel__pin">
                          <span className="bookings-panel__pin-value">{bookingDetail.foodPin}</span>
                          {bookingDetail.foodOrderingLockedUntil ? (
                            <span className="badge badge--off">Locked</span>
                          ) : null}
                        </div>
                        <div className="bookings-panel__pin-hint">
                          {bookingDetail.foodOrderingLockedUntil ? (
                            <>
                              Too many wrong PINs — ordering is blocked for this room.
                              <button
                                type="button"
                                className="bookings-panel__link-btn"
                                onClick={handleClearFoodLockout}
                                disabled={clearingLockout}
                              >
                                {clearingLockout ? 'Clearing…' : 'Unlock now'}
                              </button>
                            </>
                          ) : (
                            'Read this out to the guest — they need it to order food from the QR code.'
                          )}
                        </div>
                      </span>
                    </div>
                  )}
                  {bookingDetail.guests.length > 0 && (
                    <div className="chart-row">
                      <span className="chart-row__name">Other guests</span>
                      <span className="chart-row__value">
                        <div className="bookings-panel__guest-detail-list">
                          {bookingDetail.guests.map((g) => (
                            <div key={g.id} className="bookings-panel__guest-detail">
                              {g.name}
                              {g.isChild ? ' (child)' : ''}
                              {g.phone ? ` · ${g.phone}` : ''}
                              {g.idProofType ? ` · ${g.idProofType}` : ''}
                              {g.hasIdProofDocument && (
                                <button
                                  type="button"
                                  className="bookings-panel__link-btn"
                                  onClick={() => handleViewGuestIdProof(g.id)}
                                >
                                  View
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </span>
                    </div>
                  )}
                  {idProofError && (
                    <div className="chart-row">
                      <span className="chart-row__value form-banner form-banner--error">{idProofError}</span>
                    </div>
                  )}
                  {bookingDetail.vehicles.length > 0 && (
                    <div className="chart-row">
                      <span className="chart-row__name">Vehicles</span>
                      <span className="chart-row__value">
                        {bookingDetail.vehicles
                          .map((v) => (v.type ? `${v.number} (${VEHICLE_TYPE_LABEL[v.type]})` : v.number))
                          .join(' · ')}
                      </span>
                    </div>
                  )}
                  {bookingDetail.switchableCharges.length > 0 && (
                    <div className="chart-row">
                      <span className="chart-row__name">Extras</span>
                      <span className="chart-row__value">
                        {bookingDetail.switchableCharges
                          .map((c) => (c.quantity > 1 ? `${c.name} ×${c.quantity}` : c.name))
                          .join(' · ')}
                      </span>
                    </div>
                  )}
                  <div className="chart-row">
                    <span className="chart-row__name">Total price</span>
                    <span className="chart-row__value">{formatPrice(bookingDetail.totalPrice)}</span>
                  </div>
                  {bookingDetail.advanceAmount != null && (
                    <div className="chart-row">
                      <span className="chart-row__name">Advance paid</span>
                      <span className="chart-row__value">
                        {formatPrice(bookingDetail.advanceAmount)} ({bookingDetail.advancePaymentMethod})
                      </span>
                    </div>
                  )}
                </div>

                {actionError && <div className="form-banner form-banner--error">{actionError}</div>}

                {showEditBooking && editForm && (
                  <form onSubmit={handleSaveEditBooking} className="form-section">
                    <div className="form-section__title">
                      {canEditStayDetails ? 'Edit booking' : 'Edit extras'}
                    </div>
                    <p className="bookings-panel__hint">
                      {canEditStayDetails
                        ? 'Editable until this stay is billed — extend the stay, move rooms or fix a detail.'
                        : 'This stay is already checked out — only extras can still be corrected before billing.'}
                    </p>

                    {canEditStayDetails && (
                      <>
                        <div className="field-row">
                          <div className="field">
                            <label htmlFor="editGuestName">Guest name</label>
                            <input
                              id="editGuestName"
                              value={editForm.guestName}
                              onChange={(e) => setEditForm((f) => ({ ...f, guestName: e.target.value }))}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="editGuestPhone">Phone</label>
                            <input
                              id="editGuestPhone"
                              value={editForm.guestPhone}
                              onChange={(e) => setEditForm((f) => ({ ...f, guestPhone: e.target.value }))}
                            />
                          </div>
                        </div>

                        <div className="field-row">
                          <div className="field">
                            <label htmlFor="editCheckOutDate">Check-out</label>
                            <input
                              id="editCheckOutDate"
                              type="date"
                              min={addDays(bookingDetail.checkInDate, 1)}
                              value={editForm.checkOutDate}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, checkOutDate: e.target.value, roomId: '' }))
                              }
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="editNumGuests">Number of guests</label>
                            <input
                              id="editNumGuests"
                              type="number"
                              min="1"
                              value={editForm.numGuests}
                              onChange={(e) => setEditForm((f) => ({ ...f, numGuests: e.target.value }))}
                            />
                          </div>
                        </div>

                        <div className="field">
                          <label htmlFor="editRoomId">Room</label>
                          {editAvailableRoomsError && (
                            <div className="form-banner form-banner--error">{editAvailableRoomsError}</div>
                          )}
                          {!editAvailableRoomsError && (
                            <select
                              id="editRoomId"
                              value={editForm.roomId}
                              onChange={(e) => setEditForm((f) => ({ ...f, roomId: e.target.value }))}
                              disabled={!editAvailableRooms}
                            >
                              <option value="">{editAvailableRooms ? 'Choose a room' : 'Loading…'}</option>
                              {editAvailableRooms?.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.roomNumber} — {r.categoryName} · {formatPrice(r.categoryBasePrice)}/night
                                  {r.floor ? ` · Floor ${r.floor}` : ''}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>

                        <div className="field">
                          <label htmlFor="editBasePriceOverride">Rate per night</label>
                          <input
                            id="editBasePriceOverride"
                            type="number"
                            min="1"
                            step="1"
                            inputMode="numeric"
                            placeholder={String(
                              editAvailableRooms?.find((r) => String(r.id) === editForm.roomId)
                                ?.categoryBasePrice ?? ''
                            )}
                            value={editForm.basePriceOverride}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, basePriceOverride: e.target.value }))
                            }
                          />
                          <p className="bookings-panel__hint">
                            Leave blank to charge the room category’s own rate. Season adjustments
                            and extras still apply on top.
                          </p>
                        </div>
                      </>
                    )}

                    <div className="field">
                      <label>Extras</label>
                      {bookingDetail.availableSwitchableCharges.length === 0 && (
                        <p className="bookings-panel__hint">No extras configured for this lodge.</p>
                      )}
                      {bookingDetail.availableSwitchableCharges.length > 0 && (
                        <div className="checkbox-grid">
                          {bookingDetail.availableSwitchableCharges.map((charge) => {
                            const selection = selectionOf(editForm.switchableCharges, charge.id);
                            return (
                              <label className="checkbox-chip" key={charge.id}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(selection)}
                                  onChange={() => toggleEditFormCharge(charge.id)}
                                />
                                {charge.name} ({formatPrice(charge.chargePerNight)}/night)
                                {selection && charge.isCounter && (
                                  <input
                                    className="checkbox-chip__qty"
                                    type="number"
                                    min="1"
                                    step="1"
                                    inputMode="numeric"
                                    aria-label={`How many ${charge.name}`}
                                    value={selection.quantity}
                                    onChange={(e) => setEditFormChargeQuantity(charge.id, e.target.value)}
                                  />
                                )}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {editQuote && (
                      <div className="sim-result">
                        {editQuote.charges.map((charge, i) => (
                          <div className="sim-result__line" key={i}>
                            <span>
                              {charge.label}
                              {editQuote.nights.length > 1 ? ` (${editQuote.nights.length} nights)` : ''}
                            </span>
                            <span>{formatPrice(charge.amount)}</span>
                          </div>
                        ))}
                        <div className="sim-result__total">
                          <span>
                            Total · {editQuote.nights.length} night{editQuote.nights.length === 1 ? '' : 's'}
                          </span>
                          <span>{formatPrice(editQuote.totalPrice)}</span>
                        </div>
                      </div>
                    )}

                    {editError && <div className="form-banner form-banner--error">{editError}</div>}
                    <div className="bookings-panel__actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setShowEditBooking(false)}
                        disabled={editSubmitting}
                      >
                        Back
                      </button>
                      <button className="btn-accent" type="submit" disabled={editSubmitting}>
                        {editSubmitting ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </form>
                )}

                {bookingDetail.status === 'BOOKED' && !showCheckInForm && !showEditBooking && (
                  <>
                    {!canCheckInNow && (
                      <p className="bookings-panel__hint">
                        Reserved for {formatDateLong(bookingDetail.checkInDate)} — check-in opens on that date.
                      </p>
                    )}
                    <div className="bookings-panel__actions">
                      <button
                        type="button"
                        className="bookings-panel__danger-link"
                        onClick={handleCancel}
                        disabled={actionSubmitting}
                      >
                        Cancel booking
                      </button>
                      <button type="button" className="btn-secondary" onClick={openEditBooking} disabled={actionSubmitting}>
                        Edit booking
                      </button>
                      <button
                        type="button"
                        className="btn-accent"
                        onClick={() => setShowCheckInForm(true)}
                        disabled={actionSubmitting || !canCheckInNow}
                        title={canCheckInNow ? undefined : 'Check-in opens on the reserved date.'}
                      >
                        Check in
                      </button>
                    </div>
                  </>
                )}

                {bookingDetail.status === 'BOOKED' && showCheckInForm && (
                  <form onSubmit={handleCheckIn} className="form-section">
                    {needsIdProofAtCheckIn && (
                      <>
                        <div className="form-section__title">Guest ID proof</div>
                        <p className="bookings-panel__hint">
                          Wasn&apos;t collected when this room was reserved — required before check-in.
                        </p>
                        <div className="field-row">
                          <div className="field">
                            <label htmlFor="checkInIdProofType">ID proof type</label>
                            <select
                              id="checkInIdProofType"
                              value={checkInForm.idProofType}
                              onChange={(e) => setCheckInForm((f) => ({ ...f, idProofType: e.target.value }))}
                            >
                              <option value="">Choose one</option>
                              {ID_PROOF_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {t.charAt(0) + t.slice(1).toLowerCase().replace('_', ' ')}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field">
                            <label htmlFor="checkInIdProofFile">ID proof document</label>
                            <input
                              id="checkInIdProofFile"
                              type="file"
                              accept={ID_PROOF_ACCEPT}
                              onChange={(e) =>
                                setCheckInForm((f) => ({ ...f, idProofFile: e.target.files[0] || null }))
                              }
                            />
                            <p className="bookings-panel__hint">Image (JPG/PNG/WEBP) or PDF, up to 5MB.</p>
                          </div>
                        </div>
                      </>
                    )}

                    <div className="form-section__title">Advance payment (optional)</div>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor="advanceAmount">Amount</label>
                        <input
                          id="advanceAmount"
                          type="number"
                          min="0"
                          value={checkInForm.advanceAmount}
                          onChange={(e) => setCheckInForm((f) => ({ ...f, advanceAmount: e.target.value }))}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="advancePaymentMethod">Method</label>
                        <select
                          id="advancePaymentMethod"
                          value={checkInForm.advancePaymentMethod}
                          onChange={(e) =>
                            setCheckInForm((f) => ({ ...f, advancePaymentMethod: e.target.value }))
                          }
                        >
                          <option value="">Choose one</option>
                          <option value="CASH">Cash</option>
                          <option value="UPI">UPI</option>
                          <option value="CARD">Card</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-section__title">Add guest details (optional)</div>
                    <p className="bookings-panel__hint">
                      For guests whose details weren&apos;t taken at booking time.
                    </p>
                    {checkInForm.guests.length > 0 && (
                      <div className="bookings-panel__repeat-list">
                        {checkInForm.guests.map((guest, index) => (
                          <div className="bookings-panel__guest-row" key={index}>
                            <div className="field">
                              <label htmlFor={`checkInGuestName-${index}`}>Name</label>
                              <input
                                id={`checkInGuestName-${index}`}
                                value={guest.name}
                                onChange={(e) => updateCheckInGuest(index, { name: e.target.value })}
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`checkInGuestPhone-${index}`}>Phone (optional)</label>
                              <input
                                id={`checkInGuestPhone-${index}`}
                                value={guest.phone}
                                onChange={(e) => updateCheckInGuest(index, { phone: e.target.value })}
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`checkInGuestIdProofType-${index}`}>ID proof type (optional)</label>
                              <select
                                id={`checkInGuestIdProofType-${index}`}
                                value={guest.idProofType}
                                onChange={(e) => updateCheckInGuest(index, { idProofType: e.target.value })}
                              >
                                <option value="">None</option>
                                {ID_PROOF_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {t.charAt(0) + t.slice(1).toLowerCase().replace('_', ' ')}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="field">
                              <label htmlFor={`checkInGuestIdProofFile-${index}`}>
                                ID proof document (optional)
                              </label>
                              <input
                                id={`checkInGuestIdProofFile-${index}`}
                                type="file"
                                accept={ID_PROOF_ACCEPT}
                                onChange={(e) =>
                                  updateCheckInGuest(index, { idProofFile: e.target.files[0] || null })
                                }
                              />
                            </div>
                            <button
                              type="button"
                              className="bookings-panel__remove-btn"
                              onClick={() => removeCheckInGuest(index)}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      className="bookings-panel__add-btn"
                      onClick={addCheckInGuest}
                      disabled={maxAdditionalGuestsAtCheckIn <= 0}
                    >
                      + Add guest
                    </button>

                    <div className="form-section__title">Add vehicles (optional)</div>
                    {checkInForm.vehicles.length > 0 && (
                      <div className="bookings-panel__repeat-list">
                        {checkInForm.vehicles.map((vehicle, index) => (
                          <div className="bookings-panel__vehicle-row" key={index}>
                            <input
                              value={vehicle.number}
                              onChange={(e) => updateCheckInVehicle(index, { number: e.target.value })}
                              placeholder="MH07AB1234"
                              aria-label={`Vehicle number ${index + 1}`}
                            />
                            <select
                              value={vehicle.type}
                              onChange={(e) => updateCheckInVehicle(index, { type: e.target.value })}
                              aria-label={`Vehicle type ${index + 1}`}
                            >
                              <option value="">Type</option>
                              {Object.entries(VEHICLE_TYPE_LABEL).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="bookings-panel__remove-btn"
                              onClick={() => removeCheckInVehicle(index)}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button type="button" className="bookings-panel__add-btn" onClick={addCheckInVehicle}>
                      + Add vehicle
                    </button>

                    <div className="bookings-panel__actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setShowCheckInForm(false)}
                        disabled={actionSubmitting}
                      >
                        Back
                      </button>
                      <button className="btn-accent" type="submit" disabled={actionSubmitting}>
                        {actionSubmitting ? 'Checking in…' : 'Confirm check-in'}
                      </button>
                    </div>
                  </form>
                )}

                {bookingDetail.status === 'CHECKED_IN' && !showEditBooking && (
                  <div className="bookings-panel__actions">
                    <button type="button" className="btn-secondary" onClick={openEditBooking} disabled={actionSubmitting}>
                      Edit booking
                    </button>
                    <button
                      type="button"
                      className="btn-accent"
                      onClick={openCheckOut}
                      disabled={actionSubmitting}
                    >
                      {actionSubmitting ? 'Checking out…' : 'Check out'}
                    </button>
                  </div>
                )}

                {bookingDetail.status === 'CHECKED_OUT' && !showEditBooking && (
                  <div className="bookings-panel__actions">
                    {canEditBooking ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={openEditBooking}
                        disabled={actionSubmitting}
                      >
                        Edit extras
                      </button>
                    ) : (
                      <span className="bookings-panel__hint">This stay has been billed — extras are locked.</span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {lateCheckout && (
        <LateCheckoutDialog
          lateCheckout={lateCheckout}
          amount={lateChargeInput}
          onAmount={setLateChargeInput}
          submitting={actionSubmitting}
          error={actionError}
          onCancel={() => setLateCheckout(null)}
          onConfirm={commitCheckOut}
        />
      )}
    </div>
  );
}

const BAND_LABEL = {
  HALF_DAY: 'part-day rate',
  FULL_DAY: 'full-night rate',
};

// The one moment in this app where the software asks a person for a number
// instead of working it out. The policy's suggestion is pre-filled and the
// arithmetic behind it is spelled out, because the receptionist has to justify
// the figure to a guest standing in front of them — and has to be able to
// waive it in one tap when the guest's taxi was the thing that was late.
function LateCheckoutDialog({ lateCheckout, amount, onAmount, submitting, error, onCancel, onConfirm }) {
  const parsed = Number(amount);
  const valid = amount !== '' && Number.isFinite(parsed) && parsed >= 0;
  const dueAt = new Date(lateCheckout.deadline);

  return (
    <div className="glass-backdrop bookings-panel__backdrop" onClick={() => !submitting && onCancel()}>
      <div
        className="glass-panel bookings-panel__modal late-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lateCheckoutTitle"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="lateCheckoutTitle">Late checkout</h3>

        <p className="late-modal__lead">
          This stay was due out at{' '}
          <strong>
            {dueAt.toLocaleString([], {
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </strong>{' '}
          — the guest is <strong>{lateCheckout.lateLabel}</strong>.
        </p>

        <div className="late-modal__basis">
          <span>
            {BAND_LABEL[lateCheckout.band] || 'policy rate'} · {lateCheckout.percent}% of{' '}
            {formatPrice(lateCheckout.lastNightRate)}
          </span>
          <span className="late-modal__suggested">
            suggests {formatPrice(lateCheckout.suggestedCharge)}
          </span>
        </div>

        <div className="field">
          <label htmlFor="lateCharge">Charge the guest</label>
          <input
            id="lateCharge"
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            value={amount}
            disabled={submitting}
            onChange={(e) => onAmount(e.target.value)}
          />
          <p className="late-modal__help">
            Goes on the bill as its own line, taxed with the room. Set it to 0 to waive it.
          </p>
        </div>

        {error && <div className="form-banner form-banner--error">{error}</div>}

        <div className="bookings-panel__actions late-modal__actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
            Back
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onConfirm(0)}
            disabled={submitting}
          >
            Waive &amp; check out
          </button>
          <button
            type="button"
            className="btn-accent"
            onClick={() => onConfirm(parsed)}
            disabled={submitting || !valid}
          >
            {submitting ? 'Checking out…' : `Charge ${valid ? formatPrice(parsed) : ''} & check out`}
          </button>
        </div>
      </div>
    </div>
  );
}
