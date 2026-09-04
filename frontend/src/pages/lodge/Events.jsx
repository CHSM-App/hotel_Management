import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet, apiPatch, apiPost, apiPostForm, apiPatchForm, apiDelete, API_BASE } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { useUrlState } from '../../lib/urlState';
import { formatPrice } from './priceFormat';
import EventForm from './EventForm';
import EventDetail from './EventDetail';
import {
  EVENT_STATUS_COLOR,
  EVENT_STATUS_LABEL,
  EVENT_TYPE_LABEL,
  addDays,
  eventDayKeys,
  formatDateHead,
  formatEventDate,
  formatEventWhen,
  formatHoldRemaining,
  formatMonthBand,
  formatWindowLabel,
  isClosedStatus,
  isWeekend,
  monthRuns,
  statusBadgeClass,
  toDateKey,
} from './eventFormat';
import './RoomsAndRates.css';
import './forms.css';
import './chartSections.css';
import './tapeChart.css';
import '../internal/LodgesDashboard.css';
import './Events.css';

const TABS = [
  { key: 'diary', label: 'Diary' },
  { key: 'list', label: 'List' },
  { key: 'setup', label: 'Setup' },
];

/* --------------------------------------------------------------- diary */

// The diary is a tape chart: one row per venue, one column per day, a rolling
// window that opens a few days back from today so last weekend's function is
// still in sight beside the ones coming up. A function paints its days in
// its status colour; a vacant day is the same carved slot the room chart uses.
const WINDOW_DAYS = 30;
const WINDOW_PAST_DAYS = 4;
// The diary opens on WINDOW_DAYS and grows by another WINDOW_DAYS each time
// the desk scrolls near either edge, the way the room chart does. Capped
// because every growth refetches the whole range.
const MAX_WINDOW_DAYS = 180;
// How close to an edge counts as "at the edge" — a little over three columns.
const GROW_WITHIN_PX = 90;
// The order the legend reads in — the walk a booking takes.
const DIARY_STATUSES = ['ENQUIRY', 'TENTATIVE', 'CONFIRMED', 'SETTLED'];

