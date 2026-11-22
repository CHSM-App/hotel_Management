import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { apiGet, apiDelete, ApiError, API_BASE } from '../../lib/api';
import { getSession } from '../../lib/auth';
import ConfirmDialog from '../../components/ConfirmDialog';
import { formatPrice } from './priceFormat';
import QuotationDocument from './QuotationDocument';
import { downloadPdf } from './billPaper';
import { buildQuotationPdfBlob, imageAsDataUrl } from './quotationPdf';
import './SavedQuotations.css';

const FILTERS = [
  { key: 'ACTIVE', label: 'Active' },
  { key: 'EXPIRED', label: 'Expired' },
  { key: 'BOOKED', label: 'Booked' },
  { key: 'ALL', label: 'All' },
];
const STATE_LABEL = { ACTIVE: 'Active', EXPIRED: 'Expired', BOOKED: 'Booked' };

const day = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Quotations kept from the Quotation tab. Active ones hold until their
 * earliest check-in date, then read Expired (the server decides — see
 * quotations.service.js quotationState). Expand one for its frozen breakdown,
 * PDF, delete, and — while still active — Convert to booking.
 */
export default function SavedQuotations({ onConvert }) {
  const session = getSession();
  const token = session?.token;
  const [filter, setFilter] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const [quoteDoc, setQuoteDoc] = useState(null);
  const quoteRef = useRef(null);

  const load = useCallback(() => {
    const q = search.trim() ? `&q=${encodeURIComponent(search.trim())}` : '';
    apiGet(`/quotations?state=${filter}${q}`, { token })
      .then((data) => {
        setItems(data.quotations);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load quotations.'));
  }, [filter, search, token]);

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

  // Same sheet the Quotation tab downloads, rebuilt from what was saved. The
  // letter's room facts (beds, floor…) come from the live room, so a room that
  // has since been removed cannot be re-issued.
  const download = async (q) => {
    setBusy(true);
    setError('');
    try {
      const [{ rooms }, { lodge }] = await Promise.all([
        apiGet('/rooms', { token }),
        apiGet('/me', { token }),
      ]);
      const quoted = q.rooms.map((r) => ({
        room: rooms.find((x) => x.id === r.roomId),
        from: r.fromDate,
        to: r.toDate,
        result: r.result,
      }));
      const missing = quoted.findIndex((r) => !r.room);
      if (missing !== -1) {
        throw new ApiError(
          `Room ${q.rooms[missing].roomNumber} is no longer available, so this quotation cannot be re-issued.`
        );
      }
      const logoSrc = lodge?.logoUrl ? await imageAsDataUrl(`${API_BASE}${lodge.logoUrl}`) : null;
      const now = new Date();
      flushSync(() =>
        setQuoteDoc({
          lodge,
          logoSrc,
          date: now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
          preparedBy: session?.name || '',
          guest: {
            name: q.guestName || '',
            phone: q.guestPhone && `+91 ${q.guestPhone.slice(0, 5)} ${q.guestPhone.slice(5)}`,
          },
          rooms: quoted,
          total: q.total,
        })
      );
      downloadPdf(await buildQuotationPdfBlob(quoteRef.current), `quotation-${q.referenceCode}.pdf`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not prepare the quotation. Try again.');
    } finally {
      setQuoteDoc(null);
      setBusy(false);
    }
  };

  return (
    <div className="saved-quotes">
      <div className="saved-quotes__bar">
        <input
          type="search"
          placeholder="Search guest, phone or reference"
          aria-label="Search saved quotations"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="saved-quotes__filters" role="tablist">
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

      {error && <div className="form-banner form-banner--error">{error}</div>}
      {items === null && !error && <div className="dash-state">Loading…</div>}
      {items?.length === 0 && (
        <div className="dash-state">
          {filter === 'ACTIVE' ? 'No active quotations. Price a stay and press “Save quotation”.' : 'Nothing here.'}
        </div>
      )}

      {items?.map((q) => (
        <div
          key={q.id}
          className={`saved-quotes__card saved-quotes__card--${q.status.toLowerCase()}`}
        >
          <button type="button" className="saved-quotes__head" onClick={() => toggle(q)} aria-expanded={openId === q.id}>
            <span className="saved-quotes__who">
              <strong>{q.guestName || 'Walk-in enquiry'}</strong>
              <small>
                {q.referenceCode}
                {q.guestPhone ? ` · ${q.guestPhone}` : ''}
              </small>
            </span>
            <span className="saved-quotes__rooms">{q.roomSummary}</span>
            <span className="saved-quotes__dates">
              {day(q.checkInDate)} → {day(q.lastCheckOutDate)}
            </span>
            <span className="saved-quotes__total">{formatPrice(q.total)}</span>
            <span className={`saved-quotes__state saved-quotes__state--${q.status.toLowerCase()}`}>
              {STATE_LABEL[q.status]}
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
                      Expired — its check-in date has arrived. The prices below are as quoted.
                    </p>
                  )}
                  {detail.rooms.map((r) => (
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
                    {q.status === 'ACTIVE' && (
                      <button type="button" className="btn-accent" disabled={busy} onClick={() => onConvert?.(detail)}>
                        Convert to booking
                      </button>
                    )}
                    <button type="button" className="btn-secondary" disabled={busy} onClick={() => download(detail)}>
                      {busy ? 'Preparing…' : 'Download PDF'}
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

      {quoteDoc && (
        <div className="quote-pdf-source" aria-hidden="true">
          <QuotationDocument ref={quoteRef} {...quoteDoc} />
        </div>
      )}
    </div>
  );
}
