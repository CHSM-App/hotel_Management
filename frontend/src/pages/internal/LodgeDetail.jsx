import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiGet, ApiError } from '../../lib/api';
import { clearSession, getSession } from '../../lib/auth';
import ConfirmDialog from '../../components/ConfirmDialog';
import LodgeEditModal from './LodgeEditModal';
import { featuresForCapabilities, propertyTypeOf, SIDEBAR_GROUP_ORDER } from '../../lib/propertyProfile';
import './LodgesDashboard.css';
import './LodgeDetail.css';

const CHECKIN_LABEL = {
  HOUR_24: '24-hour cycle, counted from check-in',
  NIGHT_BASED: 'Night-based, fixed checkout time',
  CYCLE: 'Fixed check-in / checkout cycle, whole nights',
};

const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

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

function Row({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children ?? '—'}</dd>
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="detail-stat">
      <div className="detail-stat__value">{value}</div>
      <div className="detail-stat__label">{label}</div>
      {note && <div className="detail-stat__note">{note}</div>}
    </div>
  );
}

export default function LodgeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const session = getSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;
    setData(null);
    setError('');

    apiGet(`/internal/lodges/${id}`, { token: session?.token })
      .then((payload) => {
        if (!ignore) setData(payload);
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof ApiError ? err.message : 'Could not load this lodge.');
        }
      });

    return () => {
      ignore = true;
    };
  }, [id, session?.token]);

  // Signing out drops the session and everything cached behind it, and a
  // half-written booking with it — worth one question at a shared front desk
  // where the button sits next to the profile menu people open all day.
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [editing, setEditing] = useState(false);

  const handleSignOut = () => {
    clearSession();
    navigate('/vtadmin', { replace: true });
  };

  const lodge = data?.lodge;
  const stats = data?.stats;

  // The same flag-to-preset translation the list uses, so a property is
  // described identically in both places.
  const capabilities = lodge && {
    hasRooms: lodge.has_rooms,
    servesFood: lodge.serves_food,
    foodRoomService: lodge.food_room_service,
    foodTableService: lodge.food_table_service,
    hasEvents: lodge.has_events,
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

  return (
    <div className="dash-shell">
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
          stats={stats}
          onClose={() => setEditing(false)}
          onSaved={(detail) => {
            setData(detail);
            setEditing(false);
          }}
        />
      )}
      <div className="dash-topbar">
        <div>
          <div className="dash-topbar__mark">Lodge Management System</div>
          <div className="dash-topbar__eyebrow">
            Vengurla Tech admin{session?.name ? ` · ${session.name}` : ''}
          </div>
        </div>
        <button className="dash-topbar__signout" onClick={() => setConfirmSignOut(true)} type="button">
          Sign out
        </button>
      </div>

      <div className="dash-main detail-main">
        <Link className="detail-back" to="/vt-internal/dashboard">
          ← All properties
        </Link>

        {error && <div className="dash-card dash-state">{error}</div>}
        {!error && !data && <div className="dash-card dash-state">Loading…</div>}

        {!error && data && (
          <>
            <div className="detail-header">
              <div>
                <h1>{lodge.name}</h1>
                <div className="detail-header__slug">/{lodge.slug}</div>
              </div>
              <div className="detail-header__badges">
                {type && <span className="badge badge--accent">{type.label}</span>}
                <span className={`badge ${lodge.is_gst_registered ? 'badge--on' : 'badge--off'}`}>
                  {lodge.is_gst_registered ? 'GST registered' : 'Non-GST'}
                </span>
                <span className={`badge ${lodge.is_active ? 'badge--on' : 'badge--inactive'}`}>
                  {lodge.is_active ? 'Active' : 'Inactive'}
                </span>
                <button type="button" className="btn-accent" onClick={() => setEditing(true)}>
                  Edit lodge
                </button>
              </div>
            </div>

            <div className="detail-stats">
              {lodge.has_rooms && (
                <>
                  <Stat
                    label="Rooms"
                    value={stats.rooms}
                    note={`${stats.rooms_active} active · ${stats.categories} categories`}
                  />
                  <Stat
                    label="Bookings"
                    value={stats.bookings}
                    note={`${stats.bookings_in_house} in house · ${stats.bookings_upcoming} upcoming`}
                  />
                </>
              )}
              {lodge.serves_food && (
                <>
                  <Stat
                    label="Menu items"
                    value={stats.menu_items}
                    note={`${stats.menu_categories} categories`}
                  />
                  <Stat
                    label="Food orders"
                    value={stats.food_orders}
                    note={lodge.food_table_service ? `${stats.dining_tables} dining tables` : 'Room service only'}
                  />
                </>
              )}
              <Stat
                label="Invoices issued"
                value={stats.invoices_issued}
                note={stats.invoices_void ? `${stats.invoices_void} voided` : 'None voided'}
              />
              <Stat label="Billed to date" value={money.format(stats.billed_total)} note="Issued documents only" />
            </div>

            <div className="detail-grid">
              <section className="detail-card">
                <h2>Property &amp; contact</h2>
                <dl>
                  <Row label="Lodge phone">{lodge.phone}</Row>
                  <Row label="WhatsApp">{lodge.whatsapp_number}</Row>
                  <Row label="Address">{lodge.address}</Row>
                  <Row label="City / state">
                    {[lodge.city, lodge.state].filter(Boolean).join(', ') || '—'}
                  </Row>
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
                  <Row label="Onboarded">{formatDate(lodge.created_at)}</Row>
                  <Row label="Public page">
                    <a href={`/lodge/${lodge.slug}`} target="_blank" rel="noreferrer">
                      /lodge/{lodge.slug}
                    </a>
                  </Row>
                  {lodge.food_room_service && (
                    <Row label="Room ordering link">
                      <a href={`/order/${lodge.slug}`} target="_blank" rel="noreferrer">
                        /order/{lodge.slug}
                      </a>
                    </Row>
                  )}
                </dl>
              </section>

              <section className="detail-card">
                <h2>Billing &amp; GST</h2>
                <dl>
                  <Row label="GST registered">{lodge.is_gst_registered ? 'Yes' : 'No'}</Row>
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
              </section>

              {lodge.has_rooms && (
                <section className="detail-card">
                  <h2>Check-in &amp; late checkout</h2>
                  <dl>
                    <Row label="Check-in cycle">
                      {CHECKIN_LABEL[lodge.checkin_mode] || lodge.checkin_mode}
                    </Row>
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
                    {lodge.checkin_mode === 'CYCLE' && (
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
                </section>
              )}

              <section className="detail-card">
                <h2>Sections this account gets</h2>
                <p className="detail-card__hint">
                  What the owner sees in their sidebar, from the capability flags on this property.
                </p>
                {featureGroups.map(({ group, features }) => (
                  <div className="detail-features" key={group}>
                    <div className="detail-features__group">{group}</div>
                    <ul>
                      {features.map((f) => (
                        <li key={f.key}>{f.title}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>

              <section className="detail-card detail-card--wide">
                <h2>Staff &amp; logins</h2>
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
                              {/* Still on the password handed over at onboarding —
                                  worth seeing when an owner reports they can't
                                  get in. */}
                              {user.must_reset_password && (
                                <span className="badge badge--off detail-badge-gap">First login pending</span>
                              )}
                            </td>
                            <td>{formatDate(user.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="detail-card detail-card--wide">
                <h2>Last activity</h2>
                <dl className="detail-dl--inline">
                  {lodge.has_rooms && <Row label="Latest booking">{formatDateTime(stats.last_booking_at)}</Row>}
                  {lodge.serves_food && <Row label="Latest food order">{formatDateTime(stats.last_order_at)}</Row>}
                  <Row label="Latest invoice">{formatDateTime(stats.last_invoice_at)}</Row>
                </dl>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
