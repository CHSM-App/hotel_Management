// The numbered marker on a form section's heading — turns a run of similar
// blocks into a sequence you can track your position in.
//
// Colour is the fast signal down a scrolling form, but it is never the only
// one: the badge swaps its digit for a tick at the same moment it goes green,
// so the state survives a monochrome screen and a reader who cannot separate
// the two hues. The digit stays the label for anything not looking at it —
// the tick is decoration, and "step 2, complete" is what the section is.
//
// Styled by .form-section__num in pages/lodge/forms.css.
export default function StepNum({ n, done }) {
  return (
    <span
      className={`form-section__num${done ? ' form-section__num--done' : ''}`}
      aria-label={done ? `Step ${n}, complete` : `Step ${n}`}
    >
      {done ? (
        <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" focusable="false">
          <path
            d="M5 13l4.5 4.5L19 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <span aria-hidden="true">{n}</span>
      )}
    </span>
  );
}
