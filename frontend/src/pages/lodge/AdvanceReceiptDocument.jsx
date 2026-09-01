import { forwardRef } from 'react';
import { amountInWords } from './numberToWords';
import './BillDocument.css';

// The receipt handed to a guest who pays an advance when the booking is taken.
//
// Deliberately the same printed form as the final bill — same masthead, same
// ruled register strip, same Rs/Ps money column — because it comes out of the
// same book and off the same printer, and a guest holding both should see one
// property's stationery rather than two. It reuses BillDocument.css outright
// rather than restating it: a second stylesheet would drift, and the two
// documents would slowly stop matching.
//
// What differs is what a receipt is *for*. A bill states what was sold and what
// is owed; this states what was received and what is left. So the body carries
// no charge lines — the stay is named, not itemised — and the money column ends
// at "Balance Due" instead of "Net Payment".

// The methods dbo.advance_receipts actually stores. The printed pad also has
// NEFT and Cheque boxes; they are omitted rather than shown permanently blank.
const PAY_METHODS = [
  { key: 'CASH', label: 'Cash' },
  { key: 'UPI', label: 'UPI' },
  { key: 'CARD', label: 'Card' },
];

const DOCUMENT_LABEL = {
  // Rule 50 names this document. A guest may well hand it to their own
  // accountant, so it is titled the way the rule titles it rather than as
  // "Advance Receipt", which is not a GST document type.
  RECEIPT_VOUCHER: 'Receipt Voucher',
  // Where there is no tax to state, "Receipt Voucher" would claim a status the
  // paper doesn't have. This is a plain acknowledgement and says so.
  ADVANCE_RECEIPT: 'Advance Receipt',
};

