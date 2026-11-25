import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../lib/api';
import { barToken, errText } from './barFormat';
import './Bar.css';

// Post bar orders to a checked-in guest's room bill. The stay invoice then carries them as a
// Bar line, so there is no separate bar bill or payment for these orders.
// fixedRoom ({ roomId, bookingId, roomNumber }): an order already placed for a room goes straight
// to that room, with no picker.
// primary: the big full-width button used on the Ready to bill panel, labelled with the room.
export default function BarAddToRoom({ orderIds, onDone, onCancel, fixedRoom = null, primary = false }) {
  const token = barToken();
  const [guests, setGuests] = useState(null);
  const [pick, setPick] = useState('');
  const [discount, setDiscount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (fixedRoom) return undefined;
    let live = true;
    apiGet('/bar/targets', { token })
      .then((t) => live && setGuests(t.guests || []))
      .catch((e) => live && setError(errText(e, 'Could not load the checked-in rooms.')));
    return () => {
      live = false;
    };
  }, [token, fixedRoom]);

  const submit = async () => {
    const g = fixedRoom || guests.find((x) => String(x.roomId) === pick);
    if (!g) return setError('Choose a room.');
    setBusy(true);
    setError('');
    try {
      // The discount is for the whole lot; it rides on the first order (the server caps it).
      for (const [i, id] of orderIds.entries()) {
        await apiPost(
          `/bar/orders/${id}/add-to-room`,
          { bookingId: g.bookingId, roomId: g.roomId, ...(i === 0 && Number(discount) > 0 ? { discountAmount: Number(discount) } : {}) },
          { token }
        );
      }
      onDone(`Added to Room ${g.roomNumber}${g.guestName ? ` · ${g.guestName}` : ''}.`);
    } catch (e) {
      setError(errText(e, 'Could not add to the room bill.'));
      setBusy(false);
    }
  };

  const chosen = fixedRoom || guests?.find((x) => String(x.roomId) === pick);

  if (primary) {
    return (
      <div className="bar-room">
        {!fixedRoom && (
          <label className="bar-field">
            <span>Room</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={!guests}>
              <option value="">{guests ? (guests.length ? 'Choose room…' : 'No guests checked in') : 'Loading…'}</option>
              {(guests || []).map((g) => (
                <option key={g.roomId} value={g.roomId}>{g.roomNumber} · {g.guestName}</option>
              ))}
            </select>
          </label>
        )}
        <label className="bar-field">
          <span>Discount (optional)</span>
          <input type="number" min="0" step="1" inputMode="decimal" placeholder="₹ 0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </label>
        {error && <div role="alert" style={{ color: '#b3261e', fontSize: 13 }}>{error}</div>}
        <button type="button" className="bar-btn bar-btn--primary bar-btn--block" disabled={!chosen || busy} onClick={submit}>
          {busy ? 'Adding…' : chosen ? `Add to Room ${chosen.roomNumber} bill` : 'Choose a room'}
        </button>
        <button type="button" className="bar-link" onClick={onCancel}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="bar-room">
      {fixedRoom ? (
        <div className="bar-field"><span>Add to Room {fixedRoom.roomNumber} bill</span></div>
      ) : (
        <label className="bar-field">
          <span>Add to room bill</span>
          <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={!guests}>
            <option value="">{guests ? (guests.length ? 'Choose room…' : 'No guests checked in') : 'Loading…'}</option>
            {(guests || []).map((g) => (
              <option key={g.roomId} value={g.roomId}>{g.roomNumber} · {g.guestName}</option>
            ))}
          </select>
        </label>
      )}
      <label className="bar-field">
        <span>Discount (optional)</span>
        <input type="number" min="0" step="1" inputMode="decimal" placeholder="₹ 0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
      </label>
      {error && <div className="bar-error" role="alert" style={{ color: '#b3261e', fontSize: 13 }}>{error}</div>}
      <div className="bar-flex">
        <button type="button" className="bar-btn bar-btn--sm bar-btn--brand" disabled={(!fixedRoom && !pick) || busy} onClick={submit}>{busy ? 'Adding…' : 'Add'}</button>
        <button type="button" className="bar-btn bar-btn--sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
