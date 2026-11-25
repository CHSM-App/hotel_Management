import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiDelete, apiPatch, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import ConfirmDialog from '../../components/ConfirmDialog';
import { formatPrice } from './priceFormat';
import { downloadPdf } from './billPaper';
import { useQuotationSend } from './useQuotationSend';
import { KindIcon } from './QuoteBits';
import { KIND_LABEL } from './quotationKinds';
import './SavedQuotations.css';

const FILTERS = [
  { key: 'ACTIVE', label: 'Active' },
  { key: 'EXPIRED', label: 'Expired' },
  { key: 'BOOKED', label: 'Booked' },
  { key: 'ALL', label: 'All' },
];
const STATE_LABEL = { ACTIVE: 'Active', EXPIRED: 'Expired', BOOKED: 'Booked' };
// A glyph beside the label, so a state is never carried by colour alone.
const STATE_MARK = { ACTIVE: '●', EXPIRED: '◷', BOOKED: '✓' };

const day = (iso) =>
  new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const whenText = (q) =>
  q.kind === 'ROOM' ? `${day(q.checkInDate)} → ${day(q.lastCheckOutDate)}` : `${q.kind === 'EVENT' ? 'On' : 'Valid until'} ${day(q.validUntil)}`;

/**
 * The home of the Quotations page: every saved quotation, newest first, with a
 * prominent "New quotation" button. Expand a card for its frozen breakdown,
 * PDF, WhatsApp, delete and — while still active — Convert to booking (rooms)
 * or Mark as booked (event, restaurant, bar).
 */
