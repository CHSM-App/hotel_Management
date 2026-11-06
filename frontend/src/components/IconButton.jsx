import { motion, useReducedMotion } from 'framer-motion';
import './IconButton.css';

// An icon-only action button that names itself on hover.
//
// The label is required and does triple duty: it is the accessible name via
// aria-label, the hover tooltip via a data attribute the CSS renders, and the
// long-press label on touch. It is NOT rendered as a `title` attribute — the
// browser's native tooltip would fire a second, unstyled bubble a beat after
// ours and sit in a different place.
//
// Why a CSS tooltip rather than the native one: `title` waits about a second
// before appearing, can't be positioned, and is invisible to keyboard users.
// This one shows on hover AND on keyboard focus, which is the whole reason an
// icon-only control is usable at all without a mouse.
//
// `tone="danger"` tints the button red — for Delete and the like.
//
// `animated` adds a spring on hover and press. The button lifts and grows, and
// the glyph moves with it: a normal icon tilts like a pen being picked up, a
// danger icon gives a short shake. It is opt-in because most of the app's icon
// buttons sit in dense rows where movement would be noise. Nothing moves for
// someone who asks their system for reduced motion.
const SPRING = { type: 'spring', stiffness: 420, damping: 20 };
const GLYPH_NORMAL = { rotate: -12, scale: 1.12, transition: SPRING };
const GLYPH_DANGER = { rotate: [0, -14, 12, -8, 0], transition: { duration: 0.45 } };

export default function IconButton({
  label,
  icon,
  tone,
  className = '',
  animated = false,
  ...rest
}) {
  const reduceMotion = useReducedMotion();
  const classes = [
    'icon-btn',
    tone === 'danger' ? 'icon-btn--danger' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (animated && !reduceMotion) {
    return (
      <motion.button
        type="button"
        className={classes}
        aria-label={label}
        data-tooltip={label}
        whileHover="hover"
        whileTap="tap"
        variants={{
          hover: { y: -2, scale: 1.08, transition: SPRING },
          tap: { y: 0, scale: 0.92, transition: SPRING },
        }}
        {...rest}
      >
        <motion.span
          className="icon-btn__glyph"
          variants={{ hover: tone === 'danger' ? GLYPH_DANGER : GLYPH_NORMAL }}
        >
          {icon}
        </motion.span>
      </motion.button>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      aria-label={label}
      data-tooltip={label}
      {...rest}
    >
      {icon}
    </button>
  );
}
