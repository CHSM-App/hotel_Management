import { useEffect, useState } from 'react';
import { apiGet } from '../../lib/api';
import './HousekeepingPanel.css';

// What housekeeping says about a room, in the desk's words. Anything but Ready
// is worth a second look before handing over the key.
const STATUS = {
  READY: { label: 'Ready', tone: 'ready' },
  DIRTY: { label: 'Needs cleaning', tone: 'dirty' },
  CLEANING: { label: 'Being cleaned', tone: 'cleaning' },
  OUT_OF_ORDER: { label: 'Under repair', tone: 'ooo' },
  OCCUPIED: { label: 'Occupied', tone: 'occupied' },
};

// The housekeeping status of the rooms about to be checked in, at the top of
// the check-in form. It informs and never blocks: the desk may know something
// the board does not. Shows nothing for a property without Housekeeping, where
// the request is simply refused.
//
// `venues` turns it to event venues instead, for the function booking form:
// the same list (ids under roomId), read from the venue half of the board.
export default function CheckInRoomStatus({ token, rooms, venues = false }) {
  const [byId, setById] = useState(null);

  useEffect(() => {
    let ignore = false;
    apiGet(venues ? '/housekeeping/venues' : '/housekeeping/rooms', { token })
      .then((d) => {
        if (!ignore) setById(new Map((venues ? d.venues : d.rooms).map((r) => [String(r.id), r])));
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [token, venues]);

  const rows = (rooms ?? []).map((room) => ({ room, hk: byId?.get(String(room.roomId)) })).filter((r) => r.hk);
  if (rows.length === 0) return null;

  return (
    <div className="hk-board hk-ci" role="status">
      <div className="hk-ci__title">{venues ? 'Venue status' : 'Room status'}</div>
      {rows.map(({ room, hk }) => {
        // A venue with a function in it is "In use"; "Occupied" is a room's word.
        const s = venues && hk.status === 'OCCUPIED' ? { ...STATUS.OCCUPIED, label: 'In use now' } : (STATUS[hk.status] ?? STATUS.READY);
        // Only what housekeeping wrote about a repair; the label says the rest.
        const reason = hk.status === 'OUT_OF_ORDER' ? hk.outOfOrderNote : '';
        return (
          <div className="hk-ci__row" key={room.roomId}>
            <span className="hk-ci__room">{venues ? hk.roomNumber : `Room ${room.roomNumber ?? hk.roomNumber}`}</span>
            <span className={`hk-status hk-status--${s.tone}`}>{s.label}</span>
            {reason && <span className="hk-ci__note">{reason}</span>}
          </div>
        );
      })}
    </div>
  );
}
