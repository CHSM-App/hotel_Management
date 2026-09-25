import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet, ApiError } from '../../lib/api';
import { clearSession, getSession } from '../../lib/auth';
import ConfirmDialog from '../../components/ConfirmDialog';
import { EyeIcon } from '../../components/ActionIcons';
import '../../components/IconButton.css';
import { propertyTypeOf } from '../../lib/propertyProfile';
import { downloadLodgesExcel } from '../lodge/lodgesExportFile';
import './LodgesDashboard.css';

const CHECKIN_LABEL = {
  HOUR_24: '24-hour',
  NIGHT_BASED: 'Night-based',
  CYCLE: 'Fixed cycle',
};

// The API returns snake_case rows straight from the database here, so the flags
// are mapped before propertyTypeOf (which speaks the camelCase shape /me uses).
// A lodge whose owner has since switched food off no longer matches a preset —
// it falls back to a plain description rather than a misleading label.
function describeType(lodge) {
  const type = propertyTypeOf({
    hasRooms: lodge.has_rooms,
    servesFood: lodge.serves_food,
    hasEvents: lodge.has_events,
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

// Every column a header can be clicked to sort by, and how to read the value
// being compared out of a lodge row. Kept as data so the header loop and the
// actual sort both read off the same list instead of drifting apart.
const COLUMNS = [
  { key: 'name', label: 'Lodge', get: (l) => l.name || '' },
  { key: 'type', label: 'Type', get: (l) => describeType(l) },
  { key: 'owner_name', label: 'Owner', get: (l) => l.owner_name || '' },
  { key: 'city', label: 'Location', get: (l) => [l.city, l.state].filter(Boolean).join(', ') },
  { key: 'checkin_mode', label: 'Check-in', get: (l) => (l.has_rooms ? CHECKIN_LABEL[l.checkin_mode] || l.checkin_mode : '') },
  { key: 'is_gst_registered', label: 'GST', get: (l) => (l.is_gst_registered ? 1 : 0) },
  { key: 'is_active', label: 'Status', get: (l) => (l.is_active ? 1 : 0) },
  { key: 'created_at', label: 'Onboarded', get: (l) => l.created_at },
];

const TYPE_FILTERS = ['Lodge', 'Lodge with meals', 'Restaurant'];

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

  // Search, filter chips and sort — all client-side over a list this small,
  // the same way every other register in this app filters what's already on
  // screen rather than round-tripping to the server for it.
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState(null);
  const [gstFilter, setGstFilter] = useState(null); // null | 'gst' | 'non-gst'
  const [statusFilter, setStatusFilter] = useState(null); // null | 'active' | 'inactive'
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });

  const toggleSort = (key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  const filtered = useMemo(() => {
    if (!lodges) return null;
    const term = search.trim().toLowerCase();
    let rows = lodges.filter((l) => {
      if (term) {
        const haystack = `${l.name} ${l.slug} ${l.owner_name || ''} ${l.owner_phone || ''} ${l.city || ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (typeFilter && describeType(l) !== typeFilter) return false;
      if (gstFilter === 'gst' && !l.is_gst_registered) return false;
      if (gstFilter === 'non-gst' && l.is_gst_registered) return false;
      if (statusFilter === 'active' && !l.is_active) return false;
      if (statusFilter === 'inactive' && l.is_active) return false;
      return true;
    });

    const column = COLUMNS.find((c) => c.key === sort.key);
    if (column) {
      rows = [...rows].sort((a, b) => {
        const av = column.get(a);
        const bv = column.get(b);
        const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [lodges, search, typeFilter, gstFilter, statusFilter, sort]);

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadLodgesExcel(filtered || [], { describeType, checkinLabel: CHECKIN_LABEL });
    } finally {
      setExporting(false);
    }
  };

  const activeFilterCount = [typeFilter, gstFilter, statusFilter].filter(Boolean).length;
  const clearFilters = () => {
    setTypeFilter(null);
    setGstFilter(null);
    setStatusFilter(null);
    setSearch('');
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
              {lodges === null
                ? 'Loading…'
                : filtered.length === lodges.length
                  ? `${lodges.length} ${lodges.length === 1 ? 'lodge' : 'lodges'}`
                  : `${filtered.length} of ${lodges.length} lodges`}
            </p>
          </div>
          <div className="dash-header__actions">
            {lodges?.length > 0 && (
              <button className="btn-outline" type="button" onClick={handleExport} disabled={exporting}>
                {exporting ? 'Exporting…' : '⇩ Export to Excel'}
              </button>
            )}
            <Link className="btn-accent" to="/vt-internal/lodges/new">
              + Add new lodge
            </Link>
          </div>
        </div>

        {lodges?.length > 0 && (
          <div className="dash-toolbar">
            <div className="dash-search">
              <span className="dash-search__icon" aria-hidden="true">⌕</span>
              <input
                type="text"
                placeholder="Search by lodge, slug, owner or phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="dash-filters">
              <select
                className={`dash-select ${typeFilter ? 'dash-select--on' : ''}`}
                value={typeFilter || ''}
                onChange={(e) => setTypeFilter(e.target.value || null)}
              >
                <option value="">All types</option>
                {TYPE_FILTERS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              <select
                className={`dash-select ${gstFilter ? 'dash-select--on' : ''}`}
                value={gstFilter || ''}
                onChange={(e) => setGstFilter(e.target.value || null)}
              >
                <option value="">All GST</option>
                <option value="gst">GST registered</option>
                <option value="non-gst">Non-GST</option>
              </select>

              <select
                className={`dash-select ${statusFilter ? 'dash-select--on' : ''}`}
                value={statusFilter || ''}
                onChange={(e) => setStatusFilter(e.target.value || null)}
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>

              {(activeFilterCount > 0 || search) && (
                <button type="button" className="dash-clear" onClick={clearFilters}>
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        <div className="dash-card">
          {error && <div className="dash-state">{error}</div>}

          {!error && lodges === null && <div className="dash-state">Loading lodges…</div>}

          {!error && lodges?.length === 0 && (
            <div className="dash-state">No lodges yet. Add the first one to get started.</div>
          )}

          {!error && lodges?.length > 0 && filtered.length === 0 && (
            <div className="dash-state">No lodges match these filters.</div>
          )}

          {!error && filtered?.length > 0 && (
            <div className="dash-table-scroll">
              <table className="dash-table dash-table--sheet">
                <thead>
                  <tr>
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className={`dash-th--sortable ${sort.key === col.key ? 'dash-th--sorted' : ''}`}
                        onClick={() => toggleSort(col.key)}
                      >
                        <span>{col.label}</span>
                        <span className="dash-sort-arrow" aria-hidden="true">
                          {sort.key === col.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                        </span>
                      </th>
                    ))}
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((lodge) => (
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
                        {/* A Link, not a button, so it can't use IconButton —
                            but it wears the same icon-btn styling and carries
                            the same data-tooltip, which the CSS draws off any
                            element. */}
                        <Link
                          className="icon-btn"
                          to={`/vt-internal/lodges/${lodge.id}`}
                          aria-label={`View ${lodge.name}`}
                          data-tooltip={`View ${lodge.name}`}
                        >
                          <EyeIcon />
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
