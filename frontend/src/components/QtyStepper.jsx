// The "how many" control beside a counted extra: minus, the count, plus.
//
// value is held as typed (a string the box can be cleared to mid-edit), the
// same way the forms that use it already store a quantity — so the buttons
// step from whatever the box currently reads as, and a blank or nonsense box
// counts as the minimum.
//
// Styled by .qty-stepper in pages/lodge/forms.css.
export default function QtyStepper({ value, onChange, label, min = 1 }) {
  const typed = Math.floor(Number(value));
  const count = Number.isFinite(typed) && typed >= min ? typed : min;

  return (
    <span className="qty-stepper">
      <button
        type="button"
        aria-label={`One fewer ${label}`}
        disabled={count <= min}
        onClick={() => onChange(String(count - 1))}
      >
        −
      </button>
      <input
        className="qty-stepper__input"
        type="number"
        min={min}
        step="1"
        inputMode="numeric"
        aria-label={`How many ${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" aria-label={`One more ${label}`} onClick={() => onChange(String(count + 1))}>
        +
      </button>
    </span>
  );
}
