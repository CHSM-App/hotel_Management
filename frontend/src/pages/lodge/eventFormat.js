// Pure helpers shared by the Events diary, list, form and detail. Nothing in
// here touches the network or React — the components stay about their own
// state, and labels/dates are decided in one place.

export const EVENT_TYPE_LABEL = {
  BIRTHDAY: 'Birthday',
  WEDDING: 'Wedding',
  RECEPTION: 'Reception',
  ENGAGEMENT: 'Engagement',
  CORPORATE: 'Corporate',
  OTHER: 'Other',
};

export const EVENT_STATUS_LABEL = {
  ENQUIRY: 'Enquiry',
  TENTATIVE: 'On hold',
  CONFIRMED: 'Confirmed',
  SETTLED: 'Settled',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

// The colour each status wears on the diary, the legend and the hover card.
// Chosen to say the same thing the tape chart's colours say: amber is held
// but not yet sold (a draft there, a hold here), red is sold (a reservation
// there, a confirmed function here), slate is finished business. Blue is the
// one hue left over for an enquiry — interest, nothing taken.
export const EVENT_STATUS_COLOR = {
  ENQUIRY: '#5a8fd0',
  TENTATIVE: '#f2c31d',
  CONFIRMED: '#c0392b',
  SETTLED: '#8695a3',
  CANCELLED: '#cfd6dd',
  EXPIRED: '#cfd6dd',
};

export const SLOT_LABEL = {
  MORNING: 'Morning',
  EVENING: 'Evening',
  FULL_DAY: 'Full day',
  CUSTOM: 'Custom',
};

// The default hours a slot stands for. A banquet desk books "the evening",
// not 18:00–23:00, so picking the slot fills the times and CUSTOM leaves them
// to be typed.
export const SLOT_HOURS = {
  MORNING: ['09:00', '15:00'],
  EVENING: ['18:00', '23:00'],
  FULL_DAY: ['09:00', '23:00'],
};

// Statuses that still occupy the diary. Cancelled and expired ones are kept
// for the record but hidden unless asked for.
export const LIVE_STATUSES = ['ENQUIRY', 'TENTATIVE', 'CONFIRMED', 'SETTLED'];

export function isClosedStatus(status) {
  return status === 'CANCELLED' || status === 'EXPIRED';
}

// YYYY-MM-DD in local time. toISOString() would give the UTC day, which is
// yesterday for anything before 05:30 here.
export function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function toTimeValue(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// A local date + time pair from the form → ISO with offset. `new Date(...)` on
// a "YYYY-MM-DDTHH:mm" string parses as local time, and toISOString() then
// carries the zone in as an offset from UTC, which is what the API expects.
export function localToIso(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${timeStr}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function formatEventDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatEventTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// "Sat 12 Oct 2026, 06:00 pm – 11:00 pm" on one day; both dates spelt out
// when the function runs past midnight.
export function formatEventWhen(startAt, endAt) {
  if (!startAt) return '';
  const start = new Date(startAt);
  const end = endAt ? new Date(endAt) : null;
  if (!end) return `${formatEventDate(startAt)}, ${formatEventTime(startAt)}`;
  if (toDateKey(start) === toDateKey(end)) {
    return `${formatEventDate(startAt)}, ${formatEventTime(startAt)} – ${formatEventTime(endAt)}`;
  }
  return `${formatEventDate(startAt)} ${formatEventTime(startAt)} – ${formatEventDate(endAt)} ${formatEventTime(endAt)}`;
}

// Every local day an event touches, so a reception that runs past midnight
// shows on both cells of the diary.
export function eventDayKeys(startAt, endAt) {
  const keys = [];
  const start = new Date(startAt);
  const end = endAt ? new Date(endAt) : start;
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  // A function ending exactly at midnight has not started the next day.
  if (end.getHours() === 0 && end.getMinutes() === 0 && last > cursor) {
    last.setDate(last.getDate() - 1);
  }
  while (cursor <= last && keys.length < 31) {
    keys.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

// "in 3 h 20 m" / "expired" for a tentative hold's countdown.
export function formatHoldRemaining(holdExpiresAt, now = Date.now()) {
  if (!holdExpiresAt) return '';
  const ms = new Date(holdExpiresAt).getTime() - now;
  if (ms <= 0) return 'expired';
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  if (hours >= 48) return `in ${Math.floor(hours / 24)} days`;
  if (hours >= 1) return `in ${hours} h ${mins % 60} m`;
  return `in ${mins} m`;
}

// ---------------------------------------------------------------------------
// The diary's rolling window: 'YYYY-MM-DD' arithmetic done in UTC so a step
// of thirty days is always thirty days, whatever the clocks did in between.
// ---------------------------------------------------------------------------

export function addDays(dateKey, n) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isWeekend(dateKey) {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function formatDateHead(dateKey) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  return {
    weekday: d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }),
    day: d.getUTCDate(),
  };
}

// The calendar months a run of columns belongs to, in order, with how many
// columns each takes — the band above the date row is built from this.
export function monthRuns(dates) {
  const runs = [];
  for (const date of dates) {
    const key = date.slice(0, 7);
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.days += 1;
    else runs.push({ key, days: 1, first: date });
  }
  return runs;
}

export function formatMonthBand(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// "28 Aug – 26 Sep" with the year beneath, as the stepper shows it.
export function formatWindowLabel(fromKey, toKey) {
  const from = new Date(`${fromKey}T00:00:00Z`);
  const to = new Date(`${toKey}T00:00:00Z`);
  const day = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  return {
    primary: `${day(from)} – ${day(to)}`,
    secondary: sameYear ? String(from.getUTCFullYear()) : `${from.getUTCFullYear()} – ${to.getUTCFullYear()}`,
  };
}

export function statusBadgeClass(status) {
  return `badge events-badge events-badge--${String(status || '').toLowerCase()}`;
}
