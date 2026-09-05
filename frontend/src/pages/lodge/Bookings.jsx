import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { useUrlState } from '../../lib/urlState';
import { formatPrice } from './priceFormat';
import StayDetails from './StayDetails';
import AdvanceReceiptModal from './AdvanceReceiptModal';
import PaymentLines from './PaymentLines';
import IconButton from '../../components/IconButton';
import Req from '../../components/RequiredMark';
import StepNum from '../../components/StepNum';
// Aliased: this file already has a local TrashIcon, drawn at 15px for the
// inline row-remove buttons. The shared glyph is 18px, sized for the 34px
// icon buttons, so the two can't be collapsed into one.
import { TrashIcon as ActionTrashIcon, OpenIcon } from '../../components/ActionIcons';
import {
  PAYMENT_METHOD_LABEL,
  describeAdvance,
  emptyPaymentLine,
  needsPaymentReference,
  paymentFieldId,
  paymentLinesError,
  sumLines,
  toPaymentLines,
} from './paymentSplit';
import {
  STAY_STATUS_CHIP_LABEL,
  VEHICLE_TYPE_LABEL,
  describeParty,
  formatDateLong,
  idProofLabel,
} from './stayFormat';
import './forms.css';
import './chartSections.css';
import './tapeChart.css';
import './Bookings.css';

const ID_PROOF_TYPES = ['AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID', 'OTHER'];
// A deposit is handed over part cash, part UPI as often as a final bill is —
// arguably more, since "I've got 300 cash, rest on UPI" is the normal shape of
// one. This wires the booking and check-in forms to the same editor the bill
// and the receipt modal use.
//
// advancePaymentMethod and advanceReference stay exactly as they were and go on
// meaning "the first tender", so the section badge, the FormData, the edit seed
// and the just-booked summary all keep reading them untouched. Both are written
// in the same update as the lines, so the two can never drift apart.
const withAdvanceLines = (form, next) => ({
  ...form,
  advanceLines: next,
  advancePaymentMethod: next[0].method,
  advanceReference: next[0].reference,
  // The advance total is the sum of its rows, never a figure typed beside
  // them. Written into advanceAmount rather than derived at the point of use
  // so every existing reader — the section badge, the "advance can't exceed
  // the stay" check, the FormData, the just-booked summary — goes on reading
  // the one field it always read.
  //
  // Blank, not "0", when nothing has been entered: hasAdvanceAmount tests
  // this field for emptiness to decide whether an advance was taken at all,
  // and a zero would make every booking look like it came with one.
  advanceAmount: sumLines(next) > 0 ? String(sumLines(next)) : '',
});

const setAdvanceLines = (setForm) => (next) => setForm((f) => withAdvanceLines(f, next));

// The rows of a full payment: whatever the desk typed into the earlier rows,
// with the last one made up to the stay total.
//
// "Full" is a promise about the sum, and a promise the desk has to keep by
// hand — retyping the last figure every time the discount or the dates move —
// is one that gets broken. So the last row is always the remainder, and a
// split can never come up short. It can come up *over*, if the earlier rows
// already pass the total; the remainder then reads 0 and the save says so.
function fullPaymentLines(lines, total) {
  const rows = lines.length ? lines : [emptyPaymentLine()];
  const others = rows.slice(0, -1);
  const remainder = Math.round((total - sumLines(others)) * 100) / 100;
  return [...others, { ...rows[rows.length - 1], amount: remainder > 0 ? String(remainder) : '0' }];
}

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
// The two marks on the search result's identity line. Inline rather than text
// labels ("Ph:", "ID:") because the line is read at a glance while stepping
// through matches, and a glyph is quicker to skip past than a word is.
const PhoneIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.8.6a2 2 0 0 1 1.7 2Z" />
  </svg>
);

const IdIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <circle cx="8.5" cy="11" r="2" />
    <path d="M5 16c.6-1.3 1.9-2 3.5-2s2.9.7 3.5 2M15 10h4M15 14h4" />
  </svg>
);

const TOOLTIP_DOT = { BOOKED: 'booked', CHECKED_IN: 'checked-in', CHECKED_OUT: 'checked-out' };

// Everything a stay on the chart can be found by. Guest names are deliberately
// absent from the tiles — the grid is rooms and nights, not a list of people —
// so the search box is the only way to ask the chart "where is this guest?"
// and it has to reach the same things the register can be searched on: the
// party's names, the ID numbers on file for any of them, the bill, the phone.
//
// Kept as a list of fields rather than flattened to one string: the punctuation
// pass below compares field by field, and a single joined haystack would let a
// search run off the end of one field and into the start of the next — "n jai"
// matching a "…n" guest beside a "Jai…" co-guest, which is a hit the desk
// cannot explain.
function searchFields(booking) {
  return [
    booking.guestName,
    booking.guestPhone,
    booking.invoiceNumber,
    booking.idProofNumber,
    ...(booking.coGuestNames || []),
    ...(booking.coGuestIdNumbers || []),
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());
}

// What the search box was actually typed into.
function searchNeedle(text) {
  return text.trim().toLowerCase();
}

// The same string with everything but letters and digits removed. Bill and ID
// numbers get written down half a dozen ways — "INV-2026/041", "INV 2026 041",
// "inv2026041" — and none of them is wrong, so both sides are stripped to the
// characters that actually carry the number before they are compared.
function squash(text) {
  return text.replace(/[^a-z0-9]/g, '');
}

// Does this stay answer to what was typed?
function matchesSearch(fields, needle, squashedNeedle) {
  if (fields.some((f) => f.includes(needle))) return true;
  // Second pass, per field, for the numbers people punctuate freely.
  return squashedNeedle.length > 0 && fields.some((f) => squash(f).includes(squashedNeedle));
}

// The chart says "Reserved" where the data says BOOKED — the desk's word for a
// room held for a date still to come.
const TILE_STATUS_LABEL = { ...STATUS_LABEL, BOOKED: 'Reserved' };
// The legend chips that stand for a real booking status, and so can be followed
// into the register's cut of it.
//
// Labelled from the shared chip vocabulary rather than from TILE_STATUS_LABEL:
// the register's filter chips read from the same map, and a chip there has to
// say what the chip here said or following the colour lands somewhere that looks
// like a different question. TILE_STATUS_LABEL stays the hover card's, which
// reports a stay's status rather than naming a pile to look at.
const LEGEND_LINKS = [
  { status: 'BOOKED', swatch: 'booked' },
  { status: 'CHECKED_IN', swatch: 'checked-in' },
  { status: 'CHECKED_OUT', swatch: 'checked-out' },
  // Border-only on the chart, because a cancelled stay holds no night to
  // fill — but it is still a status the register can be cut by, so its chip
  // links there like the others.
  { status: 'CANCELLED', swatch: 'cancelled' },
].map((item) => ({ ...item, label: STAY_STATUS_CHIP_LABEL[item.status] }));
const BED_SIZE_LABEL = { SINGLE: 'Single', DOUBLE: 'Double', QUEEN: 'Queen', KING: 'King' };

function bedSummary(room) {
  if (!room) return null;
  const beds =
    room.beds && room.beds.length > 0
      ? room.beds
      : room.bedSize
        ? [{ size: room.bedSize, count: 1 }]
        : [];
  if (beds.length === 0) return null;
  return beds.map((b) => `${b.count} ${BED_SIZE_LABEL[b.size] || b.size}`).join(' + ');
}
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
// The month or months the columns belong to, named in full across the date
// header. A rolling window usually straddles two, and a band naming only the
// first would mislabel the second half of its own columns.
// The chart is a rolling 30-day window, so it almost always straddles a month
// boundary. Split into runs of days so each month can name itself over its own
// columns instead of the pair sharing one "AUGUST – SEPTEMBER" caption that
// says nothing about where one ends and the other starts.
function monthRuns(dates) {
  const runs = [];
  for (const date of dates) {
    const key = date.slice(0, 7);
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.days += 1;
    else runs.push({ key, days: 1, first: date });
  }
  return runs;
}

function formatMonthBand(fromStr, toStr) {
  const opts = { month: 'long', year: 'numeric', timeZone: 'UTC' };
  const from = new Date(`${fromStr}T00:00:00Z`);
  const to = new Date(`${toStr}T00:00:00Z`);
  const a = from.toLocaleDateString('en-IN', opts);
  const b = to.toLocaleDateString('en-IN', opts);
  return a === b ? a : `${a} – ${b}`;
}

// The stepper's label, split in two so the month name carries the emphasis and
// the year sits back from it — the year is the part nobody is actually reading.
// The chart is a rolling window, not a calendar month.
//
// A month starting at the 1st spends its first three weeks showing nights that
// have already been slept — on the 23rd, five sixths of the grid was history
// and the rooms actually being sold were squeezed against the right edge. The
// desk sells forward, so the window looks forward.
//
// Four days of history is enough to see who is still in house and to correct
// something taken yesterday; the remaining twenty-six are what is for sale.
const WINDOW_DAYS = 30;
// The chart opens on WINDOW_DAYS and grows by another WINDOW_DAYS each time the
// desk scrolls near its right edge. Capped because every growth refetches the
// whole range, and nobody plans half a year of nights by scrolling.
const MAX_WINDOW_DAYS = 180;
// How close to the end counts as "at the end". A little over three columns, so
// the next month is already loading by the time it is scrolled to.
const GROW_WITHIN_PX = 90;
const WINDOW_PAST_DAYS = 4;

const windowStartFor = (dateStr) => addDays(dateStr, -WINDOW_PAST_DAYS);

