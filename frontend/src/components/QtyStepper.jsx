// The "how many" control beside a counted extra: minus, the count, plus.
//
// value is held as typed (a string the box can be cleared to mid-edit), the
// same way the forms that use it already store a quantity — so the buttons
// step from whatever the box currently reads as, and a blank or nonsense box
// counts as the minimum.
//
// Styled by .qty-stepper in pages/lodge/forms.css.
import MotionButton from './MotionButton';

// The buttons are small (28px), so they grow more than a footer button does.
const STEP_HOVER = { scale: 1.08 };
const STEP_TAP = { scale: 0.86 };

export default function QtyStepper({ value, onChange, label, min = 1 }) {
  const typed = Math.floor(Number(value));
  const count = Number.isFinite(typed) && typed >= min ? typed : min;

  return (
    <span className="qty-stepper">
      <MotionButton
        type="button"
        hover={STEP_HOVER}
        tap={STEP_TAP}
        aria-label={`One fewer ${label}`}
        disabled={count <= min}
        onClick={() => onChange(String(count - 1))}
      >
        −
      </MotionButton>
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
      <MotionButton type="button" hover={STEP_HOVER} tap={STEP_TAP} aria-label={`One more ${label}`} onClick={() => onChange(String(count + 1))}>
        +
      </MotionButton>
    </span>
  );
}
