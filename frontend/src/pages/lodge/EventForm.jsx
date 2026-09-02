import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { getSession } from '../../lib/auth';
import ConfirmDialog from '../../components/ConfirmDialog';
import { formatPrice } from './priceFormat';
import PaymentLines from './PaymentLines';
import { emptyPaymentLine, needsPaymentReference, paymentFieldId, paymentLinesError, sumLines, toPaymentLines } from './paymentSplit';
import {
  EVENT_TYPE_LABEL,
  SLOT_HOURS,
  SLOT_LABEL,
  formatEventWhen,
  localToIso,
  toDateKey,
  toTimeValue,
} from './eventFormat';
import './forms.css';
import './Events.css';

const DEBOUNCE_MS = 400;

// What is already on the slot, written out for the dialog. One line per
// function rather than the banner's run-on sentence: the desk is deciding
// against these, and a semicolon-joined list is the thing they were skimming
// past in the first place.
function clashSummary(venue, clashes = []) {
  const what = clashes
    .map((c) => `• “${c.title}” — ${c.organiserName} (${formatEventWhen(c.startAt, c.endAt)})`)
    .join('\n');
  return `${venue?.name || 'This venue'} is already booked at these hours:\n${what}\n\nAn enquiry can still be saved on a taken slot, but it does not hold the date.`;
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
    unitAmount: addon.defaultAmount,
    agreedAmount: '',
    selected: false,
  };
}

function initialForm(event, initialDate, venues, initialVenueId = null) {
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
      holdHours: '48',
    };
  }
  // Started from a venue's row on the diary, that venue; otherwise the first
  // one still taking bookings.
  const firstVenue =
    (initialVenueId != null && venues.find((v) => String(v.id) === String(initialVenueId))) ||
    venues.find((v) => v.isActive) ||
    venues[0];
  const date = initialDate || toDateKey(new Date());
  return {
    eventType: 'BIRTHDAY',
    title: '',
    venueId: firstVenue ? String(firstVenue.id) : '',
    slot: 'EVENING',
    startDate: date,
    startTime: SLOT_HOURS.EVENING[0],
    endDate: date,
    endTime: SLOT_HOURS.EVENING[1],
    organiserName: '',
    organiserPhone: '',
    organiserAltPhone: '',
    expectedPax: '',
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
    scheduleNotes: '',
    holdHours: '48',
  };
}

