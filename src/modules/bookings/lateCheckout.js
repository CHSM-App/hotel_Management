// When a stay is actually over, and what it costs to run past that.
//
// Everything here is pure and takes its inputs explicitly, so the rules can be
// exercised without a database and without checking anybody out. That matters
// more than usual: this decides money a guest is asked for at the desk, and
// "why was I charged ₹800" has to be answerable from the numbers alone.

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Every mode ends at a moment in time; they just disagree about which moment.
//
// NIGHT_BASED is the fixed-time property: the room is wanted for the next
// guest at check_out_time on the departure date, whenever this one arrived.
//
// CYCLE is the same deadline — out by check_out_time on the departure date —
// but prices an overstay differently: see cycleNights below.
//
// HOUR_24 sells 24 hours per night from the moment of arrival, so a guest who
// checked in at 8pm for two nights is due out at 8pm two days later. It falls
// back to the night-based deadline when there is no arrival timestamp — a
// booking that was never formally checked in has no clock to count from.
function checkoutDeadline({ checkinMode, checkOutTime, checkInDate, checkOutDate, actualCheckInAt }) {
  if (checkinMode === 'HOUR_24' && actualCheckInAt) {
    const nights = nightsBetween(checkInDate, checkOutDate);
    return new Date(new Date(actualCheckInAt).getTime() + nights * 24 * 60 * 60 * 1000);
  }
  return atLocalTime(checkOutDate, checkOutTime);
}

// The CYCLE rule: a stay costs one night for every checkout-time boundary it
// crosses, minimum one. With checkout at 09:00 —
//
//   arrive 11:00, leave 09:00 next day     → 1 night (on time)
//   arrive 14:00, leave 12:00 next day     → 2 nights (past 09:00, into the next)
//   arrive 14:00, leave 08:30 two days on  → 2 nights (left before the third 09:00)
//
// The first boundary is the checkout time on the arrival date if the guest
// arrived before it (an early check-in sits inside the previous cycle), else
// the checkout time the following day. The grace period is applied to every
// boundary, so 09:30 with an hour's grace is not a new night.
//
// Returns the count only. Whether an early arrival's extra night is actually
// charged is reception's call, made in the same override box as every late fee.
function cycleNights({ checkOutTime, actualCheckInAt, at, graceMinutes = 0 }) {
  const arrived = new Date(actualCheckInAt);
  const left = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(arrived.getTime()) || Number.isNaN(left.getTime())) return 1;

  let boundary = atLocalTime(isoDateInLodgeZone(arrived), checkOutTime);
  if (boundary.getTime() <= arrived.getTime()) boundary = addDays(boundary, 1);

  const grace = Math.max(0, Number(graceMinutes) || 0) * 60000;
  let nights = 1;
  // Bounded so a corrupt timestamp cannot spin this forever; nobody stays a year.
  while (left.getTime() > boundary.getTime() + grace && nights < 400) {
    nights += 1;
    boundary = addDays(boundary, 1);
  }
  return nights;
}

// What the CYCLE mode asks for when the stay ran longer than it was booked
// for: whole extra nights at the last night's rate. Same shape as
// suggestLateCharge so reception's dialog can treat the two alike.
function suggestCycleCharge(extraNights, lastNightRate) {
  const nights = Math.max(0, Number(extraNights) || 0);
  if (nights === 0) return { amount: 0, band: 'WITHIN_GRACE', percent: 0, extraNights: 0 };
  return {
    amount: round2((Number(lastNightRate) || 0) * nights),
    band: 'EXTRA_NIGHTS',
    percent: 100 * nights,
    extraNights: nights,
  };
}

function nightsBetween(checkInDate, checkOutDate) {
  const start = new Date(`${checkInDate}T00:00:00Z`);
  const end = new Date(`${checkOutDate}T00:00:00Z`);
  return Math.max(1, Math.round((end - start) / 86400000));
}

// The date is a plain YYYY-MM-DD and the time a plain HH:MM:SS, both meaning
// wall-clock time at the property. Every lodge here is in India, and the
// server may not be — a production box on UTC would otherwise read "09:00" as
// half past two in the afternoon and charge, or forgive, a whole night by it.
// So the wall clock is pinned to IST rather than to wherever the process runs.
const LODGE_UTC_OFFSET_MINUTES = 330; // Asia/Kolkata, no daylight saving

function atLocalTime(isoDate, timeOfDay) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  const [hh, mm, ss] = String(timeOfDay || '11:00:00').split(':').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0, 0);
  return new Date(utcMs - LODGE_UTC_OFFSET_MINUTES * 60000);
}

// The calendar date it is at the property for a given instant.
function isoDateInLodgeZone(instant) {
  const shifted = new Date(instant.getTime() + LODGE_UTC_OFFSET_MINUTES * 60000);
  return shifted.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function overdueMinutes(deadline, at) {
  return Math.max(0, Math.floor((at.getTime() - deadline.getTime()) / 60000));
}

// The suggestion, and only ever a suggestion — reception types the final
// number. Three bands over a grace period:
//
//   within grace      → nothing, the guest is on time in every way that matters
//   past grace        → half-day percentage of one night's tariff
//   past the full-day → full-day percentage, i.e. they have cost the room a night
//
// Priced off the last night's tariff rather than the stay average, because
// that is the rate the room was actually going at when they overstayed it, and
// it is the rate a season-priced stay would be re-let at today.
function suggestLateCharge(policy, minutesLate, lastNightRate) {
  const grace = policy.lateGraceMinutes ?? 0;
  if (minutesLate <= grace) {
    return { amount: 0, band: 'WITHIN_GRACE', percent: 0 };
  }

  const fullDayAfter = policy.lateFullDayAfterMinutes ?? 360;
  const band = minutesLate > fullDayAfter ? 'FULL_DAY' : 'HALF_DAY';
  const percent =
    band === 'FULL_DAY'
      ? policy.lateFullDayPercent ?? 100
      : policy.lateHalfDayPercent ?? 50;

  return { amount: round2((Number(lastNightRate) || 0) * (percent / 100)), band, percent };
}

// "3h 20m late" — the phrase reception reads out to the guest, so it is words
// rather than a raw minute count.
function lateLabel(minutesLate) {
  if (minutesLate <= 0) return 'on time';
  if (minutesLate < 60) return `${minutesLate} min late`;
  const hours = Math.floor(minutesLate / 60);
  const mins = minutesLate % 60;
  return mins === 0 ? `${hours}h late` : `${hours}h ${mins}m late`;
}

module.exports = {
  checkoutDeadline,
  cycleNights,
  suggestCycleCharge,
  atLocalTime,
  isoDateInLodgeZone,
  nightsBetween,
  overdueMinutes,
  suggestLateCharge,
  lateLabel,
};
