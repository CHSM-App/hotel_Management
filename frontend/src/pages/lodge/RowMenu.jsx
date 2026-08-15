import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './RowMenu.css';

// The rare and destructive actions for one row, folded behind a single button.
//
// A list of any length puts every row's actions on screen at once, and past
// twenty rows that is more buttons than content — they compete with the thing
// you came to read. What goes in here is anything rare or destructive; the one
// action a shift actually repeats stays outside on the row.
//
// Closing on an outside pointer press rather than on blur: blur fires before
// the click lands, so a menu that closed on it would swallow its own buttons.
//
// The popup renders into document.body rather than beside its trigger. As a
// child it was absolutely positioned, which an ancestor's overflow:hidden still
// clips — and both of the things it opens inside have one: .dish-card clips so
// the photo can meet its rounded corners, and .menu-section clips to its own.
// The ⋮ sits at the bottom edge of a card, so the popup opened straight into
// that clip and was cut off. Positioning it fixed against the trigger's rect
// takes it out of reach of any ancestor, present or future.
const GAP = 4; // between trigger and popup
const EDGE = 8; // smallest gap we'll leave against the viewport

export default function RowMenu({ label, children }) {
  const [open, setOpen] = useState(false);
  // null until measured — the popup has to be in the DOM to know how big it is,
  // so the first paint is hidden rather than briefly in the wrong corner.
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);
  const popRef = useRef(null);

  const close = () => {
    setOpen(false);
    setPos(null);
  };

  useLayoutEffect(() => {
    if (!open) return undefined;

    const place = () => {
      const trigger = wrapRef.current;
      const pop = popRef.current;
      if (!trigger || !pop) return;

      const t = trigger.getBoundingClientRect();
      const { width, height } = pop.getBoundingClientRect();

      // Below the trigger, unless that runs off the bottom and there is room
      // above — a menu on the last row of cards would otherwise open offscreen.
      let top = t.bottom + GAP;
      if (top + height > window.innerHeight - EDGE && t.top - GAP - height >= EDGE) {
        top = t.top - GAP - height;
      }

      // Right edges aligned, then pulled back inside the viewport.
      const left = Math.min(
        Math.max(EDGE, t.right - width),
        Math.max(EDGE, window.innerWidth - width - EDGE)
      );

      setPos({ top, left });
    };

    place();
    window.addEventListener('resize', place);
    // Capturing, because what scrolls under this is a panel, not the window,
    // and a scroll event on it doesn't bubble.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (e) => {
      // The popup is no longer inside the wrapper, so "outside" now means
      // outside both of them.
      if (wrapRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      close();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') close();
    };

    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="rowmenu" ref={wrapRef}>
      <button
        type="button"
        className="rowmenu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? close() : setOpen(true))}
      >
        ⋮
      </button>
      {open &&
        createPortal(
          // Closing on click of the popup itself rather than per button: every
          // item in here either opens a dialog or reloads the list, so there is
          // nothing that should leave it open.
          <div
            ref={popRef}
            className="rowmenu__pop"
            role="menu"
            onClick={close}
            style={{
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            {children}
          </div>,
          document.body
        )}
    </div>
  );
}
