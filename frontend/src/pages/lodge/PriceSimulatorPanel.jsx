import { useEffect, useRef, useState } from 'react';
import { apiGet, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { formatPrice } from './priceFormat';
import { chargesParam, selectionOf, toggleSelection, withQuantity } from './chargeSelections';
import './forms.css';
import './chartSections.css';
import PageLoader from '../../components/PageLoader';
import QtyStepper from '../../components/QtyStepper';

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
  const [rooms, setRooms] = useState(() => readCache('/rooms'));
  const [charges, setCharges] = useState(() => readCache('/switchable-charges'));
  const [error, setError] = useState('');

  const [simRoomId, setSimRoomId] = useState('');
  const [simFromDate, setSimFromDate] = useState(todayIso());
  const [simToDate, setSimToDate] = useState(addDays(todayIso(), 1));
  const [simCharges, setSimCharges] = useState([]);
  const [simResult, setSimResult] = useState(null);
  const [simError, setSimError] = useState('');
  const [simFieldError, setSimFieldError] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const simErrorRef = useRef(null);
  const reportSimError = (message) => {
    setSimError(message);
    setSimFieldError(null);
    requestAnimationFrame(() => {
      simErrorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };
  // Field-only: the message goes under the box that caused it, and must not
  // also land in the banner above — that rendered the same line twice.
  const failSim = (id, message) => {
    setSimFieldError({ id, message });
    const el = document.getElementById(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const simFieldErr = (id) =>
    id && simFieldError?.id === id ? <p className="field__error">{simFieldError.message}</p> : null;
  const simInvalid = (id) => Boolean(id) && simFieldError?.id === id;

  const selectedRoom = rooms?.find((r) => String(r.id) === simRoomId);
  const activeCharges = charges?.filter((c) => c.isActive) || [];
  const nights = nightsBetween(simFromDate, simToDate);

  // The price follows the form: every change re-quotes, so the total on screen
  // is never for a room, a date or an extra the form no longer shows. Called
  // from the change handlers with the values as they are about to be, since
  // state set in the same handler has not landed yet.
  const quoteSeq = useRef(0);
  const runQuote = async ({ roomId = simRoomId, from = simFromDate, to = simToDate, selections = simCharges }) => {
    // A slow answer to an earlier question must not overwrite a newer one.
    const seq = ++quoteSeq.current;
    setSimError('');
    if (!roomId || nightsBetween(from, to) < 1) {
      setSimResult(null);
      setSimulating(false);
      return;
    }
    setSimulating(true);
    try {
      const chargeIds = chargesParam(selections);
      const result = await apiGet(
        `/pricing/simulate?roomId=${roomId}&date=${from}&toDate=${to}${chargeIds ? `&chargeIds=${chargeIds}` : ''}`,
        { token: session?.token }
      );
      if (seq === quoteSeq.current) setSimResult(result);
    } catch (err) {
      if (seq !== quoteSeq.current) return;
      setSimResult(null);
      reportSimError(err instanceof ApiError ? err.message : 'Could not work out the price.');
    } finally {
      if (seq === quoteSeq.current) setSimulating(false);
    }
  };

  const handleRoomChange = (value) => {
    setSimRoomId(value);
    setSimFieldError(null);
    runQuote({ roomId: value });
  };

  // Moving the from date past the to date would otherwise leave the form in a
  // state that can only error — push checkout along instead.
  const handleFromDateChange = (value) => {
    setSimFromDate(value);
    setSimFieldError(null);
    const nextDay = addDays(value, 1);
    const to = nextDay && nightsBetween(value, simToDate) < 1 ? nextDay : simToDate;
    if (to !== simToDate) setSimToDate(to);
    runQuote({ from: value, to });
  };

  const handleToDateChange = (value) => {
    setSimToDate(value);
    setSimFieldError(null);
    runQuote({ to: value });
  };

  const toggleSimCharge = (chargeId) => {
    const selections = toggleSelection(simCharges, chargeId);
    setSimCharges(selections);
    runQuote({ selections });
  };

  const setSimChargeQuantity = (chargeId, quantity) => {
    const selections = withQuantity(simCharges, chargeId, quantity);
    setSimCharges(selections);
    runQuote({ selections });
  };

  useEffect(() => {
    Promise.all([
      apiGet('/rooms', { token: session?.token }),
      apiGet('/switchable-charges', { token: session?.token }),
    ])
      .then(([roomsData, chargesData]) => {
        setRooms(writeCache('/rooms', roomsData.rooms));
        setCharges(writeCache('/switchable-charges', chargesData.switchableCharges));
        setError('');
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load rooms.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The button is only needed to be told what is missing — a complete form
  // has already been priced by the time anyone reaches it.
  const handleSimulate = (e) => {
    e.preventDefault();
    setSimFieldError(null);
    if (!simRoomId) {
      failSim('simRoom', 'Choose a room.');
      return;
    }
    if (!simFromDate) {
      failSim('simFrom', 'Pick a from date.');
      return;
    }
    if (!simToDate) {
      failSim('simTo', 'Pick a to date.');
      return;
    }
    if (nights < 1) {
      failSim('simTo', 'The to date must be after the from date.');
      return;
    }
    runQuote({});
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
        <PageLoader inline label="Loading rooms" />
      </div>
    );
  }

  return (
    <div className="price-chart">
      <ChartSection title="Price simulator" hint="Line-by-line breakdown for a room and a stay">
        <form className="inline-add-form" onSubmit={handleSimulate}>
          {simError && (
            <div ref={simErrorRef} className="form-banner form-banner--error form-banner--flash">
              {simError}
            </div>
          )}
          <div className="sim-fields">
            <div className="field">
              <label htmlFor="simRoom">Room</label>
              <select
                id="simRoom"
                aria-invalid={simInvalid('simRoom')}
                value={simRoomId}
                onChange={(e) => handleRoomChange(e.target.value)}
              >
                <option value="">Choose a room</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.roomNumber} — {r.category.name}
                  </option>
                ))}
              </select>
              {simFieldErr('simRoom')}
            </div>
            <div className="field">
              <label htmlFor="simFrom">From (check-in)</label>
              <input
                id="simFrom"
                type="date"
                aria-invalid={simInvalid('simFrom')}
                value={simFromDate}
                onChange={(e) => handleFromDateChange(e.target.value)}
              />
              {simFieldErr('simFrom')}
            </div>
            <div className="field">
              <label htmlFor="simTo">To (check-out)</label>
              <input
                id="simTo"
                type="date"
                aria-invalid={simInvalid('simTo')}
                value={simToDate}
                min={addDays(simFromDate, 1)}
                onChange={(e) => handleToDateChange(e.target.value)}
              />
              {simFieldErr('simTo')}
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

          {activeCharges.length > 0 && (
            <div className="field">
              <label>Extras</label>
              <div className="checkbox-grid checkbox-grid--fit">
                {activeCharges.map((charge) => {
                  const selection = selectionOf(simCharges, charge.id);
                  return (
                    <label className="checkbox-chip" key={charge.id}>
                      <input
                        type="checkbox"
                        checked={Boolean(selection)}
                        onChange={() => toggleSimCharge(charge.id)}
                      />
                      {charge.name} ({formatPrice(charge.chargePerNight)}/night)
                      {/* Same rule as the booking form: only counted extras get
                          a box, and only once ticked. */}
                      {selection && charge.isCounter && (
                        <QtyStepper
                          label={charge.name}
                          value={selection.quantity}
                          onChange={(quantity) => setSimChargeQuantity(charge.id, quantity)}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

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

          <div className="sim-actions">
            <button className="btn-accent" type="submit">
              Show price
            </button>
          </div>
        </form>

        {!simResult && !simRoomId && (
          <div className="sim-empty">Choose a room and the price for the stay appears here.</div>
        )}

        {simResult && (
          // Dimmed while a newer answer is on its way, so a total that is about
          // to change is not read off as the price.
          <div className={`sim-result${simulating ? ' sim-result--stale' : ''}`} aria-busy={simulating}>
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
