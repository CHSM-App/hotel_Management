import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiGet, apiPost, ApiError } from '../../lib/api';
import PageLoader from '../../components/PageLoader';
import { Modal, StatusIcon } from './HousekeepingParts';
import { ago, ISSUES_CHANGED } from './housekeepingFormat';

// What each kind of report is called, and what closing it means.
const KIND = {
  ISSUE: {
    label: 'Problem',
    tone: 'ooo',
    close: 'Mark fixed',
    closed: 'Fixed',
    question: 'What was done? (optional)',
    hint: 'e.g. plumber changed the tap',
  },
  FOUND: {
    label: 'Found item',
    tone: 'cleaning',
    close: 'Mark handed over',
    closed: 'Handed over',
    question: 'What happened to it? (optional)',
    hint: 'e.g. returned to guest, kept at reception',
  },
};

// "Room 12", or a venue by its own name.
const isVenue = (i) => i.space === 'VENUE';
const spaceName = (i) => (isVenue(i) ? i.roomNumber : `Room ${i.roomNumber}`);
// A found item goes back to a guest from a room, to the host from a hall.
const closeHint = (i) => (i.kind === 'FOUND' && isVenue(i) ? 'e.g. returned to the host, kept at reception' : KIND[i.kind].hint);

const day = (value) => new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

