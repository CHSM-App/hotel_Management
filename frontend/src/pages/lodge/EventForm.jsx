import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { getSession } from '../../lib/auth';
import ConfirmDialog from '../../components/ConfirmDialog';
import QtyStepper from '../../components/QtyStepper';
import { formatPrice } from './priceFormat';
import PaymentLines from './PaymentLines';
import CheckInRoomStatus from './CheckInRoomStatus';
import { emptyPaymentLine, needsPaymentReference, paymentFieldId, paymentLinesError, sumLines, toPaymentLines } from './paymentSplit';
import {
  EVENT_TYPE_LABEL,
  SLOT_HOURS,
  SLOT_LABEL,
  addDays,
  formatEventWhen,
  localToIso,
  toDateKey,
  toTimeValue,
} from './eventFormat';
import './forms.css';
import './Events.css';

const DEBOUNCE_MS = 400;

const capitalizeName = (value) => value.replace(/\b\w/g, (c) => c.toUpperCase());

// What is already on the slot, written out for the dialog. One line per
// function rather than the banner's run-on sentence: the desk is deciding
// against these, and a semicolon-joined list is the thing they were skimming
// past in the first place.
function clashSummary(venue, clashes = []) {
  const what = clashes
    .map((c) => `• “${c.title}” — ${c.organiserName} (${formatEventWhen(c.startAt, c.endAt)})`)
    .join('\n');
  return `${venue?.name || 'This venue'} is already booked at these hours:\n${what}\n\nA draft can still be saved on a taken slot, but it does not hold the date.`;
}

// `required` marks the label with an asterisk. It says what the form will
// refuse to save without, so the desk can see the shape of the minimum before
// they start typing rather than by walking into firstInvalid one field at a
// time. The mark mirrors that check — see firstInvalid — so the two cannot
// drift into saying different things about the same field.
function Field({ label, name, error, children, hint, required = false }) {
  return (
    <div className="field">
      <label htmlFor={`ev-${name}`}>
        {label}
        {required && (
          <span className="field__req">
            <span aria-hidden="true">*</span>
            <span className="field__req-text">required</span>
          </span>
        )}
      </label>
      {children}
      {error && <p className="field__error">{error}</p>}
      {!error && hint && <p className="field__hint">{hint}</p>}
    </div>
  );
}

// The catalogue chip and the one-off row are both carried as one shape, so
// the quote request and the saved event see a single list of add-on lines.
function catalogueLine(addon) {
  return {
    key: `c${addon.id}`,
    addonId: addon.id,
    label: addon.name,
    quantity: 1,
    // Charged per unit (chairs, plates): the only kind that is asked how many.
    isPerUnit: Boolean(addon.isPerUnit),
    unitAmount: addon.defaultAmount,
    // The catalogue's own price, pre-filled as a real value — same as the
    // venue charge defaults to the venue's base charge — not left as a greyed
    // placeholder the desk has to notice and retype.
    agreedAmount: addon.defaultAmount != null ? String(addon.defaultAmount) : '',
    // Tracks whether agreedAmount is still "unit rate × quantity" rather than
    // a figure the desk typed in by hand. While true, the Qty stepper keeps
    // this field in step with the quantity; the moment the desk edits the
    // amount directly it drops to false, and from then on it's a flat
    // negotiated total the backend won't second-guess (see addonLineAmount
    // in eventPricing.js — an agreedAmount, once present, is the whole line).
    autoAmount: true,
    selected: false,
  };
}

// A quantity is asked only where it means something: an add-on charged per
// unit. One saved earlier with more than one keeps its box, so the count that
// was agreed stays visible and editable.
const wantsQty = (line) => Boolean(line.isPerUnit) || Number(line.quantity) > 1;

function initialForm(event, initialDate, venues, initialVenueId = null, prefill = {}) {
  if (event) {
    const start = new Date(event.startAt);
    const end = new Date(event.endAt);
    return {
      eventType: event.eventType,
      title: event.title || '',
      venueId: String(event.venueId || ''),
      slot: event.slot || 'CUSTOM',
      startDate: toDateKey(start),
      startTime: toTimeValue(start),
      endDate: toDateKey(end),
      endTime: toTimeValue(end),
      organiserName: event.organiserName || '',
      organiserPhone: event.organiserPhone || '',
      organiserAltPhone: event.organiserAltPhone || '',
      expectedPax: String(event.expectedPax ?? ''),
      // A saved rate above zero is what "catering" means; there is no flag.
      catering: Number(event.perPlateRate) > 0,
      guaranteedPax: String(event.guaranteedPax ?? ''),
      perPlateRate: Number(event.perPlateRate) > 0 ? String(event.perPlateRate) : '',
      venueCharge: String(event.venueCharge ?? ''),
      roomsRequired: Boolean(event.roomsRequired),
      roomsCount: event.roomsCount != null ? String(event.roomsCount) : '',
      roomsFrom: event.roomsFrom || '',
      roomsTo: event.roomsTo || '',
      roomsNotes: event.roomsNotes || '',
      discountAmount: event.discountAmount ? String(event.discountAmount) : '',
      discountReason: event.discountReason || '',
      menuNotes: event.menuNotes || '',
      setupNotes: event.setupNotes || '',
      scheduleNotes: event.scheduleNotes || '',
    };
  }
  // Started from a venue's row on the diary, that venue; from the plain "New
  // draft" button, none — silently picking one for the desk is how the
  // wrong venue gets booked unnoticed, so the field starts blank and the
  // "Choose a venue" option shows until the desk actually picks one.
  const firstVenue = initialVenueId != null ? venues.find((v) => String(v.id) === String(initialVenueId)) : null;
  const date = initialDate || toDateKey(new Date());
  return {
    // From an enquiry's "Confirm booking" (Events.jsx's prefillEnquiry),
    // this and organiserName/organiserPhone/expectedPax/scheduleNotes below
    // start filled in rather than blank; everything else about a new
    // function still starts exactly as it always did.
    eventType: prefill.eventType || 'BIRTHDAY',
    title: '',
    venueId: firstVenue ? String(firstVenue.id) : '',
    // No slot forced by default — Evening's fixed hours are wrong the moment
    // this is a multi-day function, and the desk can still pick Morning/
    // Evening/Full day for a same-day one with one click below.
    slot: 'CUSTOM',
    startDate: date,
    startTime: SLOT_HOURS.EVENING[0],
    endDate: date,
    endTime: SLOT_HOURS.EVENING[1],
    organiserName: prefill.organiserName || '',
    organiserPhone: prefill.organiserPhone || '',
    organiserAltPhone: '',
    expectedPax: prefill.expectedPax != null ? String(prefill.expectedPax) : '',
    catering: false,
    guaranteedPax: '',
    perPlateRate: '',
    venueCharge: firstVenue ? String(firstVenue.baseCharge ?? '') : '',
    roomsRequired: false,
    roomsCount: '',
    roomsFrom: '',
    roomsTo: '',
    roomsNotes: '',
    discountAmount: '',
    discountReason: '',
    menuNotes: '',
    setupNotes: '',
    // The enquiry's free-text note, if any — the closest existing field to
    // what a guest typed in asking about the function.
    scheduleNotes: prefill.notes || '',
  };
}

