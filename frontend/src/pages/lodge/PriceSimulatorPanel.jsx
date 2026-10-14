import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { apiGet, ApiError, API_BASE } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { readCache, writeCache } from '../../lib/dataCache';
import { formatPrice } from './priceFormat';
import { chargesParam, selectionOf, toggleSelection, withQuantity } from './chargeSelections';
import './forms.css';
import './chartSections.css';
import PageLoader from '../../components/PageLoader';
import QtyStepper from '../../components/QtyStepper';
import QuotationDocument from './QuotationDocument';
import { downloadPdf } from './billPaper';
import { buildQuotationPdfBlob, imageAsDataUrl } from './quotationPdf';

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

// An Indian mobile number as the desk would key or paste it — "+91 98765
// 43210", "098765 43210" — brought down to its ten digits. Anything that is not
// a digit never reaches the box.
const toMobileDigits = (value) => {
  let digits = value.replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length > 10 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 10);
};
const isIndianMobile = (digits) => /^[6-9]\d{9}$/.test(digits);

const nightsLabel = (n) => `${n} night${n === 1 ? '' : 's'}`;

// One room being priced: which room, for which nights, with which extras, and
// the answer the server last gave for exactly that. Each carries its own dates
// so two rooms on different nights can be added up in one place.
let simKey = 0;
const newSim = (from, to) => ({
  key: ++simKey,
  roomId: '',
  from,
  to,
  charges: [],
  result: null,
  simulating: false,
  error: '',
});

