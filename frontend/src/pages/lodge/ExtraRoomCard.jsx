import { useEffect, useState } from 'react';
import { apiGet, ApiError } from '../../lib/api';
import { formatPrice } from './priceFormat';
import { selectionOf, toggleSelection, withQuantity } from './chargeSelections';
import PageLoader from '../../components/PageLoader';

const addDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// One further room of a multi-room booking: which room, its beds if it is a
// dormitory, its extras, an optional agreed rate, and — when the booking's rooms
// don't all share dates — its own check-in and check-out. It asks the server
// which rooms are free for ITS dates, so a room can be free for its shorter stay
// even where the booking as a whole runs longer.
export default function ExtraRoomCard({
  room,
  index,
  token,
  dates,
  sameDates,
  editingBookingId,
  takenRoomIds,
  // The message the last failed save left against one of this card's controls
  // (by control id), or null — the form focuses the control, this says why.
  errorFor,
  onChange,
  onRemove,
}) {
  const [rooms, setRooms] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [beds, setBeds] = useState(null);
  const [bedsError, setBedsError] = useState('');

  // Once a room has left, nothing about it can change; one that has arrived can
  // still be extended or have its extras corrected, but not be taken off.
  const settled = room.status === 'CHECKED_OUT';
  const removable = !room.status || room.status === 'BOOKED';
  const arrived = room.status === 'CHECKED_IN';

  const validRange = dates.checkInDate && dates.checkOutDate && dates.checkOutDate > dates.checkInDate;

  useEffect(() => {
    if (!validRange) return undefined;
    let current = true;
    const path = editingBookingId
      ? `/bookings/${editingBookingId}/available-rooms?checkOutDate=${dates.checkOutDate}&checkInDate=${dates.checkInDate}`
      : `/bookings/available-rooms?checkInDate=${dates.checkInDate}&checkOutDate=${dates.checkOutDate}`;
    apiGet(path, { token })
      .then((data) => {
        if (!current) return;
        setRooms(data.rooms);
        setError('');
        const chosen = room.roomId && data.rooms.find((r) => String(r.id) === String(room.roomId));
        if (room.roomId && !chosen) {
          setNote(`That room isn’t free for ${dates.checkInDate} to ${dates.checkOutDate} — choose another.`);
          onChange({ roomId: '', bedIds: [], switchableCharges: [], meta: null });
        } else {
          setNote('');
        }
      })
      .catch((err) => {
        if (!current) return;
        setRooms([]);
        setError(err instanceof ApiError ? err.message : 'Could not load available rooms.');
      });
    return () => {
      current = false;
    };
    // The card re-asks when its dates move; the room it holds is re-checked then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates.checkInDate, dates.checkOutDate, editingBookingId]);

  const selected = rooms?.find((r) => String(r.id) === String(room.roomId));

  // The form totals capacity and names rooms from this, without holding every
  // card's room list itself.
  useEffect(() => {
    if (!selected) return;
    const meta = {
      roomNumber: selected.roomNumber,
      maxOccupancy: selected.maxOccupancy ?? null,
      isDormitory: Boolean(selected.isDormitory),
      categoryName: selected.categoryName,
    };
    if (
      !room.meta ||
      room.meta.roomNumber !== meta.roomNumber ||
      room.meta.maxOccupancy !== meta.maxOccupancy ||
      room.meta.isDormitory !== meta.isDormitory
    ) {
      onChange({ meta });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.maxOccupancy, selected?.isDormitory]);

  useEffect(() => {
    // Nothing to fetch off a dormitory room; the bed grid below is only drawn for one.
    if (!selected?.isDormitory || !validRange) return undefined;
    let current = true;
    apiGet(
      `/bookings/available-beds?roomId=${selected.id}&checkInDate=${dates.checkInDate}&checkOutDate=${dates.checkOutDate}`,
      { token }
    )
      .then((data) => {
        if (!current) return;
        setBeds(data);
        setBedsError('');
        // A bed picked against earlier dates may have gone. Not done while
        // editing, where the booking's own beds read as taken.
        if (!editingBookingId) {
          const stillFree = room.bedIds.filter((id) =>
            data.beds.some((b) => String(b.id) === String(id) && !b.isTaken)
          );
          if (stillFree.length !== room.bedIds.length) onChange({ bedIds: stillFree });
        }
      })
      .catch((err) => {
        if (!current) return;
        setBeds(null);
        setBedsError(err instanceof ApiError ? err.message : 'Could not load beds for this room.');
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.isDormitory, dates.checkInDate, dates.checkOutDate]);

  const toggleBed = (bedId) => {
    const on = room.bedIds.some((id) => String(id) === String(bedId));
    onChange({
      bedIds: on ? room.bedIds.filter((id) => String(id) !== String(bedId)) : [...room.bedIds, String(bedId)],
    });
  };

  const choices = (rooms ?? []).filter(
    (r) => String(r.id) === String(room.roomId) || !takenRoomIds.has(String(r.id))
  );

  return (
    <div className="booking-form__extra-room" data-testid={`extra-room-${index}`}>
      <div className="booking-form__extra-room-head">
        <strong>{selected || room.meta ? `Room ${selected?.roomNumber ?? room.meta.roomNumber}` : `Room ${index + 2}`}</strong>
        {room.status && <span className="booking-form__chip">{room.status.replace('_', ' ').toLowerCase()}</span>}
        <button
          type="button"
          className="booking-form__extra-room-remove"
          onClick={onRemove}
          disabled={!removable}
          title={removable ? 'Take this room off the booking' : 'Only a room that has not checked in can be removed'}
        >
          Remove
        </button>
      </div>

      {!sameDates && (
        <div className="field-row">
          <div className="field">
            <label htmlFor={`extraIn-${room.key}`}>Check-in</label>
            <input
              id={`extraIn-${room.key}`}
              type="date"
              value={room.checkInDate}
              disabled={settled || arrived}
              onChange={(e) => {
                const value = e.target.value;
                onChange({
                  checkInDate: value,
                  // Keeps the stay at least one night when the arrival moves past the departure.
                  ...(room.checkOutDate <= value ? { checkOutDate: addDays(value, 1) } : {}),
                });
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`extraOut-${room.key}`}>Check-out</label>
            <input
              id={`extraOut-${room.key}`}
              type="date"
              value={room.checkOutDate}
              min={room.checkInDate ? addDays(room.checkInDate, 1) : undefined}
              disabled={settled}
              onChange={(e) => onChange({ checkOutDate: e.target.value })}
            />
            {errorFor?.(`extraOut-${room.key}`) && (
              <p className="field__error">{errorFor(`extraOut-${room.key}`)}</p>
            )}
          </div>
        </div>
      )}

      {error && <div className="form-banner form-banner--error">{error}</div>}
      {!error && (
        <div className="field">
          {/* With shared dates the room was ticked in the list above, so there is
              nothing to choose here — the card is only for this room's details. */}
          {!sameDates && (
            <>
              <label htmlFor={`extraRoom-${room.key}`}>Room</label>
              <select
                id={`extraRoom-${room.key}`}
                value={room.roomId}
                disabled={!rooms || settled}
                onChange={(e) => {
                  setNote('');
                  onChange({ roomId: e.target.value, bedIds: [], switchableCharges: [], meta: null });
                }}
              >
                <option value="">{rooms ? 'Choose a room' : 'Loading…'}</option>
                {choices.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.roomNumber} — {r.categoryName}
                    {r.floor ? ` · Floor ${r.floor}` : ''}
                  </option>
                ))}
              </select>
            </>
          )}
          {note ? (
            <p className="field__error">{note}</p>
          ) : (
            errorFor?.(`extraRoom-${room.key}`) && (
              <p className="field__error">{errorFor(`extraRoom-${room.key}`)}</p>
            )
          )}
          {rooms && choices.length === 0 && !room.roomId && !sameDates && (
            <p className="bookings-panel__hint">No more rooms are free for these dates.</p>
          )}
        </div>
      )}

      {selected && (
        <div className="booking-form__chips">
          <span className="booking-form__chip booking-form__chip--rate">
            {formatPrice(selected.categoryBasePrice)}/night
          </span>
          <span className="booking-form__chip">{selected.categoryName}</span>
          {selected.maxOccupancy && <span className="booking-form__chip">Sleeps {selected.maxOccupancy}</span>}
        </div>
      )}

      {selected?.isDormitory && (
        <div className="field">
          <label>Bed{room.bedIds.length > 1 ? 's' : ''}</label>
          {bedsError && <div className="form-banner form-banner--error">{bedsError}</div>}
          {!beds && !bedsError && <PageLoader inline label="Loading beds" />}
          {beds && (
            <div className="booking-form__bed-grid">
              {beds.beds.map((bed) => {
                const on = room.bedIds.some((id) => String(id) === String(bed.id));
                const disabled = (bed.isTaken && !on) || settled;
                return (
                  <button
                    type="button"
                    key={bed.id}
                    className={`booking-form__bed-option${on ? ' booking-form__bed-option--selected' : ''}${
                      disabled ? ' booking-form__bed-option--disabled' : ''
                    }`}
                    disabled={disabled}
                    aria-pressed={on}
                    onClick={() => toggleBed(bed.id)}
                  >
                    <span className="booking-form__bed-label">{bed.bedLabel}</span>
                    <span className="booking-form__bed-state">{bed.isTaken && !on ? 'Taken' : 'Free'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selected && !selected.isDormitory && selected.switchableCharges.length > 0 && (
        <div className="field">
          <label>Extras</label>
          <div className="checkbox-grid">
            {selected.switchableCharges.map((charge) => {
              const selection = selectionOf(room.switchableCharges, charge.id);
              return (
                <label className="checkbox-chip" key={charge.id}>
                  <input
                    type="checkbox"
                    checked={Boolean(selection)}
                    onChange={() => onChange({ switchableCharges: toggleSelection(room.switchableCharges, charge.id) })}
                  />
                  {charge.name} ({formatPrice(charge.chargePerNight)}/night)
                  {selection && charge.isCounter && (
                    <input
                      className="checkbox-chip__qty"
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      aria-label={`How many ${charge.name}`}
                      value={selection.quantity}
                      onChange={(e) =>
                        onChange({ switchableCharges: withQuantity(room.switchableCharges, charge.id, e.target.value) })
                      }
                    />
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {selected && !selected.isDormitory && (
        <div className="field">
          <label htmlFor={`extraRate-${room.key}`}>Agreed rate per night (optional)</label>
          <input
            id={`extraRate-${room.key}`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder={`${formatPrice(selected.categoryBasePrice)} (category rate)`}
            value={room.basePriceOverride}
            onChange={(e) => onChange({ basePriceOverride: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
