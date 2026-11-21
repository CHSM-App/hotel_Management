import 'booking.dart';
import 'json.dart';

DateTime? _day(dynamic v) {
  final s = asStringOrNull(v);
  if (s == null || s.length < 10) return null;
  return DateTime.tryParse(s.substring(0, 10));
}

/// The dates a billed stay may be moved within, from
/// GET /bookings/:id/edit-window. Null bound = open on that side.
class InvoiceEditWindow {
  final int invoiceId;
  final String invoiceNumber;
  final String? prevNumber;
  final String? nextNumber;
  final DateTime? minDate;
  final DateTime? maxDate;

  const InvoiceEditWindow({
    required this.invoiceId,
    required this.invoiceNumber,
    this.prevNumber,
    this.nextNumber,
    this.minDate,
    this.maxDate,
  });

  bool get isOpen => minDate == null && maxDate == null;

  /// Null when the booking has no issued invoice.
  static InvoiceEditWindow? fromResponse(Map<String, dynamic> json) {
    final w = json['window'];
    if (w is! Map<String, dynamic>) return null;
    return InvoiceEditWindow(
      invoiceId: asInt(w['invoiceId']),
      invoiceNumber: w['invoiceNumber']?.toString() ?? '',
      prevNumber: asStringOrNull(w['prevNumber']),
      nextNumber: asStringOrNull(w['nextNumber']),
      minDate: _day(w['minDate']),
      maxDate: _day(w['maxDate']),
    );
  }
}

/// Earliest day a past booking may end, from GET /bookings/past-window.
class PastWindow {
  final String billingSide;
  final String? lastNumber;
  final DateTime? lastStayEnd;
  final DateTime? minDate;

  const PastWindow({
    required this.billingSide,
    this.lastNumber,
    this.lastStayEnd,
    this.minDate,
  });

  factory PastWindow.fromResponse(Map<String, dynamic> json) {
    final w = (json['window'] as Map<String, dynamic>?) ?? const {};
    return PastWindow(
      billingSide: w['billingSide']?.toString() ?? 'NON_GST',
      lastNumber: asStringOrNull(w['lastNumber']),
      lastStayEnd: _day(w['lastStayEnd']),
      minDate: _day(w['minDate']),
    );
  }
}

/// PATCH /bookings/:id answer — `extra`/`refund` are 0 unless the invoice
/// was restated.
class BookingRevision {
  final Booking booking;
  final num extra;
  final num refund;

  const BookingRevision(this.booking, {this.extra = 0, this.refund = 0});

  factory BookingRevision.fromJson(Map<String, dynamic> json) {
    final rev = json['invoiceRevision'];
    return BookingRevision(
      Booking.fromJson(json['booking'] as Map<String, dynamic>),
      extra: rev is Map ? asNum(rev['extra']) : 0,
      refund: rev is Map ? asNum(rev['refund']) : 0,
    );
  }
}
