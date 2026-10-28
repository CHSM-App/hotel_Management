import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPutForm, apiDelete, ApiError, API_BASE } from '../../lib/api';
import { clearSession, getSession } from '../../lib/auth';
import { useToast } from '../../components/Toast';
import ConfirmDialog from '../../components/ConfirmDialog';
import MenuExcelImport from '../../components/MenuExcelImport';
import LodgeEditModal from './LodgeEditModal';
import { featuresForCapabilities, propertyTypeOf, SIDEBAR_GROUP_ORDER } from '../../lib/propertyProfile';
import { GroupedBarChart, Donut } from '../lodge/AnalyticsCharts';
import { Icon } from '../lodge/OwnerDashboard';
import './LodgesDashboard.css';
import '../lodge/AnalyticsCharts.css';
import './LodgeDetail.css';
import PageLoader from '../../components/PageLoader';

const CHECKIN_LABEL = {
  HOUR_24: '24-hour cycle, counted from check-in',
  NIGHT_BASED: 'Night-based, fixed checkout time',
  CYCLE: 'Fixed check-in / checkout cycle, whole nights',
  HYBRID: 'Hybrid: early arrivals get 24 hours, later ones a fixed checkout',
};

const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

// One representative icon per capability group, from the icon the group's
// own first feature already carries in propertyProfile.js's FEATURES — not
// redrawn, just picked, so "Sections this account gets" reads as a row of
// glance-able icons instead of a wall of text chips.
const GROUP_ICON = {
  Rooms: 'calendar',
  Restaurant: 'coffee',
  Events: 'party',
  Housekeeping: 'bed',
  'Finance & Management': 'wallet',
  Customers: 'users',
  'Reports & Analytics': 'barChart',
  Setup: 'userCheck',
};

// Cycled across however many slices a donut needs — room categories and food
// sources are both open-ended small sets, not a fixed count.
const DONUT_PALETTE = ['var(--brand)', '#8f7af0', '#c9bdf7', '#2FA0A0', 'var(--text-muted)'];

const ACTIVITY_LABEL = {
  INVOICE: 'Invoice issued',
  BOOKING: 'Booking created',
  FOOD_ORDER: 'Food order placed',
  CHECK_IN: 'Checked in',
  PAYMENT: 'Payment received',
};

