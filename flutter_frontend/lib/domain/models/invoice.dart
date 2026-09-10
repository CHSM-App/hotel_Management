import 'booking.dart';
import 'json.dart';

/// A stay waiting to be billed — GET /billing/queue.
class BillableStay {
  final int id;
  final String? guestName;
  final String? guestPhone;
  final String? roomNumber;
  final String? categoryName;
  final String? checkInDate;
  final String? checkOutDate;
  final num? totalPrice;
  final num? advanceAmount;
  final String? actualCheckOutAt;

  const BillableStay({
    required this.id,
    this.guestName,
    this.guestPhone,
    this.roomNumber,
    this.categoryName,
    this.checkInDate,
    this.checkOutDate,
    this.totalPrice,
    this.advanceAmount,
    this.actualCheckOutAt,
  });

  factory BillableStay.fromJson(Map<String, dynamic> json) => BillableStay(
    id: asInt(json['id']),
    guestName: asStringOrNull(json['guestName']),
    guestPhone: asStringOrNull(json['guestPhone']),
    roomNumber: asStringOrNull(json['roomNumber']),
    categoryName: asStringOrNull(json['categoryName']),
    checkInDate: asStringOrNull(json['checkInDate']),
    checkOutDate: asStringOrNull(json['checkOutDate']),
    totalPrice: asNumOrNull(json['totalPrice']),
    advanceAmount: asNumOrNull(json['advanceAmount']),
    actualCheckOutAt: asStringOrNull(json['actualCheckOutAt']),
  );

  num get balanceDue => (totalPrice ?? 0) - (advanceAmount ?? 0);
}

/// One side of a bill — the GST reading or the non-GST one.
///
/// The server prices both every time and the property's registration decides
/// which is issued. Every figure here is GST-**inclusive**: the tax is taken
/// out of the amount, never added on top, so roomSubtotal already contains the
/// cgst and sgst shown beside it.
class BillSide {
  final String? documentType;
  final num roomSubtotal;
  final num nightsSubtotal;
  final num lateCheckoutCharge;
  final num cgstAmount;
  final num sgstAmount;
  final num cgstRatePercent;
  final num sgstRatePercent;
  final num foodSubtotal;
  final num foodCgstAmount;
  final num foodSgstAmount;
  final num discountAmount;
  final num discountPercent;
  final num roundOff;
  final num totalAmount;

  const BillSide({
    this.documentType,
    this.roomSubtotal = 0,
    this.nightsSubtotal = 0,
    this.lateCheckoutCharge = 0,
    this.cgstAmount = 0,
    this.sgstAmount = 0,
    this.cgstRatePercent = 0,
    this.sgstRatePercent = 0,
    this.foodSubtotal = 0,
    this.foodCgstAmount = 0,
    this.foodSgstAmount = 0,
    this.discountAmount = 0,
    this.discountPercent = 0,
    this.roundOff = 0,
    this.totalAmount = 0,
  });

  factory BillSide.fromJson(Map<String, dynamic> json) => BillSide(
    documentType: asStringOrNull(json['documentType']),
    roomSubtotal: asNum(json['roomSubtotal']),
    nightsSubtotal: asNum(json['nightsSubtotal']),
    lateCheckoutCharge: asNum(json['lateCheckoutCharge']),
    cgstAmount: asNum(json['cgstAmount']),
    sgstAmount: asNum(json['sgstAmount']),
    cgstRatePercent: asNum(json['cgstRatePercent']),
    sgstRatePercent: asNum(json['sgstRatePercent']),
    foodSubtotal: asNum(json['foodSubtotal']),
    foodCgstAmount: asNum(json['foodCgstAmount']),
    foodSgstAmount: asNum(json['foodSgstAmount']),
    discountAmount: asNum(json['discountAmount']),
    discountPercent: asNum(json['discountPercent']),
    roundOff: asNum(json['roundOff']),
    totalAmount: asNum(json['totalAmount']),
  );
}

/// One line of the room charge — "Deluxe ₹1,300", "AC/Heater", a season uplift.
class BillLine {
  final String label;
  final num amount;
  final int nights;

  const BillLine({required this.label, required this.amount, this.nights = 0});

  factory BillLine.fromJson(Map<String, dynamic> json) => BillLine(
    label: json['label']?.toString() ?? '',
    amount: asNum(json['amount']),
    nights: asInt(json['nights']),
  );
}

/// A CYCLE guest who left before the nights they booked ran out.
///
/// The bill still carries every night that was sold; this is what the desk
/// reads to decide whether to give the unused ones back as a discount. Null
/// on every other checkin mode, and whenever nothing was left unused.
class EarlyCheckout {
  final int plannedNights;
  final int actualNights;
  final int unusedNights;
  final num unusedAmount;

