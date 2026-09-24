// Shared across ExpensesPanel and AssetsPanel — every place in this app that
// logs how a bill was paid uses this one vocabulary, so a cheque reads the
// same way whether it settled a vendor invoice from the Expenses tab or an
// asset's purchase cost from the Assets tab.

export const PAYMENT_METHOD_LABEL = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  CHEQUE: 'Cheque',
  BANK_TRANSFER: 'Bank transfer',
  WALLET: 'Wallet',
  OTHER: 'Other',
};

// Same order everywhere — every "Paid via" <select> maps this instead of
// repeating seven <option> tags by hand.
export const PAYMENT_METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABEL);

// Same inv-tag palette every payment-method chip in this app already uses;
// the newer methods reuse tones rather than inventing more (a "reference
// exists" method is neutral gray until it's worth its own state colour).
export const PAYMENT_METHOD_TAG_CLASS = {
  CASH: 'inv-tag--good',
  UPI: 'inv-tag--info',
  CARD: 'inv-tag--low',
  CHEQUE: 'inv-tag--off',
  BANK_TRANSFER: 'inv-tag--off',
  WALLET: 'inv-tag--off',
  OTHER: 'inv-tag--off',
};

// What the reference-number field is called for a given method — a cheque's
// reference is its number, a transfer's is its UTR, and so on. Cash has none
// (omitted; callers hide the field when this map has no entry).
export const PAYMENT_REFERENCE_LABEL = {
  UPI: 'Transaction / UTR number',
  CARD: 'Last 4 digits / transaction ID',
  CHEQUE: 'Cheque number',
  BANK_TRANSFER: 'UTR / transaction number',
  WALLET: 'Transaction ID',
  OTHER: 'Reference number',
};
