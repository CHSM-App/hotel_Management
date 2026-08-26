import { formatPrice } from './priceFormat';

// The arithmetic and the rules behind the split-payment editor, kept out of
// the component the way priceFormat and stayFormat are — the parents need
// toPaymentLines and paymentLinesError for their own validation and POST, and
// a .jsx that exports both a component and helpers breaks fast refresh.
//
// One rule everywhere: each payment row carries its own amount, and the total
// is however much they add up to. Nothing asks for the total separately.

// Money that arrives this way leaves a reference the property reconciles
// against its settlement statement; cash doesn't. Mirrors ONLINE_METHODS on the
// server, which is what actually enforces it.
const ONLINE_PAYMENT_METHODS = ['UPI', 'CARD'];
export const needsPaymentReference = (method) => ONLINE_PAYMENT_METHODS.includes(method);

export const PAYMENT_METHOD_LABEL = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' };

export const emptyPaymentLine = () => ({ method: '', amount: '', reference: '' });

// The id of one control inside a payment row. Shared because the booking form
// hands these to failOn, which looks the element up to open the collapsed
// section it lives in — and an id that does not resolve means the message
// renders inside a section that stays shut. Two hand-written copies of this
// template had already drifted apart once.
export const paymentFieldId = (prefix, kind, index = 0) => `${prefix}Payment${kind}${index}`;

const round2 = (n) => Math.round(n * 100) / 100;

// How an advance already taken reads on screen.
//
// A single method prints as its own name, exactly as it always did. A split
// names each one with what arrived that way — "CASH" alone against an advance
// of 200 cash and 100 UPI is a statement the guest standing at the desk can see
// is wrong, and it is the guest who paid it.
//
// fallbackMethod covers a booking loaded from an endpoint that does not carry
// the lines, so no screen has to know which one it was given.
export function describeAdvance(lines, fallbackMethod) {
  if (!lines?.length) return fallbackMethod ?? '';
  if (lines.length === 1) return lines[0].method;
  return lines.map((line) => `${line.method} ${formatPrice(line.amount)}`).join(' · ');
}

// Rounded, never left as a raw float sum: 600 + 900.10 is 1500.0999999999999 in
// binary floating point, and this figure is posted as the amount collected.
export const sumLines = (lines) =>
  round2(lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0));

// Whether every row is fully described — a method and money against it.
//
// The bill uses this to decide when a split may move its discount target. A
// half-entered one must not: typing 1,000 into the cash row of a 1,500 split
// and stopping to ask the guest for the rest would otherwise settle the target
// at 1,000, which is a real 500 discount on a bill about to be issued.
export const linesComplete = (lines) =>
  lines.every((line) => line.method && Number(line.amount) > 0);

// The message to show, or null. Ordered so the desk is told about the first
// thing wrong going down the rows rather than the last.
export function paymentLinesError(lines) {
  for (const line of lines) {
    if (!line.method) return 'Choose how each part was paid.';
    if (needsPaymentReference(line.method) && (line.reference ?? '').trim() === '') {
      return 'Enter the transaction number for a UPI or card payment.';
    }
    if (!(Number(line.amount) > 0)) return 'Each payment must be more than zero.';
  }
  return null;
}

// The shape the server wants. The amount posted alongside these is sumLines of
// the same array, so they add up to it by construction — which is what the
// endpoint re-checks in paise before writing anything.
export function toPaymentLines(lines) {
  return lines.map((line) => ({
    method: line.method,
    amount: Number(line.amount),
    // Dropped on cash: a reference typed before switching to cash would
    // otherwise file a transaction number against money that never had one.
    ...(needsPaymentReference(line.method) && (line.reference ?? '').trim() !== ''
      ? { reference: line.reference.trim() }
      : {}),
  }));
}
