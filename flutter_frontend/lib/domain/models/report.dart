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

  // Added for the PDF register/Excel parity with bookingReportFile.js — the
  // bill's own figures the server already sends but the app previously
  // dropped. Null on an unbilled stay, same as the fields above.
  final int? numGuests;
  final String? invoiceDate;
  final num? grossAmount;
  final num? netAmount;
  final num? roomTaxable;
  final num? foodTaxable;
  final num? roomCgst;
  final num? roomSgst;
  final num? foodCgst;
  final num? foodSgst;
  final num? totalTax;
  // What the bill deducted as advance when it was issued — the figure
  // buildBookingReportPdf sums over non-cancelled billed rows to derive
  // summary.bills.advanceDeducted, which the server does not send by name.
  final num? advancePaid;
  final num? balanceDue;

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
    this.numGuests,
    this.invoiceDate,
    this.grossAmount,
    this.netAmount,
    this.roomTaxable,
    this.foodTaxable,
    this.roomCgst,
    this.roomSgst,
    this.foodCgst,
    this.foodSgst,
    this.totalTax,
    this.advancePaid,
    this.balanceDue,
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
    numGuests: json['numGuests'] == null ? null : asInt(json['numGuests']),
    invoiceDate: asStringOrNull(json['invoiceDate']),
    grossAmount: asNumOrNull(json['grossAmount']),
    netAmount: asNumOrNull(json['netAmount']),
    roomTaxable: asNumOrNull(json['roomTaxable']),
    foodTaxable: asNumOrNull(json['foodTaxable']),
    roomCgst: asNumOrNull(json['roomCgst']),
    roomSgst: asNumOrNull(json['roomSgst']),
    foodCgst: asNumOrNull(json['foodCgst']),
    foodSgst: asNumOrNull(json['foodSgst']),
    totalTax: asNumOrNull(json['totalTax']),
    advancePaid: asNumOrNull(json['advancePaid']),
    balanceDue: asNumOrNull(json['balanceDue']),
  );

  bool get isBilled => billedAmount != null;
}

/// A money-and-count triple by tender or by which stay it was for — the
/// shape of both summary.byPaymentMode and collections.byStayPeriod entries.
class ReportMoneySplit {
  final num advance;
  final num balance;
  final num total;
  final int count;

  const ReportMoneySplit({
    this.advance = 0,
    this.balance = 0,
    this.total = 0,
    this.count = 0,
  });

  factory ReportMoneySplit.fromJson(Map<String, dynamic> json) => ReportMoneySplit(
    advance: asNum(json['advance']),
    balance: asNum(json['balance']),
    total: asNum(json['total']),
    count: asInt(json['count']),
  );
}

/// Money actually taken in the period, cash basis — summary.collections.
/// Dated by when each payment moved, not by check-in date, so it does not
/// reconcile with the register on screen and is not meant to.
class ReportCollections {
  final num advanceCollected;
  final int advanceCount;
  final num balanceCollected;
  final int balanceCount;
  final num cancellationChargesKept;
  final int cancellationChargeCount;
  final num totalCollected;
  final Map<String, ReportMoneySplit> byPaymentMode;
  final Map<String, ReportMoneySplit> byStayPeriod;

  const ReportCollections({
    this.advanceCollected = 0,
    this.advanceCount = 0,
    this.balanceCollected = 0,
    this.balanceCount = 0,
    this.cancellationChargesKept = 0,
    this.cancellationChargeCount = 0,
    this.totalCollected = 0,
    this.byPaymentMode = const {},
    this.byStayPeriod = const {},
  });

  factory ReportCollections.fromJson(Map<String, dynamic> json) {
    final byModeJson = json['byPaymentMode'] as Map<String, dynamic>? ?? {};
    final byStayJson = json['byStayPeriod'] as Map<String, dynamic>? ?? {};
    return ReportCollections(
      advanceCollected: asNum(json['advanceCollected']),
      advanceCount: asInt(json['advanceCount']),
      balanceCollected: asNum(json['balanceCollected']),
      balanceCount: asInt(json['balanceCount']),
      cancellationChargesKept: asNum(json['cancellationChargesKept']),
      cancellationChargeCount: asInt(json['cancellationChargeCount']),
      totalCollected: asNum(json['totalCollected']),
      byPaymentMode: byModeJson.map(
        (k, v) => MapEntry(k, ReportMoneySplit.fromJson(v as Map<String, dynamic>)),
      ),
      byStayPeriod: byStayJson.map(
        (k, v) => MapEntry(k, ReportMoneySplit.fromJson(v as Map<String, dynamic>)),
      ),
    );
  }
}

/// What cancelled bookings would have added, kept aside rather than folded
/// into the live totals — summary.cancelled.
class ReportCancelledTotals {
  final int count;
  final num bookedValue;
  final num advanceHeld;
  final num refunded;
  final num chargesKept;

