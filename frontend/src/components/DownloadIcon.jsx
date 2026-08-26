// The download glyph: an arrow coming down into a tray.
//
// The artwork fills its viewBox on purpose. Drawn to the usual 24px grid with
// its conventional margins the strokes spanned only ~70% of the box, so the
// glyph rendered well under its stated size. Raising width/height alone cannot
// fix that — it scales the empty margin along with the drawing.
//
// Shared rather than drawn twice. The bill and the advance receipt both offer
// the same action, and two copies of the same path in two files is how one of
// them quietly ends up a different weight from the other.
//
// aria-hidden because it never appears on its own — every button using it
// carries its own aria-label, which is what a screen reader announces. An icon
// that also had a name would be read twice.
export default function DownloadIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round" 
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* 2.5 -> 21 of 24, against 3 -> 20 before: the glyph now fills its box
          rather than carrying the icon grid's conventional margin. */}
      <path d="M12 2.5v13" />
      <path d="M5.5 9.5 12 16 18.5 9.5" />
      <path d="M3 21h18" />
    </svg>
  );
}
