import { useEffect, useState } from 'react';
import { apiGet, apiPost, ApiError } from '../../lib/api';
import { getSession } from '../../lib/auth';
import { formatPrice } from './priceFormat';
import GuestFields from './QuoteGuestFields';
import { QuoteSection, QuoteColumns, QuoteActions } from './QuoteBits';
import { useQuotationSend } from './useQuotationSend';
import { isIndianMobile } from './quotationKinds';

const toIso = (date, time, nextDay = false) => {
  const d = new Date(`${date}T${time}:00`);
  if (nextDay) d.setDate(d.getDate() + 1);
  return d.toISOString();
};

/**
 * New EVENT quotation: venue, when, guests, catering and add-ons, with the
 * server's live price beside it (the same /events/quote the function form
 * uses). Save sends only the choices; the server prices them again.
 */
export default function EventQuotePanel({ onSaved }) {
  const token = getSession()?.token;
  const { send, host } = useQuotationSend();
  const [venues, setVenues] = useState([]);
  const [addons, setAddons] = useState([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [venueId, setVenueId] = useState('');
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('18:00');
  const [to, setTo] = useState('23:00');
  const [pax, setPax] = useState('');
  const [plate, setPlate] = useState('');
  const [venueCharge, setVenueCharge] = useState('');
  const [discount, setDiscount] = useState('');
  const [note, setNote] = useState('');
  const [addonIds, setAddonIds] = useState([]);
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [today] = useState(() => new Date().toLocaleDateString('en-CA'));

  useEffect(() => {
    Promise.all([apiGet('/events/venues', { token }), apiGet('/events/addons', { token })])
      .then(([v, a]) => {
        setVenues(v.venues || []);
        setAddons(a.addons || []);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load venues.'));
  }, [token]);

  // An end at or before the start means the function runs past midnight.
  const body =
    venueId && date && Number(pax) > 0
      ? {
          venueId: Number(venueId),
          expectedPax: Number(pax),
          guaranteedPax: Number(pax),
          startAt: toIso(date, from),
          endAt: toIso(date, to, to <= from),
          ...(plate !== '' ? { perPlateRate: Number(plate) } : {}),
          ...(venueCharge !== '' ? { venueCharge: Number(venueCharge) } : {}),
          ...(discount !== '' ? { discountAmount: Number(discount) } : {}),
          addons: addonIds.map((id) => ({ addonId: id, quantity: 1 })),
        }
      : null;
  const key = body ? JSON.stringify(body) : '';

  useEffect(() => {
    if (!body) return undefined;
    const t = setTimeout(() => {
      apiPost('/events/quote', body, { token })
        .then((data) => {
          setQuote(data);
          setError('');
        })
        .catch((err) => setError(err.message));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, token]);

  const phoneBad = phone !== '' && !isIndianMobile(phone);
  const save = async (andSend) => {
    if (phoneBad || !body) return;
    setSaving(true);
    setError('');
    try {
      const saved = await apiPost(
        '/quotations',
        {
          kind: 'EVENT',
          guestName: name.trim() || undefined,
          guestPhone: phone || undefined,
          event: body,
          note: note.trim() || undefined,
        },
        { token }
      );
      // Send before leaving this form: the list that follows would unmount it.
      if (andSend) window.alert(await send(saved));
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the quotation.');
    } finally {
      setSaving(false);
    }
  };

  // A quote for choices that have since been cleared is not shown.
  const shown = body ? quote : null;
  const p = shown?.pricing;

  const main = (
    <>
      <QuoteSection title="Function" hint="Where and when it is held.">
        <div className="sim-fields">
          <div className="field">
            <label htmlFor="eq-venue">Venue</label>
            <select id="eq-venue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
              <option value="">Choose a venue</option>
              {venues
                .filter((v) => v.isActive)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.capacityPax ? ` · seats ${v.capacityPax}` : ''}
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="eq-date">Date</label>
            <input id="eq-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="eq-from">Starts</label>
            <input id="eq-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="eq-to">Ends</label>
            <input id="eq-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {to <= from && <small className="field__hint">Ends the next day, after midnight.</small>}
      </QuoteSection>

      <QuoteSection title="Guests & pricing" hint="Leave the venue charge empty to use the venue’s own rate.">
        <div className="sim-fields">
          <div className="field">
            <label htmlFor="eq-pax">Guests</label>
            <input id="eq-pax" type="number" min="1" value={pax} onChange={(e) => setPax(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="eq-plate">Catering per plate (₹)</label>
            <input id="eq-plate" type="number" min="0" placeholder="Optional" value={plate} onChange={(e) => setPlate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="eq-charge">Venue charge (₹)</label>
            <input id="eq-charge" type="number" min="0" placeholder="Optional" value={venueCharge} onChange={(e) => setVenueCharge(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="eq-disc">Concession (₹)</label>
            <input id="eq-disc" type="number" min="0" placeholder="Optional" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
        </div>
      </QuoteSection>

      {addons.some((a) => a.isActive) && (
        <QuoteSection title="Add-ons" hint="Tick to include.">
          <div className="checkbox-grid checkbox-grid--fit">
            {addons
              .filter((a) => a.isActive)
              .map((a) => (
                <label className="checkbox-chip" key={a.id}>
                  <input
                    type="checkbox"
                    checked={addonIds.includes(a.id)}
                    onChange={(e) =>
                      setAddonIds((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id)))
                    }
                  />
                  <span>
                    {a.name} · {formatPrice(a.defaultAmount)}
                  </span>
                </label>
              ))}
          </div>
        </QuoteSection>
      )}

      <QuoteSection title="Note" hint="Printed on the quotation.">
        <div className="field">
          <input
            aria-label="Note on the quotation"
            placeholder="e.g. Advance of 25% to confirm the date"
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </QuoteSection>
    </>
  );

  const side = (
    <>
      <QuoteSection title="Customer" hint="Shown under “Prepared for”. Both are optional.">
        <GuestFields name={name} setName={setName} phone={phone} setPhone={setPhone} />
      </QuoteSection>

      <QuoteSection title="Price">
        {shown?.overCapacity && <div className="form-banner form-banner--error">{shown.overCapacity}</div>}
        {!p && <div className="dash-state">Choose a venue, a date and the number of guests to see the price.</div>}
        {p && (
          <>
            {p.lines.map((l, i) => (
              <div className="sim-result__line" key={i}>
                <span>
                  {l.label}
                  {l.note ? ` · ${l.note}` : ''}
                </span>
                <span>{formatPrice(l.amount)}</span>
              </div>
            ))}
            {p.discountAmount > 0 && (
              <div className="sim-result__line">
                <span>Concession</span>
                <span>− {formatPrice(p.discountAmount)}</span>
              </div>
            )}
            <div className="quote-total">
              <span>Total</span>
              <strong>{formatPrice(p.totalAmount)}</strong>
            </div>
          </>
        )}
      </QuoteSection>

      {error && <div className="form-banner form-banner--error">{error}</div>}
      <QuoteActions
        saving={saving}
        disabled={!p || phoneBad || Boolean(shown?.overCapacity)}
        onSave={() => save(false)}
        onSaveAndSend={() => save(true)}
      />
    </>
  );

  return (
    <>
      <QuoteColumns main={main} side={side} />
      {host}
    </>
  );
}
