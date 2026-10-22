import { useEffect, useRef, useState } from 'react';
import './StaffAlertsBell.css';

// Each category gets its own icon and accent colour, so the eye can tell
// "arrival" from "checkout" from "maintenance" before it even reads the
// words — urgency (the red wash) layers on top of that, it doesn't replace
// it. Order here is also display order; a category with nothing to show
// simply never appears.
const CATEGORY_META = {
  enquiry: {
    label: 'Enquiries',
    color: '#db2777',
    icon: (
      <>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </>
    ),
  },
  checkin: {
    label: 'Arrivals today',
    color: '#2563eb',
    icon: (
      <>
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
        <path d="m10 17 5-5-5-5" />
        <path d="M15 12H3" />
      </>
    ),
  },
  checkout: {
    label: 'Check-outs',
    color: '#ea580c',
    icon: (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5" />
        <path d="M21 12H9" />
      </>
    ),
  },
  order: {
    label: 'Kitchen',
    color: '#d97706',
    icon: (
      <>
        <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" />
        <path d="M6 1v3M10 1v3M14 1v3" />
      </>
    ),
  },
  workOrder: {
    label: 'Maintenance',
    color: '#7c3aed',
    icon: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L2 19l3 3 7.3-7.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2-2z" />,
  },
  coverage: {
    label: 'Coverage',
    color: '#0d9488',
    icon: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  },
  housekeeping: {
    label: 'Housekeeping',
    color: '#16a34a',
    icon: (
      <>
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
        <path d="M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
      </>
    ),
  },
  reports: {
    label: 'Reports',
    color: '#0284c7',
    icon: <path d="M18 20V10M12 20V4M6 20v-6" />,
  },
};
const CATEGORY_ORDER = ['enquiry', 'checkin', 'checkout', 'order', 'workOrder', 'coverage', 'housekeeping', 'reports'];

function CategoryIcon({ category, size = 15 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {CATEGORY_META[category].icon}
    </svg>
  );
}

// The bell in the nav bar: every category of thing worth a staff member's
// attention right now, grouped under its own heading. Each category is fed
// by its own hook upstream (see OwnerDashboard) gated on whatever permission
// that category actually needs — a role only ever sees sections it can act
// on, and the bell itself only renders at all once at least one applies.
//
// An alert may carry `action: { label, onSelect }` — a small button on its row
// that takes staff to the screen where it is handled.
export default function StaffAlertsBell({ alerts }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const count = alerts.length;
  const anyUrgent = alerts.some((a) => a.urgent);
  const sections = CATEGORY_ORDER.map((category) => ({
    category,
    items: alerts.filter((a) => a.category === category),
  })).filter((s) => s.items.length > 0);

  return (
    <div className="staff-bell" ref={rootRef}>
      <button
        type="button"
        className="staff-bell__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={count > 0 ? `Staff alerts — ${count} ${count === 1 ? 'item' : 'items'}` : 'Staff alerts'}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span className={`staff-bell__count${anyUrgent ? ' staff-bell__count--urgent' : ''}`}>{count}</span>
        )}
      </button>

      {open && (
        <div className="staff-bell__panel" role="menu" aria-label="Staff alerts">
          <div className="staff-bell__panel-head">Staff alerts</div>
          {sections.length === 0 ? (
            <p className="staff-bell__empty">Nothing needs attention right now.</p>
          ) : (
            sections.map((section) => {
              const meta = CATEGORY_META[section.category];
              return (
                <div className="staff-bell__section" key={section.category}>
                  <div className="staff-bell__section-label" style={{ color: meta.color }}>
                    <CategoryIcon category={section.category} size={13} />
                    {meta.label}
                  </div>
                  <ul className="staff-bell__list">
                    {section.items.map((a) => (
                      <li
                        key={a.id}
                        className={`staff-bell__row${a.urgent ? ' staff-bell__row--urgent' : ''}`}
                      >
                        <span
                          className="staff-bell__row-icon"
                          style={
                            a.urgent
                              ? undefined
                              : { color: meta.color, background: `${meta.color}1a` }
                          }
                        >
                          <CategoryIcon category={section.category} />
                        </span>
                        <span className="staff-bell__row-text">{a.message}</span>
                        {a.action && (
                          <button
                            type="button"
                            className="staff-bell__row-action"
                            onClick={() => {
                              a.action.onSelect();
                              setOpen(false);
                            }}
                          >
                            {a.action.label}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
