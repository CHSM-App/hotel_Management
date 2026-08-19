import { forwardRef } from 'react';
import { amountInWords } from './numberToWords';
import './BillDocument.css';

const DOCUMENT_LABEL = {
  TAX_INVOICE: 'Tax Invoice',
  BILL_OF_SUPPLY: 'Bill of Supply',
  CASH_RECEIPT: 'Final Bill',
};

const SAC_ACCOMMODATION = '996311';
const SAC_FOOD = '996331';

// Money on a document is always two decimals, and the ₹ lives in the column
// heading rather than on every row. formatPrice is right for the app — a rate
// card reads better as "₹1,300" than "₹1,300.00" — but a bill that mixes
// "₹5,200" and "₹117.51" in one column looks like it was assembled by hand.
function amt(value) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}${Math.abs(n).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// "11:00" off the policy, said the way a guest reads a clock.
function clockLabel(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Rule 46(n) wants the place of supply named. For accommodation it is fixed at
// the location of the property (IGST Act §12(3)(b)) — a guest from anywhere is
// an intra-state supply here — so it is the lodge's own state, always.
//
// The state code is the first two digits of the GSTIN rather than a lookup
// table: it is the same number by definition, and a table would be one more
// thing to get out of step with the registration. Test GSTINs that don't start
// with two digits simply print the state unnumbered instead of "(QW)".
function placeOfSupply(invoice) {
  if (!invoice.lodgeState) return null;
  const code = /^\d{2}/.exec(invoice.gstin || '');
  return code ? `${invoice.lodgeState} (${code[0]})` : invoice.lodgeState;
}

// A value on a pre-printed form sits on a rule that is there whether or not
// anything was written on it. Blank stays blank rather than collapsing, so the
// form keeps its shape when a field wasn't captured.
function Filled({ children, narrow }) {
  return <span className={`bill-doc__filled${narrow ? ' bill-doc__filled--narrow' : ''}`}>{children || ' '}</span>;
}

// One boxed field of the register grid: the caption the form prints, and what
// was filled in under it.
//
// A component rather than markup repeated eight times, because the caption is a
// block element. Set on a <td> directly — which is what the first cut did for
// Arrival and Departure — display:block takes the cell out of its row, and the
// grid silently collapses into a stack rather than failing outright. Routing
// every caption through here means it can only ever land on a span.
function Cell({ head, span, children }) {
  return (
    <td colSpan={span}>
      <span className="bill-doc__grid-head">{head}</span>
      <span className="bill-doc__grid-value">{children || '—'}</span>
    </td>
  );
}

// Nights on the bill. Taken from the dates rather than from the charge lines,
// so it is still stated on stays booked before the per-night snapshot existed —
// those print no "× N days" annotation to infer it from.
function nightsOf(invoice) {
  if (!invoice.checkInDate || !invoice.checkOutDate) return null;
  const from = new Date(`${invoice.checkInDate}T00:00:00Z`);
  const to = new Date(`${invoice.checkOutDate}T00:00:00Z`);
  const n = Math.round((to - from) / 86400000);
  return n > 0 ? n : 1;
}

const BillDocument = forwardRef(function BillDocument({ invoice }, ref) {
  if (!invoice) return null;

  const isGst = invoice.billingSide === 'GST';
  const isFoodBill = invoice.kind === 'FOOD';
  const balanceDue = round2(invoice.totalAmount - invoice.advancePaid - invoice.balanceCollected);

  // The taxable value each rate was charged on, apportioned server-side by the
  // same routine that produced the tax. The fallback only fires on a payload
  // predating that field, and is exact whenever the bill has a single supply
  // on it — which is every bill that isn't a stay with a restaurant tab.
  const gross = round2(invoice.roomSubtotal + invoice.foodSubtotal);
  const shareOf = (part) =>
    gross > 0 ? round2(part - (invoice.discountAmount * part) / gross) : part;
  const roomTaxable = invoice.roomTaxable ?? shareOf(invoice.roomSubtotal);
  const foodTaxable = invoice.foodTaxable ?? shareOf(invoice.foodSubtotal);

  // The rate-wise summary every GST invoice carries: what was taxed, at what
  // rate, for how much. The particulars above show a guest what they are paying
  // for; this shows an auditor — and the guest's own accountant, if they are
  // claiming the stay — that the tax on it is arithmetic rather than a figure
  // someone typed. It is also the shape GSTR-1 is filed in, so a bill and the
  // return that reports it state the same thing.
  const taxRows = [];
  if (invoice.roomSubtotal > 0 && (invoice.cgstAmount > 0 || invoice.sgstAmount > 0)) {
    taxRows.push({
      sac: SAC_ACCOMMODATION,
      taxable: roomTaxable,
      cgstRate: invoice.cgstRatePercent,
      cgst: invoice.cgstAmount,
      sgstRate: invoice.sgstRatePercent,
      sgst: invoice.sgstAmount,
    });
  }
  if (invoice.foodSubtotal > 0 && (invoice.foodCgstAmount > 0 || invoice.foodSgstAmount > 0)) {
    taxRows.push({
      sac: SAC_FOOD,
      taxable: foodTaxable,
      cgstRate: invoice.foodCgstRatePercent,
      cgst: invoice.foodCgstAmount,
      sgstRate: invoice.foodSgstRatePercent,
      sgst: invoice.foodSgstAmount,
    });
  }
  const taxTotal = taxRows.reduce(
    (acc, row) => ({
      taxable: round2(acc.taxable + row.taxable),
      cgst: round2(acc.cgst + row.cgst),
      sgst: round2(acc.sgst + row.sgst),
    }),
    { taxable: 0, cgst: 0, sgst: 0 }
  );

  const nights = nightsOf(invoice);
  const supplyPlace = isGst ? placeOfSupply(invoice) : null;
  const discountLabel = `Less: Discount${
    invoice.discountPercent > 0 ? ` (${invoice.discountPercent}%)` : ''
  }`;

  // Stated from the property's own policy rather than printed as fixed text.
  // A 24-hour house measures the stay from the guest's actual arrival; a
  // night-based one turns everybody out at the same clock time.
  const checkoutTerm =
    invoice.checkinMode === 'HOUR_24'
      ? 'Checkout time 24 hours from check-in.'
      : `Checkout by ${clockLabel(invoice.checkOutTime) || '11:00 AM'} on the departure date.`;

  const particulars = [];
  if (invoice.roomSubtotal > 0) {
    if (invoice.roomCharges?.length > 0) {
      particulars.push({
        kind: 'section',
        // The form's "Room rent for ......... Days", with the blank filled.
        label: nights ? `Room rent for ${nights} ${nights === 1 ? 'day' : 'days'}` : 'Room rent',
        sac: isGst ? SAC_ACCOMMODATION : null,
      });
      invoice.roomCharges.forEach((line) =>
        particulars.push({
          kind: 'item',
          key: line.label,
          label: line.label,
          // The × matters: without it the line reads as a rate sitting next to
          // an unrelated night count, and the guest is left to guess that one
          // multiplies the other. With it the row shows its own arithmetic —
          // ₹1,300 × 3 nights = the amount in the column.
          //
          // Only rates get one. A concession is one decision on the whole stay,
          // spread back across the nights so each is taxed on what was charged
          // for it — "× 3 nights" would read as three of them.
          note: line.nights > 1 && line.amount > 0 ? `× ${line.nights} days` : null,
          amount: line.amount,
        })
      );
    } else {
      // Bills issued before the per-night snapshot existed have no lines and
      // print the single room-rent row on its own.
      particulars.push({
        kind: 'plain',
        key: 'room-rent',
        label: nights ? `Room rent for ${nights} ${nights === 1 ? 'day' : 'days'}` : 'Room rent',
        sac: isGst ? SAC_ACCOMMODATION : null,
        amount: invoice.lateCheckoutCharge > 0 ? invoice.nightsSubtotal : invoice.roomSubtotal,
      });
    }
    // Its own line, on the same SAC and inside the same tax lines below — a
    // guest disputing the total needs to see the overstay named, not folded
    // into the room and left to be argued about.
    if (invoice.lateCheckoutCharge > 0) {
      particulars.push({
        kind: 'item',
        key: 'late',
        label: 'Late checkout',
        amount: invoice.lateCheckoutCharge,
      });
    }
    if (invoice.roomCharges?.length > 0) {
      particulars.push({ kind: 'sub', key: 'room-total', label: 'Room total', amount: invoice.roomSubtotal });
    }
    // Above the tax, because that is where it was applied: the CGST and SGST
    // below were charged on this subtotal less this discount. Under them it
    // read as money off a taxed total, which is what a discount on a GST
    // invoice must never be — the taxable value has to already account for it.
    if (invoice.discountAmount > 0) {
      particulars.push({ kind: 'plain', key: 'disc', label: discountLabel, amount: -invoice.discountAmount });
    }
    // Prices are GST-inclusive, so these two are *inside* the room total above,
    // not added to it. They are marked 'incl' rather than 'plain' so the column
    // still adds up: an inclusive bill that listed tax as another line would
    // overshoot its own total by the tax twice over. A tax invoice still has to
    // state the amounts, which is why they are printed at all.
    if (invoice.cgstAmount > 0) {
      particulars.push({ kind: 'incl', key: 'cgst', label: `CGST (${invoice.cgstRatePercent}%)`, amount: invoice.cgstAmount });
    }
    if (invoice.sgstAmount > 0) {
      particulars.push({ kind: 'incl', key: 'sgst', label: `SGST (${invoice.sgstRatePercent}%)`, amount: invoice.sgstAmount });
    }
  }

  if (invoice.foodSubtotal > 0) {
    particulars.push({ kind: 'section', label: 'Misc Charges', sac: isGst ? SAC_FOOD : null });
    // Itemised: a customer checking a restaurant bill wants to see what they
    // ate, not a single total. Names and prices come from the snapshot taken on
    // each order line, so this shows what was actually charged even if the menu
    // has since been re-priced.
    invoice.foodItems?.forEach((item, index) =>
      particulars.push({
        kind: 'item',
        key: `${item.name}-${item.unitPrice}-${index}`,
        label: item.name,
        note: `${item.quantity} × ${amt(item.unitPrice)}`,
        amount: item.lineTotal,
      })
    );
    if (invoice.foodItems?.length) {
      particulars.push({ kind: 'sub', key: 'food-total', label: 'Food total', amount: invoice.foodSubtotal });
    }
    // Only when there is no room block above to have carried it — a table bill,
    // where the food is the whole invoice.
    if (invoice.roomSubtotal === 0 && invoice.discountAmount > 0) {
      particulars.push({ kind: 'plain', key: 'fdisc', label: discountLabel, amount: -invoice.discountAmount });
    }
    if (invoice.foodCgstAmount > 0) {
      particulars.push({ kind: 'incl', key: 'fcgst', label: `CGST (${invoice.foodCgstRatePercent}%)`, amount: invoice.foodCgstAmount });
    }
    if (invoice.foodSgstAmount > 0) {
      particulars.push({ kind: 'incl', key: 'fsgst', label: `SGST (${invoice.foodSgstRatePercent}%)`, amount: invoice.foodSgstAmount });
    }
  }

  if (invoice.roundOff !== 0) {
    particulars.push({ kind: 'plain', key: 'round', label: 'Round off', amount: invoice.roundOff });
  }

  return (
    <div className="bill-doc" ref={ref}>
      <div className="bill-doc__header">
        <div className="bill-doc__lodge-name">{invoice.lodgeName}</div>
        {(invoice.lodgeAddress || invoice.lodgeCity) && (
          <div className="bill-doc__lodge-address">
            {[invoice.lodgeAddress, invoice.lodgeCity, invoice.lodgeState].filter(Boolean).join(', ')}
          </div>
        )}
        <div className="bill-doc__lodge-address">
          {invoice.lodgePhone && <span>Mob: {invoice.lodgePhone}</span>}
          {isGst && invoice.gstin && (
            <span className="bill-doc__gstin">
              GSTIN: <strong>{invoice.gstin}</strong>
            </span>
          )}
        </div>
      </div>

      <div className="bill-doc__title">
        <span className="bill-doc__title-text">{DOCUMENT_LABEL[invoice.documentType]}</span>
      </div>

      {/* Ruled fill-in lines, the way the form does it. Name and mobile share
          one rule rather than taking one each — they are read together, and a
          form with a rule per fact runs to a second page. A food bill has no
          guest register behind it and prints neither; the grid below names the
          table instead of leaving two rules blank. */}
      {!isFoodBill && (
        <div className="bill-doc__fill">
          <span className="bill-doc__fill-label">Name</span>
          <Filled>{invoice.guestName}</Filled>
          <span className="bill-doc__fill-label">Mobile</span>
          <Filled narrow>{invoice.guestPhone}</Filled>
        </div>
      )}

      {/* The register block. Four equal columns, one row of facts each — no
          rowspans and no nested header rows. The first cut split Arrival and
          Departure across a spanned sub-row, which is fragile markup for no
          gain: it says the same thing as two cells and falls apart the moment
          anything in it changes height. */}
      <table className="bill-doc__grid">
        {/* Column widths are declared, not inferred. Without this the table
            falls back to auto layout, where the browser sizes each column from
            its content and the space available — so the same bill lands on
            different column boundaries in the modal and on an A4 sheet. */}
        <colgroup>
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <tbody>
          {isFoodBill ? (
            <tr>
              <Cell head="Bill No.">{invoice.invoiceNumber}</Cell>
              <Cell head="Date">{formatDate(invoice.createdAt)}</Cell>
              <Cell head="Table">{invoice.tableLabel || 'Counter / takeaway'}</Cell>
              <Cell head="Covers">{invoice.numGuests}</Cell>
            </tr>
          ) : (
            <>
              <tr>
                {/* Spanned so this row still measures four columns and its
                    boxes line up with the arrival row beneath it. */}
                <Cell head="Bill No." span={2}>{invoice.invoiceNumber}</Cell>
                <Cell head="Date">{formatDate(invoice.createdAt)}</Cell>
                <Cell head="Persons">{invoice.numGuests}</Cell>
              </tr>
              <tr>
                <Cell head="Room No.">
                  {invoice.roomNumber
                    ? `${invoice.roomNumber}${invoice.categoryName ? ` (${invoice.categoryName})` : ''}`
                    : null}
                </Cell>
                {/* Date and time in one cell. They are read together and split
                    into two boxes only to fill a grid — which is what pushed
                    the arrival time three columns away from its own date. */}
                <Cell head="Arrival">
                  {[formatDate(invoice.actualCheckInAt || invoice.checkInDate), formatTime(invoice.actualCheckInAt)]
                    .filter(Boolean)
                    .join(', ')}
                </Cell>
                <Cell head="Departure">
                  {[formatDate(invoice.actualCheckOutAt || invoice.checkOutDate), formatTime(invoice.actualCheckOutAt)]
                    .filter(Boolean)
                    .join(', ')}
                </Cell>
                <Cell head="Nights">{nights}</Cell>
              </tr>
            </>
          )}
          {/* Both required particulars on a tax invoice, and both constant for
              this business — but a bill that omits them is defective whether or
              not the answer was ever in doubt. */}
          {supplyPlace && (
            <tr>
              <Cell head="Place of Supply" span={2}>{supplyPlace}</Cell>
              <Cell head="Reverse Charge" span={2}>No</Cell>
            </tr>
          )}
        </tbody>
      </table>

      <table className="bill-doc__table">
        <colgroup>
          <col />
          <col className="bill-doc__col-amt" />
        </colgroup>
        <thead>
          <tr>
            <th className="bill-doc__particulars-head">P A R T I C U L A R S</th>
            <th className="bill-doc__amt">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {/* Accommodation and food are printed as separate blocks, each with
              its own SAC and its own tax lines. They are different supplies at
              different rates, and GSTR-1 reports them apart — a single merged
              "total tax" line would not reconcile. */}
          {particulars.map((line) =>
            line.kind === 'section' ? (
              <tr key={line.label}>
                <td colSpan={2} className="bill-doc__section">
                  {line.label}
                  {line.sac && <span className="bill-doc__sac">SAC {line.sac}</span>}
                </td>
              </tr>
            ) : (
              <tr key={line.key} className={line.kind === 'sub' ? 'bill-doc__subtotal' : undefined}>
                <td className={line.kind === 'item' ? 'bill-doc__item' : undefined}>
                  {line.label}
                  {line.sac && <span className="bill-doc__sac">SAC {line.sac}</span>}
                  {line.note && <span className="bill-doc__item-qty">{line.note}</span>}
                  {/* Says the amount beside it is already counted above. A guest
                      reading down the column has to be told once, on the line
                      itself — the alternative is a total that looks wrong. */}
                  {line.kind === 'incl' && (
                    <span className="bill-doc__item-qty">included in the above</span>
                  )}
                </td>
                <td className={`bill-doc__amt${line.kind === 'incl' ? ' bill-doc__amt--incl' : ''}`}>
                  {amt(line.amount)}
                </td>
              </tr>
            )
          )}
          {/* The open space a pre-printed form leaves below the entries. It is
              what stops a two-line bill from looking like a torn-off scrap, and
              it collapses on its own once the entries fill the sheet. */}
          <tr className="bill-doc__filler">
            <td />
            <td />
          </tr>
        </tbody>
      </table>

      {/* Signature to the left of the totals stack, exactly as the form has it:
          the guest signs against the figure they are agreeing to. */}
      <div className="bill-doc__close">
        <div className="bill-doc__close-sign">
          <span className="bill-doc__sign-line" />
          {isFoodBill ? 'Signature of Customer' : 'Signature of Guest'}
        </div>
        <div className="bill-doc__totals">
          <div className="bill-doc__totals-line bill-doc__totals-line--grand">
            <span>G. Total</span>
            <span className="bill-doc__amt">{amt(invoice.totalAmount)}</span>
          </div>
          {invoice.advancePaid > 0 && (
            <div className="bill-doc__totals-line">
              <span>Advance</span>
              <span className="bill-doc__amt">{amt(invoice.advancePaid)}</span>
            </div>
          )}
          {invoice.balanceCollected > 0 && (
            <div className="bill-doc__totals-line">
              <span>
                Received
                {invoice.balancePaymentMethod ? ` (${invoice.balancePaymentMethod})` : ''}
              </span>
              <span className="bill-doc__amt">{amt(invoice.balanceCollected)}</span>
            </div>
          )}
          {/* The form's "Net. Res. Refund" cell, named for whichever way the
              money actually has to move. */}
          <div className="bill-doc__totals-line bill-doc__totals-line--net">
            <span>{balanceDue < 0 ? 'Net Refund' : 'Net Balance'}</span>
            <span className="bill-doc__amt">{amt(Math.abs(balanceDue))}</span>
          </div>
        </div>
      </div>

      {/* The guest's copy of a UPI or card payment carries the same reference on
          their side, which is what makes a disputed payment answerable months
          later. Its own rule rather than a totals cell — it is a fact about the
          payment, not a figure in the column. */}
      {invoice.balanceReference && (
        <div className="bill-doc__fill bill-doc__fill--tight">
          <span className="bill-doc__fill-label">Txn Ref.</span>
          <Filled>{invoice.balanceReference}</Filled>
        </div>
      )}

      <div className="bill-doc__fill bill-doc__fill--tight">
        <span className="bill-doc__fill-label">Rs. In word</span>
        <Filled>{amountInWords(invoice.totalAmount)}</Filled>
      </div>

      {taxRows.length > 0 && (
        <table className="bill-doc__tax-summary">
          <colgroup>
            <col className="bill-doc__col-sac" />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>SAC</th>
              <th className="bill-doc__amt">Taxable Value</th>
              <th className="bill-doc__amt">CGST</th>
              <th className="bill-doc__amt">SGST</th>
              <th className="bill-doc__amt">Total Tax</th>
            </tr>
          </thead>
          <tbody>
            {taxRows.map((row) => (
              <tr key={row.sac}>
                <td>{row.sac}</td>
                <td className="bill-doc__amt">{amt(row.taxable)}</td>
                <td className="bill-doc__amt">
                  <span className="bill-doc__rate">{row.cgstRate}%</span>
                  {amt(row.cgst)}
                </td>
                <td className="bill-doc__amt">
                  <span className="bill-doc__rate">{row.sgstRate}%</span>
                  {amt(row.sgst)}
                </td>
                <td className="bill-doc__amt">{amt(round2(row.cgst + row.sgst))}</td>
              </tr>
            ))}
            {/* Printed even with a single SAC on the bill. It is the line an
                auditor adds up to, and leaving them to do it on a one-row table
                is the same omission as on a two-row one. */}
            <tr className="bill-doc__tax-total">
              <td>Total</td>
              <td className="bill-doc__amt">{amt(taxTotal.taxable)}</td>
              <td className="bill-doc__amt">{amt(taxTotal.cgst)}</td>
              <td className="bill-doc__amt">{amt(taxTotal.sgst)}</td>
              <td className="bill-doc__amt">{amt(round2(taxTotal.cgst + taxTotal.sgst))}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="bill-doc__footer">
        <div className="bill-doc__terms">
          <div className="bill-doc__thanks">Thank You.</div>
          <ul>
            <li>{checkoutTerm}</li>
            <li>Subject to rules and regulations of the hotel.</li>
            <li>Bill must be paid on presentation.</li>
            {isGst && (
              <li>
                Declared under GST: this bill shows the actual price of the services described and all
                particulars are true and correct.
              </li>
            )}
          </ul>
        </div>
        <div className="bill-doc__prepared">
          <span className="bill-doc__sign-line" />
          <span className="bill-doc__sign-for">For {invoice.lodgeName}</span>
          {isGst ? 'Authorised Signatory' : 'Bill Prepared By'}
        </div>
      </div>
    </div>
  );
});

export default BillDocument;
