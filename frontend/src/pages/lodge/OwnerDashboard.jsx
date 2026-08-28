import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiGet, ApiError } from '../../lib/api';
import { useUrlState } from '../../lib/urlState';
import { clearSession, getSession } from '../../lib/auth';
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
};

function Icon({ name }) {
  return (
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

  // The tape chart's legend following a colour into the register's cut of it.
  //
  // Both keys are written in one go rather than through the two useUrlState
  // setters: each of those replaces the URL from the params it captured on this
  // render, so calling them in sequence would have the second overwrite the
  // first and land on the register with no status chosen.
  const [, setSearchParams] = useSearchParams();
  const showRegisterWithStatus = (status) => {
    setBillNowBookingId(null);
    setSearchParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('section', 'guests');
        if (status) updated.set('status', status);
        else updated.delete('status');
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
      <div className="dash-topbar">
        <div>
          <div className="dash-topbar__mark">{me?.lodge.name || 'Loading…'}</div>
        </div>
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
        <nav className="dash-sidebar" aria-label="Dashboard sections">
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
                        // Cleared for the same reason billNowBookingId is: the
                        // status cut belongs to the register, and reaching it
                        // from the sidebar means asking for the whole list
                        // rather than resuming a cut the legend made earlier.
                        setSearchParams(
                          (prev) => {
                            const updated = new URLSearchParams(prev);
                            updated.set('section', feature.key);
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

              {activeFeature && activeFeature.key === 'rooms' && <RoomsAndRates />}

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

              {activeFeature && activeFeature.key === 'guests' && <GuestRegister />}

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
                !['rooms', 'bookings', 'billing', 'guests', 'reports', 'staff', 'food', 'menu'].includes(
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
