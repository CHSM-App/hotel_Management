// The WhatsApp glyph, so the bill's send button reads as "WhatsApp" at a
// glance instead of a generic share icon.
//
// A sibling of DownloadIcon and drawn to the same rules — same 20px box —
// because the two sit next to each other on the bill's action row. An icon a
// hair lighter or smaller than the one beside it reads as a different class
// of control, which these are not.
//
// aria-hidden for the same reason: the button carries the name.
export default function ShareIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="#25D366"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12.04 2c-5.52 0-10 4.48-10 10 0 1.77.46 3.45 1.27 4.9L2 22l5.25-1.38a9.96 9.96 0 0 0 4.79 1.22h.01c5.52 0 10-4.48 10-10s-4.48-9.84-10.01-9.84Zm0 18.15h-.01a8.3 8.3 0 0 1-4.23-1.16l-.3-.18-3.12.82.83-3.04-.2-.31a8.28 8.28 0 0 1-1.27-4.42c0-4.58 3.73-8.31 8.31-8.31 2.22 0 4.3.87 5.87 2.44a8.25 8.25 0 0 1 2.43 5.88c0 4.58-3.73 8.28-8.31 8.28Zm4.55-6.2c-.25-.12-1.47-.72-1.7-.81-.23-.08-.39-.12-.56.13-.17.25-.64.81-.78.97-.14.17-.29.19-.53.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.39-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.42.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.86.84-.86 2.05s.88 2.38 1 2.55c.12.17 1.73 2.64 4.2 3.7.59.25 1.05.4 1.41.52.59.19 1.13.16 1.55.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.14-1.18-.06-.11-.23-.17-.48-.29Z" />
    </svg>
  );
}