  const ReportCancelledTotals({
    this.count = 0,
    this.bookedValue = 0,
    this.advanceHeld = 0,
    this.refunded = 0,
    this.chargesKept = 0,
  });

  factory ReportCancelledTotals.fromJson(Map<String, dynamic> json) => ReportCancelledTotals(
    count: asInt(json['count']),
    bookedValue: asNum(json['bookedValue']),
    advanceHeld: asNum(json['advanceHeld']),
    refunded: asNum(json['refunded']),
    chargesKept: asNum(json['chargesKept']),
  );
}

/// The bill-level totals a set of issued bills foots to — summary.bills and
/// each entry of summary.byDocumentType share this shape.
class ReportBillTotals {
  final int count;
  final num grossAmount;
  final num discountAmount;
  final num netAmount;
  final num roomTaxable;
  final num foodTaxable;
  final num taxableValue;
  final num roomCgst;
  final num roomSgst;
  final num foodCgst;
  final num foodSgst;
  final num cgstAmount;
  final num sgstAmount;
  final num totalTax;
  final num roundOff;
  final num totalAmount;
  // Not sent by the server under this name — derived client-side the same
  // way bookingReportFile.js's withDerived() does, as the sum of advancePaid
  // over billed, non-cancelled rows. Zero until that derivation runs.
  final num advanceDeducted;

  const ReportBillTotals({
    this.count = 0,
    this.grossAmount = 0,
    this.discountAmount = 0,
    this.netAmount = 0,
    this.roomTaxable = 0,
    this.foodTaxable = 0,
    this.taxableValue = 0,
    this.roomCgst = 0,
    this.roomSgst = 0,
    this.foodCgst = 0,
    this.foodSgst = 0,
    this.cgstAmount = 0,
    this.sgstAmount = 0,
    this.totalTax = 0,
    this.roundOff = 0,
    this.totalAmount = 0,
    this.advanceDeducted = 0,
  });

  factory ReportBillTotals.fromJson(Map<String, dynamic> json) => ReportBillTotals(
    count: asInt(json['count']),
    grossAmount: asNum(json['grossAmount']),
    discountAmount: asNum(json['discountAmount']),
    netAmount: asNum(json['netAmount']),
    roomTaxable: asNum(json['roomTaxable']),
    foodTaxable: asNum(json['foodTaxable']),
    taxableValue: asNum(json['taxableValue']),
    roomCgst: asNum(json['roomCgst']),
    roomSgst: asNum(json['roomSgst']),
    foodCgst: asNum(json['foodCgst']),
    foodSgst: asNum(json['foodSgst']),
    cgstAmount: asNum(json['cgstAmount']),
    sgstAmount: asNum(json['sgstAmount']),
    totalTax: asNum(json['totalTax']),
    roundOff: asNum(json['roundOff']),
    totalAmount: asNum(json['totalAmount']),
  );

  ReportBillTotals withAdvanceDeducted(num value) => ReportBillTotals(
    count: count,
    grossAmount: grossAmount,
    discountAmount: discountAmount,
    netAmount: netAmount,
    roomTaxable: roomTaxable,
    foodTaxable: foodTaxable,
    taxableValue: taxableValue,
    roomCgst: roomCgst,
    roomSgst: roomSgst,
    foodCgst: foodCgst,
    foodSgst: foodSgst,
    cgstAmount: cgstAmount,
    sgstAmount: sgstAmount,
    totalTax: totalTax,
    roundOff: roundOff,
    totalAmount: totalAmount,
    advanceDeducted: value,
  );
}

/// The register's own summary block, over the same period as its rows.
class BookingsReportSummary {
  final int totalBookings;
  final int activeBookings;
  final int roomNights;
  final num bookedValue;
  final int unbilledCount;
  final num unbilledValue;
  final num billedAmount;
  final int billedCount;
  final num stayAdvance;
  final num stayBalance;
  final num stayBalanceDue;
  final num cancellationChargesKept;
  final num advanceCollected;
  final num balanceCollected;
  final num totalCollected;
  final Map<String, int> byStatus;
  final Map<String, ReportMoneySplit> byPaymentMode;
  final Map<String, ReportBillTotals> byDocumentType;
  final ReportCollections collections;
  final ReportCancelledTotals cancelled;
  final ReportBillTotals bills;

  const BookingsReportSummary({
    this.totalBookings = 0,
    this.activeBookings = 0,
    this.roomNights = 0,
    this.bookedValue = 0,
    this.unbilledCount = 0,
    this.unbilledValue = 0,
    this.billedAmount = 0,
    this.billedCount = 0,
    this.stayAdvance = 0,
    this.stayBalance = 0,
    this.stayBalanceDue = 0,
    this.cancellationChargesKept = 0,
    this.advanceCollected = 0,
    this.balanceCollected = 0,
    this.totalCollected = 0,
    this.byStatus = const {},
    this.byPaymentMode = const {},
    this.byDocumentType = const {},
    this.collections = const ReportCollections(),
    this.cancelled = const ReportCancelledTotals(),
    this.bills = const ReportBillTotals(),
  });