const STRINGS_EN = {
  doc: DOCUMENT_LABEL,
  mob: 'Mob.',
  no: 'No.-',
  date: 'Date -',
  onIssue: 'allocated on issue',
  name: 'Name',
  mobNo: 'Mob. No.',
  roomNo: 'Room No.',
  persons: 'Persons -',
  rs: 'Rs.',
  ps: 'Ps.',
  forStay: 'For',
  days: 'Days',
  from: 'From',
  to: 'To',
  receivedFrom: 'Received with thanks from',
  sumOfRupees: 'the sum of Rupees',
  by: 'by',
  txnNo: 'Txn No.',
  againstBill: 'against full/part payment of our Bill No.',
  dated: 'Dated',
  pay: { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' },
  towards: 'Towards advance against the stay described below',
  towardsEvent: 'Towards advance against the function described below',
  paidBy: 'Paid by',
  placeOfSupply: 'Place of Supply',
  reverseCharge: 'Reverse Charge',
  noWord: 'No',
  advanceReceived: 'ADVANCE RECEIVED',
  taxableValue: 'Taxable Value',
  stayTotal: 'Stay Total',
  lessAdvance: 'Less: Advance Received',
  subTotal: 'Sub Total',
  roundOff: 'Round off',
  balanceDue: 'BALANCE DUE',
  inwords: '(Inwords Rupees',
  words: amountInWords,
  jurisdiction: (city) => `Subject to ${city} Jurisdiction.`,
  // What makes the paper worth keeping: it is the guest's proof at the desk on
  // arrival, and the line that tells them so.
  adjustNote:
    'This advance is adjusted against the final bill for the stay named above. Please present this receipt at check-in.',
  // A function has no check-in desk to present anything at; the paper is the
  // organiser's proof when the balance is settled on the day.
  adjustNoteEvent:
    'This advance is adjusted against the final bill for the function named above. Please keep this receipt for settlement.',
  adjustNoteFullEvent:
    'This payment settles the function named above in full. Please keep this receipt.',
  // The same line for a guest who paid the whole stay up front. "Adjusted
  // against the final bill" is still true, but it invites the question of
  // what is left to adjust; the answer is nothing, and the paper should say so.
  adjustNoteFull:
    'This payment settles the stay named above in full. Please present this receipt at check-in.',
  // A receipt voucher is not a tax invoice, and must not be mistaken for one —
  // input credit is claimed off the invoice, not off this.
  notInvoice: 'This is a receipt voucher for an advance, not a tax invoice.',
  guestSign: 'Guest’s Sign.',
  thanks: 'THANK YOU!',
  propSign: 'For Prop. / Manager',
};

const STRINGS = {
  en: STRINGS_EN,
  mr: {
    ...STRINGS_EN,
    sumOfRupees: 'रक्कम रुपये',
    by: 'द्वारे',
    txnNo: 'व्यवहार क्र.',
    againstBill: 'आमच्या बिल क्र. च्या पूर्ण/अंशतः भरण्यापोटी',
    dated: 'दिनांक',
    pay: { CASH: 'रोख', UPI: 'यूपीआय', CARD: 'कार्ड' },
    // Standard GST Marathi terms, matching how BillDocument handles its own
    // masthead: Devanagari head, English body.
    doc: { RECEIPT_VOUCHER: 'पावती व्हाउचर', ADVANCE_RECEIPT: 'आगाऊ रक्कम पावती' },
    mob: 'मो.',
  },
};


function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// The same rule the bill follows: for accommodation the place of supply is the
// property's own state, and the code is the first two digits of the GSTIN by
// definition rather than from a lookup table that could drift.
function placeOfSupply(receipt) {
  if (!receipt.lodgeState) return null;
  const code = /^\d{2}/.exec(receipt.gstin || '');
  return code ? `${receipt.lodgeState} (${code[0]})` : receipt.lodgeState;
}

function Filled({ children, narrow }) {
  return <span className={`bill-doc__filled${narrow ? ' bill-doc__filled--narrow' : ''}`}>{children || ' '}</span>;
}

function nightsOf(receipt) {
  if (!receipt.checkInDate || !receipt.checkOutDate) return null;
  const from = new Date(`${receipt.checkInDate}T00:00:00Z`);
  const to = new Date(`${receipt.checkOutDate}T00:00:00Z`);
  const n = Math.round((to - from) / 86400000);
  return n > 0 ? n : 1;
}

// Paise-safe, matching the bill document: the receipt states a sub total the
// round off has to carry back to the printed stay total exactly.
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// One row of the money column, split into rupees and paise so it lands on the
// same ruled verticals the bill uses. Same shape as the bill document's own,
// because the two sheets sit in the same book and a receipt whose money column
// ruled differently would read as a different property's paper.
function Money({ label, value, strong, rule }) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  const paiseTotal = Math.round(Math.abs(n) * 100);
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

const AdvanceReceiptDocument = forwardRef(function AdvanceReceiptDocument({ receipt, lang = 'en' }, ref) {
  if (!receipt) return null;

  const isGst = receipt.billingSide === 'GST';
  const isPreview = receipt.status === 'PREVIEW';
  const isVoid = receipt.status === 'VOID';
  const nights = nightsOf(receipt);

  const mr = lang === 'mr';
  const T = STRINGS[mr ? 'mr' : 'en'];
  const lodgeName = (mr && receipt.lodgeNameMr) || receipt.lodgeName;
  const lodgeAddress = (mr && receipt.lodgeAddressMr) || receipt.lodgeAddress;
  const kindLabel = T.doc[receipt.documentType] || T.doc.ADVANCE_RECEIPT;
  // Read off the figures rather than sent as a flag: the server allows an
  // advance equal to the stay, and a receipt for one is a receipt for the
  // whole stay whatever the booking form called it.
  const paidInFull = Number(receipt.balanceDue) <= 0.005;

  // How this advance arrived. Always a list: a receipt taken before split
  // payments existed, or one paid a single way, reads as a one-line split
  // synthesised from its own scalar columns, so there is one rendering path
  // here rather than two.
  const paymentLines = receipt.paymentLines?.length
    ? receipt.paymentLines
    : [{ method: receipt.paymentMethod, amount: receipt.amountReceived, reference: receipt.paymentReference }];
  const split = paymentLines.length > 1;
  const paidBy = new Set(paymentLines.map((line) => line.method));
  // "Cash 600 · UPI 400 · Txn No. UTR123" — the amounts the ticks cannot show,
  // and every reference that came with them.
  const splitSummary = [
    ...paymentLines.map((line) => `${T.pay[line.method] || line.method} ${line.amount}`),
    ...paymentLines
      .filter((line) => line.reference)
      .map((line) => `${T.txnNo} ${line.reference}`),
  ].join(' · ');

  const supplyPlace = isGst ? placeOfSupply(receipt) : null;

  // The pad writes "Room No. 205 dt. 20th August 2026" on the line under the
  // guest's name. Same information, same place. A function names its venue
  // and its occasion there instead.
  const isEvent = receipt.kind === 'EVENT';
  const stayLine = isEvent
    ? [
        receipt.venueName,
        receipt.eventTitle,
        formatDate(receipt.eventStartAt) ? `dt. ${formatDate(receipt.eventStartAt)}` : null,
      ]
        .filter(Boolean)
        .join('  ')
    : [
    receipt.roomNumber ? `${T.roomNo} ${receipt.roomNumber}` : null,
    formatDate(receipt.checkInDate) ? `dt. ${formatDate(receipt.checkInDate)}` : null,
    nights ? `(${nights} ${T.days})` : null,
    receipt.numGuests ? `${T.persons} ${receipt.numGuests}` : null,
  ]
    .filter(Boolean)
    .join('  ');

  // The stay as the final bill will ask for it, and the rounding that got it
  // there. Both frozen at issue rather than re-derived, so a reprint states
  // the figures the guest was actually handed.
  const stayTotal = Number(receipt.stayTotal) || 0;
  const roundOff = Number(receipt.roundOff) || 0;

  const advanceWhole = Math.floor(Math.round(receipt.amountReceived * 100) / 100);
  const advancePaise = Math.round(receipt.amountReceived * 100) % 100;


  return (
    <div className="bill-doc memo" ref={ref}>
      <div className="memo__head">
        <div className="memo__kind">{kindLabel}</div>
        {receipt.lodgePhone && (
          <div className="memo__phones">
            {receipt.lodgePhone
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
        <div className={`memo__name${mr && receipt.lodgeNameMr ? ' memo__name--dv' : ''}`}>{lodgeName}</div>
      </div>

      {/* City and state ride along only when the address is the English one —
          appending an English city to a Marathi address line would mix scripts
          mid-sentence on the most visible rule of the sheet. */}
      <div className="memo__addr">
        {mr && receipt.lodgeAddressMr
          ? lodgeAddress
          : [lodgeAddress, receipt.lodgeCity, receipt.lodgeState].filter(Boolean).join(', ')}
      </div>

      {/* Blank on a preview, and truthfully so: the number is allocated at issue
          to keep the series gapless, and the date is the date it is issued on.
          A preview that filled them in would show a number the receipt will not
          actually carry. */}
      <div className="memo__row">
        <span className="memo__label">{T.no}</span>
        <Filled narrow>
          {receipt.receiptNumber || (isPreview ? <em className="memo__pending">{T.onIssue}</em> : null)}
        </Filled>
        <span className="memo__label">{T.date}</span>
        <Filled narrow>
          {formatDate(receipt.createdAt) || (isPreview ? <em className="memo__pending">{T.onIssue}</em> : null)}
        </Filled>
      </div>

      <div className="memo__row">
        <span className="memo__label">{T.receivedFrom}</span>
        <Filled>{receipt.guestName}</Filled>
        <span className="memo__label">{T.mobNo}</span>
        <Filled narrow>{receipt.guestPhone}</Filled>
      </div>

      {/* The paper this replaces runs: received from — the sum of Rupees — by
          [method] — against Bill No. Kept in that order because the property's
          printed book already reads that way and staff fill it top to bottom.
          The stay is named on the "received from" continuation line, as on the
          pad, rather than itemised: nothing has been supplied yet. */}
      <div className="memo__row">
        <Filled>{stayLine}</Filled>
      </div>

      <div className="memo__row">
        <span className="memo__label">{T.sumOfRupees}</span>
        <Filled>{T.words(receipt.amountReceived)}</Filled>
      </div>

      {/* Ticked boxes rather than a typed word, matching the pad. Only the three
          methods the system actually records — a NEFT box that can never be
          ticked is dead ink.

          An advance handed over part cash, part UPI ticks both, which reads at a
          glance as exactly that. It stays ONE receipt: one number, one total,
          several ways it arrived — splitting it into two would burn two serials
          on a single handover. */}
      <div className="memo__row memo__pay">
        <span className="memo__label">{T.by}</span>
        {PAY_METHODS.map(({ key, label }) => (
          <span key={key} className="memo__tick">
            <span className={`memo__box${paidBy.has(key) ? ' memo__box--on' : ''}`} />
            {T.pay[key] || label}
          </span>
        ))}
        {/* Two ticks say which methods but not how much of each, so a split
            spells it out. Uses the same translated words as the boxes, so
            neither language needs a new string. */}
        {split ? (
          <Filled>{splitSummary}</Filled>
        ) : (
          <>
            <span className="memo__label">{T.txnNo}</span>
            <Filled narrow>{receipt.paymentReference}</Filled>
          </>
        )}
      </div>

      {/* Blank when the receipt is written, exactly as on the pad — the bill it
          settles does not exist yet. Filled in later by hand, or read off the
          final bill, which now cites this receipt number in return. */}
      <div className="memo__row">
        <span className="memo__label">{T.againstBill}</span>
        <Filled narrow>{null}</Filled>
        <span className="memo__label">{T.dated}</span>
        <Filled narrow>{null}</Filled>
      </div>

      {isGst && (
        <div className="memo__row memo__row--fine">
          <span className="memo__label">{T.placeOfSupply}</span>
          <Filled narrow>{supplyPlace}</Filled>
          <span className="memo__label">{T.reverseCharge}</span>
          <Filled narrow>{T.noWord}</Filled>
        </div>
      )}

      {/* What the stay comes to, what this receipt takes off it, and what the
          guest still owes — the three figures the pad leaves the desk to write
          in by hand. The round off is stated with them because the stay total
          above it is the rounded one: without the line the receipt shows a
          total that does not match the nights priced above it, and the guest
          is left to find the difference on the final bill instead.

          Printed only where the receipt names a balance at all. A stay settled
          in full has nothing left to summarise, and the acknowledgement below
          already says so in words. */}
      {stayTotal > 0 && (
        <table className="memo__totals">
          <colgroup>
            <col />
            <col className="memo__col-rs" />
            <col className="memo__col-ps" />
          </colgroup>
          <tbody>
            {roundOff !== 0 && <Money label={T.subTotal} value={round2(stayTotal - roundOff)} />}
            {roundOff !== 0 && <Money label={T.roundOff} value={roundOff} />}
            <Money label={T.stayTotal} value={stayTotal} rule />
            <Money label={T.lessAdvance} value={receipt.amountReceived} />
            <Money label={T.balanceDue} value={receipt.balanceDue} strong rule />
          </tbody>
        </table>
      )}

      {/* The boxed figure, bottom-left on the pad. It is what the eye goes to
          and what a guest photographs, so it is the one number set large. */}
      <div className="memo__amountbox">
        <span className="memo__amountbox-rs">₹</span>
        <span className="memo__amountbox-fig">
          {advanceWhole.toLocaleString('en-IN')}
          {advancePaise ? `.${String(advancePaise).padStart(2, '0')}` : '/-'}
        </span>
      </div>

      <div className="memo__foot">
        <div className="memo__terms">
          <div>{isEvent ? (paidInFull ? T.adjustNoteFullEvent : T.adjustNoteEvent) : paidInFull ? T.adjustNoteFull : T.adjustNote}</div>
          {isGst && <div>{T.notInvoice}</div>}
          <div>{T.jurisdiction(receipt.lodgeCity || 'local')}</div>
          {/* A voided receipt still prints — it is reprinted from the record for
              an audit, not for a guest — and it has to say so on its face, or
              it reads as a live acknowledgement of money the property no longer
              holds. */}
          {isVoid && (
            <div>
              <strong>VOID{receipt.voidReason ? ` — ${receipt.voidReason}` : ''}</strong>
            </div>
          )}
        </div>
        <div className="memo__signs">
          <div className="memo__sign">
            <span className="memo__sign-line" />
            {T.guestSign}
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

export default AdvanceReceiptDocument;
