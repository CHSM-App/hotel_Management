import 'json.dart';

/// One payment method's slice of a totals figure — "Cash 2,000", "UPI 3,000".
class TenderLine {
  final String method;
  final num amount;

  const TenderLine({required this.method, required this.amount});

  factory TenderLine.fromJson(Map<String, dynamic> json) => TenderLine(
    method: json['method']?.toString() ?? '',
    amount: asNum(json['amount']),
  );
}

/// One row of the booking register — GET /reports/bookings.
class ReportBooking {
  final int id;
  final String? guestName;
  final String? guestPhone;
  final String? roomNumber;
  final String? categoryName;
  final String checkInDate;
  final String checkOutDate;
  final int nights;
  final String status;
  final String? actualCheckInAt;
  final String? actualCheckOutAt;
  final num totalPrice;
  final num advanceAmount;
  final List<TenderLine> advanceTenders;
  final String? invoiceNumber;
  final String? documentType;
  final num? discountAmount;
  final num? taxableValue;
  final num? cgstAmount;
  final num? sgstAmount;
  final num? roundOff;
  final num? billedAmount;
  final num? balanceCollected;
  final List<TenderLine> balanceTenders;

  const ReportBooking({
    required this.id,
    this.guestName,
    this.guestPhone,
    this.roomNumber,
    this.categoryName,
    required this.checkInDate,
    required this.checkOutDate,
    this.nights = 0,
    required this.status,
    this.actualCheckInAt,
    this.actualCheckOutAt,
    this.totalPrice = 0,
    this.advanceAmount = 0,
    this.advanceTenders = const [],
    this.invoiceNumber,
    this.documentType,
    this.discountAmount,
    this.taxableValue,
    this.cgstAmount,
    this.sgstAmount,
    this.roundOff,
    this.billedAmount,
    this.balanceCollected,
    this.balanceTenders = const [],
  });