export default function PriceSimulatorPanel() {
  const session = getSession();
  const [rooms, setRooms] = useState(() => readCache('/rooms'));
  const [charges, setCharges] = useState(() => readCache('/switchable-charges'));
  const [error, setError] = useState('');

  const [sims, setSims] = useState(() => [newSim(todayIso(), addDays(todayIso(), 1))]);
  const patchSim = (key, patch) => setSims((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  // Who the quotation is for. Both optional: a price is often asked for over
  // the counter by someone who has not given a name, and the sheet simply
  // leaves the block out.
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  // The phone's message waits until the box has been left or Download pressed:
  // "not a valid number" under every keystroke of a number being typed is noise.
  const [phoneChecked, setPhoneChecked] = useState(false);
  const phoneInvalid = guestPhone !== '' && !isIndianMobile(guestPhone);
  // The sheet being photographed, while it is. Null the rest of the time, so
  // nothing is laid out offscreen for a button nobody has pressed.
  const [quoteDoc, setQuoteDoc] = useState(null);
  const [preparingPdf, setPreparingPdf] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const quoteRef = useRef(null);

  const activeCharges = charges?.filter((c) => c.isActive) || [];
  const roomOf = (sim) => rooms?.find((r) => String(r.id) === sim.roomId);

  // The price follows the form: every change re-quotes, so the total on screen
  // is never for a room, a date or an extra the form no longer shows. Called
  // from the change handlers with the room as it is about to be, since state
  // set in the same handler has not landed yet.
  const quoteSeq = useRef({});
  const quote = async (sim) => {
    // A slow answer to an earlier question must not overwrite a newer one.
    const seq = (quoteSeq.current[sim.key] = (quoteSeq.current[sim.key] || 0) + 1);
    const current = () => quoteSeq.current[sim.key] === seq;
    if (!sim.roomId || nightsBetween(sim.from, sim.to) < 1) {
      patchSim(sim.key, { result: null, simulating: false, error: '' });
      return;
    }
    patchSim(sim.key, { simulating: true, error: '' });
    try {
      const chargeIds = chargesParam(sim.charges);
      const result = await apiGet(
        `/pricing/simulate?roomId=${sim.roomId}&date=${sim.from}&toDate=${sim.to}${chargeIds ? `&chargeIds=${chargeIds}` : ''}`,
        { token: session?.token }
      );
      if (current()) patchSim(sim.key, { result });
    } catch (err) {
      if (!current()) return;
      patchSim(sim.key, {
        result: null,
        error: err instanceof ApiError ? err.message : 'Could not work out the price.',
      });
    } finally {
      if (current()) patchSim(sim.key, { simulating: false });
    }
  };

  const changeSim = (sim, patch) => {
    patchSim(sim.key, patch);
    quote({ ...sim, ...patch });
  };

  // Moving the from date past the to date would otherwise leave the room in a
  // state that can only error — push checkout along instead.
  const changeFrom = (sim, value) => {
    const nextDay = addDays(value, 1);
    const to = nextDay && nightsBetween(value, sim.to) < 1 ? nextDay : sim.to;
    changeSim(sim, { from: value, to });
  };

  // A to date on or before the from date is never kept. The calendar will not
  // offer one (`min`), but a typed date passes through years like 0002 on its
  // way to 2026, so the correction waits until the box is left rather than
  // fighting the keystrokes.
  const settleTo = (sim) => {
    if (sim.from && nightsBetween(sim.from, sim.to) < 1) changeSim(sim, { to: addDays(sim.from, 1) });
  };

  const addSim = () => {
    const last = sims[sims.length - 1];
    setSims((list) => [...list, newSim(last.from, last.to)]);
  };

  const removeSim = (key) => {
    // Any answer still on its way for this room has nowhere to land.
    delete quoteSeq.current[key];
    setSims((list) => list.filter((s) => s.key !== key));
  };

  const downloadQuotation = async (quoteRooms, total) => {
    setPdfError('');
    // Optional, but a number on the quotation has to be one the guest can be
    // rung on.
    if (phoneInvalid) {
      setPhoneChecked(true);
      const box = document.getElementById('simGuestPhone');
      box?.focus({ preventScroll: true });
      box?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setPreparingPdf(true);
    try {
      // The letterhead is the hotel's own record, read fresh so a profile
      // edited a minute ago is what prints.
      const { lodge } = await apiGet('/me', { token: session?.token });
      const logoSrc = lodge?.logoUrl ? await imageAsDataUrl(`${API_BASE}${lodge.logoUrl}`) : null;
      const now = new Date();
      // Rendered now, not on the next tick: the capture below needs the node.
      flushSync(() =>
        setQuoteDoc({
          lodge,
          logoSrc,
          date: now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
          preparedBy: session?.name || '',
          guest: { name: guestName, phone: guestPhone && `+91 ${guestPhone.slice(0, 5)} ${guestPhone.slice(5)}` },
          rooms: quoteRooms,
          total,
        })
      );
      const blob = await buildQuotationPdfBlob(quoteRef.current);
      // Named by the day it was drawn up, in local time like the date printed on it.
      const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
      downloadPdf(blob, `quotation-${day}.pdf`);
    } catch (err) {
      setPdfError(err instanceof ApiError ? err.message : 'Could not prepare the quotation. Try again.');
    } finally {
      setQuoteDoc(null);
      setPreparingPdf(false);
    }
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

  const many = sims.length > 1;
  const chosen = sims.filter((s) => roomOf(s));
  const priced = sims.filter((s) => s.result);
  const grandTotal = priced.reduce((sum, s) => sum + Number(s.result.total), 0);
  const anySimulating = sims.some((s) => s.simulating);
  // A quotation with a room missing from it is a wrong quotation, so the file
  // waits until every chosen room has its price and none is being re-priced.
  const canDownload = priced.length > 0 && priced.length === chosen.length && !anySimulating;
  const takenByOthers = (sim) => new Set(sims.filter((s) => s.key !== sim.key && s.roomId).map((s) => s.roomId));

  return (
    <div className="price-chart price-sim">
      {/* One room: the whole block stays in view while the cards scroll. With
          several it would fill the screen, so it scrolls with the page. */}
      <div className={`dash-card chart-section price-sim__top${many ? '' : ' price-sim__top--pinned'}`}>
        <div className="chart-section__header">
          <h3>Price simulator</h3>
          <span className="chart-section__hint">Line-by-line breakdown for a room and a stay</span>
        </div>

        {sims.map((sim, index) => {
          const nights = nightsBetween(sim.from, sim.to);
          const taken = takenByOthers(sim);
          return (
            <div className={`sim-block${many ? ' sim-block--boxed' : ''}`} key={sim.key}>
              {many && (
                <div className="sim-block__head">
                  <span className="sim-block__num">{index + 1}</span>
                  <span className="sim-block__title">Room {index + 1}</span>
                  <button type="button" className="sim-block__remove" onClick={() => removeSim(sim.key)}>
                    Remove
                  </button>
                </div>
              )}
              {sim.error && <div className="form-banner form-banner--error form-banner--flash">{sim.error}</div>}
              <div className="sim-fields">
                <div className="field">
                  <label htmlFor={`simRoom-${sim.key}`}>Room</label>
                  <select
                    id={`simRoom-${sim.key}`}
                    value={sim.roomId}
                    onChange={(e) => changeSim(sim, { roomId: e.target.value })}
                  >
                    <option value="">Choose a room</option>
                    {rooms
                      .filter((r) => !taken.has(String(r.id)))
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.roomNumber} — {r.category.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`simFrom-${sim.key}`}>From (check-in)</label>
                  <input
                    id={`simFrom-${sim.key}`}
                    type="date"
                    value={sim.from}
                    onChange={(e) => changeFrom(sim, e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`simTo-${sim.key}`}>To (check-out)</label>
                  <input
                    id={`simTo-${sim.key}`}
                    type="date"
                    value={sim.to}
                    min={addDays(sim.from, 1)}
                    onChange={(e) => changeSim(sim, { to: e.target.value })}
                    onBlur={() => settleTo(sim)}
                  />
                </div>
              </div>
              {/* Checkout day itself is not charged, so the night count is spelled
                  out — a guest asking for "4 days" is a 13th-to-17th stay. */}
              <div className="sim-nights-hint">
                {nights > 0
                  ? `${nightsLabel(nights)} — checkout morning is not charged`
                  : !sim.from || !sim.to
                    ? 'Pick a from and a to date.'
                    : 'The to date must be after the from date.'}
              </div>

              {activeCharges.length > 0 && (
                <div className="field">
                  <span className="field__group-label">Extras</span>
                  <div className="checkbox-grid checkbox-grid--fit">
                    {activeCharges.map((charge) => {
                      const selection = selectionOf(sim.charges, charge.id);
                      return (
                        <label className="checkbox-chip" key={charge.id}>
                          <input
                            type="checkbox"
                            checked={Boolean(selection)}
                            onChange={() => changeSim(sim, { charges: toggleSelection(sim.charges, charge.id) })}
                          />
                          {charge.name} ({formatPrice(charge.chargePerNight)}/night)
                          {/* Same rule as the booking form: only counted extras get
                              a box, and only once ticked. */}
                          {selection && charge.isCounter && (
                            <QtyStepper
                              label={charge.name}
                              value={selection.quantity}
                              onChange={(quantity) =>
                                changeSim(sim, { charges: withQuantity(sim.charges, charge.id, quantity) })
                              }
                            />
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* After the last room's extras, so it is always the next thing below
            whatever was just filled in. */}
        <button type="button" className="price-sim__add" onClick={addSim} disabled={sims.length >= rooms.length}>
          + Add another room
        </button>
      </div>

      <div className="sim-cols">
        <div className="dash-card sim-card">
          <div className="sim-card__head">
            <span className="sim-card__title">Room details</span>
            {chosen.length > 1 && <span className="sim-card__count">{chosen.length} rooms</span>}
          </div>
          {chosen.length === 0 && <div className="sim-card__empty">Choose a room to see its details.</div>}
          {chosen.map((sim) => {
            const room = roomOf(sim);
            return (
              <div className="sim-det" key={sim.key}>
                <div className="sim-det__top">
                  <div>
                    <div className="sim-det__room">Room {room.roomNumber}</div>
                    <span className="sim-det__cat">{room.category.name}</span>
                  </div>
                  <div className="sim-det__rate">
                    <strong>{formatPrice(room.category.basePrice)}</strong>
                    per night
                  </div>
                </div>
                <div className="chart-list">
                  <div className="chart-row">
                    <span className="chart-row__name">Category</span>
                    <span className="chart-row__value">{room.category.name}</span>
                  </div>
                  {(room.bedSize || room.bathroomType) && (
                    <div className="chart-row">
                      <span className="chart-row__name">Room type</span>
                      <span className="chart-row__value">
                        {[
                          room.bedSize && `${BED_SIZE_LABEL[room.bedSize]} bed`,
                          room.bathroomType && BATHROOM_TYPE_LABEL[room.bathroomType],
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                  )}
                  {room.maxOccupancy && (
                    <div className="chart-row">
                      <span className="chart-row__name">Maximum occupancy</span>
                      <span className="chart-row__value">
                        {room.maxOccupancy} guest{room.maxOccupancy === 1 ? '' : 's'}
                      </span>
                    </div>
                  )}
                  {room.description && (
                    <div className="chart-row">
                      <span className="chart-row__name">Notes</span>
                      <span className="chart-row__value">{room.description}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="dash-card sim-card">
          <div className="sim-card__head">
            <span className="sim-card__title">Price details</span>
            {chosen.length > 1 && <span className="sim-card__count">{chosen.length} rooms</span>}
          </div>

          {chosen.length === 0 && (
            <div className="sim-card__empty">Choose a room and the price for the stay appears here.</div>
          )}

          {chosen.map((sim) => {
            const room = roomOf(sim);
            const { result } = sim;
            if (!result) {
              // Its own error is already in a banner on the room above.
              if (sim.error) return null;
              return (
                <div className="sim-card__empty" key={sim.key}>
                  {many && <strong>Room {room.roomNumber} · </strong>}
                  {sim.simulating ? 'Working out the price…' : 'Pick a from and a to date to see the price.'}
                </div>
              );
            }
            return (
              // Dimmed while a newer answer is on its way, so a total that is about
              // to change is not read off as the price.
              <div
                className={`sim-result${sim.simulating ? ' sim-result--stale' : ''}`}
                aria-busy={sim.simulating}
                key={sim.key}
              >
                {many && (
                  <div className="sim-result__room">
                    <strong>
                      Room {room.roomNumber} · {room.category.name}
                    </strong>
                    <span>
                      {formatDay(sim.from)} – {formatDay(sim.to)} · {nightsLabel(result.nightCount)}
                    </span>
                  </div>
                )}
                {result.lines.map((line, i) => (
                  <div className="sim-result__line" key={i}>
                    <span>
                      {line.label}
                      {result.nightCount > 1 && (
                        <span className="sim-result__note">
                          {' '}
                          × {nightsLabel(line.nights)}
                        </span>
                      )}
                    </span>
                    <span>{formatPrice(line.amount)}</span>
                  </div>
                ))}
                {many && (
                  <div className="sim-result__line sim-result__line--room-total">
                    <span>Room {room.roomNumber} total</span>
                    <span>{formatPrice(result.total)}</span>
                  </div>
                )}

                {result.nightCount > 1 && (
                  <div className="sim-result__nights">
                    <div className="sim-result__nights-title">Night by night</div>
                    {result.nights.map((night) => (
                      <div className="sim-result__line" key={night.date}>
                        <span>{formatDay(night.date)}</span>
                        <span>{formatPrice(night.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {priced.length > 0 && (
            <div className={`sim-grand${anySimulating ? ' sim-result--stale' : ''}`}>
              <span>
                Total · {many ? `${priced.length} room${priced.length === 1 ? '' : 's'}` : nightsLabel(priced[0].result.nightCount)}
              </span>
              <strong>{formatPrice(grandTotal)}</strong>
            </div>
          )}

          {priced.length > 0 && (
            <div className="sim-quote">
              <div className="sim-quote__title">
                Quotation for <span>optional</span>
              </div>
              <div className="sim-quote__fields">
                <div className="field">
                  <label htmlFor="simGuestName">Guest name</label>
                  <input
                    id="simGuestName"
                    type="text"
                    autoComplete="off"
                    maxLength={80}
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="simGuestPhone">Phone number</label>
                  <input
                    id="simGuestPhone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="10-digit mobile"
                    value={guestPhone}
                    aria-invalid={phoneChecked && phoneInvalid}
                    aria-describedby={phoneChecked && phoneInvalid ? 'simGuestPhoneError' : undefined}
                    onChange={(e) => setGuestPhone(toMobileDigits(e.target.value))}
                    onBlur={() => setPhoneChecked(true)}
                  />
                  {phoneChecked && phoneInvalid && (
                    <p className="field__error" id="simGuestPhoneError">
                      Enter a valid 10-digit mobile number.
                    </p>
                  )}
                </div>
              </div>
              <p className="sim-quote__hint">
                {guestName.trim() || guestPhone.trim()
                  ? 'Shown on the quotation under “Prepared for”.'
                  : 'Left empty, the quotation has no “Prepared for” block.'}
              </p>
              {pdfError && <div className="form-banner form-banner--error">{pdfError}</div>}
              <div className="sim-quote__actions">
                <button
                  type="button"
                  className="btn-accent"
                  disabled={!canDownload || preparingPdf}
                  onClick={() =>
                    downloadQuotation(
                      priced.map((s) => ({ room: roomOf(s), from: s.from, to: s.to, result: s.result })),
                      grandTotal
                    )
                  }
                >
                  {preparingPdf ? 'Preparing…' : 'Download PDF'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {quoteDoc && (
        <div className="quote-pdf-source" aria-hidden="true">
          <QuotationDocument ref={quoteRef} {...quoteDoc} />
        </div>
      )}
    </div>
  );
}
