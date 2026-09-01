import 'json.dart';

/// A stay.
///
/// Nearly everything is nullable: a list row carries far less than the detail
/// endpoint does, and both decode through this class.
class Booking {
  final int id;
  final int? roomId;
  final String? roomNumber;
  final String? categoryName;
  final String? guestName;
  final String? guestPhone;
  final int? numGuests;
  final String? checkInDate;
  final String? checkOutDate;

  /// BOOKED, CHECKED_IN, CHECKED_OUT or CANCELLED.
  final String? status;

  final num? totalPrice;
  final num? discountAmount;
  final num? advanceAmount;

  /// The first tender. A stay whose advance arrived two ways still has one
  /// method here — [advancePaymentLines] is what says the rest.
  final String? advancePaymentMethod;

  /// Every way the advance actually arrived. Only the detail endpoint carries
  /// it; a list row falls back to the single method above.
  final List<PaymentLine>? advancePaymentLines;

  final String? advanceReference;

  /// The nightly rate agreed for this stay, where it is not the category's
  /// own — null on most stays.
  final num? basePriceOverride;

  const Booking({
    required this.id,
    this.roomId,
    this.roomNumber,
    this.categoryName,
    this.guestName,
    this.guestPhone,
    this.numGuests,
    this.checkInDate,
    this.checkOutDate,
    this.status,
    this.totalPrice,
    this.discountAmount,
    this.advanceAmount,
    this.advancePaymentMethod,
    this.advancePaymentLines,
    this.advanceReference,
    this.basePriceOverride,
  });

  factory Booking.fromJson(Map<String, dynamic> json) => Booking(
    // bookings.id and rooms.id are BIGINTs and arrive as strings, while
    // num_guests is an INT and arrives as a number — see json.dart.
    id: asInt(json['id']),
    roomId: asIntOrNull(json['roomId']),
    roomNumber: asStringOrNull(json['roomNumber']),
    categoryName: asStringOrNull(json['categoryName']),
    guestName: asStringOrNull(json['guestName']),
    guestPhone: asStringOrNull(json['guestPhone']),
    numGuests: asIntOrNull(json['numGuests']),
    checkInDate: asStringOrNull(json['checkInDate']),
    checkOutDate: asStringOrNull(json['checkOutDate']),
    status: asStringOrNull(json['status']),
    totalPrice: asNumOrNull(json['totalPrice']),
    discountAmount: asNumOrNull(json['discountAmount']),
    advanceAmount: asNumOrNull(json['advanceAmount']),
    advancePaymentMethod: asStringOrNull(json['advancePaymentMethod']),
    advancePaymentLines: (json['advancePaymentLines'] as List?)
        ?.map((e) => PaymentLine.fromJson(e as Map<String, dynamic>))
        .toList(),
    advanceReference: asStringOrNull(json['advanceReference']),
    basePriceOverride: asNumOrNull(json['basePriceOverride']),
  );

  /// What is still to collect, before the bill is cut.
  num get balanceDue => (totalPrice ?? 0) - (advanceAmount ?? 0);

  /// How the advance reads on screen. One method prints as its own name; a
  /// split names each with what arrived that way, because "CASH" alone against
  /// an advance of ₹200 cash and ₹100 UPI is something the guest can see is
  /// wrong — and it is the guest who paid it.
  String get advanceDescription {
    final lines = advancePaymentLines;
    if (lines == null || lines.isEmpty) return advancePaymentMethod ?? '';
    if (lines.length == 1) return lines.first.method;
    return lines.map((l) => '${l.method} ₹${l.amount}').join(' · ');
  }
}

/// One way money arrived.
///
/// A guest settling a bill often hands over some cash and pays the rest by UPI
/// or card. Every money document used to record a single method, so the other
/// half was filed under a method it never used.
class PaymentLine {
  final String method;
  final num amount;

  /// Required on UPI and card, absent on cash — cash leaves no trail to
  /// reconcile against a settlement statement.
  final String? reference;

  const PaymentLine({
    required this.method,
    required this.amount,
    this.reference,
  });

  factory PaymentLine.fromJson(Map<String, dynamic> json) => PaymentLine(
    method: json['method']?.toString() ?? '',
    amount: asNum(json['amount']),
    reference: asStringOrNull(json['reference']),
  );

  Map<String, dynamic> toJson() => {
    'method': method,
    'amount': amount,
    if (reference != null && reference!.isNotEmpty) 'reference': reference,
  };
}
