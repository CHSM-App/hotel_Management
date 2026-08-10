import { forwardRef } from 'react';
import { formatPrice } from './priceFormat';
import { amountInWords } from './numberToWords';
import './BillDocument.css';

const DOCUMENT_LABEL = {
  TAX_INVOICE: 'Tax Invoice',
  BILL_OF_SUPPLY: 'Bill of Supply',
  CASH_RECEIPT: 'Cash Receipt',
};

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateWithTime(value, fallbackDateStr) {
  if (value) {
    const d = new Date(value);
    const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${formatDate(value)} at ${time}`;
  }
  return formatDate(fallbackDateStr);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

const BillDocument = forwardRef(function BillDocument({ invoice }, ref) {
  if (!invoice) return null;

  const balanceDue = round2(invoice.totalAmount - invoice.advancePaid - invoice.balanceCollected);
  const isFoodBill = invoice.kind === 'FOOD';

  return (
    <div className="bill-doc" ref={ref}>
      <div className="bill-doc__header">
        <div className="bill-doc__lodge-name">{invoice.lodgeName}</div>
        {(invoice.lodgeAddress || invoice.lodgeCity) && (
          <div className="bill-doc__lodge-address">
            {[invoice.lodgeAddress, invoice.lodgeCity, invoice.lodgeState].filter(Boolean).join(', ')}
          </div>
        )}
        <div className="bill-doc__lodge-contact">
          {invoice.lodgePhone && <span>Mob. {invoice.lodgePhone}</span>}
          {invoice.billingSide === 'GST' && invoice.gstin && <span>GSTIN: {invoice.gstin}</span>}
        </div>
      </div>

      <div className="bill-doc__title">{DOCUMENT_LABEL[invoice.documentType]}</div>

      <div className="bill-doc__meta">
        <div className="bill-doc__row">
          <div>
            <span className="bill-doc__label">No.</span> <strong>{invoice.invoiceNumber}</strong>
          </div>
          <div>
            <span className="bill-doc__label">Date</span> <strong>{formatDate(invoice.createdAt)}</strong>
          </div>
        </div>

        {/* A food bill has no guest register behind it — no name, no room, no
            stay dates. It identifies the table instead, and skips the rest
            rather than printing a row of blanks. */}
        {isFoodBill ? (
          <div className="bill-doc__row">
            <div>
              <span className="bill-doc__label">Table</span>{' '}
              <strong>{invoice.tableLabel || 'Counter / takeaway'}</strong>
            </div>
          </div>
        ) : (
          <>
            <div className="bill-doc__row">
              <div>
                <span className="bill-doc__label">Name</span> <strong>{invoice.guestName}</strong>
              </div>
              <div>
                <span className="bill-doc__label">Mob. No.</span> <strong>{invoice.guestPhone}</strong>
              </div>
            </div>

            <div className="bill-doc__row">
              <div>
                <span className="bill-doc__label">Room No.</span>{' '}
                <strong>{invoice.roomNumber} ({invoice.categoryName})</strong>
              </div>
              <div>
                <span className="bill-doc__label">Persons</span> <strong>{invoice.numGuests}</strong>
              </div>
            </div>

            <div className="bill-doc__row">
              <div>
                <span className="bill-doc__label">From</span>{' '}
                <strong>{formatDateWithTime(invoice.actualCheckInAt, invoice.checkInDate)}</strong>
              </div>
              <div>
                <span className="bill-doc__label">To</span>{' '}
                <strong>{formatDateWithTime(invoice.actualCheckOutAt, invoice.checkOutDate)}</strong>
              </div>
            </div>
          </>
        )}
      </div>

      <table className="bill-doc__table">
        <thead>
          <tr>
            <th>Particulars</th>
            <th className="bill-doc__amt">Amount</th>
          </tr>
        </thead>
        <tbody>
          {/* Accommodation and food are printed as separate blocks, each with
              its own SAC and its own tax lines. They are different supplies at
              different rates, and GSTR-1 reports them apart — a single merged
              "total tax" line would not reconcile. */}
          {invoice.roomSubtotal > 0 && (
            <>
              <tr>
                <td>Room charges{invoice.billingSide === 'GST' ? ' (SAC 996311)' : ''}</td>
                <td className="bill-doc__amt">{formatPrice(invoice.roomSubtotal)}</td>
              </tr>
              {invoice.cgstAmount > 0 && (
                <tr>
                  <td>CGST ({invoice.cgstRatePercent}%)</td>
                  <td className="bill-doc__amt">{formatPrice(invoice.cgstAmount)}</td>
                </tr>
              )}
              {invoice.sgstAmount > 0 && (
                <tr>
                  <td>SGST ({invoice.sgstRatePercent}%)</td>
                  <td className="bill-doc__amt">{formatPrice(invoice.sgstAmount)}</td>
                </tr>
              )}
            </>
          )}

          {invoice.foodSubtotal > 0 && (
            <>
              <tr>
                <td colSpan={2} className="bill-doc__section">
                  Food{invoice.billingSide === 'GST' ? ' (SAC 996331)' : ''}
                </td>
              </tr>

              {/* Itemised: a customer checking a restaurant bill wants to see
                  what they ate, not a single total. Names and prices come from
                  the snapshot taken on each order line, so this shows what was
                  actually charged even if the menu has since been re-priced. */}
              {invoice.foodItems?.map((item, index) => (
                <tr key={`${item.name}-${item.unitPrice}-${index}`}>
                  <td className="bill-doc__item">
                    {item.name}
                    <span className="bill-doc__item-qty">
                      {item.quantity} × {formatPrice(item.unitPrice)}
                    </span>
                  </td>
                  <td className="bill-doc__amt">{formatPrice(item.lineTotal)}</td>
                </tr>
              ))}

              <tr>
                <td>{invoice.foodItems?.length ? 'Food total' : 'Food'}</td>
                <td className="bill-doc__amt">{formatPrice(invoice.foodSubtotal)}</td>
              </tr>
              {invoice.foodCgstAmount > 0 && (
                <tr>
                  <td>CGST ({invoice.foodCgstRatePercent}%)</td>
                  <td className="bill-doc__amt">{formatPrice(invoice.foodCgstAmount)}</td>
                </tr>
              )}
              {invoice.foodSgstAmount > 0 && (
                <tr>
                  <td>SGST ({invoice.foodSgstRatePercent}%)</td>
                  <td className="bill-doc__amt">{formatPrice(invoice.foodSgstAmount)}</td>
                </tr>
              )}
            </>
          )}

          {invoice.roundOff !== 0 && (
            <tr>
              <td>Round off</td>
              <td className="bill-doc__amt">{formatPrice(invoice.roundOff)}</td>
            </tr>
          )}
          <tr className="bill-doc__total-row">
            <td>Grand Total</td>
            <td className="bill-doc__amt">{formatPrice(invoice.totalAmount)}</td>
          </tr>
          {invoice.advancePaid > 0 && (
            <tr>
              <td>Less: Advance paid</td>
              <td className="bill-doc__amt">-{formatPrice(invoice.advancePaid)}</td>
            </tr>
          )}
          {invoice.balanceCollected > 0 && (
            <tr>
              <td>
                Less: Balance collected
                {invoice.balancePaymentMethod ? ` (${invoice.balancePaymentMethod})` : ''}
              </td>
              <td className="bill-doc__amt">-{formatPrice(invoice.balanceCollected)}</td>
            </tr>
          )}
          <tr className="bill-doc__total-row">
            <td>{balanceDue > 0 ? 'Balance Due' : 'Net Payment'}</td>
            <td className="bill-doc__amt">
              {balanceDue > 0 ? formatPrice(balanceDue) : 'Paid in full'}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="bill-doc__words">In words: {amountInWords(invoice.totalAmount)}</div>

      <div className="bill-doc__declaration">
        Declaration: We declare that this bill shows the actual price of the services described and that all
        particulars are true and correct.
      </div>

      <div className="bill-doc__sign">
        <div>{isFoodBill ? 'Customer’s Signature' : 'Guest’s Signature'}</div>
        <div>For {invoice.lodgeName}</div>
      </div>

      <div className="bill-doc__thanks">
        {isFoodBill ? 'Thank you — please visit again!' : 'Thank you for staying with us!'}
      </div>
    </div>
  );
});

export default BillDocument;