// Problems and found items cleaners reported when finishing a room or a venue.
// Until this list existed they were saved and never shown to anyone.
export default function HousekeepingIssues({ token, view, toolsHost, hasEvents = false, hasRooms = true }) {
  const [issues, setIssues] = useState(null);
  const [spaces, setSpaces] = useState('BOTH'); // ROOMS | VENUES | BOTH
  const [filter, setFilter] = useState('OPEN');
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(null); // { issue, note }
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = () =>
    apiGet('/housekeeping/issues?scope=all', { token })
      .then((d) => {
        setIssues(d.issues);
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the issues.'));

  useEffect(() => {
    load();
    // A report from a room upstairs shows up here without a refresh.
    const timer = setInterval(() => {
      load();
      setNow(Date.now());
    }, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitClose = async () => {
    setBusy(true);
    try {
      await apiPost(`/housekeeping/issues/${closing.issue.logId}/close`, { kind: closing.issue.kind, note: closing.note }, { token });
      setClosing(null);
      await load();
      window.dispatchEvent(new Event(ISSUES_CHANGED));
    } catch (err) {
      setClosing(null);
      setError(err instanceof ApiError ? err.message : 'Could not close this.');
    } finally {
      setBusy(false);
    }
  };

  // Only where there is a choice to make: a property with rooms and venues.
  const bothKinds = hasEvents && hasRooms;
  const inSpaces = (issues ?? []).filter((i) => !bothKinds || spaces === 'BOTH' || (spaces === 'VENUES') === isVenue(i));
  const open = inSpaces.filter((i) => !i.closedAt);
  const closed = inSpaces.filter((i) => i.closedAt);
  const placeHead = bothKinds ? 'Room / Venue' : hasEvents ? 'Venue' : 'Room';
  const place = bothKinds ? 'a room or a venue' : hasEvents ? 'a venue' : 'a room';
  // "All" keeps what is still waiting on top.
  const shown = filter === 'OPEN' ? open : filter === 'CLOSED' ? closed : [...open, ...closed];
  const filters = [
    { key: 'OPEN', label: 'Open', n: open.length },
    { key: 'CLOSED', label: 'Closed', n: closed.length },
    { key: 'ALL', label: 'All', n: open.length + closed.length },
  ];
  // A column only earns its place when some row shown has something in it.
  const anyOpen = shown.some((i) => !i.closedAt);
  const anyClosed = shown.some((i) => i.closedAt);

  return (
    <div className="chart-section hk-board">
      {/* Open / Closed is a "Show" menu on the section's tab strip, the same
          place the Rooms tab keeps its own, rather than a second row of tabs. */}
      {issues &&
        toolsHost &&
        createPortal(
          <>
            {bothKinds && (
              <label className="hk-show">
                <select value={spaces} onChange={(e) => setSpaces(e.target.value)} aria-label="Show rooms, venues or both">
                  <option value="BOTH">Rooms and venues</option>
                  <option value="ROOMS">Rooms only</option>
                  <option value="VENUES">Venues only</option>
                </select>
              </label>
            )}
            <label className="hk-show">
              <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show issues">
                {filters.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label} ({f.n})
                  </option>
                ))}
              </select>
            </label>
          </>,
          toolsHost
        )}

      {error && <div className="form-banner form-banner--error">{error}</div>}
      {!issues && !error && <PageLoader inline label="Loading issues" />}

      {issues && shown.length === 0 && (
        <div className="hk-empty">
          <span className="hk-empty__icon">
            <StatusIcon tone="ready" size={22} />
          </span>
          <p className="hk-empty__title">{filter === 'CLOSED' ? 'Nothing closed yet' : filter === 'OPEN' ? 'Nothing waiting' : 'Nothing reported yet'}</p>
          <p className="hk-empty__text">
            {filter === 'CLOSED'
              ? 'Problems you mark fixed and items you hand over move here.'
              : `When a cleaner reports a problem or a found item while finishing ${place}, it appears here.`}
          </p>
        </div>
      )}

      {view === 'table' && shown.length > 0 && (
        <table className="hk-rooms">
          <thead>
            <tr>
              <th scope="col">{placeHead}</th>
              <th scope="col">Reported</th>
              <th scope="col" className="hk-rooms__wide">
                Type
              </th>
              <th scope="col" className="hk-rooms__wide">
                Reported by
              </th>
              <th scope="col" className="hk-rooms__wide">
                {anyOpen && anyClosed ? 'Waiting / closed' : anyClosed ? 'Closed' : 'Waiting'}
              </th>
              {anyClosed && (
                <th scope="col" className="hk-rooms__wide">
                  Note
                </th>
              )}
              {anyOpen && (
                <th scope="col" className="hk-rooms__actions">
                  Action
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => {
              const kind = KIND[i.kind];
              const when = i.closedAt ? `${day(i.closedAt)}${i.closedBy ? ` · ${i.closedBy}` : ''}` : ago(i.reportedAt, now);
              return (
                <tr key={`${i.logId}:${i.kind}`}>
                  <th scope="row" className="hk-rooms__room">
                    {i.roomNumber}
                  </th>
                  <td>
                    <span className="hk-issue__text">{i.text}</span>
                    {i.roomBlocked && <span className="hk-arrival hk-arrival--ooo hk-issue__tag">Held under repair</span>}
                    {/* On a phone the other columns go, so they sit under the text. */}
                    <span className="hk-rooms__sub">
                      {[kind.label, i.reportedBy, when].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="hk-rooms__wide">
                    <span className={`hk-status hk-status--${i.closedAt ? 'occupied' : kind.tone}`}>{kind.label}</span>
                  </td>
                  <td className="hk-rooms__wide">{i.reportedBy || '—'}</td>
                  <td className="hk-rooms__wide">{when}</td>
                  {anyClosed && <td className="hk-rooms__wide">{i.resolution || '—'}</td>}
                  {anyOpen && (
                    <td className="hk-rooms__actions">
                      {!i.closedAt && (
                        <button type="button" className="hk-action" disabled={busy} onClick={() => setClosing({ issue: i, note: '' })}>
                          {kind.close}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {view === 'cards' && (
      <div className="hk-list">
        {shown.map((i) => {
          const kind = KIND[i.kind];
          return (
            <article className={`hk-card hk-card--${i.closedAt ? 'occupied' : kind.tone}`} key={`${i.logId}:${i.kind}`}>
              {/* A venue's name is too long for the tile, as on the cleaning board:
                  the tile says what it is and the name sits over the report. */}
              {isVenue(i) ? (
                <span className="hk-card__room hk-card__room--venue">Venue</span>
              ) : (
                <span className="hk-card__room">{i.roomNumber}</span>
              )}
              <div className="hk-card__body">
                <div className="hk-card__line">
                  {isVenue(i) && <span className="hk-card__floor">{i.roomNumber}</span>}
                  <span className="hk-card__cat hk-issue__text">{i.text}</span>
                </div>
                <div className="hk-card__state">
                  <span className="hk-status">{kind.label}</span>
                  <span className="hk-card__detail">
                    {i.closedAt
                      ? `${kind.closed} ${day(i.closedAt)}${i.closedBy ? ` · ${i.closedBy}` : ''}`
                      : `${ago(i.reportedAt, now)} ago${i.reportedBy ? ` · ${i.reportedBy}` : ''}`}
                  </span>
                  {i.roomBlocked && <span className="hk-arrival hk-arrival--ooo">Held under repair</span>}
                </div>
                {i.resolution && <div className="hk-card__detail">{i.resolution}</div>}
              </div>
              {!i.closedAt && (
                <div className="hk-card__side">
                  <button type="button" className="hk-action" disabled={busy} onClick={() => setClosing({ issue: i, note: '' })}>
                    {kind.close}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      )}

      {closing && (
        <Modal
          title={`${spaceName(closing.issue)} · ${KIND[closing.issue.kind].close.toLowerCase()}?`}
          sub={closing.issue.text}
          busy={busy}
          onClose={() => setClosing(null)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setClosing(null)} disabled={busy}>
                Not yet
              </button>
              <button type="button" className="btn-accent" onClick={submitClose} disabled={busy}>
                {busy ? 'Saving…' : KIND[closing.issue.kind].close}
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="hkCloseNote">{KIND[closing.issue.kind].question}</label>
            <input
              id="hkCloseNote"
              maxLength={300}
              placeholder={closeHint(closing.issue)}
              value={closing.note}
              onChange={(e) => setClosing({ ...closing, note: e.target.value })}
              autoFocus
            />
          </div>
          {closing.issue.roomBlocked && (
            <p className="hk-hint">{spaceName(closing.issue)} is held under repair for this. Marking it fixed sends it to the cleaning list.</p>
          )}
        </Modal>
      )}
    </div>
  );
}