// `prefillAddonIds` is from an enquiry's "Confirm booking" (Events.jsx's
// prefillEnquiry) — only meaningful on a brand-new function (an edit always
// has `event` instead, which already carries its own saved selections). The
// catalog here is a flat lodge-wide list, not scoped per-venue the way a
// room's switchable charges are, so — unlike the booking form's extras,
// which can only ever be a reminder — pre-ticking the matching lines is
// safe: nothing about picking a venue resets `lines`.
function initialLines(event, addons, prefillAddonIds = []) {
  const lines = addons.filter((a) => a.isActive || event?.addons?.some((x) => x.addonId === a.id)).map(catalogueLine);
  if (!event) {
    if (prefillAddonIds.length) {
      for (const line of lines) {
        if (prefillAddonIds.includes(line.addonId)) line.selected = true;
      }
    }
    return lines;
  }
  const oneOffs = [];
  for (const saved of event.addons || []) {
    const hit = saved.addonId ? lines.find((l) => l.addonId === saved.addonId) : null;
    if (hit) {
      hit.selected = true;
      hit.quantity = saved.quantity || 1;
      hit.agreedAmount = saved.agreedAmount != null ? String(saved.agreedAmount) : '';
      // If what's saved still equals unit × quantity, the desk never
      // actually overrode the catalogue rate — it's safe to keep following
      // the quantity. If it doesn't match, someone negotiated a flat total
      // for this line, and the Qty stepper must leave that number alone.
      hit.autoAmount =
        hit.unitAmount != null && saved.agreedAmount != null
          ? round2(Number(hit.unitAmount) * hit.quantity) === round2(Number(saved.agreedAmount))
          : false;
    } else {
      oneOffs.push({
        key: `o${saved.id || oneOffs.length}`,
        addonId: null,
        label: saved.label,
        quantity: saved.quantity || 1,
        unitAmount: null,
        // An unpriced extra is stored at 0 as a placeholder; the box stays
        // blank so typing a figure here is what prices it.
        agreedAmount: saved.needsPricing ? '' : String(saved.agreedAmount ?? ''),
        selected: true,
        isExtra: Boolean(saved.isExtra),
        needsPricing: Boolean(saved.needsPricing),
        notedAt: saved.notedAt || null,
      });
    }
  }
  return [...lines, ...oneOffs];
}

function nextDay(dateKey) {
  if (!dateKey) return '';
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return toDateKey(d);
}

