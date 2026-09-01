// The glyphs for the row-level action buttons: edit and delete.
//
// Drawn to the same rules as ShareIcon and DownloadIcon — 24px viewBox,
// currentColor stroke, no fill — so an icon button sitting next to a share or
// download control reads as the same class of thing. Colour comes from the
// button, which is what lets the delete button tint its trash red without a
// second copy of the icon.
//
// aria-hidden on both: these buttons are icon-only, so the accessible name
// comes from the button's aria-label, not from the SVG. Marking the glyph
// hidden keeps a screen reader from announcing the control twice.
const BASE = {
  width: '18',
  height: '18',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '2',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: 'false',
};

// A pencil on a diagonal, the universal edit glyph. The nib is a separate
// short stroke rather than part of the body outline — at 18px a single
// tapering outline turns into a smudge.
export function EditIcon() {
  return (
    <svg {...BASE}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

// A trash can: lid, body, and two tines. The tines matter — without them the
// body reads as a plain bucket, which is a "move" affordance in most UIs
// rather than a destructive one.
export function TrashIcon() {
  return (
    <svg {...BASE}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

// An eye — view, inspect, open a document. Used for the ID-proof and booking
// detail buttons, where the action is "show me this", not "change this".
export function EyeIcon() {
  return (
    <svg {...BASE}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// A folder opening. "Open" on a saved draft resumes it, which is a different
// act from viewing a record — the draft becomes the thing you are editing.
export function OpenIcon() {
  return (
    <svg {...BASE}>
      <path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v3" />
      <path d="M3 7v11a1 1 0 0 0 1 1h14.5a1 1 0 0 0 .95-.68L22 12H6.2a1 1 0 0 0-.95.68L3 19" />
    </svg>
  );
}

// Two arrows chasing each other: regenerate. The QR code is replaced by a new
// one, which is a redo rather than a create — the old code stops working.
export function RefreshIcon() {
  return (
    <svg {...BASE}>
      <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.4-3.9" />
      <path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.4 3.9" />
      <path d="M20 3v4.5h-4.5" />
      <path d="M4 21v-4.5h4.5" />
    </svg>
  );
}
