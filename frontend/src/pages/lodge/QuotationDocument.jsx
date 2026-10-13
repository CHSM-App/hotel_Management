import { forwardRef } from 'react';
import { formatPrice } from './priceFormat';
import { rupeesInWords } from './quotationPdf';
import './QuotationDocument.css';

const BED_SIZE_LABEL = { SINGLE: 'Single', DOUBLE: 'Double', QUEEN: 'Queen', KING: 'King' };
const BATHROOM_TYPE_LABEL = { ATTACHED: 'Attached bathroom', COMMON: 'Common bathroom' };

const formatDate = (iso, withYear = true) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });

const nightsLabel = (n) => `${n} night${n === 1 ? '' : 's'}`;

// Two letters for a property with no logo: the name's own initials, past the
// word every one of them starts with.
function monogram(name = '') {
  const words = name.split(/\s+/).filter(Boolean);
  const telling = words.filter((w) => !/^(hotel|lodge|the)$/i.test(w));
  return (telling.length ? telling : words)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

// The simulator names a line with its rate — "Standard ₹1,200". Here the rate
// has a column of its own, so a trailing price is taken off the name. A counted
// extra ("Blanket 2 × ₹50") keeps its sum: that is the quantity, not the rate.
const lineName = (label) => (/×/.test(label) ? label : label.replace(/\s*₹\s?[\d,]+(\.\d+)?$/, ''));

// The quotation the Price simulator downloads: an A4 letter, laid out at a
// fixed width and only ever rendered offscreen to be photographed.
//
// `rooms` is one entry per priced room: { room, from, to, result }, with
// `result` as /pricing/simulate returned it.
const QuotationDocument = forwardRef(function QuotationDocument(
  { lodge, logoSrc, date, preparedBy, guest, rooms, total },
  ref
) {
  const name = lodge?.name || 'Quotation';
  const address = [lodge?.address, lodge?.city, lodge?.state].filter(Boolean).join(', ');
  const contact = [
    lodge?.phone && `Phone ${lodge.phone}`,
    lodge?.isGstRegistered && lodge?.gstin && `GSTIN ${lodge.gstin}`,
  ].filter(Boolean);

  const guestName = guest?.name?.trim();
  const guestPhone = guest?.phone?.trim();
  const hasGuest = Boolean(guestName || guestPhone);

  const totalNights = rooms.reduce((sum, r) => sum + r.result.nightCount, 0);
  const arrival = rooms.map((r) => r.from).sort()[0];
  const departure = rooms.map((r) => r.to).sort().at(-1);

  return (
    <div className="quote" ref={ref}>
      <div className="quote__edge" />

      <div className="quote__head quote__pad" data-quote-break>
        <div className="quote__brand">
          <div className="quote__logo">
            {logoSrc ? <img src={logoSrc} alt="" /> : <span>{monogram(name)}</span>}
          </div>
          <div>
            <div className="quote__name">{name}</div>
            {(address || contact.length > 0) && (
              <div className="quote__line">
                {address}
                {address && contact.length > 0 && <br />}
                {contact.join(' · ')}
              </div>
            )}
          </div>
        </div>
        <div className="quote__doc">
          <div className="quote__title">Quotation</div>
          <dl>
            <dt>Date</dt>
            <dd>{date}</dd>
            {preparedBy && (
              <>
                <dt>Prepared by</dt>
                <dd>{preparedBy}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      <div className="quote__rule" />

      {/* "Prepared for" is on the page only when the desk typed something into
          it, and then only the line that was typed. */}
      <div className={`quote__meet quote__pad${hasGuest ? '' : ' quote__meet--solo'}`} data-quote-break>
        {hasGuest && (
          <div>
            <div className="quote__cap">Prepared for</div>
            {guestName && (
              <div className="quote__for">
                <span>Name</span>
                <b>{guestName}</b>
              </div>
            )}
            {guestPhone && (
              <div className="quote__for">
                <span>Phone no.</span>
                <b>{guestPhone}</b>
              </div>
            )}
          </div>
        )}
        <div>
          <div className="quote__cap">Stay at a glance</div>
          <div className="quote__glance">
            <div>
              <span>Rooms</span>
              <b>{rooms.length}</b>
            </div>
            <div>
              <span>Nights</span>
              <b>{totalNights}</b>
            </div>
            <div>
              <span>Arrival</span>
              <b>{formatDate(arrival, false)}</b>
            </div>
            <div>
              <span>Departure</span>
              <b>{formatDate(departure, false)}</b>
            </div>
          </div>
        </div>
      </div>

      <div className="quote__pad">
        <table className="quote__table">
          <thead>
            <tr data-quote-break>
              <th>Room and charges</th>
              <th>Rate / night</th>
              <th>Nights</th>
              <th>Amount</th>
            </tr>
          </thead>
          {rooms.map(({ room, from, to, result }) => (
            <tbody key={room.id}>
              <tr className="quote__room">
                <td>
                  <strong>
                    Room {room.roomNumber} · {room.category.name}
                  </strong>
                  <small>
                    {[
                      room.bedSize && `${BED_SIZE_LABEL[room.bedSize]} bed`,
                      room.bathroomType && BATHROOM_TYPE_LABEL[room.bathroomType],
                      room.maxOccupancy && `up to ${room.maxOccupancy} guest${room.maxOccupancy === 1 ? '' : 's'}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </td>
                <td colSpan={3} className="quote__stay">
                  <b>{formatDate(from)}</b> to <b>{formatDate(to)}</b> · {nightsLabel(result.nightCount)}
                </td>
              </tr>
              {result.lines.map((line, i) => (
                <tr key={i} data-quote-break>
                  <td className="quote__item">{lineName(line.label)}</td>
                  <td>{line.nights > 0 ? formatPrice(Number(line.amount) / line.nights) : ''}</td>
                  <td>{line.nights}</td>
                  <td>{formatPrice(line.amount)}</td>
                </tr>
              ))}
              <tr className="quote__sub" data-quote-break>
                <td colSpan={3}>Room {room.roomNumber} total</td>
                <td>{formatPrice(result.total)}</td>
              </tr>
            </tbody>
          ))}
        </table>
      </div>

      <div className="quote__close quote__pad" data-quote-break>
        <div>
          <div className="quote__cap">Terms and conditions</div>
          <ol className="quote__terms">
            <li>This quotation is valid only for the rooms and dates mentioned above.</li>
            <li>
              Rates are as on the date of this quotation. If room rates or charges change later, this quotation
              will not be considered and a fresh quotation will be issued.
            </li>
            <li>This is a quotation only. It is not a bill, and it does not confirm or hold a booking.</li>
            <li>Rooms are subject to availability at the time of booking.</li>
            <li>Any change in rooms, dates, number of guests or extras will change the amount.</li>
            <li>Services not listed above are charged separately.</li>
          </ol>
          <div className="quote__words">
            <b>Amount in words:</b> {rupeesInWords(total)}
          </div>
        </div>
        <div className="quote__totals">
          {rooms.map(({ room, result }) => (
            <div key={room.id}>
              <span>
                Room {room.roomNumber} · {nightsLabel(result.nightCount)}
              </span>
              <span>{formatPrice(result.total)}</span>
            </div>
          ))}
          <div className="quote__grand">
            <span>Total</span>
            <span>{formatPrice(total)}</span>
          </div>
          <small>
            {rooms.length} room{rooms.length === 1 ? '' : 's'} · {nightsLabel(totalNights)}
          </small>
        </div>
      </div>

      <div className="quote__spacer" />

      <div className="quote__sign quote__pad" data-quote-break>
        <div className="quote__thanks">Thank you for considering {name}. We look forward to hosting you.</div>
        <div className="quote__sign-box">
          <i />
          <b>For {name}</b>
          Authorised signatory
        </div>
      </div>
      <div className="quote__foot" data-quote-break>
        <span>
          {name} · Quotation dated {date}
        </span>
      </div>
    </div>
  );
});

export default QuotationDocument;