  factory ReportBooking.fromJson(Map<String, dynamic> json) => ReportBooking(
    id: asInt(json['id']),
    guestName: asStringOrNull(json['guestName']),
    guestPhone: asStringOrNull(json['guestPhone']),
    roomNumber: asStringOrNull(json['roomNumber']),
    categoryName: asStringOrNull(json['categoryName']),
    checkInDate: json['checkInDate']?.toString() ?? '',
    checkOutDate: json['checkOutDate']?.toString() ?? '',
    nights: asInt(json['nights']),
    status: json['status']?.toString() ?? '',
    actualCheckInAt: asStringOrNull(json['actualCheckInAt']),
    actualCheckOutAt: asStringOrNull(json['actualCheckOutAt']),
    totalPrice: asNum(json['totalPrice']),
    advanceAmount: asNum(json['advanceAmount']),
    advanceTenders:
        (json['advanceTenders'] as List?)
            ?.map((e) => TenderLine.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    invoiceNumber: asStringOrNull(json['invoiceNumber']),
    documentType: asStringOrNull(json['documentType']),
    discountAmount: asNumOrNull(json['discountAmount']),
    taxableValue: asNumOrNull(json['taxableValue']),
    cgstAmount: asNumOrNull(json['cgstAmount']),
    sgstAmount: asNumOrNull(json['sgstAmount']),
    roundOff: asNumOrNull(json['roundOff']),
    billedAmount: asNumOrNull(json['billedAmount']),
    balanceCollected: asNumOrNull(json['balanceCollected']),
    balanceTenders:
        (json['balanceTenders'] as List?)
            ?.map((e) => TenderLine.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
  );

  bool get isBilled => billedAmount != null;
}

/// The register's own summary block, over the same period as its rows.
class BookingsReportSummary {
  final int totalBookings;
  final int roomNights;
  final num billedAmount;
  final num cancellationChargesKept;
  final Map<String, int> byStatus;

  const BookingsReportSummary({
    this.totalBookings = 0,
    this.roomNights = 0,
    this.billedAmount = 0,
    this.cancellationChargesKept = 0,
    this.byStatus = const {},
  });

  factory BookingsReportSummary.fromJson(Map<String, dynamic> json) {
    final byStatusJson = json['byStatus'] as Map<String, dynamic>? ?? {};
    return BookingsReportSummary(
      totalBookings: asInt(json['totalBookings']),
      roomNights: asInt(json['roomNights']),
      billedAmount: asNum(json['billedAmount']),
      cancellationChargesKept: asNum(json['cancellationChargesKept']),
      byStatus: byStatusJson.map((k, v) => MapEntry(k, asInt(v))),
    );
  }

  int statusCount(String status) => byStatus[status] ?? 0;
}

/// GET /reports/bookings.
class BookingsReport {
  final String fromDate;
  final String toDate;
  final BookingsReportSummary summary;
  final List<ReportBooking> bookings;

  const BookingsReport({
    required this.fromDate,
    required this.toDate,
    required this.summary,
    this.bookings = const [],
  });

  factory BookingsReport.fromJson(Map<String, dynamic> json) => BookingsReport(
    fromDate: json['fromDate']?.toString() ?? '',
    toDate: json['toDate']?.toString() ?? '',
    summary: BookingsReportSummary.fromJson(
      json['summary'] as Map<String, dynamic>? ?? const {},
    ),
    bookings:
        (json['bookings'] as List?)
            ?.map((e) => ReportBooking.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
  );
}

/// One day's occupancy — a row of the occupancy report.
class OccupancyDay {
  final String date;
  final int occupiedRooms;
  final int totalRooms;
  final num occupancyPercent;

  const OccupancyDay({
    required this.date,
    this.occupiedRooms = 0,
    this.totalRooms = 0,
    this.occupancyPercent = 0,
  });

  factory OccupancyDay.fromJson(Map<String, dynamic> json) => OccupancyDay(
    date: json['date']?.toString() ?? '',
    occupiedRooms: asInt(json['occupiedRooms']),
    totalRooms: asInt(json['totalRooms']),
    occupancyPercent: asNum(json['occupancyPercent']),
  );
}

/// GET /reports/occupancy.
class OccupancyReport {
  final String fromDate;
  final String toDate;
  final int totalRooms;
  final List<OccupancyDay> days;
  final int occupiedRoomNights;
  final int totalRoomNights;
  final num occupancyPercent;

  const OccupancyReport({
    required this.fromDate,
    required this.toDate,
    this.totalRooms = 0,
    this.days = const [],
    this.occupiedRoomNights = 0,
    this.totalRoomNights = 0,
    this.occupancyPercent = 0,
  });

  factory OccupancyReport.fromJson(Map<String, dynamic> json) {
    final summary = json['summary'] as Map<String, dynamic>? ?? const {};
    return OccupancyReport(
      fromDate: json['fromDate']?.toString() ?? '',
      toDate: json['toDate']?.toString() ?? '',
      totalRooms: asInt(json['totalRooms']),
      days:
          (json['days'] as List?)
              ?.map((e) => OccupancyDay.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
      occupiedRoomNights: asInt(summary['occupiedRoomNights']),
      totalRoomNights: asInt(summary['totalRoomNights']),
      occupancyPercent: asNum(summary['occupancyPercent']),
    );
  }
}

/// One document type's footed totals within the GST summary.
class GstDocumentTotals {
  final int count;
  final num roomSubtotal;
  final num cgstAmount;
  final num sgstAmount;
  final num totalAmount;

  const GstDocumentTotals({
    this.count = 0,
    this.roomSubtotal = 0,
    this.cgstAmount = 0,
    this.sgstAmount = 0,
    this.totalAmount = 0,
  });

  factory GstDocumentTotals.fromJson(Map<String, dynamic> json) =>
      GstDocumentTotals(
        count: asInt(json['count']),
        roomSubtotal: asNum(json['roomSubtotal']),
        cgstAmount: asNum(json['cgstAmount']),
        sgstAmount: asNum(json['sgstAmount']),
        totalAmount: asNum(json['totalAmount']),
      );
}

/// One issued bill, as listed in the GST summary.
class GstInvoiceRow {
  final int id;
  final String? invoiceNumber;
  final String? documentType;
  final String? guestName;
  final num cgstAmount;
  final num sgstAmount;
  final num totalAmount;
  final String? createdAt;

  const GstInvoiceRow({
    required this.id,
    this.invoiceNumber,
    this.documentType,
    this.guestName,
    this.cgstAmount = 0,
    this.sgstAmount = 0,
    this.totalAmount = 0,
    this.createdAt,
  });

  factory GstInvoiceRow.fromJson(Map<String, dynamic> json) => GstInvoiceRow(
    id: asInt(json['id']),
    invoiceNumber: asStringOrNull(json['invoiceNumber']),
    documentType: asStringOrNull(json['documentType']),
    guestName: asStringOrNull(json['guestName']),
    cgstAmount: asNum(json['cgstAmount']),
    sgstAmount: asNum(json['sgstAmount']),
    totalAmount: asNum(json['totalAmount']),
    createdAt: asStringOrNull(json['createdAt']),
  );
}

/// GET /reports/gst-summary.
class GstSummaryReport {
  final String fromDate;
  final String toDate;
  final GstDocumentTotals totals;
  final Map<String, GstDocumentTotals> byDocumentType;
  final List<GstInvoiceRow> invoices;

  const GstSummaryReport({
    required this.fromDate,
    required this.toDate,
    required this.totals,
    this.byDocumentType = const {},
    this.invoices = const [],
  });

  factory GstSummaryReport.fromJson(Map<String, dynamic> json) {
    final byDocJson = json['byDocumentType'] as Map<String, dynamic>? ?? {};
    return GstSummaryReport(
      fromDate: json['fromDate']?.toString() ?? '',
      toDate: json['toDate']?.toString() ?? '',
      totals: GstDocumentTotals.fromJson(
        json['totals'] as Map<String, dynamic>? ?? const {},
      ),
      byDocumentType: byDocJson.map(
        (k, v) => MapEntry(k, GstDocumentTotals.fromJson(v as Map<String, dynamic>)),
      ),
      invoices:
          (json['invoices'] as List?)
              ?.map((e) => GstInvoiceRow.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
    );
  }
}

/// Labels shared with the web dashboard's ReportsPanel.
const kBookingStatusLabel = <String, String>{
  'BOOKED': 'Booked',
  'CHECKED_IN': 'Checked in',
  'CHECKED_OUT': 'Checked out',
  'CANCELLED': 'Cancelled',
};

const kDocumentTypeLabel = <String, String>{
  'TAX_INVOICE': 'Tax invoice',
  'BILL_OF_SUPPLY': 'Bill of supply',
  'CASH_RECEIPT': 'Cash receipt',
};

/// "Cash 2,000 + UPI 3,000" — mirrors bookingReportFile.js's tendersLabel.
String tendersLabel(List<TenderLine> tenders, String Function(num?) formatPrice) {
  if (tenders.isEmpty) return '';
  return tenders.map((t) => '${_methodLabel(t.method)} ${formatPrice(t.amount)}').join(' + ');
}

String _methodLabel(String method) {
  switch (method) {
    case 'CASH':
      return 'Cash';
    case 'UPI':
      return 'UPI';
    case 'CARD':
      return 'Card';
    default:
      return 'Unrecorded';
  }
}