const FOOD_SOURCE_LABEL = { ROOM: 'Room service', TABLE: 'Dining table', COUNTER: 'Counter' };

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// A TIME(0) column arrives from mssql as a Date pinned to 1970-01-01, so it is
// read off the ISO string rather than through toLocaleTimeString — the latter
// would shift 11:00 by the viewer's timezone offset.
function formatTime(value) {
  if (!value) return '—';
  const iso = value instanceof Date ? value.toISOString() : String(value);
  const match = iso.match(/(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : '—';
}

function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

// e.g. "Vengurla Tech" -> "VT". Used both for the admin's own avatar in the
// topbar and for a lodge with no logo yet, so a property always reads as
// belonging to this product rather than as a broken image.
function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'A';
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

const ICON = {
  width: '16',
  height: '16',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.8',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: 'false',
};

const Icons = {
  Bed: () => (
    <svg {...ICON}>
      <path d="M3 19v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7" />
      <path d="M3 19v2M21 19v2M3 14h18" />
      <path d="M7 14v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v3" />
    </svg>
  ),
  Calendar: () => (
    <svg {...ICON}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  ),
  Menu: () => (
    <svg {...ICON}>
      <path d="M6 3v7a2 2 0 0 0 4 0V3M8 10v11" />
      <path d="M16 3c-1.7 0-3 2-3 5s1.3 5 3 5M16 3v16" />
    </svg>
  ),
  Receipt: () => (
    <svg {...ICON}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  ),
  File: () => (
    <svg {...ICON}>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  ),
  Wallet: () => (
    <svg {...ICON}>
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" />
      <path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-5" />
      <rect x="15" y="11" width="6" height="5" rx="1" />
    </svg>
  ),
  Link: () => (
    <svg {...ICON}>
      <path d="M10 14a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.3 1.2" />
      <path d="M14 10a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
    </svg>
  ),
  Copy: () => (
    <svg {...ICON}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  ),
  Map: () => (
    <svg {...ICON}>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  ),
  Clock: () => (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  ),
  Grid: () => (
    <svg {...ICON}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  ),
  Wrench: () => (
    <svg {...ICON}>
      <path d="M14.7 6.3a4 4 0 0 0-5.6 5l-6 6a2 2 0 0 0 2.8 2.8l6-6a4 4 0 0 0 5-5.6l-3 3-2-2 3-3Z" />
    </svg>
  ),
  Users: () => (
    <svg {...ICON}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 4.5a3.2 3.2 0 0 1 0 6.2M21 20c0-2.8-1.9-5.1-4.5-5.8" />
    </svg>
  ),
  Pie: () => (
    <svg {...ICON}>
      <path d="M12 3a9 9 0 1 0 9 9h-9V3Z" />
      <path d="M14 3.5A9 9 0 0 1 20.5 10H14V3.5Z" />
    </svg>
  ),
  Chevron: () => (
    <svg {...ICON} width="18" height="18">
      <path d="m9 6 6 6-6 6" />
    </svg>
  ),
};

function Row({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children ?? '—'}</dd>
    </div>
  );
}

// Each stat gets its own colour rather than a shared tone — six tiles in a
// row read faster when each is its own colour chip than when three repeat
// twice. The chevron is decorative; nothing here is a link (yet).
function Stat({ icon, tone = 'blue', label, value, note }) {
  const IconCmp = Icons[icon];
  return (
    <div className="detail-stat">
      {IconCmp && (
        <div className={`detail-stat__icon detail-stat__icon--${tone}`}>
          <IconCmp />
        </div>
      )}
      <div className="detail-stat__body">
        <div className="detail-stat__value">{value}</div>
        <div className="detail-stat__label">{label}</div>
        {note && <div className="detail-stat__note">{note}</div>}
      </div>
      <Icons.Chevron />
    </div>
  );
}

// One card shell for every section below Overview — a small icon badge, a
// heading, an optional meta chip and hint, then whatever the section needs.
// `innerRef` is how the scroll-spy observer finds this section's DOM node.
function Card({ id, title, icon, meta, hint, innerRef, children }) {
  const IconCmp = icon && Icons[icon];
  return (
    <section id={id} ref={innerRef} className="detail-card">
      <div className="detail-card__head">
        {IconCmp && (
          <span className="detail-card__icon">
            <IconCmp />
          </span>
        )}
        <h2>{title}</h2>
        {meta && <span className="detail-card__meta">{meta}</span>}
      </div>
      {hint && <p className="detail-card__hint">{hint}</p>}
      {children}
    </section>
  );
}

export default function LodgeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const session = getSession();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    apiGet(`/internal/lodges/${id}`, { token: session?.token })
      .then((payload) => setData(payload))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this lodge.'));
  };

  useEffect(() => {
    setData(null);
    setError('');
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, session?.token]);

  // The four Overview widgets that don't come with getLodgeDetail — a
  // separate call so a lodge that's still loading its summary doesn't also
  // block on these, and so the Food Orders period toggle only re-fetches
  // this, not the whole page.
  const [dashboard, setDashboard] = useState(null);
  const [foodPeriod, setFoodPeriod] = useState('today');

  useEffect(() => {
    let ignore = false;
    apiGet(`/internal/lodges/${id}/dashboard?foodPeriod=${foodPeriod}`, { token: session?.token })
      .then((payload) => {
        if (!ignore) setDashboard(payload);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [id, session?.token, foodPeriod]);

  // Signing out drops the session and everything cached behind it, and a
  // half-written booking with it — worth one question at a shared front desk
  // where the button sits next to the profile menu people open all day.
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [editing, setEditing] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState('');
  const logoInputRef = useRef(null);
  const [heroBusy, setHeroBusy] = useState(false);
  const [heroError, setHeroError] = useState('');
  const heroInputRef = useRef(null);

  const handleLogoPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoError('');
    setLogoBusy(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const detail = await apiPutForm(`/internal/lodges/${id}/logo`, formData, { token: session?.token });
      setData(detail);
    } catch (err) {
      setLogoError(err instanceof ApiError ? err.message : 'Could not upload the logo.');
    } finally {
      setLogoBusy(false);
    }
  };

  const handleLogoRemove = async () => {
    setLogoError('');
    setLogoBusy(true);
    try {
      const detail = await apiDelete(`/internal/lodges/${id}/logo`, { token: session?.token });
      setData(detail);
    } catch (err) {
      setLogoError(err instanceof ApiError ? err.message : 'Could not remove the logo.');
    } finally {
      setLogoBusy(false);
    }
  };

  const handleHeroImagePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setHeroError('');
    setHeroBusy(true);
    try {
      const formData = new FormData();
      formData.append('heroImage', file);
      const detail = await apiPutForm(`/internal/lodges/${id}/hero-image`, formData, { token: session?.token });
      setData(detail);
    } catch (err) {
      setHeroError(err instanceof ApiError ? err.message : 'Could not upload the hero image.');
    } finally {
      setHeroBusy(false);
    }
  };

  const handleHeroImageRemove = async () => {
    setHeroError('');
    setHeroBusy(true);
    try {
      const detail = await apiDelete(`/internal/lodges/${id}/hero-image`, { token: session?.token });
      setData(detail);
    } catch (err) {
      setHeroError(err instanceof ApiError ? err.message : 'Could not remove the hero image.');
    } finally {
      setHeroBusy(false);
    }
  };

  const handleSignOut = () => {
    clearSession();
    navigate('/vtadmin', { replace: true });
  };

  const copyLink = (path, label) => {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard
      ?.writeText(url)
      .then(() => toast.show(`${label} link copied.`, 'success'))
      .catch(() => toast.show('Could not copy the link.', 'error'));
  };

  const lodge = data?.lodge;
  // The OWNER-role login, if the property has one yet — LodgeEditModal reads
  // its name/phone from here rather than from `lodge` itself, since those two
  // fields live on dbo.users, not dbo.lodges (see getLodgeDetail's `staff`).
  const owner = data?.staff?.find((u) => u.role === 'OWNER');
  const stats = data?.stats;

  // The same flag-to-preset translation the list uses, so a property is
  // described identically in both places.
  const capabilities = lodge && {
    hasRooms: lodge.has_rooms,
    servesFood: lodge.serves_food,
    foodRoomService: lodge.food_room_service,
    foodTableService: lodge.food_table_service,
    hasEvents: lodge.has_events,
    hasAssets: lodge.has_assets,
    hasExpenses: lodge.has_expenses,
    hasOtherServices: lodge.has_other_services,
    hasHousekeeping: lodge.has_housekeeping,
    hasLaundry: lodge.has_laundry,
  };
  const type = capabilities ? propertyTypeOf(capabilities) : null;

  // What the owner actually sees in their sidebar, built from the shared
  // FEATURES list rather than restated here — the same reason the onboarding
  // form builds its summary this way.
  const featureGroups = capabilities
    ? SIDEBAR_GROUP_ORDER.map((group) => ({
        group,
        features: featuresForCapabilities(capabilities).filter((f) => f.group === group),
      })).filter((g) => g.features.length > 0)
    : [];

  // The side nav's entries — built once the data that decides which sections
  // even exist (has_rooms, serves_food) has loaded, so a restaurant with no
  // rooms never shows a "Check-in" link to a section that isn't there.
  const navItems = useMemo(() => {
    if (!lodge) return [];
    return [
      { id: 'overview', label: 'Overview' },
      { id: 'contact', label: 'Property & contact' },
      { id: 'billing', label: 'Billing & GST' },
      lodge.has_rooms && { id: 'checkin', label: 'Check-in & checkout' },
      { id: 'sections', label: 'Sections this account gets' },
      { id: 'staff', label: 'Staff & owner logins' },
      lodge.serves_food && { id: 'tools', label: 'Tools' },
    ].filter(Boolean);
  }, [lodge]);

  // Scroll-spy: highlights whichever section is currently nearest the top of
  // the viewport, so the nav stays in sync with an ordinary scroll and not
  // only with clicks on the nav itself.
  const [activeId, setActiveId] = useState('overview');
  const sectionRefs = useRef({});

  useEffect(() => {
    if (!navItems.length) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      // Top-weighted band: a section counts as "current" once it has cleared
      // the sticky topbar, and stops counting well before it scrolls off the
      // bottom — so the highlight tracks what's actually being read, not
      // whatever happens to be anywhere on screen.
      { rootMargin: '-120px 0px -70% 0px', threshold: 0 }
    );
    navItems.forEach(({ id: sectionId }) => {
      const el = sectionRefs.current[sectionId];
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [navItems]);

  const handleNavClick = (sectionId) => (e) => {
    e.preventDefault();
    sectionRefs.current[sectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Inline ref callbacks at each call site below, rather than a
  // `setSectionRef(id)` factory invoked during render — the lint rule that
  // guards against reading a ref's value during render can't see through a
  // curried function call like that, even though the write only happens
  // later, when React actually calls the ref callback.

  const roomDonutSlices = (dashboard?.roomDistribution ?? []).map((r, i) => ({
    label: r.name,
    value: r.count,
    color: DONUT_PALETTE[i % DONUT_PALETTE.length],
  }));
  const totalRooms = roomDonutSlices.reduce((sum, s) => sum + s.value, 0);

  const foodDonutSlices = (dashboard?.foodBySource ?? []).map((f, i) => ({
    label: FOOD_SOURCE_LABEL[f.source] || f.source,
    value: f.count,
    color: DONUT_PALETTE[i % DONUT_PALETTE.length],
  }));
  const totalFoodOrders = foodDonutSlices.reduce((sum, s) => sum + s.value, 0);

  const activityTime = (value) =>
    new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="dash-shell vt-admin-shell">
      {confirmSignOut && (
        <ConfirmDialog
          title="Sign out?"
          message="You will need to sign in again to reach the admin dashboard."
          confirmLabel="Sign out"
          cancelLabel="Stay signed in"
          danger
          onConfirm={handleSignOut}
          onCancel={() => setConfirmSignOut(false)}
        />
      )}
      {editing && lodge && (
        <LodgeEditModal
          lodge={lodge}
          owner={owner}
          stats={stats}
          onClose={() => setEditing(false)}
          onSaved={(detail) => {
            setData(detail);
            setEditing(false);
          }}
        />
      )}
      <div className="dash-topbar">
        <div className="dash-topbar__brand">
          <div className="dash-topbar__mark">Lodge Management System</div>
          <div className="dash-topbar__eyebrow">Platform admin console</div>
        </div>
        <div className="dash-topbar__profile">
          <div className="dash-topbar__avatar" aria-hidden="true">{initialsOf(session?.name)}</div>
          <div className="dash-topbar__who">
            <div className="dash-topbar__name">{session?.name || 'Admin'}</div>
            <div className="dash-topbar__role">Superadmin</div>
          </div>
          <button className="dash-topbar__signout" onClick={() => setConfirmSignOut(true)} type="button">
            Sign out
          </button>
        </div>
      </div>

      <div className="dash-main detail-main">
        {error && <div className="dash-card dash-state">{error}</div>}
        {!error && !data && <div className="dash-card"><PageLoader inline label="Loading" /></div>}

        {!error && data && (
          <div className="detail-shell">
            {/* Persistent sidebar: identity, quick actions, section nav. Every
                fact here (slug, badges) appears nowhere else on the page. */}
            <aside className="detail-side">
              <Link className="detail-back" to="/vt-internal/dashboard">
                ← All properties
              </Link>

              <div className="detail-mini">
                {lodge.logo_path ? (
                  <img className="detail-mini__logo" src={`${API_BASE}/hotel-logos/${lodge.logo_path}`} alt="" />
                ) : (
                  <div className="detail-mini__logo detail-mini__logo--empty" aria-hidden="true">
                    {initialsOf(lodge.name)}
                  </div>
                )}
                <div className="detail-mini__name">{lodge.name}</div>
                <div className="detail-mini__slug">/{lodge.slug}</div>
                {lodge.booking_code && <div className="detail-mini__slug">Booking code {lodge.booking_code}</div>}
                <div className="detail-mini__badges">
                  {type && <span className="badge badge--accent">{type.label}</span>}
                  <span className={`badge ${lodge.is_gst_registered ? 'badge--on' : 'badge--off'}`}>
                    {lodge.is_gst_registered ? 'GST registered' : 'Non-GST'}
                  </span>
                  <span className={`badge ${lodge.is_active ? 'badge--on' : 'badge--inactive'}`}>
                    {lodge.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              <div className="detail-side-actions">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleLogoPick}
                  hidden
                />
                <button type="button" className="btn-view" onClick={() => logoInputRef.current?.click()} disabled={logoBusy}>
                  {logoBusy ? 'Uploading…' : lodge.logo_path ? 'Replace logo' : 'Upload logo'}
                </button>
                {lodge.logo_path && (
                  <button type="button" className="btn-view" onClick={handleLogoRemove} disabled={logoBusy}>
                    Remove logo
                  </button>
                )}
                <button type="button" className="btn-accent" onClick={() => setEditing(true)}>
                  Edit lodge
                </button>
                {logoError && <span className="detail-hero__logo-error">{logoError}</span>}
              </div>

              <nav className="detail-nav" aria-label="Sections">
                {navItems.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className={`detail-nav__link ${activeId === item.id ? 'detail-nav__link--active' : ''}`}
                    onClick={handleNavClick(item.id)}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </aside>

            <div className="detail-content">
              {/* Header card is deliberately minimal — only the cover photo
                  and the onboarded date live here; everything else (slug,
                  badges, phone, links) already has a home in the sidebar or
                  a card below, and isn't restated. */}
              <div className="detail-headercard">
                {lodge.hero_image_path ? (
                  <img
                    className="detail-headercard__img"
                    src={`${API_BASE}/lodge-hero-images/${lodge.hero_image_path}`}
                    alt=""
                  />
                ) : (
                  <div className="detail-headercard__img detail-headercard__img--empty" aria-hidden="true" />
                )}
                <div className="detail-headercard__scrim" />
                <div className="detail-headercard__actions">
                  <input
                    ref={heroInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleHeroImagePick}
                    hidden
                  />
                  <button type="button" className="detail-headercard__chip" onClick={() => heroInputRef.current?.click()} disabled={heroBusy}>
                    {heroBusy ? 'Uploading…' : lodge.hero_image_path ? 'Replace hero image' : 'Upload hero image'}
                  </button>
                  {lodge.hero_image_path && (
                    <button type="button" className="detail-headercard__chip" onClick={handleHeroImageRemove} disabled={heroBusy}>
                      Remove
                    </button>
                  )}
                </div>
                <div className="detail-headercard__copy">
                  <div className="detail-headercard__name">{lodge.name}</div>
                  <div className="detail-headercard__meta">Onboarded {formatDate(lodge.created_at)}</div>
                </div>
              </div>
              {heroError && <span className="detail-hero__logo-error">{heroError}</span>}
              {!lodge.hero_image_path && (
                <span className="detail-hero__hero-hint">
                  No hero image set — the public page uses the first room/venue photo. Best as a wide
                  landscape photo, around 1920×1080px (16:9).
                </span>
              )}

              <section id="overview" ref={(el) => { sectionRefs.current.overview = el; }} className="detail-section">
                <div className="detail-stats">
                  {lodge.has_rooms && (
                    <>
                      <Stat
                        icon="Bed"
                        tone="blue"
                        label="Rooms"
                        value={stats.rooms}
                        note={`${stats.rooms_active} active · ${stats.categories} categories`}
                      />
                      <Stat
                        icon="Calendar"
                        tone="green"
                        label="Bookings"
                        value={stats.bookings}
                        note={`${stats.bookings_in_house} in house · ${stats.bookings_upcoming} upcoming`}
                      />
                    </>
                  )}
                  {lodge.serves_food && (
                    <>
                      <Stat
                        icon="Menu"
                        tone="orange"
                        label="Menu items"
                        value={stats.menu_items}
                        note={`${stats.menu_categories} categories`}
                      />
                      <Stat
                        icon="Receipt"
                        tone="pink"
                        label="Food orders"
                        value={stats.food_orders}
                        note={lodge.food_table_service ? `${stats.dining_tables} dining tables` : 'Room service only'}
                      />
                    </>
                  )}
                  <Stat
                    icon="File"
                    tone="purple"
                    label="Invoices issued"
                    value={stats.invoices_issued}
                    note={stats.invoices_void ? `${stats.invoices_void} voided` : 'None voided'}
                  />
                  <Stat icon="Wallet" tone="teal" label="Billed to date" value={money.format(stats.billed_total)} note="Issued documents only" />
                </div>

                {lodge.has_rooms && (
                  <div className="detail-card-row">
                    <div className="analytics-card">
                      <div className="analytics-card-head">
                        <div className="detail-card-title-group">
                          <span className="detail-card__icon">
                            <Icons.Calendar />
                          </span>
                          <span className="analytics-card-title">Booking overview</span>
                        </div>
                        <span className="analytics-legend">
                          <span className="analytics-legend-item">
                            <span className="analytics-legend-dot" style={{ background: 'var(--brand)' }} />
                            Rooms sold
                          </span>
                          <span className="analytics-legend-item">
                            <span className="analytics-legend-dot" style={{ background: 'var(--text-muted)' }} />
                            In house
                          </span>
                        </span>
                      </div>
                      {dashboard ? (
                        <GroupedBarChart data={dashboard.bookingTrend} seriesAKey="sold" seriesBKey="inHouse" />
                      ) : (
                        <p className="detail-card__hint">Loading…</p>
                      )}
                    </div>

                    <div className="analytics-card">
                      <div className="analytics-card-head">
                        <div className="detail-card-title-group">
                          <span className="detail-card__icon">
                            <Icons.Pie />
                          </span>
                          <span className="analytics-card-title">Room distribution</span>
                        </div>
                        <span className="analytics-card-meta">{totalRooms} total</span>
                      </div>
                      {dashboard && roomDonutSlices.length > 0 ? (
                        <div className="donut-wrap">
                          <Donut slices={roomDonutSlices} centerLabel={String(totalRooms)} centerSub="rooms" />
                          <div className="mix-rows">
                            {roomDonutSlices.map((s) => (
                              <div className="mix-row" key={s.label}>
                                <span className="mix-dot" style={{ background: s.color }} />
                                <span className="mix-name">{s.label}</span>
                                <span className="detail-mix-count">{s.value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="detail-card__hint">{dashboard ? 'No rooms yet.' : 'Loading…'}</p>
                      )}
                    </div>
                  </div>
                )}

                {lodge.serves_food && (
                  <div className="detail-card-row">
                    <div className="analytics-card">
                      <div className="analytics-card-head">
                        <div className="detail-card-title-group">
                          <span className="detail-card__icon">
                            <Icons.Menu />
                          </span>
                          <span className="analytics-card-title">Food orders</span>
                        </div>
                        <select
                          className="detail-period-select"
                          value={foodPeriod}
                          onChange={(e) => setFoodPeriod(e.target.value)}
                          aria-label="Food orders period"
                        >
                          <option value="today">Today</option>
                          <option value="7d">Last 7 days</option>
                        </select>
                      </div>
                      {dashboard && foodDonutSlices.length > 0 ? (
                        <div className="donut-wrap">
                          <Donut slices={foodDonutSlices} centerLabel={String(totalFoodOrders)} centerSub="orders" />
                          <div className="mix-rows">
                            {foodDonutSlices.map((s) => (
                              <div className="mix-row" key={s.label}>
                                <span className="mix-dot" style={{ background: s.color }} />
                                <span className="mix-name">{s.label}</span>
                                <span className="detail-mix-count">{s.value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="detail-card__hint">{dashboard ? 'No orders in this period.' : 'Loading…'}</p>
                      )}
                    </div>

                    <div className="analytics-card">
                      <div className="analytics-card-head">
                        <div className="detail-card-title-group">
                          <span className="detail-card__icon">
                            <Icons.Clock />
                          </span>
                          <span className="analytics-card-title">Last activity</span>
                        </div>
                      </div>
                      {dashboard && dashboard.activity.length > 0 ? (
                        <div className="detail-feed">
                          {dashboard.activity.slice(0, 5).map((a, i) => (
                            <div className="detail-feed-row" key={i}>
                              <span className="detail-feed-row__dot" />
                              <span className="detail-feed-row__what">{ACTIVITY_LABEL[a.type] || a.type}</span>
                              <span className="detail-feed-row__where">
                                {a.detail} · {activityTime(a.occurredAt)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="detail-card__hint">{dashboard ? 'Nothing recorded yet.' : 'Loading…'}</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="detail-card">
                  <div className="detail-card__head">
                    <h2>Quick links</h2>
                  </div>
                  <div className="detail-quicklinks">
                    <div className="detail-quicklink-row">
                      <a className="detail-quicklink" href={`/hotel/${lodge.slug}`} target="_blank" rel="noreferrer">
                        <Icons.Link />
                        <span>Public page</span>
                      </a>
                      <button
                        type="button"
                        className="detail-quicklink detail-quicklink--btn"
                        onClick={() => copyLink(`/hotel/${lodge.slug}`, 'Public page')}
                        aria-label="Copy public page link"
                      >
                        <Icons.Copy />
                      </button>
                    </div>
                    {lodge.food_room_service && (
                      <div className="detail-quicklink-row">
                        <a className="detail-quicklink" href={`/order/${lodge.slug}`} target="_blank" rel="noreferrer">
                          <Icons.Link />
                          <span>Room ordering</span>
                        </a>
                        <button
                          type="button"
                          className="detail-quicklink detail-quicklink--btn"
                          onClick={() => copyLink(`/order/${lodge.slug}`, 'Room ordering')}
                          aria-label="Copy room ordering link"
                        >
                          <Icons.Copy />
                        </button>
                      </div>
                    )}
                    {lodge.latitude != null && lodge.longitude != null && (
                      <div className="detail-quicklink-row">
                        <a
                          className="detail-quicklink"
                          href={`https://www.google.com/maps?q=${lodge.latitude},${lodge.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Icons.Map />
                          <span>Open in Maps</span>
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <div className="detail-card-row">
                <Card id="contact" icon="Map" innerRef={(el) => { sectionRefs.current.contact = el; }} title="Property & contact">
                  <dl>
                    <Row label="Lodge phone">{lodge.phone}</Row>
                    <Row label="WhatsApp">{lodge.whatsapp_number}</Row>
                    <Row label="Address">{lodge.address}</Row>
                    <Row label="City / state">{[lodge.city, lodge.state].filter(Boolean).join(', ') || '—'}</Row>
                    <Row label="Map location">
                      {lodge.latitude != null && lodge.longitude != null ? (
                        <a
                          href={`https://www.google.com/maps?q=${lodge.latitude},${lodge.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {Number(lodge.latitude)}, {Number(lodge.longitude)}
                        </a>
                      ) : (
                        'Not set — add it with Edit lodge'
                      )}
                    </Row>
                  </dl>
                </Card>

                <Card id="billing" icon="File" innerRef={(el) => { sectionRefs.current.billing = el; }} title="Billing & GST">
                  <dl>
                    {/* No "GST registered: Yes/No" row — the sidebar badge
                        already says that; this card keeps only what the
                        badge doesn't show. */}
                    <Row label="GSTIN">{lodge.gstin}</Row>
                    <Row label="Specified premises">
                      {lodge.is_specified_premises ? 'Yes — food taxed at 18% with ITC' : 'No'}
                    </Row>
                    {data.invoiceSeries.length === 0 ? (
                      <Row label="Invoice series">Not started — no bill issued yet</Row>
                    ) : (
                      data.invoiceSeries.map((series) => (
                        <Row key={series.series_type} label={`${series.series_type} series`}>
                          {series.prefix} · next #{series.next_number}
                        </Row>
                      ))
                    )}
                  </dl>
                </Card>

                {lodge.has_rooms && (
                  <Card id="checkin" icon="Clock" innerRef={(el) => { sectionRefs.current.checkin = el; }} title="Check-in & checkout">
                    <dl>
                      <Row label="Check-in cycle">{CHECKIN_LABEL[lodge.checkin_mode] || lodge.checkin_mode}</Row>
                      {/* A fixed checkout time is the deadline only on a
                          night-based property. On a 24-hour one the deadline is
                          24 hours per night from the guest's own arrival, and
                          check_out_time survives purely as the fallback for a
                          stay that was never formally checked in — showing it
                          here reads as "everyone leaves at 11:00", which is the
                          opposite of how this property works. */}
                      {lodge.checkin_mode === 'NIGHT_BASED' && (
                        <Row label="Checkout time">{formatTime(lodge.check_out_time)}</Row>
                      )}
                      {(lodge.checkin_mode === 'CYCLE' || lodge.checkin_mode === 'HYBRID') && (
                        <>
                          <Row label="Check-in from">{formatTime(lodge.check_in_time)}</Row>
                          <Row label="Checkout by">{formatTime(lodge.check_out_time)}</Row>
                        </>
                      )}
                      <Row label="Grace period">{formatDuration(lodge.late_grace_minutes)}</Row>
                      <Row label="After grace">{lodge.late_half_day_percent}% of a night</Row>
                      <Row label={`Past ${formatDuration(lodge.late_full_day_after_minutes)} late`}>
                        {lodge.late_full_day_percent}% of a night
                      </Row>
                    </dl>
                  </Card>
                )}
              </div>

              <Card
                id="sections"
                icon="Grid"
                innerRef={(el) => { sectionRefs.current.sections = el; }}
                title="Sections this account gets"
                meta={`${featureGroups.length} groups`}
                hint="What the owner sees in their sidebar, from the capability flags on this property."
              >
                <div className="detail-icon-grid">
                  {featureGroups.map(({ group, features }) => (
                    <div className="detail-icon-tile" key={group} title={features.map((f) => f.title).join(', ')}>
                      <div className="detail-icon-tile__ic">
                        <Icon name={GROUP_ICON[group] || 'building'} size={18} />
                      </div>
                      <span>{group}</span>
                    </div>
                  ))}
                </div>
              </Card>

              <section id="staff" ref={(el) => { sectionRefs.current.staff = el; }} className="detail-card">
                <div className="detail-card__head">
                  <span className="detail-card__icon">
                    <Icons.Users />
                  </span>
                  <h2>Staff &amp; owner logins</h2>
                  <span className="detail-staff-card__count">{data.staff.length}</span>
                </div>
                {data.staff.length === 0 ? (
                  <p className="detail-card__hint">No logins on this property.</p>
                ) : (
                  <div className="dash-table-scroll">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Role</th>
                          <th>Phone</th>
                          <th>Email</th>
                          <th>Status</th>
                          <th>Added</th>
                          <th>Last seen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.staff.map((user) => (
                          <tr key={user.id}>
                            <td className="dash-lodge-name">{user.name}</td>
                            <td>{user.role}</td>
                            <td>{user.phone}</td>
                            <td>{user.email || '—'}</td>
                            <td>
                              <span className={`badge ${user.is_active ? 'badge--on' : 'badge--inactive'}`}>
                                {user.is_active ? 'Active' : 'Disabled'}
                              </span>
                            </td>
                            <td>{formatDate(user.created_at)}</td>
                            <td>{formatDateTime(user.last_seen)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {lodge.serves_food && (
                <Card id="tools" icon="Wrench" innerRef={(el) => { sectionRefs.current.tools = el; }} title="Tools" hint="Bulk-load this property's menu from a spreadsheet.">
                  <MenuExcelImport
                    importPath={`/internal/lodges/${id}/menu/import`}
                    token={session?.token}
                    onImported={load}
                  />
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