function numOrUndef(v) {
  if (v === '' || v == null) return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// A quote line's note: catering already sends its own "pax × rate" string;
// venue hire sends a plain "N days"; an add-on carries the numbers instead
// of pre-built text, so its rate reads through the same ₹ formatter as the
// amount next to it.
function lineNote(line) {
  if (line.numberOfDays > 1 && line.perDayAmount != null) {
    return `${formatPrice(line.perDayAmount)} × ${line.numberOfDays} days`;
  }
  return line.note || null;
}

export default function EventForm({
  event = null,
  initialDate = null,
  initialVenueId = null,
  // From an enquiry's "Confirm booking" (Events.jsx's prefillEnquiry) — see
  // initialForm above for how they seed the new-function form. enquiryId
  // doesn't name a form field at all; it just rides along to save() so the
  // server can link/convert the enquiry in the same transaction as this
  // booking. None of these apply on an edit (`event` set).
  initialOrganiserName = '',
  initialOrganiserPhone = '',
  initialEventType = null,
  initialExpectedPax = null,
  initialNotes = '',
  initialAddonIds = [],
  initialEnquiryId = null,
  venues = [],
  addons = [],
  lodge = null,
  onSaved,
  onClose,
}) {
  const token = getSession()?.token;
  const isEdit = Boolean(event);
  // What this property can sell with a hall. No kitchen means the catering
  // box never appears; no rooms means the rooms box never does.
  const canCater = Boolean(lodge?.servesFood);
  const canRooms = Boolean(lodge?.hasRooms);

  const [form, setForm] = useState(() =>
    initialForm(event, initialDate, venues, initialVenueId, {
      organiserName: initialOrganiserName,
      organiserPhone: initialOrganiserPhone,
      eventType: initialEventType,
      expectedPax: initialExpectedPax,
      notes: initialNotes,
    })
  );
  const [lines, setLines] = useState(() => initialLines(event, addons, initialAddonIds));
  const [oneOff, setOneOff] = useState({ label: '', amount: '' });
  // Money taken with the draft, as the booking form takes a deposit: the
  // advance is whatever the rows add up to. Only on a new function — money
  // against an existing one is taken from its page, where the receipt is.
  const [advanceLines, setAdvanceLines] = useState(() => [emptyPaymentLine()]);
  const advanceAmount = isEdit ? 0 : sumLines(advanceLines);
  const advanceTouched = advanceLines.some((l) => l.method || l.amount !== '' || l.reference);
  // The function was saved but its advance was not: the desk goes on to the
  // function and takes the money there rather than saving a second copy.
  const [savedWithoutAdvance, setSavedWithoutAdvance] = useState(null);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [availability, setAvailability] = useState(null);
  // The venue being taken, raised as a dialog rather than left to the banner at
  // the top of the form. The desk works from the buttons at the bottom of a
  // modal that scrolls, so a message written above the first field is off
  // screen at the moment it matters — the clash was being saved straight past.
  //
  // Two shapes, because the server treats the two cases differently:
  //   'blocked'  — a confirmation was refused (409). Nothing to
  //                decide; the dialog reports it and the desk picks new hours.
  //   'confirm'  — a draft, which is allowed to sit on a taken slot. The
  //                desk is told what it is landing on and says whether to go on.
  const [clash, setClash] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');

  const update = (name, value) => setForm((f) => ({ ...f, [name]: value }));

  const catering = canCater && form.catering;
  const roomsRequired = canRooms && form.roomsRequired;

  // Ticking rooms for the first time proposes the function's own dates: the
  // night of the do, leaving the morning after it ends.
  const toggleRooms = (on) =>
    setForm((f) => ({
      ...f,
      roomsRequired: on,
      roomsFrom: on && !f.roomsFrom ? f.startDate : f.roomsFrom,
      roomsTo: on && !f.roomsTo ? nextDay(f.endDate >= f.startDate ? f.endDate : f.startDate) : f.roomsTo,
    }));

  const startAt = useMemo(() => localToIso(form.startDate, form.startTime), [form.startDate, form.startTime]);
  const endAt = useMemo(() => localToIso(form.endDate, form.endTime), [form.endDate, form.endTime]);

  const venue = venues.find((v) => String(v.id) === form.venueId);

  // Choosing a slot is choosing hours; the end date follows the start unless
  // the desk has been typing a custom range.
  const pickSlot = (slot) => {
    setForm((f) => {
      const next = { ...f, slot };
      if (SLOT_HOURS[slot]) {
        next.startTime = SLOT_HOURS[slot][0];
        next.endTime = SLOT_HOURS[slot][1];
        next.endDate = f.startDate;
      }
      return next;
    });
  };

  const pickVenue = (venueId) => {
    const v = venues.find((x) => String(x.id) === venueId);
    setForm((f) => ({ ...f, venueId, venueCharge: v ? String(v.baseCharge ?? '') : f.venueCharge }));
  };

  // Availability: the diary can hold a DRAFT on a booked slot, but the desk
  // should know before they take a deposit. Debounced because every keystroke
  // in the time box is a new query.
  useEffect(() => {
    if (!form.venueId || !startAt || !endAt) {
      setAvailability(null);
      return undefined;
    }
    const t = setTimeout(() => {
      setAvailability({ checking: true });
      const q = new URLSearchParams({ venueId: form.venueId, startAt, endAt });
      if (event?.id) q.set('excludeId', String(event.id));
      apiGet(`/events/availability?${q}`, { token })
        .then((data) => setAvailability(data))
        .catch(() => setAvailability(null));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [form.venueId, startAt, endAt, event?.id, token]);

  // The head count the venue actually has to seat, worked out here rather than
  // read off the quote: the quote is debounced and comes back from the server,
  // so a form driven by it would let the desk type 500 into a 200-seat hall and
  // see nothing for half a second. Same rule the server prices on — the larger
  // of the expected count and the catering guarantee, and the final figure once
  // there is one.
  const seatedPax = useMemo(() => {
    const counted = event?.finalPax != null ? Number(event.finalPax) : Number(form.expectedPax) || 0;
    const guaranteed = catering ? Number(form.guaranteedPax) || 0 : 0;
    return Math.max(counted, guaranteed);
  }, [event?.finalPax, form.expectedPax, form.guaranteedPax, catering]);

  // A venue with no capacity recorded holds whatever the desk says it holds:
  // an unknown limit is not a limit, and inventing one would block real work.
  const overCapacity = venue?.capacityPax != null && seatedPax > venue.capacityPax ? { venue, pax: seatedPax } : null;

  const addonPayload = useMemo(
    () =>
      lines
        .filter((l) => l.selected)
        .map((l) =>
          l.addonId
            ? { addonId: l.addonId, quantity: Number(l.quantity) || 1, agreedAmount: numOrUndef(l.agreedAmount) }
            : {
                label: l.label,
                quantity: Number(l.quantity) || 1,
                // Blank on an unpriced extra stays "no price yet"; on any other
                // one-off blank is 0, as it always was.
                agreedAmount: l.isExtra && l.agreedAmount === '' ? undefined : Number(l.agreedAmount) || 0,
                isExtra: l.isExtra || undefined,
                needsPricing: l.isExtra && l.agreedAmount === '' ? true : undefined,
                notedAt: l.notedAt || undefined,
              }
        ),
    [lines]
  );

  const quoteBody = useMemo(() => {
    if (!form.venueId || form.expectedPax === '') return null;
    if (catering && form.perPlateRate === '') return null;
    return {
      venueId: Number(form.venueId),
      expectedPax: Number(form.expectedPax),
      guaranteedPax: catering ? (numOrUndef(form.guaranteedPax) ?? Number(form.expectedPax)) : Number(form.expectedPax),
      finalPax: event?.finalPax ?? undefined,
      venueCharge: numOrUndef(form.venueCharge),
      perPlateRate: catering ? Number(form.perPlateRate) : 0,
      addons: addonPayload,
      discountAmount: numOrUndef(form.discountAmount),
      startAt: startAt || undefined,
      endAt: endAt || undefined,
    };
  }, [
    form.venueId,
    form.expectedPax,
    form.guaranteedPax,
    form.venueCharge,
    form.perPlateRate,
    form.discountAmount,
    addonPayload,
    event?.finalPax,
    catering,
    startAt,
    endAt,
  ]);

  const quoteKey = quoteBody ? JSON.stringify(quoteBody) : '';
  useEffect(() => {
    const t = setTimeout(() => {
      if (!quoteBody) {
        setQuote(null);
        return;
      }
      apiPost('/events/quote', quoteBody, { token })
        .then((data) => {
          setQuote(data);
          setQuoteError('');
        })
        .catch((err) => setQuoteError(err.message));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, token]);

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const addOneOff = () => {
    if (!oneOff.label.trim()) return;
    setLines((ls) => [
      ...ls,
      {
        key: `o${Date.now()}`,
        addonId: null,
        label: oneOff.label.trim(),
        quantity: 1,
        unitAmount: null,
        agreedAmount: oneOff.amount,
        selected: true,
      },
    ]);
    setOneOff({ label: '', amount: '' });
  };

  const firstInvalid = () => {
    if (!form.title.trim()) return ['title', 'Give the function a title.'];
    if (!form.venueId) return ['venueId', 'Pick a venue.'];
    if (!startAt || !endAt) return ['startDate', 'Enter the start and end date and time.'];
    if (new Date(endAt) <= new Date(startAt)) return ['endDate', 'The function has to end after it starts.'];
    if (!form.organiserName.trim()) return ['organiserName', 'Who is organising it?'];
    if (!/^[6-9]\d{9}$/.test(form.organiserPhone.trim())) return ['organiserPhone', 'Enter a valid 10-digit mobile number.'];
    if (form.expectedPax === '' || Number(form.expectedPax) <= 0) return ['expectedPax', 'How many guests are expected?'];
    // Over the venue's seating is a real refusal, not a note on the quote: the
    // count goes back to the field that owns it. Which field that is depends on
    // which one pushed the party over, so the desk lands on the number they
    // would have to change.
    if (overCapacity) {
      const field = catering && Number(form.guaranteedPax) > Number(form.expectedPax) ? 'guaranteedPax' : 'expectedPax';
      return [field, `${venue.name} seats ${venue.capacityPax}. Lower the count, or pick a venue that holds ${seatedPax}.`];
    }
    if (catering && !(Number(form.perPlateRate) > 0)) return ['perPlateRate', 'Enter the per-plate rate.'];
    if (roomsRequired) {
      if (!(Number(form.roomsCount) >= 1)) return ['roomsCount', 'How many rooms are needed?'];
      if (!form.roomsFrom) return ['roomsFrom', 'Choose the night the rooms are needed from.'];
      if (!form.roomsTo) return ['roomsTo', 'Choose the morning the rooms are needed until.'];
      if (form.roomsTo <= form.roomsFrom) return ['roomsTo', 'The rooms have to be needed for at least one night.'];
    }
    // A row the desk started is a row the desk meant: an amount without a
    // method, or a UPI payment with no number, is not a deposit yet.
    if (!isEdit && advanceTouched) {
      const problem = paymentLinesError(advanceLines);
      if (problem) {
        const missingMethod = advanceLines.findIndex((l) => !l.method);
        if (missingMethod >= 0) return [paymentFieldId('eventAdvance', 'Method', missingMethod), problem];
        return [paymentFieldId('eventAdvance', 'Amount', Math.max(0, advanceLines.findIndex((l) => !(Number(l.amount) > 0)))), problem];
      }
      if (pricing && advanceAmount > pricing.totalAmount + 0.005) {
        return [paymentFieldId('eventAdvance', 'Amount'), `The advance can’t be more than the quote of ${formatPrice(pricing.totalAmount)}.`];
      }
    }
    return null;
  };

  const focusField = (name) => {
    const el = document.getElementById(`ev-${name}`) || document.getElementById(name);
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  // The banner's own equivalent of focusField, for the one failure left that
  // names no field — a server error the 409 and err.field branches above
  // don't catch. Same reason those two exist: this is the longest form in the
  // app after a booking, and a message left at the top scrolls out of view
  // the moment the desk works down into Catering or Rooms.
  const errorBannerRef = useRef(null);
  const reportError = (message) => {
    setError(message);
    requestAnimationFrame(() => {
      errorBannerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  // `ack` is set once the desk has answered the clash dialog, so the second
  // pass through goes to the server instead of asking again.
  const save = async (status, ack = false) => {
    const invalid = firstInvalid();
    if (invalid) {
      setFieldError({ field: invalid[0], message: invalid[1] });
      setError('');
      focusField(invalid[0]);
      return;
    }

    // A draft is allowed onto a taken slot, so the server will not stop it
    // and the desk has to be the one to decide. Asked before anything is sent,
    // and only when the check has actually come back saying the venue is taken.
    const taken = availability && !availability.checking && !availability.available ? availability.clashes : null;
    if (taken && taken.length > 0 && !ack) {
      setClash({ kind: 'confirm', status, clashes: taken });
      return;
    }

    const body = {
      eventType: form.eventType,
      title: form.title.trim(),
      venueId: Number(form.venueId),
      slot: form.slot,
      startAt,
      endAt,
      organiserName: form.organiserName.trim(),
      organiserPhone: form.organiserPhone.trim(),
      organiserAltPhone: form.organiserAltPhone.trim() || null,
      expectedPax: Number(form.expectedPax),
      guaranteedPax: catering ? (numOrUndef(form.guaranteedPax) ?? Number(form.expectedPax)) : Number(form.expectedPax),
      perPlateRate: catering ? Number(form.perPlateRate) : 0,
      venueCharge: numOrUndef(form.venueCharge),
      addons: addonPayload,
      discountAmount: numOrUndef(form.discountAmount) ?? 0,
      discountReason: form.discountReason.trim() || null,
      menuNotes: catering ? form.menuNotes.trim() || null : null,
      setupNotes: form.setupNotes.trim() || null,
      scheduleNotes: form.scheduleNotes.trim() || null,
      roomsRequired,
      roomsCount: roomsRequired ? Number(form.roomsCount) : null,
      roomsFrom: roomsRequired ? form.roomsFrom : null,
      roomsTo: roomsRequired ? form.roomsTo : null,
      roomsNotes: roomsRequired ? form.roomsNotes.trim() || null : null,
    };
    if (!isEdit) {
      body.status = status;
      if (advanceAmount > 0) {
        body.advanceAmount = advanceAmount;
        body.advancePaymentMethod = advanceLines[0].method;
        if (needsPaymentReference(advanceLines[0].method)) body.advanceReference = advanceLines[0].reference.trim();
        if (advanceLines.length > 1) body.advanceLines = toPaymentLines(advanceLines);
      }
      // Set only when this form was opened from an enquiry's "Confirm
      // booking" action — the server links the two and marks the enquiry
      // Converted in the same transaction as this save.
      if (initialEnquiryId) body.enquiryId = initialEnquiryId;
    }
    setSaving(true);
    setError('');
    setFieldError(null);
    try {
      const data = isEdit
        ? await apiPatch(`/events/${event.id}`, body, { token })
        : await apiPost('/events', body, { token });
      if (data.advanceError) {
        setSavedWithoutAdvance(data.event);
        reportError(`The function was saved, but the advance was not recorded: ${data.advanceError} Take it from the function’s page.`);
        return;
      }
      onSaved?.(data.event);
    } catch (err) {
      // 409 is the venue being taken. The desk asked for a
      // confirmation on hours that are already someone else's, and the server
      // refused — raised as a dialog because this is the message that was
      // being missed at the top of a scrolled form.
      if (err.status === 409) {
        setClash({ kind: 'blocked', message: err.message });
        setError('');
      } else if (err.field && document.getElementById(`ev-${err.field}`)) {
        setFieldError({ field: err.field, message: err.message });
        focusField(err.field);
      } else {
        reportError(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const errFor = (name) =>
    fieldError && (fieldError.field === name || (name.startsWith('eventAdvance') && fieldError.field.startsWith(name.replace(/\d+$/, ''))))
      ? fieldError.message
      : null;

  const firstInput = useRef(null);
  useEffect(() => {
    firstInput.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      // Not while the clash dialog is up: it has its own Escape, and both
      // listeners sit on window — one press would answer the dialog and throw
      // away the half-typed form behind it in the same breath.
      if (e.key === 'Escape' && !saving && !clash) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, clash, onClose]);

  const pricing = quote?.pricing;
  const venueLines = pricing?.lines?.filter((l) => l.side === 'VENUE') || [];
  const foodLines = pricing?.lines?.filter((l) => l.side === 'FOOD') || [];

  return (
    <div className="glass-backdrop events-modal__backdrop">
      <div
        className="glass-panel events-modal modal-form__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-form-title"
      >
        <div className="modal-form">
        {/* Head and footer pinned, only the sections scroll — this is the
            longest form in the app after a booking, and its action row is a
            row of four, none of which should scroll out of reach. */}
        <div className="modal-form__head">
          <div className="modal-form__head-row">
            <h3 id="event-form-title">{isEdit ? `Edit “${event.title}”` : 'New function'}</h3>
            <button
              type="button"
              className="modal-form__close"
              onClick={onClose}
              aria-label="Close"
              title="Close"
            >
              ×
            </button>
          </div>
          {startAt && endAt && <p className="modal-form__sub">{formatEventWhen(startAt, endAt)}</p>}
        </div>

        <div className="modal-form__body">
        {error && (
          <div ref={errorBannerRef} className="form-banner form-banner--error form-banner--flash">
            {error}
          </div>
        )}

        <div className="form-section">
          <div className="form-section__title">Function</div>
          <div className="field-row">
            <Field label="Type" name="eventType">
              <select id="ev-eventType" value={form.eventType} onChange={(e) => update('eventType', e.target.value)}>
                {Object.entries(EVENT_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Title" name="title" error={errFor('title')} required>
              <input
                id="ev-title"
                ref={firstInput}
                value={form.title}
                onChange={(e) => update('title', capitalizeName(e.target.value))}
                placeholder="Sharma–Patil reception"
              />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Venue" name="venueId" error={errFor('venueId')} required>
              <select id="ev-venueId" value={form.venueId} onChange={(e) => pickVenue(e.target.value)}>
                <option value="">Choose a venue</option>
                {venues
                  .filter((v) => v.isActive || String(v.id) === form.venueId)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.capacityPax ? ` (up to ${v.capacityPax})` : ''}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Slot" name="slot">
              <select id="ev-slot" value={form.slot} onChange={(e) => pickSlot(e.target.value)}>
                {Object.entries(SLOT_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {/* What housekeeping says about the hall right now. It informs and does
              not block: a venue under repair today may be fine by the function's date. */}
          {form.venueId && <CheckInRoomStatus key={form.venueId} token={token} venues rooms={[{ roomId: form.venueId }]} />}
          <div className="field-row">
            <Field label="Starts" name="startDate" error={errFor('startDate') || errFor('startAt')} required>
              <div className="field-row">
                <input
                  id="ev-startDate"
                  type="date"
                  // A new function can't be backdated; editing an existing function
                  // leaves its date open so a past record can still be corrected.
                  min={isEdit ? undefined : toDateKey(new Date())}
                  value={form.startDate}
                  onChange={(e) => {
                    const d = e.target.value;
                    setForm((f) => ({ ...f, startDate: d, endDate: f.endDate < d ? d : f.endDate, slot: f.slot }));
                  }}
                />
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value, slot: 'CUSTOM' }))}
                />
              </div>
            </Field>
            <Field label="Ends" name="endDate" error={errFor('endDate') || errFor('endAt')} required>
              <div className="field-row">
                {/* Same day is a normal function — the times tell morning from evening —
                    so the floor is the start date itself, not the day after it. */}
                <input
                  id="ev-endDate"
                  type="date"
                  min={form.startDate || undefined}
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value, slot: 'CUSTOM' }))}
                />
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value, slot: 'CUSTOM' }))}
                />
              </div>
            </Field>
          </div>
          {availability?.checking && <div className="events-avail events-avail--checking">Checking the venue…</div>}
          {availability && !availability.checking && availability.available && (
            <div className="events-avail events-avail--ok">{venue?.name || 'Venue'} is available for these hours.</div>
          )}
          {availability && !availability.checking && !availability.available && (
            <div className="events-avail events-avail--clash">
              {venue?.name || 'This venue'} is already taken:{' '}
              {availability.clashes.map((c) => `“${c.title}” (${c.organiserName}, ${formatEventWhen(c.startAt, c.endAt)})`).join('; ')}
            </div>
          )}
        </div>

        <div className="form-section">
          <div className="form-section__title">Organiser</div>
          <div className="field-row field-row--triple">
            <Field label="Name" name="organiserName" error={errFor('organiserName')} required>
              <input id="ev-organiserName" value={form.organiserName} onChange={(e) => update('organiserName', capitalizeName(e.target.value))} />
            </Field>
            <Field label="Mobile" name="organiserPhone" error={errFor('organiserPhone')} required>
              <input
                id="ev-organiserPhone"
                inputMode="numeric"
                maxLength={10}
                value={form.organiserPhone}
                onChange={(e) => update('organiserPhone', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field label="Alternate number" name="organiserAltPhone" error={errFor('organiserAltPhone')}>
              <input
                id="ev-organiserAltPhone"
                inputMode="numeric"
                maxLength={10}
                value={form.organiserAltPhone}
                onChange={(e) => update('organiserAltPhone', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </div>
        </div>

        <div className="form-section">
          <div className="form-section__title">Guests &amp; pricing</div>
          <div className="field-row">
            <Field
              label="Expected guests"
              name="expectedPax"
              error={errFor('expectedPax')}
              hint={venue?.capacityPax ? `${venue.name} seats ${venue.capacityPax}.` : undefined}
              required
            >
              <input
                id="ev-expectedPax"
                type="number"
                min="1"
                max={venue?.capacityPax ?? undefined}
                aria-invalid={overCapacity ? 'true' : undefined}
                value={form.expectedPax}
                onChange={(e) => update('expectedPax', e.target.value)}
              />
            </Field>
            <Field
              label="Venue rent (per day)"
              name="venueCharge"
              error={errFor('venueCharge')}
              hint={
                pricing && pricing.numberOfDays > 1
                  ? `${formatPrice(Number(form.venueCharge) || 0)} × ${pricing.numberOfDays} days = ${formatPrice(pricing.venueCharge)}`
                  : undefined
              }
            >
              <input id="ev-venueCharge" type="number" min="0" value={form.venueCharge} onChange={(e) => update('venueCharge', e.target.value)} />
            </Field>
          </div>

          {/* Said as the count is typed, not after the quote comes back, and in
              the same voice as the venue-taken banner above: the desk is over a
              limit and the way out is a smaller party or a bigger hall. */}
          {overCapacity && (
            <div className="events-avail events-avail--clash" role="alert">
              {venue.name} seats {venue.capacityPax}. This party is {seatedPax} — {seatedPax - venue.capacityPax} over what the venue holds.
              Lower the count or pick a larger venue.
            </div>
          )}

          {(canCater || canRooms) && (
            <div className="events-needs">
              {canCater && (
                <label className="events__toggle">
                  <input type="checkbox" checked={form.catering} onChange={(e) => update('catering', e.target.checked)} />
                  Catering required
                </label>
              )}
              {canRooms && (
                <label className="events__toggle">
                  <input type="checkbox" checked={form.roomsRequired} onChange={(e) => toggleRooms(e.target.checked)} />
                  Rooms required
                </label>
              )}
            </div>
          )}

          {catering && (
            <div className="field-row">
              <Field label="Per-plate rate" name="perPlateRate" error={errFor('perPlateRate')} required>
                <input id="ev-perPlateRate" type="number" min="0" value={form.perPlateRate} onChange={(e) => update('perPlateRate', e.target.value)} />
              </Field>
              <Field
                label="Guaranteed minimum"
                name="guaranteedPax"
                error={errFor('guaranteedPax')}
                hint="Catering is billed on the larger of the final count and this."
              >
                <input
                  id="ev-guaranteedPax"
                  type="number"
                  min="0"
                  max={venue?.capacityPax ?? undefined}
                  aria-invalid={overCapacity ? 'true' : undefined}
                  value={form.guaranteedPax}
                  placeholder={form.expectedPax || ''}
                  onChange={(e) => update('guaranteedPax', e.target.value)}
                />
              </Field>
            </div>
          )}

          {roomsRequired && (
            <>
              <div className="field-row field-row--triple">
                <Field label="Rooms needed" name="roomsCount" error={errFor('roomsCount')} required>
                  <input id="ev-roomsCount" type="number" min="1" value={form.roomsCount} onChange={(e) => update('roomsCount', e.target.value)} />
                </Field>
                <Field label="From (night of)" name="roomsFrom" error={errFor('roomsFrom')} required>
                  <input
                    id="ev-roomsFrom"
                    type="date"
                    value={form.roomsFrom}
                    onChange={(e) =>
                      setForm((f) => {
                        const roomsFrom = e.target.value;
                        return { ...f, roomsFrom, roomsTo: roomsFrom && f.roomsTo && f.roomsTo <= roomsFrom ? addDays(roomsFrom, 1) : f.roomsTo };
                      })
                    }
                  />
                </Field>
                <Field label="Until (morning of)" name="roomsTo" error={errFor('roomsTo')} required>
                  {/* At least one night: the morning they leave is never the night they arrive. */}
                  <input id="ev-roomsTo" type="date" min={form.roomsFrom ? addDays(form.roomsFrom, 1) : undefined} value={form.roomsTo} onChange={(e) => update('roomsTo', e.target.value)} />
                </Field>
              </div>
              <Field label="Room notes" name="roomsNotes" hint="A need noted for the desk — the rooms are booked from the tape chart.">
                <input id="ev-roomsNotes" value={form.roomsNotes} onChange={(e) => update('roomsNotes', e.target.value)} placeholder="Two on the ground floor for grandparents, …" />
              </Field>
            </>
          )}

          <div className="field">
            <label>Add-ons (per day)</label>
            <div className="events-addons">
              {/* One card per add-on, the same shape ticked or not: the name on
                  top, and under it either the catalogue rate or, once ticked,
                  the two things the desk fills in — each under its own label. */}
              {lines.map((l) => (
                <div key={l.key} className={`ev-addon${l.selected ? ' ev-addon--on' : ''}`}>
                  <label className="ev-addon__head">
                    <input type="checkbox" checked={l.selected} onChange={(e) => setLine(l.key, { selected: e.target.checked })} />
                    <span className="ev-addon__name">{l.label}</span>
                  </label>
                  {l.selected ? (
                    <div className="ev-addon__fields">
                      {wantsQty(l) && (
                        // Not a <label>: it would hand a click on "Qty" to the
                        // stepper's minus button, the first control inside it.
                        <span className="ev-addon__qty">
                          <span>Qty</span>
                          <QtyStepper
                            label={l.label}
                            value={l.quantity}
                            onChange={(quantity) =>
                              setLine(l.key, {
                                quantity,
                                // Still following the catalogue rate? Keep the
                                // shown amount in step with the new quantity.
                                // Once the desk has typed their own figure in
                                // (autoAmount false), quantity changes leave
                                // it alone — it's their negotiated total now.
                                ...(l.autoAmount && l.unitAmount != null
                                  ? { agreedAmount: String(round2(Number(l.unitAmount) * quantity)) }
                                  : null),
                              })
                            }
                          />
                        </span>
                      )}
                      <label className="ev-addon__field ev-addon__field--amount">
                        <span className="ev-addon__cur" aria-hidden="true">
                          ₹
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={l.agreedAmount}
                          aria-label={`Agreed amount for ${l.label}`}
                          placeholder={l.unitAmount != null ? String(l.unitAmount) : '0'}
                          onChange={(e) => setLine(l.key, { agreedAmount: e.target.value, autoAmount: false })}
                        />
                      </label>
                    </div>
                  ) : (
                    l.unitAmount != null && (
                      <span className="ev-addon__rate">
                        {formatPrice(l.unitAmount)}
                        {l.isPerUnit ? ' per unit/day' : '/day'}
                      </span>
                    )
                  )}
                </div>
              ))}
              {lines.length === 0 && <span className="events-detail__empty">No add-ons in the catalogue yet.</span>}
            </div>
            <div className="events-oneoff">
              <input
                placeholder="One-off item (e.g. mandap flowers)"
                value={oneOff.label}
                onChange={(e) => setOneOff((o) => ({ ...o, label: capitalizeName(e.target.value) }))}
              />
              <input
                type="number"
                min="0"
                placeholder="Amount"
                value={oneOff.amount}
                onChange={(e) => setOneOff((o) => ({ ...o, amount: e.target.value }))}
              />
              <button type="button" className="btn-secondary" onClick={addOneOff} disabled={!oneOff.label.trim()}>
                Add a one-off
              </button>
            </div>
          </div>

          <div className="field-row">
            <Field label="Concession" name="discountAmount" error={errFor('discountAmount')}>
              <input id="ev-discountAmount" type="number" min="0" value={form.discountAmount} onChange={(e) => update('discountAmount', e.target.value)} />
            </Field>
            <Field label="Reason for concession" name="discountReason" error={errFor('discountReason')}>
              <input id="ev-discountReason" value={form.discountReason} onChange={(e) => update('discountReason', e.target.value)} />
            </Field>
          </div>

          {quoteError && <div className="form-banner form-banner--error">{quoteError}</div>}
          {pricing && (
            <div className="events-quote">
              {venueLines.length > 0 && <div className="events-quote__side">Venue</div>}
              {venueLines.map((l, i) => (
                <div key={`v${i}`} className="events-quote__line">
                  <span>
                    {l.label}
                    {lineNote(l) && <small>{lineNote(l)}</small>}
                  </span>
                  <span>{formatPrice(l.amount)}</span>
                </div>
              ))}
              {foodLines.length > 0 && <div className="events-quote__side">Food</div>}
              {foodLines.map((l, i) => (
                <div key={`f${i}`} className="events-quote__line">
                  <span>
                    {l.label}
                    {lineNote(l) && <small>{lineNote(l)}</small>}
                  </span>
                  <span>{formatPrice(l.amount)}</span>
                </div>
              ))}
              <div className="events-quote__line events-quote__line--sub">
                <span>Gross ({pricing.billablePax} billable guests)</span>
                <span>{formatPrice(pricing.grossAmount)}</span>
              </div>
              {Number(pricing.discountAmount) > 0 && (
                <div className="events-quote__line">
                  <span>Concession</span>
                  <span>− {formatPrice(pricing.discountAmount)}</span>
                </div>
              )}
              <div className="events-quote__line events-quote__line--total">
                <span>Total</span>
                <span>{formatPrice(pricing.totalAmount)}</span>
              </div>
              {advanceAmount > 0 && (
                <>
                  <div className="events-quote__line">
                    <span>Advance now</span>
                    <span>− {formatPrice(advanceAmount)}</span>
                  </div>
                  <div className="events-quote__line events-quote__line--due">
                    <span>Balance</span>
                    <span>{formatPrice(Math.max(0, pricing.totalAmount - advanceAmount))}</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {!isEdit && (
          <details className="form-section form-section--collapsible" open>
            <summary>
              Advance payment
              {advanceAmount > 0 && <span className="form-section__badge">{formatPrice(advanceAmount)}</span>}
            </summary>
            <p className="field__hint events-advance__hint">
              Optional. Money taken now is receipted with the function and confirms it — the venue is theirs from this moment, whichever way
              you save below.
            </p>
            <PaymentLines
              lines={advanceLines}
              onChange={setAdvanceLines}
              idPrefix="eventAdvance"
              maxLines={5}
              error={
                <>
                  {errFor(paymentFieldId('eventAdvance', 'Amount'))}
                  {errFor(paymentFieldId('eventAdvance', 'Method'))}
                  {errFor(paymentFieldId('eventAdvance', 'Reference'))}
                </>
              }
            />
          </details>
        )}

        <div className="form-section">
          <div className="form-section__title">Function sheet</div>
          {catering && (
            <Field label="Menu" name="menuNotes">
              <textarea id="ev-menuNotes" value={form.menuNotes} onChange={(e) => update('menuNotes', e.target.value)} placeholder="Veg thali, live chaat counter, …" />
            </Field>
          )}
          <Field label="Setup" name="setupNotes">
            <textarea id="ev-setupNotes" value={form.setupNotes} onChange={(e) => update('setupNotes', e.target.value)} placeholder="Round tables for 10, stage at north end, …" />
          </Field>
          <Field label="Schedule" name="scheduleNotes">
            <textarea id="ev-scheduleNotes" value={form.scheduleNotes} onChange={(e) => update('scheduleNotes', e.target.value)} placeholder="Baraat 7 pm, dinner 9 pm, …" />
          </Field>
        </div>
        </div>

        <div className="modal-form__foot events-modal__footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <span className="events-modal__spacer" style={{ flex: 1 }} />
          {savedWithoutAdvance ? (
            <button type="button" className="btn-accent" onClick={() => onSaved?.(savedWithoutAdvance)}>
              Open the function
            </button>
          ) : isEdit ? (
            <button type="button" className="btn-accent" onClick={() => save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={() => save('DRAFT')} disabled={saving}>
                Save as draft
              </button>
              <button type="button" className="btn-accent" onClick={() => save('CONFIRMED')} disabled={saving}>
                {saving ? 'Saving…' : 'Confirm now'}
              </button>
            </>
          )}
        </div>
        </div>
      </div>

      {clash && (
        <ConfirmDialog
          title={clash.kind === 'blocked' ? 'That slot is already taken' : 'The venue is already taken'}
          message={clash.kind === 'blocked' ? clash.message : clashSummary(venue, clash.clashes)}
          // Nothing to weigh up on a refusal — the only way on is different
          // hours — so the dialog carries one button and no false choice.
          confirmLabel={clash.kind === 'blocked' ? 'Pick other hours' : 'Save the draft anyway'}
          cancelLabel={clash.kind === 'blocked' ? undefined : 'Go back'}
          soleAction={clash.kind === 'blocked'}
          danger={clash.kind === 'confirm'}
          busy={saving}
          onConfirm={() => {
            const next = clash;
            setClash(null);
            if (next.kind === 'confirm') save(next.status, true);
          }}
          onCancel={() => setClash(null)}
        />
      )}
    </div>
  );
}
