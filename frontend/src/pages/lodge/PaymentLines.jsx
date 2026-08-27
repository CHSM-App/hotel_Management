import {
  PAYMENT_METHOD_LABEL,
  emptyPaymentLine,
  needsPaymentReference,
  paymentFieldId,
} from './paymentSplit';
import { formatPrice } from './priceFormat';
import './forms.css';

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
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

const MethodOptions = () => (
  <>
    <option value="">Choose one</option>
    {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => (
      <option key={value} value={value}>
        {label}
      </option>
    ))}
  </>
);

// Says "optional" outright. The field is worth filling in — it is what the
// settlement statement gets matched against — but the desk should not hold up
// a guest hunting for a number the guest may not have to hand.
const referencePlaceholder = (method) =>
  method === 'UPI' ? 'UPI reference / UTR (optional)' : 'Approval code (optional)';

// How the money arrived: a method and an amount, once per way it came in.
//
// One row is the ordinary case and is all the desk ever sees until it needs
// more; "+ Add another payment" is what turns a settlement into a split. Every
// row is the same shape whether there is one of them or five, so nothing on
// screen moves as they are added and taken away.
//
// There is no separate total box anywhere — the amount is whatever these rows
// add up to. Asking for it as well would be a figure to type that then has to
// agree with them, and the desk would be the one keeping the two in step.
// lockedTotal: the figure the rows must add up to, when there is one. A full
// payment is a promise about the sum, so the last row is not typed but made up
// to it — the remainder after the rows above — and the desk edits the split by
// changing the earlier rows. Null on an advance, where the sum is whatever the
// guest handed over.
export default function PaymentLines({
  lines,
  onChange,
  idPrefix,
  maxLines = 5,
  error,
  required = false,
  lockedTotal = null,
}) {
  const id = (kind, index) => paymentFieldId(idPrefix, kind, index);
  const only = lines.length === 1;
  const isRemainder = (index) => lockedTotal != null && index === lines.length - 1;

  // A row carrying money but no method is the one thing on this editor that
  // stops a bill, and left alone it does not look unfinished — the amount is
  // usually filled in for the desk, so the row reads as done and "Choose one"
  // reads as a label rather than as a blank. It gets marked here instead of
  // waiting for the submit that fails.
  //
  // Only where a payment is actually required. An advance is optional, and a
  // blank row on a booking form is not a mistake to be pointed at.
  const unanswered = (line) =>
    required && !line.method && Number(line.amount) > 0;

  const update = (index, patch) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const remove = (index) => onChange(lines.filter((_, i) => i !== index));

  return (
    <>
      <div className="pay-lines">
        {lines.map((line, index) => (
          <div className="pay-lines__line" key={index}>
            <div className="pay-lines__row">
              <select
                id={id('Method', index)}
                className={unanswered(line) ? 'pay-lines__method--needed' : undefined}
                value={line.method}
                onChange={(e) => update(index, { method: e.target.value })}
                aria-label={`Payment type ${index + 1}`}
              >
                <MethodOptions />
              </select>
              <input
                id={id('Amount', index)}
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                onFocus={(e) => e.target.select()}
                value={line.amount}
                aria-label={`Amount ${index + 1}`}
                readOnly={isRemainder(index)}
                className={isRemainder(index) ? 'pay-lines__amount--locked' : undefined}
                title={
                  isRemainder(index)
                    ? only
                      ? `The full stay total, ${formatPrice(lockedTotal)}.`
                      : `Whatever is left of ${formatPrice(lockedTotal)} after the rows above.`
                    : undefined
                }
                onChange={(e) => update(index, { amount: e.target.value })}
              />
              {/* Kept in place on a single payment rather than hidden, so the
                  row does not jump sideways the moment a second one is added or
                  the last one taken away. There is nothing to remove down to
                  there, so it is simply dead. */}
              <button
                type="button"
                className="pay-lines__remove"
                onClick={() => remove(index)}
                disabled={only}
                aria-label={`Remove payment ${index + 1}`}
              >
                <TrashIcon />
              </button>
            </div>
            {/* Only for money that left a trail — what the settlement statement
                gets matched against at month end. */}
            {needsPaymentReference(line.method) && (
              <input
                id={id('Reference', index)}
                className="pay-lines__ref"
                value={line.reference}
                maxLength={64}
                placeholder={referencePlaceholder(line.method)}
                aria-label={`Transaction number ${index + 1}`}
                onChange={(e) => update(index, { reference: e.target.value })}
              />
            )}
          </div>
        ))}
      </div>
      {/* Said once for the whole editor rather than once per row: on a split
          every row is missing its method at first, and five copies of the same
          sentence is noise. Not an error — nothing has failed yet — so it is
          worded as the next thing to do. */}
      {lines.some(unanswered) && (
        <p className="pay-lines__needed">
          {lines.length === 1
            ? 'Choose how the guest paid to issue this bill.'
            : 'Choose how each part was paid to issue this bill.'}
        </p>
      )}
      {error}
      {lines.length < maxLines && (
        <button
          type="button"
          className="pay-lines__add"
          onClick={() => onChange([...lines, emptyPaymentLine()])}
        >
          + Add another payment
        </button>
      )}
    </>
  );
}
