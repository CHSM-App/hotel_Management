import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import MotionButton from './MotionButton';
import './FilterPopover.css';

// One "Filters" button that opens a small panel holding the filter controls,
// instead of laying every dropdown out across the toolbar. The button shows how
// many filters are active; what the panel contains is up to the caller.
//
//   <FilterPopover count={activeCount} onClear={clearAll}>
//     <div className="field"><label>Category</label><select …/></div>
//   </FilterPopover>
//
// It only holds the controls. The filters themselves still live in the page, so
// nothing about how the list is filtered changes. Escape and a click outside
// both close it; the panel eases in and out and skips that for reduced motion.
const PANEL_WIDTH = 300; // keep in step with .filter-pop__panel in FilterPopover.css

export default function FilterPopover({ count = 0, onClear, label = 'Filters', title = 'Filters', children }) {
  const [open, setOpen] = useState(false);
  // How far to shift the panel sideways so it stays on screen. It opens aligned
  // with the button's left edge; when the button is near either edge of a narrow
  // screen that would push it off, so the shift is measured each time it opens
  // and again if the window is resized while it is open.
  const [shift, setShift] = useState(0);
  const boxRef = useRef(null);
  const reduce = useReducedMotion();

  const place = () => {
    const box = boxRef.current;
    if (!box) return;
    const margin = 16;
    const width = Math.min(PANEL_WIDTH, window.innerWidth - margin * 2);
    const left = box.getBoundingClientRect().left;
    let dx = 0;
    if (left + width > window.innerWidth - margin) dx = window.innerWidth - margin - (left + width);
    if (left + dx < margin) dx = margin - left;
    setShift(Math.round(dx));
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  return (
    <div className="filter-pop" ref={boxRef}>
      <MotionButton
        type="button"
        className="btn-secondary filter-pop__btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        hover={{ scale: 1.03 }}
        tap={{ scale: 0.97 }}
        onClick={() => {
          if (!open) place();
          setOpen((o) => !o);
        }}
      >
        {label}
        {count > 0 && <span className="filter-pop__count">{count}</span>}
      </MotionButton>

      <AnimatePresence>
        {open && (
          <motion.div
            className="filter-pop__panel"
            style={{ left: shift }}
            role="dialog"
            aria-label={title}
            initial={reduce ? false : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="filter-pop__body">{children}</div>
            <div className="filter-pop__foot">
              {count > 0 && onClear ? (
                <button type="button" className="inv-linkbtn" onClick={onClear}>
                  Clear filters
                </button>
              ) : (
                <span />
              )}
              <MotionButton
                type="button"
                className="btn-accent btn-sheen"
                hover={{ scale: 1.03 }}
                tap={{ scale: 0.97 }}
                onClick={() => setOpen(false)}
              >
                Done
              </MotionButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
