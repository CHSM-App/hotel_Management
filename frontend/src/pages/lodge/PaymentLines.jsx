import {
  PAYMENT_METHOD_LABEL,
  emptyPaymentLine,
  needsPaymentReference,
  paymentFieldId,
} from './paymentSplit';
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

const referencePlaceholder = (method) =>
  method === 'UPI' ? 'UPI reference / UTR' : 'Approval code';

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
export default function PaymentLines({ lines, onChange, idPrefix, maxLines = 5, error }) {
  const id = (kind, index) => paymentFieldId(idPrefix, kind, index);
  const only = lines.length === 1;

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
