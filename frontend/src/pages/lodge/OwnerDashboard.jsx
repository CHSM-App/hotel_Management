import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, ApiError } from '../../lib/api';
import { clearSession, getSession } from '../../lib/auth';
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

const CHECKIN_LABEL = {
  HOUR_24: '24-hour cycle',
  NIGHT_BASED: 'Night-based',
};

const ICON_PATHS = {
  location: (
    <>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  address: (
    <>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </>
  ),
  phone: (
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.902.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.908.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
  ),
  chat: (
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  ),
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
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 6 10-6" />
    </>
  ),
  home: (
    <>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
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

function roleLabel(role) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

function InfoTile({ icon, label, value }) {
  if (!value) return null;
  return (
    <div className="info-tile">
      <div className="info-tile__icon">
        <Icon name={icon} />
      </div>
      <div className="info-tile__body">
        <div className="info-tile__label">{label}</div>
        <div className="info-tile__value">{value}</div>
      </div>
    </div>
  );
}

// A short, ordered walkthrough for a lodge that's just getting set up —
// each step's roles mirror the FEATURES entry it links to, so a RECEPTION
// or KITCHEN login never lands on a section it can't open. `capability` does
// the same job for the property itself: a restaurant is never told to add
// rooms, and a lodge that doesn't serve food is never told to build a menu.
const GETTING_STARTED_STEPS = [
  {
    key: 'rooms',
    title: 'Set up your price chart',
    description: 'Add room categories, seasonal rates and extras like AC or an extra bed.',
    permission: 'rooms.manage',
    capability: 'hasRooms',
  },
  {
    key: 'rooms',
    title: 'Add your rooms',
    description: 'Create each room number under a category — every room needs one to be bookable.',
    permission: 'rooms.manage',
    capability: 'hasRooms',
  },
  {
    key: 'bookings',
    title: 'Take your first booking',
    description: 'Walk-in guests check in right away; pre-reservations hold a room for later.',
    permission: 'bookings.manage',
    capability: 'hasRooms',
  },
  {
    key: 'billing',
    title: 'Check out and bill the stay',
    description: 'Once a guest checks out, issue a tax invoice, bill of supply or cash receipt.',
    permission: 'billing.manage',
    capability: 'hasRooms',
  },
  {
    key: 'menu',
    title: 'Build your menu',
    description: 'Add sections and dishes, then print the QR codes for your rooms and tables.',
    permission: 'food.manage',
    capability: 'servesFood',
  },
];

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
  const [activeSection, setActiveSection] = useState('overview');
  const [linkCopied, setLinkCopied] = useState(false);

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

  const handleSignOut = () => {
    clearSession();
    navigate('/login');
  };

  // A property with no rooms has no room brochure to link to, so its public
  // link is the menu instead — that's the only thing a guest can do with it.
  const publicPath = me?.lodge.hasRooms ? `/lodge/${me?.lodge.slug}` : `/order/${me?.lodge.slug}`;

  const handleCopyPublicLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}${publicPath}`).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  // Driven by what /me says this login can actually reach, not by its role
  // name — that's what lets a lodge-defined role, or a customised built-in,
  // show the right menu without the frontend knowing the role exists. The
  // capability check on top of it is about the property, not the person.
  const permissions = me?.user.permissions || [];
  const hasCapability = (item) => !item.capability || Boolean(me?.lodge[item.capability]);
  const visibleFeatures = FEATURES.filter((f) => permissions.includes(f.permission) && hasCapability(f));
  const activeFeature = visibleFeatures.find((f) => f.key === activeSection);
  const visibleSteps = GETTING_STARTED_STEPS.filter(
    (s) => permissions.includes(s.permission) && hasCapability(s)
  );
  const sidebarGroups = SIDEBAR_GROUP_ORDER.map((group) => ({
    group,
    features: visibleFeatures.filter((f) => f.group === group),
  })).filter((g) => g.features.length > 0);

  return (
    <div className="dash-shell">
      <div className="dash-topbar">
        <div>
          <div className="dash-topbar__mark">{me?.lodge.name || 'Loading…'}</div>
        </div>
        <div className="dash-topbar__actions">
          {me?.user && <ProfileMenu user={me.user} onSignOut={handleSignOut} />}
        </div>
      </div>

      <div className="dash-body">
        <nav className="dash-sidebar" aria-label="Dashboard sections">
          <div className="dash-sidebar__group">
            <ul className="dash-sidebar__list">
              <li>
                <button
                  type="button"
                  className="dash-sidebar__item"
                  aria-current={activeSection === 'overview' ? 'page' : undefined}
                  onClick={() => setActiveSection('overview')}
                >
                  <Icon name="home" />
                  Overview
                </button>
              </li>
            </ul>
          </div>

          {sidebarGroups.map(({ group, features }) => (
            <div className="dash-sidebar__group" key={group}>
              <div className="dash-sidebar__label">{group}</div>
              <ul className="dash-sidebar__list">
                {features.map((feature) => (
                  <li key={feature.key}>
                    <button
                      type="button"
                      className="dash-sidebar__item"
                      aria-current={activeSection === feature.key ? 'page' : undefined}
                      onClick={() => setActiveSection(feature.key)}
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

        <div className="dash-main">
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

              {activeSection === 'overview' && (
                <>
                  <div className="dash-header">
                    <div>
                      <h1>Welcome back, {me.user.name.split(' ')[0]}</h1>
                      <p className="dash-header__count">
                        Signed in as {me.user.roleName || roleLabel(me.user.role)}
                      </p>
                    </div>
                  </div>

                  <div className="overview-layout">
                    <div className="overview-hero">
                      <div className="overview-hero__top">
                        <div className="overview-hero__identity">
                          <div className="overview-hero__monogram" aria-hidden="true">
                            {me.lodge.name.charAt(0)}
                          </div>
                          <div>
                            <h2>{me.lodge.name}</h2>
                            <span className="overview-hero__slug">
                              Public link: <code>{`${window.location.origin}${publicPath}`}</code>
                              <button
                                type="button"
                                className="overview-hero__copy-link"
                                onClick={handleCopyPublicLink}
                              >
                                {linkCopied ? 'Copied!' : 'Copy'}
                              </button>
                            </span>
                          </div>
                        </div>
                        <div className="overview-hero__badges">
                          <span
                            className={`badge ${me.lodge.isGstRegistered ? 'badge--on' : 'badge--off'}`}
                          >
                            {me.lodge.isGstRegistered
                              ? `GST · ${me.lodge.gstin || 'Registered'}`
                              : 'Non-GST'}
                          </span>
                          {me.lodge.isSpecifiedPremises && (
                            <span className="badge badge--accent">Specified premises</span>
                          )}
                        </div>
                      </div>

                      <div className="info-grid">
                        <InfoTile
                          icon="location"
                          label="Location"
                          value={[me.lodge.city, me.lodge.state].filter(Boolean).join(', ')}
                        />
                        <InfoTile icon="address" label="Address" value={me.lodge.address} />
                        <InfoTile
                          icon="calendar"
                          label="Check-in cycle"
                          value={CHECKIN_LABEL[me.lodge.checkinMode] || me.lodge.checkinMode}
                        />
                        <InfoTile icon="phone" label="Lodge phone" value={me.lodge.phone} />
                        <InfoTile icon="chat" label="WhatsApp" value={me.lodge.whatsappNumber} />
                        {me.lodge.isGstRegistered && (
                          <InfoTile icon="receipt" label="GSTIN" value={me.lodge.gstin} />
                        )}
                      </div>
                    </div>

                    <div className="profile-card">
                      <div className="profile-card__avatar" aria-hidden="true">
                        {me.user.name.charAt(0)}
                      </div>
                      <h3>{me.user.name}</h3>
                      <span className="badge badge--on profile-card__role">{me.user.roleName || roleLabel(me.user.role)}</span>
                      <div className="profile-card__details">
                        {me.user.email && (
                          <div className="profile-card__detail">
                            <Icon name="mail" />
                            <span>{me.user.email}</span>
                          </div>
                        )}
                        {me.user.phone && (
                          <div className="profile-card__detail">
                            <Icon name="phone" />
                            <span>{me.user.phone}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {visibleSteps.length > 0 && (
                    <div className="getting-started">
                      <div className="getting-started__title">Getting started</div>
                      <ol className="getting-started__list">
                        {visibleSteps.map((step, i) => (
                          <li className="getting-started__step" key={step.title}>
                            <span className="getting-started__number">{i + 1}</span>
                            <div className="getting-started__body">
                              <strong>{step.title}</strong>
                              <p>{step.description}</p>
                            </div>
                            <button
                              type="button"
                              className="getting-started__go"
                              onClick={() => setActiveSection(step.key)}
                            >
                              Go
                            </button>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </>
              )}

              {activeFeature && (
                <div className="dash-header">
                  <div>
                    <h1>{activeFeature.title}</h1>
                    <p className="dash-header__count">{activeFeature.description}</p>
                  </div>
                </div>
              )}

              {activeFeature && activeFeature.key === 'rooms' && <RoomsAndRates />}

              {activeFeature && activeFeature.key === 'bookings' && (
                <Bookings onCheckedOut={() => setActiveSection('billing')} />
              )}

              {activeFeature && activeFeature.key === 'billing' && <Billing lodge={me.lodge} />}

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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