function initialLines(event, addons) {
  const lines = addons.filter((a) => a.isActive || event?.addons?.some((x) => x.addonId === a.id)).map(catalogueLine);
  if (!event) return lines;
  const oneOffs = [];
  for (const saved of event.addons || []) {
    const hit = saved.addonId ? lines.find((l) => l.addonId === saved.addonId) : null;
    if (hit) {
      hit.selected = true;
      hit.quantity = saved.quantity || 1;
      hit.agreedAmount = saved.agreedAmount != null ? String(saved.agreedAmount) : '';
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

export default function EventForm({
  event = null,
  initialDate = null,
  initialVenueId = null,
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

  const [form, setForm] = useState(() => initialForm(event, initialDate, venues, initialVenueId));
  const [lines, setLines] = useState(() => initialLines(event, addons));
  const [oneOff, setOneOff] = useState({ label: '', amount: '' });
  // Money taken with the enquiry, as the booking form takes a deposit: the
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
  //   'blocked'  — a hold or a confirmation was refused (409). Nothing to
  //                decide; the dialog reports it and the desk picks new hours.
  //   'confirm'  — an enquiry, which is allowed to sit on a taken slot. The
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

  // Availability: the diary can hold an ENQUIRY on a booked slot, but the desk
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
    };
  }, [form.venueId, form.expectedPax, form.guaranteedPax, form.venueCharge, form.perPlateRate, form.discountAmount, addonPayload, event?.finalPax, catering]);

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
    if (!/^\d{10}$/.test(form.organiserPhone.trim())) return ['organiserPhone', 'Enter a 10-digit mobile number.'];
    if (form.expectedPax === '' || Number(form.expectedPax) <= 0) return ['expectedPax', 'How many guests are expected?'];
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
      const noRef = advanceLines.findIndex((l) => needsPaymentReference(l.method) && !l.reference.trim());
      if (noRef >= 0) return [paymentFieldId('eventAdvance', 'Reference', noRef), 'Enter the UPI or card transaction number.'];
      if (pricing && advanceAmount > pricing.totalAmount + 0.005) {
        return [paymentFieldId('eventAdvance', 'Amount'), `The advance can’t be more than the quote of ${formatPrice(pricing.totalAmount)}.`];
      }
    }
    return null;
  };

  const focusField = (name) => {
    const el = document.getElementById(`ev-${name}`) || document.getElementById(name);
    if (el) el.focus();
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

    // An enquiry is allowed onto a taken slot, so the server will not stop it
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
      if (status === 'TENTATIVE') body.holdHours = Number(form.holdHours) || 48;
      if (advanceAmount > 0) {
        body.advanceAmount = advanceAmount;
        body.advancePaymentMethod = advanceLines[0].method;
        if (needsPaymentReference(advanceLines[0].method)) body.advanceReference = advanceLines[0].reference.trim();
        if (advanceLines.length > 1) body.advanceLines = toPaymentLines(advanceLines);
      }
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
        setError(`The function was saved, but the advance was not recorded: ${data.advanceError} Take it from the function’s page.`);
        return;
      }
      onSaved?.(data.event);
    } catch (err) {
      // 409 is the venue being taken. The desk asked for a hold or a
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
        setError(err.message);
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
            <h3 id="event-form-title">{isEdit ? `Edit “${event.title}”` : 'New function enquiry'}</h3>
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
        {error && <div className="form-banner form-banner--error">{error}</div>}

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
                onChange={(e) => update('title', e.target.value)}
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
          <div className="field-row">
            <Field label="Starts" name="startDate" error={errFor('startDate') || errFor('startAt')} required>
              <div className="field-row">
                <input
                  id="ev-startDate"
                  type="date"
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
                <input
                  id="ev-endDate"
                  type="date"
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
              <input id="ev-organiserName" value={form.organiserName} onChange={(e) => update('organiserName', e.target.value)} />
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
            <Field label="Expected guests" name="expectedPax" error={errFor('expectedPax')} required>
              <input id="ev-expectedPax" type="number" min="1" value={form.expectedPax} onChange={(e) => update('expectedPax', e.target.value)} />
            </Field>
            <Field label="Venue hire charge" name="venueCharge" error={errFor('venueCharge')}>
              <input id="ev-venueCharge" type="number" min="0" value={form.venueCharge} onChange={(e) => update('venueCharge', e.target.value)} />
            </Field>
          </div>

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
                  <input id="ev-roomsFrom" type="date" value={form.roomsFrom} onChange={(e) => update('roomsFrom', e.target.value)} />
                </Field>
                <Field label="Until (morning of)" name="roomsTo" error={errFor('roomsTo')} required>
                  <input id="ev-roomsTo" type="date" min={form.roomsFrom || undefined} value={form.roomsTo} onChange={(e) => update('roomsTo', e.target.value)} />
                </Field>
              </div>
              <Field label="Room notes" name="roomsNotes" hint="A need noted for the desk — the rooms are booked from the tape chart.">
                <input id="ev-roomsNotes" value={form.roomsNotes} onChange={(e) => update('roomsNotes', e.target.value)} placeholder="Two on the ground floor for grandparents, …" />
              </Field>
            </>
          )}

          <div className="field">
            <label>Add-ons</label>
            <div className="events-addons">
              {lines.map((l) => (
                <label key={l.key} className="checkbox-chip">
                  <input type="checkbox" checked={l.selected} onChange={(e) => setLine(l.key, { selected: e.target.checked })} />
                  <span>{l.label}</span>
                  {l.selected && (
                    <>
                      <input
                        className="checkbox-chip__qty"
                        type="number"
                        min="1"
                        value={l.quantity}
                        title="Quantity"
                        onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                      />
                      <input
                        className="checkbox-chip__price"
                        type="number"
                        min="0"
                        value={l.agreedAmount}
                        placeholder={l.unitAmount != null ? String(l.unitAmount) : '₹'}
                        title="Agreed amount"
                        onChange={(e) => setLine(l.key, { agreedAmount: e.target.value })}
                      />
                    </>
                  )}
                </label>
              ))}
              {lines.length === 0 && <span className="events-detail__empty">No add-ons in the catalogue yet.</span>}
            </div>
            <div className="events-oneoff">
              <input
                placeholder="One-off item (e.g. mandap flowers)"
                value={oneOff.label}
                onChange={(e) => setOneOff((o) => ({ ...o, label: e.target.value }))}
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
                    {l.note && <small>{l.note}</small>}
                  </span>
                  <span>{formatPrice(l.amount)}</span>
                </div>
              ))}
              {foodLines.length > 0 && <div className="events-quote__side">Food</div>}
              {foodLines.map((l, i) => (
                <div key={`f${i}`} className="events-quote__line">
                  <span>
                    {l.label}
                    {l.note && <small>{l.note}</small>}
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
              {quote.overCapacity && <div className="events-quote__warn">{quote.overCapacity}</div>}
            </div>
          )}
        </div>

        {!isEdit && (
          <details className="form-section form-section--collapsible" open={advanceTouched}>
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
              <button type="button" className="btn-secondary" onClick={() => save('ENQUIRY')} disabled={saving}>
                Save as enquiry
              </button>
              <div className="field">
                <input
                  type="number"
                  min="1"
                  value={form.holdHours}
                  onChange={(e) => update('holdHours', e.target.value)}
                  aria-label="Hold hours"
                  title="Hours to hold the date"
                />
              </div>
              <button type="button" className="btn-secondary" onClick={() => save('TENTATIVE')} disabled={saving}>
                Hold the date ({form.holdHours || 48} h)
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
          confirmLabel={clash.kind === 'blocked' ? 'Pick other hours' : 'Save the enquiry anyway'}
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
