import { useEffect, useRef, useState } from 'react';
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
export default function RowMenu({ label, children }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
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
        onClick={() => setOpen((v) => !v)}
      >
        ⋮
      </button>
      {open && (
        // Closing on click of the popup itself rather than per button: every
        // item in here either opens a dialog or reloads the list, so there is
        // nothing that should leave it open.
        <div className="rowmenu__pop" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
