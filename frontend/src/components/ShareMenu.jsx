import { useEffect, useRef, useState } from 'react';
import ShareIcon from './ShareIcon';

// The channels a document goes out on, behind one control.
//
// This replaced a button that meant WhatsApp and nothing else. WhatsApp is
// still the common case and still sits first, but a desk that mails a company
// booker their bill, or texts a guest with no WhatsApp, had no way through —
// the one channel was the whole feature. The others are one list item each.
//
// Every channel here saves the PDF first and then opens a composed message,
// because none of the links involved can carry a file: mailto, sms and wa.me
// all take text only. The device share sheet is the one exception and does
// attach the file, so it is offered where the browser has one.
export default function ShareMenu({
  onShare,
  disabled = false,
  busy = false,
  canShareFiles = false,
  label = 'Share this document',
  className = 'btn-secondary bill-actions__icon-btn',
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);

  // Click-away and Escape both shut it. A menu that can only be dismissed by
  // picking something from it is a menu the desk has to answer.
  useEffect(() => {
    if (!open) return undefined;
    const onDocPointer = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (channel) => {
    setOpen(false);
    onShare(channel);
  };

  // The sheet is listed first where it exists: it is the only route that
  // attaches the file itself, so it is the one that takes the fewest steps.
  const items = [
    canShareFiles && { key: 'device', label: 'Share…', hint: 'Attaches the PDF' },
    { key: 'whatsapp', label: 'WhatsApp', hint: 'PDF downloads to attach' },
    { key: 'email', label: 'Email', hint: 'PDF downloads to attach' },
    { key: 'sms', label: 'SMS', hint: 'PDF downloads to attach' },
  ].filter(Boolean);

  return (
    <span className="share-menu" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={className}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={busy ? 'Preparing the PDF' : label}
        title={busy ? 'Preparing…' : 'Share'}
      >
        <ShareIcon />
      </button>
      {open && (
        <div className="share-menu__list" role="menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="share-menu__item"
              onClick={() => pick(item.key)}
            >
              <span className="share-menu__label">{item.label}</span>
              <span className="share-menu__hint">{item.hint}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