  const EarlyCheckout({
    required this.plannedNights,
    required this.actualNights,
    required this.unusedNights,
    required this.unusedAmount,
  });

  factory EarlyCheckout.fromJson(Map<String, dynamic> json) => EarlyCheckout(
    plannedNights: asInt(json['plannedNights']),
    actualNights: asInt(json['actualNights']),
    unusedNights: asInt(json['unusedNights']),
    unusedAmount: asNum(json['unusedAmount']),
  );
}

/// What the bill will say, before it is issued.
class BillPreview {
  final int? bookingId;
  final String? guestName;
  final String? roomNumber;
  final String? categoryName;
  final int nights;
  final List<BillLine> roomCharges;
  final num lateCheckoutCharge;
  final int lateCheckoutMinutes;
  final bool lateCheckoutAgreed;
  final num advancePaid;
  final String? advanceReceiptNumbers;
  final bool isGstRegistered;
  final BillSide? gst;
  final BillSide? nonGst;
  final EarlyCheckout? earlyCheckout;

  /// True once a bill has already been issued for this stay. Issuing again
  /// would burn a second serial on one stay, so the screen shuts instead.
  final bool alreadyInvoiced;

  /// How this stay is checked in. A discount is only ever entered here on a
  /// CYCLE property — on the other two modes the bill is what the stay costs
  /// and any concession is settled through what the guest hands over.
  final String? checkinMode;

  /// Everything on this bill before tax and before anything comes off it —
  /// the figure a percentage discount is a percentage *of*.
  final num discountBase;

  const BillPreview({
    this.bookingId,
    this.guestName,
    this.roomNumber,
    this.categoryName,
    this.nights = 0,
    this.roomCharges = const [],
    this.lateCheckoutCharge = 0,
    this.lateCheckoutMinutes = 0,
    this.lateCheckoutAgreed = false,
    this.advancePaid = 0,
    this.advanceReceiptNumbers,
    this.isGstRegistered = false,
    this.gst,
    this.nonGst,
    this.earlyCheckout,
    this.alreadyInvoiced = false,
    this.checkinMode,
    this.discountBase = 0,
  });

  factory BillPreview.fromJson(Map<String, dynamic> json) => BillPreview(
    bookingId: asIntOrNull(json['bookingId']),
    guestName: asStringOrNull(json['guestName']),
    roomNumber: asStringOrNull(json['roomNumber']),
    categoryName: asStringOrNull(json['categoryName']),
    nights: asInt(json['nights']),
    roomCharges:
        (json['roomCharges'] as List?)
            ?.map((e) => BillLine.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    lateCheckoutCharge: asNum(json['lateCheckoutCharge']),
    lateCheckoutMinutes: asInt(json['lateCheckoutMinutes']),
    lateCheckoutAgreed: asBool(json['lateCheckoutAgreed']),
    advancePaid: asNum(json['advancePaid']),
    advanceReceiptNumbers: asStringOrNull(json['advanceReceiptNumbers']),
    isGstRegistered: asBool(json['isGstRegistered']),
    gst: json['gst'] == null
        ? null
        : BillSide.fromJson(json['gst'] as Map<String, dynamic>),
    nonGst: json['nonGst'] == null
        ? null
        : BillSide.fromJson(json['nonGst'] as Map<String, dynamic>),
    earlyCheckout: json['earlyCheckout'] == null
        ? null
        : EarlyCheckout.fromJson(json['earlyCheckout'] as Map<String, dynamic>),
    alreadyInvoiced: asBool(json['alreadyInvoiced']),
    checkinMode: asStringOrNull(
      (json['document'] as Map<String, dynamic>?)?['checkinMode'],
    ),
    discountBase: asNum(json['discountBase']),
  );

  /// Which side is actually issued.
  ///
  /// Decided by the property, not by the desk: a registered lodge always issues
  /// on the GST side, and an unregistered one has no other document to issue.
  /// The choice the web screen used to offer was removed for exactly that
  /// reason, so it is not offered here either.
  String get billingSide => isGstRegistered ? 'GST' : 'NON_GST';

  BillSide? get amounts => isGstRegistered ? gst : nonGst;

  /// What the guest still owes.
  num get balanceDue {
    final total = amounts?.totalAmount ?? 0;
    return ((total - advancePaid) * 100).round() / 100;
  }
}

/// An issued bill.
class Invoice {
  final int id;
  final int? bookingId;
  final String? invoiceNumber;
  final String? documentType;
  final String? billingSide;
  final String? guestName;
  final String? roomNumber;
  final String? checkInDate;
  final String? checkOutDate;
  final num totalAmount;
  final num advancePaid;
  final num balanceCollected;
  final String? balancePaymentMethod;
  final String? balanceReference;
  final List<PaymentLine> paymentLines;
  final String? status;
  final String? voidReason;
  final String? createdAt;

