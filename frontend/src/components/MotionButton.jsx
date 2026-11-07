import { motion, useReducedMotion } from 'framer-motion';
import './MotionButton.css';

// A button that rises on hover and presses in on tap, on a spring.
//
// Meant for the buttons in a dialog's footer and its close control, where the
// press is the last thing the hand does before the form goes. The movement is
// small (2% up and 1px lifted, 3% down on press): a hint of a pop, not so much
// that a footer's two buttons crowd each other.
//
// Nothing moves for someone who asks their system for reduced motion, and a
// disabled button, which does nothing when pressed, does not react either.
// `hover` and `tap` replace the defaults for the one control that wants a
// different gesture (the close "×" turns instead of rising). Everything else is
// passed to the <button>, so it takes the same className, type and onClick.
const HOVER = { y: -1, scale: 1.02 };
const TAP = { y: 0, scale: 0.97 };

export default function MotionButton({ hover = HOVER, tap = TAP, disabled, children, ...rest }) {
  const reduceMotion = useReducedMotion();
  const live = !disabled && !reduceMotion;

  return (
    <motion.button
      whileHover={live ? hover : undefined}
      whileTap={live ? tap : undefined}
      transition={{ type: 'spring', stiffness: 420, damping: 22 }}
      disabled={disabled}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
