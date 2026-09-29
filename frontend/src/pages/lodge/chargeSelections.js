// An extra is carried as { id, quantity, agreedAmount }: the checkbox owns
// whether it's on the booking at all, the count owns how many, and agreedAmount
// is what reception agreed the whole line costs per night. Blank means "charge
// what the lodge charges times the count" — the common case, and what every
// extra did before the total was editable.
//
// quantity is held as typed so the field can be cleared mid-edit, and read back
// through selectionCount, which is what every consumer of it actually wants.
// Shared by the booking form and each extra room's card in it.
export function selectionCount(value) {
  const count = Math.floor(Number(value));
  return Number.isFinite(count) && count >= 1 ? count : 1;
}

// Blank or nonsense means "no override" rather than free — a cleared box while
// typing must not silently zero the line. Zero typed on purpose is kept.
export function selectionAgreed(value) {
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
export function sameCharge(a, b) {
  return Number(a) === Number(b);
}

export function toggleSelection(selections, chargeId) {
  return selections.some((c) => sameCharge(c.id, chargeId))
    ? selections.filter((c) => c.id !== chargeId)
    : [...selections, { id: chargeId, quantity: '1', agreedAmount: '' }];
}

export function withQuantity(selections, chargeId, quantity) {
  return selections.map((c) => (sameCharge(c.id, chargeId) ? { ...c, quantity } : c));
}

export function withAgreedAmount(selections, chargeId, agreedAmount) {
  return selections.map((c) => (sameCharge(c.id, chargeId) ? { ...c, agreedAmount } : c));
}

export function selectionOf(selections, chargeId) {
  return selections.find((c) => sameCharge(c.id, chargeId));
}

// "7:3,8" — the id alone when there's just one of it, so the common case reads
// the same as it always did.
export function chargesParam(selections) {
  return selections
    .map((c) => {
      const count = selectionCount(c.quantity);
      const price = selectionAgreed(c.agreedAmount);
      const base = count > 1 ? `${c.id}:${count}` : String(c.id);
      return price === undefined ? base : `${base}@${price}`;
    })
    .join(',');
}

export function chargesPayload(selections) {
  return selections.map((c) => {
    const price = selectionAgreed(c.agreedAmount);
    return price === undefined
      ? { id: c.id, quantity: selectionCount(c.quantity) }
      : { id: c.id, quantity: selectionCount(c.quantity), agreedAmount: price };
  });
}
