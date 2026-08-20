import { useEffect, useMemo, useRef, useState } from 'react';
import {
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiPatchForm,
  apiPostForm,
  apiGetBlob,
  apiDelete,
  ApiError,
} from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { formatPrice } from './priceFormat';
import StayDetails from './StayDetails';
import AdvanceReceiptModal from './AdvanceReceiptModal';
import { VEHICLE_TYPE_LABEL, describeParty, formatDateLong, idProofLabel } from './stayFormat';
import './forms.css';
import './chartSections.css';
import './tapeChart.css';
import './Bookings.css';

const ID_PROOF_TYPES = ['AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID', 'OTHER'];
// Money that arrives this way leaves a reference the property can reconcile
// against its settlement statement; cash doesn't, so asking for one there
// would be asking staff to invent a number. Mirrors ONLINE_METHODS on the
// server, which is what actually enforces it.
const ONLINE_PAYMENT_METHODS = ['UPI', 'CARD'];
const needsPaymentReference = (method) => ONLINE_PAYMENT_METHODS.includes(method);

// What to send as the advance's transaction number. Dropped when the method is
// cash: switching UPI → Cash after typing a reference would otherwise file a
// transaction number against a payment that never had one.
function advanceReferenceOf(form) {
  return needsPaymentReference(form.advancePaymentMethod) ? form.advanceReference.trim() : '';
}
const ID_PROOF_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const ID_PROOF_MAX_BYTES = 5 * 1024 * 1024;
const STATUS_LABEL = { BOOKED: 'Booked', CHECKED_IN: 'Checked in', CHECKED_OUT: 'Checked out', CANCELLED: 'Cancelled' };
// What a stay looks like on the chart, and in the hover card, per status.
// A completed stay is drawn in a quieter colour than a live one: it is history,
// and nothing on the desk can be done about it any more.
const TILE_CLASS = {
  BOOKED: 'tape-tile--booked',
  CHECKED_IN: 'tape-tile--checked-in',
  CHECKED_OUT: 'tape-tile--checked-out',
};
const TOOLTIP_DOT = { BOOKED: 'booked', CHECKED_IN: 'checked-in', CHECKED_OUT: 'checked-out' };
// The chart says "Reserved" where the data says BOOKED — the desk's word for a
// room held for a date still to come.
const TILE_STATUS_LABEL = { ...STATUS_LABEL, BOOKED: 'Reserved' };
const BED_SIZE_LABEL = { SINGLE: 'Single', DOUBLE: 'Double', QUEEN: 'Queen', KING: 'King' };
const BATHROOM_TYPE_LABEL = { ATTACHED: 'Attached bathroom', COMMON: 'Common bathroom' };
// Today by the IST calendar, which is the only "today" this app has: every
// lodge on it is in India, and UTC lags IST by up to 5.5 hours — a plain
// toISOString() would still read "yesterday" for the first few hours of an IST
// day. That gap is what decides whether a night counts as past, so the whole
// screen shares one definition of it and stays matched to the backend guards.
function todayIso() {
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

// The chart is anchored to a whole calendar month, so every date that drives
// it is normalised to the 1st before anything else looks at it.
function monthStartOf(dateStr) {
  return `${dateStr.slice(0, 7)}-01`;
}

// The month the columns belong to, named in full across the date header.
function formatMonthBand(monthStart) {
  const d = new Date(`${monthStart}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
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

// The stepper's label, split in two so the month name carries the emphasis and
// the year sits back from it — the year is the part nobody is actually reading.
function formatViewLabel(monthStart) {
  const d = new Date(`${monthStart}T00:00:00Z`);
  return {
    primary: d.toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' }),
    secondary: String(d.getUTCFullYear()),
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
// A late arrival taken at check-in. One row for adults and children alike,
// because the desk is typing a name off an ID card and doesn't want two
// differently-shaped forms to choose between first — which of the two it is
// rides on the row instead. Adult unless said otherwise: most are.
const emptyCheckInGuest = { name: '', phone: '', idProofType: '', idProofFile: null, isChild: false };
// Type starts unset so reception picks what actually pulled up rather than
// accepting whichever option happened to be listed first.
const emptyVehicle = { number: '', type: '' };

// "4 adults and 2 children" reads better on the desk than "6 guests", but
// the children half only earns its place when there are any.
// A row someone added and then thought better of is dropped rather than
// rejected — clicking "+ Add vehicle" and changing your mind shouldn't block
// the booking. Anything half-filled is a real mistake and gets reported.
function cleanVehicles(vehicles) {
  return vehicles
    .map((v) => ({ number: v.number.trim(), type: v.type }))
    .filter((v) => v.number || v.type);
}

// Said when a change of dates takes the chosen room away. The overlapping
// stays are named by their dates because that is the actionable part: it tells
// the owner how far they can extend, or which nights to move. Guest names are
// deliberately absent — who holds the room isn't the desk's question here, and
// the availability endpoint doesn't return them.
//
// "reserved through" rather than "to": a stay checking out on the 19th holds
// the nights up to the 18th, and "booked to the 19th" reads as though the 19th
// itself were taken when it is free to sell.
function roomUnavailableMessage(roomNumber, conflicts, checkOutDate) {
  const room = roomNumber ? `Room ${roomNumber}` : 'That room';

  if (conflicts.length === 0) {
    return `${room} is no longer available for the selected dates. Please choose another room.`;
  }

  // The nights actually occupied, so a one-night stay reads "on 16 Aug" rather
  // than "16 Aug – 16 Aug".
  const periods = conflicts.map((c) => {
    const lastNight = addDays(c.checkOutDate, -1);
    return lastNight === c.checkInDate
      ? `on ${formatDateLong(c.checkInDate)}`
      : `from ${formatDateLong(c.checkInDate)} to ${formatDateLong(lastNight)}`;
  });

  const listed =
    periods.length === 1
      ? periods[0]
      : `${periods.slice(0, -1).join(', ')} and ${periods[periods.length - 1]}`;

  return (
    `${room} is unavailable for a stay ending ${formatDateLong(checkOutDate)} — ` +
    `it is already reserved ${listed}.`
  );
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

// A blank or nonsense concession simply isn't sent, so the quote shows the
// full price — the same thing the booking will do when it's saved.
function discountParam(value) {
  const amount = Number(value);
  return value !== '' && Number.isFinite(amount) && amount > 0 ? `&discountAmount=${amount}` : '';
}

// Read-only: nothing sets a negotiated nightly rate any more, but a booking
// made before concessions replaced it still prices against one, so its edit
// quote has to ask for the same rate the save will use.
function legacyRateParam(booking) {
  return booking?.basePriceOverride ? `&basePriceOverride=${booking.basePriceOverride}` : '';
}

const initialBookingForm = {
  bookingType: 'WALK_IN',
  checkInDate: todayIso(),
  checkOutDate: addDays(todayIso(), 1),
  roomId: '',
  switchableCharges: [],
  // Blank means "charge the full quote" — reception only fills this in when
  // they've agreed to knock something off, once, at the end.
  discountAmount: '',
  // The party is the guest count — adults[0] is the primary guest, and the
  // total is however many names reception actually types in.
  adults: [{ ...emptyGuest }],
  children: [],
  advanceAmount: '',
  advancePaymentMethod: '',
  // The UPI/card transaction number. Blank on cash, which leaves no trail to
  // record — see ONLINE_PAYMENT_METHODS.
  advanceReference: '',
  vehicles: [],
};

// A half-filled booking, parked on the server. Reception gets interrupted
// mid-form — a guest walks up, a phone rings — and the answers already typed in
// are worth keeping.
//
// It lives in the database rather than this browser so the whole desk can see
// it: it shows on the tape chart against the room and nights it names, and the
// person on the next shift can pick it up. It reserves nothing, though — see
// dbo.booking_drafts.
//
// File inputs are the one thing a draft can't hold. A File is a handle to
// something on disk, not data, so it can't be serialised — the count of what
// was dropped rides along so reopening can say how many to attach again.
function draftableForm(form) {
  const strip = (people) => people.map((p) => ({ ...p, idProofFile: null }));
  return {
    ...form,
    droppedFiles: [...form.adults, ...form.children].filter((p) => p.idProofFile).length,
    adults: strip(form.adults),
    children: strip(form.children),
  };
}

// A draft saved against an older shape of this form would restore into a
// half-populated one and crash on the first .map — cheaper to check the two
// fields the form can't run without than to version the payload.
function usableDraft(draft) {
  return Boolean(draft?.form?.adults?.length && Array.isArray(draft.form.children));
}

// The whole form as one comparable string, for telling whether anything has
// been touched since it opened. Files are reduced to their names because a
// File object doesn't serialise, and swapping one attachment for another is
// a change worth catching.
function formFingerprint(form) {
  const mark = (people) =>
    people.map((p) => ({ ...p, idProofFile: p.idProofFile ? p.idProofFile.name : null }));
  return JSON.stringify({ ...form, adults: mark(form.adults), children: mark(form.children) });
}

function formatSavedAt(value) {
  return new Date(value).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Whether there is anything in this form worth keeping — an untouched form
// saved as a draft is just a banner offering to restore nothing.
function hasFormContent(form) {
  const named = [...form.adults, ...form.children].some((p) => p.name.trim() !== '');
  return Boolean(
    named ||
      form.roomId ||
      form.switchableCharges.length ||
      form.vehicles.some((v) => v.number.trim() !== '') ||
      form.advanceAmount.trim() !== '' ||
      form.discountAmount.trim() !== ''
  );
}

export default function Bookings({ onCheckedOut }) {
  const session = getSession();
  const token = session?.token;

  // The line between what can still be sold and what only be looked at. Read
  // once here so the chart, the tiles and the form all draw it in the same
  // place.
  const today = todayIso();

  // The chart always shows one whole calendar month, the 1st to the last, and
  // opens on the month today falls in. The arrows step a month at a time, so
  // every view of the chart is a page of the same calendar rather than a
  // window that has drifted off it.
  const [month, setMonth] = useState(() => monthStartOf(todayIso()));
  const [tapeData, setTapeData] = useState(null);
  const [tapeError, setTapeError] = useState('');
  // The tile that's under the pointer right now, with the screen position to
  // float its card at. Guest names live only in here — never on the tiles.
  const [hoverTile, setHoverTile] = useState(null);
  // Every parked booking on this property. Sits beside the chart's own state
  // because it is loaded with it and drawn on it.
  const [drafts, setDrafts] = useState(() => readCache('/bookings/drafts') ?? []);
  const [showDrafts, setShowDrafts] = useState(false);

  const dates = useMemo(
    () => Array.from({ length: daysInMonth(month) }, (_, i) => addDays(month, i)),
    [month]
  );

  const rangeStart = month;
  const rangeEnd = useMemo(() => addMonths(month, 1), [month]);

  const tapeKey = `/bookings/tape-chart?startDate=${rangeStart}&endDate=${rangeEnd}`;

  const loadTapeChart = () => {
    // Paint this window as it looked last time, immediately, then correct it.
    // Keyed on the dates so stepping back to a month already looked at is
    // instant too — and so a month never shows another month's bookings.
    const seen = readCache(tapeKey);
    if (seen) setTapeData(seen);
    apiGet(tapeKey, { token })
      .then((data) => {
        setTapeData(writeCache(tapeKey, data));
        setTapeError('');
      })
      .catch((err) => {
        setTapeError(err instanceof ApiError ? err.message : 'Could not load the tape chart.');
      });
  };

  // The chart carries the drafts that fall in the window on screen; this is
  // the full list, for the chip and the drafts panel — including the ones with
  // no room or dates yet, which can't be drawn anywhere.
  const loadDrafts = () => {
    apiGet('/bookings/drafts', { token })
      .then((data) => setDrafts(writeCache('/bookings/drafts', data.drafts.filter(usableDraft))))
      .catch(() => setDrafts([]));
  };

  useEffect(() => {
    loadTapeChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart, rangeEnd]);

  // Loaded once — every action that changes the list reloads it.
  useEffect(() => {
    loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Changing the month unmounts the tile the pointer is on, and an unmounted
  // tile never fires its mouseleave — so the card is dismissed with the move.
  const goToMonth = (monthStart) => {
    setHoverTile(null);
    setMonth(monthStart);
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
      let to = booking.checkOutDate < rangeEnd ? booking.checkOutDate : rangeEnd;
      // A completed stay holds no night from today on — the room pickers stop
      // counting it the moment the guest checks out. Someone who left early
      // would otherwise leave the nights they didn't use looking sold here
      // while the picker happily sells them.
      if (booking.status === 'CHECKED_OUT' && to > today) to = today;
      for (let d = from; d < to; d = addDays(d, 1)) byDate.set(d, booking);
    }
    return byRoom;
  }, [tapeData, rangeStart, rangeEnd, today]);

  // The same map for drafts, kept separate on purpose. A draft reserves
  // nothing, so it can sit on a night a real booking already holds — merging
  // the two would either hide the booking or make the draft look like one.
  // Where both land on a night, the booking wins the tile and the draft shows
  // as a corner mark on it.
  const draftOccupancy = useMemo(() => {
    const byRoom = new Map();
    for (const draft of tapeData?.drafts ?? []) {
      const key = String(draft.roomId);
      let byDate = byRoom.get(key);
      if (!byDate) {
        byDate = new Map();
        byRoom.set(key, byDate);
      }
      const from = draft.checkInDate > rangeStart ? draft.checkInDate : rangeStart;
      const to = draft.checkOutDate < rangeEnd ? draft.checkOutDate : rangeEnd;
      for (let d = from; d < to; d = addDays(d, 1)) byDate.set(d, draft);
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

  // The booking form. One form, two jobs: taking a stay and correcting one.
  // 'EDIT' is the same modal with the answers already filled in, which is why
  // there is one piece of state here and not two — a second copy is where a
  // field ends up on the new form and not on the edit.
  //
  // null closes it. `editTarget` is the booking being corrected, held apart
  // from the form because it carries the facts an edit can't change (when the
  // stay started, what it was booked at) and the ones it reads back from the
  // server after saving.
  const [formMode, setFormMode] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const showBookingForm = formMode !== null;
  const editing = formMode === 'EDIT';

  const [draftNote, setDraftNote] = useState('');
  // The draft this form is working on, if any. Set means Save draft updates
  // that row instead of writing a new one, and the form offers to delete it.
  const [draftId, setDraftId] = useState(null);
  // The form exactly as it was handed over, so closing can tell "typed
  // nothing" from "typed something and is about to lose it". Compared as a
  // string rather than field by field — the form grows fields, and a dirty
  // check that has to be remembered when it does is a dirty check that will
  // one day quietly say clean.
  const [openedAs, setOpenedAs] = useState('');
  // Non-null while the "you have unsaved details" prompt is up.
  const [closePrompt, setClosePrompt] = useState(null);
  // Bumped to re-ask which rooms are free when nothing the room list keys on
  // has changed but the answer might have — see applyDraft.
  const [roomsNonce, setRoomsNonce] = useState(0);
  const [bookingForm, setBookingForm] = useState(initialBookingForm);
  const [availableRooms, setAvailableRooms] = useState(null);
  const [availableRoomsError, setAvailableRoomsError] = useState('');
  // Set when a date change takes the chosen room away — see the availability
  // effect. Extending a stay over a night somebody else holds used to empty the
  // picker with no explanation at all.
  const [roomTakenNote, setRoomTakenNote] = useState('');
  const [quote, setQuote] = useState(null);
  // The banner is for failures with no one field behind them — a rejected save,
  // a dropped connection. Anything a single input caused belongs under that
  // input instead, as { id, message } naming the control to sit beneath.
  //
  // One at a time on purpose: the checks below run in form order and stop at
  // the first failure, so there has only ever been one message to show. What
  // changed is where it appears, not how many there are.
  const [formError, setFormError] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Reports a failure against the control that caused it and takes the cursor
  // there. The form is tall enough that a message about the guest's phone is
  // off-screen when the room dropdown is in view, so it always scrolls.
  const failOn = (id, message) => {
    setFieldError({ id, message });
    const el = document.getElementById(id);
    if (!el) return;

    // Advance payment and vehicles are collapsible and usually shut. Scrolling
    // to a field inside a closed <details> would land on the summary with the
    // message nowhere in sight, so open whatever it is folded inside first.
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (node.tagName === 'DETAILS') node.open = true;
    }

    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  // Rendered under whichever field the current message belongs to. The id guard
  // matters: an undefined id would otherwise match `fieldError?.id` on a form
  // with no error at all, and try to read a message off null.
  const fieldErr = (id) =>
    id && fieldError?.id === id ? <p className="field__error">{fieldError.message}</p> : null;
  const invalid = (id) => Boolean(id) && fieldError?.id === id;

  // Every route into the form goes through here, so there is one place that
  // remembers what it was handed and one definition of "unchanged".
  const beginForm = (mode, form) => {
    setBookingForm(form);
    setOpenedAs(formFingerprint(form));
    setClosePrompt(null);
    setFormError('');
    setFieldError(null);
    setAvailableRooms(null);
    setAvailableRoomsError('');
    setRoomTakenNote('');
    setQuote(null);
    setFormMode(mode);
  };

  const openNewBooking = (presetRoomId, presetDate) => {
    const checkInDate = presetDate || todayIso();
    setEditTarget(null);
    setDraftId(null);
    setDraftNote('');
    beginForm('CREATE', {
      ...initialBookingForm,
      checkInDate,
      checkOutDate: addDays(checkInDate, 1),
      roomId: presetRoomId ? String(presetRoomId) : '',
      // Walk-in means "the guest is here now" — not a valid concept for a
      // future date, so a tape-chart click on a later day starts the form
      // as a pre-reservation instead of silently offering an option that
      // would fail at check-in time.
      bookingType: checkInDate > todayIso() ? 'RESERVATION' : 'WALK_IN',
    });
  };

  // Anything typed in since the form opened. A booking is filled in at a
  // counter with a guest waiting, and the cost of asking once is a click —
  // the cost of not asking is the whole form.
  const formTouched = showBookingForm && formFingerprint(bookingForm) !== openedAs;

  // The × and Close both come here. It closes outright when there is nothing
  // to lose, and asks first when there is.
  const requestCloseBookingForm = () => {
    if (submitting) return;
    if (!formTouched) {
      closeBookingForm();
      return;
    }
    // A new booking can be parked and finished later; changes to one that
    // already exists have nowhere to go but back into it, so the two are
    // asked different questions.
    setClosePrompt(editing ? 'EDIT' : 'CREATE');
  };

  const closeBookingForm = () => {
    // Backing out of an edit returns to the booking it came from, not to the
    // tape chart — leaving the desk where it was standing. Re-opening by id
    // refetches, so an abandoned edit can't leave stale figures on screen.
    if (editTarget) setSelectedBookingId(editTarget.id);
    setClosePrompt(null);
    setFormMode(null);
    setEditTarget(null);
    setDraftId(null);
    setDraftNote('');
  };

  // Parks what's on screen and closes. Only offered on a new booking: an edit
  // already has somewhere to keep its answers — the booking itself.
  //
  // Re-saving a draft that was opened from the list updates that row rather
  // than laying down a second copy of the same half-finished booking.
  const saveDraft = async () => {
    if (submitting) return;
    if (!hasFormContent(bookingForm)) {
      setFormError('There is nothing to save yet — fill in a detail or two first.');
      return;
    }
    setSubmitting(true);
    try {
      const body = { form: draftableForm(bookingForm) };
      if (draftId) await apiPut(`/bookings/drafts/${draftId}`, body, { token });
      else await apiPost('/bookings/drafts', body, { token });
      setClosePrompt(null);
      setFormMode(null);
      setDraftId(null);
      setDraftNote('');
      loadDrafts();
      loadTapeChart();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this draft.');
    } finally {
      setSubmitting(false);
    }
  };

  // Puts a parked draft into the form. A draft can be days old and the room it
  // names may have been sold since; the room list only reloads when the dates
  // change, and a draft opened onto matching dates wouldn't trip that — so it
  // is asked again explicitly, which drops the room if it has gone.
  //
  // The row stays put until the booking is made or the draft is deleted, so
  // closing the form without saving doesn't lose it.
  const openDraft = (parked) => {
    setDraftId(parked.id);
    setEditTarget(null);
    setRoomsNonce((n) => n + 1);
    setShowDrafts(false);
    beginForm('CREATE', parked.form);
    setDraftNote(
      parked.form.droppedFiles > 0
        ? `${parked.form.droppedFiles} ID proof document${
            parked.form.droppedFiles === 1 ? '' : 's'
          } couldn’t be kept in a draft — attach ${
            parked.form.droppedFiles === 1 ? 'it' : 'them'
          } again before booking.`
        : ''
    );
  };

  const openDraftById = (id) => {
    const parked = drafts.find((d) => String(d.id) === String(id));
    if (parked) openDraft(parked);
  };

  // Deleting a draft throws away nothing that was ever agreed with a guest,
  // so it goes without a confirmation step — unlike cancelling a booking.
  const deleteDraft = async (id, { closeForm = false } = {}) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await apiDelete(`/bookings/drafts/${id}`, { token });
      if (closeForm) {
        setFormMode(null);
        setDraftId(null);
        setDraftNote('');
      }
      loadDrafts();
      loadTapeChart();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not delete this draft.');
    } finally {
      setSubmitting(false);
    }
  };

  const validRange =
    bookingForm.checkInDate && bookingForm.checkOutDate && bookingForm.checkOutDate > bookingForm.checkInDate;
  const isFutureCheckIn = bookingForm.checkInDate > today;
  // A night that has already gone can't be sold. Only ever asked of a new
  // booking — an existing stay keeps the check-in date it started on, and a
  // guest who checked out last week must stay editable.
  const isPastCheckIn = !editing && bookingForm.checkInDate < today;
  // A pre-reservation can be held without ID proof; a walk-in is standing at
  // the desk, so theirs is captured on the spot. An edit never demands one:
  // whatever the stay already has stays on file unless a new file replaces it.
  const idProofOptional = editing || bookingForm.bookingType === 'RESERVATION';
  // Once a guest has checked out there is no stay left to move or extend, so
  // the room and the dates are fixed — matching the backend's own guard.
  const canEditStay = !editing || editTarget?.status === 'BOOKED' || editTarget?.status === 'CHECKED_IN';

  // Which rooms are free. Two endpoints for the same question: an edit has to
  // ask the one that excludes the booking's own occupancy, or the room the
  // guest is already in would look taken and drop off its own picker.
  useEffect(() => {
    if (!showBookingForm || !validRange) return;
    // Read before the request: these are the room as it stood when the dates
    // changed, which is the one about to be lost if the new range clashes.
    // Its number comes from the previous list, since it won't be in the new one.
    const chosenRoomId = bookingForm.roomId;
    const chosenRoomNumber = availableRooms?.find((r) => String(r.id) === chosenRoomId)?.roomNumber;

    const path = editing
      ? `/bookings/${editTarget.id}/available-rooms?checkOutDate=${bookingForm.checkOutDate}`
      : `/bookings/available-rooms?checkInDate=${bookingForm.checkInDate}&checkOutDate=${bookingForm.checkOutDate}`;
    apiGet(path, { token })
      .then((data) => {
        setAvailableRooms(data.rooms);
        setAvailableRoomsError('');

        const stillFree = chosenRoomId && data.rooms.some((r) => String(r.id) === chosenRoomId);
        if (chosenRoomId && !stillFree) {
          // Which stays are in the way, so the message can name the nights
          // rather than just refusing.
          const clashes = (data.conflicts ?? []).filter((c) => String(c.roomId) === chosenRoomId);
          setRoomTakenNote(
            roomUnavailableMessage(chosenRoomNumber, clashes, bookingForm.checkOutDate)
          );
        } else {
          setRoomTakenNote('');
        }

        setBookingForm((f) =>
          f.roomId && data.rooms.some((r) => String(r.id) === f.roomId)
            ? f
            : { ...f, roomId: '', switchableCharges: [], discountAmount: '' }
        );
      })
      .catch((err) => {
        setAvailableRooms([]);
        setRoomTakenNote('');
        setAvailableRoomsError(err instanceof ApiError ? err.message : 'Could not load available rooms.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBookingForm, bookingForm.checkInDate, bookingForm.checkOutDate, roomsNonce]);

  useEffect(() => {
    if (!showBookingForm || !validRange || !bookingForm.roomId) {
      setQuote(null);
      return;
    }
    const chargeIds = chargesParam(bookingForm.switchableCharges);
    const discount = discountParam(bookingForm.discountAmount);
    // Typing a concession fires a quote per keystroke, so a slower earlier
    // reply must not land on top of a newer one and show a total for an
    // amount that is no longer in the box.
    let current = true;
    apiGet(
      `/bookings/price-quote?roomId=${bookingForm.roomId}&checkInDate=${bookingForm.checkInDate}&checkOutDate=${bookingForm.checkOutDate}${chargeIds ? `&chargeIds=${chargeIds}` : ''}${legacyRateParam(editTarget)}${discount}`,
      { token }
    )
      .then((data) => current && setQuote(data))
      .catch(() => current && setQuote(null));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showBookingForm,
    bookingForm.roomId,
    bookingForm.checkInDate,
    bookingForm.checkOutDate,
    bookingForm.switchableCharges,
    bookingForm.discountAmount,
  ]);

  const selectedRoom = availableRooms?.find((r) => String(r.id) === bookingForm.roomId);
  const numGuests = bookingForm.adults.length + bookingForm.children.length;
  const overOccupancy = Boolean(selectedRoom?.maxOccupancy && numGuests > selectedRoom.maxOccupancy);

  const toggleCharge = (chargeId) => {
    setBookingForm((f) => ({ ...f, switchableCharges: toggleSelection(f.switchableCharges, chargeId) }));
  };

  const setChargeQuantity = (chargeId, quantity) => {
    setBookingForm((f) => ({ ...f, switchableCharges: withQuantity(f.switchableCharges, chargeId, quantity) }));
  };

  // Adults and children are both plain repeating rows; the only asymmetries
  // are the phone column (adults only) and the fact that adults[0] is the
  // primary guest, so it can't be removed.
  const addParty = (key, blank) => {
    setBookingForm((f) => ({ ...f, [key]: [...f[key], { ...blank }] }));
  };

  const removeParty = (key, index) => {
    setBookingForm((f) => ({ ...f, [key]: f[key].filter((_, i) => i !== index) }));
  };

  const updateParty = (key, index, patch) => {
    setBookingForm((f) => ({
      ...f,
      [key]: f[key].map((g, i) => (i === index ? { ...g, ...patch } : g)),
    }));
  };

  const addVehicle = () => {
    setBookingForm((f) => ({ ...f, vehicles: [...f.vehicles, { ...emptyVehicle }] }));
  };

  const removeVehicle = (index) => {
    setBookingForm((f) => ({ ...f, vehicles: f.vehicles.filter((_, i) => i !== index) }));
  };

  const updateVehicle = (index, patch) => {
    setBookingForm((f) => ({
      ...f,
      vehicles: f.vehicles.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    }));
  };

  // One handler, because it is one form. Everything below the endpoint is
  // identical: the same rows can be wrong in the same ways whether the stay is
  // being taken or corrected.
  const handleSubmitBooking = async (e) => {
    e.preventDefault();
    setFormError('');
    setFieldError(null);

    if (!validRange) {
      failOn('checkOutDate', 'Check-out date must be after check-in date.');
      return;
    }
    // The chart won't offer a past night and the date field won't accept one,
    // but a typed date reaches neither guard — and a booking backdated past
    // check-in would be a stay nobody can ever check in to.
    if (isPastCheckIn) {
      failOn('checkInDate', 'Check-in can’t be a past date — a night that has gone can’t be booked.');
      return;
    }
    // Belt-and-braces: the UI already hides Walk-in for a future date, but
    // a walk-in for a date that hasn't arrived would try to check itself in
    // immediately after creating the booking — and the backend's check-in
    // guard would reject that, leaving the booking created but the form
    // showing an error, as if it had failed outright.
    if (!editing && bookingForm.bookingType === 'WALK_IN' && isFutureCheckIn) {
      failOn(
        'bookingTypeToggle',
        'Walk-in isn’t available for a future check-in date — switch to pre-reservation.'
      );
      return;
    }
    if (!bookingForm.roomId) {
      failOn('roomId', 'Choose a room.');
      return;
    }
    if (bookingForm.discountAmount !== '' && !(Number(bookingForm.discountAmount) >= 0)) {
      failOn('discountAmount', 'Enter a concession of 0 or more, or leave it blank for no concession.');
      return;
    }
    if (quote && Number(bookingForm.discountAmount || 0) > quote.grossTotal) {
      failOn(
        'discountAmount',
        `The concession can’t be more than the stay total of ${formatPrice(quote.grossTotal)}.`
      );
      return;
    }
    // adults[0] is the primary guest — the only one whose phone is required.
    const primary = bookingForm.adults[0];
    if (!primary.name.trim()) {
      failOn('newAdultName-0', 'Enter the guest name.');
      return;
    }
    if (!primary.phone.trim()) {
      failOn('newAdultPhone-0', 'Enter the guest phone number.');
      return;
    }
    // A walk-in guest is here now, so their ID proof is captured immediately;
    // a pre-reservation defers it to whenever they actually check in. An edit
    // asks for neither — the stay already has whatever it has.
    if (!editing && bookingForm.bookingType === 'WALK_IN') {
      if (!primary.idProofType) {
        failOn('newAdultIdProofType-0', 'Choose the ID proof type.');
        return;
      }
      // A returning guest whose card is already on file has satisfied this —
      // the server copies that document onto this booking. Asking for it again
      // is asking for something the property already has.
      if (!primary.idProofFile && !primary.fromBookingId) {
        failOn('newAdultIdProofFile-0', 'Upload the guest’s ID proof (image or PDF).');
        return;
      }
    }
    const hasAdvanceAmount = bookingForm.advanceAmount.trim() !== '';
    if (hasAdvanceAmount && !bookingForm.advancePaymentMethod) {
      failOn('newBookingAdvancePaymentMethod', 'Choose a payment method for the advance amount.');
      return;
    }
    if (
      hasAdvanceAmount &&
      needsPaymentReference(bookingForm.advancePaymentMethod) &&
      bookingForm.advanceReference.trim() === ''
    ) {
      failOn(
        'newBookingAdvanceReference',
        'Enter the transaction number for the advance paid by UPI or card.'
      );
      return;
    }
    // Which row, not just that one of them is empty — with six adults on a
    // booking, "enter a name for each adult" doesn't say which one is blank.
    const blankAdult = bookingForm.adults.findIndex((g, i) => i > 0 && !g.name.trim());
    if (blankAdult !== -1) {
      failOn(`newAdultName-${blankAdult}`, 'Enter a name for this adult, or remove the row.');
      return;
    }
    const blankChild = bookingForm.children.findIndex((g) => !g.name.trim());
    if (blankChild !== -1) {
      failOn(`newChildName-${blankChild}`, 'Enter a name for this child, or remove the row.');
      return;
    }
    const oversizedAdult = bookingForm.adults.findIndex(
      (g) => g.idProofFile && g.idProofFile.size > ID_PROOF_MAX_BYTES
    );
    if (oversizedAdult !== -1) {
      failOn(`newAdultIdProofFile-${oversizedAdult}`, 'This ID proof must be 5MB or smaller.');
      return;
    }
    const oversizedChild = bookingForm.children.findIndex(
      (g) => g.idProofFile && g.idProofFile.size > ID_PROOF_MAX_BYTES
    );
    if (oversizedChild !== -1) {
      failOn(`newChildIdProofFile-${oversizedChild}`, 'This ID proof must be 5MB or smaller.');
      return;
    }
    // Checked against the rows as typed rather than the cleaned list, so the
    // index the message lands on is the row the owner is looking at — cleaning
    // drops the entirely blank rows and renumbers everything after them.
    const badVehicle = bookingForm.vehicles.findIndex(
      (v) => (v.number.trim() || v.type) && vehicleRowError([{ number: v.number.trim(), type: v.type }])
    );
    if (badVehicle !== -1) {
      const row = bookingForm.vehicles[badVehicle];
      failOn(
        row.number.trim() ? `newVehicleType-${badVehicle}` : `newVehicleNumber-${badVehicle}`,
        vehicleRowError([{ number: row.number.trim(), type: row.type }])
      );
      return;
    }
    const vehicles = cleanVehicles(bookingForm.vehicles);

    setSubmitting(true);
    try {
      // Everyone after the primary guest travels in the `guests` array, adults
      // first, each tagged so the split survives into the booking record.
      const otherGuests = [
        ...bookingForm.adults.slice(1).map((g) => ({ ...g, isChild: false })),
        ...bookingForm.children.map((g) => ({ ...g, phone: '', isChild: true })),
      ];

      const formData = new FormData();
      formData.append('guestName', primary.name.trim());
      formData.append('guestPhone', primary.phone.trim());
      formData.append('numGuests', String(numGuests));
      formData.append('switchableCharges', JSON.stringify(chargesPayload(bookingForm.switchableCharges)));
      if (primary.idProofType) formData.append('idProofType', primary.idProofType);
      if (primary.idProofFile) formData.append('idProofDocument', primary.idProofFile);
      // A returning guest picked off the suggestions, with no new file attached:
      // the server copies their document across from the stay named here. Only
      // on create — an edit's primary guest is whoever the stay already belongs
      // to, and their document is already on it.
      if (!editing && !primary.idProofFile && primary.fromBookingId) {
        formData.append('idProofFromBookingId', String(primary.fromBookingId));
      }
      formData.append('vehicles', JSON.stringify(vehicles));
      formData.append(
        'guests',
        JSON.stringify(
          otherGuests.map((g) => ({
            // Only an existing row has one. It is what keeps an edit an edit:
            // the row is updated rather than replaced, so the ID proof already
            // uploaded against it survives.
            ...(g.id != null ? { id: g.id } : {}),
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

      if (editing) {
        // Blank means "clear it" on the update path, where every field has a
        // current value to be taken back from — unlike create, where leaving a
        // field out is simply not setting it.
        formData.append(
          'discountAmount',
          bookingForm.discountAmount === '' ? '0' : String(Number(bookingForm.discountAmount))
        );
        formData.append('advanceAmount', hasAdvanceAmount ? String(Number(bookingForm.advanceAmount)) : '');
        formData.append('advancePaymentMethod', hasAdvanceAmount ? bookingForm.advancePaymentMethod : '');
        formData.append(
          'advanceReference',
          hasAdvanceAmount ? advanceReferenceOf(bookingForm) : ''
        );
        // Omitted once the guest has checked out: there is no stay left to
        // move or extend, and the backend refuses both.
        if (canEditStay) {
          formData.append('roomId', String(Number(bookingForm.roomId)));
          formData.append('checkOutDate', bookingForm.checkOutDate);
        }

        const { booking } = await apiPatchForm(`/bookings/${editTarget.id}`, formData, { token });
        // Straight back to the stay that was being corrected, showing what the
        // save actually produced rather than what was typed — the server
        // re-prices the stay, so the total here is the server's, not a guess.
        setBookingDetail(booking);
        setSelectedBookingId(editTarget.id);
      } else {
        formData.append('roomId', String(Number(bookingForm.roomId)));
        formData.append('checkInDate', bookingForm.checkInDate);
        formData.append('checkOutDate', bookingForm.checkOutDate);
        if (bookingForm.discountAmount !== '') {
          formData.append('discountAmount', String(Number(bookingForm.discountAmount)));
        }
        if (hasAdvanceAmount) {
          formData.append('advanceAmount', String(Number(bookingForm.advanceAmount)));
          formData.append('advancePaymentMethod', bookingForm.advancePaymentMethod);
          const reference = advanceReferenceOf(bookingForm);
          if (reference) formData.append('advanceReference', reference);
        }

        const created = await apiPostForm('/bookings', formData, { token });
        if (bookingForm.bookingType === 'WALK_IN') {
          await apiPatch(`/bookings/${created.id}/check-in`, {}, { token });
        }
        // The draft was a stand-in for this booking; it exists now, so the
        // stand-in goes — otherwise the chart would carry both, and the desk
        // would be looking at a pending booking that has already been taken.
        if (draftId) {
          await apiDelete(`/bookings/drafts/${draftId}`, { token }).catch(() => {});
          loadDrafts();
        }
      }

      setFormMode(null);
      setEditTarget(null);
      setDraftId(null);
      setDraftNote('');
      loadTapeChart();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : editing
            ? 'Could not save these changes.'
            : 'Could not create the booking.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Booking detail modal
  const [selectedBookingId, setSelectedBookingId] = useState(null);
  const [bookingDetail, setBookingDetail] = useState(null);
  // The advance-receipt modal, and every receipt already written against the
  // open booking. The list is loaded with the booking rather than when the
  // modal opens, because the detail screen shows a count on the button — the
  // desk needs to know a receipt exists before deciding to issue one.
  const [showAdvanceReceipt, setShowAdvanceReceipt] = useState(false);
  const [advanceReceipts, setAdvanceReceipts] = useState([]);
  const [detailError, setDetailError] = useState('');
  const [showCheckInForm, setShowCheckInForm] = useState(false);
  const initialCheckInForm = {
    advanceAmount: '',
    advancePaymentMethod: '',
    advanceReference: '',
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

  const canEditBooking = Boolean(
    bookingDetail && bookingDetail.status !== 'CANCELLED' && !bookingDetail.hasIssuedInvoice
  );

  // A pre-reservation holds the room for a future date — check-in only
  // opens once that date arrives, matching the backend's own guard.
  const canCheckInNow = Boolean(bookingDetail && bookingDetail.checkInDate <= todayIso());

  // A guest on file, in the shape the party editor works in. `id` is what
  // makes an edit an edit rather than a delete and re-insert — the row keeps
  // the ID proof already uploaded against it. `hasDocument` is only ever a
  // marker: the file itself never comes back down, only the fact of it.
  const partyRowOf = (guest) => ({
    id: guest.id,
    name: guest.name,
    phone: guest.phone ?? '',
    idProofType: guest.idProofType ?? '',
    idProofFile: null,
    hasDocument: guest.hasIdProofDocument,
  });

  // Opens the booking form with this stay's answers already in it. Same modal,
  // same state, same fields — an edit is a booking whose questions have been
  // answered once already.
  const openEditBooking = () => {
    const seeded = {
      ...initialBookingForm,
      // A stay that exists was either walked in or reserved and then arrived;
      // either way the distinction is spent. The toggle is hidden in edit mode.
      bookingType: 'RESERVATION',
      checkInDate: bookingDetail.checkInDate,
      checkOutDate: bookingDetail.checkOutDate,
      roomId: String(bookingDetail.roomId),
      switchableCharges: bookingDetail.switchableCharges.map((c) => ({ id: c.id, quantity: String(c.quantity ?? 1) })),
      // Blank here means nothing was ever knocked off this stay, and clearing
      // the box is how a concession gets taken back.
      discountAmount: bookingDetail.discountAmount ? String(bookingDetail.discountAmount) : '',
      // adults[0] is the primary guest, who lives on the booking itself rather
      // than in the guests table — so no id, and saving them writes back to
      // guestName/guestPhone/idProofType. Everyone else is a row.
      adults: [
        {
          id: undefined,
          name: bookingDetail.guestName,
          phone: bookingDetail.guestPhone,
          idProofType: bookingDetail.idProofType ?? '',
          idProofFile: null,
          hasDocument: bookingDetail.hasIdProofDocument,
        },
        ...bookingDetail.guests.filter((g) => !g.isChild).map(partyRowOf),
      ],
      children: bookingDetail.guests.filter((g) => g.isChild).map(partyRowOf),
      vehicles: bookingDetail.vehicles.map((v) => ({ number: v.number, type: v.type ?? '' })),
      advanceAmount: bookingDetail.advanceAmount != null ? String(bookingDetail.advanceAmount) : '',
      advancePaymentMethod: bookingDetail.advancePaymentMethod ?? '',
      advanceReference: bookingDetail.advanceReference ?? '',
    };
    setEditTarget(bookingDetail);
    setDraftId(null);
    setDraftNote('');
    setShowCheckInForm(false);
    beginForm('EDIT', seeded);
    // The detail modal steps aside rather than stacking behind. Both modals
    // share a z-index and the detail one renders later in the tree, so it
    // paints over the form — and two backdrops deep is a dead end anyway.
    // editTarget is what brings the reader back here on cancel or save.
    setSelectedBookingId(null);
  };


  const openDetail = (bookingId) => {
    setSelectedBookingId(bookingId);
    setBookingDetail(null);
    setDetailError('');
    setShowCheckInForm(false);
    setCheckInForm(initialCheckInForm);
    setActionError('');
    setIdProofError('');
    setShowAdvanceReceipt(false);
    setAdvanceReceipts([]);
  };

  // Who is actually standing at the desk: the primary guest, whoever was named
  // when the room was booked, and whoever is being added now. A reservation for
  // two turning up as three is an ordinary evening, so check-in counts the
  // party rather than holding it to the number booked — the server raises
  // num_guests to match on save.
  const checkInPartySize = bookingDetail
    ? 1 + bookingDetail.guests.length + checkInForm.guests.length
    : 0;
  // Worth saying out loud, because it is the desk's decision and nobody else's:
  // the room sleeps four and five people have arrived.
  const overRoomOccupancy = Boolean(
    bookingDetail?.roomMaxOccupancy && checkInPartySize > bookingDetail.roomMaxOccupancy
  );

  // A walk-in booking already has its ID proof on file; a pre-reservation
  // doesn't, so check-in is where it becomes required.
  const needsIdProofAtCheckIn = Boolean(bookingDetail && !bookingDetail.idProofType);

  const addCheckInGuest = () => {
    setCheckInForm((f) => ({ ...f, guests: [...f.guests, { ...emptyCheckInGuest }] }));
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
    // Receipts are a side note on the stay, so a failure here is swallowed: it
    // must not replace the booking on screen with an error banner. The worst
    // case is a button that doesn't show a count.
    apiGet(`/billing/bookings/${selectedBookingId}/advance-receipts`, { token })
      .then((data) => setAdvanceReceipts(data.receipts))
      .catch(() => setAdvanceReceipts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBookingId]);

  // After a receipt is issued the booking holds more advance than the copy on
  // screen says, and the chart behind it is showing the old figure too.
  const handleReceiptIssued = (receipt) => {
    setAdvanceReceipts((list) => [receipt, ...list]);
    apiGet(`/bookings/${selectedBookingId}`, { token })
      .then((data) => setBookingDetail(data.booking))
      .catch(() => {});
    loadTapeChart();
  };

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
    if (
      hasAmount &&
      needsPaymentReference(checkInForm.advancePaymentMethod) &&
      checkInForm.advanceReference.trim() === ''
    ) {
      setActionError('Enter the transaction number for the advance paid by UPI or card.');
      return;
    }
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
        const reference = advanceReferenceOf(checkInForm);
        if (reference) formData.append('advanceReference', reference);
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
            isChild: g.isChild,
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
      const billed = selectedBookingId;
      await apiPatch(`/bookings/${selectedBookingId}/check-out`, { lateCharge }, { token });
      setLateCheckout(null);
      setSelectedBookingId(null);
      loadTapeChart();
      // Hand the stay straight to billing: a guest standing at the desk is
      // about to be billed, so reception should not have to find them again
      // in the queue they were just added to.
      onCheckedOut?.(billed);
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

  const viewLabel = formatViewLabel(month);

  // Each category prints the same month, so the header of dates is built once
  // here and repeated at the top of every category's own calendar. The hovered
  // date lights up in every one of them, which is what makes it possible to
  // read the same night across categories without counting columns.
  const renderDateHead = () => (
    <>
      {/* The month these columns are the days of. Named on every category's own
          calendar, so a card scrolled to halfway down the page still says which
          month its day numbers belong to without a look back at the stepper. */}
      <div className="tape-month__band">
        <div className="tape-month__band-corner" />
        <div className="tape-month__band-month" style={{ gridColumn: `span ${dates.length}` }}>
          <span>{formatMonthBand(month)}</span>
        </div>
      </div>
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
    </>
  );

  const renderRoomRow = (room) => {
    const byDate = occupancy.get(String(room.id));
    const draftsByDate = draftOccupancy.get(String(room.id));
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
          const draft = draftsByDate?.get(d);
          const past = d < today;

          // A night nobody has booked, but somebody has a draft on. Yellow,
          // and it opens that draft rather than starting a new booking — the
          // room is still sellable, but whoever parked it should be finished
          // or thrown away before the night is sold from under them.
          if (!booking && draft) {
            const classes = ['tape-tile', 'tape-tile--draft'];
            if (d === draft.checkInDate) classes.push('tape-tile--start');
            if (d === addDays(draft.checkOutDate, -1)) classes.push('tape-tile--end');
            if (d === today) classes.push('tape-tile--today');
            if (hoverTile?.draft?.id === draft.id) classes.push('tape-tile--active');
            return (
              <button
                key={d}
                type="button"
                className={classes.join(' ')}
                onClick={() => openDraftById(draft.id)}
                onMouseEnter={(e) => showTileHover(e, { room, date: d, booking: null, draft })}
                onFocus={(e) => showTileHover(e, { room, date: d, booking: null, draft })}
                onMouseLeave={() => setHoverTile(null)}
                onBlur={() => setHoverTile(null)}
                aria-label={`${room.roomNumber} has a draft booking on ${formatDateLong(d)}`}
              />
            );
          }

          // A night that has already gone. Nothing can be sold into it, so it
          // isn't a button at all — a room that stood empty last Tuesday is a
          // fact, not an offer. It still answers on hover, which is the whole
          // reason to keep looking at a month that has happened.
          if (!booking && past) {
            const classes = ['tape-tile', 'tape-tile--vacant', 'tape-tile--past'];
            if (isWeekend(d)) classes.push('tape-tile--weekend');
            return (
              <div
                key={d}
                className={classes.join(' ')}
                role="img"
                aria-label={`${room.roomNumber} was empty on ${formatDateLong(d)}`}
                onMouseEnter={(e) => showTileHover(e, { room, date: d, booking: null, past: true })}
                onMouseLeave={() => setHoverTile(null)}
              />
            );
          }

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
          classes.push(TILE_CLASS[booking.status] || 'tape-tile--booked');
          if (d === booking.checkInDate) classes.push('tape-tile--start');
          // A stay that ended early stops where it stopped: the strip is capped
          // on its last occupied night, not on the checkout date it was sold
          // for, so it doesn't trail off into nights that are back on sale.
          const lastNight =
            booking.status === 'CHECKED_OUT' && booking.checkOutDate > today
              ? addDays(today, -1)
              : addDays(booking.checkOutDate, -1);
          if (d === lastNight) classes.push('tape-tile--end');
          if (d === today) classes.push('tape-tile--today');
          // Pointing at any night of a stay lifts the whole stay, so its real
          // extent is obvious even where it runs off the edge of the month.
          if (hoverTile?.booking?.id === booking.id) classes.push('tape-tile--active');
          // A draft sitting on a night that is already let. The booking keeps
          // the tile — it is the real thing — and the draft shows as a corner
          // flag, which is the desk's cue that somebody is drafting against a
          // room they can't have.
          if (draft) classes.push('tape-tile--has-draft');
          return (
            <button
              key={d}
              type="button"
              className={classes.join(' ')}
              onClick={() => openDetail(booking.id)}
              onMouseEnter={(e) => showTileHover(e, { room, date: d, booking, draft, past })}
              onFocus={(e) => showTileHover(e, { room, date: d, booking, draft, past })}
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
              onClick={() => goToMonth(addMonths(month, -1))}
            >
              ‹
            </button>
            <span className="tape-nav__label">
              <strong>{viewLabel.primary}</strong>
              <span>{viewLabel.secondary}</span>
            </span>
            <button
              type="button"
              className="tape-nav__arrow"
              aria-label="Next month"
              onClick={() => goToMonth(addMonths(month, 1))}
            >
              ›
            </button>
          </div>
        </div>
        <div className="bookings-panel__toolbar-actions">
          {/* Drafts that name a room and dates are on the chart already; this
              is how the rest are reached, and how a desk sees at a glance that
              anything is pending at all. */}
          {drafts.length > 0 && (
            <button type="button" className="bookings-panel__draft-chip" onClick={() => setShowDrafts(true)}>
              <span className="bookings-panel__draft-chip-dot" />
              {drafts.length} draft{drafts.length === 1 ? '' : 's'}
            </button>
          )}
          <button type="button" className="btn-accent" onClick={() => openNewBooking()}>
            + New booking
          </button>
        </div>
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
        <span className="tape-legend__item">
          <i className="tape-legend__swatch tape-legend__swatch--checked-out" />Stayed
        </span>
        <span className="tape-legend__item">
          <i className="tape-legend__swatch tape-legend__swatch--draft" />Draft
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
                    TOOLTIP_DOT[hoverTile.booking.status] || 'booked'
                  }`}
                />
                {TILE_STATUS_LABEL[hoverTile.booking.status] || 'Reserved'}
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
              {/* Said on a past night because the tile is otherwise inert-
                  looking there: this is the one thing on a month that has
                  happened that still opens. */}
              {hoverTile.past && <span className="tape-tooltip__hint">Click to open this stay</span>}
              {/* A draft against a night that is already let — the desk needs
                  telling, because the person who parked it can't have it. */}
              {hoverTile.draft && (
                <span className="tape-tooltip__hint">
                  A draft also names this night{hoverTile.draft.guestName ? ` (${hoverTile.draft.guestName})` : ''}.
                </span>
              )}
            </>
          ) : hoverTile.draft ? (
            <>
              <span className="tape-tooltip__top">
                <span className="tape-tooltip__dot tape-tooltip__dot--draft" />
                Draft
              </span>
              <strong>{hoverTile.draft.guestName || 'Unnamed guest'}</strong>
              <span className="tape-tooltip__meta">
                Room {hoverTile.room.roomNumber} · {hoverTile.room.categoryName}
              </span>
              <span className="tape-tooltip__dates">
                {formatDateLong(hoverTile.draft.checkInDate)}
                <i>→</i>
                {formatDateLong(hoverTile.draft.checkOutDate)}
              </span>
              {/* Said plainly, because a yellow strip across a room looks like
                  a held room and this one isn't. */}
              <span className="tape-tooltip__hint">
                Not booked — this room is still free. Click to finish or delete it.
              </span>
            </>
          ) : (
            <>
              <span className="tape-tooltip__top">
                <span className="tape-tooltip__dot tape-tooltip__dot--vacant" />
                {hoverTile.past ? 'Nobody stayed' : 'Vacant'}
              </span>
              <strong>Room {hoverTile.room.roomNumber}</strong>
              <span className="tape-tooltip__meta">{hoverTile.room.categoryName}</span>
              <span className="tape-tooltip__dates">{formatDateLong(hoverTile.date)}</span>
              <span className="tape-tooltip__hint">
                {hoverTile.past ? 'This night has passed — it can’t be booked' : 'Click to book this night'}
              </span>
            </>
          )}
        </div>
      )}

      {/* Every parked booking, including the ones with no room or dates yet,
          which by definition can't be on the chart. */}
      {showDrafts && (
        <div className="glass-backdrop bookings-panel__backdrop" onClick={() => setShowDrafts(false)}>
          <div className="glass-panel bookings-panel__modal" onClick={(e) => e.stopPropagation()}>
            <div className="bookings-panel__detail-header">
              <h3>Draft bookings</h3>
              <span className="badge badge--off">{drafts.length}</span>
            </div>
            <p className="bookings-panel__hint">
              Started but not booked. A draft holds no room — the nights it names stay on sale until it
              is finished.
            </p>

            {drafts.length === 0 && <div className="dash-state">Nothing parked right now.</div>}

            <div className="detail-people">
              {drafts.map((d) => (
                <div className="detail-person" key={d.id}>
                  <span className="detail-person__name">
                    {d.guestName || 'Unnamed guest'}
                    <span className="detail-person__role">{formatSavedAt(d.updatedAt)}</span>
                  </span>
                  <span className="detail-person__meta">
                    {d.roomNumber
                      ? `Room ${d.roomNumber}${d.categoryName ? ` · ${d.categoryName}` : ''}`
                      : 'No room chosen'}
                    {d.checkInDate && d.checkOutDate
                      ? ` · ${formatDateLong(d.checkInDate)} – ${formatDateLong(d.checkOutDate)}`
                      : ''}
                    {d.createdByName ? ` · by ${d.createdByName}` : ''}
                  </span>
                  <span className="detail-person__meta">
                    <button type="button" className="bookings-panel__link-btn" onClick={() => openDraft(d)}>
                      Open
                    </button>
                    <button
                      type="button"
                      className="bookings-panel__link-btn bookings-panel__link-btn--danger"
                      onClick={() => deleteDraft(d.id)}
                      disabled={submitting}
                    >
                      Delete
                    </button>
                  </span>
                </div>
              ))}
            </div>

            <div className="bookings-panel__actions">
              <button type="button" className="btn-secondary" onClick={() => setShowDrafts(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* No backdrop dismissal here, unlike the read-only modals: this form
          holds a guest's details typed in at a counter, and a stray click on
          the way to the keyboard should not throw them away. It closes on the
          × or the Close button, and nowhere else. */}
      {showBookingForm && (
        <div className="glass-backdrop bookings-panel__backdrop">
          <div className="glass-panel bookings-panel__modal bookings-panel__modal--form">
            <form className="booking-form" onSubmit={handleSubmitBooking} noValidate>
              {/* Header stays put while the body scrolls: the booking type
                  changes what the rest of the form requires, so it shouldn't
                  scroll out of sight. */}
              <div className="booking-form__head">
                <div className="booking-form__head-row">
                  <h3>{editing ? `Edit booking · ${editTarget.roomNumber}` : 'New booking'}</h3>
                  {/* Walk-in against pre-reservation is a question about a
                      stay that hasn't happened yet. On an edit it has, so the
                      toggle would be asking about the past. */}
                  {!editing && (
                    // tabIndex so a walk-in/pre-reservation mismatch has
                    // something to move the cursor to — the choice is a pair of
                    // buttons, and neither one alone is what's wrong.
                    <div className="toggle-group" id="bookingTypeToggle" tabIndex={-1}>
                      {!isFutureCheckIn && (
                        <button
                          type="button"
                          aria-pressed={bookingForm.bookingType === 'WALK_IN'}
                          onClick={() => setBookingForm((f) => ({ ...f, bookingType: 'WALK_IN' }))}
                        >
                          Walk-in
                        </button>
                      )}
                      <button
                        type="button"
                        aria-pressed={bookingForm.bookingType === 'RESERVATION'}
                        onClick={() => setBookingForm((f) => ({ ...f, bookingType: 'RESERVATION' }))}
                      >
                        Pre-reservation
                      </button>
                    </div>
                  )}
                  {editing && (
                    <span
                      className={`badge ${editTarget.status === 'CHECKED_IN' ? 'badge--on' : 'badge--off'}`}
                    >
                      {STATUS_LABEL[editTarget.status]}
                    </span>
                  )}
                  {/* Since the backdrop no longer dismisses, the way out has
                      to be visible without scrolling to the bottom of a form
                      this tall. The one in the footer is the same door. */}
                  <button
                    type="button"
                    className="booking-form__close"
                    onClick={requestCloseBookingForm}
                    disabled={submitting}
                    aria-label="Close"
                    title="Close"
                  >
                    ×
                  </button>
                </div>
                {/* Below the head row, not inside it — that row is a flex line
                    of title, toggle and close button, and a message dropped
                    among them lands beside the ×. */}
                {fieldErr('bookingTypeToggle')}
                <p className="bookings-panel__hint">
                  {editing
                    ? canEditStay
                      ? `${editTarget.guestName}’s stay, as it stands. Editable until the bill is issued — extend it, move rooms, correct the party or fix a detail.`
                      : `${editTarget.guestName}’s stay has already checked out, so the room and dates are fixed. Everything else can still be corrected before billing.`
                    : isFutureCheckIn
                      ? 'Walk-in isn’t available for a future check-in date — this holds the room for a guest arriving later.'
                      : bookingForm.bookingType === 'WALK_IN'
                        ? 'Guest is here now — creates the booking and checks them in immediately.'
                        : 'Holds the room for a guest arriving later. ID proof can be added at check-in.'}
                </p>
              </div>

              <div className="booking-form__body">
                {formError && <div className="form-banner form-banner--error">{formError}</div>}

                {/* Says which draft this is and offers the way out of it —
                    a parked booking that can't be thrown away accumulates. */}
                {draftId && (
                  <div className="form-banner form-banner--info booking-form__draft">
                    <span>You are working on a saved draft.</span>
                    <span className="booking-form__draft-actions">
                      <button
                        type="button"
                        className="bookings-panel__link-btn bookings-panel__link-btn--danger"
                        onClick={() => deleteDraft(draftId, { closeForm: true })}
                        disabled={submitting}
                      >
                        Delete draft
                      </button>
                    </span>
                  </div>
                )}
                {draftNote && <div className="form-banner form-banner--info">{draftNote}</div>}

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
                      value={bookingForm.checkInDate}
                      // Today at the earliest — a night that has passed can't
                      // be sold. Left off an edit, whose field is disabled and
                      // whose date is often legitimately in the past.
                      min={editing ? undefined : today}
                      // Never editable on an existing stay: changing when one
                      // started is a cancel and rebook, not an edit.
                      disabled={editing}
                      aria-invalid={invalid('checkInDate')}
                      onChange={(e) => {
                        const checkInDate = e.target.value;
                        setBookingForm((f) => ({
                          ...f,
                          checkInDate,
                          bookingType: checkInDate > today ? 'RESERVATION' : f.bookingType,
                        }));
                      }}
                    />
                    {/* A past check-in is flagged as it is typed rather than
                        only on submit, so it stays a live warning — it just
                        sits under the date it is about now, instead of in a
                        banner further down the form. */}
                    {fieldErr('checkInDate') ||
                      (isPastCheckIn && (
                        <p className="field__error">
                          Check-in is in the past. A night that has gone can’t be booked — pick
                          today or later.
                        </p>
                      ))}
                  </div>
                  <div className="field">
                    <label htmlFor="checkOutDate">Check-out</label>
                    <input
                      id="checkOutDate"
                      type="date"
                      value={bookingForm.checkOutDate}
                      // A stay is at least one night, whichever way it was
                      // started — the check-in date is the floor for both.
                      min={bookingForm.checkInDate ? addDays(bookingForm.checkInDate, 1) : undefined}
                      disabled={!canEditStay}
                      aria-invalid={invalid('checkOutDate')}
                      onChange={(e) => setBookingForm((f) => ({ ...f, checkOutDate: e.target.value }))}
                    />
                    {fieldErr('checkOutDate')}
                  </div>
                </div>
                {editing && (
                  <p className="bookings-panel__hint">
                    {canEditStay
                      ? 'Check-in is fixed — changing when a stay started is a cancel and rebook, not an edit.'
                      : 'The guest has checked out, so the dates and the room are settled.'}
                  </p>
                )}

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
                        value={bookingForm.roomId}
                        onChange={(e) => {
                          // Picking again answers the notice, so it goes.
                          setRoomTakenNote('');
                          setBookingForm((f) => ({
                            ...f,
                            roomId: e.target.value,
                            switchableCharges: [],
                            // A concession was agreed against a particular
                            // room's total; picking a different one is a fresh
                            // negotiation.
                            discountAmount: '',
                          }));
                        }}
                        disabled={!availableRooms || !canEditStay}
                        aria-invalid={invalid('roomId')}
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
                      {/* The submit-time "Choose a room." comes second: if the
                          room was taken away by a date change, that is the
                          reason the field is empty and the one worth reading. */}
                      {roomTakenNote ? (
                        <p className="field__error">{roomTakenNote}</p>
                      ) : (
                        fieldErr('roomId')
                      )}
                      {availableRooms && availableRooms.length === 0 && (
                        <p className="bookings-panel__hint">No rooms are free for this date range.</p>
                      )}
                    </div>
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
                        const selection = selectionOf(bookingForm.switchableCharges, charge.id);
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

                {/* What the stay costs, before anything is knocked off it.
                    The concession is settled at the end of the form, against
                    this figure. */}
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
                        Stay total · {quote.nights.length} night{quote.nights.length === 1 ? '' : 's'}
                      </span>
                      <span>{formatPrice(quote.grossTotal)}</span>
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
                      {describeParty(bookingForm.adults.length, bookingForm.children.length)}
                    </span>
                  </div>
                  {overOccupancy && (
                    <p className="booking-form__warn">
                      Room {selectedRoom.roomNumber} sleeps {selectedRoom.maxOccupancy}.
                    </p>
                  )}

                  <PartyEditor
                    adults={bookingForm.adults}
                    children={bookingForm.children}
                    idProofOptional={idProofOptional}
                    idPrefix="new"
                    onAdd={addParty}
                    onRemove={removeParty}
                    onUpdate={updateParty}
                    // Looking a guest up is for taking a booking. This same
                    // form edits existing stays, where the primary guest is
                    // settled — swapping them for someone else is a cancel and
                    // rebook, so no suggestions there.
                    guestLookupToken={editing ? null : token}
                    fieldErr={fieldErr}
                  />
                </div>

              {/* The two optional sections share a row — stacked they pushed
                  the guest list off screen. Both start open: the desk fills
                  them in often enough that a shut section was a click of
                  friction on nearly every booking. */}
              <div className="booking-form__optional">
              <details className="form-section form-section--collapsible" open>
                <summary>
                  <span className="form-section__num">3</span>
                  Advance payment
                  {bookingForm.advanceAmount.trim() !== '' && (
                    <span className="form-section__badge">{formatPrice(Number(bookingForm.advanceAmount))}</span>
                  )}
                </summary>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="newBookingAdvanceAmount">Amount</label>
                    <input
                      id="newBookingAdvanceAmount"
                      type="number"
                      min="0"
                      value={bookingForm.advanceAmount}
                      onChange={(e) => setBookingForm((f) => ({ ...f, advanceAmount: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="newBookingAdvancePaymentMethod">Payment type</label>
                    <select
                      id="newBookingAdvancePaymentMethod"
                      value={bookingForm.advancePaymentMethod}
                      onChange={(e) => setBookingForm((f) => ({ ...f, advancePaymentMethod: e.target.value }))}
                      aria-invalid={invalid('newBookingAdvancePaymentMethod')}
                    >
                      <option value="">Choose one</option>
                      <option value="CASH">Cash</option>
                      <option value="UPI">UPI</option>
                      <option value="CARD">Card</option>
                    </select>
                    {fieldErr('newBookingAdvancePaymentMethod')}
                  </div>
                </div>
                {/* Only for money that left a trail. Asking for a reference
                    against cash would be asking for one to be invented. */}
                {needsPaymentReference(bookingForm.advancePaymentMethod) && (
                  <div className="field">
                    <label htmlFor="newBookingAdvanceReference">Transaction number</label>
                    <input
                      id="newBookingAdvanceReference"
                      value={bookingForm.advanceReference}
                      maxLength={64}
                      placeholder={bookingForm.advancePaymentMethod === 'UPI' ? 'UPI reference / UTR' : 'Approval code'}
                      onChange={(e) => setBookingForm((f) => ({ ...f, advanceReference: e.target.value }))}
                      aria-invalid={invalid('newBookingAdvanceReference')}
                    />
                    {fieldErr('newBookingAdvanceReference')}
                    <p className="bookings-panel__hint">
                      What the settlement statement will be matched against at month end.
                    </p>
                  </div>
                )}
              </details>

              <details className="form-section form-section--collapsible" open>
                <summary>
                  <span className="form-section__num">4</span>
                  Vehicles
                  {bookingForm.vehicles.length > 0 && (
                    <span className="form-section__badge">{bookingForm.vehicles.length}</span>
                  )}
                </summary>
                <VehicleEditor
                  vehicles={bookingForm.vehicles}
                  onAdd={addVehicle}
                  onRemove={removeVehicle}
                  onUpdate={updateVehicle}
                  idPrefix="new"
                  fieldErr={fieldErr}
                />
              </details>
              </div>

              {/* Last thing on the form, on purpose. A guest haggles over the
                  finished quote — every extra on it, every night of it — not
                  over the nightly rate it was built from, and not before they
                  know what they are haggling about. One number, once. */}
              <div className="form-section">
                <div className="form-section__title">
                  <span className="form-section__num">5</span>Concession
                </div>
                <div className="field">
                  <label htmlFor="discountAmount">Amount off the total (optional)</label>
                  <input
                    id="discountAmount"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    placeholder="0"
                    value={bookingForm.discountAmount}
                    onChange={(e) => setBookingForm((f) => ({ ...f, discountAmount: e.target.value }))}
                    disabled={!quote}
                    aria-invalid={invalid('discountAmount')}
                  />
                  {fieldErr('discountAmount')}
                  <p className="bookings-panel__hint">
                    {quote
                      ? 'Leave blank to charge the full stay total.'
                      : 'Pick dates and a room first — there is nothing to knock off yet.'}
                  </p>
                </div>

                {/* Both halves beside the box being typed into: the section
                    above scrolls out of reach, and a concession can only be
                    checked against what it came off. */}
                {quote && (
                  <div className="sim-result">
                    <div className="sim-result__line">
                      <span>
                        Stay total · {quote.nights.length} night{quote.nights.length === 1 ? '' : 's'}
                      </span>
                      <span>{formatPrice(quote.grossTotal)}</span>
                    </div>
                    {quote.discountAmount > 0 && (
                      <div className="sim-result__line">
                        <span>Concession</span>
                        <span>-{formatPrice(quote.discountAmount)}</span>
                      </div>
                    )}
                    <div className="sim-result__total">
                      <span>Payable</span>
                      <span>{formatPrice(quote.totalPrice)}</span>
                    </div>
                  </div>
                )}
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
                  <button type="button" className="btn-secondary" onClick={requestCloseBookingForm} disabled={submitting}>
                    Close
                  </button>
                  {/* New bookings only. An edit already has somewhere to keep
                      its answers — the booking it is editing. */}
                  {!editing && (
                    <button type="button" className="btn-secondary" onClick={saveDraft} disabled={submitting}>
                      {draftId ? 'Update draft' : 'Save draft'}
                    </button>
                  )}
                  <button className="btn-accent" type="submit" disabled={submitting}>
                    {editing
                      ? submitting
                        ? 'Saving…'
                        : 'Save changes'
                      : submitting
                        ? 'Booking…'
                        : bookingForm.bookingType === 'WALK_IN'
                          ? 'Add and check in'
                          : 'Create reservation'}
                  </button>
                </div>
              </div>
            </form>

            {/* Sits inside the form modal so the details behind it stay
                visible — the question is "are you sure about losing this",
                and it should be answerable with this still on screen. */}
            {closePrompt && (
              <div className="booking-form__confirm">
                <div className="booking-form__confirm-card">
                  <h4>{closePrompt === 'EDIT' ? 'Discard unsaved changes?' : 'Close without booking?'}</h4>
                  <p>
                    {closePrompt === 'EDIT'
                      ? `Changes to ${editTarget?.guestName ?? 'this booking'} haven’t been saved. Closing now will leave the booking as it was.`
                      : hasFormContent(bookingForm)
                        ? 'This booking hasn’t been created yet. Save it as a draft to pick up later, or close and discard what has been entered.'
                        : 'Nothing has been entered yet that is worth keeping. Closing now will clear the form.'}
                  </p>
                  <div className="booking-form__confirm-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setClosePrompt(null)}
                      disabled={submitting}
                    >
                      Continue editing
                    </button>
                    {/* Only where there is somewhere for the details to go.
                        An edit belongs to a booking that already exists, and
                        a barely-started form has nothing worth parking. */}
                    {closePrompt === 'CREATE' && hasFormContent(bookingForm) && (
                      <button type="button" className="btn-accent" onClick={saveDraft} disabled={submitting}>
                        {submitting ? 'Saving…' : draftId ? 'Update draft & close' : 'Save as draft & close'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="bookings-panel__danger-link"
                      onClick={closeBookingForm}
                      disabled={submitting}
                    >
                      {closePrompt === 'EDIT' ? 'Discard changes' : 'Discard & close'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedBookingId && (
        <div
          // Dismissable by backdrop while it is only being read, but not once
          // the check-in form is open on top of it — that form has typed-in
          // details of its own, and it has its own Back button.
          className="glass-backdrop bookings-panel__backdrop"
          onClick={showCheckInForm ? undefined : closeDetail}
        >
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
                  {/* This modal is tall enough to scroll well past its own
                      footer, so the way out exists at both ends. */}
                  <button
                    type="button"
                    className="bookings-panel__close"
                    onClick={closeDetail}
                    aria-label="Close"
                    title="Close"
                  >
                    ×
                  </button>
                </div>

                {/* The same five sections the booking was taken through, in the
                    same order — read-only, because reading a record and
                    changing one are different jobs and only one of them should
                    be one keystroke away. Edit opens these very sections as
                    fields, in place of these rather than under them — two
                    copies of the same booking in one modal is a scroll looking
                    for the live one. */}
                {!showCheckInForm && (
                  <StayDetails
                    booking={bookingDetail}
                    idProofError={idProofError}
                    onViewIdProof={handleViewIdProof}
                    onViewGuestIdProof={handleViewGuestIdProof}
                    onClearFoodLockout={handleClearFoodLockout}
                    clearingLockout={clearingLockout}
                  />
                )}

                {actionError && <div className="form-banner form-banner--error">{actionError}</div>}

                {/* The receipt for money taken before the bill exists. Its own
                    row above the status actions, because it applies to a
                    reservation and to a guest already in the room alike —
                    an advance is taken at either point — while the rows below
                    are each about moving the stay to its next state.

                    Not offered once the stay is billed or cancelled: the final
                    invoice already accounts for every advance, and a cancelled
                    booking has no stay to hold money against. */}
                {!showCheckInForm &&
                  bookingDetail.status !== 'CANCELLED' &&
                  bookingDetail.status !== 'CHECKED_OUT' && (
                    <div className="bookings-panel__actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setShowAdvanceReceipt(true)}
                        disabled={actionSubmitting}
                      >
                        Advance receipt
                        {advanceReceipts.length > 0 && ` (${advanceReceipts.length})`}
                      </button>
                    </div>
                  )}

                {bookingDetail.status === 'BOOKED' && !showCheckInForm && (
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
                        <label htmlFor="advancePaymentMethod">Payment type</label>
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
                    {needsPaymentReference(checkInForm.advancePaymentMethod) && (
                      <div className="field">
                        <label htmlFor="checkInAdvanceReference">Transaction number</label>
                        <input
                          id="checkInAdvanceReference"
                          value={checkInForm.advanceReference}
                          maxLength={64}
                          placeholder={
                            checkInForm.advancePaymentMethod === 'UPI' ? 'UPI reference / UTR' : 'Approval code'
                          }
                          onChange={(e) => setCheckInForm((f) => ({ ...f, advanceReference: e.target.value }))}
                        />
                      </div>
                    )}

                    <div className="form-section__title">Add guest details (optional)</div>
                    <p className="bookings-panel__hint">
                      For anyone who arrived with the guest but wasn&apos;t named when the room was
                      booked. The booking&apos;s guest count is raised to match.
                    </p>
                    {/* What the register will say once this check-in is saved,
                        against what was booked — reception should see the party
                        grow as they type it, not discover it afterwards. */}
                    <p className="bookings-panel__hint">
                      <strong>
                        {checkInPartySize} guest{checkInPartySize === 1 ? '' : 's'}
                      </strong>{' '}
                      checking in
                      {bookingDetail.numGuests !== checkInPartySize
                        ? ` · booked for ${bookingDetail.numGuests}`
                        : ''}
                    </p>
                    {overRoomOccupancy && (
                      <div className="form-banner form-banner--info">
                        Room {bookingDetail.roomNumber} sleeps {bookingDetail.roomMaxOccupancy}. Check-in
                        isn’t blocked — make sure the extra bedding is arranged.
                      </div>
                    )}
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
                            {/* One row for both, rather than two lists to pick
                                between before typing a name. The register reads
                                the party back as adults and children from this. */}
                            <div className="field">
                              <label htmlFor={`checkInGuestType-${index}`}>Type</label>
                              <select
                                id={`checkInGuestType-${index}`}
                                value={guest.isChild ? 'CHILD' : 'ADULT'}
                                onChange={(e) =>
                                  updateCheckInGuest(index, { isChild: e.target.value === 'CHILD' })
                                }
                              >
                                <option value="ADULT">Adult</option>
                                <option value="CHILD">Child</option>
                              </select>
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
                    <button type="button" className="bookings-panel__add-btn" onClick={addCheckInGuest}>
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

                {bookingDetail.status === 'CHECKED_IN' && (
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

                {bookingDetail.status === 'CHECKED_OUT' && (
                  <div className="bookings-panel__actions">
                    {canEditBooking ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={openEditBooking}
                        disabled={actionSubmitting}
                      >
                        Edit booking
                      </button>
                    ) : (
                      <span className="bookings-panel__hint">This stay has been billed — extras are locked.</span>
                    )}
                  </div>
                )}

                {/* Always present, whatever the stay's status — the panels
                    above vary by it, and none of them is a way out. Hidden
                    only behind the check-in form, which has its own Back. */}
                {!showCheckInForm && (
                  <div className="bookings-panel__actions bookings-panel__actions--close">
                    <button type="button" className="btn-secondary" onClick={closeDetail}>
                      Close
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Stacked above the booking detail rather than replacing it: issuing a
          receipt is a step inside looking at a stay, and the desk goes straight
          back to it afterwards. */}
      {showAdvanceReceipt && bookingDetail && (
        <AdvanceReceiptModal
          booking={bookingDetail}
          existingReceipts={advanceReceipts}
          onClose={() => setShowAdvanceReceipt(false)}
          onIssued={handleReceiptIssued}
        />
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
// The party, editable. Shared by the new-booking form and the edit form so a
// booking is corrected through the same rows it was taken through — the two
// drifting apart is how a field ends up on one and not the other.
//
// `idPrefix` keeps the two instances from minting the same DOM ids when both
// are mounted; `onAdd`/`onRemove`/`onUpdate` take the list key ('adults' or
// 'children') so the caller keeps ownership of where the party lives in state.
// The name field on a new booking, with the property's own guest history behind
// it. A lodge's regulars are its business, and making a returning guest spell
// out a phone number and hand over an ID card the property already holds a copy
// of is the kind of thing a desk notices every single time.
//
// Only ever offered for the primary guest of a *new* booking. Changing who an
// existing stay belongs to is a cancel and rebook, not a lookup.
function GuestNameField({ id, value, token, onChange, onPick }) {
  const [matches, setMatches] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Set when a suggestion is taken, so the fetch that the same keystroke would
  // otherwise fire doesn't reopen the list over the name just chosen.
  const picked = useRef('');
  const boxRef = useRef(null);

  useEffect(() => {
    const term = value.trim();
    if (term.length < 2 || term === picked.current) {
      setMatches([]);
      return undefined;
    }
    // A query per keystroke would be a query per keystroke. A quarter second is
    // below the threshold where a suggestion list feels like it lagged, and
    // above the speed anyone types a name.
    let stale = false;
    const timer = setTimeout(() => {
      apiGet(`/bookings/guest-search?q=${encodeURIComponent(term)}`, { token })
        .then((data) => {
          // Two keystrokes in flight can land out of order; the later one owns
          // the list, so an answer to a name already typed past is dropped.
          if (stale) return;
          setMatches(data.guests);
          setActive(-1);
          setOpen(data.guests.length > 0);
        })
        // Suggestions are a convenience: a lookup that fails leaves reception
        // typing the name out, which is what they were doing anyway.
        .catch(() => setMatches([]));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [value, token]);

  // Clicking anywhere else is a dismissal. Listening on the document rather
  // than the input's blur, because blur fires before the click lands on a
  // suggestion and would close the list out from under the pointer.
  useEffect(() => {
    if (!open) return undefined;
    const onDocumentDown = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentDown);
    return () => document.removeEventListener('mousedown', onDocumentDown);
  }, [open]);

  const take = (guest) => {
    picked.current = guest.name;
    setOpen(false);
    setMatches([]);
    onPick(guest);
  };

  const onKeyDown = (e) => {
    if (!open || matches.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + matches.length) % matches.length);
    } else if (e.key === 'Enter' && active >= 0) {
      // Only swallowed when a suggestion is actually highlighted — Enter on a
      // typed name has to keep submitting the form.
      e.preventDefault();
      take(matches[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="guest-typeahead" ref={boxRef}>
      <input
        id={id}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-suggestions`}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${id}-suggestion-${active}` : undefined}
        // The browser's own saved-form dropdown would sit on top of this one.
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(matches.length > 0)}
      />
      {open && (
        <ul className="guest-typeahead__list" id={`${id}-suggestions`} role="listbox">
          {matches.map((guest, i) => (
            <li key={guest.bookingId} role="option" aria-selected={i === active} id={`${id}-suggestion-${i}`}>
              <button
                type="button"
                className={`guest-typeahead__option${i === active ? ' guest-typeahead__option--active' : ''}`}
                // mousedown, not click: the input's blur would otherwise race
                // the click and the option would move out from under the cursor.
                onMouseDown={(e) => {
                  e.preventDefault();
                  take(guest);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="guest-typeahead__name">{guest.name}</span>
                <span className="guest-typeahead__meta">
                  {guest.phone}
                  {guest.stayCount > 1 ? ` · ${guest.stayCount} stays` : ''}
                  {guest.lastStayDate ? ` · last ${formatDateLong(guest.lastStayDate)}` : ''}
                </span>
                {/* The one thing that changes what reception has to do next. */}
                {guest.hasIdProofDocument && (
                  <span className="guest-typeahead__badge">{idProofLabel(guest.idProofType)} on file</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// fieldErr renders the message for one input's id, or nothing — the party rows
// are where "enter a name for this adult" has to appear, and only the form
// knows which row failed.
function PartyEditor({
  adults,
  children,
  idProofOptional,
  idPrefix,
  onAdd,
  onRemove,
  onUpdate,
  guestLookupToken,
  fieldErr,
}) {
  const idTypeOptions = ID_PROOF_TYPES.map((t) => (
    <option key={t} value={t}>
      {idProofLabel(t)}
    </option>
  ));

  // What is already held for this guest, so an edit doesn't read as though the
  // document were missing and get one uploaded again on top of it.
  const onFile = (person) =>
    person.hasDocument && !person.idProofFile ? (
      <span className="bookings-panel__muted"> · on file</span>
    ) : null;

  return (
    <>
      {/* The add button rides in the sub-heading rather than sitting as a
          full-width bar under the list — same reach, two fewer rows of height
          across the two party lists. */}
      <div className="booking-form__subhead">
        <span className="booking-form__subhead-label">
          Adults
          <span className="booking-form__subhead-count">{adults.length}</span>
        </span>
        <button type="button" className="booking-form__add-inline" onClick={() => onAdd('adults', emptyGuest)}>
          + Add adult
        </button>
      </div>
      <div className="bookings-panel__repeat-list">
        {adults.map((adult, index) => {
          const isPrimary = index === 0;
          return (
            <div className="bookings-panel__party-row" key={adult.id ?? `new-${index}`}>
              <div className="field">
                <label htmlFor={`${idPrefix}AdultName-${index}`}>
                  {isPrimary ? 'Name (primary guest)' : 'Name'}
                </label>
                {isPrimary && guestLookupToken ? (
                  <GuestNameField
                    id={`${idPrefix}AdultName-${index}`}
                    value={adult.name}
                    token={guestLookupToken}
                    onChange={(name) =>
                      // Typing over a name that was picked drops the carried
                      // document with it — what's on file belongs to the guest
                      // who was chosen, not to whoever is being typed now.
                      onUpdate('adults', index, { name, fromBookingId: null, hasDocument: false })
                    }
                    onPick={(guest) =>
                      onUpdate('adults', index, {
                        name: guest.name,
                        phone: guest.phone,
                        idProofType: guest.idProofType ?? '',
                        // Not the document itself — only the stay to copy it
                        // from, which the server resolves on save.
                        fromBookingId: guest.hasIdProofDocument ? guest.bookingId : null,
                        hasDocument: guest.hasIdProofDocument,
                      })
                    }
                  />
                ) : (
                  <input
                    id={`${idPrefix}AdultName-${index}`}
                    value={adult.name}
                    onChange={(e) => onUpdate('adults', index, { name: e.target.value })}
                  />
                )}
                {fieldErr(`${idPrefix}AdultName-${index}`)}
              </div>
              <div className="field">
                <label htmlFor={`${idPrefix}AdultPhone-${index}`}>
                  Mobile{isPrimary ? '' : ' (optional)'}
                </label>
                <input
                  id={`${idPrefix}AdultPhone-${index}`}
                  value={adult.phone}
                  onChange={(e) => onUpdate('adults', index, { phone: e.target.value })}
                />
                {fieldErr(`${idPrefix}AdultPhone-${index}`)}
              </div>
              <div className="field">
                <label htmlFor={`${idPrefix}AdultIdProofType-${index}`}>
                  ID type{isPrimary && !idProofOptional ? '' : ' (optional)'}
                </label>
                <select
                  id={`${idPrefix}AdultIdProofType-${index}`}
                  value={adult.idProofType}
                  onChange={(e) => onUpdate('adults', index, { idProofType: e.target.value })}
                >
                  <option value="">{isPrimary ? 'Choose one' : 'None'}</option>
                  {idTypeOptions}
                </select>
                {fieldErr(`${idPrefix}AdultIdProofType-${index}`)}
              </div>
              <div className="field">
                <label htmlFor={`${idPrefix}AdultIdProofFile-${index}`}>
                  Document{isPrimary && !idProofOptional ? '' : ' (optional)'}
                  {onFile(adult)}
                </label>
                <input
                  id={`${idPrefix}AdultIdProofFile-${index}`}
                  type="file"
                  accept={ID_PROOF_ACCEPT}
                  onChange={(e) => onUpdate('adults', index, { idProofFile: e.target.files[0] || null })}
                />
                {fieldErr(`${idPrefix}AdultIdProofFile-${index}`)}
              </div>
              {/* The primary guest is the booking itself — there's no booking
                  left to remove them from. */}
              {isPrimary ? (
                <span className="bookings-panel__row-spacer" />
              ) : (
                <button
                  type="button"
                  className="bookings-panel__row-remove-btn"
                  onClick={() => onRemove('adults', index)}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Said in full rather than left to the "· on file" note beside the
          Document field: reception has just picked a returning guest and is
          about to look for the upload box, and this is the sentence that stops
          them asking for a card the property already holds. */}
      {adults[0]?.fromBookingId && !adults[0].idProofFile && (
        <p className="bookings-panel__hint">
          {idProofLabel(adults[0].idProofType) || 'The ID proof'} from this guest’s previous stay
          will be attached to this booking — no need to ask for it again. Attaching a file below
          replaces it.
        </p>
      )}

      <div className="booking-form__subhead">
        <span className="booking-form__subhead-label">
          Children
          <span className="booking-form__subhead-count">{children.length}</span>
        </span>
        <button type="button" className="booking-form__add-inline" onClick={() => onAdd('children', emptyChild)}>
          + Add child
        </button>
      </div>
      {children.length > 0 && (
        <div className="bookings-panel__repeat-list">
          {children.map((child, index) => (
            <div
              className="bookings-panel__party-row bookings-panel__party-row--child"
              key={child.id ?? `new-${index}`}
            >
              <div className="field">
                <label htmlFor={`${idPrefix}ChildName-${index}`}>Name</label>
                <input
                  id={`${idPrefix}ChildName-${index}`}
                  value={child.name}
                  onChange={(e) => onUpdate('children', index, { name: e.target.value })}
                />
                {fieldErr(`${idPrefix}ChildName-${index}`)}
              </div>
              <div className="field">
                <label htmlFor={`${idPrefix}ChildIdProofType-${index}`}>ID type (optional)</label>
                <select
                  id={`${idPrefix}ChildIdProofType-${index}`}
                  value={child.idProofType}
                  onChange={(e) => onUpdate('children', index, { idProofType: e.target.value })}
                >
                  <option value="">None</option>
                  {idTypeOptions}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`${idPrefix}ChildIdProofFile-${index}`}>
                  Document (optional)
                  {onFile(child)}
                </label>
                <input
                  id={`${idPrefix}ChildIdProofFile-${index}`}
                  type="file"
                  accept={ID_PROOF_ACCEPT}
                  onChange={(e) => onUpdate('children', index, { idProofFile: e.target.files[0] || null })}
                />
                {fieldErr(`${idPrefix}ChildIdProofFile-${index}`)}
              </div>
              <button
                type="button"
                className="bookings-panel__row-remove-btn"
                onClick={() => onRemove('children', index)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="bookings-panel__hint">
        Documents accept an image (JPG/PNG/WEBP) or PDF, up to 5MB. An uploaded document replaces what
        is on file; removing the guest is what takes one off a booking.
      </p>
    </>
  );
}

// Vehicles, editable. Same reason as PartyEditor for being shared.
function VehicleEditor({ vehicles, onAdd, onRemove, onUpdate, idPrefix, fieldErr }) {
  const rowId = (kind, index) => `${idPrefix}Vehicle${kind}-${index}`;
  // A row can be wrong in either half — a number with no type, or a type with
  // no number — and only one of the two is ever reported, so whichever it is
  // renders under the row.
  const errorFor = (index) => fieldErr(rowId('Number', index)) || fieldErr(rowId('Type', index));

  return (
    <>
      {vehicles.length > 0 && (
        <div className="bookings-panel__repeat-list">
          {vehicles.map((vehicle, index) => (
            <div key={index}>
              <div className="bookings-panel__vehicle-row">
                <input
                  id={rowId('Number', index)}
                  value={vehicle.number}
                  onChange={(e) => onUpdate(index, { number: e.target.value })}
                  placeholder="MH07AB1234"
                  aria-label={`Vehicle number ${index + 1}`}
                />
                <select
                  id={rowId('Type', index)}
                  value={vehicle.type}
                  onChange={(e) => onUpdate(index, { type: e.target.value })}
                  aria-label={`Vehicle type ${index + 1}`}
                >
                  <option value="">Type</option>
                  {Object.entries(VEHICLE_TYPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button type="button" className="bookings-panel__remove-btn" onClick={() => onRemove(index)}>
                  Remove
                </button>
              </div>
              {errorFor(index)}
            </div>
          ))}
        </div>
      )}
      <button type="button" className="bookings-panel__add-btn" onClick={onAdd}>
        + Add vehicle
      </button>
    </>
  );
}

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
