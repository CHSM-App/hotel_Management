import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import './ActionModal.css';

// A small question with a clear answer, in a colour that says what the answer
// does. One component so the "are you sure?" prompts across the app look and
// move the same way instead of drifting apart.
//
// What can be customised:
//   tone          'brand' | 'success' | 'warning' | 'danger'. Sets the icon
//                 badge, the confirm button's colour and its hover glow.
//   icon          Any node. Defaults to a glyph that fits the tone.
//   title         Heading. Can be a node, so a room number can be emphasised.
//   message       Supporting line under the heading.
//   children      Extra content between the message and the buttons (a form
//                 field, a list, a note).
//   confirmLabel  Text of the main button.  busyLabel replaces it while busy.
//   cancelLabel   Text of the secondary button. Pass `null` to drop it, for a
//                 prompt that only reports something.
//   error         Text shown in a red banner above the buttons.
//   busy          Disables both buttons and shows a spinner on the main one.
//   dismissOnBackdrop  Whether a click outside answers "cancel". Default true.
//
// Escape cancels, never confirms, and is ignored while busy. Everything that
// moves is skipped for someone who asks their system for reduced motion.

const GLYPHS = {
  brand: (
    <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  ),
  success: <path d="M5 13l4 4L19 7" />,
  warning: (
    <path d="M12 9v4m0 4h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
  ),
  danger: (
    <path d="M3 6h18M8 6V4h8v2m3 0l-1 14H6L5 6m5 5v6m4-6v6" />
  ),
};

function ToneIcon({ tone }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[tone] || GLYPHS.brand}
    </svg>
  );
}

const SPRING = { type: 'spring', stiffness: 420, damping: 22 };

function ModalButton({ variant, reduce, disabled, children, ...rest }) {
  const live = !disabled && !reduce;
  return (
    <motion.button
      type="button"
      className={`am__btn am__btn--${variant}`}
      whileHover={live ? { y: -1 } : undefined}
      whileTap={live ? { y: 0, scale: 0.96 } : undefined}
      transition={SPRING}
      disabled={disabled}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export default function ActionModal({
  open,
  tone = 'brand',
  icon,
  title,
  message,
  children,
  confirmLabel = 'Confirm',
  busyLabel = 'Saving…',
  cancelLabel = 'Cancel',
  error,
  busy = false,
  dismissOnBackdrop = true,
  onConfirm,
  onCancel,
}) {
  const reduce = useReducedMotion();
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    // Focus lands on the dialog itself, so a screen reader announces it and
    // Tab starts from inside it. It does not land on a button, so Enter can't
    // confirm by accident.
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="glass-backdrop am__backdrop"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => {
            if (dismissOnBackdrop && !busy) onCancel();
          }}
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="am-title"
            className="glass-panel am"
            data-tone={tone}
            initial={reduce ? false : { opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="am__head">
              <motion.span
                className="am__badge"
                initial={reduce ? false : { scale: 0.5, rotate: -20, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 360, damping: 16, delay: 0.08 }}
              >
                {icon || <ToneIcon tone={tone} />}
              </motion.span>
              <div className="am__text">
                <h3 id="am-title" className="am__title">
                  {title}
                </h3>
                {message && <p className="am__message">{message}</p>}
              </div>
            </div>

            {children && <div className="am__body">{children}</div>}

            <AnimatePresence initial={false}>
              {error && (
                <motion.div
                  className="am__error"
                  role="alert"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="am__actions">
              {cancelLabel !== null && (
                <ModalButton variant="cancel" reduce={reduce} disabled={busy} onClick={onCancel}>
                  {cancelLabel}
                </ModalButton>
              )}
              <ModalButton variant="confirm" reduce={reduce} disabled={busy} onClick={onConfirm}>
                {busy && <span className="am__spinner" aria-hidden="true" />}
                {busy ? busyLabel : confirmLabel}
              </ModalButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
