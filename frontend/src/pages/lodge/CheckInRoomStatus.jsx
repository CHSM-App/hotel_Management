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
export default function CheckInRoomStatus({ token, rooms }) {
  const [byId, setById] = useState(null);

  useEffect(() => {
    let ignore = false;
    apiGet('/housekeeping/rooms', { token })
      .then((d) => {
        if (!ignore) setById(new Map(d.rooms.map((r) => [String(r.id), r])));
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [token]);

  const rows = (rooms ?? []).map((room) => ({ room, hk: byId?.get(String(room.roomId)) })).filter((r) => r.hk);
  if (rows.length === 0) return null;

  return (
    <div className="hk-board hk-ci" role="status">
      <div className="hk-ci__title">Room status</div>
      {rows.map(({ room, hk }) => {
        const s = STATUS[hk.status] ?? STATUS.READY;
        // Only what housekeeping wrote about a repair; the label says the rest.
        const reason = hk.status === 'OUT_OF_ORDER' ? hk.outOfOrderNote : '';
        return (
          <div className="hk-ci__row" key={room.roomId}>
            <span className="hk-ci__room">Room {room.roomNumber ?? hk.roomNumber}</span>
            <span className={`hk-status hk-status--${s.tone}`}>{s.label}</span>
            {reason && <span className="hk-ci__note">{reason}</span>}
          </div>
        );
      })}
    </div>
  );
}
