import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import './FxModal.css';

// Small pieces for a polished modal. They are used together with the `fx-modal`
// and `fx-modal__backdrop` classes from FxModal.css, and are not tied to any one
// form, so another dialog can adopt the same look by importing from here.
//
//   <AnimatePresence>
//     {open && (
//       <FxBackdrop key="m">
//         <FxPanel className="glass-panel ..."> ... </FxPanel>
//       </FxBackdrop>
//     )}
//   </AnimatePresence>
//
// The modal has to be a direct child of AnimatePresence for the closing
// animation to play: React keeps it mounted until the exit finishes.

const FX_EASE = [0.22, 1, 0.36, 1];

// Dark scrim with a soft blur that fades in and out.
export function FxBackdrop({ className = '', children, ...rest }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={`fx-modal__backdrop ${className}`}
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.22, ease: FX_EASE }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

// The dialog itself: fades in, scales up from 0.95 and slides up a little; on
// the way out it fades, drops slightly and scales down. Reduced motion keeps a
// plain fade.
export function FxPanel({ className = '', children, ...rest }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={`fx-modal ${className}`}
      initial={reduce ? false : { opacity: 0, y: 16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
      transition={{ duration: reduce ? 0 : 0.3, ease: FX_EASE }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

// A form field that is only sometimes there (it depends on another answer).
// It opens and closes by height and opacity instead of popping in. Wrap the
// conditional fields in an <AnimatePresence initial={false}> and give each a
// key. Overflow is only clipped while it moves, so a focus ring or a dropdown
// on the field is never cut off at rest.
export function FxReveal({ className = '', children, ...rest }) {
  const reduce = useReducedMotion();
  if (reduce) {
    return (
      <div className={`fx-reveal ${className}`} {...rest}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={`fx-reveal ${className}`}
      initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
      animate={{ opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } }}
      exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
      transition={{ duration: 0.28, ease: FX_EASE }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <motion.path
        d="M5 13l4 4L19 7"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.3, ease: FX_EASE, delay: 0.05 }}
      />
    </svg>
  );
}

// The label inside a Save button: the idle word, a spinner while the request is
// running, and a drawn tick once it has gone through. The three cross-fade, and
// the button keeps its width (set min-width on the button) so nothing jumps.
export function FxSaveLabel({ busy, saved, idle = 'Save', busyText = 'Saving…', savedText = 'Saved' }) {
  const key = saved ? 'saved' : busy ? 'busy' : 'idle';
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={key}
        className="fx-save__label"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.16, ease: FX_EASE }}
      >
        {saved ? (
          <>
            <CheckIcon /> {savedText}
          </>
        ) : busy ? (
          <>
            <span className="fx-spinner" aria-hidden="true" /> {busyText}
          </>
        ) : (
          idle
        )}
      </motion.span>
    </AnimatePresence>
  );
}
