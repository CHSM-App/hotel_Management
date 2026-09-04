// Renders the booking report PDF from a synthetic payload so the layout can be
// checked without a database: page count, no exceptions, and that the widest
// string in every register column actually fits it.
//
//   node scripts/renderReportSample.mjs [out.pdf]
import { writeFileSync } from 'node:fs';
import { buildBookingReportPdf } from '../src/pages/lodge/bookingReportFile.js';

const stay = (over) => ({
  id: 1,
  guestName: 'Ramchandra Vishwanath Deshpande-Kulkarni',
  guestPhone: '9876543210',
  numGuests: 2,
  roomNumber: '101',
  categoryName: 'Deluxe',
  checkInDate: '2026-08-03',
  checkOutDate: '2026-08-05',
  nights: 2,
  status: 'CHECKED_OUT',
  actualCheckInAt: '2026-08-03T14:05:00+05:30',
  actualCheckOutAt: '2026-08-06T01:15:00+05:30',
  totalPrice: 5000,
  advanceAmount: 2000,
  advancePaymentMethod: 'CASH',
  advanceTenders: [{ method: 'CASH', amount: 1000 }, { method: 'UPI', amount: 1000 }],
  invoiceNumber: '123456',
  documentType: 'TAX_INVOICE',
  billingSide: 'GST',
  invoiceDate: '2026-08-06T01:20:00+05:30',
  grossAmount: 6200,
  roomGross: 5000,
  foodGross: 1200,
  discountAmount: 500,
  netAmount: 5700,
  lateCheckoutCharge: 0,
  roomTaxable: 4104.25,
  foodTaxable: 1050.69,
  taxableValue: 5154.94,
  roomCgst: 246.26,
  roomSgst: 246.26,
  foodCgst: 26.27,
  foodSgst: 26.27,
  cgstAmount: 272.53,
  sgstAmount: 272.53,
  totalTax: 545.06,
  roundOff: 0,
  billedAmount: 5700,
  advancePaid: 2000,
  balanceCollected: 3700,
  balancePaymentMethod: 'CARD',
  balanceTenders: [{ method: 'CARD', amount: 3700 }],
  balanceDue: 0,
  ...over,
});





const bookings = [
  stay({ id: 1 }),
  stay({ id: 2, status: 'BOOKED', invoiceNumber: null, documentType: null, actualCheckInAt: null, actualCheckOutAt: null, billedAmount: null, taxableValue: null, cgstAmount: null, sgstAmount: null, roundOff: null, discountAmount: null, advancePaid: null, balanceCollected: null, balanceTenders: [], balanceDue: null, guestName: 'Asha' }),
  stay({ id: 3, status: 'CANCELLED', invoiceNumber: null, documentType: null, billedAmount: null, guestName: 'Cancelled Guest', refundAmount: 1500, cancellationCharge: 500, cancelReason: 'Guest called off the trip' }),
  ...Array.from({ length: 60 }, (_, i) => stay({ id: 10 + i, roomNumber: String(102 + (i % 8)), billedAmount: 123456.78, taxableValue: 110229.27, cgstAmount: 6613.76, sgstAmount: 6613.75, roundOff: -0.22, discountAmount: 12345.67, advanceAmount: 100000, balanceCollected: 23456.78 })),
];

const bills = {
  count: 61,
  grossAmount: 7532345.67,
  discountAmount: 741240.2,
  netAmount: 6791105.47,
  roomTaxable: 6000000,
  foodTaxable: 118000,
  taxableValue: 6118000,
  roomCgst: 300000,
  roomSgst: 300000,
  foodCgst: 5000,
  foodSgst: 5000,
  cgstAmount: 305000,
  sgstAmount: 305000,
  totalTax: 610000,
  roundOff: -13.2,
  totalAmount: 7412700,
};

const report = {
  fromDate: '2026-08-01',
  toDate: '2026-08-31',
  billingSide: 'ALL',
  generatedAt: '2026-08-27T10:00:00+05:30',
  lodgeName: 'Sagar Darshan Lodge & Restaurant, Vengurla',
  servesFood: true,
  gstin: '27ABCDE1234F1Z5',
  summary: {
    totalBookings: bookings.length,
    activeBookings: bookings.length - 1,
    roomNights: 124,
    bookedValue: 7500000,
    unbilledCount: 1,
    unbilledValue: 5000,
    billedAmount: bills.totalAmount,
    billedCount: bills.count,
    stayAdvance: 6002000,
    stayBalance: 1410700,
    stayBalanceDue: 0,
    stayTotal: 7412700,
    cancelled: { count: 1, bookedValue: 5000, advanceHeld: 2000, refunded: 1500, chargesKept: 500 },
    advanceCollected: 6100000,
    balanceCollected: 1500000,
    cancellationChargesKept: 500,
    totalCollected: 7600500,
    byStatus: { BOOKED: 1, CHECKED_IN: 0, CHECKED_OUT: 61, CANCELLED: 1 },
    byPaymentMode: {
      CASH: { advance: 3000000, balance: 700000, total: 3700000 },
      UPI: { advance: 3000000, balance: 700000, total: 3700000 },
      CARD: { advance: 100000, balance: 100000, total: 200000 },
      UNRECORDED: { advance: 0, balance: 0, total: 0 },
    },
    collections: {
      byStayPeriod: {
        EARLIER: { advance: 0, balance: 400000, total: 400000, count: 3 },
        THIS: { advance: 5900000, balance: 1100000, total: 7000000, count: 61 },
        LATER: { advance: 200000, balance: 0, total: 200000, count: 4 },
      },
    },
    bills,
    byDocumentType: {
      TAX_INVOICE: { ...bills, count: 50 },
      BILL_OF_SUPPLY: { ...bills, count: 6, cgstAmount: 0, sgstAmount: 0, totalTax: 0 },
      CASH_RECEIPT: { ...bills, count: 5, cgstAmount: 0, sgstAmount: 0, totalTax: 0 },
    },
  },
  bookings,
};

const blob = await buildBookingReportPdf(report);
const out = process.argv[2] || 'booking-report-sample.pdf';
writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
console.log(`wrote ${out} (${blob.size} bytes)`);
