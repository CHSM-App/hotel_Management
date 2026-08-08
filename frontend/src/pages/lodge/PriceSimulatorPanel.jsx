import { useEffect, useState } from 'react';
import { apiGet, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import './forms.css';
import './chartSections.css';

const todayIso = () => new Date().toISOString().slice(0, 10);
const BED_SIZE_LABEL = { SINGLE: 'Single', DOUBLE: 'Double', QUEEN: 'Queen', KING: 'King' };
const BATHROOM_TYPE_LABEL = { ATTACHED: 'Attached bathroom', COMMON: 'Common bathroom' };

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
  const [simDate, setSimDate] = useState(todayIso());
  const [simChargeIds, setSimChargeIds] = useState([]);
  const [simResult, setSimResult] = useState(null);
  const [simError, setSimError] = useState('');
  const [simulating, setSimulating] = useState(false);

  const selectedRoom = rooms?.find((r) => String(r.id) === simRoomId);
  const activeCharges = charges?.filter((c) => c.isActive) || [];

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
    setSimulating(true);
    try {
      const chargeIds = simChargeIds.join(',');
      const result = await apiGet(
        `/pricing/simulate?roomId=${simRoomId}&date=${simDate}${chargeIds ? `&chargeIds=${chargeIds}` : ''}`,
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
      <ChartSection title="Price simulator" hint="Line-by-line breakdown for a room and date">
        <form className="inline-add-form" onSubmit={handleSimulate}>
          {simError && <div className="form-banner form-banner--error">{simError}</div>}
          <div className="inline-add-form__row">
            <select value={simRoomId} onChange={(e) => setSimRoomId(e.target.value)}>
              <option value="">Choose a room</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.roomNumber} — {r.category.name}
                </option>
              ))}
            </select>
            <input type="date" value={simDate} onChange={(e) => setSimDate(e.target.value)} />
            <button className="btn-accent" type="submit" disabled={simulating}>
              {simulating ? 'Checking…' : 'Simulate'}
            </button>
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
                <span>{line.label}</span>
                <span>{formatPrice(line.amount)}</span>
              </div>
            ))}
            <div className="sim-result__total">
              <span>Total</span>
              <span>{formatPrice(simResult.total)}</span>
            </div>
          </div>
        )}
      </ChartSection>
    </div>
  );
}
