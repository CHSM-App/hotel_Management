// What each guest WhatsApp message looks like, filled with demo details so an
// owner can see it without sending anything. Wording mirrors the approved
// templates documented beside each notifier in backend/src/modules/notifications
// (and billShare / receiptShare); the numbers are the template's {{n}} slots.
// If a template is re-approved with new wording, update it here too.
const TEMPLATES = {
  waAutoBooking: {
    label: 'Booking confirmation',
    body:
      'Dear {{1}}, Thank you for choosing us! Your booking for {{2}} is confirmed.\n\n' +
      'Room No: {{3}}\nCheck-in: {{4}}\nCheck-out: {{5}}\n' +
      'Advance Paid: ₹{{6}}\nBalance Due: ₹{{7}}\n\n{{8}}\nDirections: {{9}}\nContact: {{10}}',
  },
  waAutoWalkin: {
    label: 'Walk-in welcome',
    body:
      'Hi {{1}}, welcome to {{2}}! Your room {{3}} is all ready for you.\n\n' +
      'Check-in: {{4}}\nCheck-out: {{5}}\nAdvance Paid: ₹{{6}}\nBalance Due: ₹{{7}}\n\n' +
      '{{8}}\nNeed anything at all, just call us at {{9}}.',
  },
  waAutoCancel: {
    label: 'Booking cancelled',
    body:
      'Dear {{1}}, {{2}}, Your booking has been cancelled as per your request.\n\n' +
      'Booking Details:\nRoom No: {{3}}\nCheck-in: {{4}}\nCheck-out: {{5}}\n{{6}}\n{{7}}\n\n' +
      'Your refund will be processed within a few business days. If you did not request this ' +
      'cancellation, please contact us immediately. We hope to welcome you another time.',
  },
  waAutoBill: {
    label: 'Bill link',
    body:
      'Dear {{1}}, {{2}}, Thank you for staying with us! Your bill for Booking No. {{3}} is ready.\n\n' +
      'Total Amount: {{4}}\nStay: {{5}} to {{6}}\n\nView / Download Bill: {{7}}',
  },
  waAutoReceipt: {
    label: 'Advance receipt',
    body:
      "Dear {{1}}, Thank you for choosing {{2}}! We've received your advance payment.\n\n" +
      'Receipt No: {{3}}\nAmount: ₹{{4}}\nPaid via: {{5}}\n\nView / Download Receipt: {{6}}\n\n' +
      'Thank you for choosing us!',
  },
};

// Demo guest and stay, shared by every message so the five previews read as one
// story. Hotel name and contact come from the property itself.
export function demoValues(lodge) {
  const hotel = lodge?.name || 'Your Hotel';
  const contact = lodge?.phone || lodge?.whatsappNumber || '+91 98765 43210';
  const link = 'https://your-hotel.example/public/…';
  return {
    waAutoBooking: [
      'Rahul Patil', hotel, '204', '23 Nov 2026 12:00 PM', '25 Nov 2026 11:00 AM',
      '2000.00', '3500.00', `Download your advance receipt here: ${link}`, 'Open in Maps', contact,
    ],
    waAutoWalkin: [
      'Rahul Patil', hotel, '204', '23 Nov 2026 12:15 PM', '25 Nov 2026 12:15 PM',
      '2000.00', '3500.00', `Download your advance receipt here: ${link}`, contact,
    ],
    waAutoCancel: [
      'Rahul Patil', hotel, '204', '23 Nov 2026', '25 Nov 2026',
      '*Reason:* Change of plans', 'Refund: Rs 2000.00 via UPI',
    ],
    waAutoBill: ['Rahul Patil', hotel, 'BK-0042', 'Rs 5500.00', '23 Nov 2026', '25 Nov 2026', link],
    waAutoReceipt: ['Rahul Patil', hotel, 'AR-0017', '2000.00', 'UPI', link],
  };
}

// The message text for one key, with the demo values dropped in.
export function previewText(key, lodge) {
  const t = TEMPLATES[key];
  const values = demoValues(lodge)[key];
  if (!t || !values) return '';
  return t.body.replace(/\{\{(\d+)\}\}/g, (_, n) => values[Number(n) - 1] ?? '');
}

export function previewLabel(key) {
  return TEMPLATES[key]?.label || '';
}
