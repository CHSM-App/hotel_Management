import 'invoice.dart';
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

  /// The register's own two fields — only on the list endpoint. The number of
  /// whatever bill was last issued against this stay, and what it came to (or
  /// [totalPrice] where none has been raised yet).
  final String? invoiceNumber;
  final num? billAmount;

  /// The rest of the party, by name — only on the register's own fetch, for
  /// its search box to find a stay by anyone travelling on it, not only by
  /// whoever's name the booking was taken under.
  final List<String> coGuestNames;

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

  // ── Only on the detail endpoint — everything the tape chart's own lean
  // fetch leaves out, and everything the desk reads this whole page for.
  final String? idProofType;
  final String? idProofNumber;
  final bool hasIdProofDocument;

  /// When the guest actually walked in and actually left — separate from the
  /// dates booked, which are what was sold, not what happened.
  final String? actualCheckInAt;
  final String? actualCheckOutAt;

  final int? lateCheckoutMinutes;
  final num lateCheckoutCharge;

  /// Read out to a checked-in guest so they can order food from the room's
  /// QR code. Null once checked out, or on a property with no food service.
  final String? foodPin;

  /// Set once the guest has failed that PIN too many times — non-null means
  /// ordering is blocked for the room until reception clears it.
  final String? foodOrderingLockedUntil;

  final String? cancelReason;
  final num? refundAmount;
  final String? refundPaymentMethod;
  final num? cancellationCharge;
  final String? cancellationChargePaymentMethod;

  final List<SwitchableCharge> switchableCharges;
  final List<GuestInfo> guests;
  final int childCount;
  final List<Vehicle> vehicles;

  /// What the room charge is made of — base rate, season, each extra, summed
  /// across the nights each applied to, from the snapshot frozen at booking
  /// time. Empty on a stay taken before the snapshot existed.
  final List<RoomChargeLine> roomCharges;

  /// The bill, once one has been issued — null on every stay still unbilled.
  final Invoice? invoice;

  /// A stay stays editable right up until its bill is issued — extend it,
  /// move rooms, correct the party, fix a detail. Once this is true only the
  /// server's own further guards (room and check-out date edits close once
  /// checked out) narrow what is left.
  final bool hasIssuedInvoice;

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
    this.invoiceNumber,
    this.billAmount,
    this.coGuestNames = const [],
    this.advancePaymentMethod,
    this.advancePaymentLines,
    this.advanceReference,
    this.basePriceOverride,
    this.idProofType,
    this.idProofNumber,
    this.hasIdProofDocument = false,
    this.actualCheckInAt,
    this.actualCheckOutAt,
    this.lateCheckoutMinutes,
    this.lateCheckoutCharge = 0,
    this.foodPin,
    this.foodOrderingLockedUntil,
    this.cancelReason,
    this.refundAmount,
    this.refundPaymentMethod,
    this.cancellationCharge,
    this.cancellationChargePaymentMethod,
    this.switchableCharges = const [],
    this.guests = const [],
    this.childCount = 0,
    this.vehicles = const [],
    this.roomCharges = const [],
    this.invoice,
    this.hasIssuedInvoice = false,
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
    invoiceNumber: asStringOrNull(json['invoiceNumber']),
    billAmount: asNumOrNull(json['billAmount']),
    coGuestNames: (json['coGuestNames'] as List?)
            ?.map((e) => e.toString())
            .toList() ??
        const [],
    advancePaymentMethod: asStringOrNull(json['advancePaymentMethod']),
    advancePaymentLines: (json['advancePaymentLines'] as List?)
        ?.map((e) => PaymentLine.fromJson(e as Map<String, dynamic>))
        .toList(),
    advanceReference: asStringOrNull(json['advanceReference']),
    basePriceOverride: asNumOrNull(json['basePriceOverride']),
    idProofType: asStringOrNull(json['idProofType']),
    idProofNumber: asStringOrNull(json['idProofNumber']),
    hasIdProofDocument: asBool(json['hasIdProofDocument']),
    actualCheckInAt: asStringOrNull(json['actualCheckInAt']),
    actualCheckOutAt: asStringOrNull(json['actualCheckOutAt']),
    lateCheckoutMinutes: asIntOrNull(json['lateCheckoutMinutes']),
    lateCheckoutCharge: asNum(json['lateCheckoutCharge']),
    foodPin: asStringOrNull(json['foodPin']),
    foodOrderingLockedUntil: asStringOrNull(json['foodOrderingLockedUntil']),
    cancelReason: asStringOrNull(json['cancelReason']),
    refundAmount: asNumOrNull(json['refundAmount']),
    refundPaymentMethod: asStringOrNull(json['refundPaymentMethod']),
    cancellationCharge: asNumOrNull(json['cancellationCharge']),
    cancellationChargePaymentMethod: asStringOrNull(
      json['cancellationChargePaymentMethod'],
    ),
    switchableCharges: (json['switchableCharges'] as List?)
            ?.map((e) => SwitchableCharge.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    guests: (json['guests'] as List?)
            ?.map((e) => GuestInfo.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    childCount: asInt(json['childCount']),
    vehicles: (json['vehicles'] as List?)
            ?.map((e) => Vehicle.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    roomCharges: (json['roomCharges'] as List?)
            ?.map((e) => RoomChargeLine.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    invoice: json['invoice'] == null
        ? null
        : Invoice.fromJson(json['invoice'] as Map<String, dynamic>),
    hasIssuedInvoice: asBool(json['hasIssuedInvoice']),
  );

  /// What is still to collect, before the bill is cut — the room charge and
  /// whatever was agreed for leaving late, less the advance. Deliberately
  /// before tax and rounding: the bill works out GST per night against its
  /// own slabs, so a figure worked out here would differ from the one the
  /// guest is eventually handed.
  num get outstandingBeforeTax =>
      (totalPrice ?? 0) + lateCheckoutCharge - (advanceAmount ?? 0);

  /// Kept for the places that still ask for a plain figure rather than the
  /// pre-tax breakdown above.
  num get balanceDue => (totalPrice ?? 0) - (advanceAmount ?? 0);

  /// Whether what was taken at booking already covers the whole stay — read
  /// off the two figures rather than stored, since the server allows an
  /// advance equal to the stay and once it is, "advance" is the wrong word
  /// for it everywhere this reads.
  bool get paidInFull =>
      advanceAmount != null &&
      totalPrice != null &&
      (advanceAmount! * 100).round() >= (totalPrice! * 100).round();

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

  int? get nights {
    final a = DateTime.tryParse(checkInDate ?? '');
    final b = DateTime.tryParse(checkOutDate ?? '');
    if (a == null || b == null) return null;
    return b.difference(a).inDays;
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

/// An extra switched on for this stay — AC, an extra bed, whatever the lodge
/// sells beyond the room itself.
class SwitchableCharge {
  final int id;
  final String name;
  final num chargePerNight;
  final num? agreedAmount;
  final num quantity;

  const SwitchableCharge({
    required this.id,
    required this.name,
    required this.chargePerNight,
    this.agreedAmount,
    this.quantity = 1,
  });

  factory SwitchableCharge.fromJson(Map<String, dynamic> json) =>
      SwitchableCharge(
        id: asInt(json['id']),
        name: json['name']?.toString() ?? '',
        chargePerNight: asNum(json['chargePerNight']),
        agreedAmount: asNumOrNull(json['agreedAmount']),
        quantity: asNum(json['quantity'], fallback: 1),
      );
}

/// A co-guest on the party, beyond the primary guest the booking is named
/// for.
class GuestInfo {
  final int id;
  final String name;
  final String? phone;
  final String? idProofType;
  final String? idProofNumber;
  final bool hasIdProofDocument;
  final bool isChild;

  const GuestInfo({
    required this.id,
    required this.name,
    this.phone,
    this.idProofType,
    this.idProofNumber,
    this.hasIdProofDocument = false,
    this.isChild = false,
  });

  factory GuestInfo.fromJson(Map<String, dynamic> json) => GuestInfo(
    id: asInt(json['id']),
    name: json['name']?.toString() ?? '',
    phone: asStringOrNull(json['phone']),
    idProofType: asStringOrNull(json['idProofType']),
    idProofNumber: asStringOrNull(json['idProofNumber']),
    hasIdProofDocument: asBool(json['hasIdProofDocument']),
    isChild: asBool(json['isChild']),
  );
}

class Vehicle {
  final String number;
  final String? type;

  const Vehicle({required this.number, this.type});

  factory Vehicle.fromJson(Map<String, dynamic> json) => Vehicle(
    number: json['number']?.toString() ?? '',
    type: asStringOrNull(json['type']),
  );
}

/// One line of what the room charge is made of — the base rate, a season
/// uplift, one extra — summed across every night it applied to.
class RoomChargeLine {
  final String label;
  final num amount;
  final int nights;

  const RoomChargeLine({
    required this.label,
    required this.amount,
    required this.nights,
  });

  factory RoomChargeLine.fromJson(Map<String, dynamic> json) =>
      RoomChargeLine(
        label: json['label']?.toString() ?? '',
        amount: asNum(json['amount']),
        nights: asInt(json['nights']),
      );
}