function Diary({ venues, showClosed, setShowClosed, onOpen, onNew, onShowList, refreshKey }) {
  const token = getSession()?.token;
  const today = toDateKey(new Date());
  const [windowStart, setWindowStart] = useState(() => addDays(today, -WINDOW_PAST_DAYS));
  const [windowDays, setWindowDays] = useState(WINDOW_DAYS);
  const [events, setEvents] = useState([]);
  const [holds, setHolds] = useState([]);
  const [error, setError] = useState('');
  const [hover, setHover] = useState(null);

  const dates = useMemo(() => Array.from({ length: windowDays }, (_, i) => addDays(windowStart, i)), [windowStart, windowDays]);
  const label = formatWindowLabel(dates[0], dates[dates.length - 1]);

  useEffect(() => {
    const q = new URLSearchParams({ fromDate: dates[0], toDate: dates[dates.length - 1], includeClosed: 'true' });
    apiGet(`/events?${q}`, { token })
      .then((data) => {
        const list = data.events || [];
        // Holds lapsing within two days, soonest first. Worked out when the
        // window loads rather than on every render: a hold that lapses while
        // the diary sits open is caught by the next fetch.
        const limit = Date.now() + 48 * 3600 * 1000;
        setEvents(list);
        setHolds(
          list
            .filter((e) => e.status === 'TENTATIVE' && e.holdExpiresAt && new Date(e.holdExpiresAt).getTime() <= limit)
            .sort((a, b) => new Date(a.holdExpiresAt) - new Date(b.holdExpiresAt))
        );
        setError('');
      })
      .catch((err) => setError(err.message));
  }, [dates, token, refreshKey]);

  // venue → day → the functions on it, in the order they start. Two on one
  // day at one venue is normal — a morning and an evening — so a cell holds a
  // list and is drawn as side-by-side segments.
  const cells = useMemo(() => {
    const map = new Map();
    const sorted = [...events].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    for (const ev of sorted) {
      if (!showClosed && isClosedStatus(ev.status)) continue;
      const days = eventDayKeys(ev.startAt, ev.endAt);
      if (!map.has(ev.venueId)) map.set(ev.venueId, new Map());
      const byDay = map.get(ev.venueId);
      days.forEach((key, i) => {
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push({ ev, first: i === 0, last: i === days.length - 1 });
      });
    }
    return map;
  }, [events, showClosed]);

  // A retired venue keeps its row while something is still booked on it.
  const rows = venues.filter((v) => v.isActive || cells.has(v.id));
  const liveCount = events.filter((e) => !isClosedStatus(e.status)).length;
  const monthEdges = dates.reduce((cols, d, i) => (i > 0 && d.slice(8, 10) === '01' ? [...cols, i] : cols), []);

  // Moving the window unmounts the tile the pointer is on, and an unmounted
  // tile never fires its mouseleave — so the card is dismissed with the move.
  // Stepping goes back to one page: a jump is to somewhere else, not to
  // however far the last view had been scrolled out.
  const goTo = (start) => {
    setHover(null);
    setWindowStart(start);
    setWindowDays(WINDOW_DAYS);
  };
  const step = (n) => goTo(addDays(windowStart, n * windowDays));
  const goToday = () => goTo(addDays(today, -WINDOW_PAST_DAYS));

  // --- growing the window as it is scrolled ---------------------------------
  const scroller = useRef(null);
  const lastLeft = useRef(0);
  // The grid's width just before earlier days were prepended. Columns added
  // on the left push everything right while scrollLeft stays put, so the view
  // would lurch backwards; this is what it is put back by.
  const prepending = useRef(null);

  // Earlier days, prepended. The start moves back by exactly what the length
  // gains, so the far end stays where it was and only the near end grows.
  const growPast = (el) => {
    if (prepending.current != null || windowDays >= MAX_WINDOW_DAYS) return;
    prepending.current = el.scrollWidth;
    setWindowStart((start) => addDays(start, -WINDOW_DAYS));
    setWindowDays((days) => Math.min(days + WINDOW_DAYS, MAX_WINDOW_DAYS));
  };

  const onChartScroll = (e) => {
    setHover(null);
    const el = e.currentTarget;
    const wentLeft = el.scrollLeft < lastLeft.current;
    lastLeft.current = el.scrollLeft;
    if (windowDays >= MAX_WINDOW_DAYS) return;
    // Near the end, and there is more to show: another page of days.
    if (el.scrollWidth - el.scrollLeft - el.clientWidth < GROW_WITHIN_PX) {
      setWindowDays((days) => Math.min(days + WINDOW_DAYS, MAX_WINDOW_DAYS));
      return;
    }
    if (wentLeft && el.scrollLeft < GROW_WITHIN_PX) growPast(el);
  };

  // Scrolled hard left there is nothing left to scroll, so no scroll event
  // fires and the handler above never hears the desk asking for earlier days.
  // A wheel still fires against the stop.
  const onChartWheel = (e) => {
    const el = e.currentTarget;
    const backwards = e.deltaX < 0 || (e.shiftKey && e.deltaY < 0);
    if (el.scrollLeft <= 0 && backwards) growPast(el);
  };

  // Put the view back where it was looking after earlier days are prepended —
  // before paint, so there is never a frame of the chart jumped a month back.
  useLayoutEffect(() => {
    const before = prepending.current;
    if (before == null || !scroller.current) return;
    prepending.current = null;
    const added = scroller.current.scrollWidth - before;
    if (added > 0) scroller.current.scrollLeft += added;
  }, [windowStart, windowDays]);

  // Grow until the chart at least fills its card. Without this the window
  // never grows on a wide screen: thirty columns fit with room to spare, so
  // there is nothing to scroll into, so the scroll handler that would have
  // asked for more never runs. Deferred a frame so the measurement happens
  // after paint; it settles as soon as the grid overflows or hits the cap.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const el = scroller.current;
      if (el && windowDays < MAX_WINDOW_DAYS && el.scrollWidth - el.clientWidth < GROW_WITHIN_PX) {
        setWindowDays((days) => Math.min(days + WINDOW_DAYS, MAX_WINDOW_DAYS));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [windowDays, rows.length]);

  // The hover card sits above the tile, or below it when the tile is close
  // enough to the top of the viewport that there is no room above.
  const showHover = (e, payload) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const below = rect.top < 150;
    setHover({ ...payload, x: rect.left + rect.width / 2, y: below ? rect.bottom + 8 : rect.top - 8, below });
  };
  const hide = () => setHover(null);

  const renderCell = (venue, d) => {
    const cell = cells.get(venue.id)?.get(d) || [];
    if (cell.length === 0) {
      const classes = ['tape-tile', 'tape-tile--vacant'];
      if (isWeekend(d)) classes.push('tape-tile--weekend');
      if (d < today) classes.push('tape-tile--past');
      return (
        <button
          key={d}
          type="button"
          className={classes.join(' ')}
          onClick={() => onNew(d, venue.id)}
          onMouseEnter={(e) => showHover(e, { venue, date: d, ev: null })}
          onFocus={(e) => showHover(e, { venue, date: d, ev: null })}
          onMouseLeave={hide}
          onBlur={hide}
          aria-label={`${venue.name} vacant on ${formatEventDate(`${d}T00:00:00`)} — start an enquiry`}
        />
      );
    }
    return (
      <div key={d} className="events-tape__cell">
        {cell.map(({ ev, first, last }) => {
          const classes = ['events-tape__seg', `events-tape__seg--${ev.status.toLowerCase()}`];
          if (first) classes.push('events-tape__seg--start');
          if (last) classes.push('events-tape__seg--end');
          if (hover?.ev?.id === ev.id) classes.push('events-tape__seg--active');
          return (
            <button
              key={ev.id}
              type="button"
              className={classes.join(' ')}
              style={{ '--seg': EVENT_STATUS_COLOR[ev.status] }}
              onClick={() => onOpen(ev.id)}
              onMouseEnter={(e) => showHover(e, { venue, date: d, ev })}
              onFocus={(e) => showHover(e, { venue, date: d, ev })}
              onMouseLeave={hide}
              onBlur={hide}
              aria-label={`${ev.title} at ${venue.name}, ${EVENT_STATUS_LABEL[ev.status]}`}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="events">
      <div className="events__toolbar">
        <div className="tape-nav">
          <div className="tape-nav__stepper">
            <button type="button" className="tape-nav__arrow" aria-label="Earlier days" onClick={() => step(-1)}>
              ‹
            </button>
            <span className="tape-nav__label">
              <strong>{label.primary}</strong>
              <span>{label.secondary}</span>
            </span>
            <button type="button" className="tape-nav__arrow" aria-label="Later days" onClick={() => step(1)}>
              ›
            </button>
          </div>
          <button type="button" className="chart-row__link-btn" onClick={goToday}>
            Today
          </button>
        </div>
        <label className="events__toggle">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Show cancelled
        </label>
        <button type="button" className="btn-accent" onClick={() => onNew(null, null)}>
          + New enquiry
        </button>
      </div>

      <div className="tape-legend">
        {DIARY_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className="tape-legend__item tape-legend__item--link"
            onClick={() => onShowList?.(s)}
            title={`Show ${EVENT_STATUS_LABEL[s].toLowerCase()} functions in the List tab`}
          >
            <i className="tape-legend__swatch" style={{ background: EVENT_STATUS_COLOR[s] }} />
            {EVENT_STATUS_LABEL[s]}
          </button>
        ))}
        <span className="tape-legend__item">
          <i className="tape-legend__swatch tape-legend__swatch--vacant" />
          Vacant
        </span>
        <span className="tape-legend__hint">Click a colour to list those functions · hover a tile to see the function · click to open · click a vacant day to start an enquiry</span>
      </div>

      {error && <div className="form-banner form-banner--error">{error}</div>}

      {rows.length === 0 && (
        <div className="dash-card">
          <div className="dash-state">Add a venue on the Setup tab first.</div>
        </div>
      )}

      {rows.length > 0 && (
        <section className="tape-month-card">
          <div className="tape-month-card__head">
            <div className="tape-month-card__title">
              <h4>Function diary</h4>
              <span>
                {rows.length} venue{rows.length === 1 ? '' : 's'}
              </span>
            </div>
            <span className="tape-month-card__meter-value">
              {liveCount} function{liveCount === 1 ? '' : 's'} in view
            </span>
          </div>
          <div className="tape-chart-scroll" ref={scroller} onScroll={onChartScroll} onWheel={onChartWheel}>
            <div className="tape-month" style={{ '--tape-cols': `var(--tape-room-col) repeat(${dates.length}, var(--tape-tile))` }}>
              <div className="tape-month__band">
                <div className="tape-month__band-corner" />
                {monthRuns(dates).map((run, i) => (
                  <div
                    key={run.key}
                    className={`tape-month__band-month${i % 2 ? ' tape-month__band-month--alt' : ''}`}
                    style={{ gridColumn: `span ${run.days}` }}
                  >
                    <span>{formatMonthBand(run.first)}</span>
                  </div>
                ))}
              </div>
              <div className="tape-month__head">
                <div className="tape-month__corner">Venue</div>
                {dates.map((d) => {
                  const { weekday, day } = formatDateHead(d);
                  const classes = ['tape-month__date'];
                  if (d === today) classes.push('tape-month__date--today');
                  if (isWeekend(d)) classes.push('tape-month__date--weekend');
                  if (hover?.date === d) classes.push('tape-month__date--active');
                  return (
                    <div key={d} className={classes.join(' ')}>
                      <span>{weekday.slice(0, 1)}</span>
                      <strong>{day}</strong>
                    </div>
                  );
                })}
                {monthEdges.map((col) => (
                  <span key={col} className="tape-month__divider" style={{ '--tape-edge-col': col }} />
                ))}
              </div>
              {rows.map((venue) => (
                <div key={venue.id} className={`tape-month__row${hover?.venue.id === venue.id ? ' tape-month__row--active' : ''}`}>
                  <div className="tape-month__room">
                    <strong>{venue.name}</strong>
                    {venue.capacityPax ? <span>up to {venue.capacityPax}</span> : null}
                  </div>
                  {dates.map((d) => renderCell(venue, d))}
                  {monthEdges.map((col) => (
                    <span key={col} className="tape-month__divider" style={{ '--tape-edge-col': col }} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {holds.length > 0 && (
        <div className="dash-card events-holds">
          <h4>Holds expiring soon</h4>
          {holds.map((ev) => (
            <button key={ev.id} type="button" className="events-holds__row" onClick={() => onOpen(ev.id)}>
              <span>
                <strong>{ev.title}</strong> · {ev.venueName} · {ev.organiserName}
              </span>
              <span className="events-holds__when">expires {formatHoldRemaining(ev.holdExpiresAt)}</span>
            </button>
          ))}
        </div>
      )}

      {hover && (
        <div className={`tape-tooltip${hover.below ? ' tape-tooltip--below' : ''}`} role="tooltip" style={{ left: `${hover.x}px`, top: `${hover.y}px` }}>
          {hover.ev ? (
            <>
              <span className="tape-tooltip__top">
                <span className="tape-tooltip__dot" style={{ background: EVENT_STATUS_COLOR[hover.ev.status] }} />
                {EVENT_STATUS_LABEL[hover.ev.status]}
              </span>
              <strong>{hover.ev.title}</strong>
              <span className="tape-tooltip__meta">
                {EVENT_TYPE_LABEL[hover.ev.eventType] || hover.ev.eventType} · {hover.venue.name}
              </span>
              <span className="tape-tooltip__dates">{formatEventWhen(hover.ev.startAt, hover.ev.endAt)}</span>
              <span className="tape-tooltip__meta">
                {hover.ev.organiserName} · {hover.ev.organiserPhone} · {hover.ev.expectedPax} guests
              </span>
              {hover.ev.status === 'TENTATIVE' && hover.ev.holdExpiresAt && (
                <span className="tape-tooltip__hint">Hold expires {formatHoldRemaining(hover.ev.holdExpiresAt)}</span>
              )}
              {isClosedStatus(hover.ev.status) && (
                <span className="tape-tooltip__hint">{hover.ev.status === 'CANCELLED' ? 'Cancelled' : 'Hold lapsed'} — kept for the record</span>
              )}
            </>
          ) : (
            <>
              <span className="tape-tooltip__top">
                <span className="tape-tooltip__dot tape-tooltip__dot--vacant" />
                Vacant
              </span>
              <strong>{hover.venue.name}</strong>
              <span className="tape-tooltip__dates">{formatEventDate(`${hover.date}T00:00:00`)}</span>
              <span className="tape-tooltip__hint">Click to start an enquiry</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- list */

function defaultRange() {
  const from = new Date();
  from.setMonth(from.getMonth() - 1);
  const to = new Date();
  to.setMonth(to.getMonth() + 6);
  return { from: toDateKey(from), to: toDateKey(to) };
}

function EventList({ venues, onOpen, refreshKey }) {
  const token = getSession()?.token;
  const [range, setRange] = useState(defaultRange);
  // The status cut lives in the URL rather than in local state, because it is
  // the one filter that is arrived at from somewhere else: a colour on the
  // diary's legend is followed here, and it has nothing but the query string to
  // hand the status over in. It also means a cut of the list can be linked to
  // and survives the reload that plain state would lose.
  const [status, setStatus] = useUrlState('status', '');
  const [venueId, setVenueId] = useState('');
  const [search, setSearch] = useState('');
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const q = new URLSearchParams({ fromDate: range.from, toDate: range.to, includeClosed: 'true' });
    if (status) q.set('status', status);
    if (venueId) q.set('venueId', venueId);
    apiGet(`/events?${q}`, { token })
      .then((data) => {
        setEvents(data.events || []);
        setError('');
      })
      .catch((err) => setError(err.message));
  }, [range, status, venueId, token, refreshKey]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (events || []).filter(
      (e) =>
        !needle ||
        e.title?.toLowerCase().includes(needle) ||
        e.organiserName?.toLowerCase().includes(needle) ||
        e.organiserPhone?.includes(needle)
    );
    return list.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  }, [events, search]);

  return (
    <div className="events">
      <div className="events__toolbar">
        <input placeholder="Search title, organiser, phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(EVENT_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={venueId} onChange={(e) => setVenueId(e.target.value)} aria-label="Venue">
          <option value="">All venues</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={range.from}
          max={range.to ? addDays(range.to, -1) : undefined}
          onChange={(e) =>
            setRange((r) => {
              const from = e.target.value;
              // 'to' has to stay strictly after 'from', so a 'from' pushed onto or
              // past it drags it along rather than leaving an empty range behind.
              return { from, to: from && r.to && r.to <= from ? addDays(from, 1) : r.to };
            })
          }
          aria-label="From"
        />
        <input
          type="date"
          value={range.to}
          min={range.from ? addDays(range.from, 1) : undefined}
          onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          aria-label="To"
        />
      </div>

      {error && <div className="form-banner form-banner--error">{error}</div>}

      <div className="dash-card">
        {events === null ? (
          <div className="dash-state">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="dash-state">No functions match.</div>
        ) : (
          <div className="dash-table-scroll">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Function</th>
                  <th>Venue</th>
                  <th>Organiser</th>
                  <th>Pax</th>
                  <th className="events-list__num">Total</th>
                  <th className="events-list__num">Advance</th>
                  <th className="events-list__num">Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((ev) => (
                  <tr key={ev.id} className="events-list__row" onClick={() => onOpen(ev.id)}>
                    <td>{formatEventWhen(ev.startAt, ev.endAt)}</td>
                    <td>
                      <span className="dash-lodge-name">{ev.title}</span>
                      <span className="events-list__sub">{EVENT_TYPE_LABEL[ev.eventType] || ev.eventType}</span>
                    </td>
                    <td>{ev.venueName}</td>
                    <td>
                      {ev.organiserName}
                      <span className="events-list__sub">{ev.organiserPhone}</span>
                    </td>
                    <td>{ev.finalPax ?? ev.expectedPax}</td>
                    <td className="events-list__num">{formatPrice(ev.totalAmount)}</td>
                    <td className="events-list__num">{formatPrice(ev.advanceAmount || 0)}</td>
                    <td className="events-list__num">{formatPrice(ev.balanceDue)}</td>
                    <td>
                      <span className={statusBadgeClass(ev.status)}>{EVENT_STATUS_LABEL[ev.status] || ev.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- setup */

// Up to six photos of a venue, the same ceiling and the same formats as a
// room. Chosen files are held on the draft until Add/Save sends them with
// the venue's fields; photos already saved are removed straight away, as
// they are on the room form.
const MAX_VENUE_IMAGES = 6;
const VENUE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

// The picker is two pieces: a button that sits in the row with the venue's
// fields and opens the file chooser, and a strip of thumbnails that appears
// under the row only once there is something to show. Saved photos carry a
// Remove that deletes them now; queued ones just drop out of the queue.
function PhotoButton({ total, max, accept, onAddFiles, disabled }) {
  const inputRef = useRef(null);
  const full = total >= max;
  const acceptedTypes = accept.split(',');
  return (
    <>
      <button
        type="button"
        className={`events-setup__photo-btn${full ? ' events-setup__photo-btn--full' : ''}`}
        disabled={disabled || full}
        onClick={() => inputRef.current?.click()}
        title={full ? `${max} photos is the most a venue can have.` : `Up to ${max} photos · JPG, PNG or WEBP · 5MB each`}
        aria-label={`Add photos (${total} of ${max} chosen)`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <circle cx="8.5" cy="10" r="1.6" />
          <path d="M21 16l-5-5-8 8" />
          <path d="M3 17l4-4 3 3" />
        </svg>
        <span className="events-setup__photo-btn-label">Photos</span>
        <span className="events-setup__photo-btn-count">
          {total}/{max}
        </span>
      </button>
      <input
        ref={inputRef}
        className="events-setup__photo-input"
        type="file"
        accept={accept}
        multiple
        tabIndex={-1}
        disabled={disabled || full}
        onChange={(e) => {
          const images = Array.from(e.target.files).filter((f) => acceptedTypes.includes(f.type));
          if (images.length > 0) onAddFiles(images);
          e.target.value = '';
        }}
      />
    </>
  );
}

function PhotoStrip({ existing = [], files = [], urlFor, onRemoveFile, onDeleteExisting, disabled }) {
  if (existing.length === 0 && files.length === 0) return null;
  return (
    <div className="events-setup__photo-strip">
      {existing.map((img) => (
        <div className="events-setup__photo" key={`saved-${img.id}`}>
          <img src={urlFor(img.filename)} alt="Venue" />
          <button
            type="button"
            className="events-setup__photo-remove"
            aria-label="Remove photo"
            title="Remove photo"
            disabled={disabled}
            onClick={() => onDeleteExisting(img.id)}
          >
            ×
          </button>
        </div>
      ))}
      {files.map((file, index) => (
        <div className="events-setup__photo events-setup__photo--new" key={`new-${index}-${file.name}`}>
          <img src={URL.createObjectURL(file)} alt="New upload preview" />
          <span className="events-setup__photo-badge">New</span>
          <button
            type="button"
            className="events-setup__photo-remove"
            aria-label="Remove photo"
            title="Remove photo"
            disabled={disabled}
            onClick={() => onRemoveFile(index)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// One card for venues and one for add-ons: same list, same add row, same
// edit-in-place — only the columns differ, so the shape is shared. `photos`
// is what the venue card has and the add-on card does not: when given, the
// draft and the edit carry an imageFiles queue, the rows show a thumbnail,
// and onAdd/onSave receive the files with the fields.
function CatalogueCard({ title, hint, items, columns, onAdd, onSave, onToggle, rowClass, photos = null }) {
  const blank = () => ({
    ...Object.fromEntries(columns.map((c) => [c.key, c.type === 'checkbox' ? false : ''])),
    ...(photos ? { imageFiles: [] } : {}),
  });
  const [draft, setDraft] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [edit, setEdit] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Adds to a queue without going past the cap, counting what the venue
  // already has when this is an edit.
  const queueFiles = (setState, savedCount) => (fileList) => {
    setState((d) => {
      const room = photos.max - savedCount - (d.imageFiles || []).length;
      if (room <= 0) return d;
      return { ...d, imageFiles: [...(d.imageFiles || []), ...fileList.slice(0, room)] };
    });
  };
  const dropFile = (setState) => (index) =>
    setState((d) => ({ ...d, imageFiles: (d.imageFiles || []).filter((_, i) => i !== index) }));

  const input = (col, value, set) =>
    col.type === 'checkbox' ? (
      <label className="events__toggle" key={col.key}>
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => set(col.key, e.target.checked)} />
        {col.label}
      </label>
    ) : (
      <input
        key={col.key}
        type={col.type || 'text'}
        min={col.type === 'number' ? 0 : undefined}
        placeholder={col.label}
        value={value ?? ''}
        onChange={(e) => set(col.key, e.target.value)}
      />
    );

  return (
    <div className="dash-card chart-section">
      <div className="chart-section__header">
        <h3>{title}</h3>
        <span className="chart-section__hint">{hint}</span>
      </div>
      {error && <div className="form-banner form-banner--error">{error}</div>}
      <div className="chart-list">
        {items.length === 0 && <div className="events-detail__empty">Nothing set up yet.</div>}
        {items.map((it) => (
          <div key={it.id} className="chart-row">
            {editingId === it.id ? (
              <div className="events-setup__edit-row">
                {columns.map((c) => input(c, edit[c.key], (k, v) => setEdit((d) => ({ ...d, [k]: v }))))}
                {photos && (
                  <PhotoButton
                    total={(it.images || []).length + (edit.imageFiles || []).length}
                    max={photos.max}
                    accept={photos.accept}
                    disabled={busy}
                    onAddFiles={queueFiles(setEdit, (it.images || []).length)}
                  />
                )}
                <span className="chart-row__actions">
                  <button
                    type="button"
                    className="chart-row__link-btn"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await onSave(it.id, edit);
                        setEditingId(null);
                      })
                    }
                  >
                    Save
                  </button>
                  <button type="button" className="chart-row__link-btn" onClick={() => setEditingId(null)} disabled={busy}>
                    Cancel
                  </button>
                </span>
                {photos && (
                  <PhotoStrip
                    existing={it.images || []}
                    files={edit.imageFiles || []}
                    urlFor={photos.urlFor}
                    disabled={busy}
                    onRemoveFile={dropFile(setEdit)}
                    onDeleteExisting={(imageId) => run(() => photos.onDelete(it.id, imageId))}
                  />
                )}
              </div>
            ) : (
              <>
                <span className="chart-row__name">
                  {photos && it.images?.length > 0 && (
                    <span className="events-setup__thumb">
                      <img src={photos.urlFor(it.images[0].filename)} alt="" />
                      {it.images.length > 1 && <span className="events-setup__thumb-count">+{it.images.length - 1}</span>}
                    </span>
                  )}
                  {it.name}
                  {!it.isActive && <span className="badge badge--off chart-row__badge">inactive</span>}
                </span>
                <span className="chart-row__value">
                  {rowClass(it)}
                  <span className="chart-row__actions">
                    <button
                      type="button"
                      className="chart-row__link-btn"
                      onClick={() => {
                        setEdit({
                          ...Object.fromEntries(columns.map((c) => [c.key, it[c.key] ?? (c.type === 'checkbox' ? false : '')])),
                          ...(photos ? { imageFiles: [] } : {}),
                        });
                        setEditingId(it.id);
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" className="chart-row__link-btn" disabled={busy} onClick={() => run(() => onToggle(it))}>
                      {it.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </span>
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      <div
        className={`inline-add-form__row${columns.some((c) => c.type === 'checkbox') ? ' inline-add-form__row--addons' : ''}${
          photos ? ' inline-add-form__row--photos' : ''
        }`}
      >
        {columns.map((c) => input(c, draft[c.key], (k, v) => setDraft((d) => ({ ...d, [k]: v }))))}
        {photos && (
          <PhotoButton
            total={(draft.imageFiles || []).length}
            max={photos.max}
            accept={photos.accept}
            disabled={busy}
            onAddFiles={queueFiles(setDraft, 0)}
          />
        )}
        <button
          type="button"
          className="btn-accent"
          disabled={busy || !String(draft.name || '').trim()}
          onClick={() =>
            run(async () => {
              await onAdd(draft);
              setDraft(blank());
            })
          }
        >
          Add
        </button>
      </div>
      {photos && (
        <PhotoStrip
          files={draft.imageFiles || []}
          urlFor={photos.urlFor}
          disabled={busy}
          onRemoveFile={dropFile(setDraft)}
          onDeleteExisting={() => {}}
        />
      )}
    </div>
  );
}

function Setup({ venues, addons, reloadCatalogue }) {
  const token = getSession()?.token;

  // Multipart rather than JSON, because the photos travel with the fields —
  // the same request shape the room form sends. A blank capacity is sent
  // blank, which the server reads as "not given".
  const venueForm = (d) => {
    const fd = new FormData();
    fd.append('name', String(d.name).trim());
    fd.append('capacityPax', d.capacityPax === '' || d.capacityPax == null ? '' : String(Number(d.capacityPax)));
    fd.append('baseCharge', String(Number(d.baseCharge) || 0));
    (d.imageFiles || []).forEach((file) => fd.append('images', file));
    return fd;
  };
  const addonBody = (d) => ({
    name: String(d.name).trim(),
    defaultAmount: Number(d.defaultAmount) || 0,
    isPerUnit: Boolean(d.isPerUnit),
  });

  return (
    <div className="events-setup">
      <CatalogueCard
        title="Venues"
        hint="Halls and lawns that can be booked for a function."
        items={venues}
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'capacityPax', label: 'Capacity', type: 'number' },
          { key: 'baseCharge', label: 'Hire charge', type: 'number' },
        ]}
        rowClass={(v) => (
          <span>
            {v.capacityPax ? `${v.capacityPax} pax · ` : ''}
            {formatPrice(v.baseCharge)}
          </span>
        )}
        photos={{
          max: MAX_VENUE_IMAGES,
          accept: VENUE_IMAGE_ACCEPT,
          urlFor: (filename) => `${API_BASE}/venue-images/${filename}`,
          onDelete: async (venueId, imageId) => {
            await apiDelete(`/events/venues/${venueId}/images/${imageId}`, { token });
            await reloadCatalogue();
          },
        }}
        onAdd={async (d) => {
          await apiPostForm('/events/venues', venueForm(d), { token });
          await reloadCatalogue();
        }}
        onSave={async (id, d) => {
          await apiPatchForm(`/events/venues/${id}`, venueForm(d), { token });
          await reloadCatalogue();
        }}
        onToggle={async (v) => {
          await apiPatch(`/events/venues/${v.id}`, { isActive: !v.isActive }, { token });
          await reloadCatalogue();
        }}
      />
      <CatalogueCard
        title="Add-ons"
        hint="Extras quoted on top of venue and plates — DJ, decor, mandap."
        items={addons}
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'defaultAmount', label: 'Price', type: 'number' },
          { key: 'isPerUnit', label: 'Per unit', type: 'checkbox' },
        ]}
        rowClass={(a) => (
          <span>
            {formatPrice(a.defaultAmount)}
            {a.isPerUnit ? ' each' : ''}
          </span>
        )}
        onAdd={async (d) => {
          await apiPost('/events/addons', addonBody(d), { token });
          await reloadCatalogue();
        }}
        onSave={async (id, d) => {
          await apiPatch(`/events/addons/${id}`, addonBody(d), { token });
          await reloadCatalogue();
        }}
        onToggle={async (a) => {
          await apiPatch(`/events/addons/${a.id}`, { isActive: !a.isActive }, { token });
          await reloadCatalogue();
        }}
      />
    </div>
  );
}

/* --------------------------------------------------------------- shell */

// refreshKey is the dashboard's: it changes when something outside this
// screen — the bill modal — has moved a function on, and the diary and the
// list re-read on it exactly as they do on their own bump.
export default function Events({ lodge, onBillEvent, onViewInvoice, refreshKey: externalRefresh = 0 }) {
  const token = getSession()?.token;
  const [tab, setTab] = useUrlState('tab', 'diary');
  const [venues, setVenues] = useState([]);
  const [addons, setAddons] = useState([]);
  const [showClosed, setShowClosed] = useState(false);
  // Which event is open, and whether the form is up (with a prefilled date).
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(null);
  // Bumped after any save so the diary and list re-fetch without each keeping
  // its own copy of the change.
  const [bumps, setBumps] = useState(0);
  const refreshKey = `${bumps}:${externalRefresh}`;

  const reloadCatalogue = useCallback(async () => {
    const [v, a] = await Promise.all([
      apiGet('/events/venues?includeInactive=true', { token }),
      apiGet('/events/addons?includeInactive=true', { token }),
    ]);
    setVenues(v.venues || []);
    setAddons(a.addons || []);
  }, [token]);

  useEffect(() => {
    reloadCatalogue().catch(() => {});
  }, [reloadCatalogue]);

  const bump = () => setBumps((k) => k + 1);

  // Following a colour on the diary's legend into the list's cut of it.
  //
  // Both keys go in one setSearchParams rather than through setTab and the
  // list's own setStatus: each of those replaces the URL from the params it
  // captured on this render, so calling them in sequence would have the second
  // overwrite the first and land on the list with no status chosen.
  const [, setSearchParams] = useSearchParams();
  const showListWithStatus = (status) => {
    setSearchParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('tab', 'list');
        if (status) updated.set('status', status);
        else updated.delete('status');
        return updated;
      },
      { replace: true }
    );
  };

  // A status is the list's filter, so it leaves with the list. Left in the URL
  // it would be waiting on the next visit to the tab — a cut nobody chose,
  // with the diary's legend the only thing that could explain it.
  const changeTab = (next) => {
    if (next === 'list') return setTab(next);
    setSearchParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.delete('status');
        if (next === 'diary') updated.delete('tab');
        else updated.set('tab', next);
        return updated;
      },
      { replace: true }
    );
  };

  return (
    <div>
      <div className="subtabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="subtabs__item"
            aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => changeTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'diary' && (
        <Diary
          venues={venues}
          showClosed={showClosed}
          setShowClosed={setShowClosed}
          onOpen={setOpenId}
          onNew={(date, venueId) => setCreating({ date, venueId })}
          onShowList={showListWithStatus}
          refreshKey={refreshKey}
        />
      )}
      {tab === 'list' && <EventList venues={venues} onOpen={setOpenId} refreshKey={refreshKey} />}
      {tab === 'setup' && <Setup venues={venues} addons={addons} reloadCatalogue={reloadCatalogue} />}

      {creating && (
        <EventForm
          initialDate={creating.date}
          initialVenueId={creating.venueId}
          venues={venues}
          addons={addons}
          lodge={lodge}
          onClose={() => setCreating(null)}
          onSaved={(ev) => {
            setCreating(null);
            bump();
            setOpenId(ev.id);
          }}
        />
      )}

      {openId && (
        <EventDetail
          eventId={openId}
          lodge={lodge}
          venues={venues}
          addons={addons}
          onChanged={bump}
          onClose={() => setOpenId(null)}
          onBillEvent={(id) => {
            setOpenId(null);
            onBillEvent?.(id);
          }}
          onViewInvoice={(invoiceId) => {
            setOpenId(null);
            onViewInvoice?.(invoiceId);
          }}
        />
      )}
    </div>
  );
}
