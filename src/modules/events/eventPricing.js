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
function priceEvent({
  venueCharge = 0,
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
  const venue = round2((Number(venueCharge) || 0) * days);
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
    { label: 'Venue hire', note: `${days} day${days > 1 ? 's' : ''}`, amount: venue, side: 'VENUE' },
    ...(catering > 0 || plate > 0
      ? [{ label: 'Catering', note: `${pax} plates × ${plate}`, quantity: pax, unitAmount: plate, amount: catering, side: 'FOOD' }]
      : []),
    ...addonLines,
  ];

  return {
    numberOfDays: days,
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