  // ── The rest of what the printed memo states ─────────────────────────────
  final String? guestPhone;
  final String? categoryName;
  final int? numGuests;
  final String? actualCheckInAt;
  final String? actualCheckOutAt;
  final String? checkOutTime;
  final String? checkinMode;

  /// One line per thing charged for the room — the rate, each extra, any
  /// season uplift. The document names them rather than folding them into one
  /// figure and leaving it to be argued about.
  final List<BillLine> roomCharges;

  final num nightsSubtotal;
  final num roomSubtotal;
  final num lateCheckoutCharge;

  /// The taxable values — the amount with the tax taken out of it. TOTAL
  /// AMOUNT on the memo is this, not the gross.
  final num roomTaxable;
  final num foodTaxable;

  final num foodSubtotal;
  final num cgstAmount;
  final num sgstAmount;
  final num cgstRatePercent;
  final num sgstRatePercent;
  final num foodCgstAmount;
  final num foodSgstAmount;
  final num foodCgstRatePercent;
  final num foodSgstRatePercent;
  final num discountAmount;
  final num discountPercent;
  final num roundOff;
  final String? advanceReceiptNumbers;

  // ── The property, as it prints on the document ───────────────────────────
  final String? lodgeName;
  final String? lodgeAddress;
  final String? lodgePhone;
  final String? lodgeCity;
  final String? gstin;
  final bool isGstRegistered;

  const Invoice({
    required this.id,
    this.bookingId,
    this.invoiceNumber,
    this.documentType,
    this.billingSide,
    this.guestName,
    this.roomNumber,
    this.checkInDate,
    this.checkOutDate,
    this.totalAmount = 0,
    this.advancePaid = 0,
    this.balanceCollected = 0,
    this.balancePaymentMethod,
    this.balanceReference,
    this.paymentLines = const [],
    this.status,
    this.voidReason,
    this.createdAt,
    this.guestPhone,
    this.categoryName,
    this.numGuests,
    this.actualCheckInAt,
    this.actualCheckOutAt,
    this.checkOutTime,
    this.checkinMode,
    this.roomCharges = const [],
    this.nightsSubtotal = 0,
    this.roomSubtotal = 0,
    this.lateCheckoutCharge = 0,
    this.roomTaxable = 0,
    this.foodTaxable = 0,
    this.foodSubtotal = 0,
    this.cgstAmount = 0,
    this.sgstAmount = 0,
    this.cgstRatePercent = 0,
    this.sgstRatePercent = 0,
    this.foodCgstAmount = 0,
    this.foodSgstAmount = 0,
    this.foodCgstRatePercent = 0,
    this.foodSgstRatePercent = 0,
    this.discountAmount = 0,
    this.discountPercent = 0,
    this.roundOff = 0,
    this.advanceReceiptNumbers,
    this.lodgeName,
    this.lodgeAddress,
    this.lodgePhone,
    this.lodgeCity,
    this.gstin,
    this.isGstRegistered = false,
  });