  factory BookingsReportSummary.fromJson(Map<String, dynamic> json) {
    final byStatusJson = json['byStatus'] as Map<String, dynamic>? ?? {};
    final byModeJson = json['byPaymentMode'] as Map<String, dynamic>? ?? {};
    final byDocJson = json['byDocumentType'] as Map<String, dynamic>? ?? {};
    return BookingsReportSummary(
      totalBookings: asInt(json['totalBookings']),
      activeBookings: asInt(json['activeBookings']),
      roomNights: asInt(json['roomNights']),
      bookedValue: asNum(json['bookedValue']),
      unbilledCount: asInt(json['unbilledCount']),
      unbilledValue: asNum(json['unbilledValue']),
      billedAmount: asNum(json['billedAmount']),
      billedCount: asInt(json['billedCount']),
      stayAdvance: asNum(json['stayAdvance']),
      stayBalance: asNum(json['stayBalance']),
      stayBalanceDue: asNum(json['stayBalanceDue']),
      cancellationChargesKept: asNum(json['cancellationChargesKept']),
      advanceCollected: asNum(json['advanceCollected']),
      balanceCollected: asNum(json['balanceCollected']),
      totalCollected: asNum(json['totalCollected']),
      byStatus: byStatusJson.map((k, v) => MapEntry(k, asInt(v))),
      byPaymentMode: byModeJson.map(
        (k, v) => MapEntry(k, ReportMoneySplit.fromJson(v as Map<String, dynamic>)),
      ),
      byDocumentType: byDocJson.map(
        (k, v) => MapEntry(k, ReportBillTotals.fromJson(v as Map<String, dynamic>)),
      ),
      collections: ReportCollections.fromJson(
        json['collections'] as Map<String, dynamic>? ?? const {},
      ),
      cancelled: ReportCancelledTotals.fromJson(
        json['cancelled'] as Map<String, dynamic>? ?? const {},
      ),
      bills: ReportBillTotals.fromJson(json['bills'] as Map<String, dynamic>? ?? const {}),
    );
  }

  int statusCount(String status) => byStatus[status] ?? 0;
}

/// GET /reports/bookings.
class BookingsReport {
  final String fromDate;
  final String toDate;
  final String billingSide;
  final String? generatedAt;
  final String lodgeName;
  final bool servesFood;
  final String? gstin;
  final BookingsReportSummary summary;
  final List<ReportBooking> bookings;

  const BookingsReport({
    required this.fromDate,
    required this.toDate,
    this.billingSide = 'ALL',
    this.generatedAt,
    this.lodgeName = '',
    this.servesFood = false,
    this.gstin,
    required this.summary,
    this.bookings = const [],
  });

