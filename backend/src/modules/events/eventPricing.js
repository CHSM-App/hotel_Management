// How a function is priced, kept pure so the quote on screen, the number
// snapshotted onto the booking and the final bill are all the same arithmetic.
//
// A function is sold in three parts, and they are quoted, snapshotted and
// taxed apart:
//   - the venue: a per-day hire charge, times the number of days the
//     function runs — a one-evening booking is one day, same as always;
//   - catering: a per-plate rate times the number of plates, where "plates"
//     is the larger of the head count and the minimum the organiser agreed
//     to pay for — the kitchen bought for the guarantee, and a smaller crowd
//     does not un-buy it;
//   - add-ons: decoration, DJ, chairs, each at whatever was agreed per day,
//     times the number of days.
// A concession comes off the lot at the end, capped at what there is to take
// it off.
//
// The lines are labelled so the quote and the bill read back the way the desk
// explained it, and each carries which side of the tax it sits on: the venue
// and the add-ons are hall hire (SAC 997212), the catering is food.

function round2(n) {
  return Math.round(n * 100) / 100;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A function that starts and ends the same calendar day is 1 day; spilling
// past midnight (a wedding running 6pm-1am) is still 1 day, not 2 — only a
// span of a full day or more counts as a second day. Any partial extra day is
// billed as a whole one, same as a hotel night.
function numberOfDays({ startAt, endAt }) {
  if (!startAt || !endAt) return 1;
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 1;
  return Math.max(1, Math.ceil(ms / MS_PER_DAY));
}

function hoursBetween({ startAt, endAt }) {
  if (!startAt || !endAt) return 1;
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms / (60 * 60 * 1000) : 1;
}

// The venue line under a rate card entry. HOUR bills each started hour, DAY
// each day (as a booking without a card always has), BLOCK is one flat price
// for block_hours hours — running past the block does not add to it; the desk
// types a higher amount, and overBlock is the nudge to do so.
function priceVenue({ rate, days, hours }) {
  if (rate.type === 'HOUR') {
    const units = Math.max(1, Math.ceil(hours - 1e-9));
    return { amount: round2(rate.amount * units), note: `${units} hour${units > 1 ? 's' : ''}`, overBlock: false };
  }
  if (rate.type === 'BLOCK') {
    return {
      amount: round2(rate.amount),
      note: `${Number(rate.blockHours)}-hour block`,
      overBlock: hours > Number(rate.blockHours) + 1e-9,
    };
  }
  return { amount: round2(rate.amount * days), note: `${days} day${days > 1 ? 's' : ''}`, overBlock: false };
}

// Which head count the catering is billed on. The final figure once it is
// known, the expected one before that, and never below the guarantee.
function billablePax({ expectedPax, guaranteedPax, finalPax }) {
  const counted = finalPax != null ? Number(finalPax) : Number(expectedPax) || 0;
  return Math.max(counted, Number(guaranteedPax) || 0);
}

function addonLineAmount(line) {
  if (line.agreedAmount != null) return round2(Number(line.agreedAmount));
  return round2((Number(line.unitAmount) || 0) * (Number(line.quantity) || 1));
}

// `addons` are already resolved lines: { label, quantity, unitAmount, agreedAmount? }.
// Both venueCharge and each add-on's amount are per-day rates; startAt/endAt
// decide how many days that rate is charged for. An agreedAmount on an
// add-on is still the whole line as agreed — the desk already priced it for
// however many days it covers — so it is not multiplied again.
//
// The venue is priced one of three ways: `venueRate` ({ type, amount,
// blockHours }) from the venue's rate card; `venueTotal`, an already-settled
// venue figure taken as is (what the bill uses — the stored total must not be
// re-derived); or neither, the old per-day `venueCharge`.
function priceEvent({
  venueCharge = 0,
  venueRate = null,
  venueTotal = null,
  perPlateRate = 0,
  expectedPax = 0,
  guaranteedPax = 0,
  finalPax = null,
  addons = [],
  discountAmount = 0,
  startAt = null,
  endAt = null,
}) {
  const days = numberOfDays({ startAt, endAt });
  const pax = billablePax({ expectedPax, guaranteedPax, finalPax });
  const priced = priceVenue({
    rate: venueRate ?? { type: 'DAY', amount: Number(venueCharge) || 0 },
    days,
    hours: hoursBetween({ startAt, endAt }),
  });
  const venue = venueTotal != null ? round2(Number(venueTotal) || 0) : priced.amount;
  const plate = round2(Number(perPlateRate) || 0);
  const catering = round2(plate * pax);

  const addonLines = addons.map((line) => {
    const perDay = addonLineAmount(line);
    return {
      label: line.label,
      quantity: Number(line.quantity) || 1,
      unitAmount: round2(Number(line.unitAmount) || 0),
      // What it costs a day, and how many days it's billed for — the
      // frontend reads these to build the same "rate × count" note the
      // catering line gets, formatted with its own money formatter.
      perDayAmount: perDay,
      numberOfDays: days,
      amount: round2(perDay * days),
      side: 'VENUE',
    };
  });
  const addonsTotal = round2(addonLines.reduce((sum, line) => sum + line.amount, 0));

  const gross = round2(venue + catering + addonsTotal);
  const discount = round2(Math.min(Math.max(Number(discountAmount) || 0, 0), gross));
  const totalAmount = round2(gross - discount);

  const lines = [
    { label: 'Venue hire', note: priced.note, amount: venue, side: 'VENUE' },
    ...(catering > 0 || plate > 0
      ? [{ label: 'Catering', note: `${pax} plates × ${plate}`, quantity: pax, unitAmount: plate, amount: catering, side: 'FOOD' }]
      : []),
    ...addonLines,
  ];

  return {
    numberOfDays: days,
    overBlock: priced.overBlock,
    billablePax: pax,
    venueCharge: venue,
    perPlateRate: plate,
    cateringAmount: catering,
    addonsTotal,
    // The venue side as the bill will carry it: hall plus everything sold with
    // it, on the one SAC.
    venueSubtotal: round2(venue + addonsTotal),
    grossAmount: gross,
    discountAmount: discount,
    totalAmount,
    lines,
  };
}

module.exports = { priceEvent, billablePax, numberOfDays, round2 };