export default function SavedQuotations({ onConvert, onNew, kind = null, kinds = ['ROOM'] }) {
  const token = getSession()?.token;
  const [filter, setFilter] = useState('ACTIVE');
  const [kindFilter, setKindFilter] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const { buildPdf, send, host } = useQuotationSend();

  const load = useCallback(() => {
    const q = search.trim() ? `&q=${encodeURIComponent(search.trim())}` : '';
    const k = kind || kindFilter;
    apiGet(`/quotations?state=${filter}${q}${k ? `&kind=${k}` : ''}`, { token })
      .then((data) => {
        setItems(data.quotations);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load quotations.'));
  }, [filter, kind, kindFilter, search, token]);

  // Search waits for a pause in typing; a filter change loads straight away.
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const toggle = async (q) => {
    if (openId === q.id) {
      setOpenId(null);
      return;
    }
    setOpenId(q.id);
    setDetail(null);
    setNotice('');
    try {
      setDetail(await apiGet(`/quotations/${q.id}`, { token }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open the quotation.');
    }
  };

  const remove = async (q) => {
    setBusy(true);
    try {
      await apiDelete(`/quotations/${q.id}`, { token });
      setConfirmDelete(null);
      setOpenId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the quotation.');
      setConfirmDelete(null);
    } finally {
      setBusy(false);
    }
  };

  // Event / food / bar quotations are not converted for the desk: the order or
  // function is made on its own screen, and this just records that it was.
  const markBooked = async (q) => {
    setBusy(true);
    try {
      await apiPatch(`/quotations/${q.id}`, { status: 'BOOKED' }, { token });
      setOpenId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the quotation.');
    } finally {
      setBusy(false);
    }
  };

  const download = async (q) => {
    setBusy(true);
    setError('');
    try {
      downloadPdf(await buildPdf(q), `quotation-${q.referenceCode}.pdf`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not prepare the quotation. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const whatsApp = async (q) => {
    setBusy(true);
    setError('');
    setNotice('');
    setNotice(await send(q));
    setBusy(false);
  };

  const total = (items || []).reduce((sum, q) => sum + Number(q.total), 0);
  const title = kind ? `${KIND_LABEL[kind]} quotations` : 'Quotations';

  return (
    <div className="saved-quotes">
      <div className="saved-quotes__top">
        <div>
          <h2>{title}</h2>
          <p>Prices you have quoted to customers.</p>
        </div>
        {onNew && (
          <button type="button" className="saved-quotes__new" onClick={onNew}>
            <span aria-hidden="true">+</span> New quotation
          </button>
        )}
      </div>

      <div className="dash-card saved-quotes__bar">
        <input
          type="search"
          placeholder="Search by guest, phone, reference or items"
          aria-label="Search saved quotations"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="saved-quotes__chips">
          {!kind && kinds.length > 1 && (
            <div className="saved-quotes__filters" role="tablist" aria-label="Quotation kind">
              {[{ key: '', label: 'All kinds' }, ...kinds.map((k) => ({ key: k, label: KIND_LABEL[k] }))].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={kindFilter === f.key}
                  className={`saved-quotes__filter${kindFilter === f.key ? ' saved-quotes__filter--on' : ''}`}
                  onClick={() => {
                    setItems(null);
                    setKindFilter(f.key);
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          <div className="saved-quotes__filters" role="tablist" aria-label="Status">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                className={`saved-quotes__filter${filter === f.key ? ' saved-quotes__filter--on' : ''}`}
                onClick={() => {
                  setItems(null);
                  setFilter(f.key);
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="form-banner form-banner--error">{error}</div>}
      {notice && <div className="form-banner">{notice}</div>}
      {items === null && !error && <div className="dash-state">Loading…</div>}
      {items?.length > 0 && (
        <div className="saved-quotes__count">
          {items.length} quotation{items.length === 1 ? '' : 's'} · {formatPrice(total)} quoted
        </div>
      )}
      {items?.length === 0 && (
        <div className="saved-quotes__empty">
          <div className="saved-quotes__empty-icon" aria-hidden="true">
            <KindIcon kind={kind || 'ROOM'} size={30} />
          </div>
          <strong>{filter !== 'ACTIVE' || search.trim() || kindFilter ? 'No quotations match' : 'No quotations yet'}</strong>
          <span>
            {filter !== 'ACTIVE' || search.trim() || kindFilter
              ? 'Try another filter or search.'
              : 'Quote a stay, a function, a menu or a bar order and it will be kept here.'}
          </span>
          {onNew && filter === 'ACTIVE' && !search.trim() && !kindFilter && (
            <button type="button" className="saved-quotes__new" onClick={onNew}>
              <span aria-hidden="true">+</span> New quotation
            </button>
          )}
        </div>
      )}

      <div className="saved-quotes__grid">
        {items?.map((q) => (
          <div
            key={q.id}
            className={`saved-quotes__card saved-quotes__card--${q.status.toLowerCase()}${openId === q.id ? ' saved-quotes__card--open' : ''}`}
          >
            <button type="button" className="saved-quotes__head" onClick={() => toggle(q)} aria-expanded={openId === q.id}>
              <span className={`saved-quotes__badge saved-quotes__badge--${q.kind.toLowerCase()}`}>
                <KindIcon kind={q.kind} size={22} />
              </span>
              <span className="saved-quotes__main">
                <span className="saved-quotes__row">
                  <strong>{q.guestName || 'Walk-in enquiry'}</strong>
                  <span className="saved-quotes__total">{formatPrice(q.total)}</span>
                </span>
                <small>
                  {KIND_LABEL[q.kind]} · {q.referenceCode}
                  {q.guestPhone ? ` · ${q.guestPhone}` : ''}
                </small>
                <span className="saved-quotes__summary">{q.roomSummary}</span>
                <span className="saved-quotes__foot">
                  <span className={`saved-quotes__state saved-quotes__state--${q.status.toLowerCase()}`}>
                    <span aria-hidden="true">{STATE_MARK[q.status]}</span> {STATE_LABEL[q.status]}
                  </span>
                  <span className="saved-quotes__dates">{whenText(q)}</span>
                </span>
              </span>
            </button>

            {openId === q.id && (
              <div className="saved-quotes__body">
                {!detail || detail.id !== q.id ? (
                  <div className="dash-state">Loading…</div>
                ) : (
                  <>
                    {q.status === 'EXPIRED' && (
                      <p className="saved-quotes__note">
                        {q.kind === 'ROOM'
                          ? 'Expired — its check-in date has passed. The prices below are as quoted.'
                          : 'Expired — the prices below are as quoted and may have changed.'}
                      </p>
                    )}
                    {detail.kind !== 'ROOM' && <OtherLines detail={detail} />}
                    {(detail.rooms || []).map((r) => (
                      <div className="saved-quotes__room" key={`${r.roomId}-${r.fromDate}`}>
                        <div className="saved-quotes__room-title">
                          Room {r.roomNumber}
                          {r.categoryName ? ` · ${r.categoryName}` : ''}
                          <small>
                            {day(r.fromDate)} → {day(r.toDate)} · {r.result.nightCount} night
                            {r.result.nightCount === 1 ? '' : 's'}
                          </small>
                        </div>
                        {r.result.lines.map((line) => (
                          <div className="saved-quotes__line" key={line.label}>
                            <span>{line.label}</span>
                            <span>{formatPrice(line.amount)}</span>
                          </div>
                        ))}
                        <div className="saved-quotes__line saved-quotes__line--total">
                          <span>Room total</span>
                          <span>{formatPrice(r.result.total)}</span>
                        </div>
                      </div>
                    ))}
                    <div className="saved-quotes__grand">
                      <span>Grand total</span>
                      <strong>{formatPrice(detail.total)}</strong>
                    </div>
                    <div className="saved-quotes__actions">
                      {q.status === 'ACTIVE' && q.kind === 'ROOM' && (
                        <button type="button" className="btn-accent" disabled={busy} onClick={() => onConvert?.(detail)}>
                          Convert to booking
                        </button>
                      )}
                      {q.status === 'ACTIVE' && q.kind !== 'ROOM' && (
                        <button type="button" className="btn-accent" disabled={busy} onClick={() => markBooked(detail)}>
                          Mark as booked
                        </button>
                      )}
                      <button type="button" className="btn-whatsapp" disabled={busy} onClick={() => whatsApp(detail)}>
                        {busy ? 'Preparing…' : 'Send on WhatsApp'}
                      </button>
                      <button type="button" className="btn-secondary" disabled={busy} onClick={() => download(detail)}>
                        Download PDF
                      </button>
                      <button
                        type="button"
                        className="btn-secondary saved-quotes__delete"
                        disabled={busy}
                        onClick={() => setConfirmDelete(q)}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${confirmDelete.referenceCode}?`}
          message="This removes the saved quotation. A PDF you already shared is not affected."
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={() => remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {host}
    </div>
  );
}

// The frozen breakdown of an event / food / bar quotation, line by line.
function OtherLines({ detail }) {
  const d = detail.details || {};
  const lines =
    detail.kind === 'EVENT'
      ? (d.pricing?.lines || []).map((l) => [l.label, l.amount])
      : (d.lines || []).map((l) => [`${l.itemName} × ${l.quantity}`, l.lineTotal]);
  const off = detail.kind === 'EVENT' ? d.pricing?.discountAmount : d.discount;
  return (
    <div className="saved-quotes__room">
      {detail.kind === 'EVENT' && <div className="saved-quotes__room-title">{d.venueName}</div>}
      {lines.map(([label, amount], i) => (
        <div className="saved-quotes__line" key={i}>
          <span>{label}</span>
          <span>{formatPrice(amount)}</span>
        </div>
      ))}
      {Number(off) > 0 && (
        <div className="saved-quotes__line">
          <span>{detail.kind === 'EVENT' ? 'Concession' : 'Discount'}</span>
          <span>− {formatPrice(off)}</span>
        </div>
      )}
      {d.note && <p className="saved-quotes__note">Note: {d.note}</p>}
    </div>
  );
}
