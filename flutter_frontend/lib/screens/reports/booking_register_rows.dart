import '../../domain/models/report.dart';
import 'report_pdf_style.dart';

/// The booking register's column set and per-row projection, shared between
/// [BookingReportPdf]'s section 3 table and the on-screen data grid in
/// bookings_report_panel.dart — one source of the columns and their values so
/// the phone screen and the downloaded PDF can never quietly disagree.
///
/// Mirrors REGISTER_COLUMNS in frontend/src/pages/lodge/bookingReportFile.js.
class RegisterColumn {
  final String label;
  final bool rightAlign;

  const RegisterColumn(this.label, {this.rightAlign = false});
}

const List<RegisterColumn> kRegisterColumns = [
  RegisterColumn('Bill no.'),
  RegisterColumn('Type'),
  RegisterColumn('Guest'),
  RegisterColumn('Rm'),
  RegisterColumn('Check-in'),
  RegisterColumn('In'),
  RegisterColumn('Check-out'),
  RegisterColumn('Out'),
  RegisterColumn('Nts', rightAlign: true),
  RegisterColumn('Status'),
  RegisterColumn('Discount', rightAlign: true),
  RegisterColumn('Taxable', rightAlign: true),
  RegisterColumn('CGST', rightAlign: true),
  RegisterColumn('SGST', rightAlign: true),
  RegisterColumn('R/off', rightAlign: true),
  RegisterColumn('Billed', rightAlign: true),
  RegisterColumn('Advance', rightAlign: true),
  RegisterColumn('Balance', rightAlign: true),
  RegisterColumn('Paid by'),
];

const Map<String, String> kStatusShort = {
  'BOOKED': 'Booked',
  'CHECKED_IN': 'In house',
  'CHECKED_OUT': 'Departed',
  'CANCELLED': 'Cancelled',
};

const Map<String, String> kDocumentShort = {
  'TAX_INVOICE': 'Tax inv.',
  'BILL_OF_SUPPLY': 'Supply',
  'CASH_RECEIPT': 'Receipt',
};

String paidByLabel(ReportBooking b) {
  final methods = <String>[];
  for (final t in [...b.advanceTenders, ...b.balanceTenders]) {
    final name = paymentModeLabel(t.method);
    if (!methods.contains(name)) methods.add(name);
  }
  return methods.join('+');
}

String paymentModeLabel(String mode) => switch (mode) {
  'CASH' => 'Cash',
  'UPI' => 'UPI',
  'CARD' => 'Card',
  _ => 'Not recorded',
};

/// An actual arrival/departure stamp against the booked date — time alone if
/// it landed on the day the stay was booked for, dated otherwise. Mirrors
/// formatActualStamp() in bookingReportFile.js.
String actualStamp(String? value, String plannedDateIso) {
  if (value == null) return '—';
  final d = DateTime.tryParse(value);
  if (d == null) return '—';
  final local = d.toLocal();
  final time = '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  final onDate =
      '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
  if (onDate == plannedDateIso) return time;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return '${local.day} ${months[local.month - 1]} $time';
}

/// One register row, in [kRegisterColumns] order.
List<String> registerRow(ReportBooking b) {
  final isCancelled = b.status == 'CANCELLED';
  final billed = !isCancelled && b.billedAmount != null;
  String bill(num? v) => billed ? ReportPdfStyle.amount(v) : '—';
  return [
    b.invoiceNumber ?? '—',
    billed ? (kDocumentShort[b.documentType] ?? b.documentType ?? '—') : '—',
    b.guestName ?? '',
    b.roomNumber ?? '',
    ReportPdfStyle.dateOnly(b.checkInDate),
    actualStamp(b.actualCheckInAt, b.checkInDate),
    ReportPdfStyle.dateOnly(b.checkOutDate),
    actualStamp(b.actualCheckOutAt, b.checkOutDate),
    isCancelled ? '—' : '${b.nights}',
    kStatusShort[b.status] ?? b.status,
    bill(b.discountAmount),
    bill(b.taxableValue),
    bill(b.cgstAmount),
    bill(b.sgstAmount),
    bill(b.roundOff),
    bill(b.billedAmount),
    !isCancelled && b.advanceAmount > 0 ? ReportPdfStyle.amount(b.advanceAmount) : '—',
    billed && (b.balanceCollected ?? 0) > 0 ? ReportPdfStyle.amount(b.balanceCollected) : '—',
    isCancelled ? '—' : (paidByLabel(b).isEmpty ? '—' : paidByLabel(b)),
  ];
}

/// Foots the register's own money columns — Nts, Discount, Taxable, CGST,
/// SGST, R/off, Billed, Advance, Balance — in [kRegisterColumns] order, so it
/// can be appended straight to the row list.
List<String> registerTotalsRow(BookingsReportSummary summary, ReportBillTotals bills) => [
  'Total', '', '', '', '', '', '', '',
  '${summary.roomNights}',
  '',
  ReportPdfStyle.amount(bills.discountAmount),
  ReportPdfStyle.amount(bills.taxableValue),
  ReportPdfStyle.amount(bills.cgstAmount),
  ReportPdfStyle.amount(bills.sgstAmount),
  ReportPdfStyle.amount(bills.roundOff),
  ReportPdfStyle.amount(bills.totalAmount),
  ReportPdfStyle.amount(summary.stayAdvance),
  ReportPdfStyle.amount(summary.stayBalance),
  '',
];
