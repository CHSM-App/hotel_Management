// When a stay is actually over, and what it costs to run past that.
//
// Everything here is pure and takes its inputs explicitly, so the rules can be
// exercised without a database and without checking anybody out. That matters
// more than usual: this decides money a guest is asked for at the desk, and
// "why was I charged ₹800" has to be answerable from the numbers alone.

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Both modes end at a moment in time; they just disagree about which moment.
//
// NIGHT_BASED is the fixed-time property: the room is wanted for the next
// guest at check_out_time on the departure date, whenever this one arrived.
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

function nightsBetween(checkInDate, checkOutDate) {
  const start = new Date(`${checkInDate}T00:00:00Z`);
  const end = new Date(`${checkOutDate}T00:00:00Z`);
  return Math.max(1, Math.round((end - start) / 86400000));
}

// The date is a plain YYYY-MM-DD and the time a plain HH:MM:SS, both meaning
// wall-clock time at the property. Composed through the server's own local
// zone rather than UTC, because a lodge's "11am" is 11am on its own wall.
function atLocalTime(isoDate, timeOfDay) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  const [hh, mm, ss] = String(timeOfDay || '11:00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0, 0);
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
  nightsBetween,
  overdueMinutes,
  suggestLateCharge,
  lateLabel,
};
