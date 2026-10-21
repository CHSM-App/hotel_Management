// The small glyphs the stay-summary view (Billing's "View" modal) prefixes
// each fact and section with. Same construction as ActionIcons.jsx — 24px
// viewBox, currentColor stroke, no fill — so these read as the same family
// of icon rather than a second style pasted in alongside it.
const BASE = {
  width: '16',
  height: '16',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '2',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: 'false',
};

export function BedIcon() {
  return (
    <svg {...BASE}>
      <path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7" />
      <path d="M3 18v2" />
      <path d="M21 18v2" />
      <path d="M3 13v-2a2 2 0 0 1 2-2h5v4" />
    </svg>
  );
}

export function CalendarIcon() {
  return (
    <svg {...BASE}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M3 10h18" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg {...BASE}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

export function StarIcon() {
  return (
    <svg {...BASE}>
      <path d="M12 3.5l2.6 5.5 6 .7-4.4 4.1 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.7l6-.7Z" />
    </svg>
  );
}

export function UsersIcon() {
  return (
    <svg {...BASE}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16.5 6.2a3.2 3.2 0 0 1 0 6.1" />
      <path d="M21 20c0-2.8-1.9-5.1-4.5-5.8" />
    </svg>
  );
}

export function UserIcon() {
  return (
    <svg {...BASE}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c0-3.6 3-6.5 7.5-6.5S19.5 16.4 19.5 20" />
    </svg>
  );
}

export function PhoneIcon() {
  return (
    <svg {...BASE}>
      <path d="M4 5a1 1 0 0 1 1-1h3l2 4-2 1.3a12 12 0 0 0 5.7 5.7L15 14l4 2v3a1 1 0 0 1-1 1C9.4 20 4 14.6 4 5Z" />
    </svg>
  );
}

export function WalletIcon() {
  return (
    <svg {...BASE}>
      <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" />
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <path d="M16 13h3" />
    </svg>
  );
}

export function CarIcon() {
  return (
    <svg {...BASE}>
      <path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11" />
      <rect x="3" y="11" width="18" height="6" rx="2" />
      <circle cx="7.5" cy="17.5" r="1.3" />
      <circle cx="16.5" cy="17.5" r="1.3" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg {...BASE}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8v.01" />
    </svg>
  );
}

export function ReceiptIcon() {
  return (
    <svg {...BASE}>
      <path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
    </svg>
  );
}
