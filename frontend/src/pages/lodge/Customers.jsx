import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { formatPrice } from './priceFormat';
import Req from '../../components/RequiredMark';
import RowMenu from './RowMenu';
import SectionTabs from './SectionTabs';
import './forms.css';
import './InventoryPanel.css';
import './AnalyticsCharts.css';
import './Customers.css';

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// First letter of up to two words — "Aniket Patil" → "AP", "Aniket" → "A".
// Falls back to "?" for the brief window before a name has loaded.
function initialsOf(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

// Same shape as TABLE_SORT_ACCESSORS in IncomePanel.jsx/ExpensesPanel.jsx.
const TABLE_SORT_ACCESSORS = {
  name: (c) => c.name || '',
  phone: (c) => c.phone || '',
  stays: (c) => c.totalStays || 0,
  spend: (c) => c.totalSpend || 0,
  lastVisit: (c) => (c.lastVisit ? new Date(c.lastVisit).getTime() : 0),
};

// Mirrors bookings.schema.js's normaliseMobile on the server, loosely — this
// is only ever shown back to a desk typing a search term or a new phone
// number, never sent for validation (the server is the one that enforces
// the real 10-digit check).
function typedMobile(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.slice(0, 10);
}

function focusFirstError(errors, fieldIds) {
  const first = Object.keys(fieldIds).find((key) => errors[key]);
  if (!first) return;
  const el = document.getElementById(fieldIds[first]);
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  dateOfBirth: '',
  notes: '',
  tags: '',
  marketingOptIn: false,
  idProofType: '',
  idProofNumber: '',
};

const HISTORY_TYPE_LABEL = { stay: 'Room stay', event: 'Function' };
// Dedicated chip colours rather than the generic inv-tag palette — those are
// brand-purple/warning-yellow, which don't match the blue/amber a history
// card's own left edge already uses. A chip reading a different hue than the
// border it sits inside of is the kind of small inconsistency that undercuts
// "blue means room, amber means function" being learnable at a glance.
const HISTORY_TAG_CLASS = { stay: 'cust-type-chip--stay', event: 'cust-type-chip--event' };

// Each history row's own status — a stay and a function don't share a status
// enum (CHECKED_OUT only ever means a room, SETTLED only ever means a
// function), so this is two small maps rather than one trying to cover both.
const STAY_ROW_STATUS_LABEL = { BOOKED: 'Reserved', CHECKED_IN: 'Checked in', CHECKED_OUT: 'Stayed', CANCELLED: 'Cancelled' };
const EVENT_ROW_STATUS_LABEL = { DRAFT: 'Draft', CONFIRMED: 'Confirmed', SETTLED: 'Settled', CANCELLED: 'Cancelled' };
const ROW_STATUS_TAG_CLASS = {
  BOOKED: 'inv-tag--info',
  CHECKED_IN: 'inv-tag--good',
  CHECKED_OUT: 'inv-tag--good',
  CONFIRMED: 'inv-tag--info',
  SETTLED: 'inv-tag--good',
  DRAFT: 'inv-tag--off',
  CANCELLED: 'inv-tag--bad',
};
function rowStatusLabel(h) {
  const label = h.type === 'stay' ? STAY_ROW_STATUS_LABEL[h.status] : EVENT_ROW_STATUS_LABEL[h.status];
  return label || h.status;
}

export default function Customers() {
  const session = getSession();

  const [activeTab, setActiveTab] = useState('customers');

  const [customers, setCustomers] = useState(() => readCache('/customers') || []);
  const [stats, setStats] = useState(() => readCache('/customers:stats') || { total: 0, optedIn: 0 });
  const [loading, setLoading] = useState(customers.length === 0);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [optInOnly, setOptInOnly] = useState(false);
  const [tableSort, setTableSort] = useState({ key: 'lastVisit', dir: 'desc' });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [viewMode, setViewMode] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = () =>
    apiGet('/customers', { token: session?.token })
      .then((data) => {
        setCustomers(writeCache('/customers', data.customers));
        setStats(writeCache('/customers:stats', data.stats));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load customers.'))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // All-time, not date-ranged like the Reports tab's own feedback section —
  // fetched once per visit to this tab rather than on every render, same
  // reasoning as the Expenses/Assets history fetches elsewhere.
  const [feedback, setFeedback] = useState(null);
  const [feedbackError, setFeedbackError] = useState('');
  useEffect(() => {
    if (activeTab !== 'feedback' || feedback) return;
    apiGet('/customers/feedback', { token: session?.token })
      .then((data) => setFeedback(data))
      .catch((err) => setFeedbackError(err instanceof ApiError ? err.message : 'Could not load feedback.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (customers || []).filter((c) => {
      if (optInOnly && !c.marketingOptIn) return false;
      if (q) {
        const haystack = `${c.name} ${c.phone} ${c.email || ''} ${c.tags || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [customers, search, optInOnly]);

  const sorted = useMemo(() => {
    const accessor = TABLE_SORT_ACCESSORS[tableSort.key];
    if (!accessor) return filtered;
    const dir = tableSort.dir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), 'en-IN', { numeric: true, sensitivity: 'base' }) * dir;
    });
  }, [filtered, tableSort]);

  const toggleTableSort = (key) => {
    setTableSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: null, dir: 'asc' };
    });
  };

  const openCustomer = async (row) => {
    setFormError('');
    setFieldErrors({});
    setEditingId(row.id);
    setViewMode(true);
    setForm({
      name: row.name || '',
      phone: row.phone || '',
      email: row.email || '',
      dateOfBirth: row.dateOfBirth ? String(row.dateOfBirth).slice(0, 10) : '',
      notes: row.notes || '',
      tags: row.tags || '',
      marketingOptIn: Boolean(row.marketingOptIn),
      idProofType: row.idProofType || '',
      idProofNumber: row.idProofNumber || '',
    });
    setShowForm(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      const { customer } = await apiGet(`/customers/${row.id}`, { token: session?.token });
      setDetail(customer);
      setForm({
        name: customer.name || '',
        phone: customer.phone || '',
        email: customer.email || '',
        dateOfBirth: customer.dateOfBirth ? String(customer.dateOfBirth).slice(0, 10) : '',
        notes: customer.notes || '',
        tags: customer.tags || '',
        marketingOptIn: Boolean(customer.marketingOptIn),
        idProofType: customer.idProofType || '',
        idProofNumber: customer.idProofNumber || '',
      });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not load this customer.');
    } finally {
      setDetailLoading(false);
    }
  };

  const openNewCustomer = () => {
    setFormError('');
    setFieldErrors({});
    setEditingId(null);
    setViewMode(false);
    setDetail(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!form.name.trim()) errors.name = 'Enter the customer’s name.';
    if (!editingId && !/^[6-9]\d{9}$/.test(typedMobile(form.phone))) {
      errors.phone = 'Enter a valid 10-digit mobile number.';
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = 'Enter a valid email.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors, { name: 'custName', phone: 'custPhone', email: 'custEmail' });
      return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      if (editingId) {
        const { customer } = await apiPatch(
          `/customers/${editingId}`,
          {
            name: form.name,
            email: form.email,
            dateOfBirth: form.dateOfBirth,
            notes: form.notes,
            tags: form.tags,
            marketingOptIn: form.marketingOptIn,
            idProofType: form.idProofType,
            idProofNumber: form.idProofNumber,
          },
          { token: session?.token }
        );
        setDetail(customer);
        setViewMode(true);
      } else {
        await apiPost(
          '/customers',
          {
            name: form.name,
            phone: typedMobile(form.phone),
            email: form.email,
            dateOfBirth: form.dateOfBirth,
            notes: form.notes,
            tags: form.tags,
            marketingOptIn: form.marketingOptIn,
          },
          { token: session?.token }
        );
        setShowForm(false);
      }
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this customer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {error && <div className="form-banner form-banner--error">{error}</div>}

      <div style={{ marginBottom: 16 }}>
        <SectionTabs
          ariaLabel="Customers sections"
          activeId={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: 'customers', name: 'Customers' },
            { id: 'feedback', name: 'Customer Feedbacks', count: feedback?.totals.count },
          ]}
        />
      </div>

      {activeTab === 'feedback' ? (
        <>
          {feedbackError && <div className="form-banner form-banner--error">{feedbackError}</div>}
          {!feedbackError && !feedback && <p className="inv-panel__hint">Loading feedback…</p>}
          {feedback && (
            <>
              <div className="kpi-row" style={{ marginBottom: 16 }}>
                <div className="kpi-card kpi-card--primary">
                  <span className="kpi-label">Responses</span>
                  <span className="kpi-value">{feedback.totals.count}</span>
                  <span className="kpi-sub">Every submitted response, all-time</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Average rating</span>
                  <span className="kpi-value">{feedback.totals.averageRating == null ? '—' : `${feedback.totals.averageRating} / 5`}</span>
                  <span className="kpi-sub">Across every response on file</span>
                </div>
              </div>

              {feedback.responses.length === 0 ? (
                <p className="inv-panel__hint">
                  No feedback has been submitted yet. It's asked automatically a few hours after a guest checks out, or
                  after a function is marked completed.
                </p>
              ) : (
                <div className="asset-table-wrap">
                  <table className="asset-table">
                    <thead>
                      <tr>
                        <th>Guest / Organiser</th>
                        <th>Stay / Event date</th>
                        <th>Rating</th>
                        <th>Comment</th>
                        <th>Submitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {feedback.responses.map((r) => (
                        <tr key={r.id}>
                          <td className="asset-table__name">{r.guestName || '—'}</td>
                          <td className="asset-table__muted">{formatDate(r.checkOutDate)}</td>
                          <td>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</td>
                          <td className={r.comment ? '' : 'asset-table__muted'}>{r.comment || 'No comment'}</td>
                          <td className="asset-table__muted">{formatDate(r.submittedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
      <div className="kpi-row" style={{ marginBottom: 16 }}>
        <div className="kpi-card kpi-card--primary">
          <span className="kpi-label">Customers</span>
          <span className="kpi-value">{stats.total}</span>
          <span className="kpi-sub">One record per person, across stays and functions</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Opted in to offers</span>
          <span className="kpi-value">{stats.optedIn}</span>
          <span className="kpi-sub">Will matter once marketing messages are built</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">In view</span>
          <span className="kpi-value">{filtered.length}</span>
          <span className="kpi-sub">Matching the search and filters below</span>
        </div>
      </div>

      <div className="inv-bar">
        <div className="inv-bar__row asset-toolbar-row">
          <div className="asset-toolbar-row__filters">
            <div className="inv-search">
              <span className="inv-search__icon" />
              <input placeholder="Search name, phone, email or tag…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <label className="checkbox-inline" style={{ marginBottom: 0 }}>
              <input type="checkbox" checked={optInOnly} onChange={(e) => setOptInOnly(e.target.checked)} />
              Opted in only
            </label>
            {(search || optInOnly) && (
              <button
                type="button"
                className="inv-linkbtn"
                onClick={() => {
                  setSearch('');
                  setOptInOnly(false);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
          <div className="asset-toolbar-row__end">
            <button type="button" className="btn-accent" onClick={openNewCustomer}>
              + Add customer
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="inv-panel__hint">Loading customers…</p>
      ) : sorted.length === 0 ? (
        <p className="inv-panel__hint">
          {customers.length === 0
            ? 'No customers yet. They’ll start showing up here the moment a room booking or a confirmed function is saved — or add one by hand.'
            : 'No customer matches these filters.'}
        </p>
      ) : (
        <div className="asset-table-wrap">
          <table className="asset-table">
            <thead>
              <tr>
                {[
                  ['name', 'Name'],
                  ['phone', 'Phone'],
                  ['stays', 'Stays'],
                  ['spend', 'Total spend'],
                  ['lastVisit', 'Last visit'],
                ].map(([key, label]) => (
                  <th key={key}>
                    <button
                      type="button"
                      className="asset-table__sort-btn"
                      aria-sort={tableSort.key === key ? (tableSort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
                      onClick={() => toggleTableSort(key)}
                    >
                      {label}
                      <span className="asset-table__sort-icon" aria-hidden="true">
                        {tableSort.key === key ? (tableSort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                      </span>
                    </button>
                  </th>
                ))}
                <th>Tags</th>
                <th>Offers</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id} onClick={() => openCustomer(c)} style={{ cursor: 'pointer' }}>
                  <td className="asset-table__name">
                    {c.name}
                    {c.email && <div className="asset-table__muted" style={{ fontSize: 12 }}>{c.email}</div>}
                  </td>
                  <td className="asset-table__mono">{c.phone}</td>
                  <td>{c.totalStays + c.totalEvents}</td>
                  <td className="asset-table__mono">{formatPrice(c.totalSpend)}</td>
                  <td className="asset-table__muted">{formatDate(c.lastVisit)}</td>
                  <td className={c.tags ? '' : 'asset-table__muted'}>{c.tags || '—'}</td>
                  <td>
                    <span className={`inv-tag ${c.marketingOptIn ? 'inv-tag--good' : 'inv-tag--off'}`}>
                      {c.marketingOptIn ? 'Opted in' : 'Opted out'}
                    </span>
                  </td>
                  <td className="asset-table__actions" onClick={(e) => e.stopPropagation()}>
                    <RowMenu label={`More actions for ${c.name}`}>
                      <button type="button" onClick={() => openCustomer(c)}>
                        View profile
                      </button>
                    </RowMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}

      {showForm && (
        <div className="glass-backdrop inv-panel__backdrop" onClick={() => setShowForm(false)}>
          <div
            className={`glass-panel inv-panel__modal modal-form__panel${viewMode ? ' inv-panel__modal--customer' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="customerModalTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-form">
              <div className="modal-form__head">
                {viewMode ? (
                  <div className="cust-head">
                    <div className="cust-identity">
                      <div className="cust-avatar" aria-hidden="true">
                        {initialsOf(form.name)}
                      </div>
                      <div>
                        <h3 id="customerModalTitle">{form.name || 'Customer'}</h3>
                        <div className="cust-subline">
                          <a className="cust-phone-link" href={`tel:${form.phone}`}>
                            {form.phone}
                          </a>
                          <span className={`inv-tag ${form.marketingOptIn ? 'inv-tag--good' : 'inv-tag--off'}`}>
                            {form.marketingOptIn ? 'Opted in to offers' : 'Opted out of offers'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button type="button" className="modal-form__close" onClick={() => setShowForm(false)} aria-label="Close">
                      ×
                    </button>
                  </div>
                ) : (
                  <div className="modal-form__head-row">
                    <h3 id="customerModalTitle">{editingId ? 'Edit customer' : 'Add customer'}</h3>
                    <button type="button" className="modal-form__close" onClick={() => setShowForm(false)} aria-label="Close">
                      ×
                    </button>
                  </div>
                )}
              </div>

              {/* --asset's two-column grid is for the edit form's paired fields
                  (Phone beside Email, etc.) — the view-mode profile is a plain
                  single-column flow and must not inherit that grid, or every
                  top-level block here (stats, facts, "History" label, the card
                  list) gets auto-placed into alternating left/right grid cells
                  instead of stacking. */}
              <div className={`modal-form__body${viewMode ? '' : ' modal-form__body--asset'}`}>
                {formError && <div className="form-banner form-banner--error form-banner--flash">{formError}</div>}

                {viewMode ? (
                  <>
                    <div className="cust-stats">
                      <div className="cust-stat">
                        <span className="cust-stat__label">Room stays</span>
                        <span className="cust-stat__value">{detail ? detail.totalStays : '…'}</span>
                        <span className="cust-stat__sub">{detail ? formatPrice(detail.totalRoomSpend) : ''}</span>
                      </div>
                      <div className="cust-stat">
                        <span className="cust-stat__label">Functions</span>
                        <span className="cust-stat__value">{detail ? detail.totalEvents : '…'}</span>
                        <span className="cust-stat__sub">{detail ? formatPrice(detail.totalEventSpend) : ''}</span>
                      </div>
                      <div className="cust-stat">
                        <span className="cust-stat__label">Total spend</span>
                        <span className="cust-stat__value">{detail ? formatPrice(detail.totalSpend) : '…'}</span>
                        <span className="cust-stat__sub">Rooms + functions</span>
                      </div>
                      <div className="cust-stat">
                        <span className="cust-stat__label">Loyalty points</span>
                        <span className="cust-stat__value">{detail ? detail.loyaltyPoints : '…'}</span>
                        <span className="cust-stat__sub">Coming soon</span>
                      </div>
                    </div>

                    <dl className="cust-facts">
                      <div>
                        <dt>Email</dt>
                        <dd>{form.email || '—'}</dd>
                      </div>
                      <div>
                        <dt>Date of birth</dt>
                        <dd>{form.dateOfBirth ? formatDate(form.dateOfBirth) : '—'}</dd>
                      </div>
                      <div>
                        <dt>Last visit</dt>
                        <dd>{detail ? formatDate(detail.lastVisit) : '…'}</dd>
                      </div>
                      {(form.idProofType || form.idProofNumber) && (
                        <div>
                          <dt>ID proof</dt>
                          <dd>{[form.idProofType, form.idProofNumber].filter(Boolean).join(' · ')}</dd>
                        </div>
                      )}
                      {form.tags && (
                        <div>
                          <dt>Tags</dt>
                          <dd>
                            <div className="cust-tags">
                              {form.tags
                                .split(',')
                                .map((t) => t.trim())
                                .filter(Boolean)
                                .map((t) => (
                                  <span className="cust-tag" key={t}>
                                    {t}
                                  </span>
                                ))}
                            </div>
                          </dd>
                        </div>
                      )}
                      {form.notes && (
                        <div>
                          <dt>Notes</dt>
                          <dd>
                            <div className="cust-notes">{form.notes}</div>
                          </dd>
                        </div>
                      )}
                    </dl>

                    <p className="cust-section-label">
                      <span>History</span>
                      {detail && <span className="inv-tag">{detail.history.length}</span>}
                    </p>
                    {detailLoading ? (
                      <p className="inv-panel__hint">Loading history…</p>
                    ) : !detail || detail.history.length === 0 ? (
                      <p className="inv-panel__hint">No stays or functions on file yet.</p>
                    ) : (
                      <div className="cust-history-wrap">
                        <table className="cust-history-table">
                          <colgroup>
                            <col className="cust-history-table__col-date" />
                            <col />
                            <col className="cust-history-table__col-status" />
                            <col className="cust-history-table__col-amount" />
                          </colgroup>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Details</th>
                              <th>Status</th>
                              <th className="cust-history-table__amount">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.history.map((h) => (
                              <tr key={`${h.type}-${h.id}`}>
                                <td className="cust-history-table__date">{formatDate(h.date)}</td>
                                <td>
                                  <div className="cust-history-table__title">{h.label}</div>
                                  {h.bookingNumber && <div className="cust-history-table__sub">{h.bookingNumber}</div>}
                                  <span className={`cust-type-chip ${HISTORY_TAG_CLASS[h.type]}`}>{HISTORY_TYPE_LABEL[h.type]}</span>
                                </td>
                                <td>
                                  <span className={`inv-tag ${ROW_STATUS_TAG_CLASS[h.status] || ''}`}>{rowStatusLabel(h)}</span>
                                </td>
                                <td className="cust-history-table__amount">{formatPrice(h.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="field field--span2">
                      <label htmlFor="custName">
                        Name <Req />
                      </label>
                      <input
                        id="custName"
                        aria-invalid={Boolean(fieldErrors.name)}
                        value={form.name}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, name: e.target.value }));
                          if (fieldErrors.name) setFieldErrors((f) => ({ ...f, name: undefined }));
                        }}
                        autoFocus
                      />
                      {fieldErrors.name && <span className="field__error">{fieldErrors.name}</span>}
                    </div>

                    <div className="field">
                      <label htmlFor="custPhone">
                        Phone <Req />
                      </label>
                      <input
                        id="custPhone"
                        aria-invalid={Boolean(fieldErrors.phone)}
                        value={form.phone}
                        disabled={Boolean(editingId)}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, phone: typedMobile(e.target.value) }));
                          if (fieldErrors.phone) setFieldErrors((f) => ({ ...f, phone: undefined }));
                        }}
                      />
                      {fieldErrors.phone ? (
                        <span className="field__error">{fieldErrors.phone}</span>
                      ) : editingId ? (
                        <span className="field__hint">Phone is how this record is matched — it can’t be changed here.</span>
                      ) : null}
                    </div>

                    <div className="field">
                      <label htmlFor="custEmail">Email</label>
                      <input
                        id="custEmail"
                        aria-invalid={Boolean(fieldErrors.email)}
                        value={form.email}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, email: e.target.value }));
                          if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
                        }}
                      />
                      {fieldErrors.email && <span className="field__error">{fieldErrors.email}</span>}
                    </div>

                    <div className="field">
                      <label htmlFor="custDob">Date of birth</label>
                      <input
                        id="custDob"
                        type="date"
                        value={form.dateOfBirth}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                      />
                      <span className="field__hint">So we can send a birthday wish — leave blank if you'd rather not.</span>
                    </div>

                    <div className="field">
                      <label htmlFor="custTags">Tags</label>
                      <input
                        id="custTags"
                        value={form.tags}
                        placeholder="corporate, regular, vip…"
                        onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                      />
                      <span className="field__hint">Free text — used later to target marketing messages.</span>
                    </div>

                    {editingId && (
                      <>
                        <div className="field">
                          <label htmlFor="custIdType">ID proof type</label>
                          <input
                            id="custIdType"
                            value={form.idProofType}
                            onChange={(e) => setForm((f) => ({ ...f, idProofType: e.target.value }))}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="custIdNumber">ID proof number</label>
                          <input
                            id="custIdNumber"
                            value={form.idProofNumber}
                            onChange={(e) => setForm((f) => ({ ...f, idProofNumber: e.target.value }))}
                          />
                        </div>
                      </>
                    )}

                    <div className="field field--span2">
                      <label htmlFor="custNotes">Notes</label>
                      <textarea
                        id="custNotes"
                        rows={3}
                        value={form.notes}
                        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                      />
                    </div>

                    <div className="field field--span2">
                      <label className="checkbox-inline" style={{ marginBottom: 0 }}>
                        <input
                          type="checkbox"
                          checked={form.marketingOptIn}
                          onChange={(e) => setForm((f) => ({ ...f, marketingOptIn: e.target.checked }))}
                        />
                        Okay to send offers and updates
                      </label>
                    </div>
                  </>
                )}
              </div>

              <div className="modal-form__foot">
                <div className="modal-form__foot-actions">
                  {viewMode ? (
                    <>
                      <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
                        Close
                      </button>
                      <button type="button" className="btn-accent" onClick={() => setViewMode(false)}>
                        Edit details
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => (editingId ? setViewMode(true) : setShowForm(false))}
                        disabled={submitting}
                      >
                        Cancel
                      </button>
                      <button type="button" className="btn-accent" disabled={submitting} onClick={handleSubmit}>
                        {submitting ? 'Saving…' : 'Save'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
