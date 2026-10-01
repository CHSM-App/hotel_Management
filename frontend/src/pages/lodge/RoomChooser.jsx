import { useMemo, useState } from 'react';
import { formatPrice } from './priceFormat';
import PageLoader from '../../components/PageLoader';

// The free rooms for the chosen dates, to tick — what a desk uses to book several
// rooms for the same nights in one go. Built for a property with a hundred rooms as
// much as for one with ten: rooms are grouped under their category, a chip per
// category filters to it (with how many are free and how many are ticked), a search
// box finds a room by number, category or floor, and each group can be ticked or
// cleared whole. Rooms are compact tiles, so many fit on screen at once.
//
// A room that has already checked in (on an edit) stays ticked and can't be
// unticked here: it is part of the stay now and leaves by checking out.
// "Ground" stays "Ground"; a bare number becomes "Floor 2". The old text put
// "Floor" in front of everything, which read as "Floor Ground".
function floorLabel(floor) {
  const f = String(floor ?? '').trim();
  if (!f) return '';
  return /^\d+$/.test(f) ? `Floor ${f}` : f;
}

export default function RoomChooser({ rooms, pickedIds, lockedIds, onToggle, onToggleMany, disabled }) {
  const [category, setCategory] = useState('ALL');
  const [query, setQuery] = useState('');
  const [onlyTicked, setOnlyTicked] = useState(false);

  const picked = useMemo(() => new Set(pickedIds), [pickedIds]);
  const locked = useMemo(() => new Set(lockedIds ?? []), [lockedIds]);

  // Categories in the order rooms first mention them (the list arrives by room number).
  const categories = useMemo(() => {
    const byName = new Map();
    for (const room of rooms ?? []) {
      const name = room.categoryName || 'Other';
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(room);
    }
    return Array.from(byName, ([name, list]) => ({ name, rooms: list }));
  }, [rooms]);

  // What the search and the "ticked only" switch leave; the category chip is applied
  // after, so each chip's count still says how many of ITS rooms match.
  const needle = query.trim().toLowerCase();
  const matches = (room) => {
    if (onlyTicked && !picked.has(String(room.id))) return false;
    if (!needle) return true;
    return [room.roomNumber, room.categoryName, floorLabel(room.floor), room.floor ? `floor ${room.floor}` : '']
      .join(' ')
      .toLowerCase()
      .includes(needle);
  };

  const visible = categories
    .filter((c) => category === 'ALL' || c.name === category)
    .map((c) => ({ ...c, rooms: c.rooms.filter(matches) }))
    .filter((c) => c.rooms.length > 0);

  const total = rooms?.length ?? 0;
  const tickedIn = (list) => list.filter((r) => picked.has(String(r.id))).length;

  const priceOf = (list) => {
    const prices = list.map((r) => Number(r.categoryBasePrice)).filter((n) => Number.isFinite(n));
    if (prices.length === 0) return '';
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const unit = list.every((r) => r.isDormitory) ? '/bed/night' : '/night';
    return `${lo === hi ? formatPrice(lo) : `${formatPrice(lo)}–${formatPrice(hi)}`}${unit}`;
  };

  return (
    <div className="field room-chooser">
      <label id="roomChooserLabel">
        Choose rooms
        <span className="room-chooser__count">
          {picked.size === 0 ? 'none selected yet' : `${picked.size} selected`}
        </span>
      </label>
      <p className="bookings-panel__hint">Tick every room you want on this booking.</p>

      {!rooms && <PageLoader inline label="Loading rooms" />}
      {rooms && total === 0 && <p className="bookings-panel__hint">No rooms are free for these dates.</p>}

      {rooms && total > 0 && (
        <>
          {/* Worth the space once there are enough rooms that scrolling to find one
              is slower than typing its number. */}
          {total > 8 && (
            <input
              className="room-chooser__search"
              type="search"
              placeholder="Search by room number, type or floor"
              aria-label="Search rooms"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}

          {categories.length > 1 && (
            <div className="room-chooser__filters" role="group" aria-label="Room type">
              <button
                type="button"
                className={`room-chooser__chip${category === 'ALL' ? ' room-chooser__chip--on' : ''}`}
                aria-pressed={category === 'ALL'}
                onClick={() => setCategory('ALL')}
              >
                All <span>{total}</span>
              </button>
              {categories.map((c) => {
                const n = tickedIn(c.rooms);
                return (
                  <button
                    type="button"
                    key={c.name}
                    className={`room-chooser__chip${category === c.name ? ' room-chooser__chip--on' : ''}`}
                    aria-pressed={category === c.name}
                    onClick={() => setCategory(category === c.name ? 'ALL' : c.name)}
                  >
                    {c.name} <span>{c.rooms.length}</span>
                    {n > 0 && <em title={`${n} ticked`}>✓ {n}</em>}
                  </button>
                );
              })}
              {picked.size > 0 && (
                <button
                  type="button"
                  className={`room-chooser__chip room-chooser__chip--ghost${onlyTicked ? ' room-chooser__chip--on' : ''}`}
                  aria-pressed={onlyTicked}
                  onClick={() => setOnlyTicked((v) => !v)}
                >
                  Ticked only <span>{picked.size}</span>
                </button>
              )}
            </div>
          )}

          <div className="room-chooser__scroll">
            {visible.length === 0 && (
              <p className="bookings-panel__hint">
                No rooms match{needle ? ` “${query.trim()}”` : ''}. Clear the search or pick another type.
              </p>
            )}
            {visible.map((group) => {
              const free = group.rooms.filter((r) => !picked.has(String(r.id)));
              const ticked = group.rooms.filter((r) => picked.has(String(r.id)) && !locked.has(String(r.id)));
              return (
                <section className="room-chooser__group" key={group.name}>
                  <header className="room-chooser__group-head">
                    <span>
                      <strong>{group.name}</strong>
                      <small>
                        {priceOf(group.rooms)} · {group.rooms.length} free
                      </small>
                    </span>
                    {!disabled && onToggleMany && (
                      <span className="room-chooser__group-actions">
                        {free.length > 0 && (
                          <button type="button" onClick={() => onToggleMany(free, true)}>
                            Tick all {free.length}
                          </button>
                        )}
                        {ticked.length > 0 && (
                          <button type="button" onClick={() => onToggleMany(ticked, false)}>
                            Clear
                          </button>
                        )}
                      </span>
                    )}
                  </header>
                  <ul className="room-chooser__tiles">
                    {group.rooms.map((room) => {
                      const on = picked.has(String(room.id));
                      const fixed = on && locked.has(String(room.id));
                      return (
                        <li key={room.id}>
                          <label
                            className={`room-chooser__tile${on ? ' room-chooser__tile--on' : ''}${
                              fixed ? ' room-chooser__tile--fixed' : ''
                            }`}
                            title={[
                              `Room ${room.roomNumber}`,
                              room.categoryName,
                              floorLabel(room.floor) || null,
                              room.isDormitory ? 'Dormitory' : room.maxOccupancy ? `Sleeps ${room.maxOccupancy}` : null,
                              fixed ? 'Already in — leaves by checking out' : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          >
                            {/* A real checkbox, kept for keyboards and screen readers, but
                                not drawn: the tile's tint and the tick badge are the state. */}
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={disabled || fixed}
                              onChange={() => onToggle(room)}
                              aria-label={`Room ${room.roomNumber}`}
                            />
                            <span className="room-chooser__check" aria-hidden="true">
                              <svg viewBox="0 0 12 12" width="9" height="9" fill="none">
                                <path d="M2.2 6.4 4.8 9 9.8 3.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </span>
                            <span className="room-chooser__tile-num">{room.roomNumber}</span>
                            <span className="room-chooser__tile-sub">
                              {floorLabel(room.floor) || (room.isDormitory ? 'Dorm' : '')}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
