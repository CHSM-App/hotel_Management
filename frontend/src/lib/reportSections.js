// The four sidebar sections under Reports & Analytics, and the tabs each holds.
// A section shows only the tabs the property and the login can use, and no tab
// strip at all when just one is left.
export const REPORT_SECTIONS = {
  overview: ['overview'],
  sales: ['bookings', 'events', 'food', 'services'],
  finance: ['bills', 'profitLoss', 'expenses', 'income', 'gst'],
  assets: ['assets'],
};

export const reportSectionOf = (tab) =>
  Object.keys(REPORT_SECTIONS).find((k) => REPORT_SECTIONS[k].includes(tab)) || 'overview';
