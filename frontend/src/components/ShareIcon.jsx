// The share glyph: three nodes joined by two lines, the outbound arrangement
// every platform's share control uses.
//
// A sibling of DownloadIcon and drawn to the same rules — same 24px box, same
// stroke weight, same fill-the-viewBox treatment — because the two sit next to
// each other on the bill's action row. An icon a hair lighter or smaller than
// the one beside it reads as a different class of control, which these are not.
//
// aria-hidden for the same reason: the button carries the name.
export default function ShareIcon() {
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
      <circle cx="18.5" cy="4.5" r="2.6" />
      <circle cx="5.5" cy="12" r="2.6" />
      <circle cx="18.5" cy="19.5" r="2.6" />
      {/* The connecting limbs stop short of the nodes rather than running into
          them — meeting the circles turns three dots and two lines into one
          scribble at 20px. */}
      <path d="M7.9 10.7 16.1 5.8" />
      <path d="M7.9 13.3 16.1 18.2" />
    </svg>
  );
}
