import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiGet, ApiError } from '../../lib/api';
import { useUrlState } from '../../lib/urlState';
import { clearSession, getSession } from '../../lib/auth';
import { SearchContext } from '../../lib/searchContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import { FEATURES, SIDEBAR_GROUP_ORDER } from '../../lib/propertyProfile';
import RoomsAndRates from './RoomsAndRates';
import Bookings from './Bookings';
import Billing from './Billing';
import GuestRegister from './GuestRegister';
import ReportsPanel from './ReportsPanel';
import StaffAndRoles from './StaffAndRoles';
import FoodSetup from './FoodSetup';
import OrdersPanel from './OrdersPanel';
import Events from './Events';
import ProfileMenu from './ProfileMenu';
import '../internal/LodgesDashboard.css';
import './OwnerDashboard.css';

const ICON_PATHS = {
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  receipt: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8" />
    </>
  ),
  bed: (
    <>
      <path d="M2 4v16" />
      <path d="M2 8h18a2 2 0 0 1 2 2v10" />
      <path d="M2 17h20" />
      <path d="M6 8V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  coffee: (
    <>
      <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" />
      <path d="M6 1v3M10 1v3M14 1v3" />
    </>
  ),
  userCheck: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <path d="m17 11 2 2 4-4" />
    </>
  ),
  barChart: (
    <>
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
  party: (
    <>
      <path d="M5.8 11.3 2 22l10.7-3.8" />
      <path d="M4 3h.01M22 8h.01M15 2h.01M22 20h.01" />
      <path d="M22 2l-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10" />
      <path d="M9 14.5 5.8 11.3l3.5 3.2Z" />
      <path d="M12.2 7.8 16.2 11.8" />
    </>
  ),
  signout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  menu: (
    <>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 6h.01M15 6h.01M9 10h.01M15 10h.01M9 14h.01M15 14h.01" />
      <path d="M10 22v-4h4v4" />
    </>
  ),
};