// "23 Aug – 21 Sep" and the year beneath, or just the month when the window
// happens to sit inside one.
function formatViewLabel(windowStart) {
  const end = addDays(windowStart, WINDOW_DAYS - 1);
  const from = new Date(`${windowStart}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  const day = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  return {
    primary: `${day(from)} – ${day(to)}`,
    secondary: sameYear
      ? String(from.getUTCFullYear())
      : `${from.getUTCFullYear()} – ${to.getUTCFullYear()}`,
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

// The two directions of the same sum, kept together so they cannot drift.
//
// Rupees round to whole numbers — the amount field is whole rupees and an
// invoice is settled in them. Percent keeps two decimals, which is what makes
// ₹100 off ₹1,300 expressible at all (7.69%) rather than collapsing to 8%.
const amountFromPercent = (percent, total) => String(Math.round((total * percent) / 100));
const percentFromAmount = (amount, total) =>
  total > 0 ? String(Math.round((amount / total) * 10000) / 100) : '';

// Blank, nonsense and out-of-range all mean "this box is not driving anything".
const usableNumber = (raw, max) => {
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};

const TEN_DIGITS = /^\d{10}$/;
const MOBILE_MESSAGE = 'Enter a 10-digit mobile number.';

// Mirrors normaliseMobile in bookings.schema.js. Duplicated rather than shared
// because the two live either side of the wire, but they must agree: a form
// that accepts what the server rejects is a round trip spent on a red banner.
function mobileDigits(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

const isMobile = (value) => TEN_DIGITS.test(mobileDigits(value));

// What the input is allowed to become as it is typed into. Letters and symbols
// never reach the field, so the rule is visible at the keystroke rather than
// held back until save.
//
// Normalised before the cut, not after: slicing the raw digits of
// "+91 98765 43210" to ten would keep "9198765432" — a different number that
// happens to be the right length, which is the worst kind of wrong.
const typedMobile = (value) => mobileDigits(value).slice(0, 10);

const emptyGuest = { name: '', phone: '', idProofType: '', idProofNumber: '', idProofFile: null };
// Children are the same row minus the phone — a child travelling with the
// party has no number of their own to reach them on.
const emptyChild = { name: '', idProofType: '', idProofNumber: '', idProofFile: null };
// A late arrival taken at check-in. One row for adults and children alike,
// because the desk is typing a name off an ID card and doesn't want two
// differently-shaped forms to choose between first — which of the two it is
// rides on the row instead. Adult unless said otherwise: most are.
const emptyCheckInGuest = { name: '', phone: '', idProofType: '', idProofNumber: '', idProofFile: null, isChild: false };
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

// An extra is carried as { id, quantity, agreedAmount }: the checkbox owns
// whether it's on the booking at all, the count owns how many, and agreedAmount
// is what reception agreed the whole line costs per night. Blank means "charge
// what the lodge charges times the count" — the common case, and what every
// extra did before the total was editable.
//
// An extra is carried as { id, quantity }: the checkbox owns whether it's on
// the booking at all, the count beside it owns how many. quantity is held as
// typed so the field can be cleared mid-edit, and read back through
// selectionCount, which is what every consumer of it actually wants.
function selectionCount(value) {
  const count = Math.floor(Number(value));
  return Number.isFinite(count) && count >= 1 ? count : 1;
}

// Blank or nonsense means "no override" rather than free — a cleared box while
// typing must not silently zero the line. Zero typed on purpose is kept.
function selectionAgreed(value) {
  if (value == null || String(value).trim() === '') return undefined;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : undefined;
}

// Extras ids reach this screen from two different payloads: available-rooms
// returns dbo.switchable_charges.id as the driver hands it over, while the
// price quote passes it through Number(). A BIGINT that arrives as a string on
// one route and a number on the other makes === false, and then the selection
// helpers quietly match nothing.
//
// That is what broke the editable extras total: the quantity box worked because
// it is called with the room payload's id — the same value the form stored —
// while the price box is called with the quote's, and never found its line.
// Compared numerically here so it cannot matter which payload an id came from.
function sameCharge(a, b) {
  return Number(a) === Number(b);
}

function toggleSelection(selections, chargeId) {
  return selections.some((c) => sameCharge(c.id, chargeId))
    ? selections.filter((c) => c.id !== chargeId)
    : [...selections, { id: chargeId, quantity: '1', agreedAmount: '' }];
}

function withQuantity(selections, chargeId, quantity) {
  return selections.map((c) => (sameCharge(c.id, chargeId) ? { ...c, quantity } : c));
}

function withAgreedAmount(selections, chargeId, agreedAmount) {
  return selections.map((c) => (sameCharge(c.id, chargeId) ? { ...c, agreedAmount } : c));
}

function selectionOf(selections, chargeId) {
  return selections.find((c) => sameCharge(c.id, chargeId));
}

// "7:3,8" — the id alone when there's just one of it, so the common case reads
// the same as it always did.
function chargesParam(selections) {
  return selections
    .map((c) => {
      const count = selectionCount(c.quantity);
      const price = selectionAgreed(c.agreedAmount);
      const base = count > 1 ? `${c.id}:${count}` : String(c.id);
      return price === undefined ? base : `${base}@${price}`;
    })
    .join(',');
}

function chargesPayload(selections) {
  return selections.map((c) => {
    const price = selectionAgreed(c.agreedAmount);
    return price === undefined
      ? { id: c.id, quantity: selectionCount(c.quantity) }
      : { id: c.id, quantity: selectionCount(c.quantity), agreedAmount: price };
  });
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
function rateParam(basePriceOverride) {
  const rate = Number(basePriceOverride);
  return basePriceOverride !== '' && Number.isFinite(rate) && rate > 0
    ? `&basePriceOverride=${rate}`
    : '';
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
  // The percent box, which is UI-only. discountAmount stays the single value
  // that is quoted, validated and sent — percent is a way of filling it in,
  // not a second kind of discount the rest of the system has to know about.
  // The invoice derives its own percentage from the amount anyway
  // (billing.service.js), so storing one here would be a second copy free to
  // disagree with it.
  discountPercent: '',
  // Which box the desk typed into. Never rendered — it exists so that only the
  // derived box is ever rewritten. See the setters.
  discountSource: '',
  // The party is the guest count — adults[0] is the primary guest, and the
  // total is however many names reception actually types in.
  adults: [{ ...emptyGuest }],
  children: [],
  // The nightly rate reception agreed for this stay, blank where it is the
  // category's own — which is most stays. Held as the per-night figure because
  // that is what the booking stores; the box on screen shows it across the
  // whole stay, which is a view of it and not a second way to price.
  basePriceOverride: '',
  advanceAmount: '',
  advanceLines: [emptyPaymentLine()],
  advancePaymentMethod: '',
  // The UPI/card transaction number. Blank on cash, which leaves no trail to
  // record — see needsPaymentReference.
  advanceReference: '',
  // Whether the rows above are the whole stay rather than a part of it. Only
  // a flag: what is sent is the advance it always was, at the stay total. The
  // server already allows an advance equal to the stay, and the bill at
  // check-out already carries whatever was paid up front — this is the desk
  // being able to say "paid in full" in one click and have it stay true as
  // the total moves.
  collectFull: false,
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

export default function Bookings({ onBillStay, onShowRegister }) {
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
  const [month, setMonth] = useState(() => windowStartFor(todayIso()));
  const [tapeData, setTapeData] = useState(null);
  const [tapeError, setTapeError] = useState('');
  // The tile that's under the pointer right now, with the screen position to
  // float its card at. Guest names live only in here — never on the tiles.
  const [hoverTile, setHoverTile] = useState(null);
  // What the desk is looking for on the chart, and which of the hits it is
  // currently parked on. The index is held here rather than derived so stepping
  // through the results is a state change and not a re-search.
  const [search, setSearch] = useState('');
  const [hitIndex, setHitIndex] = useState(0);
  // Every parked booking on this property. Sits beside the chart's own state
  // because it is loaded with it and drawn on it.
  const [drafts, setDrafts] = useState(() => readCache('/bookings/drafts') ?? []);
  const [showDrafts, setShowDrafts] = useState(false);

  // How many nights the chart is currently showing. Starts a page wide and
  // grows as the desk scrolls forward into it; back to a page whenever the
  // window is moved, so stepping never lands on a six-month chart.
  const [windowDays, setWindowDays] = useState(WINDOW_DAYS);

  const dates = useMemo(
    () => Array.from({ length: windowDays }, (_, i) => addDays(month, i)),
    [month, windowDays]
  );

  // Every column where a new month starts. More than one once the window has
  // grown past a couple of months, which is why the partition is drawn per
  // boundary rather than as a single line the grid knows about.
  const monthEdges = useMemo(
    () => dates.reduce((cols, d, i) => (i > 0 && d.slice(8, 10) === '01' ? [...cols, i] : cols), []),
    [dates]
  );

  const rangeStart = month;
  // Exclusive, as before — the fetch asks for the night after the last column.
  const rangeEnd = useMemo(() => addDays(month, windowDays), [month, windowDays]);

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
  // A draft named in the URL — the register's View button lands here with
  // ?draft=<id>. Looked up against the list as it comes in from the server,
  // not the cache, so a stale copy can't report it missing; then the key is
  // dropped so a reload or a later visit doesn't reopen it.
  const [draftParam, setDraftParam] = useUrlState('draft');
  const pendingDraftId = useRef(draftParam);
  // openDraft is defined further down, after the form state it works on; an
  // effect below keeps this pointed at it, and the fetch callback goes through
  // it — by the time the list arrives the effect has long since run.
  const openDraftRef = useRef(null);
  // Set when the form was opened that way, so closing it takes the desk back
  // to the register's Draft cut it came from rather than leaving it on the
  // chart — the same courtesy an abandoned edit gets, back to its booking.
  const cameFromRegister = useRef(false);
  const returnToRegisterIfCame = () => {
    if (!cameFromRegister.current) return;
    cameFromRegister.current = false;
    onShowRegister?.('DRAFT');
  };
  const loadDrafts = () => {
    apiGet('/bookings/drafts', { token })
      .then((data) => {
        const list = data.drafts.filter(usableDraft);
        setDrafts(writeCache('/bookings/drafts', list));
        const wanted = pendingDraftId.current;
        if (wanted == null) return;
        pendingDraftId.current = null;
        setDraftParam(null);
        const parked = list.find((d) => String(d.id) === String(wanted));
        if (!parked) return;
        cameFromRegister.current = true;
        openDraftRef.current?.(parked);
      })
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

  // Each category is its own scroller, so they are kept in step: scrolling
  // Deluxe into September while Standard sat in August would put two different
  // fortnights one above the other under headers that both claim otherwise.
  const scrollers = useRef(new Set());
  const syncing = useRef(false);
  // Where the chart was a moment ago, so a scroll can be told which way it
  // went. Reaching the left edge only means "show me earlier nights" if the
  // desk was heading that way — scrolling right off a chart that starts at 0
  // passes through the same few pixels and must not be read as the same thing.
  const lastLeft = useRef(0);
  // The width of the grid just before earlier nights were prepended. Columns
  // added on the left push everything right while scrollLeft stays put, so the
  // view would lurch backwards; this is what it is put back by.
  const prepending = useRef(null);

  const onChartScroll = (e) => {
    // The pointer is no longer over whatever the card is describing.
    setHoverTile(null);
    const el = e.currentTarget;
    const wentLeft = el.scrollLeft < lastLeft.current;
    lastLeft.current = el.scrollLeft;

    if (!syncing.current) {
      syncing.current = true;
      for (const other of scrollers.current) {
        if (other !== el && other.scrollLeft !== el.scrollLeft) other.scrollLeft = el.scrollLeft;
      }
      // Released a frame later. Assigning scrollLeft fires scroll on the cards
      // just moved, and without this each of them would sync everyone back.
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    }

    if (windowDays >= MAX_WINDOW_DAYS) return;

    // Near the end, and there is more to show: another page of nights.
    if (el.scrollWidth - el.scrollLeft - el.clientWidth < GROW_WITHIN_PX) {
      setWindowDays((days) => Math.min(days + WINDOW_DAYS, MAX_WINDOW_DAYS));
      return;
    }

    // And the same going back, for a stay being entered after the fact.
    if (wentLeft && el.scrollLeft < GROW_WITHIN_PX) growPast(el);
  };

  // Earlier nights, prepended. The window start moves back by exactly what the
  // length gains, so the far end of the chart stays where it was and only the
  // near end grows.
  const growPast = (el) => {
    if (prepending.current != null || windowDays >= MAX_WINDOW_DAYS) return;
    prepending.current = el.scrollWidth;
    setMonth((start) => addDays(start, -WINDOW_DAYS));
    setWindowDays((days) => Math.min(days + WINDOW_DAYS, MAX_WINDOW_DAYS));
  };

  // Once the chart is scrolled hard left there is nothing left to scroll, so no
  // scroll event ever fires and the handler above never hears the desk asking
  // for earlier nights. A wheel still fires against the stop — it is the only
  // signal there is that they are pushing at it.
  const onChartWheel = (e) => {
    const el = e.currentTarget;
    const backwards = e.deltaX < 0 || (e.shiftKey && e.deltaY < 0);
    if (el.scrollLeft <= 0 && backwards) growPast(el);
  };

  // Put the view back where it was looking after earlier nights are prepended.
  //
  // Before paint, not after: the columns are already in the DOM by now, and
  // correcting the offset a frame later would show one frame of the chart
  // jumped a month backwards.
  useLayoutEffect(() => {
    const before = prepending.current;
    if (before == null) return;
    prepending.current = null;
    for (const el of scrollers.current) {
      const added = el.scrollWidth - before;
      if (added > 0) el.scrollLeft += added;
    }
  }, [month, windowDays]);

  // Grow until the chart at least fills its card.
  //
  // Without this the window never grows on a wide screen: 30 columns fit with
  // room to spare, so there is nothing to scroll into, so the scroll handler
  // that would have asked for more never runs. It also answers the empty strip
  // that was left to the right of the last column — that space is nights, and
  // it should be showing them.
  //
  // Deferred a frame so the measurement happens after paint, and so this is
  // never a setState taken synchronously out of an effect. It settles: each
  // pass adds a page of nights, and stops as soon as the grid overflows the
  // card or the window hits its cap.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      for (const el of scrollers.current) {
        if (el.scrollWidth - el.clientWidth < GROW_WITHIN_PX) {
          setWindowDays((days) => Math.min(days + WINDOW_DAYS, MAX_WINDOW_DAYS));
          return;
        }
      }
    });
    return () => cancelAnimationFrame(frame);
    // categorySections is declared further down and would be in its temporal
    // dead zone here; tapeData is what brings the cards into existence anyway,
    // so measuring when it lands is the same moment.
  }, [windowDays, tapeData]);

  // Moving the window unmounts the tile the pointer is on, and an unmounted
  // tile never fires its mouseleave — so the card is dismissed with the move.
  const goToMonth = (windowStart) => {
    setHoverTile(null);
    setMonth(windowStart);
    // Back to a page. Stepping is for jumping somewhere else, and it would be
    // a poor jump that landed on however far the last one had been scrolled.
    setWindowDays(WINDOW_DAYS);
  };

  // A whole page at a time — WINDOW_DAYS, not the current (possibly grown)
  // windowDays, since goToMonth always resets the landing view back to a
  // page. Stepping by the grown size would skip the days in between.
  const stepWindow = (n) => goToMonth(addDays(month, n * WINDOW_DAYS));

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
      let bookingEnd = booking.checkOutDate;
      // A guest still checked in past their sold checkout date hasn't given the
      // room back — it stays occupied through today (and blocks the picker,
      // matching the server's overlap check) until an actual checkout happens.
      if (booking.status === 'CHECKED_IN' && bookingEnd <= today) bookingEnd = addDays(today, 1);
      let to = bookingEnd < rangeEnd ? bookingEnd : rangeEnd;
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

  // And once more for cancelled stays, apart for the same reason: a
  // cancellation holds no night, so it can share dates with a vacant slot or
  // a live booking alike. It never takes the tile — it borders it, which is
  // how the desk sees a booking fell through here without the night reading
  // as sold.
  const cancelledOccupancy = useMemo(() => {
    const byRoom = new Map();
    for (const stay of tapeData?.cancelled ?? []) {
      const key = String(stay.roomId);
      let byDate = byRoom.get(key);
      if (!byDate) {
        byDate = new Map();
        byRoom.set(key, byDate);
      }
      const from = stay.checkInDate > rangeStart ? stay.checkInDate : rangeStart;
      const to = stay.checkOutDate < rangeEnd ? stay.checkOutDate : rangeEnd;
      for (let d = from; d < to; d = addDays(d, 1)) byDate.set(d, stay);
    }
    return byRoom;
  }, [tapeData, rangeStart, rangeEnd]);

  // Which bookings on the chart answer to what's in the search box, in the
  // order they are read on screen: category by category, room by room, and
  // within a room by the night the stay starts on. That order is what makes the
  // next/previous arrows feel like they are walking the chart rather than
  // jumping around a list the desk can't see.
  //
  // A stay occupying several nights is one hit, not one per tile — the desk is
  // looking for a guest, and stepping through the same guest's six nights six
  // times would bury the second guest of the same name.
  const searchHits = useMemo(() => {
    const needle = searchNeedle(search);
    if (!needle || !tapeData) return [];
    const squashed = squash(needle);

    const hits = [];
    const taken = new Set();
    for (const section of categorySections) {
      for (const room of section.rooms) {
        const byDate = occupancy.get(String(room.id));
        if (!byDate) continue;
        // Walking `dates` rather than the map's own order: a Map iterates in
        // insertion order, which is the order bookings arrived from the API,
        // not the order their nights sit on the chart.
        for (const d of dates) {
          const booking = byDate.get(d);
          // A stay can hold nights in more than one room across a window if it
          // was moved; `taken` is per booking id, so it is still one hit.
          if (!booking || taken.has(booking.id)) continue;
          if (!matchesSearch(searchFields(booking), needle, squashed)) continue;
          taken.add(booking.id);
          // roomNumber rides along so the readout can name where the guest
          // is without looking the room up again — the whole point of the
          // search is answering "which room?", and that answer is right here.
          hits.push({
            bookingId: booking.id,
            roomId: room.id,
            roomNumber: room.roomNumber,
            date: d,
            booking,
          });
        }
      }
    }
    return hits;
  }, [search, tapeData, categorySections, occupancy, dates]);

  // Every booking id that matched, for the per-tile lookup the render does. A
  // Set because the row renderer asks this question once per tile and there can
  // be a few thousand of them on a grown window.
  const hitIds = useMemo(() => new Set(searchHits.map((h) => h.bookingId)), [searchHits]);

  // The hit the arrows are parked on, clamped rather than trusted: the results
  // change under it as the window grows or the chart reloads, and an index left
  // pointing past the end would blank the counter.
  const activeHit = searchHits.length > 0 ? searchHits[Math.min(hitIndex, searchHits.length - 1)] : null;

  // Bring the current hit into view. The chart scrolls horizontally in its own
  // per-category scroller and the page scrolls vertically past the others, so
  // both have to be asked — a hit on the third category's last night is off
  // screen in two directions at once.
  useEffect(() => {
    if (!activeHit) return undefined;
    // After paint: the tile carrying the marker class is what gets scrolled to,
    // and on the frame the search changed it hasn't been rendered yet.
    const frame = requestAnimationFrame(() => {
      const el = document.querySelector('.tape-tile--hit-current');
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeHit]);

  // Wrapping, both ways: the results are a ring, so the desk can keep pressing
  // one arrow without having to notice which end it is at.
  const stepHit = (n) => {
    if (searchHits.length === 0) return;
    setHoverTile(null);
    setHitIndex((i) => {
      const from = Math.min(i, searchHits.length - 1);
      return (from + n + searchHits.length) % searchHits.length;
    });
  };

  // A new search starts at its first result. Reset here rather than in an
  // effect watching `search`: the index is only ever stale because something
  // was typed, so the keystroke is where it belongs — and an effect would
  // re-render the whole chart a second time to do the same thing.
  const onSearchChange = (text) => {
    setSearch(text);
    setHitIndex(0);
  };

  // Whether the search strip is currently holding position at the top of the
  // page rather than sitting in its natural place. It only earns its opaque
  // backing and shadow once something is actually scrolling underneath it —
  // painted always, it would read as a band across the panel for no reason.
  //
  // A zero-height sentinel above the strip is what is watched, because the
  // strip itself is sticky and so never stops intersecting the viewport. The
  // sentinel scrolls away normally, and its leaving is exactly the moment the
  // strip starts to stick.
  const stickySentinel = useRef(null);
  const [searchStuck, setSearchStuck] = useState(false);

  useEffect(() => {
    const el = stickySentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setSearchStuck(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const clearSearch = () => {
    setSearch('');
    setHitIndex(0);
  };

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

  // Each category card, by name, so the chips above can reach the one they
  // stand for. A map rather than an array because the sections come and go as
  // rooms are added and removed, and a name is stabler than a position.
  const sectionRefs = useRef(new Map());

  // Which category the page is parked on, so the chip for it reads as the
  // current one. Set on click and then kept honest by the observer below —
  // scrolling away from a category by hand should move the highlight too,
  // otherwise the strip claims a section the desk has already left.
  const [activeCategory, setActiveCategory] = useState(null);

  // Set while a chip's scroll is still travelling. The animation drags every
  // card in between through the observer's band on the way, and each crossing
  // would overwrite the chip that was clicked — so the observer stands down
  // until the page has come to rest on the section that was asked for.
  const jumping = useRef(null);

  // A property with three or four grades of room runs the chart well past a
  // screen, and reaching the deluxe rooms means scrolling past every standard
  // one. The chips jump straight there.
  const jumpToCategory = (name) => {
    const el = sectionRefs.current.get(name);
    if (!el) return;
    setActiveCategory(name);
    // The month nav sits sticky at the top, so scrolling the card flush with
    // the viewport tucks its header underneath it. Offset by the strip's own
    // height, read off the element rather than hard-coded, so the card's
    // heading clears it on every breakpoint.
    const sticky = document.querySelector('.tape-controls');
    const offset = (sticky?.getBoundingClientRect().height || 0) + 12;
    const target = Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset);

    // Held until the scroll has actually arrived, not merely until it stops
    // moving. A smooth scroll begins stationary — it takes a frame or two to
    // get going — so "two frames without movement" is true at the very start,
    // before the page has left the category it was on. The lock would drop
    // there and the animation's own scroll events would then drive the
    // highlight backwards onto whatever it was travelling through: click
    // Deluxe, land on Deluxe, and watch the chip walk back to Standard.
    //
    // So arrival is the test, with stillness only as the way out for a scroll
    // that can never arrive — a target past the end of the page clamps short
    // of it, and the lock must not be held open for good.
    jumping.current = name;
    let still = 0;
    let last = window.scrollY;
    const settle = () => {
      if (jumping.current !== name) return; // superseded by a later chip
      const y = window.scrollY;
      // Within a pixel of where it was sent, or as close as the page can get:
      // at the end stop the browser clamps, and that counts as arrived.
      const maxTop = document.documentElement.scrollHeight - window.innerHeight;
      const arrived = Math.abs(y - Math.min(target, maxTop)) <= 1;
      still = Math.abs(y - last) <= 1 ? still + 1 : 0;
      last = y;
      // Stillness is only trusted once the page has had time to start: the
      // browser can sit on the first frames of a smooth scroll, and releasing
      // there is the bug this whole block exists to avoid.
      if (arrived || still >= 12) {
        jumping.current = null;
        return;
      }
      requestAnimationFrame(settle);
    };
    window.scrollTo({ top: target, behavior: 'smooth' });
    requestAnimationFrame(settle);
  };

  // Keeps the chips in step with the page when the desk scrolls by hand.
  //
  // Driven by the scroll event rather than an IntersectionObserver. The
  // observer was the wrong instrument twice over: it reports only the cards
  // whose visibility *changed*, so it cannot be read as "what is on screen
  // now", and a card taller than the viewport crosses no boundary at all while
  // it is being scrolled through — it goes silent for exactly the stretch the
  // chip most needs to keep up. A scroll listener fires whenever the page
  // moves, which is the actual question being asked.
  useEffect(() => {
    if (categorySections.length < 2) return undefined;

    const pick = () => {
      if (jumping.current) return;

      // The card the probe line falls inside wins. The line sits just under
      // the sticky strip — exactly where a jumped-to card's header comes to
      // rest — so the highlight agrees with where the page was actually sent.
      //
      // Not "whichever card is highest on screen": after a jump to Deluxe the
      // tail of Standard is still above it, so Standard is always the higher of
      // the two and would win every time. That was the chip staying on
      // Standard while the page sat on Deluxe.
      const sticky = document.querySelector('.tape-controls');
      const probe = (sticky?.getBoundingClientRect().height || 0) + 16;

      // Walked in layout order, so "the last card whose top has passed the
      // line" means what it says.
      let best = null;
      let bestTop = -Infinity;
      for (const section of categorySections) {
        const el = sectionRefs.current.get(section.categoryName);
        if (!el) continue;
        const { top, bottom } = el.getBoundingClientRect();
        if (top > probe) continue; // still below the line
        if (top > bestTop) {
          bestTop = top;
          best = el;
        }
        if (bottom > probe) break; // the line is inside this card; done
      }
      // Nothing has reached the line yet — the page is above the first card,
      // so the first category is the one being read.
      if (!best) best = sectionRefs.current.get(categorySections[0]?.categoryName) || null;

      // At the bottom of the page the probe stops being able to answer. The
      // last card or two sit below the line with no scroll left to bring them
      // up to it, so the line keeps reporting whichever card spans it —
      // clicking Suite would send the page as far as it goes and then light up
      // Deluxe. Once the page is against its end stop, the bottom of the
      // screen is what the desk is reading, so the lowest card showing there
      // wins instead.
      const atEnd =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atEnd) {
        for (const section of categorySections) {
          const el = sectionRefs.current.get(section.categoryName);
          // Anything whose top is on screen at the end stop is a card the
          // scroll could never lift to the line; the last such is the one the
          // page has come to rest on.
          if (el && el.getBoundingClientRect().top < window.innerHeight) best = el;
        }
      }

      if (best) setActiveCategory(best.dataset.category || null);
    };

    // Measuring inside the scroll event would lay out the page on every one of
    // them; a frame is as often as the highlight can visibly change anyway.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        pick();
      });
    };

    pick(); // settle the chip on load, before anything has scrolled
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [categorySections]);

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

  // Switching "collect full payment" on rebuilds the rows to the stay total;
  // off leaves whatever is there as an ordinary advance. Off is also what a
  // missing quote gets — there is no total to promise yet.
  const setCollectFull = (on) =>
    setBookingForm((f) => {
      if (!on) return { ...f, collectFull: false };
      if (!quote) return f;
      return { ...withAdvanceLines(f, fullPaymentLines(f.advanceLines, quote.totalPrice)), collectFull: true };
    });

  // Row edits on the booking form. Under a full payment the last row is
  // re-derived after every keystroke in the rows above, so the sum stays the
  // stay total no matter how the split is carved up.
  const onBookingAdvanceLines = (next) =>
    setBookingForm((f) =>
      withAdvanceLines(f, f.collectFull && quote ? fullPaymentLines(next, quote.totalPrice) : next)
    );

  // The discount inputs are hidden, so nothing types into discountAmount or
  // discountPercent any more and their write-through setters are gone. The
  // fields themselves stay on the form state: a discount already saved on a
  // booking is still loaded into them, still sent back unchanged on save, and
  // still shown by the live quote.

  // Switching mode clears the other box rather than converting between them.
  // Carrying a figure across reads as the app having agreed to a discount
  // nobody typed, and the two fields disagreeing on screen is worse than an
  // empty one.
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
  // A save can fail for a reason no single field owns — the room got taken
  // while this form was open, the phone number is already on another guest —
  // and that answer only comes back after the server round-trip, so it can't
  // be caught by failOn on the way in. The banner it lands in sits at the top
  // of a form long enough that the desk is often scrolled well past it by the
  // time Save is pressed, so the failure has to bring the eye to itself the
  // same way a field failure does.
  const formErrorRef = useRef(null);
  const reportFormError = (message) => {
    setFormError(message);
    requestAnimationFrame(() => {
      formErrorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

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
    // A draft parked before split advances existed carries no advanceLines, and
    // so does any older shape that finds its way in here. The editor reads
    // lines[0] unconditionally, so it is normalised at this one funnel rather
    // than at the three call sites — new booking, restored draft and edit all
    // come through here.
    const seeded = {
      ...form,
      advanceLines: form.advanceLines?.length ? form.advanceLines : [emptyPaymentLine()],
    };
    setBookingForm(seeded);
    setBaseTotal(null);
    setOpenedAs(formFingerprint(seeded));
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
    returnToRegisterIfCame();
  };

  // Parks what's on screen and closes. Only offered on a new booking: an edit
  // already has somewhere to keep its answers — the booking itself.
  //
  // Re-saving a draft that was opened from the list updates that row rather
  // than laying down a second copy of the same half-finished booking.
  const saveDraft = async () => {
    if (submitting) return;
    if (!hasFormContent(bookingForm)) {
      reportFormError('There is nothing to save yet — fill in a detail or two first.');
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
      returnToRegisterIfCame();
    } catch (err) {
      reportFormError(err instanceof ApiError ? err.message : 'Could not save this draft.');
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

  // See openDraftRef, by loadDrafts.
  useEffect(() => {
    openDraftRef.current = openDraft;
  });

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
        returnToRegisterIfCame();
      }
      loadDrafts();
      loadTapeChart();
    } catch (err) {
      reportFormError(err instanceof ApiError ? err.message : 'Could not delete this draft.');
    } finally {
      setSubmitting(false);
    }
  };

  const validRange =
    bookingForm.checkInDate && bookingForm.checkOutDate && bookingForm.checkOutDate > bookingForm.checkInDate;
  const isFutureCheckIn = bookingForm.checkInDate > today;
  // Once a guest has checked out there is no stay left to move or extend, so
  // the room and the dates are fixed — matching the backend's own guard.
  const canEditStay = !editing || editTarget?.status === 'BOOKED' || editTarget?.status === 'CHECKED_IN';
  // Narrower than the rest of the stay: a reservation that hasn't been checked
  // in yet can still be moved to different dates, which is an ordinary desk
  // correction. Once the guest is in the room the arrival day is a recorded
  // fact — the backend refuses to change it, and this keeps the box from
  // offering something the save would reject.
  const canEditCheckIn = !editing || editTarget?.status === 'BOOKED';

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
      ? `/bookings/${editTarget.id}/available-rooms?checkOutDate=${bookingForm.checkOutDate}${canEditCheckIn ? `&checkInDate=${bookingForm.checkInDate}` : ''}`
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
            : { ...f, roomId: '', switchableCharges: [], discountAmount: '', discountPercent: '', discountSource: '' }
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
    // Typing a discount fires a quote per keystroke, so a slower earlier
    // reply must not land on top of a newer one and show a total for an
    // amount that is no longer in the box.
    let current = true;
    apiGet(
      `/bookings/price-quote?roomId=${bookingForm.roomId}&checkInDate=${bookingForm.checkInDate}&checkOutDate=${bookingForm.checkOutDate}${chargeIds ? `&chargeIds=${chargeIds}` : ''}${rateParam(bookingForm.basePriceOverride)}${discount}`,
      { token }
    )
      .then((data) => {
        if (!current) return;
        setQuote(data);
        // A full payment follows the total it was promised against: the rows
        // are rebuilt the moment the total moves, here rather than in an effect
        // watching the quote, for the same reason the discount is below.
        setBookingForm((f) =>
          f.collectFull ? withAdvanceLines(f, fullPaymentLines(f.advanceLines, data.totalPrice)) : f
        );
        // Adding an extra moves the stay total without clearing the discount,
        // so whichever box is derived has to be redrawn against the new total —
        // otherwise "10%" stays pinned to the rupee figure of the old one, or a
        // fixed ₹100 goes on claiming a share it no longer is.
        //
        // Done here rather than in an effect watching the quote, because this is
        // the moment the total actually changes. grossTotal is the figure BEFORE
        // anything is knocked off, so re-deriving from it cannot feed back into
        // the request that produced it.
        if (bookingForm.discountSource === 'PERCENT') {
          const pct = usableNumber(bookingForm.discountPercent, 100);
          if (pct === null) return;
          const next = amountFromPercent(pct, data.grossTotal);
          setBookingForm((f) => (f.discountAmount === next ? f : { ...f, discountAmount: next }));
        } else if (bookingForm.discountSource === 'AMOUNT') {
          const amount = usableNumber(bookingForm.discountAmount, Number.MAX_SAFE_INTEGER);
          if (amount === null) return;
          const next = percentFromAmount(amount, data.grossTotal);
          setBookingForm((f) => (f.discountPercent === next ? f : { ...f, discountPercent: next }));
        }
      })
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
    bookingForm.basePriceOverride,
    bookingForm.discountAmount,
    bookingForm.discountPercent,
    bookingForm.discountSource,
  ]);

  const selectedRoom = availableRooms?.find((r) => String(r.id) === bookingForm.roomId);
  const numGuests = bookingForm.adults.length + bookingForm.children.length;
  const overOccupancy = Boolean(selectedRoom?.maxOccupancy && numGuests > selectedRoom.maxOccupancy);

  // Whether each numbered section has what it needs. The numbers were already
  // there, but a marker that looks the same full or empty only says where you
  // are in the list — not what is left to do. A desk taking a booking over the
  // phone reads these to know whether it can hang up.
  //
  // "Done" is deliberately each section's own minimum, not the form's: 3 and 4
  // are genuinely optional, so they tick as soon as they hold anything and
  // never nag when left alone.
  const stepDone = {
    1: Boolean(bookingForm.checkInDate && bookingForm.checkOutDate && bookingForm.roomId),
    2: Boolean(bookingForm.adults[0]?.name?.trim()) && !overOccupancy,
    3: bookingForm.collectFull || String(bookingForm.advanceAmount ?? '').trim() !== '',
    4: bookingForm.vehicles.length > 0,
  };

  const toggleCharge = (chargeId) => {
    setChargeTotals((t) => {
      const next = { ...t };
      delete next[chargeId];
      return next;
    });
    setBookingForm((f) => ({ ...f, switchableCharges: toggleSelection(f.switchableCharges, chargeId) }));
  };

  const setChargeQuantity = (chargeId, quantity) => {
    setBookingForm((f) => ({ ...f, switchableCharges: withQuantity(f.switchableCharges, chargeId, quantity) }));
  };

  // What the desk typed into an extras line, keyed by charge. Held separately
  // from the quote because every keystroke refetches it, and a box that
  // reformatted itself mid-number would be unusable. Cleared when the extra is
  // switched off, so it cannot outlive the line it belongs to.
  const [chargeTotals, setChargeTotals] = useState({});

  // The same for the room line. Held apart from the quote for the same reason
  // the extras are: every keystroke refetches it, and a box that reformatted
  // itself mid-number would be unusable. null means untouched — show whatever
  // the quote says.
  const [baseTotal, setBaseTotal] = useState(null);

  // The line shows the room across the whole stay, so the nightly rate is the
  // typed total divided by the nights. Divided by nights alone — seasons and
  // extras are their own lines and are not in this figure, so the division is
  // exact rather than an apportionment.
  const setRoomTotal = (value) => {
    setBaseTotal(value);
    const nights = Math.max(1, quote?.nights?.length || 1);
    const total = Number(value);
    setBookingForm((f) => ({
      ...f,
      basePriceOverride:
        String(value).trim() === '' || !Number.isFinite(total) || total <= 0
          ? ''
          : String(Math.round((total / nights) * 100) / 100),
    }));
  };

  // The line shows the extra across the whole stay, so the per-night unit price
  // is the typed total divided by how many of them for how many nights. Sent as
  // agreedAmount because that is what the booking stores — a total is a view of it,
  // not a second way to price.
  const setChargeTotal = (charge, value) => {
    setChargeTotals((t) => ({ ...t, [charge.chargeId]: value }));

    // Divided by nights alone — never by the count. The agreed figure is what
    // the whole line costs, so three beds at an agreed ₹100 is ₹100, not three
    // times ₹33.33. Dividing by the count is what put ₹1,399.99 on a stay the
    // desk had agreed at ₹1,400.
    const nights = quote?.nights?.length || 1;
    const per = Math.max(1, nights);

    const total = Number(value);
    setChargeAgreed(
      charge.chargeId,
      String(value).trim() === '' || !Number.isFinite(total) || total < 0
        ? ''
        : String(Math.round((total / per) * 100) / 100)
    );
  };

  const setChargeAgreed = (chargeId, agreedAmount) => {
    setBookingForm((f) => ({
      ...f,
      switchableCharges: withAgreedAmount(f.switchableCharges, chargeId, agreedAmount),
    }));
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
      failOn('discountAmount', 'Enter a discount of 0 or more, or leave it blank for no discount.');
      return;
    }
    if (quote && Number(bookingForm.discountAmount || 0) > quote.grossTotal) {
      failOn(
        'discountAmount',
        `The discount can’t be more than the stay total of ${formatPrice(quote.grossTotal)}.`
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
    if (!isMobile(primary.phone)) {
      failOn('newAdultPhone-0', MOBILE_MESSAGE);
      return;
    }
    // Everyone else may leave it blank, but not half-filled — a number that is
    // nearly right is worse than none, because it looks reachable.
    const badPhone = bookingForm.adults.findIndex(
      (g, i) => i > 0 && g.phone.trim() !== '' && !isMobile(g.phone)
    );
    if (badPhone !== -1) {
      failOn(`newAdultPhone-${badPhone}`, MOBILE_MESSAGE);
      return;
    }
    // ID proof is optional on a pre-reservation — a desk with no scanner and a
    // guest whose card is still in the car can hold the room now and have the
    // proof added at check-in, which is where it is asked for.
    //
    // A walk-in has no such later: saving one checks the guest in on the spot,
    // and check-in is exactly what can't happen without an ID proof on record.
    // So it is asked for here, against the same rule the server applies — a
    // type, plus a number or a document to back it, since a type on its own
    // records that the dropdown was opened and not that a card was seen.
    //
    // Skipped when the primary guest was picked from the typeahead with a
    // document already on file: the server carries that one onto the booking,
    // which satisfies its own check.
    const primaryGuest = bookingForm.adults[0];
    const walkInNeedsId =
      !editing && bookingForm.bookingType === 'WALK_IN' && !primaryGuest.fromBookingId;
    //
    // Said in a few words each, because these sit under one field of a
    // five-across row: a sentence explaining *why* the walk-in wants an ID
    // wraps to six lines in a column that narrow and pushes the row apart.
    // The reason is already on the labels, which carry the mark and read
    // "required, or document".
    if (walkInNeedsId && !primaryGuest.idProofType) {
      failOn('newAdultIdProofType-0', 'Choose an ID type.');
      return;
    }
    if (walkInNeedsId && !primaryGuest.idProofFile && !primaryGuest.idProofNumber.trim()) {
      failOn('newAdultIdProofNumber-0', 'Enter the ID number, or upload the document.');
      return;
    }
    const hasAdvanceAmount = bookingForm.advanceAmount.trim() !== '';
    // A full payment has to be the whole stay — the rows are built to add up to
    // it, so the only way they don't is when the earlier rows of a split pass
    // the total and the remainder has nothing left to hold.
    if (bookingForm.collectFull && quote) {
      if (bookingForm.advanceLines.some((line) => !(Number(line.amount) > 0))) {
        failOn(
          paymentFieldId('newBookingAdvance', 'Amount'),
          `The payments add up to more than the stay total of ${formatPrice(quote.totalPrice)} — reduce one of the earlier rows.`
        );
        return;
      }
      if (Math.abs(sumLines(bookingForm.advanceLines) - quote.totalPrice) > 0.005) {
        failOn(
          paymentFieldId('newBookingAdvance', 'Amount'),
          `A full payment must equal the stay total of ${formatPrice(quote.totalPrice)}.`
        );
        return;
      }
    }
    // An advance is a part-payment of the stay, so it cannot exceed it. Said
    // here as well as on the server because the figure it is measured against
    // is already on screen — the desk should be told while looking at both
    // numbers, not after a round trip.
    //
    // Against quote.totalPrice, the payable figure, rather than the gross: a
    // stay discounted to ₹900 cannot take ₹1,000 up front.
    if (hasAdvanceAmount && quote && Number(bookingForm.advanceAmount) > quote.totalPrice) {
      failOn(
        paymentFieldId('newBookingAdvance', 'Amount'),
        `An advance can’t be more than the stay total of ${formatPrice(quote.totalPrice)}.`
      );
      return;
    }
    if (hasAdvanceAmount && !bookingForm.advancePaymentMethod) {
      failOn(paymentFieldId('newBookingAdvance', 'Method'), 'Choose a payment method for the advance amount.');
      return;
    }
    if (hasAdvanceAmount && bookingForm.advanceLines.length > 1) {
      const problem = paymentLinesError(bookingForm.advanceLines);
      if (problem) {
        failOn(paymentFieldId('newBookingAdvance', 'Amount'), problem);
        return;
      }
    }
    // No check on the advance's transaction number: it is filed when the desk
    // has it and left blank when it doesn't.
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
      if (primary.idProofNumber.trim()) formData.append('idProofNumber', primary.idProofNumber.trim());
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
            ...(g.idProofNumber?.trim() ? { idProofNumber: g.idProofNumber.trim() } : {}),
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
        formData.append('basePriceOverride', bookingForm.basePriceOverride);
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
          // Only while the stay hasn't started. Sent even when unchanged, which
          // the backend reads as "no change" — it only refuses a date that
          // actually differs from the one on file.
          if (canEditCheckIn) formData.append('checkInDate', bookingForm.checkInDate);
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
        if (bookingForm.basePriceOverride !== '') {
          formData.append('basePriceOverride', bookingForm.basePriceOverride);
        }
        if (bookingForm.discountAmount !== '') {
          formData.append('discountAmount', String(Number(bookingForm.discountAmount)));
        }
        if (hasAdvanceAmount) {
          formData.append('advanceAmount', String(Number(bookingForm.advanceAmount)));
          formData.append('advancePaymentMethod', bookingForm.advancePaymentMethod);
          const reference = advanceReferenceOf(bookingForm);
          if (reference) formData.append('advanceReference', reference);
          if (bookingForm.advanceLines.length > 1) {
            formData.append(
              'advanceLines',
              JSON.stringify(toPaymentLines(bookingForm.advanceLines))
            );
          }
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

        setJustBooked({
          id: created.id,
          guestName: bookingForm.adults[0]?.name?.trim() || 'Guest',
          roomNumber: selectedRoom?.roomNumber ?? null,
          advanceAmount: Number(bookingForm.advanceAmount) || 0,
          advanceMethod: bookingForm.advancePaymentMethod || null,
          // So the confirmation can say what the desk just did in its own
          // words: a full payment is not "an advance taken".
          paidInFull: bookingForm.collectFull,
        });
      }

      setFormMode(null);
      setEditTarget(null);
      setDraftId(null);
      setDraftNote('');
      // Booked, so the chart with its confirmation is the right place to
      // stay — but the way back is spent, not carried onto the next form.
      cameFromRegister.current = false;
      loadTapeChart();
    } catch (err) {
      reportFormError(
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
  // The booking that has just been saved, held only long enough to say so and
  // to offer the receipt for whatever was paid against it. Read off the form
  // rather than the response, because the reset below is about to wipe the form
  // and the two agree on everything this needs.
  const [justBooked, setJustBooked] = useState(null);
  const [showAdvanceReceipt, setShowAdvanceReceipt] = useState(false);
  const [advanceReceipts, setAdvanceReceipts] = useState([]);
  const [detailError, setDetailError] = useState('');
  const [showCheckInForm, setShowCheckInForm] = useState(false);
  // The settlement step a cancellation goes through: null until "Cancel
  // booking" is pressed, then the answers being typed — how much of the
  // advance goes back, and why the stay fell through. What is not refunded is
  // kept as the cancellation charge, and the reports count it as income.
  const [cancelSettle, setCancelSettle] = useState(null);
  // Which settlement boxes the complaints are about, said under the boxes
  // themselves — { refundAmount?: message, refundMethod?: message }, checked
  // together so two empty boxes are told off in one press rather than one per
  // press. The banner stays for errors that aren't any one field's fault (the
  // server refusing).
  const [cancelFieldErrors, setCancelFieldErrors] = useState(null);
  const initialCheckInForm = {
    advanceAmount: '',
    advanceLines: [emptyPaymentLine()],
    advancePaymentMethod: '',
    advanceReference: '',
    idProofType: '',
    idProofNumber: '',
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
    // Comes back down, unlike the document: staff have to be able to see and
    // correct a digit they mistyped, and a number is not the sensitive artefact
    // the scan of the card is.
    idProofNumber: guest.idProofNumber ?? '',
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
      // The agreed price is only prefilled when it differs from the lodge's,
      // so an extra nobody haggled over reopens with an empty box — and stays
      // on the lodge price if that price later changes.
      switchableCharges: bookingDetail.switchableCharges.map((c) => ({
        id: c.id,
        quantity: String(c.quantity ?? 1),
        // Only set when reception actually agreed a figure, so an extra
        // nobody haggled over reopens with an empty box and stays on the lodge
        // price even if that price has changed since.
        agreedAmount: c.agreedAmount != null ? String(c.agreedAmount) : '',
      })),
      // Blank here means nothing was ever knocked off this stay, and clearing
      // the box is how a concession gets taken back.
      discountAmount: bookingDetail.discountAmount ? String(bookingDetail.discountAmount) : '',
      // Only the amount is stored, so an edit opens with the amount driving
      // and the percent derived from it once the first quote lands.
      discountPercent: '',
      discountSource: bookingDetail.discountAmount ? 'AMOUNT' : '',
      // adults[0] is the primary guest, who lives on the booking itself rather
      // than in the guests table — so no id, and saving them writes back to
      // guestName/guestPhone/idProofType. Everyone else is a row.
      adults: [
        {
          id: undefined,
          name: bookingDetail.guestName,
          phone: bookingDetail.guestPhone,
          idProofType: bookingDetail.idProofType ?? '',
          idProofNumber: bookingDetail.idProofNumber ?? '',
          idProofFile: null,
          hasDocument: bookingDetail.hasIdProofDocument,
        },
        ...bookingDetail.guests.filter((g) => !g.isChild).map(partyRowOf),
      ],
      children: bookingDetail.guests.filter((g) => g.isChild).map(partyRowOf),
      vehicles: bookingDetail.vehicles.map((v) => ({ number: v.number, type: v.type ?? '' })),
      basePriceOverride:
        bookingDetail.basePriceOverride != null ? String(bookingDetail.basePriceOverride) : '',
      advanceAmount: bookingDetail.advanceAmount != null ? String(bookingDetail.advanceAmount) : '',
      advanceLines: [
        {
          method: bookingDetail.advancePaymentMethod ?? '',
          amount: '',
          reference: bookingDetail.advanceReference ?? '',
        },
      ],
      advancePaymentMethod: bookingDetail.advancePaymentMethod ?? '',
      advanceReference: bookingDetail.advanceReference ?? '',
      // An edit SETS the advance rather than adding to it, and receipts only
      // the difference; "collect the whole stay" is a booking-time choice.
      collectFull: false,
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
    setCancelSettle(null);
    setActionError('');
    setIdProofError('');
    setShowAdvanceReceipt(false);
    setAdvanceReceipts([]);
    setJustBooked(null);
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
  // Opens the receipt for a stay the desk is not currently looking at — the
  // one just created. Selecting it is what loads the booking and its existing
  // receipts; the modal renders once that lands, which is a beat later.
  const openAdvanceReceiptFor = (bookingId) => {
    setJustBooked(null);
    setSelectedBookingId(bookingId);
    setShowAdvanceReceipt(true);
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
    // The transaction number is not checked for: it is filed when the desk has
    // it and left blank when it doesn't.
    if (hasAmount && checkInForm.advanceLines.length > 1) {
      const problem = paymentLinesError(checkInForm.advanceLines);
      if (problem) {
        setActionError(problem);
        return;
      }
    }
    if (hasAmount && !checkInForm.advancePaymentMethod) {
      setActionError('Choose a payment method for the advance amount.');
      return;
    }
    if (needsIdProofAtCheckIn && !checkInForm.idProofType) {
      setActionError('Choose the ID proof type.');
      return;
    }
    // Either identifies the guest, the same as at booking — and the same as
    // the server's own guard, which this was quietly stricter than: a desk with
    // the card in hand and no scanner could not complete a check-in at all.
    if (needsIdProofAtCheckIn && !checkInForm.idProofFile && !checkInForm.idProofNumber.trim()) {
      setActionError('Upload the guest’s ID proof, or enter the ID number.');
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
        if (checkInForm.advanceLines.length > 1) {
          formData.append(
            'advanceLines',
            JSON.stringify(toPaymentLines(checkInForm.advanceLines))
          );
        }
      }
      if (checkInForm.idProofType) formData.append('idProofType', checkInForm.idProofType);
      if (checkInForm.idProofNumber.trim()) formData.append('idProofNumber', checkInForm.idProofNumber.trim());
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
            ...(g.idProofNumber?.trim() ? { idProofNumber: g.idProofNumber.trim() } : {}),
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

      // Everything this screen was showing goes, and the bill takes its place.
      //
      // Keeping the stay panel open behind the bill was the mistake: two modals
      // stacked, the one underneath describing a stay that had already ended.
      // The desk is not going back to it — the stay is over and the next act is
      // taking the money — so it closes rather than waiting behind.
      //
      // Both cleared in the same handler, so React commits them together and
      // the bill appears in the frame the panel leaves: one dialog giving way
      // to the next rather than a second one landing on top.
      setLateCheckout(null);
      setSelectedBookingId(null);
      loadTapeChart();
      onBillStay?.(billed);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not check out this guest.');
    } finally {
      setActionSubmitting(false);
    }
  };

  // Step one of cancelling: not the cancellation itself, but the settlement
  // question it has to answer first. Opens with the whole advance offered
  // back — keeping any of it is a decision the desk makes by typing a smaller
  // figure, never a default it forgets to change.
  // Both boxes open empty on purpose: the refund and its tender are answers
  // the desk gives, not defaults it forgets to change — and the submit guard
  // refuses to move until both are given.
  const openCancelSettle = () => {
    setActionError('');
    setCancelFieldErrors(null);
    setCancelSettle({
      refundAmount: '',
      refundMethod: '',
      // The other shape of the settlement, for a stay that held no advance:
      // a fee collected from the guest on the spot. Off until the desk says
      // otherwise — not charging is the common case.
      collectCharge: false,
      chargeAmount: '',
      chargeMethod: '',
      reason: '',
    });
  };

  const handleCancel = async () => {
    const advance = Number(bookingDetail?.advanceAmount) || 0;
    const body = {};
    if (cancelSettle?.reason.trim()) body.reason = cancelSettle.reason.trim();
    if (advance > 0) {
      const refund = Number(cancelSettle?.refundAmount);
      const errs = {};
      // Said under the box each is about, so the words stay short — the label
      // above the box already names the thing being asked for.
      if (cancelSettle?.refundAmount.trim() === '' || !Number.isFinite(refund) || refund < 0) {
        errs.refundAmount = 'Enter an amount.';
      } else if (refund > advance) {
        errs.refundAmount = `Up to ${formatPrice(advance)}.`;
      }
      // The tender is only demanded when money is actually moving — and when
      // the amount box hasn't answered yet, an untyped amount may still turn
      // out to be 0, so the type is asked for alongside rather than skipped.
      if (!cancelSettle?.refundMethod && (errs.refundAmount ? true : refund > 0)) {
        errs.refundMethod = 'Choose a type.';
      }
      if (Object.keys(errs).length > 0) {
        setCancelFieldErrors(errs);
        return;
      }
      body.refundAmount = refund;
      if (refund > 0) body.refundPaymentMethod = cancelSettle.refundMethod;
    } else if (cancelSettle?.collectCharge) {
      // No advance held, and the desk is taking a fee on the spot: money in,
      // so both boxes have to answer — an unticked box would have skipped the
      // question entirely.
      const total = Number(bookingDetail?.totalPrice) || 0;
      const amount = Number(cancelSettle.chargeAmount);
      const errs = {};
      if (cancelSettle.chargeAmount.trim() === '' || !Number.isFinite(amount) || amount <= 0) {
        errs.chargeAmount = 'Enter an amount.';
      } else if (total > 0 && amount > total) {
        errs.chargeAmount = `Up to ${formatPrice(total)}.`;
      }
      if (!cancelSettle.chargeMethod) {
        errs.chargeMethod = 'Choose a type.';
      }
      if (Object.keys(errs).length > 0) {
        setCancelFieldErrors(errs);
        return;
      }
      body.cancellationCharge = amount;
      body.cancellationChargePaymentMethod = cancelSettle.chargeMethod;
    }
    setCancelFieldErrors(null);
    setActionError('');
    setActionSubmitting(true);
    try {
      await apiPatch(`/bookings/${selectedBookingId}/cancel`, body, { token });
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
    // The card is roughly this tall at its longest — a stay with a name, a
    // category, a date range and a hint line. Flipping is decided against the
    // real height rather than a round number: the threshold used to be a flat
    // 150px, which is shorter than the card itself, so a tile in the first
    // category cleared the test, opened upward, and covered the toolbar and
    // the category heading above it instead of being cut off by the window.
    const CARD_H = 132;
    // Room above the tile for the card plus its 8px offset? Then it hangs up
    // there. Otherwise it drops below, where the chart scrolls away under it.
    const below = rect.top < CARD_H + 16;
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
  const renderMonthDividers = () =>
    monthEdges.map((col) => (
      <span key={col} className="tape-month__divider" style={{ '--tape-edge-col': col }} />
    ));

  const renderDateHead = () => (
    <>
      {/* The month these columns are the days of. Named on every category's own
          calendar, so a card scrolled to halfway down the page still says which
          month its day numbers belong to without a look back at the stepper. */}
      <div className="tape-month__band">
        <div className="tape-month__band-corner" />
        {monthRuns(dates).map((run, i) => (
          <div
            key={run.key}
            // Alternating, so two months side by side are told apart at a
            // glance rather than by reading both captions.
            className={`tape-month__band-month${i % 2 ? ' tape-month__band-month--alt' : ''}`}
            style={{ gridColumn: `span ${run.days}` }}
          >
            {/* Both ends the same date: formatMonthBand collapses a range that
                starts and finishes in one month to that month's name. */}
            <span>{formatMonthBand(run.first, run.first)}</span>
          </div>
        ))}
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
        {renderMonthDividers()}
      </div>
    </>
  );

  const renderRoomRow = (room) => {
    const byDate = occupancy.get(String(room.id));
    const draftsByDate = draftOccupancy.get(String(room.id));
    const cancelledByDate = cancelledOccupancy.get(String(room.id));
    const rowClasses = ['tape-month__row'];
    if (hoverTile?.room.id === room.id) rowClasses.push('tape-month__row--active');

    // How many nights of the found stay are on screen in this row. The ping is
    // one ring round the whole stay rather than one per night, so the tile it
    // is drawn on has to know how far to stretch it. Counted from the dates
    // actually visible: a stay can start before the window or run past its end,
    // and the ring has to close on what is on the chart.
    //
    // The first visible night is tracked alongside the count, because it is not
    // always the stay's check-in: a booking that began before this window has
    // no check-in column on screen, and hanging the ring off a tile that is not
    // rendered would draw nothing at all.
    const activeNights =
      activeHit && activeHit.roomId === room.id
        ? dates.filter((d) => byDate?.get(d)?.id === activeHit.bookingId)
        : [];
    const activeSpan = activeNights.length;
    const activeFrom = activeNights[0] ?? null;

    return (
      <div key={room.id} className={rowClasses.join(' ')}>
        <div className="tape-month__room">
          <strong>{room.roomNumber}</strong>
          {room.floor != null && <span>Floor {room.floor}</span>}
        </div>
        {dates.map((d) => {
          const booking = byDate?.get(d);
          const draft = draftsByDate?.get(d);
          // A stay that was cancelled for this night. Whatever else the tile
          // is — vacant, drafted on, or let again — it gets the cancelled
          // border on top, and the hover card says whose booking fell through.
          const cancelledStay = cancelledByDate?.get(d);
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
            // if (cancelledStay) classes.push('tape-tile--cancelled-mark');
            return (
              <button
                key={d}
                type="button"
                className={classes.join(' ')}
                onClick={() => openDraftById(draft.id)}
                onMouseEnter={(e) => showTileHover(e, { room, date: d, booking: null, draft, cancelled: cancelledStay })}
                onFocus={(e) => showTileHover(e, { room, date: d, booking: null, draft, cancelled: cancelledStay })}
                onMouseLeave={() => setHoverTile(null)}
                onBlur={() => setHoverTile(null)}
                aria-label={`${room.roomNumber} has a draft booking on ${formatDateLong(d)}`}
              />
            );
          }

          // A vacant night is a plain grey slot that starts a booking for that
          // room and date.
          if (!booking) {
            const classes = ['tape-tile', 'tape-tile--vacant'];
            if (isWeekend(d)) classes.push('tape-tile--weekend');
            if (past) classes.push('tape-tile--past');
            if (d === today) classes.push('tape-tile--today');
            // if (cancelledStay) classes.push('tape-tile--cancelled-mark');
            return (
              <button
                key={d}
                type="button"
                className={classes.join(' ')}
                onClick={() => openNewBooking(room.id, d)}
                onMouseEnter={(e) => showTileHover(e, { room, date: d, booking: null, cancelled: cancelledStay })}
                onFocus={(e) => showTileHover(e, { room, date: d, booking: null, cancelled: cancelledStay })}
                onMouseLeave={() => setHoverTile(null)}
                onBlur={() => setHoverTile(null)}
                aria-label={
                  cancelledStay
                    ? `${room.roomNumber} vacant on ${formatDateLong(d)} — a booking here was cancelled`
                    : `${room.roomNumber} vacant on ${formatDateLong(d)}`
                }
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
              : booking.status === 'CHECKED_IN' && booking.checkOutDate <= today
                ? today
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
          // A night let again after an earlier booking fell through on it. The
          // live stay keeps its fill; the cancellation rides as the border.
          // if (cancelledStay) classes.push('tape-tile--cancelled-mark');
          // A stay the search found. Every night of it is marked, so the whole
          // strip lights up rather than one tile of it — the desk is looking
          // for a guest, and the answer to "where are they?" is the stay, not
          // the night the search happened to land on.
          if (hitIds.has(booking.id)) {
            classes.push('tape-tile--hit');
            // And the one the arrows are parked on gets a stronger mark, so
            // stepping through twelve matches is visible as movement.
            if (activeHit?.bookingId === booking.id) {
              classes.push('tape-tile--hit-active');
              // The tile the ring is hung off: the stay's first night on
              // screen, which is its check-in only when that falls inside the
              // window being shown.
              if (d === activeFrom) classes.push('tape-tile--hit-anchor');
            }
            // The single tile scrollIntoView is aimed at. Only the hit's first
            // visible night carries it — scrolling to a strip that runs off
            // both edges of the window has to pick an end, and its start is
            // where the desk reads the stay from.
            if (
              activeHit?.bookingId === booking.id &&
              activeHit.date === d &&
              activeHit.roomId === room.id
            ) {
              classes.push('tape-tile--hit-current');
            }
          }
          return (
            <button
              key={d}
              type="button"
              className={classes.join(' ')}
              // Only the stay's first visible night carries it — that tile is
              // where the ring is anchored, and the rest have nothing to
              // stretch.
              style={d === activeFrom ? { '--tape-hit-span': activeSpan } : undefined}
              onClick={() => openDetail(booking.id)}
              onMouseEnter={(e) => showTileHover(e, { room, date: d, booking, draft, past, cancelled: cancelledStay })}
              onFocus={(e) => showTileHover(e, { room, date: d, booking, draft, past, cancelled: cancelledStay })}
              onMouseLeave={() => setHoverTile(null)}
              onBlur={() => setHoverTile(null)}
              aria-label={`${room.roomNumber} ${STATUS_LABEL[booking.status]} on ${formatDateLong(d)}`}
            />
          );
        })}
        {renderMonthDividers()}
      </div>
    );
  };

  return (
    <div className="bookings-panel">
      {/* One sticky strip carrying everything above the chart.

          It was three stacked rows — a toolbar, a search bar, a legend — each
          sparse across its own line, which cost about a hundred and seventy
          pixels of chrome before the first room and pushed the chart itself off
          the bottom of the screen. They are folded into two: the month stepper,
          the search field and the actions share the top line, and the legend
          shares the second with whatever the search has found. Nothing was
          dropped to do it; the empty middle of each row is what paid for it.

          Sticky because of what stepping through results does — it scrolls the
          page to a room that may be forty rows down, and a stepper that
          travelled with the page would be off screen the instant it did its
          job. Sticking the whole strip rather than the search alone also keeps
          the legend and the month readable against a chart scrolled far from
          its header. */}
      <div ref={stickySentinel} aria-hidden="true" />
      <div
        className={`tape-controls${searchStuck ? ' tape-controls--stuck' : ''}`}
      >
      <div className="bookings-panel__toolbar">
        <div className="tape-nav">
          {/* One control, not three loose buttons: arrows flank the month they
              move, so the whole thing reads as a single month stepper. */}
          <div className="tape-nav__stepper">
            <button
              type="button"
              className="tape-nav__arrow"
              aria-label="Previous 30 days"
              onClick={() => stepWindow(-1)}
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
              aria-label="Next 30 days"
              onClick={() => stepWindow(1)}
            >
              ›
            </button>
          </div>
        </div>

        {/* The status chips share the top row with the month stepper: the
            colour legend for the chart belongs beside the control that moves
            through it. Wrapped in one container so they wrap and space as a
            group rather than each chip being its own child of the toolbar. */}
        <div className="bookings-panel__toolbar-chips">
          <span className="tape-legend__item">
            <i className="tape-legend__swatch tape-legend__swatch--vacant" />Vacant
          </span>
          {LEGEND_LINKS.map((item) => (
            <button
              key={item.status}
              type="button"
              className="tape-legend__item tape-legend__item--link"
              onClick={() => onShowRegister?.(item.status)}
              title={`Show ${item.label.toLowerCase()} stays in Booking Details`}
            >
              <i className={`tape-legend__swatch tape-legend__swatch--${item.swatch}`} />
              {item.label}
            </button>
          ))}
          {/* Draft lands in the register beside the other three rather than in
              the toolbar's modal. The register carries a Draft cut of its own,
              so following the yellow gets the desk the same kind of page the red
              and the blue do — a filtered list it can search and sort. The modal
              stays where it is, on the toolbar button, for a quick look without
              leaving the chart. */}
          <button
            type="button"
            className="tape-legend__item tape-legend__item--link"
            onClick={() => onShowRegister?.('DRAFT')}
            title="Show drafts in Booking Details"
          >
            <i className="tape-legend__swatch tape-legend__swatch--draft" />Draft
          </button>
        </div>

        <div className="bookings-panel__toolbar-actions">
          {/* Drafts that name a room and dates are on the chart already; this
              is how the rest are reached, and how a desk sees at a glance that
              anything is pending at all.

              Always here, even at zero. It used to appear only once something
              was parked, which made it a control nobody could learn: it was
              absent exactly when a desk had no reason to have met it yet, and
              then arrived unannounced in a toolbar it had never been part of.
              Standing in one place makes it somewhere to go and look. */}
          <button
            type="button"
            className={`bookings-panel__draft-chip${
              drafts.length === 0 ? ' bookings-panel__draft-chip--empty' : ''
            }`}
            onClick={() => setShowDrafts(true)}
          >
            <DraftIcon />
            {drafts.length === 0
              ? 'No Drafts'
              : `${drafts.length} Draft${drafts.length === 1 ? '' : 's'}`}
          </button>
          <button type="button" className="btn-accent" onClick={() => openNewBooking()}>
            + New booking
          </button>
        </div>
      </div>

      {/* Search and the category jumps share the second row: both are ways of
          finding a place on the chart to land, rather than a way of reading
          the colours already on it. */}
      <div className="tape-legend">
        <div className={`tape-search${searchHits.length > 0 ? ' tape-search--found' : ''}`}>
          <div className="tape-search__box">
          <svg
            className="tape-search__icon"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            className="tape-search__input"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            // Enter walks the results, which is what every search box the desk
            // has ever used does. Shift+Enter walks them backwards, and Escape
            // clears — all three without leaving the keyboard, because stepping
            // through a dozen matches is a rhythm and reaching for the mouse
            // between each one breaks it.
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                clearSearch();
                return;
              }
              if (e.key !== 'Enter') return;
              e.preventDefault();
              stepHit(e.shiftKey ? -1 : 1);
            }}
            placeholder="Search guest, bill no, co-guest or ID number"
            aria-label="Search the chart for a guest, bill number, co-guest or ID number"
          />
          {search !== '' && (
            <button
              type="button"
              className="tape-search__clear"
              onClick={clearSearch}
              aria-label="Clear search"
            >
              &times;
            </button>
          )}
        </div>

        {search.trim() !== '' && (
          <div className="tape-search__result" role="status" aria-live="polite">
            {searchHits.length === 0 ? (
              <span className="tape-search__empty">
                No stay matching &ldquo;{search.trim()}&rdquo;
              </span>
            ) : (
              <>
                <span className="tape-search__count">
                  <strong>{Math.min(hitIndex, searchHits.length - 1) + 1}</strong>
                  <span className="tape-search__count-sep">/</span>
                  {searchHits.length}
                </span>

                <span className="tape-search__who">
                  <strong>{activeHit?.booking.guestName}</strong>
                  {activeHit && (
                    <>
                      <span className="tape-search__where">
                        Room {activeHit.roomNumber} ·{' '}
                        {formatDateLong(activeHit.booking.checkInDate)}
                      </span>
                      {(activeHit.booking.guestPhone || activeHit.booking.idProofNumber) && (
                        <span className="tape-search__ids">
                          {activeHit.booking.guestPhone && (
                            <span className="tape-search__id">
                              <PhoneIcon />
                              {activeHit.booking.guestPhone}
                            </span>
                          )}
                          {activeHit.booking.idProofNumber && (
                            <span className="tape-search__id">
                              <IdIcon />
                              {activeHit.booking.idProofNumber}
                            </span>
                          )}
                        </span>
                      )}
                    </>
                  )}
                </span>

                <div className="tape-search__stepper">
                  <button
                    type="button"
                    className="tape-search__arrow"
                    onClick={() => stepHit(-1)}
                    disabled={searchHits.length < 2}
                    aria-label="Previous match"
                    title="Previous match (Shift+Enter)"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="tape-search__arrow"
                    onClick={() => stepHit(1)}
                    disabled={searchHits.length < 2}
                    aria-label="Next match"
                    title="Next match (Enter)"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        </div>

        {/* One chip per grade of room, in the same shape as the legend's, so the
            strip reads as one row of ways into the chart: the status chips cut it
            by colour, these jump it by category.

            Only worth showing when there is somewhere to jump to — with a single
            category the chip would scroll to the card already filling the screen.
            The sold figure rides along because it is the number the desk opens
            this screen for, and it saves them the trip to read it. */}
        {!tapeError && categorySections.length > 1 && (
          <div className="tape-cats" role="tablist" aria-label="Jump to a room category">
            {categorySections.map((section) => {
              const stats = categoryStats.get(section.categoryName);
              const active = activeCategory === section.categoryName;
              return (
                <button
                  key={section.categoryName}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`tape-cats__chip${active ? ' tape-cats__chip--active' : ''}`}
                  onClick={() => jumpToCategory(section.categoryName)}
                  title={`Jump to ${section.categoryName} · ${section.rooms.length} room${
                    section.rooms.length === 1 ? '' : 's'
                  }`}
                >
                  {section.categoryName}
                  <span className="tape-cats__count">{section.rooms.length}</span>
                  {stats && <span className="tape-cats__sold">{stats.percent}%</span>}
                </button>
              );
            })}
          </div>
        )}

        <span className="tape-legend__hint">Hover any tile to see the guest · click to open</span>
      </div>
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
              <section
                key={section.categoryName}
                className="tape-month-card"
                // Named on the node so the observer can say which card came
                // into view without closing over the list it was built from.
                data-category={section.categoryName}
                ref={(el) => {
                  if (el) sectionRefs.current.set(section.categoryName, el);
                  else sectionRefs.current.delete(section.categoryName);
                }}
              >
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
                <div
                  className="tape-chart-scroll"
                  // Registered so the other cards can be moved with this one.
                  // The cleanup is what keeps dead nodes out of the set when a
                  // category stops being rendered.
                  ref={(el) => {
                    if (!el) return undefined;
                    scrollers.current.add(el);
                    return () => scrollers.current.delete(el);
                  }}
                  onScroll={onChartScroll}
                  onWheel={onChartWheel}
                >
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
              {/* The night was let again after an earlier booking fell
                  through on it — that is what the red border on the tile is. */}
              {/* {hoverTile.cancelled && (
                <span className="tape-tooltip__hint tape-tooltip__hint--cancelled">
                  {hoverTile.cancelled.guestName}’s booking for this night was cancelled.
                </span>
              )} */}
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
              {/* {hoverTile.cancelled && (
                <span className="tape-tooltip__hint tape-tooltip__hint--cancelled">
                  {hoverTile.cancelled.guestName}’s booking for this night was cancelled.
                </span>
              )} */}
            </>
          ) : false && hoverTile.cancelled ? (
            <>
              {/* An empty night with a red border: the story is the booking
                  that fell through, so the card leads with it — while the
                  hint keeps saying what the empty tile still offers. */}
              <span className="tape-tooltip__top">
                <span className="tape-tooltip__dot tape-tooltip__dot--cancelled" />
                Booking cancelled
              </span>
              <strong>{hoverTile.cancelled.guestName}</strong>
              <span className="tape-tooltip__meta">
                Room {hoverTile.room.roomNumber} · {hoverTile.room.categoryName}
              </span>
              <span className="tape-tooltip__dates">
                {formatDateLong(hoverTile.cancelled.checkInDate)}
                <i>→</i>
                {formatDateLong(hoverTile.cancelled.checkOutDate)}
              </span>
              <span className="tape-tooltip__hint">
                {hoverTile.past
                  ? 'This night has passed — it can’t be booked'
                  : 'The night is back on sale — click to book it'}
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

            {/* Reachable from an always-present chip now, so this is the first
                thing a desk that has never parked a form will read. It says how
                one is made rather than only that there are none. */}
            {drafts.length === 0 && (
              <div className="dash-state">
                Nothing parked right now. “Save draft” on a half-filled booking form puts it here.
              </div>
            )}

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
                    <IconButton
                      label={`Open draft for ${d.guestName || 'unnamed guest'}`}
                      icon={<OpenIcon />}
                      onClick={() => openDraft(d)}
                    />
                    <IconButton
                      label={`Delete draft for ${d.guestName || 'unnamed guest'}`}
                      icon={<ActionTrashIcon />}
                      tone="danger"
                      onClick={() => deleteDraft(d.id)}
                      disabled={submitting}
                    />
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
                      ? canEditCheckIn
                        ? `${editTarget.guestName}’s booking, as it stands. Editable until the bill is issued — re-date it, move rooms, correct the party or fix a detail.`
                        : `${editTarget.guestName}’s stay, as it stands. Editable until the bill is issued — extend it, move rooms, correct the party or fix a detail.`
                      : `${editTarget.guestName}’s stay has already checked out, so the room and dates are fixed. Everything else can still be corrected before billing.`
                    : isFutureCheckIn
                      ? 'Walk-in isn’t available for a future check-in date — this holds the room for a guest arriving later.'
                      : bookingForm.bookingType === 'WALK_IN'
                        ? 'Guest is here now — creates the booking and checks them in immediately.'
                        : 'Holds the room for a guest arriving later. ID proof can be added at check-in.'}
                </p>
              </div>

              <div className="booking-form__body">
                {formError && (
                  <div ref={formErrorRef} className="form-banner form-banner--error form-banner--flash">
                    {formError}
                  </div>
                )}

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
                    <StepNum n={1} done={stepDone[1]} />Stay &amp; room
                  </div>
                  <div className="field-row">
                  <div className="field">
                    <label htmlFor="checkInDate">
                      Check-in<Req />
                    </label>
                    <input
                      id="checkInDate"
                      type="date"
                      value={bookingForm.checkInDate}
                      // Today is the floor: a past night cannot be sold, and a
                      // new or moved booking cannot be backdated onto one
                      // either — the date has already gone.
                      // Editable on a reservation that hasn't been checked in
                      // yet — moving a booked stay to different dates is an
                      // ordinary correction. Fixed once the guest has arrived:
                      // by then the day they did is a recorded fact.
                      min={today}
                      disabled={!canEditCheckIn}
                      aria-invalid={invalid('checkInDate')}
                      onChange={(e) => {
                        const checkInDate = e.target.value;
                        setBookingForm((f) => ({
                          ...f,
                          checkInDate,
                          // Dragging the arrival past the departure would leave
                          // the form in a state it can't be saved from, and the
                          // rooms and the quote would both stop loading until
                          // the second box was fixed by hand. Carrying the
                          // check-out along keeps the stay the same length,
                          // which is what moving a booking usually means.
                          checkOutDate:
                            checkInDate && f.checkOutDate && f.checkOutDate <= checkInDate
                              ? addDays(checkInDate, Math.max(1, daysBetween(f.checkInDate, f.checkOutDate)))
                              : f.checkOutDate,
                          // A future date can only be a reservation; today can
                          // only be a walk-in. An edit is neither: the stay
                          // already exists, and its type is not something this
                          // box gets to rewrite.
                          bookingType: editing
                            ? f.bookingType
                            : checkInDate > today
                              ? 'RESERVATION'
                              : checkInDate === today
                                ? 'WALK_IN'
                                : f.bookingType,
                        }));
                      }}
                    />
                    {fieldErr('checkInDate')}
                  </div>
                  <div className="field">
                    <label htmlFor="checkOutDate">
                      Check-out<Req />
                    </label>
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
                    {!canEditStay
                      ? 'The guest has checked out, so the dates and the room are settled.'
                      : canEditCheckIn
                        ? 'Moving either date re-prices the stay and re-checks the room for those nights.'
                        : 'The guest has checked in, so check-in is fixed — changing when a stay started is a cancel and rebook, not an edit.'}
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
                      <label htmlFor="roomId">
                        Available rooms<Req />
                      </label>
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
                            discountPercent: '',
                            discountSource: '',
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
                      {/* One chip, not one per bed: the row already carries
                          rate, category, bathroom and occupancy, and a family
                          room added three more chips that pushed the rest onto
                          a second line. Falls back to the legacy single value
                          for rooms saved before beds existed, as the server does. */}
                      {bedSummary(selectedRoom) && (
                        <span className="booking-form__chip">{bedSummary(selectedRoom)}</span>
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
                    The discount is settled at the end of the form, against
                    this figure. */}
                {quote && (
                  <div className="sim-result">
                    {/* Said once, in words, above the boxes. The pencil inside
                        each box marks which figures are editable; this is what
                        tells a new receptionist that any of them are, without
                        waiting for a hover that never happens on a touchscreen. */}
                    <p className="sim-result__hint">
                      Amounts in boxes can be changed — tap to edit
                    </p>
                    {quote.charges.map((charge, i) => (
                      <div className="sim-result__line" key={i}>
                        <span>
                          {charge.label}
                          {quote.nights.length > 1 ? ` (${quote.nights.length} nights)` : ''}
                        </span>
                        {/* Editable where the money is read, because reception
                            negotiates a total ("call it 350") far more often
                            than a per-night rate. The room line takes the same
                            box: the rate it names is the one the stay is priced
                            at, and a stay sold at a rate nobody can type is a
                            stay argued about at the desk.

                            A season uplift stays fixed — it is a percentage of
                            the rate above it, so it follows on its own. */}
                        {charge.isBase ? (
                          <EditableAmount
                            label={charge.label}
                            value={baseTotal ?? String(charge.amount)}
                            onChange={setRoomTotal}
                          />
                        ) : charge.chargeId ? (
                          <EditableAmount
                            label={charge.label}
                            value={chargeTotals[charge.chargeId] ?? String(charge.amount)}
                            onChange={(v) => setChargeTotal(charge, v)}
                          />
                        ) : (
                          <span>{formatPrice(charge.amount)}</span>
                        )}
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
                    <StepNum n={2} done={stepDone[2]} />Guest details
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
                    idPrefix="new"
                    onAdd={addParty}
                    onRemove={removeParty}
                    onUpdate={updateParty}
                    // Looking a guest up is for taking a booking. This same
                    // form edits existing stays, where the primary guest is
                    // settled — swapping them for someone else is a cancel and
                    // rebook, so no suggestions there.
                    guestLookupToken={editing ? null : token}
                    // A walk-in is checked in the moment it is saved, and no
                    // stay can be checked in without an ID proof on record —
                    // so here these fields are required, and the labels have
                    // to say so rather than reading "optional" and then
                    // failing at the server. A pre-reservation defers the
                    // whole of it to check-in, which asks for it there.
                    idRequired={!editing && bookingForm.bookingType === 'WALK_IN'}
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
                  <StepNum n={3} done={stepDone[3]} />
                  {bookingForm.collectFull ? 'Payment' : 'Advance payment'}
                  {bookingForm.collectFull ? (
                    <span className="form-section__badge form-section__badge--full">
                      Paid in full · {formatPrice(Number(bookingForm.advanceAmount) || 0)}
                    </span>
                  ) : (
                    bookingForm.advanceAmount.trim() !== '' && (
                      <span className="form-section__badge">{formatPrice(Number(bookingForm.advanceAmount))}</span>
                    )
                  )}
                </summary>
                {/* One click for the guest who settles the whole stay on the
                    spot. It fills the rows to the live total and keeps them
                    there as the dates, extras and discount move; how the money
                    arrived is still the desk's to say, split or not. Not on an
                    edit, which sets an advance rather than taking one. */}
                {!editing && (
                  <label
                    className="checkbox-chip booking-form__full-pay"
                    title={quote ? undefined : 'Choose a room and dates first — the stay total is what this collects.'}
                  >
                    <input
                      type="checkbox"
                      checked={bookingForm.collectFull}
                      disabled={!quote}
                      onChange={(e) => setCollectFull(e.target.checked)}
                    />
                    <span>
                      Collect full payment now
                      {quote ? (
                        <span className="bookings-panel__muted"> · {formatPrice(quote.totalPrice)}</span>
                      ) : (
                        <span className="bookings-panel__muted"> · choose a room and dates first</span>
                      )}
                    </span>
                  </label>
                )}
                {/* maxLines 1 on an edit, which hides the add button and
                    leaves the field exactly as it was. An edit SETS the advance
                    rather than adding to it, so only the difference is
                    receipted — and a list of lines describing the whole figure
                    cannot describe that difference. Splits are taken on the way
                    in, or from the receipt modal afterwards. */}
                {/* No separate Amount box: the advance is however much these
                    rows add up to. maxLines 1 on an edit hides the add button,
                    because an edit SETS the advance rather than adding to it and
                    only the difference is receipted — a list describing the whole
                    figure cannot describe that difference. */}
                <PaymentLines
                  lines={bookingForm.advanceLines}
                  onChange={onBookingAdvanceLines}
                  idPrefix="newBookingAdvance"
                  maxLines={editing ? 1 : 5}
                  lockedTotal={bookingForm.collectFull && quote ? quote.totalPrice : null}
                  error={
                    <>
                      {fieldErr(paymentFieldId('newBookingAdvance', 'Amount'))}
                      {fieldErr(paymentFieldId('newBookingAdvance', 'Method'))}
                      {fieldErr(paymentFieldId('newBookingAdvance', 'Reference'))}
                    </>
                  }
                />
              </details>

              <details className="form-section form-section--collapsible" open>
                <summary>
                  <StepNum n={4} done={stepDone[4]} />
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

              {/* The discount section used to sit here, last on the form. It is
                  hidden for now — the state, the quote plumbing and the submit
                  path all still handle a discount, so an existing discounted
                  booking still opens and saves correctly; a new booking simply
                  never sets one. */}

              </div>

              {/* Total and actions pinned below the scroll area. The itemised
                  breakdown still lives up in the form, but the figure being
                  charged has to stay visible while filling in guest details —
                  otherwise you commit to a price you can no longer see. */}
              <div className="booking-form__foot">
                <div className="booking-form__total">
                  {quote ? (
                    <>
                      {/* What the figure is for, not just how many nights it
                          covers. The room and the party are the two things the
                          desk reads back down a phone line, and scrolling up to
                          find them while quoting a price is the moment a
                          booking gets taken wrong. */}
                      <span className="booking-form__total-label">
                        {quote.nights.length} night{quote.nights.length === 1 ? '' : 's'}
                        {selectedRoom ? ` · Room ${selectedRoom.roomNumber}` : ''}
                        {` · ${numGuests} guest${numGuests === 1 ? '' : 's'}`}
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

      {/* Stood down while the late-checkout question is on screen. That is a
          step of this same job, not a separate dialog, and stacking the two put
          a panel describing the stay behind a panel asking what to charge for
          it. Cancelling the question brings this straight back. */}
      {selectedBookingId && !lateCheckout && (
        <div
          // Dismissable by backdrop while it is only being read, but not once
          // the check-in form or the cancellation settlement is open on top of
          // it — both have typed-in details of their own and their own way
          // back.
          className="glass-backdrop bookings-panel__backdrop"
          onClick={showCheckInForm || cancelSettle ? undefined : closeDetail}
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
                {bookingDetail.status === 'BOOKED' && !showCheckInForm && !canCheckInNow && (
                  <p className="bookings-panel__hint">
                    Reserved for {formatDateLong(bookingDetail.checkInDate)} — check-in opens on that date.
                  </p>
                )}

                {bookingDetail.status === 'BOOKED' && showCheckInForm && (
                  <form onSubmit={handleCheckIn} className="form-section">
                    {needsIdProofAtCheckIn && (
                      <>
                        <div className="form-section__title">Guest ID proof</div>
                        <p className="bookings-panel__hint">
                          Wasn&apos;t collected when this room was reserved — required before check-in.
                          Choose a type, then give either the number or the document.
                        </p>
                        <div className="field-row">
                          <div className="field">
                            <label htmlFor="checkInIdProofType">
                              ID proof type<Req />
                            </label>
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
                            {/* Unmarked, like its pair below: the check stops
                                on the two being empty together, not on either
                                one, and a mark on each reads as both wanted.
                                The line above says which it is. */}
                            <label htmlFor="checkInIdProofNumber">ID number</label>
                            <input
                              id="checkInIdProofNumber"
                              value={checkInForm.idProofNumber}
                              onChange={(e) =>
                                setCheckInForm((f) => ({ ...f, idProofNumber: e.target.value }))
                              }
                            />
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
                    <PaymentLines
                      lines={checkInForm.advanceLines}
                      onChange={setAdvanceLines(setCheckInForm)}
                      idPrefix="checkInAdvance"
                    />

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
                              <label htmlFor={`checkInGuestName-${index}`}>
                                Name<Req />
                              </label>
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
                                onChange={(e) => updateCheckInGuest(index, { phone: typedMobile(e.target.value) })}
                                type="tel"
                                inputMode="numeric"
                                autoComplete="tel"
                                maxLength={10}
                                placeholder="10-digit mobile"
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
                              <label htmlFor={`checkInGuestIdProofNumber-${index}`}>
                                ID number (optional)
                              </label>
                              <input
                                id={`checkInGuestIdProofNumber-${index}`}
                                value={guest.idProofNumber}
                                onChange={(e) => updateCheckInGuest(index, { idProofNumber: e.target.value })}
                              />
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
                            <IconButton
                              label={`Remove guest ${index + 1}`}
                              icon={<ActionTrashIcon />}
                              tone="danger"
                              onClick={() => removeCheckInGuest(index)}
                            />
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
                            <IconButton
                              label={`Remove vehicle ${index + 1}`}
                              icon={<ActionTrashIcon />}
                              tone="danger"
                              onClick={() => removeCheckInVehicle(index)}
                            />
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

                {/* One row for everything the desk can do to this stay.
                    These were three stacked rows — the advance receipt on its
                    own line, the state actions on the next, and Close below a
                    rule of its own — which read as three unrelated groups and
                    took three lines to say what fits on one.

                    Ordered left to right by how far each takes the stay:
                    reversing it, then correcting it, then moving it on. Close
                    is last because leaving is not one of them.

                    Hidden behind the check-in form, which has its own Back. */}
                {/* The settlement a cancellation has to answer first: where the
                    advance goes. In place of the footer actions, the way the
                    check-in form is — one question on screen at a time. */}
                {!showCheckInForm && cancelSettle && (
                  <div className="bookings-panel__cancel-settle">
                    <div className="form-section__title">Cancel this booking</div>
                    {Number(bookingDetail.advanceAmount) > 0 ? (
                      <>
                        <p className="bookings-panel__hint">
                          Settle the advance before the booking goes: what goes back to the guest, and what
                          the property keeps as the cancellation charge.
                        </p>
                        {/* The settlement as a statement: what was taken, what
                            goes back, what stays — footed like the tariff is,
                            with the refund typed straight into its own row so
                            the arithmetic updates where it is read. */}
                        <div className="bookings-panel__cancel-settle-sheet">
                          <div className="bookings-panel__cancel-settle-row">
                            <span>
                              Advance taken
                              {/* Only when a method was recorded — "· " against
                                  nothing is a separator with no second half. */}
                              {(bookingDetail.advancePaymentLines?.length ||
                                bookingDetail.advancePaymentMethod) && (
                                <span className="bookings-panel__muted">
                                  {' · '}
                                  {describeAdvance(
                                    bookingDetail.advancePaymentLines,
                                    bookingDetail.advancePaymentMethod
                                  )}
                                </span>
                              )}
                            </span>
                            <span>{formatPrice(bookingDetail.advanceAmount)}</span>
                          </div>
                          <div className="bookings-panel__cancel-settle-row">
                            <span>Refund to guest</span>
                            <span className="bookings-panel__cancel-settle-refund">
                              {/* Each box under its own small label, and both
                                  deliberately blank: the tender and the amount
                                  are the desk's answers, not defaults. The
                                  tender only means anything against a refund
                                  that moves money — at zero it is ignored on
                                  save. */}
                              <span className="bookings-panel__cancel-settle-ctl">
                                <label htmlFor="cancel-refund-method">Payment type</label>
                                <select
                                  id="cancel-refund-method"
                                  value={cancelSettle.refundMethod}
                                  aria-invalid={cancelFieldErrors?.refundMethod ? true : undefined}
                                  onChange={(e) => {
                                    setCancelFieldErrors((errs) => {
                                      if (!errs?.refundMethod) return errs;
                                      const { refundMethod, ...rest } = errs;
                                      return Object.keys(rest).length ? rest : null;
                                    });
                                    setCancelSettle((f) => ({ ...f, refundMethod: e.target.value }));
                                  }}
                                >
                                  <option value="">Choose type</option>
                                  {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  ))}
                                </select>
                                {cancelFieldErrors?.refundMethod && (
                                  <span className="field__error bookings-panel__cancel-settle-ctl-error">
                                    {cancelFieldErrors.refundMethod}
                                  </span>
                                )}
                              </span>
                              <span className="bookings-panel__cancel-settle-minus" aria-hidden="true">
                                −
                              </span>
                              <span className="bookings-panel__cancel-settle-ctl">
                                <label htmlFor="cancel-refund-amount">Amount</label>
                                <input
                                  id="cancel-refund-amount"
                                  type="number"
                                  min="0"
                                  max={bookingDetail.advanceAmount}
                                  step="0.01"
                                  placeholder="0"
                                  value={cancelSettle.refundAmount}
                                  aria-invalid={cancelFieldErrors?.refundAmount ? true : undefined}
                                  onChange={(e) => {
                                    setCancelFieldErrors((errs) => {
                                      if (!errs?.refundAmount) return errs;
                                      const { refundAmount, ...rest } = errs;
                                      return Object.keys(rest).length ? rest : null;
                                    });
                                    setCancelSettle((f) => ({ ...f, refundAmount: e.target.value }));
                                  }}
                                  aria-describedby="cancel-settle-kept"
                                  autoFocus
                                />
                                {cancelFieldErrors?.refundAmount && (
                                  <span className="field__error bookings-panel__cancel-settle-ctl-error">
                                    {cancelFieldErrors.refundAmount}
                                  </span>
                                )}
                              </span>
                            </span>
                          </div>
                          <div
                            className="bookings-panel__cancel-settle-row bookings-panel__cancel-settle-row--total"
                            id="cancel-settle-kept"
                          >
                            <span>Kept as cancellation charge</span>
                            <span>
                              {/* Unanswered until the refund is typed: a blank
                                  box is not a refund of zero, and footing it as
                                  one would show the whole advance kept before
                                  the desk has said anything. */}
                              {cancelSettle.refundAmount.trim() === ''
                                ? '—'
                                : formatPrice(
                                    Math.max(
                                      0,
                                      (Number(bookingDetail.advanceAmount) || 0) -
                                        (Number(cancelSettle.refundAmount) || 0)
                                    )
                                  )}
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="bookings-panel__hint">
                          No advance was taken on this stay. The booking can be cancelled as it is, or a
                          cancellation charge collected from the guest now.
                        </p>
                        <label className="bookings-panel__cancel-settle-collect">
                          <input
                            type="checkbox"
                            checked={cancelSettle.collectCharge}
                            onChange={(e) => {
                              setCancelFieldErrors(null);
                              setCancelSettle((f) => ({ ...f, collectCharge: e.target.checked }));
                            }}
                          />
                          Collect a cancellation charge
                        </label>
                        {cancelSettle.collectCharge && (
                          <div className="bookings-panel__cancel-settle-sheet">
                            <div className="bookings-panel__cancel-settle-row">
                              <span>Cancellation charge</span>
                              <span className="bookings-panel__cancel-settle-refund">
                                <span className="bookings-panel__cancel-settle-ctl">
                                  <label htmlFor="cancel-charge-method">Payment type</label>
                                  <select
                                    id="cancel-charge-method"
                                    value={cancelSettle.chargeMethod}
                                    aria-invalid={cancelFieldErrors?.chargeMethod ? true : undefined}
                                    onChange={(e) => {
                                      setCancelFieldErrors((errs) => {
                                        if (!errs?.chargeMethod) return errs;
                                        const { chargeMethod, ...rest } = errs;
                                        return Object.keys(rest).length ? rest : null;
                                      });
                                      setCancelSettle((f) => ({ ...f, chargeMethod: e.target.value }));
                                    }}
                                  >
                                    <option value="">Choose type</option>
                                    {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => (
                                      <option key={value} value={value}>
                                        {label}
                                      </option>
                                    ))}
                                  </select>
                                  {cancelFieldErrors?.chargeMethod && (
                                    <span className="field__error bookings-panel__cancel-settle-ctl-error">
                                      {cancelFieldErrors.chargeMethod}
                                    </span>
                                  )}
                                </span>
                                <span className="bookings-panel__cancel-settle-ctl">
                                  <label htmlFor="cancel-charge-amount">Amount</label>
                                  <input
                                    id="cancel-charge-amount"
                                    type="number"
                                    min="0"
                                    max={bookingDetail.totalPrice}
                                    step="0.01"
                                    placeholder="0"
                                    value={cancelSettle.chargeAmount}
                                    aria-invalid={cancelFieldErrors?.chargeAmount ? true : undefined}
                                    onChange={(e) => {
                                      setCancelFieldErrors((errs) => {
                                        if (!errs?.chargeAmount) return errs;
                                        const { chargeAmount, ...rest } = errs;
                                        return Object.keys(rest).length ? rest : null;
                                      });
                                      setCancelSettle((f) => ({ ...f, chargeAmount: e.target.value }));
                                    }}
                                    autoFocus
                                  />
                                  {cancelFieldErrors?.chargeAmount && (
                                    <span className="field__error bookings-panel__cancel-settle-ctl-error">
                                      {cancelFieldErrors.chargeAmount}
                                    </span>
                                  )}
                                </span>
                              </span>
                            </div>
                            <div className="bookings-panel__cancel-settle-row bookings-panel__cancel-settle-row--total">
                              <span>Collected as cancellation charge</span>
                              <span>
                                {cancelSettle.chargeAmount.trim() === ''
                                  ? '—'
                                  : formatPrice(Math.max(0, Number(cancelSettle.chargeAmount) || 0))}
                              </span>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    <div className="bookings-panel__cancel-settle-fields">
                      <label htmlFor="cancel-reason">Reason (optional)</label>
                      <input
                        id="cancel-reason"
                        value={cancelSettle.reason}
                        maxLength={200}
                        placeholder="Guest called off the trip"
                        onChange={(e) => setCancelSettle((f) => ({ ...f, reason: e.target.value }))}
                      />
                    </div>
                    <div className="bookings-panel__actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setActionError('');
                          setCancelFieldErrors(null);
                          setCancelSettle(null);
                        }}
                        disabled={actionSubmitting}
                      >
                        Keep the booking
                      </button>
                      <button
                        type="button"
                        className="confirm-dialog__danger"
                        onClick={handleCancel}
                        disabled={actionSubmitting}
                      >
                        {actionSubmitting ? 'Cancelling…' : 'Cancel booking'}
                      </button>
                    </div>
                  </div>
                )}

                {!showCheckInForm && !cancelSettle && (
                  <div className="bookings-panel__actions bookings-panel__actions--footer">
                    {bookingDetail.status === 'BOOKED' && (
                      <button
                        type="button"
                        className="bookings-panel__danger-link"
                        onClick={openCancelSettle}
                        disabled={actionSubmitting}
                      >
                        Cancel booking
                      </button>
                    )}

                    {/* An advance can be taken while a stay is reserved or in
                        house. Not once it is billed or cancelled: the invoice
                        already accounts for every advance, and a cancelled
                        booking has no stay to hold money against. */}
                    {bookingDetail.status !== 'CANCELLED' && bookingDetail.status !== 'CHECKED_OUT' && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setShowAdvanceReceipt(true)}
                        disabled={actionSubmitting}
                      >
                        Advance receipt
                        {advanceReceipts.length > 0 && ` (${advanceReceipts.length})`}
                      </button>
                    )}

                    {bookingDetail.status === 'CHECKED_OUT' && !canEditBooking && (
                      <span className="bookings-panel__hint">This stay has been billed — extras are locked.</span>
                    )}

                    {canEditBooking && bookingDetail.status !== 'CANCELLED' && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={openEditBooking}
                        disabled={actionSubmitting}
                      >
                        Edit booking
                      </button>
                    )}

                    {bookingDetail.status === 'BOOKED' && (
                      <button
                        type="button"
                        className="btn-accent"
                        // Deliberately NOT disabled on a future stay. A disabled
                        // button answers a click with nothing at all: reception
                        // pressed Check in, the form did not open, and the
                        // screen said nothing about why. The title only appears
                        // on hover, which a touch screen never does — and
                        // browsers suppress tooltips on disabled controls
                        // anyway.
                        //
                        // So the click is allowed through and refused out loud.
                        // The server refuses it too, with the same rule; this is
                        // the half that reaches the desk without a round trip.
                        onClick={() => {
                          if (!canCheckInNow) {
                            setActionError(
                              `This stay is reserved for ${formatDateLong(bookingDetail.checkInDate)} — check-in opens on that date.`
                            );
                            return;
                          }
                          setActionError('');
                          setShowCheckInForm(true);
                        }}
                        disabled={actionSubmitting}
                        title={canCheckInNow ? undefined : 'Check-in opens on the reserved date.'}
                      >
                        Check in
                      </button>
                    )}

                    {bookingDetail.status === 'CHECKED_IN' && (
                      <button
                        type="button"
                        className="btn-accent"
                        onClick={openCheckOut}
                        disabled={actionSubmitting}
                      >
                        {actionSubmitting ? 'Checking out…' : 'Check out'}
                      </button>
                    )}

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
          // A further advance changes both the receipt list and the booking's
          // own figure, and the panel behind this modal shows the second. Both
          // are re-read so the desk does not close this and find the old number
          // still sitting under "Advance payment".
          onTaken={(receipt) => {
            setAdvanceReceipts((list) => [receipt, ...list]);
            apiGet(`/bookings/${selectedBookingId}`, { token })
              .then((data) => setBookingDetail(data.booking))
              .catch(() => {});
            loadTapeChart();
          }}
        />
      )}

      {/* Said the moment the booking exists, rather than leaving the desk to
          infer it from the chart redrawing. It carries the one thing that has
          to happen next when money changed hands: the receipt for it. Reception
          used to have to find the stay again and open it from the detail panel,
          with a guest waiting for a slip. */}
      {justBooked && (
        <div className="glass-backdrop bookings-panel__backdrop" onClick={() => setJustBooked(null)}>
          <div
            className="glass-panel bookings-panel__modal booking-saved"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bookingSavedTitle"
            onClick={(e) => e.stopPropagation()}
          >
            {/* The crest: a tick that draws itself over a curve, in the app's
                own navy rather than the celebratory green this pattern usually
                arrives in — a booking is routine work, and a screen that cheers
                every time gets tuned out by the third one of the morning.
                aria-hidden because the heading below already says it saved;
                a screen reader reading "tick, wave" adds nothing. */}
            <div className="booking-saved__crest" aria-hidden="true">
              <svg className="booking-saved__wave" viewBox="0 0 320 64" preserveAspectRatio="none">
                <path d="M0,30 C58,60 116,6 176,22 C236,38 288,54 320,28 L320,64 L0,64 Z" />
              </svg>
              <span className="booking-saved__badge">
                <svg viewBox="0 0 32 32" fill="none">
                  <path
                    className="booking-saved__tick"
                    d="M9.5 16.5 L14 21 L22.5 11.5"
                    stroke="currentColor"
                    strokeWidth="2.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </div>

            <h3 id="bookingSavedTitle">Booking saved</h3>
            <p className="booking-saved__lead">
              <strong>{justBooked.guestName}</strong>
              {justBooked.roomNumber ? ` is booked into room ${justBooked.roomNumber}.` : ' is booked.'}
            </p>

            {justBooked.advanceAmount > 0 ? (
              <p className="booking-saved__advance">
                {justBooked.paidInFull ? 'Full payment of' : 'Advance of'}{' '}
                <strong>{formatPrice(justBooked.advanceAmount)}</strong>
                {justBooked.advanceMethod ? ` by ${justBooked.advanceMethod.toLowerCase()}` : ''} taken — its
                receipt has been issued automatically.
              </p>
            ) : (
              <p className="bookings-panel__hint">No advance was taken, so there is nothing to receipt yet.</p>
            )}

            <div className="bookings-panel__actions">
              {justBooked.advanceAmount > 0 && (
                <button type="button" className="btn-accent" onClick={() => openAdvanceReceiptFor(justBooked.id)}>
                  Print advance receipt
                </button>
              )}
              <button type="button" className="btn-secondary" onClick={() => setJustBooked(null)}>
                Done
              </button>
            </div>
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
  EXTRA_NIGHTS: 'extra night',
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
// One editable figure on the price breakdown. Reception negotiates a total
// ("call it 350") far more often than a per-night rate, so these have always
// been typeable — but they sat in a column of read-only figures styled to
// match them, and a box that looks like the number beside it reads as a
// number, not as a field. Nobody at a desk clicks a total to find out.
//
// The pencil is what says otherwise, and it is a real button rather than a
// drawn-on mark: anything that looks pressable and isn't teaches the desk that
// the picture lies, which costs more than the hint was worth. Pressing it does
// what pressing it looks like it should — puts the cursor in the figure with
// the old value selected, so the new one types straight over it.
function EditableAmount({ label, value, onChange }) {
  const inputRef = useRef(null);

  const startEditing = () => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  };

  return (
    <span className="amount-edit">
      <input
        ref={inputRef}
        className="sim-result__amount-input"
        type="number"
        min="0"
        step="1"
        inputMode="decimal"
        aria-label={`Total for ${label} — editable`}
        onFocus={(e) => e.target.select()}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {/* Inside the well at its trailing edge, after the figure in the markup
          as well as on the screen — the money is what the row is about and it
          keeps the reading position; the mark is what stepped aside for it.

          tabIndex -1 keeps it out of the tab order: it focuses the very input
          beside it, so leaving it in would mean tabbing through the form
          stopped twice on every rate for no gain. */}
      <button
        type="button"
        className="amount-edit__pencil"
        onClick={startEditing}
        tabIndex={-1}
        aria-hidden="true"
        title={`Change the total for ${label}`}
      >
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false">
          <path
            d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </span>
  );
}

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
// Drawn here rather than pulled from public/icons.svg — that sprite is the
// unused Vite starter set (github, discord, bluesky) and has no trash glyph.
// One shape used twice in this file doesn't earn a sprite of its own.
// A form with a pencil on it: a booking begun and not finished, which is what a
// draft is. Same construction as TrashIcon below — 24-box, stroked in
// currentColor so it takes the chip's own ink, and hidden from the reader
// because the label beside it already says "1 draft".
//
// The page's lower edge is deliberately left open, and its lines stop short of
// the pencil: a sheet still being written on rather than a filed document.
const DraftIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {/* The sheet, its corner turned down. */}
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h5" />
    <path d="M14 3l5 5h-5z" />
    {/* Two written lines, kept clear of the pencil's path. */}
    <path d="M8.5 9.5h3M8.5 13h3.5" />
    {/* The pencil, nib down at the open end. */}
    <path d="M20.2 13.3l1.5 1.5-5.2 5.2-2 .5.5-2z" />
  </svg>
);

const TrashIcon = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
  </svg>
);

// Two fields that answer one requirement between them, under a bracket saying
// so. Neither can carry a required mark — the check stops on the pair being
// empty, not on either field — and a caption over both is what a mark cannot
// say: that one of them is enough.
//
// The wrapper is always rendered, caption or not: it is one cell of the row's
// grid, and dropping it would spill two fields into a grid sized for one and
// push the remove button off the end. Without a caption it is a plain pair,
// its bracket suppressed by the modifier class.
function PairedFields({ caption, children }) {
  return (
    <div className={`field-pair${caption ? '' : ' field-pair--bare'}`}>
      {caption && <span className="field-pair__caption">{caption}</span>}
      {children}
    </div>
  );
}

function PartyEditor({
  adults,
  children,
  idPrefix,
  onAdd,
  onRemove,
  onUpdate,
  guestLookupToken,
  // Whether the primary guest's ID proof is being asked for now rather than at
  // check-in. Only the primary guest's: the co-guest rows are what the desk
  // types off whichever cards the party hands over, and check-in has never
  // stopped on those.
  idRequired = false,
  fieldErr,
}) {
  // Adding a row and then having to click into it is two actions for one
  // intention. The new row's name field takes the cursor instead, so the desk
  // carries straight on typing.
  //
  // The id is parked on a ref and acted on after the render that creates the
  // row: at the moment the button is pressed the input does not exist yet, so
  // there is nothing to focus. The effect has no dependency list because it has
  // to run after every render — it is a no-op unless something asked for focus,
  // and it clears the request as it consumes it, so a later unrelated render
  // cannot steal the cursor back.
  const focusAfterAdd = useRef(null);

  useEffect(() => {
    const id = focusAfterAdd.current;
    if (!id) return;
    focusAfterAdd.current = null;
    document.getElementById(id)?.focus();
  });

  const addRow = (kind, blank) => {
    const nextIndex = (kind === 'adults' ? adults : children).length;
    focusAfterAdd.current = `${idPrefix}${kind === 'adults' ? 'Adult' : 'Child'}Name-${nextIndex}`;
    onAdd(kind, blank);
  };

  const idTypeOptions = ID_PROOF_TYPES.map((t) => (
    <option key={t} value={t}>
      {idProofLabel(t)}
    </option>
  ));

  // What is already held for this guest, so an edit doesn't read as though the
  // document were missing and get one uploaded again on top of it.
  const onFile = (person) =>
    person.hasDocument && !person.idProofFile ? (
      <span className="on-file">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M4 12.5 9.5 18 20 6.5" />
        </svg>
        On file
      </span>
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
      </div>
      <div className="bookings-panel__repeat-list">
        {adults.map((adult, index) => {
          const isPrimary = index === 0;
          // A guest picked from the typeahead who already has a document on
          // file carries it onto this booking, so the requirement is met
          // before the desk touches these fields — marking them then would
          // ask for a card that is already on record.
          const needsId = idRequired && isPrimary && !adult.fromBookingId;
          return (
            <div className="bookings-panel__party-row" key={adult.id ?? `new-${index}`}>
              <div className="field">
                {/* Every adult on the booking needs a name — the extra rows are
                    added by the desk, so an empty one is an unfinished row
                    rather than an optional field. */}
                <label htmlFor={`${idPrefix}AdultName-${index}`}>
                  {isPrimary ? 'Name (primary guest)' : 'Name'}
                  <Req />
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
                      onUpdate('adults', index, {
                        name,
                        fromBookingId: null,
                        hasDocument: false,
                        // The number came off the guest who was picked, same as
                        // the document did. Typing a different name over it has
                        // to drop both, or the new guest inherits the old one's
                        // ID.
                        idProofNumber: '',
                      })
                    }
                    onPick={(guest) =>
                      onUpdate('adults', index, {
                        name: guest.name,
                        phone: guest.phone,
                        idProofType: guest.idProofType ?? '',
                        idProofNumber: guest.idProofNumber ?? '',
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
                  {isPrimary && <Req />}
                </label>
                <input
                  id={`${idPrefix}AdultPhone-${index}`}
                  value={adult.phone}
                  onChange={(e) => onUpdate('adults', index, { phone: typedMobile(e.target.value) })}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={10}
                  placeholder="10-digit mobile"
                />
                {fieldErr(`${idPrefix}AdultPhone-${index}`)}
              </div>
              <div className="field">
                <label htmlFor={`${idPrefix}AdultIdProofType-${index}`}>
                  {needsId ? 'ID type' : 'ID type (optional)'}
                  {needsId && <Req />}
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
              {/* Neither of these two carries a required mark, and none is
                  missing. A mark means "the form stops on this field", and the
                  form stops on neither: it stops when *both* are empty. Two
                  marks read as two cards being wanted, and one mark would pick
                  a winner the check doesn't have.

                  So the pair is bracketed instead, under one caption that says
                  what the check actually asks. Wrapped in a cell of their own
                  to hang the caption across both — the row is a grid, and a
                  bracket over two of its columns has nothing else to attach
                  to. The cell divides its own width the way the row's columns
                  did, so the fields keep the widths they had. */}
              <PairedFields caption={needsId ? 'Either one' : null}>
                <div className="field">
                  <label htmlFor={`${idPrefix}AdultIdProofNumber-${index}`}>
                    {needsId ? 'ID number' : 'ID number (optional)'}
                  </label>
                  <input
                    id={`${idPrefix}AdultIdProofNumber-${index}`}
                    value={adult.idProofNumber}
                    onChange={(e) => onUpdate('adults', index, { idProofNumber: e.target.value })}
                  />
                  {fieldErr(`${idPrefix}AdultIdProofNumber-${index}`)}
                </div>
                <div className="field">
                  <label htmlFor={`${idPrefix}AdultIdProofFile-${index}`}>
                    {needsId ? 'Document' : 'Document (optional)'}
                  </label>
                  <input
                    id={`${idPrefix}AdultIdProofFile-${index}`}
                    type="file"
                    accept={ID_PROOF_ACCEPT}
                    onChange={(e) => onUpdate('adults', index, { idProofFile: e.target.files[0] || null })}
                  />
                  {onFile(adult)}
                  {fieldErr(`${idPrefix}AdultIdProofFile-${index}`)}
                </div>
              </PairedFields>
              {/* The primary guest is the booking itself — there's no booking
                  left to remove them from. */}
              {isPrimary ? (
                <span className="bookings-panel__row-spacer" />
              ) : (
                <button
                  type="button"
                  className="bookings-panel__row-remove-btn"
                  onClick={() => onRemove('adults', index)}
                  // The label went when the text did. Without it this is an
                  // unnamed button to a screen reader, and a mystery glyph to
                  // anyone hovering — on a row of six adults, "which one does
                  // this delete" is a question the name has to answer.
                  aria-label={`Remove adult ${index + 1}`}
                  title="Remove this adult"
                >
                  <TrashIcon />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Under the rows rather than up in the heading. The desk fills a row
          and the next thing it wants is another one — with the button above the
          list, adding a fourth adult meant scrolling back past the three
          already filled in. */}
      <div className="booking-form__add-row">
        <button
          type="button"
          className="booking-form__add-inline booking-form__add-below"
          onClick={() => addRow('adults', emptyGuest)}
        >
          + Add adult
        </button>

        {/* Beside the button rather than on a line of its own. The tick on the
            row is what catches the eye; this only adds the part the tick cannot
            say — that the document carries onto this booking — and a whole line
            to itself gave that more weight than it needs. */}
        {adults[0]?.fromBookingId && !adults[0].idProofFile && (
          <p className="bookings-panel__note">
            {idProofLabel(adults[0].idProofType) || 'ID proof'} from this guest’s last stay carries
            over. Attach a file to replace it.
          </p>
        )}
      </div>

      <div className="booking-form__subhead">
        <span className="booking-form__subhead-label">
          Children
          <span className="booking-form__subhead-count">{children.length}</span>
        </span>
      </div>
      {children.length > 0 && (
        <div className="bookings-panel__repeat-list">
          {children.map((child, index) => (
            <div
              className="bookings-panel__party-row bookings-panel__party-row--child"
              key={child.id ?? `new-${index}`}
            >
              <div className="field">
                <label htmlFor={`${idPrefix}ChildName-${index}`}>
                  Name<Req />
                </label>
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
                <label htmlFor={`${idPrefix}ChildIdProofNumber-${index}`}>ID number (optional)</label>
                <input
                  id={`${idPrefix}ChildIdProofNumber-${index}`}
                  value={child.idProofNumber}
                  onChange={(e) => onUpdate('children', index, { idProofNumber: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`${idPrefix}ChildIdProofFile-${index}`}>
                  Document (optional)
                </label>
                <input
                  id={`${idPrefix}ChildIdProofFile-${index}`}
                  type="file"
                  accept={ID_PROOF_ACCEPT}
                  onChange={(e) => onUpdate('children', index, { idProofFile: e.target.files[0] || null })}
                />
                {onFile(child)}
                {fieldErr(`${idPrefix}ChildIdProofFile-${index}`)}
              </div>
              <button
                type="button"
                className="bookings-panel__row-remove-btn"
                onClick={() => onRemove('children', index)}
                aria-label={`Remove child ${index + 1}`}
                title="Remove this child"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="booking-form__add-inline booking-form__add-below"
        onClick={() => addRow('children', emptyChild)}
      >
        + Add child
      </button>
      <p className="bookings-panel__hint">
        {/* The bracket over the two fields says one of them is enough; this
            says which stay is asking and what else it wants alongside — the
            ID type, which does carry a mark of its own. */}
        {idRequired && (
          <>
            <strong>A walk-in is checked in as it saves, so the primary guest needs an ID type, plus
            either the number or the document.</strong>{' '}
          </>
        )}
        Either an ID number or a document identifies a guest — one is enough, both is better.
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
                <IconButton
                  label={`Remove vehicle ${index + 1}`}
                  icon={<ActionTrashIcon />}
                  tone="danger"
                  onClick={() => onRemove(index)}
                />
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
          {lateCheckout.band === 'EXTRA_NIGHTS' ? (
            // A cycle property counts whole nights: booked for N, stayed N+k.
            <span>
              Stayed <strong>{lateCheckout.actualNights}</strong> night
              {lateCheckout.actualNights === 1 ? '' : 's'}, booked for{' '}
              <strong>{lateCheckout.plannedNights}</strong> · {lateCheckout.extraNights} extra ×{' '}
              {formatPrice(lateCheckout.lastNightRate)}
            </span>
          ) : (
            <span>
              {BAND_LABEL[lateCheckout.band] || 'policy rate'} · {lateCheckout.percent}% of{' '}
              {formatPrice(lateCheckout.lastNightRate)}
            </span>
          )}
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
