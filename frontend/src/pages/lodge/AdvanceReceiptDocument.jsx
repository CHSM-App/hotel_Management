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
  gstin: 'GSTIN No.',
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
  towards: 'Towards advance against the stay described below',
  paidBy: 'Paid by',
  placeOfSupply: 'Place of Supply',
  reverseCharge: 'Reverse Charge',
  noWord: 'No',
  advanceReceived: 'ADVANCE RECEIVED',
  taxableValue: 'Taxable Value',
  stayTotal: 'Stay Total',
  lessAdvance: 'Less: Advance Received',
  balanceDue: 'BALANCE DUE',
  inwords: '(Inwords Rupees',
  words: amountInWords,
  jurisdiction: (city) => `Subject to ${city} Jurisdiction.`,
  // What makes the paper worth keeping: it is the guest's proof at the desk on
  // arrival, and the line that tells them so.
  adjustNote:
    'This advance is adjusted against the final bill for the stay named above. Please present this receipt at check-in.',
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
    // Standard GST Marathi terms, matching how BillDocument handles its own
    // masthead: Devanagari head, English body.
    doc: { RECEIPT_VOUCHER: 'पावती व्हाउचर', ADVANCE_RECEIPT: 'आगाऊ रक्कम पावती' },
    mob: 'मो.',
    gstin: 'जीएसटीआयएन क्र.',
  },
};

const SAC_ACCOMMODATION = '996311';

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

// One row of the money column, ruling rupees and paise apart so the paise land
// under each other however wide the rupees run. Declared outside the component
// for the same reason BillDocument's twin is: a component defined in a render
// body is a new type every render, and React remounts the column each time.
function Money({ label, value, strong, rule }) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
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

function nightsOf(receipt) {
  if (!receipt.checkInDate || !receipt.checkOutDate) return null;
  const from = new Date(`${receipt.checkInDate}T00:00:00Z`);
  const to = new Date(`${receipt.checkOutDate}T00:00:00Z`);
  const n = Math.round((to - from) / 86400000);
  return n > 0 ? n : 1;
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

  const supplyPlace = isGst ? placeOfSupply(receipt) : null;
  // Only where tax was actually taken. A nil-rated stay has a rate of 0 and
  // prints no tax lines rather than two rows of zeroes.
  const hasTax = receipt.cgstAmount > 0 || receipt.sgstAmount > 0;

  const advanceWhole = Math.floor(Math.round(receipt.amountReceived * 100) / 100);
  const advancePaise = Math.round(receipt.amountReceived * 100) % 100;

  // The trail the guest's own statement carries, stated beside the method so a
  // payment queried months later is answerable. Cash has none and prints none.
  const paymentLine = [receipt.paymentMethod, receipt.paymentReference].filter(Boolean).join(' · ');

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
      {isGst && receipt.gstin && (
        <div className="memo__gstin">
          {T.gstin} {receipt.gstin}
        </div>
      )}

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

      <div className="memo__row memo__row--split">
        <span className="memo__label">{T.roomNo}</span>
        <Filled narrow>
          {receipt.roomNumber
            ? `${receipt.roomNumber}${receipt.categoryName ? ` (${receipt.categoryName})` : ''}`
            : null}
        </Filled>
        <span className="memo__label">{T.persons}</span>
        <Filled narrow>{receipt.numGuests}</Filled>
      </div>

      {/* The body. Same two-column shape as the bill — what it is for on the
          left, what it came to on the right — but the left states the stay the
          money is against rather than itemising charges. Nothing has been
          supplied yet, so there is nothing to itemise. */}
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
              <div className="memo__stay-line">
                <span className="memo__label">{T.towards}</span>
              </div>
              <div className="memo__stay-line">
                <span className="memo__label">{T.forStay}</span>
                <Filled narrow>{nights}</Filled>
                <span className="memo__label">{T.days}</span>
              </div>
              <div className="memo__stay-line">
                <span className="memo__label">{T.from}</span>
                <Filled narrow>{formatDate(receipt.checkInDate)}</Filled>
                <span className="memo__label">{T.to}</span>
                <Filled narrow>{formatDate(receipt.checkOutDate)}</Filled>
              </div>
              <div className="memo__stay-line">
                <span className="memo__label">{T.paidBy}</span>
                <Filled narrow>{paymentLine}</Filled>
              </div>
              {/* Both required on a taxable document, and both constant for this
                  business — but a document that omits them is defective whether
                  or not the answer was ever in doubt. */}
              {supplyPlace && (
                <div className="memo__stay-line memo__stay-line--fine">
                  <span className="memo__label">{T.placeOfSupply}</span>
                  <Filled narrow>{supplyPlace}</Filled>
                  <span className="memo__label">{T.reverseCharge}</span>
                  <Filled narrow>{T.noWord}</Filled>
                </div>
              )}
              {isGst && (
                <div className="memo__stay-line memo__stay-line--fine">
                  <span className="memo__label">SAC</span>
                  <Filled narrow>{SAC_ACCOMMODATION}</Filled>
                </div>
              )}
            </td>
            <td className="memo__rs memo__rs--lead">{advanceWhole.toLocaleString('en-IN')}</td>
            <td className="memo__ps memo__ps--lead">{String(advancePaise).padStart(2, '0')}</td>
          </tr>
        </tbody>
      </table>

      {/* The money column. Prices here are GST-inclusive, so the tax lines are
          the tax already sitting inside the advance rather than anything added
          to it: taxable value + CGST + SGST = the advance received, and the
          column adds up on the page exactly as the bill's does. */}
      <table className="memo__totals">
        <colgroup>
          <col />
          <col className="memo__col-rs" />
          <col className="memo__col-ps" />
        </colgroup>
        <tbody>
          {hasTax && <Money label={T.taxableValue} value={receipt.taxableValue} rule />}
          {receipt.cgstAmount > 0 && (
            <Money label={`CGST ${receipt.cgstRatePercent} %`} value={receipt.cgstAmount} />
          )}
          {receipt.sgstAmount > 0 && (
            <Money label={`SGST ${receipt.sgstRatePercent} %`} value={receipt.sgstAmount} />
          )}
          <Money label={T.advanceReceived} value={receipt.amountReceived} strong rule />
          {/* What the receipt is really for, from the guest's side: how much of
              the stay is now covered, and what is still to come. Stated as it
              stood when the receipt was written — the stay can be extended
              later, and this paper must not silently restate itself. */}
          <Money label={T.stayTotal} value={receipt.stayTotal} />
          <Money label={T.lessAdvance} value={-receipt.amountReceived} />
          <Money label={T.balanceDue} value={receipt.balanceDue} strong rule />
        </tbody>
      </table>

      <div className="memo__row memo__row--words">
        <span className="memo__label">{T.inwords}</span>
        <Filled>{T.words(receipt.amountReceived)}</Filled>
        <span className="memo__label">)</span>
      </div>

      <div className="memo__foot">
        <div className="memo__terms">
          <div>{T.adjustNote}</div>
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