  factory BookingsReport.fromJson(Map<String, dynamic> json) => BookingsReport(
    fromDate: json['fromDate']?.toString() ?? '',
    toDate: json['toDate']?.toString() ?? '',
    billingSide: json['billingSide']?.toString() ?? 'ALL',
    generatedAt: asStringOrNull(json['generatedAt']),
    lodgeName: json['lodgeName']?.toString() ?? '',
    servesFood: asBool(json['servesFood']),
    gstin: asStringOrNull(json['gstin']),
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

// ── Events & functions report — GET /reports/events ────────────────────────

const kEventTypeLabel = <String, String>{
  'BIRTHDAY': 'Birthday',
  'WEDDING': 'Wedding',
  'RECEPTION': 'Reception',
  'ENGAGEMENT': 'Engagement',
  'CORPORATE': 'Corporate',
  'OTHER': 'Other',
};

const kEventStatusLabel = <String, String>{
  'ENQUIRY': 'Enquiry',
  'TENTATIVE': 'Tentative',
  'CONFIRMED': 'Confirmed',
  'SETTLED': 'Settled',
  'CANCELLED': 'Cancelled',
  'EXPIRED': 'Expired',
};

class ReportEventRow {
  final int id;
  final String eventType;
  final String title;
  final String? organiserName;
  final String? organiserPhone;
  final String? venueName;
  final String startAt;
  final String? endAt;
  final int expectedPax;
  final int guaranteedPax;
  final int? finalPax;
  final num venueCharge;
  final num cateringAmount;
  final num addonsTotal;
  final num discountAmount;
  final num totalAmount;
  final num advanceAmount;
  final String? advancePaymentMethod;
  final num balanceDue;
  final String status;
  final String? cancelReason;
  final num? refundAmount;
  final num? cancellationCharge;
  final String? invoiceNumber;
  final String? documentType;
  final String? invoiceDate;

  const ReportEventRow({
    required this.id,
    this.eventType = 'OTHER',
    this.title = '',
    this.organiserName,
    this.organiserPhone,
    this.venueName,
    required this.startAt,
    this.endAt,
    this.expectedPax = 0,
    this.guaranteedPax = 0,
    this.finalPax,
    this.venueCharge = 0,
    this.cateringAmount = 0,
    this.addonsTotal = 0,
    this.discountAmount = 0,
    this.totalAmount = 0,
    this.advanceAmount = 0,
    this.advancePaymentMethod,
    this.balanceDue = 0,
    this.status = 'ENQUIRY',
    this.cancelReason,
    this.refundAmount,
    this.cancellationCharge,
    this.invoiceNumber,
    this.documentType,
    this.invoiceDate,
  });

  /// Whichever pax figure is settled soonest — final, then guaranteed, then
  /// expected — mirrors the web's `ev.finalPax ?? ev.guaranteedPax ?? ev.expectedPax`.
  int get pax => finalPax ?? (guaranteedPax > 0 ? guaranteedPax : expectedPax);

  factory ReportEventRow.fromJson(Map<String, dynamic> json) => ReportEventRow(
    id: asInt(json['id']),
    eventType: json['eventType']?.toString() ?? 'OTHER',
    title: json['title']?.toString() ?? '',
    organiserName: asStringOrNull(json['organiserName']),
    organiserPhone: asStringOrNull(json['organiserPhone']),
    venueName: asStringOrNull(json['venueName']),
    startAt: json['startAt']?.toString() ?? '',
    endAt: asStringOrNull(json['endAt']),
    expectedPax: asInt(json['expectedPax']),
    guaranteedPax: asInt(json['guaranteedPax']),
    finalPax: json['finalPax'] == null ? null : asInt(json['finalPax']),
    venueCharge: asNum(json['venueCharge']),
    cateringAmount: asNum(json['cateringAmount']),
    addonsTotal: asNum(json['addonsTotal']),
    discountAmount: asNum(json['discountAmount']),
    totalAmount: asNum(json['totalAmount']),
    advanceAmount: asNum(json['advanceAmount']),
    advancePaymentMethod: asStringOrNull(json['advancePaymentMethod']),
    balanceDue: asNum(json['balanceDue']),
    status: json['status']?.toString() ?? 'ENQUIRY',
    cancelReason: asStringOrNull(json['cancelReason']),
    refundAmount: asNumOrNull(json['refundAmount']),
    cancellationCharge: asNumOrNull(json['cancellationCharge']),
    invoiceNumber: asStringOrNull(json['invoiceNumber']),
    documentType: asStringOrNull(json['documentType']),
    invoiceDate: asStringOrNull(json['invoiceDate']),
  );
}

class EventsReportTotals {
  final int count;
  final num venueCharge;
  final num cateringAmount;
  final num addonsTotal;
  final num discountAmount;
  final num totalAmount;
  final num advanceAmount;
  final num balanceDue;

  const EventsReportTotals({
    this.count = 0,
    this.venueCharge = 0,
    this.cateringAmount = 0,
    this.addonsTotal = 0,
    this.discountAmount = 0,
    this.totalAmount = 0,
    this.advanceAmount = 0,
    this.balanceDue = 0,
  });

  factory EventsReportTotals.fromJson(Map<String, dynamic> json) => EventsReportTotals(
    count: asInt(json['count']),
    venueCharge: asNum(json['venueCharge']),
    cateringAmount: asNum(json['cateringAmount']),
    addonsTotal: asNum(json['addonsTotal']),
    discountAmount: asNum(json['discountAmount']),
    totalAmount: asNum(json['totalAmount']),
    advanceAmount: asNum(json['advanceAmount']),
    balanceDue: asNum(json['balanceDue']),
  );
}

class EventsReportCancelled {
  final int count;
  final num advanceHeld;
  final num refunded;
  final num chargesKept;

  const EventsReportCancelled({
    this.count = 0,
    this.advanceHeld = 0,
    this.refunded = 0,
    this.chargesKept = 0,
  });

  factory EventsReportCancelled.fromJson(Map<String, dynamic> json) => EventsReportCancelled(
    count: asInt(json['count']),
    advanceHeld: asNum(json['advanceHeld']),
    refunded: asNum(json['refunded']),
    chargesKept: asNum(json['chargesKept']),
  );
}

class EventsReportSummary {
  final int totalEvents;
  final Map<String, int> byStatus;
  final EventsReportCancelled cancelled;
  final EventsReportTotals totals;
  final Map<String, EventsReportTotals> byEventType;

  const EventsReportSummary({
    this.totalEvents = 0,
    this.byStatus = const {},
    this.cancelled = const EventsReportCancelled(),
    this.totals = const EventsReportTotals(),
    this.byEventType = const {},
  });

  factory EventsReportSummary.fromJson(Map<String, dynamic> json) {
    final byStatusJson = json['byStatus'] as Map<String, dynamic>? ?? {};
    final byTypeJson = json['byEventType'] as Map<String, dynamic>? ?? {};
    return EventsReportSummary(
      totalEvents: asInt(json['totalEvents']),
      byStatus: byStatusJson.map((k, v) => MapEntry(k, asInt(v))),
      cancelled: EventsReportCancelled.fromJson(json['cancelled'] as Map<String, dynamic>? ?? const {}),
      totals: EventsReportTotals.fromJson(json['totals'] as Map<String, dynamic>? ?? const {}),
      byEventType: byTypeJson.map(
        (k, v) => MapEntry(k, EventsReportTotals.fromJson(v as Map<String, dynamic>)),
      ),
    );
  }

  int statusCount(String status) => byStatus[status] ?? 0;
}

/// GET /reports/events.
class EventsReport {
  final String fromDate;
  final String toDate;
  final String? generatedAt;
  final String lodgeName;
  final EventsReportSummary summary;
  final List<ReportEventRow> events;

  const EventsReport({
    required this.fromDate,
    required this.toDate,
    this.generatedAt,
    this.lodgeName = '',
    this.summary = const EventsReportSummary(),
    this.events = const [],
  });

  factory EventsReport.fromJson(Map<String, dynamic> json) => EventsReport(
    fromDate: json['fromDate']?.toString() ?? '',
    toDate: json['toDate']?.toString() ?? '',
    generatedAt: asStringOrNull(json['generatedAt']),
    lodgeName: json['lodgeName']?.toString() ?? '',
    summary: EventsReportSummary.fromJson(json['summary'] as Map<String, dynamic>? ?? const {}),
    events: (json['events'] as List?)
            ?.map((e) => ReportEventRow.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
  );
}

// ── Food orders report — GET /reports/food-orders ──────────────────────────

const kOrderStatusLabel = <String, String>{
  'PENDING': 'Pending',
  'QUEUED': 'Queued',
  'PREPARING': 'Preparing',
  'READY': 'Ready',
  'DELIVERED': 'Delivered',
  'CANCELLED': 'Cancelled',
};

const kOrderSourceLabel = <String, String>{
  'ROOM': 'Room',
  'TABLE': 'Table',
  'COUNTER': 'Counter',
};

class ReportFoodOrderRow {
  final int id;
  final String orderNumber;
  final String orderDate;
  final String source;
  final String? roomNumber;
  final String? tableLabel;
  final String? guestName;
  final String? guestPhone;
  final String status;
  final int itemCount;
  final num subtotal;
  final String placedAt;
  final String? deliveredAt;
  final String? cancelledAt;
  final String? cancelReason;
  final String? invoiceNumber;
  final String? documentType;
  final bool billed;

  const ReportFoodOrderRow({
    required this.id,
    this.orderNumber = '',
    this.orderDate = '',
    this.source = 'COUNTER',
    this.roomNumber,
    this.tableLabel,
    this.guestName,
    this.guestPhone,
    this.status = 'PENDING',
    this.itemCount = 0,
    this.subtotal = 0,
    this.placedAt = '',
    this.deliveredAt,
    this.cancelledAt,
    this.cancelReason,
    this.invoiceNumber,
    this.documentType,
    this.billed = false,
  });

  factory ReportFoodOrderRow.fromJson(Map<String, dynamic> json) => ReportFoodOrderRow(
    id: asInt(json['id']),
    orderNumber: json['orderNumber']?.toString() ?? '',
    orderDate: json['orderDate']?.toString() ?? '',
    source: json['source']?.toString() ?? 'COUNTER',
    roomNumber: asStringOrNull(json['roomNumber']),
    tableLabel: asStringOrNull(json['tableLabel']),
    guestName: asStringOrNull(json['guestName']),
    guestPhone: asStringOrNull(json['guestPhone']),
    status: json['status']?.toString() ?? 'PENDING',
    itemCount: asInt(json['itemCount']),
    subtotal: asNum(json['subtotal']),
    placedAt: json['placedAt']?.toString() ?? '',
    deliveredAt: asStringOrNull(json['deliveredAt']),
    cancelledAt: asStringOrNull(json['cancelledAt']),
    cancelReason: asStringOrNull(json['cancelReason']),
    invoiceNumber: asStringOrNull(json['invoiceNumber']),
    documentType: asStringOrNull(json['documentType']),
    billed: asBool(json['billed']),
  );
}

class FoodOrdersReportSummary {
  final int totalOrders;
  final Map<String, int> byStatus;
  final Map<String, int> bySource;
  final int deliveredCount;
  final num deliveredValue;
  final int cancelledCount;
  final int billedCount;
  final num billedValue;
  final num unbilledDeliveredValue;

  const FoodOrdersReportSummary({
    this.totalOrders = 0,
    this.byStatus = const {},
    this.bySource = const {},
    this.deliveredCount = 0,
    this.deliveredValue = 0,
    this.cancelledCount = 0,
    this.billedCount = 0,
    this.billedValue = 0,
    this.unbilledDeliveredValue = 0,
  });

  factory FoodOrdersReportSummary.fromJson(Map<String, dynamic> json) {
    final byStatusJson = json['byStatus'] as Map<String, dynamic>? ?? {};
    final bySourceJson = json['bySource'] as Map<String, dynamic>? ?? {};
    return FoodOrdersReportSummary(
      totalOrders: asInt(json['totalOrders']),
      byStatus: byStatusJson.map((k, v) => MapEntry(k, asInt(v))),
      bySource: bySourceJson.map((k, v) => MapEntry(k, asInt(v))),
      deliveredCount: asInt(json['deliveredCount']),
      deliveredValue: asNum(json['deliveredValue']),
      cancelledCount: asInt(json['cancelledCount']),
      billedCount: asInt(json['billedCount']),
      billedValue: asNum(json['billedValue']),
      unbilledDeliveredValue: asNum(json['unbilledDeliveredValue']),
    );
  }

  int statusCount(String status) => byStatus[status] ?? 0;
}

/// GET /reports/food-orders.
class FoodOrdersReport {
  final String fromDate;
  final String toDate;
  final String? generatedAt;
  final String lodgeName;
  final FoodOrdersReportSummary summary;
  final List<ReportFoodOrderRow> orders;

  const FoodOrdersReport({
    required this.fromDate,
    required this.toDate,
    this.generatedAt,
    this.lodgeName = '',
    this.summary = const FoodOrdersReportSummary(),
    this.orders = const [],
  });

  factory FoodOrdersReport.fromJson(Map<String, dynamic> json) => FoodOrdersReport(
    fromDate: json['fromDate']?.toString() ?? '',
    toDate: json['toDate']?.toString() ?? '',
    generatedAt: asStringOrNull(json['generatedAt']),
    lodgeName: json['lodgeName']?.toString() ?? '',
    summary: FoodOrdersReportSummary.fromJson(json['summary'] as Map<String, dynamic>? ?? const {}),
    orders: (json['orders'] as List?)
            ?.map((e) => ReportFoodOrderRow.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
  );
}

// ── Profit & Loss — GET /reports/profit-loss, /reports/profit-loss-history ─

class PLRevenue {
  final num roomRevenue;
  final num functionRevenue;
  final num foodRevenue;
  final num totalRevenue;

  const PLRevenue({
    this.roomRevenue = 0,
    this.functionRevenue = 0,
    this.foodRevenue = 0,
    this.totalRevenue = 0,
  });

  factory PLRevenue.fromJson(Map<String, dynamic> json) => PLRevenue(
    roomRevenue: asNum(json['roomRevenue']),
    functionRevenue: asNum(json['functionRevenue']),
    foodRevenue: asNum(json['foodRevenue']),
    totalRevenue: asNum(json['totalRevenue']),
  );
}

class PLCategoryAmount {
  final int categoryId;
  final String categoryName;
  final num amount;

  const PLCategoryAmount({this.categoryId = 0, this.categoryName = '', this.amount = 0});

  factory PLCategoryAmount.fromJson(Map<String, dynamic> json) => PLCategoryAmount(
    categoryId: asInt(json['categoryId']),
    categoryName: asStringOrNull(json['categoryName']) ?? '',
    amount: asNum(json['amount']),
  );
}

class PLExpenses {
  final List<PLCategoryAmount> byCategory;
  final num totalExpenses;

  const PLExpenses({this.byCategory = const [], this.totalExpenses = 0});

  factory PLExpenses.fromJson(Map<String, dynamic> json) => PLExpenses(
    byCategory: (json['byCategory'] as List? ?? const [])
        .map((e) => PLCategoryAmount.fromJson(e as Map<String, dynamic>))
        .toList(),
    totalExpenses: asNum(json['totalExpenses']),
  );
}

class PLOtherIncome {
  final List<PLCategoryAmount> byCategory;
  final num totalOtherIncome;

  const PLOtherIncome({this.byCategory = const [], this.totalOtherIncome = 0});

  factory PLOtherIncome.fromJson(Map<String, dynamic> json) => PLOtherIncome(
    byCategory: (json['byCategory'] as List? ?? const [])
        .map((e) => PLCategoryAmount.fromJson(e as Map<String, dynamic>))
        .toList(),
    totalOtherIncome: asNum(json['totalOtherIncome']),
  );
}

class PLDepreciationAsset {
  final int id;
  final String name;
  final String categoryName;
  final num periodDepreciation;
  final num bookValue;

  const PLDepreciationAsset({
    this.id = 0,
    this.name = '',
    this.categoryName = '',
    this.periodDepreciation = 0,
    this.bookValue = 0,
  });

  factory PLDepreciationAsset.fromJson(Map<String, dynamic> json) => PLDepreciationAsset(
    id: asInt(json['id']),
    name: asStringOrNull(json['name']) ?? '',
    categoryName: asStringOrNull(json['categoryName']) ?? '',
    periodDepreciation: asNum(json['periodDepreciation']),
    bookValue: asNum(json['bookValue']),
  );
}

class PLDepreciationSkipped {
  final String name;
  final String reason;

  const PLDepreciationSkipped({this.name = '', this.reason = ''});

  factory PLDepreciationSkipped.fromJson(Map<String, dynamic> json) => PLDepreciationSkipped(
    name: asStringOrNull(json['name']) ?? '',
    reason: asStringOrNull(json['reason']) ?? '',
  );
}

class PLDepreciation {
  final num totalDepreciation;
  final num totalBookValue;
  final List<PLDepreciationAsset> byAsset;
  final List<PLDepreciationSkipped> skipped;

  const PLDepreciation({
    this.totalDepreciation = 0,
    this.totalBookValue = 0,
    this.byAsset = const [],
    this.skipped = const [],
  });

  factory PLDepreciation.fromJson(Map<String, dynamic> json) => PLDepreciation(
    totalDepreciation: asNum(json['totalDepreciation']),
    totalBookValue: asNum(json['totalBookValue']),
    byAsset: (json['byAsset'] as List? ?? const [])
        .map((e) => PLDepreciationAsset.fromJson(e as Map<String, dynamic>))
        .toList(),
    skipped: (json['skipped'] as List? ?? const [])
        .map((e) => PLDepreciationSkipped.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}

class PLCancellationCharges {
  final num roomsKept;
  final num functionsKept;
  final num total;

  const PLCancellationCharges({this.roomsKept = 0, this.functionsKept = 0, this.total = 0});

  factory PLCancellationCharges.fromJson(Map<String, dynamic> json) => PLCancellationCharges(
    roomsKept: asNum(json['roomsKept']),
    functionsKept: asNum(json['functionsKept']),
    total: asNum(json['total']),
  );
}

/// GET /reports/profit-loss — one period's statement.
class ProfitLossReport {
  final String fromDate;
  final String toDate;
  final String? generatedAt;
  final String lodgeName;
  final PLRevenue revenue;
  final PLCancellationCharges cancellationCharges;
  final PLOtherIncome otherIncome;
  final num totalIncome;
  final PLExpenses expenses;
  final PLDepreciation depreciation;
  final num netProfit;

  const ProfitLossReport({
    required this.fromDate,
    required this.toDate,
    this.generatedAt,
    this.lodgeName = '',
    this.revenue = const PLRevenue(),
    this.cancellationCharges = const PLCancellationCharges(),
    this.otherIncome = const PLOtherIncome(),
    this.totalIncome = 0,
    this.expenses = const PLExpenses(),
    this.depreciation = const PLDepreciation(),
    this.netProfit = 0,
  });

  factory ProfitLossReport.fromJson(Map<String, dynamic> json) => ProfitLossReport(
    fromDate: json['fromDate']?.toString() ?? '',
    toDate: json['toDate']?.toString() ?? '',
    generatedAt: asStringOrNull(json['generatedAt']),
    lodgeName: json['lodgeName']?.toString() ?? '',
    revenue: PLRevenue.fromJson(json['revenue'] as Map<String, dynamic>? ?? const {}),
    cancellationCharges: PLCancellationCharges.fromJson(
      json['cancellationCharges'] as Map<String, dynamic>? ?? const {},
    ),
    otherIncome: PLOtherIncome.fromJson(json['otherIncome'] as Map<String, dynamic>? ?? const {}),
    totalIncome: asNum(json['totalIncome']),
    expenses: PLExpenses.fromJson(json['expenses'] as Map<String, dynamic>? ?? const {}),
    depreciation: PLDepreciation.fromJson(json['depreciation'] as Map<String, dynamic>? ?? const {}),
    netProfit: asNum(json['netProfit']),
  );
}

/// One column of the Screener-style multi-year table — a full period's
/// figures (same computation as [ProfitLossReport], plus the handful of
/// extra roll-up numbers the history table alone shows: sales, operating
/// profit, OPM%, interest, tax, profit before tax).
class ProfitLossHistoryColumn {
  final String label;
  final String fromDate;
  final String toDate;
  final num sales;
  final PLRevenue revenue;
  final PLCancellationCharges cancellationCharges;
  final PLExpenses expenses;
  final num operatingProfit;
  final num? opmPercent;
  final PLOtherIncome otherIncome;
  final num totalOtherIncome;
  final num? interest;
  final PLDepreciation depreciation;
  final num profitBeforeTax;
  final num? tax;
  final num? taxPercent;
  final num netProfit;

  const ProfitLossHistoryColumn({
    this.label = '',
    this.fromDate = '',
    this.toDate = '',
    this.sales = 0,
    this.revenue = const PLRevenue(),
    this.cancellationCharges = const PLCancellationCharges(),
    this.expenses = const PLExpenses(),
    this.operatingProfit = 0,
    this.opmPercent,
    this.otherIncome = const PLOtherIncome(),
    this.totalOtherIncome = 0,
    this.interest,
    this.depreciation = const PLDepreciation(),
    this.profitBeforeTax = 0,
    this.tax,
    this.taxPercent,
    this.netProfit = 0,
  });

  factory ProfitLossHistoryColumn.fromJson(Map<String, dynamic> json) => ProfitLossHistoryColumn(
    label: json['label']?.toString() ?? '',
    fromDate: json['fromDate']?.toString() ?? '',
    toDate: json['toDate']?.toString() ?? '',
    sales: asNum(json['sales']),
    revenue: PLRevenue.fromJson(json['revenue'] as Map<String, dynamic>? ?? const {}),
    cancellationCharges: PLCancellationCharges.fromJson(
      json['cancellationCharges'] as Map<String, dynamic>? ?? const {},
    ),
    expenses: PLExpenses.fromJson(json['expenses'] as Map<String, dynamic>? ?? const {}),
    operatingProfit: asNum(json['operatingProfit']),
    opmPercent: asNumOrNull(json['opmPercent']),
    otherIncome: PLOtherIncome.fromJson(json['otherIncome'] as Map<String, dynamic>? ?? const {}),
    totalOtherIncome: asNum(json['totalOtherIncome']),
    interest: asNumOrNull(json['interest']),
    depreciation: PLDepreciation.fromJson(json['depreciation'] as Map<String, dynamic>? ?? const {}),
    profitBeforeTax: asNum(json['profitBeforeTax']),
    tax: asNumOrNull(json['tax']),
    taxPercent: asNumOrNull(json['taxPercent']),
    netProfit: asNum(json['netProfit']),
  );
}

/// GET /reports/profit-loss-history — one column per financial year (or
/// month) with data on file, oldest to newest, plus a trailing TTM column.
class ProfitLossHistory {
  final String? generatedAt;
  final String lodgeName;
  final List<ProfitLossHistoryColumn> columns;

  const ProfitLossHistory({this.generatedAt, this.lodgeName = '', this.columns = const []});

  factory ProfitLossHistory.fromJson(Map<String, dynamic> json) => ProfitLossHistory(
    generatedAt: asStringOrNull(json['generatedAt']),
    lodgeName: json['lodgeName']?.toString() ?? '',
    columns: (json['columns'] as List? ?? const [])
        .map((e) => ProfitLossHistoryColumn.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}

/// The ten Screener-style P/L rows shown in the history table, in order —
/// mirrors PL_HISTORY_ROWS in ReportsPanel.jsx.
enum PLHistoryRowKind { money, percent }

class PLHistoryRowSpec {
  final String key;
  final String label;
  final PLHistoryRowKind kind;
  final bool emphasis;
  final num? Function(ProfitLossHistoryColumn) value;

  const PLHistoryRowSpec({
    required this.key,
    required this.label,
    this.kind = PLHistoryRowKind.money,
    this.emphasis = false,
    required this.value,
  });
}

final List<PLHistoryRowSpec> kPlHistoryRows = [
  PLHistoryRowSpec(key: 'sales', label: 'Sales', value: (c) => c.sales),
  PLHistoryRowSpec(key: 'expenses', label: 'Expenses', value: (c) => c.expenses.totalExpenses),
  PLHistoryRowSpec(
    key: 'operatingProfit',
    label: 'Operating Profit',
    emphasis: true,
    value: (c) => c.operatingProfit,
  ),
  PLHistoryRowSpec(
    key: 'opmPercent',
    label: 'OPM %',
    kind: PLHistoryRowKind.percent,
    value: (c) => c.opmPercent,
  ),
  PLHistoryRowSpec(key: 'totalOtherIncome', label: 'Other Income', value: (c) => c.totalOtherIncome),
  PLHistoryRowSpec(key: 'interest', label: 'Interest', value: (c) => c.interest),
  PLHistoryRowSpec(
    key: 'depreciation',
    label: 'Depreciation',
    value: (c) => c.depreciation.totalDepreciation,
  ),
  PLHistoryRowSpec(
    key: 'profitBeforeTax',
    label: 'Profit before tax',
    emphasis: true,
    value: (c) => c.profitBeforeTax,
  ),
  PLHistoryRowSpec(key: 'taxPercent', label: 'Tax %', kind: PLHistoryRowKind.percent, value: (c) => c.taxPercent),
  PLHistoryRowSpec(key: 'netProfit', label: 'Net Profit', emphasis: true, value: (c) => c.netProfit),
];