  factory Invoice.fromJson(Map<String, dynamic> json) => Invoice(
    id: asInt(json['id']),
    bookingId: asIntOrNull(json['bookingId']),
    invoiceNumber: asStringOrNull(json['invoiceNumber']),
    documentType: asStringOrNull(json['documentType']),
    billingSide: asStringOrNull(json['billingSide']),
    guestName: asStringOrNull(json['guestName']),
    roomNumber: asStringOrNull(json['roomNumber']),
    checkInDate: asStringOrNull(json['checkInDate']),
    checkOutDate: asStringOrNull(json['checkOutDate']),
    totalAmount: asNum(json['totalAmount']),
    advancePaid: asNum(json['advancePaid']),
    balanceCollected: asNum(json['balanceCollected']),
    balancePaymentMethod: asStringOrNull(json['balancePaymentMethod']),
    balanceReference: asStringOrNull(json['balanceReference']),
    paymentLines:
        (json['paymentLines'] as List?)
            ?.map((e) => PaymentLine.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    status: asStringOrNull(json['status']),
    voidReason: asStringOrNull(json['voidReason']),
    createdAt: asStringOrNull(json['createdAt']),
    guestPhone: asStringOrNull(json['guestPhone']),
    categoryName: asStringOrNull(json['categoryName']),
    numGuests: asIntOrNull(json['numGuests']),
    actualCheckInAt: asStringOrNull(json['actualCheckInAt']),
    actualCheckOutAt: asStringOrNull(json['actualCheckOutAt']),
    checkOutTime: asStringOrNull(json['checkOutTime']),
    checkinMode: asStringOrNull(json['checkinMode']),
    roomCharges:
        (json['roomCharges'] as List?)
            ?.map((e) => BillLine.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    nightsSubtotal: asNum(json['nightsSubtotal']),
    roomSubtotal: asNum(json['roomSubtotal']),
    lateCheckoutCharge: asNum(json['lateCheckoutCharge']),
    roomTaxable: asNum(json['roomTaxable']),
    foodTaxable: asNum(json['foodTaxable']),
    foodSubtotal: asNum(json['foodSubtotal']),
    cgstAmount: asNum(json['cgstAmount']),
    sgstAmount: asNum(json['sgstAmount']),
    cgstRatePercent: asNum(json['cgstRatePercent']),
    sgstRatePercent: asNum(json['sgstRatePercent']),
    foodCgstAmount: asNum(json['foodCgstAmount']),
    foodSgstAmount: asNum(json['foodSgstAmount']),
    foodCgstRatePercent: asNum(json['foodCgstRatePercent']),
    foodSgstRatePercent: asNum(json['foodSgstRatePercent']),
    discountAmount: asNum(json['discountAmount']),
    discountPercent: asNum(json['discountPercent']),
    roundOff: asNum(json['roundOff']),
    advanceReceiptNumbers: asStringOrNull(json['advanceReceiptNumbers']),
    lodgeName: asStringOrNull(json['lodgeName']),
    lodgeAddress: asStringOrNull(json['lodgeAddress']),
    lodgePhone: asStringOrNull(json['lodgePhone']),
    lodgeCity: asStringOrNull(json['lodgeCity']),
    gstin: asStringOrNull(json['gstin']),
    isGstRegistered: asBool(json['isGstRegistered']),
  );

  /// The nights the stay ran for, from its own dates.
  int get nights {
    final a = DateTime.tryParse(checkInDate ?? '');
    final b = DateTime.tryParse(checkOutDate ?? '');
    if (a == null || b == null) return 0;
    return b.difference(a).inDays;
  }

  /// The nightly rate, off the room's own line rather than divided out of a
  /// total — a stay with extras on it would otherwise print a "per day" that
  /// is not the rate anybody agreed.
  num? get perDay {
    if (nights <= 0 || roomCharges.isEmpty) return null;
    final base = roomCharges.first.amount;
    return (base / nights * 100).round() / 100;
  }

  /// Everything charged beyond the room's own rate: the extras, and any
  /// overstay. Named on the document rather than folded into the total.
  List<BillLine> get extras => [
    ...roomCharges.skip(1),
    if (lateCheckoutCharge > 0)
      BillLine(label: 'Late checkout', amount: lateCheckoutCharge),
  ];

  /// What the stay came to before tax was taken out and before anything was
  /// knocked off — the figure the memo writes against the top of the stay
  /// block.
  num get gross => roomSubtotal + foodSubtotal;

  bool get isVoid => status == 'VOID';

  /// How the balance was tendered, as one line or several.
  ///
  /// A bill paid part cash, part UPI reads as both. Documents issued before
  /// payment lines existed carry none, and fall back to the single method the
  /// invoice's own column holds — so every bill has one shape to render.
  List<PaymentLine> get tenders => paymentLines.isNotEmpty
      ? paymentLines
      : [
          if (balancePaymentMethod != null && balanceCollected > 0)
            PaymentLine(
              method: balancePaymentMethod!,
              amount: balanceCollected,
              reference: balanceReference,
            ),
        ];
}

/// The label a document carries. Rule 50 names the taxable receipt; the rest
/// are plain acknowledgements.
const kDocumentLabels = <String, String>{
  'TAX_INVOICE': 'Tax invoice',
  'BILL_OF_SUPPLY': 'Bill of supply',
  'CASH_RECEIPT': 'Cash receipt',
  'RECEIPT_VOUCHER': 'Receipt voucher',
  'ADVANCE_RECEIPT': 'Advance receipt',
};

/// Paper for money taken before the bill exists — a deposit on a
/// reservation, or a top-up while the guest is in house. One booking can
/// hold several, one per handover.
class AdvanceReceipt {
  final int id;
  final String? receiptNumber;
  final String? documentType;
  final String? billingSide;
  final num amountReceived;
  final num cgstAmount;
  final num sgstAmount;
  final num cgstRatePercent;
  final num sgstRatePercent;
  final num stayTotal;
  final num roundOff;
  final num balanceDue;
  final String? paymentMethod;
  final String? paymentReference;
  final List<PaymentLine> paymentLines;
  final String? status;
  final String? voidReason;
  final String? createdAt;

  // ── What the printed receipt names beyond the money ─────────────────────
  final String? guestName;
  final String? guestPhone;
  final int? numGuests;
  final String? roomNumber;
  final String? categoryName;
  final String? checkInDate;
  final String? checkOutDate;

  // ── The property, as it prints on the document ───────────────────────────
  final String? gstin;
  final bool isGstRegistered;
  final String? lodgeName;
  final String? lodgePhone;
  final String? lodgeAddress;
  final String? lodgeCity;
  final String? lodgeState;

  const AdvanceReceipt({
    required this.id,
    this.receiptNumber,
    this.documentType,
    this.billingSide,
    this.amountReceived = 0,
    this.cgstAmount = 0,
    this.sgstAmount = 0,
    this.cgstRatePercent = 0,
    this.sgstRatePercent = 0,
    this.stayTotal = 0,
    this.roundOff = 0,
    this.balanceDue = 0,
    this.paymentMethod,
    this.paymentReference,
    this.paymentLines = const [],
    this.status,
    this.voidReason,
    this.createdAt,
    this.guestName,
    this.guestPhone,
    this.numGuests,
    this.roomNumber,
    this.categoryName,
    this.checkInDate,
    this.checkOutDate,
    this.gstin,
    this.isGstRegistered = false,
    this.lodgeName,
    this.lodgePhone,
    this.lodgeAddress,
    this.lodgeCity,
    this.lodgeState,
  });

  factory AdvanceReceipt.fromJson(Map<String, dynamic> json) => AdvanceReceipt(
    id: asInt(json['id']),
    receiptNumber: asStringOrNull(json['receiptNumber']),
    documentType: asStringOrNull(json['documentType']),
    billingSide: asStringOrNull(json['billingSide']),
    amountReceived: asNum(json['amountReceived']),
    cgstAmount: asNum(json['cgstAmount']),
    sgstAmount: asNum(json['sgstAmount']),
    cgstRatePercent: asNum(json['cgstRatePercent']),
    sgstRatePercent: asNum(json['sgstRatePercent']),
    stayTotal: asNum(json['stayTotal']),
    roundOff: asNum(json['roundOff']),
    balanceDue: asNum(json['balanceDue']),
    paymentMethod: asStringOrNull(json['paymentMethod']),
    paymentReference: asStringOrNull(json['paymentReference']),
    paymentLines:
        (json['paymentLines'] as List?)
            ?.map((e) => PaymentLine.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    status: asStringOrNull(json['status']),
    voidReason: asStringOrNull(json['voidReason']),
    createdAt: asStringOrNull(json['createdAt']),
    guestName: asStringOrNull(json['guestName']),
    guestPhone: asStringOrNull(json['guestPhone']),
    numGuests: asIntOrNull(json['numGuests']),
    roomNumber: asStringOrNull(json['roomNumber']),
    categoryName: asStringOrNull(json['categoryName']),
    checkInDate: asStringOrNull(json['checkInDate']),
    checkOutDate: asStringOrNull(json['checkOutDate']),
    gstin: asStringOrNull(json['gstin']),
    isGstRegistered: asBool(json['isGstRegistered']),
    lodgeName: asStringOrNull(json['lodgeName']),
    lodgePhone: asStringOrNull(json['lodgePhone']),
    lodgeAddress: asStringOrNull(json['lodgeAddress']),
    lodgeCity: asStringOrNull(json['lodgeCity']),
    lodgeState: asStringOrNull(json['lodgeState']),
  );

  bool get isVoid => status == 'VOID';

  /// Whether this advance already covers the whole stay — read off the
  /// figures rather than a flag, the same way the printed document decides
  /// which closing line to print.
  bool get paidInFull => balanceDue <= 0.005;

  /// Every way this arrived, as a list — a receipt taken before split
  /// payments existed, or paid a single way, still reads as one line built
  /// from its own scalar columns, so there is one rendering path rather than
  /// two.
  List<PaymentLine> get tenders => paymentLines.isNotEmpty
      ? paymentLines
      : [
          if (paymentMethod != null)
            PaymentLine(
              method: paymentMethod!,
              amount: amountReceived,
              reference: paymentReference,
            ),
        ];
}
