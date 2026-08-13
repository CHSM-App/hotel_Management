import { useEffect, useState } from 'react';
import { apiGet, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import './forms.css';
import './chartSections.css';

const todayIso = () => new Date().toISOString().slice(0, 10);
const BED_SIZE_LABEL = { SINGLE: 'Single', DOUBLE: 'Double', QUEEN: 'Queen', KING: 'King' };
const BATHROOM_TYPE_LABEL = { ATTACHED: 'Attached bathroom', COMMON: 'Common bathroom' };

// Clearing a date input hands back '', so every date helper has to survive
// being called with one.
const addDays = (iso, days) => {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// The to date is the checkout day, so it is not itself charged — 13th to
// 17th is four nights. Same rule the booking form prices on.
const nightsBetween = (from, to) => {
  if (!from || !to) return 0;
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  if (Number.isNaN(ms)) return 0;
  return Math.round(ms / 86400000);
};

const formatDay = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

function ChartSection({ title, hint, children }) {
  return (
    <div className="dash-card chart-section">
      <div className="chart-section__header">
        <h3>{title}</h3>
        {hint && <span className="chart-section__hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export default function PriceSimulatorPanel() {
  const session = getSession();
  const [rooms, setRooms] = useState(null);
  const [charges, setCharges] = useState(null);
  const [error, setError] = useState('');

  const [simRoomId, setSimRoomId] = useState('');
  const [simFromDate, setSimFromDate] = useState(todayIso());
  const [simToDate, setSimToDate] = useState(addDays(todayIso(), 1));
  const [simChargeIds, setSimChargeIds] = useState([]);
  const [simResult, setSimResult] = useState(null);
  const [simError, setSimError] = useState('');
  const [simulating, setSimulating] = useState(false);

  const selectedRoom = rooms?.find((r) => String(r.id) === simRoomId);
  const activeCharges = charges?.filter((c) => c.isActive) || [];
  const nights = nightsBetween(simFromDate, simToDate);

  // Moving the from date past the to date would otherwise leave the form in a
  // state that can only error — push checkout along instead.
  const handleFromDateChange = (value) => {
    setSimFromDate(value);
    const nextDay = addDays(value, 1);
    if (nextDay && nightsBetween(value, simToDate) < 1) {
      setSimToDate(nextDay);
    }
  };

  const toggleSimCharge = (chargeId) => {
    setSimChargeIds((ids) => (ids.includes(chargeId) ? ids.filter((id) => id !== chargeId) : [...ids, chargeId]));
  };

  useEffect(() => {
    Promise.all([
      apiGet('/rooms', { token: session?.token }),
      apiGet('/switchable-charges', { token: session?.token }),
    ])
      .then(([roomsData, chargesData]) => {
        setRooms(roomsData.rooms);
        setCharges(chargesData.switchableCharges);
        setError('');
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load rooms.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSimulate = async (e) => {
    e.preventDefault();
    setSimError('');
    setSimResult(null);
    if (!simRoomId) {
      setSimError('Choose a room.');
      return;
    }
    if (!simFromDate || !simToDate) {
      setSimError('Pick a from and a to date.');
      return;
    }
    if (nights < 1) {
      setSimError('The to date must be after the from date.');
      return;
    }
    setSimulating(true);
    try {
      const chargeIds = simChargeIds.join(',');
      const result = await apiGet(
        `/pricing/simulate?roomId=${simRoomId}&date=${simFromDate}&toDate=${simToDate}${chargeIds ? `&chargeIds=${chargeIds}` : ''}`,
        { token: session?.token }
      );
      setSimResult(result);
    } catch (err) {
      setSimError(err instanceof ApiError ? err.message : 'Could not run the simulator.');
    } finally {
      setSimulating(false);
    }
  };

  if (error) {
    return (
      <div className="dash-card">
        <div className="dash-state">{error}</div>
      </div>
    );
  }

  if (!rooms || !charges) {
    return (
      <div className="dash-card">
        <div className="dash-state">Loading rooms…</div>
      </div>
    );
  }

  return (
    <div className="price-chart">
      <ChartSection title="Price simulator" hint="Line-by-line breakdown for a room and a stay">
        <form className="inline-add-form" onSubmit={handleSimulate}>
          {simError && <div className="form-banner form-banner--error">{simError}</div>}
          <div className="sim-fields">
            <div className="field">
              <label htmlFor="simRoom">Room</label>
              <select id="simRoom" value={simRoomId} onChange={(e) => setSimRoomId(e.target.value)}>
                <option value="">Choose a room</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.roomNumber} — {r.category.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="simFrom">From (check-in)</label>
              <input
                id="simFrom"
                type="date"
                value={simFromDate}
                onChange={(e) => handleFromDateChange(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="simTo">To (check-out)</label>
              <input
                id="simTo"
                type="date"
                value={simToDate}
                min={addDays(simFromDate, 1)}
                onChange={(e) => setSimToDate(e.target.value)}
              />
            </div>
            <div className="field sim-fields__action">
              <button className="btn-accent" type="submit" disabled={simulating}>
                {simulating ? 'Checking…' : 'Simulate'}
              </button>
            </div>
          </div>
          {/* Checkout day itself is not charged, so the night count is spelled
              out — a guest asking for "4 days" is a 13th-to-17th stay. */}
          <div className="sim-nights-hint">
            {nights > 0
              ? `${nights} night${nights === 1 ? '' : 's'} — checkout morning is not charged`
              : !simFromDate || !simToDate
                ? 'Pick a from and a to date.'
                : 'The to date must be after the from date.'}
          </div>

          {selectedRoom && (
            <div className="chart-list">
              <div className="chart-row">
                <span className="chart-row__name">Category</span>
                <span className="chart-row__value">
                  {selectedRoom.category.name} · {formatPrice(selectedRoom.category.basePrice)}/night
                </span>
              </div>
              {(selectedRoom.bedSize || selectedRoom.bathroomType) && (
                <div className="chart-row">
                  <span className="chart-row__name">Room</span>
                  <span className="chart-row__value">
                    {[
                      selectedRoom.bedSize && `${BED_SIZE_LABEL[selectedRoom.bedSize]} bed`,
                      selectedRoom.bathroomType && BATHROOM_TYPE_LABEL[selectedRoom.bathroomType],
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
              )}
              {selectedRoom.maxOccupancy && (
                <div className="chart-row">
                  <span className="chart-row__name">Max occupancy</span>
                  <span className="chart-row__value">
                    {selectedRoom.maxOccupancy} guest{selectedRoom.maxOccupancy === 1 ? '' : 's'}
                  </span>
                </div>
              )}
              {selectedRoom.description && (
                <div className="chart-row">
                  <span className="chart-row__name">Notes</span>
                  <span className="chart-row__value">{selectedRoom.description}</span>
                </div>
              )}
            </div>
          )}

          {activeCharges.length > 0 && (
            <div className="field">
              <label>Extras</label>
              <div className="checkbox-grid">
                {activeCharges.map((charge) => (
                  <label className="checkbox-chip" key={charge.id}>
                    <input
                      type="checkbox"
                      checked={simChargeIds.includes(charge.id)}
                      onChange={() => toggleSimCharge(charge.id)}
                    />
                    {charge.name} ({formatPrice(charge.chargePerNight)}/night)
                  </label>
                ))}
              </div>
            </div>
          )}
        </form>

        {simResult && (
          <div className="sim-result">
            {simResult.lines.map((line, i) => (
              <div className="sim-result__line" key={i}>
                <span>
                  {line.label}
                  {simResult.nightCount > 1 && (
                    <span className="sim-result__note">
                      {' '}
                      × {line.nights} night{line.nights === 1 ? '' : 's'}
                    </span>
                  )}
                </span>
                <span>{formatPrice(line.amount)}</span>
              </div>
            ))}
            <div className="sim-result__total">
              <span>
                Total · {simResult.nightCount} night{simResult.nightCount === 1 ? '' : 's'}
              </span>
              <span>{formatPrice(simResult.total)}</span>
            </div>

            {simResult.nightCount > 1 && (
              <div className="sim-result__nights">
                <div className="sim-result__nights-title">Night by night</div>
                {simResult.nights.map((night) => (
                  <div className="sim-result__line" key={night.date}>
                    <span>{formatDay(night.date)}</span>
                    <span>{formatPrice(night.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </ChartSection>
    </div>
  );
}
