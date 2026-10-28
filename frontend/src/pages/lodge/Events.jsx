import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet, apiPatch, apiPost, apiPostForm, apiPatchForm, apiDelete, API_BASE } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { useUrlState } from '../../lib/urlState';
import { formatPrice } from './priceFormat';
import EventForm from './EventForm';
import EventDetail from './EventDetail';
import PageLoader from '../../components/PageLoader';
import IconButton from '../../components/IconButton';
import { EditIcon } from '../../components/ActionIcons';
import Req from '../../components/RequiredMark';
import { Modal } from './HousekeepingParts';
import {
  EVENT_STATUS_COLOR,
  EVENT_STATUS_LABEL,
  EVENT_TYPE_LABEL,
  addDays,
  eventDayKeys,
  eventPhase,
  eventPhaseLabel,
  formatDateHead,
  formatEventDate,
  formatEventTime,
  formatEventWhen,
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
import './GuestRegister.css';
import './InventoryPanel.css';
import './MenuPanel.css';
import './RoomsPanel.css';
import './Bookings.css';
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
const DIARY_STATUSES = ['CONFIRMED', 'SETTLED', 'DRAFT'];
// The housekeeping statuses that mean a venue is not ready, as on the room chart.
const NOT_READY = {
  DIRTY: 'Needs cleaning',
  CLEANING: 'Being cleaned',
  OUT_OF_ORDER: 'Under repair',
};

function Diary({ venues, onOpen, onNew, onShowList, refreshKey }) {
  const token = getSession()?.token;
  const today = toDateKey(new Date());
  const [windowStart, setWindowStart] = useState(() => addDays(today, -WINDOW_PAST_DAYS));
  const [windowDays, setWindowDays] = useState(WINDOW_DAYS);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [hover, setHover] = useState(null);
  // Functions still in DRAFT, whatever the dates on screen — like the room chart's
  // Drafts chip, so a desk sees at a glance that something is parked.
  // Search, the way the room chart does it: matches are ringed on the chart and
  // the arrows (or Enter / Shift+Enter) walk through them.
  const [search, setSearch] = useState('');
  const [hitIndex, setHitIndex] = useState(0);
  const [drafts, setDrafts] = useState([]);
  const [showDrafts, setShowDrafts] = useState(false);
  useEffect(() => {
    apiGet('/events?status=DRAFT', { token })
      .then((data) => setDrafts((data.events || []).filter((e) => e.status === 'DRAFT')))
      .catch(() => setDrafts([]));
  }, [token, refreshKey]);
  // Venues housekeeping says are not ready right now, by venue id. null until
  // the board answers, and for good where Housekeeping is off and the request
  // is refused.
  const [notReady, setNotReady] = useState(null);
  // The time as of the last answer from the board, for "has this function ended".
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let ignore = false;
    const load = () =>
      apiGet('/housekeeping/venues', { token })
        .then((d) => {
          if (ignore) return;
          setNow(Date.now());
          setNotReady(
            new Map(
              d.venues
                .filter((v) => NOT_READY[v.status])
                .map((v) => [String(v.id), { label: NOT_READY[v.status], note: v.status === 'OUT_OF_ORDER' ? v.outOfOrderNote || '' : '' }])
            )
          );
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [token, refreshKey]);

  const dates = useMemo(() => Array.from({ length: windowDays }, (_, i) => addDays(windowStart, i)), [windowStart, windowDays]);
  // Always the first page's span, even once the chart has grown from
  // scrolling — the way the room chart's label holds steady too.
  const label = formatWindowLabel(windowStart, addDays(windowStart, WINDOW_DAYS - 1));

  useEffect(() => {
    const q = new URLSearchParams({ fromDate: dates[0], toDate: dates[dates.length - 1], includeClosed: 'true' });
    apiGet(`/events?${q}`, { token })
      .then((data) => {
        const list = data.events || [];
        setEvents(list);
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
      // Cancelled functions never appear on the diary.
      if (isClosedStatus(ev.status)) continue;
      const days = eventDayKeys(ev.startAt, ev.endAt);
      if (!map.has(ev.venueId)) map.set(ev.venueId, new Map());
      const byDay = map.get(ev.venueId);
      days.forEach((key, i) => {
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push({ ev, first: i === 0, last: i === days.length - 1 });
      });
    }
    return map;
  }, [events]);

  const hits = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    const squashed = needle.replace(/[^a-z0-9]/g, '');
    return [...events]
      .filter((ev) => !isClosedStatus(ev.status))
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
      .filter((ev) => {
        const fields = [ev.title, ev.eventNumber, ev.organiserName, ev.organiserPhone, ev.organiserAltPhone, ev.venueName]
          .filter(Boolean)
          .map((f) => String(f).toLowerCase());
        return (
          fields.some((f) => f.includes(needle)) ||
          (squashed.length > 0 && fields.some((f) => f.replace(/[^a-z0-9]/g, '').includes(squashed)))
        );
      })
      .map((ev) => ({ ev, date: eventDayKeys(ev.startAt, ev.endAt)[0] }));
  }, [events, search]);
  const hitIds = useMemo(() => new Set(hits.map((h) => h.ev.id)), [hits]);
  const activeHit = hits.length > 0 ? hits[Math.min(hitIndex, hits.length - 1)] : null;
  useEffect(() => {
    if (!activeHit) return undefined;
    const frame = requestAnimationFrame(() => {
      document.querySelector('.events-tape__seg--hit-current')?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeHit]);
  const stepHit = (n) => {
    if (hits.length === 0) return;
    setHover(null);
    setHitIndex((i) => (Math.min(i, hits.length - 1) + n + hits.length) % hits.length);
  };
  const onSearchChange = (text) => {
    setSearch(text);
    setHitIndex(0);
  };
  const clearSearch = () => {
    setSearch('');
    setHitIndex(0);
  };

  // Today's functions, asked for on their own: the chart's window can be
  // stepped months away, and "what is on now" still has to be answered. Asked
  // again each minute, which is also what moves a function from Upcoming to In
  // Progress on the chart without a refresh.
  const [todays, setTodays] = useState([]);
  useEffect(() => {
    let ignore = false;
    const load = () =>
      apiGet(`/events?${new URLSearchParams({ fromDate: today, toDate: today })}`, { token })
        .then((d) => {
          if (ignore) return;
          setTodays(d.events || []);
          setNow(Date.now());
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [token, today, refreshKey]);
  const liveNow = todays.filter((e) => eventPhase(e, now) === 'IN_PROGRESS');
  const nextUp = todays.find((e) => eventPhase(e, now) === 'UPCOMING');

  // The function a not-ready venue is waiting to be cleaned after: the last one
  // there to be over, by its booked end or by the desk marking it completed. Its
  // tile keeps its status colour — that is the money — and carries a strip in
  // the not-ready colour until housekeeping is done. Only one that ended today
  // or yesterday: a hall closed for repair a week on says nothing about a
  // function from last week.
  const awaitingClean = useMemo(() => {
    const ids = new Set();
    if (!notReady || notReady.size === 0) return ids;
    const since = addDays(today, -1);
    const last = new Map(); // venue → { id, over }
    for (const ev of events) {
      if (!['CONFIRMED', 'SETTLED'].includes(ev.status) || !notReady.has(String(ev.venueId))) continue;
      const end = new Date(ev.endAt).getTime();
      const done = ev.completedAt ? new Date(ev.completedAt).getTime() : null;
      const over = done != null && done < end ? done : end;
      if (over > now || toDateKey(new Date(over)) < since) continue;
      const seen = last.get(ev.venueId);
      if (!seen || over > seen.over) last.set(ev.venueId, { id: ev.id, over });
    }
    last.forEach((v) => ids.add(v.id));
    return ids;
  }, [events, notReady, today, now]);

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
  const step = (n) => goTo(addDays(windowStart, n * WINDOW_DAYS));
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
      // A fact about now, so it colours today and no other day.
      if (d === today && notReady?.has(String(venue.id))) classes.push('tape-tile--notready');
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
          aria-label={`${venue.name} vacant on ${formatEventDate(`${d}T00:00:00`)} — start a new event`}
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
          if (hitIds.has(ev.id)) {
            classes.push('events-tape__seg--hit');
            if (activeHit?.ev.id === ev.id) {
              classes.push('events-tape__seg--hit-active');
              if (activeHit.date === d) classes.push('events-tape__seg--hit-current');
            }
          }
          if (awaitingClean.has(ev.id)) classes.push('events-tape__seg--notready');
          // In time, as well as in money. The colour stays the status at full
          // strength; the function in the hall now carries a dot on today's.
          const phase = eventPhase(ev, now);
          if (phase === 'IN_PROGRESS' && d === today) classes.push('events-tape__seg--live');
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
        <div className={`tape-search${hits.length > 0 ? ' tape-search--found' : ''}`}>
          <div className="tape-search__box">
            <svg className="tape-search__icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              className="tape-search__input"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  clearSearch();
                  return;
                }
                if (e.key !== 'Enter') return;
                e.preventDefault();
                stepHit(e.shiftKey ? -1 : 1);
              }}
              placeholder="Search function, event no, organiser or phone"
              aria-label="Search the diary for a function, event number, organiser or phone"
            />
            {search !== '' && (
              <button type="button" className="tape-search__clear" onClick={clearSearch} aria-label="Clear search">
                &times;
              </button>
            )}
          </div>

          {search.trim() !== '' && (
            <div className="tape-search__result" role="status" aria-live="polite">
              {hits.length === 0 ? (
                <span className="tape-search__empty">No function matching &ldquo;{search.trim()}&rdquo;</span>
              ) : (
                <>
                  <span className="tape-search__count">
                    <strong>{Math.min(hitIndex, hits.length - 1) + 1}</strong>
                    <span className="tape-search__count-sep">/</span>
                    {hits.length}
                  </span>
                  <span className="tape-search__who">
                    <strong>{activeHit?.ev.title}</strong>
                    {activeHit && (
                      <>
                        <span className="tape-search__where">
                          {activeHit.ev.venueName} · {formatEventDate(`${activeHit.date}T00:00:00`)}
                        </span>
                        {activeHit.ev.organiserName && <span className="tape-search__where">{activeHit.ev.organiserName}</span>}
                      </>
                    )}
                  </span>
                  <div className="tape-search__stepper">
                    <button type="button" className="tape-search__arrow" onClick={() => stepHit(-1)} disabled={hits.length < 2} aria-label="Previous match" title="Previous match (Shift+Enter)">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
                    </button>
                    <button type="button" className="tape-search__arrow" onClick={() => stepHit(1)} disabled={hits.length < 2} aria-label="Next match" title="Next match (Enter)">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="events__toolbar-actions bookings-panel__toolbar-actions">
          <button
            type="button"
            className={`bookings-panel__draft-chip${drafts.length === 0 ? ' bookings-panel__draft-chip--empty' : ''}`}
            onClick={() => setShowDrafts(true)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5" />
            </svg>
            {drafts.length === 0 ? 'No Drafts' : `${drafts.length} Draft${drafts.length === 1 ? '' : 's'}`}
          </button>
          <button type="button" className="btn-accent" onClick={() => onNew(null, null)}>
            + New event
          </button>
        </div>
      </div>

      {showDrafts && (
        <div className="glass-backdrop bookings-panel__backdrop" onClick={() => setShowDrafts(false)}>
          <div className="glass-panel bookings-panel__modal" onClick={(e) => e.stopPropagation()}>
            <div className="bookings-panel__detail-header">
              <h3>Draft functions</h3>
              <span className="badge badge--off">{drafts.length}</span>
            </div>
            <p className="bookings-panel__hint">
              Started but not confirmed. A draft is held on the diary until it is confirmed or cancelled.
            </p>
            {drafts.length === 0 && (
              <div className="dash-state">Nothing parked right now. Save a function as a draft and it is listed here.</div>
            )}
            <div className="detail-people">
              {drafts.map((d) => (
                <div className="detail-person" key={d.id}>
                  <span className="detail-person__name">
                    {d.title || 'Untitled function'}
                    {d.organiserName && <span className="detail-person__role">{d.organiserName}</span>}
                  </span>
                  <span className="detail-person__meta">
                    {d.venueName}
                    {d.startAt ? ` · ${formatEventTime(d.startAt)}` : ''}
                    {d.startAt ? ` · ${new Date(d.startAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                  </span>
                  <span className="detail-person__meta">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setShowDrafts(false);
                        onOpen(d.id);
                      }}
                    >
                      Open
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="bookings-panel__actions">
              <button type="button" className="btn-secondary" onClick={() => setShowDrafts(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* What is on now and what is next today, in words, so nobody has to
          read it off the chart. Nothing on a day with no functions left. */}
      {(liveNow.length > 0 || nextUp) && (
        <div className="events-today" role="status">
          <span className="events-today__label">Today</span>
          {liveNow.map((ev) => (
            <button key={ev.id} type="button" className="events-today__item" onClick={() => onOpen(ev.id)}>
              <span className="events-today__tag events-today__tag--live">In progress</span>
              <strong>{ev.title}</strong>
              <span className="events-today__meta">
                {ev.venueName} · until {formatEventTime(ev.endAt)}
              </span>
            </button>
          ))}
          {nextUp && (
            <button type="button" className="events-today__item" onClick={() => onOpen(nextUp.id)}>
              <span className="events-today__tag">Up next</span>
              <strong>{nextUp.title}</strong>
              <span className="events-today__meta">
                {nextUp.venueName} · {formatEventTime(nextUp.startAt)}
              </span>
            </button>
          )}
        </div>
      )}

      <div className="tape-legend">
        <span className="tape-legend__item">
          <i className="tape-legend__swatch tape-legend__swatch--vacant" />
          Vacant
        </span>
        {/* Only where Housekeeping is on, and so has something to say. */}
        {notReady && (
          <span className="tape-legend__item" title="Needs cleaning, being cleaned or under repair today">
            <i className="tape-legend__swatch tape-legend__swatch--notready" />
            Not ready
          </span>
        )}
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
        {/* The mark a tile can carry, keyed like the colours are. */}
        <span className="tape-legend__item">
          <i className="tape-legend__swatch events-legend__mark events-legend__mark--live" />
          In progress
        </span>
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
              {rows.map((venue) => {
                const hk = notReady?.get(String(venue.id));
                return (
                <div key={venue.id} className={`tape-month__row${hover?.venue.id === venue.id ? ' tape-month__row--active' : ''}`}>
                  <div
                    className={`tape-month__room${hk ? ' tape-month__room--notready' : ''}`}
                    title={hk ? `${hk.label}${hk.note ? ` · ${hk.note}` : ''}` : undefined}
                  >
                    <strong>{venue.name}</strong>
                    {venue.capacityPax ? <span>up to {venue.capacityPax}</span> : null}
                  </div>
                  {dates.map((d) => renderCell(venue, d))}
                  {monthEdges.map((col) => (
                    <span key={col} className="tape-month__divider" style={{ '--tape-edge-col': col }} />
                  ))}
                </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {hover && (
        <div className={`tape-tooltip${hover.below ? ' tape-tooltip--below' : ''}`} role="tooltip" style={{ left: `${hover.x}px`, top: `${hover.y}px` }}>
          {hover.ev ? (
            <>
              <span className="tape-tooltip__top">
                <span className="tape-tooltip__dot" style={{ background: EVENT_STATUS_COLOR[hover.ev.status] }} />
                {EVENT_STATUS_LABEL[hover.ev.status]}
                {awaitingClean.has(hover.ev.id) ? ' · venue not ready' : ''}
              </span>
              <strong>{hover.ev.title}</strong>
              <span className="tape-tooltip__meta">
                {EVENT_TYPE_LABEL[hover.ev.eventType] || hover.ev.eventType} · {hover.venue.name}
              </span>
              <span className="tape-tooltip__dates">{formatEventWhen(hover.ev.startAt, hover.ev.endAt)}</span>
              <span className="tape-tooltip__meta">
                {hover.ev.organiserName} · {hover.ev.organiserPhone} · {hover.ev.expectedPax} guests
              </span>
              {isClosedStatus(hover.ev.status) && (
                <span className="tape-tooltip__hint">Cancelled — kept for the record</span>
              )}
              {eventPhase(hover.ev, now) && (
                <span className="tape-tooltip__meta">
                  {hover.ev.completedAt ? `Completed ${formatEventTime(hover.ev.completedAt)}` : eventPhaseLabel(hover.ev, now)}
                </span>
              )}
              {/* The hall is not ready: said on the function it is waiting to be
                  cleaned after, and on any function there today. */}
              {(hover.date === today || awaitingClean.has(hover.ev.id)) && !isClosedStatus(hover.ev.status) && notReady?.get(String(hover.venue.id)) && (
                <span className="tape-tooltip__hint tape-tooltip__hint--notready">
                  Venue: {notReady.get(String(hover.venue.id)).label.toLowerCase()}
                </span>
              )}
            </>
          ) : (
            <>
              {(() => {
                const hk = hover.date === today ? notReady?.get(String(hover.venue.id)) : null;
                return (
                  <>
                    <span className="tape-tooltip__top">
                      <span className={`tape-tooltip__dot tape-tooltip__dot--${hk ? 'notready' : 'vacant'}`} />
                      {hk ? `Vacant · ${hk.label.toLowerCase()}` : 'Vacant'}
                    </span>
                    {hk?.note && <span className="tape-tooltip__meta">{hk.note}</span>}
                  </>
                );
              })()}
              <strong>{hover.venue.name}</strong>
              <span className="tape-tooltip__dates">{formatEventDate(`${hover.date}T00:00:00`)}</span>
              <span className="tape-tooltip__hint">{hover.past ? 'Past date — bookings are closed' : 'Click to start a new event'}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- list */

// "Mon 31 Aug" over "6:00 – 11:00 pm": two short lines instead of one that wraps to four.
function compactWhen(startAt, endAt) {
  if (!startAt) return { day: '', time: '' };
  const start = new Date(startAt);
  const end = endAt ? new Date(endAt) : null;
  const day = start.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const clock = (d) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '\u00a0');
  if (!end) return { day, time: clock(start) };
  if (toDateKey(start) === toDateKey(end)) return { day, time: `${clock(start)} – ${clock(end)}` };
  return {
    day,
    time: `${clock(start)} – ${end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${clock(end)}`,
  };
}

const todayKey = () => toDateKey(new Date());
const monthStartKey = () => {
  const d = new Date();
  return toDateKey(new Date(d.getFullYear(), d.getMonth(), 1));
};

function defaultRange() {
  const from = new Date();
  from.setMonth(from.getMonth() - 1);
  const to = new Date();
  to.setMonth(to.getMonth() + 6);
  return { from: toDateKey(from), to: toDateKey(to) };
}

// The ranges a desk actually asks for — same shortcuts as the booking register,
// plus the one events need: what is coming up.
const EVENT_PRESETS = [
  { key: 'today', label: 'Today', range: () => ({ from: todayKey(), to: addDays(todayKey(), 1) }) },
  { key: 'week', label: 'Last 7 days', range: () => ({ from: addDays(todayKey(), -6), to: addDays(todayKey(), 1) }) },
  { key: 'month', label: 'This month', range: () => ({ from: monthStartKey(), to: addDays(todayKey(), 1) }) },
  {
    key: 'prev',
    label: 'Last month',
    range: () => {
      const d = new Date();
      return {
        from: toDateKey(new Date(d.getFullYear(), d.getMonth() - 1, 1)),
        to: toDateKey(new Date(d.getFullYear(), d.getMonth(), 1)),
      };
    },
  },
  { key: 'next', label: 'Next 30 days', range: () => ({ from: todayKey(), to: addDays(todayKey(), 30) }) },
];

// Dots reuse the booking register's swatches: amber is a draft, red is sold,
// slate is finished.
const EVENT_STATUS_SWATCH = {
  DRAFT: 'draft',
  CONFIRMED: 'booked',
  SETTLED: 'checked-out',
  CANCELLED: 'cancelled',
};

function EventStatTile({ label, value, note, active, hint, onClick, className = '' }) {
  return (
    <button
      type="button"
      className={`guest-register__stat guest-register__stat--action${active ? ' guest-register__stat--on' : ''} ${className}`}
      onClick={onClick}
      aria-pressed={active}
      title={hint}
    >
      <span className="guest-register__stat-label">{label}</span>
      <strong className="guest-register__stat-value">{value}</strong>
      {note && <span className="guest-register__stat-note">{note}</span>}
    </button>
  );
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
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const toggleSort = (key) =>
    setSort((cur) => {
      if (cur.key !== key) return { key, dir: 'asc' };
      if (cur.dir === 'asc') return { key, dir: 'desc' };
      return { key: null, dir: 'asc' };
    });

  useEffect(() => {
    const q = new URLSearchParams({ fromDate: range.from, toDate: range.to, includeClosed: 'true' });
    if (venueId) q.set('venueId', venueId);
    apiGet(`/events?${q}`, { token })
      .then((data) => {
        setEvents(data.events || []);
        setError('');
      })
      .catch((err) => setError(err.message));
  }, [range, venueId, token, refreshKey]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (events || []).filter(
      (e) =>
        (!status || e.status === status) &&
        (!needle ||
        e.title?.toLowerCase().includes(needle) ||
        e.eventNumber?.toLowerCase().includes(needle) ||
        e.organiserName?.toLowerCase().includes(needle) ||
        e.organiserPhone?.includes(needle))
    );
    // Unsorted keeps the diary order: soonest function first.
    const value = {
      when: (e) => new Date(e.startAt).getTime(),
      title: (e) => e.title || '',
      venue: (e) => e.venueName || '',
      organiser: (e) => e.organiserName || '',
      pax: (e) => Number(e.finalPax ?? e.expectedPax ?? 0),
      total: (e) => Number(e.totalAmount || 0),
      advance: (e) => Number(e.advanceAmount || 0),
      balance: (e) => Number(e.balanceDue || 0),
      status: (e) => EVENT_STATUS_LABEL[e.status] || e.status || '',
    }[sort.key || 'when'];
    const dir = sort.key && sort.dir === 'desc' ? -1 : 1;
    return list.sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });
  }, [events, search, status, sort]);

  const counts = useMemo(() => {
    const c = {};
    for (const e of events || []) c[e.status] = (c[e.status] || 0) + 1;
    return c;
  }, [events]);
  const live = (events || []).filter((e) => e.status !== 'CANCELLED');
  const stats = {
    functions: live.length,
    guests: live.reduce((n, e) => n + Number(e.finalPax ?? e.expectedPax ?? 0), 0),
    confirmed: counts.CONFIRMED || 0,
    settled: (events || []).filter((e) => e.status === 'SETTLED'),
    due: (events || []).filter((e) => e.status === 'CONFIRMED' && Number(e.balanceDue) > 0),
  };
  const billedAmount = stats.settled.reduce((n, e) => n + Number(e.totalAmount || 0), 0);
  const dueAmount = stats.due.reduce((n, e) => n + Number(e.balanceDue || 0), 0);
  const activePreset = EVENT_PRESETS.find((pr) => {
    const r = pr.range();
    return r.from === range.from && r.to === range.to;
  });
  const filtersActive = Boolean(status || venueId || search);
  const clearFilters = () => {
    setStatus('');
    setVenueId('');
    setSearch('');
  };

  return (
    <div className="events">
      <div className="dash-card guest-register__toolbar events-filter">
        <div className="guest-register__toolbar-top">
          <div className="guest-register__range">
            <div className="field guest-register__range-field">
              <label htmlFor="evFrom">From</label>
              <input
                id="evFrom"
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
              />
            </div>
            <span className="guest-register__range-dash" aria-hidden="true">
              –
            </span>
            <div className="field guest-register__range-field">
              <label htmlFor="evTo">To</label>
              <input
                id="evTo"
                type="date"
                value={range.to}
                min={range.from ? addDays(range.from, 1) : undefined}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              />
            </div>
          </div>

          <div className="field guest-register__search">
            <label htmlFor="evSearch">Find a function</label>
            <div className="guest-register__search-box">
              <svg className="guest-register__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                id="evSearch"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type a title, event ID, organiser name or phone"
              />
              {search && (
                <button type="button" className="guest-register__search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                  ×
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <label htmlFor="evVenue">Venue</label>
            <select id="evVenue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
              <option value="">All venues</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="guest-register__toolbar-bottom">
          <div className="guest-register__presets">
            {EVENT_PRESETS.map((pr) => (
              <button
                key={pr.key}
                type="button"
                className="guest-register__preset"
                aria-pressed={activePreset?.key === pr.key}
                onClick={() => setRange(pr.range())}
              >
                {pr.label}
              </button>
            ))}
          </div>

          <div className="guest-register__status-filters" role="group" aria-label="Filter by status">
            {[['', 'All', null], ...Object.entries(EVENT_STATUS_LABEL).map(([k, v]) => [k, v, EVENT_STATUS_SWATCH[k]])].map(
              ([key, label, swatch]) => {
                const count = key ? counts[key] || 0 : (events || []).length;
                return (
                  <button
                    key={key || 'ALL'}
                    type="button"
                    className={`guest-register__status-chip${events && swatch && !count ? ' guest-register__status-chip--empty' : ''}`}
                    aria-pressed={status === key}
                    onClick={() => setStatus(key)}
                  >
                    {swatch && <i aria-hidden="true" className={`guest-register__status-swatch guest-register__status-swatch--${swatch}`} />}
                    {label}
                    {events && <span className="guest-register__status-count">{count}</span>}
                  </button>
                );
              }
            )}
          </div>

          <button
            type="button"
            className={`guest-register__clear-filters${filtersActive ? '' : ' guest-register__clear-filters--idle'}`}
            onClick={clearFilters}
            disabled={!filtersActive}
            aria-hidden={!filtersActive}
          >
            Clear filters
          </button>
        </div>
      </div>

      {events && (
        <div className="guest-register__stats">
          <EventStatTile label="Functions" value={stats.functions} note={counts.CANCELLED ? `${counts.CANCELLED} cancelled` : null} active={!status} hint="Show every function" onClick={() => setStatus('')} />
          <EventStatTile label="Confirmed" value={stats.confirmed} note="booked and paid for in part" active={status === 'CONFIRMED'} hint="Show only confirmed functions" onClick={() => setStatus('CONFIRMED')} />
          <EventStatTile className="guest-register__stat--money" label="Billed" value={formatPrice(billedAmount)} note={`${stats.settled.length} ${stats.settled.length === 1 ? 'function' : 'functions'} settled`} active={status === 'SETTLED'} hint="Show only settled functions" onClick={() => setStatus('SETTLED')} />
          {dueAmount > 0 && (
            <EventStatTile className="guest-register__stat--pending" label="Pending" value={formatPrice(dueAmount)} note={`${stats.due.length} ${stats.due.length === 1 ? 'function' : 'functions'} not billed yet`} active={status === 'CONFIRMED'} hint="Show confirmed functions with a balance still due" onClick={() => setStatus('CONFIRMED')} />
          )}
        </div>
      )}

      {error && <div className="form-banner form-banner--error">{error}</div>}

      <div className="dash-card">
        {events === null ? (
          <PageLoader inline label="Loading" />
        ) : shown.length === 0 ? (
          <div className="dash-state">No functions match.</div>
        ) : (
          <div className="dash-table-scroll events-sheet">
            <table className="dash-table events-sheet__table">
              <thead>
                <tr>
                  <th aria-sort={sort.key === 'when' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="asset-table__sort-btn" onClick={() => toggleSort('when')}>
                      When
                      <span className="asset-table__sort-icon" aria-hidden="true">
                        {sort.key === 'when' ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                      </span>
                    </button>
                  </th>
                  <th aria-sort={sort.key === 'title' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="asset-table__sort-btn" onClick={() => toggleSort('title')}>
                      Function
                      <span className="asset-table__sort-icon" aria-hidden="true">
                        {sort.key === 'title' ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                      </span>
                    </button>
                  </th>
                  <th aria-sort={sort.key === 'venue' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="asset-table__sort-btn" onClick={() => toggleSort('venue')}>
                      Venue
                      <span className="asset-table__sort-icon" aria-hidden="true">
                        {sort.key === 'venue' ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                      </span>
                    </button>
                  </th>
                  <th aria-sort={sort.key === 'organiser' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="asset-table__sort-btn" onClick={() => toggleSort('organiser')}>
                      Organiser
                      <span className="asset-table__sort-icon" aria-hidden="true">
                        {sort.key === 'organiser' ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                      </span>
                    </button>
                  </th>
                  <th aria-sort={sort.key === 'pax' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="asset-table__sort-btn" onClick={() => toggleSort('pax')}>
                      Pax
                      <span className="asset-table__sort-icon" aria-hidden="true">
                        {sort.key === 'pax' ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                      </span>
                    </button>
                  </th>
                  <th className="events-list__num" aria-sort={sort.key === 'total' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="asset-table__sort-btn" onClick={() => toggleSort('total')}>
                      Total
                      <span className="asset-table__sort-icon" aria-hidden="true">
                        {sort.key === 'total' ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                      </span>
                    </button>
                  </th>
                  <th className="events-list__num" aria-sort={sort.key === 'advance' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="asset-table__sort-btn" onClick={() => toggleSort('advance')}>
                      Advance
                      <span className="asset-table__sort-icon" aria-hidden="true">
                        {sort.key === 'advance' ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                      </span>
                    </button>
                  </th>
                  <th className="events-list__num" aria-sort={sort.key === 'balance' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="asset-table__sort-btn" onClick={() => toggleSort('balance')}>
                      Balance
                      <span className="asset-table__sort-icon" aria-hidden="true">
                        {sort.key === 'balance' ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                      </span>
                    </button>
                  </th>
                  <th aria-sort={sort.key === 'status' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="asset-table__sort-btn" onClick={() => toggleSort('status')}>
                      Status
                      <span className="asset-table__sort-icon" aria-hidden="true">
                        {sort.key === 'status' ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                      </span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((ev) => (
                  <tr key={ev.id} className="events-list__row" onClick={() => onOpen(ev.id)}>
                    <td className="events-sheet__when">
                      <strong>{compactWhen(ev.startAt, ev.endAt).day}</strong>
                      <span>{compactWhen(ev.startAt, ev.endAt).time}</span>
                    </td>
                    <td>
                      <span className="dash-lodge-name">{ev.title}</span>
                      <span className="events-list__sub">
                        {EVENT_TYPE_LABEL[ev.eventType] || ev.eventType}
                        {ev.eventNumber ? ` · ${ev.eventNumber}` : ''}
                      </span>
                    </td>
                    <td className="events-sheet__venue">{ev.venueName}</td>
                    <td>
                      {ev.organiserName}
                      <span className="events-list__sub">{ev.organiserPhone}</span>
                    </td>
                    <td className="events-list__num">{ev.finalPax ?? ev.expectedPax}</td>
                    <td className="events-list__num">{formatPrice(ev.totalAmount)}</td>
                    <td className={`events-list__num${ev.advanceAmount ? '' : ' events-sheet__zero'}`}>{formatPrice(ev.advanceAmount || 0)}</td>
                    <td
                      className={`events-list__num${
                        Number(ev.balanceDue) > 0 && !['SETTLED', 'CANCELLED'].includes(ev.status) ? ' events-sheet__due' : ''
                      }`}
                    >
                      {formatPrice(ev.balanceDue)}
                    </td>
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

// Add-ons, in the price chart's shape: the list, then a button that opens a
// popup. The same popup edits one.
function AddonsTab({ addons, reloadCatalogue }) {
  const token = getSession()?.token;
  const [form, setForm] = useState(null); // { id, name, defaultAmount, isPerUnit }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const setField = (key, value) => {
    setForm((d) => ({ ...d, [key]: value }));
    setFieldErrors((errs) => (errs[key] ? { ...errs, [key]: '' } : errs));
  };

  const open = (a) => {
    setFormError('');
    setFieldErrors({});
    setForm(
      a
        ? { id: a.id, name: a.name, defaultAmount: a.defaultAmount ?? '', isPerUnit: Boolean(a.isPerUnit) }
        : { id: null, name: '', defaultAmount: '', isPerUnit: false }
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!String(form.name).trim()) errs.name = 'Add-on name is required';
    if (!(Number(form.defaultAmount) > 0)) errs.defaultAmount = 'Price is required';
    setFieldErrors(errs);
    const first = ['name', 'defaultAmount'].find((key) => errs[key]);
    if (first) {
      setFormError('');
      document.getElementById({ name: 'addonName', defaultAmount: 'addonPrice' }[first])?.focus();
      return;
    }
    const body = { name: String(form.name).trim(), defaultAmount: Number(form.defaultAmount) || 0, isPerUnit: Boolean(form.isPerUnit) };
    setBusy(true);
    setFormError('');
    try {
      if (form.id) await apiPatch(`/events/addons/${form.id}`, body, { token });
      else await apiPost('/events/addons', body, { token });
      await reloadCatalogue();
      setForm(null);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (a) => {
    setBusy(true);
    setError('');
    try {
      await apiPatch(`/events/addons/${a.id}`, { isActive: !a.isActive }, { token });
      await reloadCatalogue();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="events-setup">
      <div className="dash-card chart-section">
        <div className="chart-section__header">
          <h3>Add-ons</h3>
          <span className="chart-section__hint">Extras quoted on top of venue and plates — DJ, decor, mandap. Priced per day.</span>
        </div>
        {error && <div className="form-banner form-banner--error">{error}</div>}
        <div className="chart-list">
          {addons.length === 0 && <div className="events-detail__empty">Nothing set up yet.</div>}
          {addons.map((a) => (
            <div key={a.id} className="chart-row">
              <span className="chart-row__name">
                {a.name}
                {!a.isActive && <span className="badge badge--off chart-row__badge">Inactive</span>}
              </span>
              <span className="chart-row__value">
                {formatPrice(a.defaultAmount)}
                {a.isPerUnit ? ' per unit/day' : '/day'}
                <span className="chart-row__actions">
                  <IconButton label={`Edit ${a.name}`} icon={<EditIcon />} onClick={() => open(a)} />
                  <button type="button" className="chart-row__link-btn" disabled={busy} onClick={() => toggleActive(a)}>
                    {a.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </span>
              </span>
            </div>
          ))}
        </div>
        <div className="chart-section__add">
          <button type="button" className="btn-accent" onClick={() => open(null)}>
            + Add New Add-on
          </button>
        </div>
      </div>

      {form && (
        <Modal
          title={form.id ? 'Edit add-on' : 'Add new add-on'}
          sub="An extra quoted on top of the venue, such as DJ, decor or mandap."
          busy={busy}
          onClose={() => setForm(null)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="addonForm" className="btn-accent" disabled={busy}>
                {busy ? 'Saving…' : form.id ? 'Save changes' : 'Add add-on'}
              </button>
            </>
          }
        >
          <form id="addonForm" className="events-setup-form" onSubmit={submit} noValidate>
            {formError && <div className="form-banner form-banner--error">{formError}</div>}
            <div className="field">
              <label htmlFor="addonName">
                Add-on name
                <Req />
              </label>
              <input
                id="addonName"
                value={form.name}
                aria-invalid={Boolean(fieldErrors.name) || undefined}
                // The first letter of each word goes up as it is typed.
                onChange={(e) => setField('name', e.target.value.replace(/(^|\s)\S/g, (c) => c.toUpperCase()))}
                placeholder="e.g. DJ, Stage Decor"
                autoFocus
              />
              {fieldErrors.name && <p className="field__error">{fieldErrors.name}</p>}
            </div>
            <div className="field">
              <label htmlFor="addonPrice">
                {form.isPerUnit ? 'Price per unit, per day (₹)' : 'Price per day (₹)'}
                <Req />
              </label>
              <input
                id="addonPrice"
                type="number"
                min="1"
                value={form.defaultAmount}
                aria-invalid={Boolean(fieldErrors.defaultAmount) || undefined}
                onChange={(e) => setField('defaultAmount', e.target.value)}
                placeholder="e.g. 5000"
              />
              {fieldErrors.defaultAmount && <p className="field__error">{fieldErrors.defaultAmount}</p>}
            </div>
            <label className="inline-add-form__check">
              <input type="checkbox" checked={form.isPerUnit} onChange={(e) => setField('isPerUnit', e.target.checked)} />
              <span>
                Charge per unit
                <small>Tick if a function can take more than one (like chairs); the price is multiplied by the quantity quoted.</small>
              </span>
            </label>
          </form>
        </Modal>
      )}
    </div>
  );
}

// Venues, laid out like the Rooms tab in Rooms & rates: a toolbar, a grid of
// cards (photo, status, rent, capacity) and one popup that both adds a
// venue and edits one. The cards borrow the room card's own classes so the two
// screens cannot drift apart.
function VenuesTab({ venues, reloadCatalogue }) {
  const token = getSession()?.token;
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null); // { id, name, capacityPax, baseCharge, imageFiles }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  // What is wrong with each field, shown under it. A field's message goes as
  // soon as that field is typed in again.
  const [fieldErrors, setFieldErrors] = useState({});
  const setField = (key, value) => {
    setForm((d) => ({ ...d, [key]: value }));
    setFieldErrors((errs) => (errs[key] ? { ...errs, [key]: '' } : errs));
  };

  const urlFor = (filename) => `${API_BASE}/venue-images/${filename}`;

  const needle = search.trim().toLowerCase();
  const shown = venues.filter(
    (v) => !needle || v.name.toLowerCase().includes(needle) || (v.isActive ? 'active' : 'inactive').startsWith(needle)
  );

  const openAdd = () => {
    setFormError('');
    setFieldErrors({});
    setForm({ id: null, name: '', capacityPax: '', baseCharge: '', imageFiles: [] });
  };
  const openEdit = (v) => {
    setFormError('');
    setFieldErrors({});
    setForm({ id: v.id, name: v.name, capacityPax: v.capacityPax ?? '', baseCharge: v.baseCharge ?? '', imageFiles: [] });
  };
  // Read from the list rather than copied into the form, so a photo removed
  // while the popup is open is gone from it as soon as the list reloads.
  const savedImages = (form?.id && venues.find((v) => v.id === form.id)?.images) || [];

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

  const submit = async (e) => {
    e.preventDefault();
    // Every field is checked, so one press shows everything that needs fixing.
    const errs = {};
    if (!String(form.name).trim()) errs.name = 'Venue name is required';
    if (!(Number(form.capacityPax) > 0)) errs.capacityPax = 'Capacity is required';
    if (!(Number(form.baseCharge) > 0)) errs.baseCharge = 'Rent is required';
    setFieldErrors(errs);
    const first = ['name', 'capacityPax', 'baseCharge'].find((key) => errs[key]);
    if (first) {
      setFormError('');
      document.getElementById({ name: 'venueName', capacityPax: 'venueCapacity', baseCharge: 'venueCharge' }[first])?.focus();
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      if (form.id) await apiPatchForm(`/events/venues/${form.id}`, venueForm(form), { token });
      else await apiPostForm('/events/venues', venueForm(form), { token });
      await reloadCatalogue();
      setForm(null);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (v) => {
    if (!window.confirm(v.isActive ? `Deactivate ${v.name}? It can no longer be booked for new functions.` : `Activate ${v.name}?`)) return;
    setBusy(true);
    setError('');
    try {
      await apiPatch(`/events/venues/${v.id}`, { isActive: !v.isActive }, { token });
      await reloadCatalogue();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteImage = async (imageId) => {
    setBusy(true);
    setFormError('');
    try {
      await apiDelete(`/events/venues/${form.id}/images/${imageId}`, { token });
      await reloadCatalogue();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Adds to the queue without going past the cap, counting the saved photos.
  const queueFiles = (fileList) =>
    setForm((d) => {
      const room = MAX_VENUE_IMAGES - savedImages.length - d.imageFiles.length;
      return room <= 0 ? d : { ...d, imageFiles: [...d.imageFiles, ...fileList.slice(0, room)] };
    });

  return (
    <div className="rooms-panel">
      <div className="rooms-panel__toolbar">
        <span className="rooms-panel__count">
          {needle
            ? `${shown.length} of ${venues.length} venue${venues.length === 1 ? '' : 's'}`
            : `${venues.length} venue${venues.length === 1 ? '' : 's'}`}
        </span>
        <input
          type="search"
          className="rooms-panel__search"
          placeholder="Search venues, status…"
          aria-label="Search venues, status"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="btn-accent" onClick={openAdd}>
          + Add venue
        </button>
      </div>

      {error && <div className="form-banner form-banner--error">{error}</div>}

      {venues.length === 0 && (
        <div className="dash-card">
          <div className="dash-state">No venues yet. Add your first hall or lawn to start taking function bookings.</div>
        </div>
      )}
      {venues.length > 0 && shown.length === 0 && (
        <div className="dash-card">
          <div className="dash-state">No venues match "{search.trim()}".</div>
        </div>
      )}

      {shown.length > 0 && (
        <div className="room-grid">
          {shown.map((v) => {
            const cover = v.images?.[0];
            return (
              <div className="room-card venue-card" key={v.id}>
                <div className={`room-card__cover${cover ? '' : ' room-card__cover--empty'}`}>
                  {cover ? (
                    <img
                      src={urlFor(cover.filename)}
                      alt={v.name}
                      className="room-card__cover-img"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="room-card__cover-placeholder">{v.name}</div>
                  )}
                  <button
                    type="button"
                    className={`room-card__status badge ${v.isActive ? 'badge--on' : 'badge--off'}`}
                    disabled={busy}
                    onClick={() => toggleActive(v)}
                    title={`Click to ${v.isActive ? 'deactivate' : 'activate'} ${v.name}`}
                    aria-label={`${v.name} is ${v.isActive ? 'active' : 'inactive'}. Click to ${v.isActive ? 'deactivate' : 'activate'}.`}
                  >
                    {v.isActive ? 'Active' : 'Inactive'}
                  </button>
                  {v.images?.length > 1 && <span className="room-card__photo-count">+{v.images.length - 1}</span>}
                </div>

                <div className="room-card__body">
                  <div className="room-card__top">
                    {/* The photoless band above already carries the name. */}
                    {cover && <span className="room-card__number">{v.name}</span>}
                    <span className="room-card__rate">
                      {formatPrice(v.baseCharge)}
                      <span className="room-card__rate-unit"> /day</span>
                    </span>
                  </div>
                  <div className="room-card__category">Venue rent</div>
                  {v.capacityPax ? (
                    <div className="room-card__chips">
                      <span className="room-card__chip room-card__chip--occupancy">Up to {v.capacityPax} guests</span>
                    </div>
                  ) : null}
                </div>

                <div className="room-card__actions">
                  <IconButton label={`Edit ${v.name}`} icon={<EditIcon />} onClick={() => openEdit(v)} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form && (
        <Modal
          title={form.id ? `Edit venue · ${form.name}` : 'Add venue'}
          sub="A hall or lawn that can be booked for a function."
          busy={busy}
          onClose={() => setForm(null)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="venueForm" className="btn-accent" disabled={busy}>
                {busy ? 'Saving…' : form.id ? 'Save changes' : 'Add venue'}
              </button>
            </>
          }
        >
          <form id="venueForm" className="events-setup-form" onSubmit={submit} noValidate>
            {formError && <div className="form-banner form-banner--error">{formError}</div>}
            <div className="field">
              <label htmlFor="venueName">
                Venue name
                <Req />
              </label>
              <input
                id="venueName"
                value={form.name}
                aria-invalid={Boolean(fieldErrors.name) || undefined}
                // The first letter of each word goes up as it is typed.
                onChange={(e) => setField('name', e.target.value.replace(/(^|\s)\S/g, (c) => c.toUpperCase()))}
                placeholder="e.g. Banquet Hall, Garden Lawn"
                autoFocus
              />
              {fieldErrors.name && <p className="field__error">{fieldErrors.name}</p>}
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="venueCapacity">
                  Capacity (guests)
                  <Req />
                </label>
                <input
                  id="venueCapacity"
                  type="number"
                  min="1"
                  value={form.capacityPax}
                  aria-invalid={Boolean(fieldErrors.capacityPax) || undefined}
                  onChange={(e) => setField('capacityPax', e.target.value)}
                  placeholder="e.g. 300"
                />
                {fieldErrors.capacityPax && <p className="field__error">{fieldErrors.capacityPax}</p>}
              </div>
              <div className="field">
                <label htmlFor="venueCharge">
                  Rent per day (₹)
                  <Req />
                </label>
                <input
                  id="venueCharge"
                  type="number"
                  min="1"
                  value={form.baseCharge}
                  aria-invalid={Boolean(fieldErrors.baseCharge) || undefined}
                  onChange={(e) => setField('baseCharge', e.target.value)}
                  placeholder="e.g. 25000"
                />
                {fieldErrors.baseCharge && <p className="field__error">{fieldErrors.baseCharge}</p>}
              </div>
            </div>
            <div className="field">
              <label>Photos</label>
              <PhotoButton
                total={savedImages.length + form.imageFiles.length}
                max={MAX_VENUE_IMAGES}
                accept={VENUE_IMAGE_ACCEPT}
                disabled={busy}
                onAddFiles={queueFiles}
              />
              <PhotoStrip
                existing={savedImages}
                files={form.imageFiles}
                urlFor={urlFor}
                disabled={busy}
                onRemoveFile={(index) => setForm((d) => ({ ...d, imageFiles: d.imageFiles.filter((_, i) => i !== index) }))}
                onDeleteExisting={deleteImage}
              />
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// Venues and add-ons each get a tab of their own: a venue is a place with
// photos and a capacity, an add-on is a line on a quote, and one long page of
// both made each harder to find.
function Setup({ venues, addons, reloadCatalogue }) {
  const [tab, setTab] = useState('venues');

  return (
    <div>
      <div className="subtabs">
        <button type="button" className="subtabs__item" aria-current={tab === 'venues' ? 'page' : undefined} onClick={() => setTab('venues')}>
          Venues
        </button>
        <button type="button" className="subtabs__item" aria-current={tab === 'addons' ? 'page' : undefined} onClick={() => setTab('addons')}>
          Add-ons
        </button>
      </div>

      {tab === 'venues' && <VenuesTab venues={venues} reloadCatalogue={reloadCatalogue} />}
      {tab === 'addons' && <AddonsTab addons={addons} reloadCatalogue={reloadCatalogue} />}
    </div>
  );
}

/* --------------------------------------------------------------- shell */

// refreshKey is the dashboard's: it changes when something outside this
// screen — the bill modal — has moved a function on, and the diary and the
// list re-read on it exactly as they do on their own bump.
// `only` pins the screen to one of its tabs ('diary' | 'list' | 'setup') and
// drops the tab strip — each is its own sidebar section under Events.
export default function Events({
  lodge,
  onBillEvent,
  onViewInvoice,
  only = null,
  refreshKey: externalRefresh = 0,
  // An enquiry the desk just clicked "Confirm booking" on, from
  // Enquiries.jsx via OwnerDashboard.jsx's lifted-state handoff — see the
  // effect below. Consumed once (onPrefillConsumed) so navigating back here
  // later doesn't reopen the same form.
  prefillEnquiry = null,
  onPrefillConsumed,
  // Where closing a prefilled-from-enquiry form without saving should send
  // the desk back to.
  onReturnToEnquiries,
}) {
  const token = getSession()?.token;
  const [urlTab, setTab] = useUrlState('tab', 'diary');
  const tab = only ?? urlTab;
  const [venues, setVenues] = useState([]);
  const [addons, setAddons] = useState([]);
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

  // "Confirm booking" on an EVENT enquiry (Enquiries.jsx): opens the new-
  // function form pre-filled from it, the same way clicking a date on the
  // diary opens it pre-filled with just a date/venue. Fires once per
  // handed-over enquiry — not on every render, or closing the form the
  // prefill opened would reopen it straight away.
  useEffect(() => {
    if (!prefillEnquiry) return;
    setCreating({
      // Same ISO-timestamp-to-bare-date fix as Bookings.jsx's
      // openFromEnquiry: a DATE column comes back as
      // "2026-11-02T00:00:00.000Z", not the "2026-11-02" EventForm's
      // initialDate expects.
      date: prefillEnquiry.eventDate ? String(prefillEnquiry.eventDate).slice(0, 10) : null,
      venueId: prefillEnquiry.venueId || null,
      organiserName: prefillEnquiry.name || '',
      organiserPhone: prefillEnquiry.phone || '',
      eventType: prefillEnquiry.eventType || null,
      expectedPax: prefillEnquiry.guests ?? null,
      notes: prefillEnquiry.notes || '',
      // Flat lodge-wide catalog, not scoped per-venue, so unlike the
      // booking form's room extras these are safe to carry straight
      // through and pre-tick — see EventForm.jsx's initialLines.
      addonIds: prefillEnquiry.addonIds || [],
      enquiryId: prefillEnquiry.id,
    });
    onPrefillConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillEnquiry]);

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
        if (only) updated.set('section', 'eventRegister');
        else updated.set('tab', 'list');
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
      {!only && (
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
      )}

      {tab === 'diary' && (
        <Diary
          venues={venues}
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
          initialOrganiserName={creating.organiserName}
          initialOrganiserPhone={creating.organiserPhone}
          initialEventType={creating.eventType}
          initialExpectedPax={creating.expectedPax}
          initialNotes={creating.notes}
          initialAddonIds={creating.addonIds}
          initialEnquiryId={creating.enquiryId}
          venues={venues}
          addons={addons}
          lodge={lodge}
          onClose={() => {
            // Closing without saving a form opened from an enquiry's
            // "Confirm booking" takes the desk back to Enquiries, the same
            // courtesy Bookings.jsx's returnToEnquiriesIfCame gives — not
            // left stranded on the diary they didn't ask to be on. A save
            // (onSaved below) stays here instead, to show the new function.
            const fromEnquiry = Boolean(creating.enquiryId);
            setCreating(null);
            if (fromEnquiry) onReturnToEnquiries?.();
          }}
          onSaved={(ev) => {
            // A function confirmed from an enquiry sends the desk back to
            // Enquiries; any other save stays here to show the new function.
            const fromEnquiry = Boolean(creating.enquiryId);
            setCreating(null);
            bump();
            if (fromEnquiry) onReturnToEnquiries?.();
            else setOpenId(ev.id);
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