function Icon({ name, size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

// Where a login lands when it signs in. The front desk is the job: the tape
// chart is what reception opens first and what an owner walks over to look at,
// so it's the landing page rather than something one click away. A login that
// can't reach it — a kitchen account, or a restaurant with no rooms — falls
// through to the first section it *can* open.
const LANDING_SECTION = 'bookings';

// FEATURES and SIDEBAR_GROUP_ORDER come from lib/propertyProfile — the same
// list the onboarding form reads to tell a new customer what their account will
// contain. One copy is what stops the promise made at signup and the product
// actually delivered from drifting apart.
//
// Each entry is gated twice: by a permission the signed-in user holds, and by a
// capability the property has. Both are checked — an owner holds every
// permission, but a restaurant still has no tape chart.

export default function OwnerDashboard() {
  const navigate = useNavigate();
  const session = getSession();
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');
  // Left null until the user picks a section — /me hasn't answered yet on the
  // first render, so which section is even reachable isn't known here. The
  // landing choice is made below, once the permissions are in.
  // Read-only here: every move that sets the section also has to clear the
  // register's status cut, so both are written together through setSearchParams
  // below rather than through this setter.
  const [activeSection] = useUrlState('section');
  // Set when a checkout hands a stay to billing, which reads it as it mounts to
  // open that bill straight away. Cleared on any sidebar move, so coming back to
  // billing later lands on the plain queue rather than reopening an old bill.
  const [billNowBookingId, setBillNowBookingId] = useState(null);
  // The same hand-over for a function: "Settle & bill" on an event opens its
  // bill over the events section rather than sending the desk to billing.
  const [billNowEventId, setBillNowEventId] = useState(null);
  // Bumped when a function's bill modal closes, so the diary behind it
  // re-reads: the bill settles the function, and a tile that stayed red
  // after the paper was printed had the desk refreshing the page to see it.
  const [eventsRefresh, setEventsRefresh] = useState(0);
  // A settled function's bill, opened as the issued document rather than as
  // a bill still to be written.
  const [viewEventInvoiceId, setViewEventInvoiceId] = useState(null);

  // The tape chart's legend following a colour into the register's cut of it.
  //
  // Both keys are written in one go rather than through the two useUrlState
  // setters: each of those replaces the URL from the params it captured on this
  // render, so calling them in sequence would have the second overwrite the
  // first and land on the register with no status chosen.
  const [, setSearchParams] = useSearchParams();
  const showRegisterWithStatus = (status) => {
    setBillNowBookingId(null);
    setBillNowEventId(null);
    setSearchParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('section', 'guests');
        // See showSection: a sub-tab belongs to the section that drew it, and
        // the register has none of its own to carry.
        updated.delete('tab');
        if (status) updated.set('status', status);
        else updated.delete('status');
        return updated;
      },
      { replace: true }
    );
  };

  // The register's draft rows going the other way: a parked form is finished on
  // the tape chart, where the booking form it restores into lives, so "View" on
  // a draft moves the desk there and names the draft for Bookings to open as it
  // mounts. Written with the section in one go, for the same reason as above.
  const openDraftInChart = (draftId) => {
    setBillNowBookingId(null);
    setBillNowEventId(null);
    setSearchParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('section', 'bookings');
        updated.set('draft', String(draftId));
        updated.delete('status');
        return updated;
      },
      { replace: true }
    );
  };

  // Moving to another section from inside one, as the sidebar would. The
  // register's summary tiles use it to hand a question to the screen that owns
  // the answer.
  //
  // The register's own cuts are dropped on the way out for the same reason the
  // sidebar drops them: a status or billing filter is a narrowing of the
  // register, and carrying it into a screen that has never heard of it would
  // leave a stale ?status= sitting in the URL to be reapplied the next time the
  // register opens.
  //
  // `tab` goes with them, and for a sharper reason: five sections each keep a
  // sub-tab under that one key, and their names don't overlap. Leaving
  // ?tab=checkout behind on the way from Rooms & rates into Billing landed on a
  // billing screen where no tab matched — every chip unselected and the panel
  // blank. A sub-tab belongs to the section that drew it, so it is dropped at
  // the door and each section opens on its own first tab.
  const showSection = (key) => {
    setBillNowBookingId(null);
    setBillNowEventId(null);
    setSearchParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('section', key);
        updated.delete('tab');
        updated.delete('status');
        updated.delete('billed');
        updated.delete('sort');
        return updated;
      },
      { replace: true }
    );
  };

  useEffect(() => {
    let ignore = false;

    apiGet('/me', { token: session?.token })
      .then((data) => {
        if (!ignore) setMe(data);
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof ApiError ? err.message : 'Could not load your lodge.');
        }
      });

    return () => {
      ignore = true;
    };
  }, [session?.token]);

  // Signing out drops the session and everything cached behind it, and a
  // half-written booking with it — worth one question at a shared front desk
  // where the button sits next to the profile menu people open all day.
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  // Topbar state. The rail is open by default because on a desk monitor it is
  // always visible; the hamburger only has an effect below the breakpoint,
  // where the CSS hides a closed rail.
  const [navOpen, setNavOpen] = useState(true);
  // Stored with the section it was typed on rather than as a bare string. A
  // term belongs to the list it is narrowing, so moving to another section has
  // to drop it — and doing that by remembering which section owns the term
  // costs nothing, where clearing it in an effect meant a second render on
  // every navigation (and every handler that changes the section remembering
  // to clear it, including the browser's own back button, which cannot).
  const [searchState, setSearchState] = useState({ section: null, term: '' });

  const handleSignOut = () => {
    clearSession();
    navigate('/login', { replace: true });
  };

  // Driven by what /me says this login can actually reach, not by its role
  // name — that's what lets a lodge-defined role, or a customised built-in,
  // show the right menu without the frontend knowing the role exists. The
  // capability check on top of it is about the property, not the person.
  const permissions = me?.user.permissions || [];
  const hasCapability = (item) => !item.capability || Boolean(me?.lodge[item.capability]);
  const visibleFeatures = FEATURES.filter((f) => permissions.includes(f.permission) && hasCapability(f));
  // Resolved rather than stored, so the landing section is whatever the loaded
  // permissions allow without a second render to correct a wrong first guess.
  const activeFeature =
    visibleFeatures.find((f) => f.key === activeSection) ||
    visibleFeatures.find((f) => f.key === LANDING_SECTION) ||
    visibleFeatures[0];
  // Only the sections that actually filter on it get a search box. A field that
  // sits in the bar all day and does nothing on six screens out of nine teaches
  // people it is decorative, and then they stop reaching for it on the screens
  // where it works.
  const SEARCH_PLACEHOLDERS = {
    rooms: 'Search rooms, type, status…',
  };
  const searchPlaceholder = activeFeature ? SEARCH_PLACEHOLDERS[activeFeature.key] : undefined;
  // Reads as empty the moment the section changes, without a render spent
  // clearing it.
  const search = searchState.section === activeFeature?.key ? searchState.term : '';
  const setSearch = (term) => setSearchState({ section: activeFeature?.key, term });

  const sidebarGroups = SIDEBAR_GROUP_ORDER.map((group) => ({
    group,
    features: visibleFeatures.filter((f) => f.group === group),
  })).filter((g) => g.features.length > 0);

  return (
    <div className="dash-shell">
      {confirmSignOut && (
        <ConfirmDialog
          title="Sign out?"
          message="You will need your phone or email and password to get back in."
          confirmLabel="Sign out"
          cancelLabel="Stay signed in"
          danger
          onConfirm={handleSignOut}
          onCancel={() => setConfirmSignOut(false)}
        />
      )}
      <div className="dash-topbar dash-topbar--light">
        {/* The brand block sits over the rail rather than in the bar's flow:
            it is the sidebar's header, and lining it up with the rail below is
            what stops the bar reading as one undivided strip. */}
        <div className="dash-brand">
          <span className="dash-brand__badge" aria-hidden="true">
            <Icon name="building" size={20} />
          </span>
          <span className="dash-brand__text">
            <span className="dash-brand__name">Front Desk</span>
            {/* The name is whatever the owner typed, and the block is pinned to
                the rail's width, so a long one clips. title= is what makes the
                clipped half reachable — the full name is also in the profile
                menu, but that is a click away and this is a hover. */}
            <span className="dash-brand__sub" title={me?.lodge.name || undefined}>
              {me?.lodge.name || 'Hotel Management'}
            </span>
          </span>
        </div>

        {/* Collapses the rail on narrow windows, where 240px of permanent nav
            costs more than it gives. Above the breakpoint the rail never
            hides, so the control has nothing to say and stays out of the bar. */}
        <button
          type="button"
          className="dash-topbar__menu"
          aria-label={navOpen ? 'Hide sections' : 'Show sections'}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((open) => !open)}
        >
          <Icon name="menu" size={20} />
        </button>

        {searchPlaceholder ? (
          <div className="dash-topbar__search">
            <Icon name="search" size={16} />
            <input
              type="search"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={searchPlaceholder}
            />
          </div>
        ) : (
          // Holds the space the field would occupy, so the profile chip doesn't
          // slide left and right as you move between sections.
          <div className="dash-topbar__search-gap" />
        )}

        <div className="dash-topbar__actions">
          {me?.user ? (
            <ProfileMenu user={me.user} lodge={me.lodge} onSignOut={() => setConfirmSignOut(true)} />
          ) : (
            // The profile menu is built from /me, so when that call fails there
            // is no menu — and signing out lived only inside it. That left a
            // dashboard nobody could use and nobody could leave, on a machine
            // at a shared front desk, still holding a session. This is the way
            // off it while there is nothing else to show.
            <button
              type="button"
              className="dash-topbar__signout"
              onClick={() => setConfirmSignOut(true)}
            >
              Sign out
            </button>
          )}
        </div>
      </div>

      <div className="dash-body">
        <nav
          className={`dash-sidebar${navOpen ? '' : ' dash-sidebar--collapsed'}`}
          aria-label="Dashboard sections"
        >
          {sidebarGroups.map(({ group, features }) => (
            <div className="dash-sidebar__group" key={group}>
              <div className="dash-sidebar__label">{group}</div>
              <ul className="dash-sidebar__list">
                {features.map((feature) => (
                  <li key={feature.key}>
                    <button
                      type="button"
                      className="dash-sidebar__item"
                      aria-current={activeFeature?.key === feature.key ? 'page' : undefined}
                      onClick={() => {
                        setBillNowBookingId(null);
    setBillNowEventId(null);
                        // Cleared for the same reason billNowBookingId is: the
                        // status cut belongs to the register, and reaching it
                        // from the sidebar means asking for the whole list
                        // rather than resuming a cut the legend made earlier.
                        // The sub-tab goes too — see showSection for why a
                        // ?tab= carried across sections rendered a blank panel.
                        setSearchParams(
                          (prev) => {
                            const updated = new URLSearchParams(prev);
                            updated.set('section', feature.key);
                            updated.delete('tab');
                            updated.delete('status');
                            return updated;
                          },
                          { replace: true }
                        );
                      }}
                    >
                      <Icon name={feature.icon} />
                      {feature.title}
                      {feature.soon && <span className="dash-sidebar__soon">Soon</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Last, and set apart by a rule: every section above is part of the
              property, this is help about all of them. Ungated by permission —
              the guide shows whatever sections the user can actually reach, so
              there is nothing here for a limited role to leak. */}
          <div className="dash-sidebar__group dash-sidebar__guide">
            <ul className="dash-sidebar__list">
              <li>
                <button
                  type="button"
                  className="dash-sidebar__item"
                  onClick={() => navigate('/guide')}
                >
                  <Icon name="help" />
                  User guide
                </button>
              </li>
            </ul>
          </div>

          {/* Signing out lived only behind the topbar avatar, which is the last
              place someone looks for it — every other action on this screen is
              in the sidebar. Pushed to the bottom of the rail and set apart by
              a rule, so it reads as leaving rather than as a ninth section. */}
          <div className="dash-sidebar__footer">
            <button
              type="button"
              className="dash-sidebar__signout"
              onClick={() => setConfirmSignOut(true)}
            >
              <Icon name="signout" />
              Sign out
            </button>
          </div>
        </nav>

        {/* The sidebar names the section, so the panel doesn't repeat it as a
            heading. Labelling the landmark keeps that name available to a
            screen reader, which otherwise loses it the moment focus leaves
            the nav. */}
        <main className="dash-main" aria-label={activeFeature?.title}>
          {error && (
            <div className="dash-card">
              <div className="dash-state">{error}</div>
            </div>
          )}

          {!error && !me && (
            <div className="dash-card">
              <div className="dash-state">Loading your lodge…</div>
            </div>
          )}

          {!error && me && (
            <>
              {me.user.mustResetPassword && (
                <div className="reset-banner">
                  You&apos;re signed in with the temporary password Vengurla Tech set up. Open your
                  profile menu (top right) and choose &quot;Change password&quot; to set your own.
                </div>
              )}

              {activeFeature && activeFeature.key === 'rooms' && (
                <SearchContext.Provider value={search}>
                  <RoomsAndRates />
                </SearchContext.Provider>
              )}

              {activeFeature && activeFeature.key === 'bookings' && (
                <Bookings
                  // Opens billing OVER this tab instead of navigating to it.
                  // Checkout used to call setActiveSection('billing'), which
                  // threw reception out of the screen they were working in at
                  // the exact moment a guest was standing at the desk — and
                  // left them to find their way back afterwards.
                  onBillStay={(bookingId) => setBillNowBookingId(bookingId ?? null)}
                  onShowRegister={showRegisterWithStatus}
                />
              )}

              {activeFeature && activeFeature.key === 'billing' && (
                <Billing lodge={me.lodge} billNowBookingId={billNowBookingId} />
              )}

              {activeFeature && activeFeature.key === 'events' && (
                <Events
                  lodge={me.lodge}
                  refreshKey={eventsRefresh}
                  onBillEvent={(eventId) => setBillNowEventId(eventId ?? null)}
                  onViewInvoice={(invoiceId) => setViewEventInvoiceId(invoiceId ?? null)}
                />
              )}

              {/* A function's bill, opened over the events diary the same way a
                  stay's bill opens over the tape chart. */}
              {billNowEventId != null && (
                <Billing
                  lodge={me.lodge}
                  billNowEventId={billNowEventId}
                  modalOnly
                  onClose={() => {
                    setBillNowEventId(null);
                    setEventsRefresh((k) => k + 1);
                  }}
                />
              )}

              {/* The issued bill of a settled function. Closing it bumps the
                  diary too: a void from inside puts the function back to
                  confirmed, and the tile has to follow. */}
              {viewEventInvoiceId != null && (
                <Billing
                  lodge={me.lodge}
                  viewInvoiceId={viewEventInvoiceId}
                  modalOnly
                  onClose={() => {
                    setViewEventInvoiceId(null);
                    setEventsRefresh((k) => k + 1);
                  }}
                />
              )}

              {/* The bill for a stay, opened over whatever tab asked for it
                  instead of navigating to billing. Just the modal — it is
                  already a full-viewport dialog that closes itself, so putting
                  a panel and a scroll container around it only gave it a
                  stacking context to fight.
                  Not while the billing section is itself open: there the same
                  modal is already reachable from the queue. */}
              {billNowBookingId != null && activeFeature?.key !== 'billing' && (
                <Billing
                  lodge={me.lodge}
                  billNowBookingId={billNowBookingId}
                  modalOnly
                  onClose={() => setBillNowBookingId(null)}
                />
              )}

              {/* The register's Billed tile leaves for billing, where the
                  invoices it counted actually live — the register can list the
                  stays that were billed, but the bills themselves are another
                  screen's job, and that is the screen the tile is asking for. */}
              {activeFeature && activeFeature.key === 'guests' && (
                <GuestRegister onOpenDraft={openDraftInChart} onOpenSection={showSection} />
              )}

              {activeFeature && activeFeature.key === 'reports' && <ReportsPanel />}

              {activeFeature && activeFeature.key === 'staff' && <StaffAndRoles />}

              {activeFeature && activeFeature.key === 'food' && <OrdersPanel lodge={me.lodge} />}

              {activeFeature && activeFeature.key === 'menu' && (
                <FoodSetup
                  lodge={me.lodge}
                  onLodgeChange={(settings) => setMe((m) => ({ ...m, lodge: { ...m.lodge, ...settings } }))}
                />
              )}

              {activeFeature &&
                !['rooms', 'bookings', 'billing', 'guests', 'reports', 'staff', 'food', 'menu', 'events'].includes(
                  activeFeature.key
                ) && (
                  <div className="dash-card">
                    <div className="dash-state">
                      <span className="badge badge--off">Coming soon</span>
                      <p style={{ marginTop: 12 }}>
                        Vengurla Tech is still building this section. Check back soon.
                      </p>
                    </div>
                  </div>
                )}

              {/* Nothing to land on: a role whose permissions have all been
                  taken away, or that only holds permissions for capabilities
                  this property doesn't have. Without this the page would be
                  blank and look broken rather than restricted. */}
              {!activeFeature && (
                <div className="dash-card">
                  <div className="dash-state">
                    Your role doesn&apos;t open any sections yet. Ask the owner to review your
                    permissions under Staff &amp; roles.
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
