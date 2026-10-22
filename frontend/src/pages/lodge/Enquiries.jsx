import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { toWhatsAppDigits } from '../../lib/shareLinks';
import PageLoader from '../../components/PageLoader';
import './forms.css';
import './OrdersPanel.css';
import './Billing.css';
import './Enquiries.css';

const KIND_LABEL = { ROOM: 'Room', EVENT: 'Event', SERVICE: 'Service', GENERAL: 'General' };
const STATUS_LABEL = { NEW: 'New', CONTACTED: 'Contacted', CONVERTED: 'Converted', CLOSED: 'Closed' };
const FILTERS = ['ALL', 'NEW', 'CONTACTED', 'CONVERTED', 'CLOSED'];

const COLUMNS = [
  { key: 'guest', label: 'Guest' },
  { key: 'phone', label: 'Phone' },
  { key: 'kind', label: 'Type' },
  { key: 'looking', label: 'Looking for' },
  { key: 'received', label: 'Received' },
  { key: 'status', label: 'Status' },
];

function shortDay(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// What the guest actually asked for, as one short line. The full message they
// composed is stored on `summary`.
function lookingFor(e) {
  const guests = e.guests ? `${e.guests} guest${e.guests === 1 ? '' : 's'}` : '';
  if (e.kind === 'ROOM') {
    const range = e.checkInDate ? `${shortDay(e.checkInDate)} → ${shortDay(e.checkOutDate)}` : '';
    return [range, guests].filter(Boolean).join(' · ') || '—';
  }
  if (e.kind === 'EVENT') {
    return [e.eventType, shortDay(e.eventDate), guests].filter(Boolean).join(' · ') || '—';
  }
  return e.notes ? 'See note' : '—';
}

const SORT_VALUE = {
  guest: (e) => e.name.toLowerCase(),
  phone: (e) => e.phone,
  kind: (e) => e.kind,
  looking: (e) => e.checkInDate || e.eventDate || '',
  received: (e) => new Date(e.createdAt).getTime(),
  status: (e) => e.status,
};

export default function Enquiries({ onChanged }) {
  const session = getSession();
  const [filter, setFilter] = useState('NEW');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'received', dir: -1 });
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await apiGet('/enquiries', { token: session?.token });
      setRows(d.enquiries);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load enquiries.');
    }
  }, [session?.token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const matchesSearch = useCallback(
    (e) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [e.name, e.phone, e.referenceCode, KIND_LABEL[e.kind]].some((v) => String(v || '').toLowerCase().includes(q));
    },
    [search]
  );

  const counts = useMemo(() => {
    const c = { ALL: 0, NEW: 0, CONTACTED: 0, CONVERTED: 0, CLOSED: 0 };
    (rows || []).filter(matchesSearch).forEach((r) => {
      c.ALL += 1;
      c[r.status] += 1;
    });
    return c;
  }, [rows, matchesSearch]);

  const visible = useMemo(() => {
    const list = (rows || []).filter((r) => (filter === 'ALL' || r.status === filter) && matchesSearch(r));
    const get = SORT_VALUE[sort.key];
    return [...list].sort((a, b) => (get(a) > get(b) ? 1 : get(a) < get(b) ? -1 : 0) * sort.dir);
  }, [rows, filter, matchesSearch, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'received' ? -1 : 1 }));

  const setStatus = async (id, status) => {
    setBusyId(id);
    try {
      await apiPatch(`/enquiries/${id}`, { status }, { token: session?.token });
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this enquiry.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      {error && <div className="form-banner form-banner--error">{error}</div>}
      {!rows && !error && <PageLoader inline label="Loading" />}

      {rows && rows.length === 0 && (
        <div className="dash-state">No enquiries yet. When a guest sends one from your public page it appears here.</div>
      )}

      {rows && rows.length > 0 && (
        <div className="billing-panel__bill-search-row billing-panel__bill-search-row--compact">
          <div className="field billing-panel__bill-search">
            <svg className="billing-panel__bill-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              aria-label="Search enquiries"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Guest, phone or reference"
            />
            {search && (
              <button type="button" className="billing-panel__bill-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                ×
              </button>
            )}
          </div>
          <div className="billing-panel__filters">
            {FILTERS.map((f) => (
              <button key={f} type="button" className="billing-panel__filter" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'ALL' ? 'All' : STATUS_LABEL[f]}
                <span className="billing-panel__filter-count">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {rows && rows.length > 0 && visible.length === 0 && (
        <div className="dash-state">No enquiries match your search or filter.</div>
      )}

      {visible.length > 0 && (
        <section className="history-sheet billing-sheet">
          <div className="history-table-wrap">
            <table className="history-table billing-sheet__ready enquiries-sheet">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                      <button type="button" className="billing-sheet__sort" onClick={() => toggleSort(c.key)} title={`Sort by ${c.label}`}>
                        {c.label}
                        <span className="billing-sheet__sort-icon" aria-hidden="true">
                          {sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : '⇅'}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => {
                  const busy = busyId === e.id;
                  const open = e.status === 'NEW' || e.status === 'CONTACTED';
                  return (
                    <tr key={e.id} className="history-table__row">
                      <td className="history-table__strong">
                        {e.name}
                        <div className="enquiries-sheet__ref">{e.referenceCode}</div>
                      </td>
                      <td>{e.phone}</td>
                      <td>
                        <span className="history-table__where">{KIND_LABEL[e.kind] || e.kind}</span>
                      </td>
                      <td title={e.notes || undefined}>
                        {lookingFor(e)}
                        {e.notes && <div className="enquiries-sheet__note">“{e.notes}”</div>}
                      </td>
                      <td>{formatDateTime(e.createdAt)}</td>
                      <td>
                        <span className={`enquiries-sheet__status enquiries-sheet__status--${e.status.toLowerCase()}`}>{STATUS_LABEL[e.status]}</span>
                      </td>
                      <td className="history-table__actions">
                        <div className="history-table__actions-inner">
                          <a className="history-table__btn" href={`https://wa.me/${toWhatsAppDigits(e.phone)}`} target="_blank" rel="noopener noreferrer">
                            WhatsApp
                          </a>
                          {e.status === 'NEW' && (
                            <button type="button" className="history-table__btn" disabled={busy} onClick={() => setStatus(e.id, 'CONTACTED')}>
                              Contacted
                            </button>
                          )}
                          {open && (
                            <>
                              <button type="button" className="history-table__btn history-table__btn--primary" disabled={busy} onClick={() => setStatus(e.id, 'CONVERTED')}>
                                Converted
                              </button>
                              <button type="button" className="history-table__btn" disabled={busy} onClick={() => setStatus(e.id, 'CLOSED')}>
                                Close
                              </button>
                            </>
                          )}
                          {!open && (
                            <button type="button" className="history-table__btn" disabled={busy} onClick={() => setStatus(e.id, 'NEW')}>
                              Reopen
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7}>
                    {visible.length} enquir{visible.length === 1 ? 'y' : 'ies'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="billing-sheet__note">Enquiries are kept for 30 days. Mark one Converted once the booking is made.</p>
        </section>
      )}
    </div>
  );
}
