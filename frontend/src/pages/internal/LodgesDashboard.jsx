import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet, ApiError } from '../../lib/api';
import { clearSession, getSession } from '../../lib/auth';
import ConfirmDialog from '../../components/ConfirmDialog';
import { propertyTypeOf } from '../../lib/propertyProfile';
import './LodgesDashboard.css';

const CHECKIN_LABEL = {
  HOUR_24: '24-hour',
  NIGHT_BASED: 'Night-based',
};

// The API returns snake_case rows straight from the database here, so the flags
// are mapped before propertyTypeOf (which speaks the camelCase shape /me uses).
// A lodge whose owner has since switched food off no longer matches a preset —
// it falls back to a plain description rather than a misleading label.
function describeType(lodge) {
  const type = propertyTypeOf({
    hasRooms: lodge.has_rooms,
    servesFood: lodge.serves_food,
  });
  if (type) return type.label;
  return lodge.has_rooms ? 'Lodge' : 'No rooms, no food';
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function LodgesDashboard() {
  const navigate = useNavigate();
  const session = getSession();
  const [lodges, setLodges] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;

    apiGet('/internal/lodges', { token: session?.token })
      .then((data) => {
        if (!ignore) setLodges(data.lodges);
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof ApiError ? err.message : 'Could not load lodges.');
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
    navigate('/vtadmin', { replace: true });
  };

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
      <div className="dash-topbar">
        <div>
          <div className="dash-topbar__mark">Lodge Management System</div>
          <div className="dash-topbar__eyebrow">Vengurla Tech admin{session?.name ? ` · ${session.name}` : ''}</div>
        </div>
        <button className="dash-topbar__signout" onClick={() => setConfirmSignOut(true)} type="button">
          Sign out
        </button>
      </div>

      <div className="dash-main">
        <div className="dash-header">
          <div>
            <h1>Onboarded lodges</h1>
            <p className="dash-header__count">
              {lodges === null ? 'Loading…' : `${lodges.length} ${lodges.length === 1 ? 'lodge' : 'lodges'}`}
            </p>
          </div>
          <Link className="btn-accent" to="/vt-internal/lodges/new">
            + Add new lodge
          </Link>
        </div>

        <div className="dash-card">
          {error && <div className="dash-state">{error}</div>}

          {!error && lodges === null && <div className="dash-state">Loading lodges…</div>}

          {!error && lodges?.length === 0 && (
            <div className="dash-state">No lodges yet. Add the first one to get started.</div>
          )}

          {!error && lodges?.length > 0 && (
            <div className="dash-table-scroll">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Lodge</th>
                    <th>Type</th>
                    <th>Owner</th>
                    <th>Location</th>
                    <th>Check-in</th>
                    <th>GST</th>
                    <th>Status</th>
                    <th>Onboarded</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {lodges.map((lodge) => (
                    <tr key={lodge.id}>
                      <td>
                        <div className="dash-lodge-name">{lodge.name}</div>
                        <div className="dash-lodge-slug">{lodge.slug}</div>
                      </td>
                      <td>
                        <span className="badge badge--accent">{describeType(lodge)}</span>
                      </td>
                      <td>
                        {lodge.owner_name || '—'}
                        {lodge.owner_phone && <div className="dash-owner-phone">{lodge.owner_phone}</div>}
                      </td>
                      <td>{[lodge.city, lodge.state].filter(Boolean).join(', ') || '—'}</td>
                      <td>{lodge.has_rooms ? CHECKIN_LABEL[lodge.checkin_mode] || lodge.checkin_mode : '—'}</td>
                      <td>
                        <span className={`badge ${lodge.is_gst_registered ? 'badge--on' : 'badge--off'}`}>
                          {lodge.is_gst_registered ? 'Registered' : 'Non-GST'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${lodge.is_active ? 'badge--on' : 'badge--inactive'}`}>
                          {lodge.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>{formatDate(lodge.created_at)}</td>
                      <td className="dash-table__actions">
                        <Link className="btn-view" to={`/vt-internal/lodges/${lodge.id}`}>
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
