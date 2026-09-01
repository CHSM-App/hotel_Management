import { forwardRef } from 'react';
import { amountInWords } from './numberToWords';
import './BillDocument.css';

const DOCUMENT_LABEL = {
  TAX_INVOICE: 'Tax Invoice',
  BILL_OF_SUPPLY: 'Bill of Supply',
  CASH_RECEIPT: 'Final Bill',
};

// Every caption on the form. The Marathi variant deliberately covers the
// masthead alone — the document label, the phone and GSTIN captions, and the
// name and address the lodge stored in Devanagari — with everything below the
// head staying in English. That is how the house's own printed book works
// (Devanagari head, English form), and it is what was asked for after a cut
// that translated the whole sheet: the desk fills the body in English, and the
// guest checks it line by line in the language it was filled in.
const STRINGS_EN = {
  doc: DOCUMENT_LABEL,
  cashMemo: 'Cash Memo',
  mob: 'Mob.',
  gstin: 'GSTIN No.',
  no: 'No.-',
  date: 'Date -',
  onIssue: 'allocated on issue',
  name: 'Name',
  mobNo: 'Mob. No.',
  billNo: 'Bill No.',
  table: 'Table',
  covers: 'Covers -',
  counter: 'Counter / takeaway',
  roomNo: 'Room No.',
  persons: 'Persons -',
  rs: 'Rs.',
  ps: 'Ps.',
  forStay: 'For',
  days: 'Days',
  from: 'From',
  to: 'To',
  at: 'at',
  perDay: 'Per day',
  extraCharges: 'Extra Charges',
  lateCheckout: 'Late checkout',
  partNights: (ran, total) => `${ran} of ${total} days`,
  placeOfSupply: 'Place of Supply',
  reverseCharge: 'Reverse Charge',
  noWord: 'No',
  miscCharges: 'Misc Charges',
  // A function's bill: the venue where the room number goes, plates where the
  // persons go, and the catering under its own head.
  venue: 'Venue',
  plates: 'Plates -',
  functionLabel: 'Function',
  venueHire: 'Venue hire',
  catering: 'Catering',
  lessDiscount: 'Less: Discount',
  totalAmount: 'TOTAL AMOUNT',
  miscTag: 'Misc',
  roundOff: 'Round off',
  grandTotal: 'GRAND TOTAL',
  // Printed only when the guest paid in more than one way, one row each.
  pay: { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' },
  lessAdvance: 'Less Advance if any',
  recNo: 'Rec. No.',
  txnNo: 'Txn No.',
  netPayment: 'Net Payment',
  inwords: '(Inwords Rupees',
  words: amountInWords,
  jurisdiction: (city) => `Subject to ${city} Jurisdiction.`,
  declaration:
    'Declaration : I/We declare that this invoice shows that actual price of the services described and that all particulars are true and correct.',
  checkout24: 'Checkout time 24 hours from check-in.',
  checkoutBy: (time) => `Checkout by ${time} on the departure date.`,
  guestSign: "Guest's Sign.",
  customerSign: "Customer's Sign.",
  thanks: 'THANK YOU!',
  propSign: 'For Prop. / Manager',
};

// "(Leaving early, 50%)", "(50%)", "(Leaving early)" or nothing — the reason
// first because it is what the guest asks about, the percentage because it
// is what the desk agreed.
function discountQualifier(invoice) {
  const parts = [];
  if (invoice.discountReason) parts.push(invoice.discountReason);
  if (invoice.discountPercent > 0) parts.push(`${invoice.discountPercent}%`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

const STRINGS = {
  en: STRINGS_EN,
  mr: {
    ...STRINGS_EN,
    // Standard GST Marathi terms for the document types.
    doc: { TAX_INVOICE: 'कर बीजक', BILL_OF_SUPPLY: 'पुरवठा बीजक', CASH_RECEIPT: 'अंतिम देयक' },
    cashMemo: 'कॅश मेमो',
    mob: 'मो.',
    gstin: 'जीएसटीआयएन क्र.',
  },
};

const SAC_ACCOMMODATION = '996311';
const SAC_FOOD = '996331';
// Hall hire — rental of non-residential property. The bill carries the code
// it was issued under; this is only the fallback for one that didn't.
const SAC_VENUE = '997212';

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
// Used only by the previous bill format, which is commented out below — kept
// alongside it so restoring that form does not have to reconstruct this too.
/*
function Cell({ head, span, children }) {
  return (
    <td colSpan={span}>
      <span className="bill-doc__grid-head">{head}</span>
      <span className="bill-doc__grid-value">{children || '—'}</span>
    </td>
  );
}
*/

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

/* ---------------------------------------------------------------------------
   PREVIOUS BILL FORMAT — superseded by the Cash Memo layout below.

   Kept commented rather than deleted: this is the ruled tax-invoice form with
   an itemised particulars table, a rate-wise GST summary and a terms footer.
   The house asked for the printed Cash Memo book instead, which states the same
   figures in a flatter shape. If the invoice format has to be argued with an
   auditor, this is the version that was replaced.

   Note: comment terminators inside the old code are written with a space
   between the star and the slash, so this block closes where it should.
   Restoring it means closing those back up as well.

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
  const discountLabel = `Less: Discount${discountQualifier(invoice)}`;

  // Stated from the property's own policy rather than printed as fixed text.
  // A 24-hour house measures the stay from the guest's actual arrival; a
  // night-based one turns everybody out at the same clock time.
  const checkoutTerm =
    invoice.checkinMode === 'HOUR_24'
      ? T.checkout24
      : T.checkoutBy(clockLabel(invoice.checkOutTime) || '11:00 AM');

  // The rates the stay was built from, named beside the heading rather than
  // listed as their own rows. Each carries a gross, GST-inclusive amount, and
  // the room total below is now a taxable value — so as rows they would sit in
  // the same column as a figure they no longer add up to, and a guest checking
  // the bill would find the subtraction failing. As a note they say the same
  // thing without claiming to be arithmetic.
  //
  // The × matters: without it a rate reads as sitting next to an unrelated
  // night count, and the guest is left to guess that one multiplies the other.
  // Only rates get one — a concession is one decision on the whole stay, spread
  // back across the nights, and "× 3 days" would read as three of them.
  const rateNote = [
    ...(invoice.roomCharges ?? []).map((line) =>
      line.nights > 1 && line.amount > 0 ? `${line.label} × ${line.nights} days` : line.label
    ),
    ...(invoice.lateCheckoutCharge > 0 ? ['Late checkout'] : []),
  ].join(' · ');

  const particulars = [];
  if (invoice.roomSubtotal > 0) {
    if (invoice.roomCharges?.length > 0) {
      particulars.push({
        kind: 'section',
        // The form's "Room rent for ......... Days", with the blank filled.
        label: nights ? `Room rent for ${nights} ${nights === 1 ? 'day' : 'days'}` : 'Room rent',
        note: rateNote || null,
        sac: isGst ? SAC_ACCOMMODATION : null,
      });
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
    // Named on the bill either way — a guest disputing the total needs to see
    // the overstay called out, not folded into the room and left to be argued
    // about. Where the rates are itemised beside the heading it joins them
    // there; on an older bill without them it keeps its own priced row, which
    // still adds up because that room-rent row prints the nights alone.
    if (invoice.lateCheckoutCharge > 0 && !(invoice.roomCharges?.length > 0)) {
      particulars.push({
        kind: 'item',
        key: 'late',
        label: 'Late checkout',
        amount: invoice.lateCheckoutCharge,
      });
    }
    // The taxable value, not the gross: it is the figure the CGST and SGST
    // below were actually computed on, and the one the rate-wise summary at the
    // foot of the bill repeats. Printing the gross here left the two disagreeing
    // on the same sheet, with nothing on the page to explain the gap.
    if (invoice.roomCharges?.length > 0) {
      particulars.push({ kind: 'sub', key: 'room-total', label: 'Room total', amount: roomTaxable });
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
          table instead of leaving two rules blank. * /}
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
          anything in it changes height. * /}
      <table className="bill-doc__grid">
        {/* Column widths are declared, not inferred. Without this the table
            falls back to auto layout, where the browser sizes each column from
            its content and the space available — so the same bill lands on
            different column boundaries in the modal and on an A4 sheet. * /}
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
                    boxes line up with the arrival row beneath it. * /}
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
                    the arrival time three columns away from its own date. * /}
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
              not the answer was ever in doubt. * /}
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
              "total tax" line would not reconcile. * /}
          {particulars.map((line) =>
            line.kind === 'section' ? (
              <tr key={line.label}>
                <td colSpan={2} className="bill-doc__section">
                  {line.label}
                  {line.sac && <span className="bill-doc__sac">SAC {line.sac}</span>}
                  {/* The rates the heading covers, beside it rather than under
                      it as priced rows — see rateNote above. * /}
                  {line.note && <span className="bill-doc__item-qty">{line.note}</span>}
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
                      itself — the alternative is a total that looks wrong. * /}
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
              it collapses on its own once the entries fill the sheet. * /}
          <tr className="bill-doc__filler">
            <td />
            <td />
          </tr>
        </tbody>
      </table>

      {/* Signature to the left of the totals stack, exactly as the form has it:
          the guest signs against the figure they are agreeing to. * /}
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
              <span>Advance{invoice.advanceReceiptNumbers ? ` (Rec. No. ${invoice.advanceReceiptNumbers})` : ''}</span>
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
              money actually has to move. * /}
          <div className="bill-doc__totals-line bill-doc__totals-line--net">
            <span>{balanceDue < 0 ? 'Net Refund' : 'Net Balance'}</span>
            <span className="bill-doc__amt">{amt(Math.abs(balanceDue))}</span>
          </div>
        </div>
      </div>

      {/* The guest's copy of a UPI or card payment carries the same reference on
          their side, which is what makes a disputed payment answerable months
          later. Its own rule rather than a totals cell — it is a fact about the
          payment, not a figure in the column. * /}
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
                is the same omission as on a two-row one. * /}
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
--------------------------------------------------------------------------- */

// The Cash Memo, as the house prints it. A flat form rather than an itemised
// invoice: the stay is stated once as a rate and a day count, and the money
// column runs straight down to the net payment.
//
// Prices stay GST-inclusive, as they always have been here. The memo's own
// arithmetic reads as tax added on top — 3,809.52 + 95.24 + 95.24 = 4,000 —
// and that is exactly what an inclusive bill states when TOTAL AMOUNT carries
// the taxable value: the two lines below it are the tax already inside the
// grand total, and the column adds up without anybody being charged more.

// One row of the money column. The memo rules Rs. and Ps. apart, so the paise
// land under each other however wide the rupees run — a column of "3809.52"
// and "95.24" set as plain text does not do that.
//
// Declared outside the component: a component defined in a render body is a
// new type on every render, and React unmounts and remounts the whole column
// each time rather than updating it.
function Money({ label, value, strong, rule }) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  // Rounded before it is split. Math.floor on a raw 95.999 would print 95
  // beside a 100 paise cell, which is a rupee lost off a bill that has to add
  // up in front of the guest paying it.
  const paiseTotal = Math.round(abs * 100);
  const whole = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  return (
    <tr className={`memo__money${strong ? ' memo__money--strong' : ''}${rule ? ' memo__money--rule' : ''}`}>
      <td className="memo__money-label">{label}</td>
      <td className="memo__rs">{`${sign}${whole.toLocaleString('en-IN')}`}</td>
      <td className="memo__ps">{String(paise).padStart(2, '0')}</td>
    </tr>
  );
}

const BillDocument = forwardRef(function BillDocument({ invoice, lang = 'en' }, ref) {
  if (!invoice) return null;

  const isGst = invoice.billingSide === 'GST';
  const isFoodBill = invoice.kind === 'FOOD';
  const isEventBill = invoice.kind === 'EVENT';
  const venueSac = invoice.venueSacCode || SAC_VENUE;
  const isPreview = invoice.status === 'PREVIEW';
  const nights = nightsOf(invoice);

  // The Marathi name and address print from text the lodge actually stored,
  // never a transliteration — a machine's guess at the Devanagari spelling of
  // a business name has no place on a tax document. Anything not stored falls
  // back to the English field, so a half-filled profile degrades to a
  // half-Marathi head rather than to blanks.
  const mr = lang === 'mr';
  const T = STRINGS[mr ? 'mr' : 'en'];
  const lodgeName = (mr && invoice.lodgeNameMr) || invoice.lodgeName;
  const lodgeAddress = (mr && invoice.lodgeAddressMr) || invoice.lodgeAddress;
  const kindLabel = T.doc[invoice.documentType] || T.cashMemo;

  // The taxable value each supply was charged on, apportioned server-side by
  // the same routine that produced the tax. The fallback only fires on a
  // payload predating that field, and is exact whenever the bill carries a
  // single supply — which is every bill that isn't a stay with a food tab.
  const gross = round2(invoice.roomSubtotal + invoice.foodSubtotal);
  const shareOf = (part) => (gross > 0 ? round2(part - (invoice.discountAmount * part) / gross) : part);
  const roomTaxable = invoice.roomTaxable ?? shareOf(invoice.roomSubtotal);
  const foodTaxable = invoice.foodTaxable ?? shareOf(invoice.foodSubtotal);

  // The room charge is built base rate first, then any season uplift, then each
  // switched-on extra — bed, AC, extra person — in the order the quote applied
  // them. So the head of the list is the nightly rate the memo writes on its
  // "Rs. ......... Per day" rule, and the tail is what the "Extra Charges" rule
  // is for. They are one list on the payload because they were one calculation;
  // they are two rules on the form because a guest reads them as two questions.
  const [baseCharge, ...extraCharges] = invoice.roomCharges ?? [];

  // What the memo writes on the "Rs. ......... Per day" rule.
  //
  // The base rate where the stay carries one. Failing that — a bill predating
  // the per-night snapshot, or one that never got charge lines — the nights
  // divided by their own count, which is the same figure whenever every night
  // was billed alike.
  const perDay =
    baseCharge && baseCharge.nights > 0
      ? round2(baseCharge.amount / baseCharge.nights)
      : !invoice.roomCharges?.length && nights > 0 && invoice.nightsSubtotal > 0
        ? round2(invoice.nightsSubtotal / nights)
        : null;

  // Everything on the room that isn't the nightly rate. Each already carries
  // its own arithmetic in the label the quote gave it — "Extra bed 2 × ₹300" —
  // so the rule states what was added and what it came to, and a guest can
  // check the one against the other.
  //
  // Late checkout joins them: it is money on the room that no per-day rate
  // accounts for, which is the same thing an extra is.
  const extras = [
    ...extraCharges.map((line) => ({
      key: line.label,
      // The nights an extra ran for, where it didn't run for all of them —
      // an extra bed taken for one night of three is a line a guest queries.
      label:
        line.nights > 0 && line.nights < nights
          ? `${line.label} · ${T.partNights(line.nights, nights)}`
          : line.label,
      amount: line.amount,
    })),
    ...(invoice.lateCheckoutCharge > 0
      ? [{ key: 'late', label: T.lateCheckout, amount: invoice.lateCheckoutCharge }]
      : []),
  ];

  // "Less Advance if any" means what it says: money taken BEFORE this bill was
  // cut. balance_collected is the opposite — it is the payment this bill is
  // asking for, handed over at the desk as it is printed.
  //
  // Adding the two together and calling the result an advance made every bill
  // wrong in two ways at once: a guest who left no deposit still saw "Less
  // Advance 1,500", and because the sum always equals the total, Net Payment
  // printed 0.00 on every bill ever issued — the one figure the guest is meant
  // to read off it.
  const netPayment = round2(invoice.totalAmount - invoice.advancePaid);

  const stayFrom = [formatDate(invoice.actualCheckInAt || invoice.checkInDate), formatTime(invoice.actualCheckInAt)];
  const stayTo = [formatDate(invoice.actualCheckOutAt || invoice.checkOutDate), formatTime(invoice.actualCheckOutAt)];
  const eventFrom = [formatDate(invoice.eventStartAt), formatTime(invoice.eventStartAt)];
  const eventTo = [formatDate(invoice.eventEndAt), formatTime(invoice.eventEndAt)];

  const supplyPlace = isGst ? placeOfSupply(invoice) : null;
  const checkoutTerm =
    invoice.checkinMode === 'HOUR_24'
      ? T.checkout24
      : T.checkoutBy(clockLabel(invoice.checkOutTime) || '11:00 AM');

  // The figure at the head of the Rs./Ps. column, against the stay block.
  //
  // The taxable value, NOT the grand total. It is the first entry in a column
  // that then adds CGST and SGST to reach GRAND TOTAL, so putting the inclusive
  // figure here made the column contradict itself: it read 1,300 at the top,
  // 1,238.10 against its own TOTAL AMOUNT two rules below, and 1,300 again at
  // the bottom — the tax appearing to be added to a number that already held it.
  //
  // Deliberately the same expression the TOTAL AMOUNT line uses, so the two can
  // never drift: this is that line, written once at the top of the column where
  // the printed memo puts it.
  const leadAmount = round2(roomTaxable + foodTaxable);
  const grossWhole = Math.floor(Math.round(leadAmount * 100) / 100);
  const grossPaise = Math.round(leadAmount * 100) % 100;

  return (
    <div className="bill-doc memo" ref={ref}>
      {/* Masthead. "Cash Memo" sits above the name on the printed book, with
          the phone numbers stacked in the corner beside it. */}
      <div className="memo__head">
        <div className="memo__kind">{kindLabel}</div>
        {invoice.lodgePhone && (
          <div className="memo__phones">
            {invoice.lodgePhone
              .split(/[,/]/)
              .map((p) => p.trim())
              .filter(Boolean)
              .map((p) => (
                <span key={p}>
                  {T.mob} {p}
                </span>
              ))}
          </div>
        )}
        <div className={`memo__name${mr && invoice.lodgeNameMr ? ' memo__name--dv' : ''}`}>{lodgeName}</div>
      </div>

      {/* City and state ride along only when the address itself is the English
          one — appending an English city to a Marathi address line would mix
          scripts mid-sentence on the most visible rule of the sheet. A stored
          Marathi address is printed as the whole line, exactly as typed. */}
      <div className="memo__addr">
        {mr && invoice.lodgeAddressMr
          ? lodgeAddress
          : [lodgeAddress, invoice.lodgeCity, invoice.lodgeState].filter(Boolean).join(', ')}
      </div>
      {isGst && invoice.gstin && (
        <div className="memo__gstin">
          {T.gstin} {invoice.gstin}
        </div>
      )}

      {/* No. and Date on one rule, the way the book prints them. */}
      {/* Blank on a preview, and truthfully so: the number is allocated at
          issue time to keep the series gapless, and the date is the date it is
          issued on. A preview that filled them in would be showing the desk a
          number the bill will not actually carry. */}
      <div className="memo__row">
        <span className="memo__label">{T.no}</span>
        <Filled narrow>
          {invoice.invoiceNumber || (isPreview ? <em className="memo__pending">{T.onIssue}</em> : null)}
        </Filled>
        <span className="memo__label">{T.date}</span>
        <Filled narrow>
          {formatDate(invoice.createdAt) || (isPreview ? <em className="memo__pending">{T.onIssue}</em> : null)}
        </Filled>
      </div>

      <div className="memo__row">
        <span className="memo__label">{T.name}</span>
        <Filled>{isFoodBill ? invoice.tableLabel || T.counter : invoice.guestName}</Filled>
        <span className="memo__label">{T.mobNo}</span>
        <Filled narrow>{invoice.guestPhone}</Filled>
      </div>

      {/* The register strip. A food bill has no room or stay behind it, so it
          names the table and covers instead of leaving two rules blank.
          The printed book has a "Reg. No." rule here for the guest register
          serial. Nothing in this system keeps that register, and the booking's
          own id is not it — a number that doesn't continue the book's sequence
          under a caption claiming it does is worse than no rule at all. */}
      <div className="memo__row memo__row--split">
        {isEventBill ? (
          <>
            <span className="memo__label">{T.billNo}</span>
            <Filled narrow>{invoice.invoiceNumber}</Filled>
            <span className="memo__label">{T.venue}</span>
            <Filled narrow>{invoice.venueName}</Filled>
            <span className="memo__label">{T.plates}</span>
            <Filled narrow>{invoice.numGuests}</Filled>
          </>
        ) : isFoodBill ? (
          <>
            <span className="memo__label">{T.billNo}</span>
            <Filled narrow>{invoice.invoiceNumber}</Filled>
            <span className="memo__label">{T.table}</span>
            <Filled narrow>{invoice.tableLabel}</Filled>
            <span className="memo__label">{T.covers}</span>
            <Filled narrow>{invoice.numGuests}</Filled>
          </>
        ) : (
          <>
            <span className="memo__label">{T.roomNo}</span>
            <Filled narrow>
              {invoice.roomNumber
                ? `${invoice.roomNumber}${invoice.categoryName ? ` (${invoice.categoryName})` : ''}`
                : null}
            </Filled>
            <span className="memo__label">{T.persons}</span>
            <Filled narrow>{invoice.numGuests}</Filled>
          </>
        )}
      </div>

      {/* The body: the stay stated on ruled lines to the left, the money column
          to the right. One table so the two halves share a top and bottom rule
          and the money column keeps its own vertical the whole way down. */}
      <table className="memo__body">
        <colgroup>
          <col />
          <col className="memo__col-rs" />
          <col className="memo__col-ps" />
        </colgroup>
        <thead>
          <tr>
            <th aria-hidden="true" />
            <th className="memo__rs">{T.rs}</th>
            <th className="memo__ps">{T.ps}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="memo__stay">
              {/* A function: what it was, when it ran, the hire and what was
                  sold with it — the same rules the stay block uses, with the
                  night count gone. */}
              {isEventBill && (
                <>
                  <div className="memo__stay-line">
                    <span className="memo__label">{T.functionLabel}</span>
                    <Filled>{invoice.eventTitle}</Filled>
                  </div>
                  <div className="memo__stay-line">
                    <span className="memo__label">{T.from}</span>
                    <Filled narrow>{eventFrom[0]}</Filled>
                    <span className="memo__label">{T.at}</span>
                    <Filled narrow>{eventFrom[1]}</Filled>
                  </div>
                  <div className="memo__stay-line">
                    <span className="memo__label">{T.to}</span>
                    <Filled narrow>{eventTo[0]}</Filled>
                    <span className="memo__label">{T.at}</span>
                    <Filled narrow>{eventTo[1]}</Filled>
                  </div>
                  <div className="memo__stay-line">
                    <span className="memo__label">{T.rs}</span>
                    <Filled narrow>{baseCharge ? amt(baseCharge.amount) : null}</Filled>
                    <span className="memo__label">{T.venueHire}</span>
                  </div>
                  <div className="memo__stay-line memo__stay-line--extras">
                    <span className="memo__label">{T.extraCharges}</span>
                    {extras.length > 0 ? (
                      <span className="memo__extras">
                        {extras.map((extra) => (
                          <span className="memo__extra" key={extra.key}>
                            <span className="memo__extra-name">{extra.label}</span>
                            <span className="memo__extra-amt">{amt(extra.amount)}</span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <Filled>{null}</Filled>
                    )}
                  </div>
                  {supplyPlace && (
                    <div className="memo__stay-line memo__stay-line--fine">
                      <span className="memo__label">{T.placeOfSupply}</span>
                      <Filled narrow>{supplyPlace}</Filled>
                      <span className="memo__label">{T.reverseCharge}</span>
                      <Filled narrow>{T.noWord}</Filled>
                    </div>
                  )}
                  {isGst && invoice.roomSubtotal > 0 && (
                    <div className="memo__stay-line memo__stay-line--fine">
                      <span className="memo__label">SAC</span>
                      <Filled narrow>{venueSac}</Filled>
                    </div>
                  )}
                </>
              )}

              {!isFoodBill && !isEventBill && (
                <>
                  <div className="memo__stay-line">
                    <span className="memo__label">{T.forStay}</span>
                    <Filled narrow>{nights}</Filled>
                    <span className="memo__label">{T.days}</span>
                  </div>
                  <div className="memo__stay-line">
                    <span className="memo__label">{T.from}</span>
                    <Filled narrow>{stayFrom[0]}</Filled>
                    <span className="memo__label">{T.at}</span>
                    <Filled narrow>{stayFrom[1]}</Filled>
                  </div>
                  <div className="memo__stay-line">
                    <span className="memo__label">{T.to}</span>
                    <Filled narrow>{stayTo[0]}</Filled>
                    <span className="memo__label">{T.at}</span>
                    <Filled narrow>{stayTo[1]}</Filled>
                  </div>
                  <div className="memo__stay-line">
                    <span className="memo__label">{T.rs}</span>
                    <Filled narrow>{perDay != null ? amt(perDay) : null}</Filled>
                    <span className="memo__label">{T.perDay}</span>
                  </div>
                  {/* What the day count doesn't cover — extra bed, AC, an
                      overstay. Named rather than folded into the total and
                      left to be argued about, each against what it came to.
                      The rule prints whether or not anything was added, the
                      way the form does: a blank rule is part of the shape. */}
                  <div className="memo__stay-line memo__stay-line--extras">
                    <span className="memo__label">{T.extraCharges}</span>
                    {extras.length > 0 ? (
                      <span className="memo__extras">
                        {extras.map((extra) => (
                          <span className="memo__extra" key={extra.key}>
                            <span className="memo__extra-name">{extra.label}</span>
                            <span className="memo__extra-amt">{amt(extra.amount)}</span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <Filled>{null}</Filled>
                    )}
                  </div>
                  {/* Both required on a tax invoice, and both constant for this
                      business — but a bill that omits them is defective whether
                      or not the answer was ever in doubt. */}
                  {supplyPlace && (
                    <div className="memo__stay-line memo__stay-line--fine">
                      <span className="memo__label">{T.placeOfSupply}</span>
                      <Filled narrow>{supplyPlace}</Filled>
                      <span className="memo__label">{T.reverseCharge}</span>
                      <Filled narrow>{T.noWord}</Filled>
                    </div>
                  )}
                  {isGst && invoice.roomSubtotal > 0 && (
                    <div className="memo__stay-line memo__stay-line--fine">
                      <span className="memo__label">SAC</span>
                      <Filled narrow>{SAC_ACCOMMODATION}</Filled>
                    </div>
                  )}
                </>
              )}

              {/* Food keeps its items. It is a different supply at a different
                  rate, reported apart in GSTR-1, and a single folded figure
                  would leave a customer no way to check what they ate. */}
              {invoice.foodSubtotal > 0 && (
                <div className="memo__misc">
                  <div className="memo__misc-head">
                    {isEventBill ? T.catering : T.miscCharges}
                    {isGst && <span className="memo__sac">SAC {SAC_FOOD}</span>}
                  </div>
                  {invoice.foodItems?.map((item, index) => (
                    <div className="memo__misc-line" key={`${item.name}-${item.unitPrice}-${index}`}>
                      <span>
                        {item.name}
                        <span className="memo__qty">
                          {item.quantity} × {amt(item.unitPrice)}
                        </span>
                      </span>
                      <span>{amt(item.lineTotal)}</span>
                    </div>
                  ))}
                </div>
              )}
            </td>
            {/* The gross the stay came to, against the top of the stay block —
                where the memo writes it. */}
            <td className="memo__rs memo__rs--lead">{grossWhole.toLocaleString('en-IN')}</td>
            <td className="memo__ps memo__ps--lead">{String(grossPaise).padStart(2, '0')}</td>
          </tr>
        </tbody>
      </table>

      {/* The money column proper. TOTAL AMOUNT is the taxable value, the two
          tax lines are the tax already sitting inside the grand total, and the
          three add up on the page exactly as the printed book has them. */}
      <table className="memo__totals">
        <colgroup>
          <col />
          <col className="memo__col-rs" />
          <col className="memo__col-ps" />
        </colgroup>
        <tbody>
          {invoice.discountAmount > 0 && (
            <Money
              label={`${T.lessDiscount}${discountQualifier(invoice)}`}
              value={-invoice.discountAmount}
            />
          )}
          <Money label={T.totalAmount} value={round2(roomTaxable + foodTaxable)} rule />
          {invoice.cgstAmount > 0 && <Money label={`CGST ${invoice.cgstRatePercent} %`} value={invoice.cgstAmount} />}
          {invoice.sgstAmount > 0 && <Money label={`SGST ${invoice.sgstRatePercent} %`} value={invoice.sgstAmount} />}
          {invoice.foodCgstAmount > 0 && (
            <Money label={`CGST ${invoice.foodCgstRatePercent} % (${T.miscTag})`} value={invoice.foodCgstAmount} />
          )}
          {invoice.foodSgstAmount > 0 && (
            <Money label={`SGST ${invoice.foodSgstRatePercent} % (${T.miscTag})`} value={invoice.foodSgstAmount} />
          )}
          {invoice.roundOff !== 0 && <Money label={T.roundOff} value={invoice.roundOff} />}
          <Money label={T.grandTotal} value={invoice.totalAmount} strong rule />
          {invoice.advancePaid > 0 && (
            <Money
              label={
                invoice.advanceReceiptNumbers
                  ? `${T.lessAdvance} (${T.recNo} ${invoice.advanceReceiptNumbers})`
                  : T.lessAdvance
              }
              value={invoice.advancePaid}
            />
          )}
          <Money
            label={
              <>
                {T.netPayment}
                {/* Beside the net payment, not the advance: balance_payment_method
                    describes the money being handed over now. The reference is
                    what the guest's own UPI or card statement carries, and is
                    what makes a disputed payment answerable months later.

                    Dropped entirely on a split. The rows underneath name every
                    method that was used and what came in by each, so repeating
                    the first one here printed "CASH" with "Cash 1,000" directly
                    beneath it — the same payment, said twice, one of the two
                    without its amount. */}
                {!(invoice.paymentLines?.length > 1) &&
                  (invoice.balanceReference || invoice.balancePaymentMethod) && (
                    <span className="memo__ref">
                      {[invoice.balancePaymentMethod, invoice.balanceReference].filter(Boolean).join(' ')}
                    </span>
                  )}
              </>
            }
            value={netPayment}
            strong
            rule
          />
          {/* How that payment was actually made up, when it was made up of more
              than one thing. Gated on > 1 deliberately: with a single method the
              decoration on the Net Payment label above already says it, and
              rendering unconditionally would put a duplicate "Cash 1,500" row
              under it on every bill the property prints.

              Not strong and not ruled — these are a breakdown of the figure
              above, not another total to be read off the page. */}
          {invoice.paymentLines?.length > 1 &&
            invoice.paymentLines.map((line, index) => (
              <Money
                key={index}
                label={
                  <>
                    {T.pay?.[line.method] ?? line.method}
                    {line.reference && (
                      <span className="memo__ref">
                        {T.txnNo} {line.reference}
                      </span>
                    )}
                  </>
                }
                value={line.amount}
              />
            ))}
        </tbody>
      </table>

      <div className="memo__row memo__row--words">
        <span className="memo__label">{T.inwords}</span>
        <Filled>{T.words(invoice.totalAmount)}</Filled>
        <span className="memo__label">)</span>
      </div>

      <div className="memo__foot">
        <div className="memo__terms">
          <div>{T.jurisdiction(invoice.lodgeCity || 'local')}</div>
          <div>{T.declaration}</div>
          <div>{checkoutTerm}</div>
        </div>
        <div className="memo__signs">
          <div className="memo__sign">
            <span className="memo__sign-line" />
            {isFoodBill ? T.customerSign : T.guestSign}
          </div>
          <div className="memo__thanks">{T.thanks}</div>
          <div className="memo__sign">
            <span className="memo__sign-line" />
            {T.propSign}
          </div>
        </div>
      </div>
    </div>
  );
});

export default BillDocument;
