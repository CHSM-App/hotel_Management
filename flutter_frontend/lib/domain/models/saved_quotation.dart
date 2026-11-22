import 'json.dart';
import 'quote.dart';

/// One room of a saved quotation: what was chosen and the server's price for
/// it, frozen when the quotation was saved. Mirrors the `payload` entries in
/// backend/src/modules/quotations/quotations.service.js.
class SavedQuotationRoom {
  final int roomId;
  final String roomNumber;
  final String categoryName;
  final String fromDate;
  final String toDate;
  final String chargeIds;
  final PriceSimulation result;

  const SavedQuotationRoom({
    required this.roomId,
    required this.roomNumber,
    required this.categoryName,
    required this.fromDate,
    required this.toDate,
    required this.chargeIds,
    required this.result,
  });

  factory SavedQuotationRoom.fromJson(Map<String, dynamic> j) => SavedQuotationRoom(
    roomId: asInt(j['roomId']),
    roomNumber: j['roomNumber']?.toString() ?? '',
    categoryName: j['categoryName']?.toString() ?? '',
    fromDate: j['fromDate']?.toString() ?? '',
    toDate: j['toDate']?.toString() ?? '',
    chargeIds: j['chargeIds']?.toString() ?? '',
    result: PriceSimulation.fromJson(Map<String, dynamic>.from(j['result'] as Map)),
  );
}

/// A quotation kept for later. [status] is `ACTIVE`, `EXPIRED` or `BOOKED` —
/// the server works expiry out on every read (a quotation is Expired from its
/// check-in date onward), so the app never has to compare dates itself.
class SavedQuotation {
  final int id;
  final String referenceCode;
  final String? guestName;
  final String? guestPhone;
  final String checkInDate;
  final String lastCheckOutDate;
  final num total;
  final String roomSummary;
  final String status;
  final int? bookedBookingId;

  /// Only present on a single fetch (and the save response), not in the list.
  final List<SavedQuotationRoom> rooms;

  const SavedQuotation({
    required this.id,
    required this.referenceCode,
    this.guestName,
    this.guestPhone,
    required this.checkInDate,
    required this.lastCheckOutDate,
    required this.total,
    required this.roomSummary,
    required this.status,
    this.bookedBookingId,
    this.rooms = const [],
  });

  bool get isActive => status == 'ACTIVE';
  bool get isExpired => status == 'EXPIRED';
  bool get isBooked => status == 'BOOKED';

  factory SavedQuotation.fromJson(Map<String, dynamic> j) => SavedQuotation(
    id: asInt(j['id']),
    referenceCode: j['referenceCode']?.toString() ?? '',
    guestName: j['guestName']?.toString(),
    guestPhone: j['guestPhone']?.toString(),
    checkInDate: j['checkInDate']?.toString() ?? '',
    lastCheckOutDate: j['lastCheckOutDate']?.toString() ?? '',
    total: asNum(j['total']),
    roomSummary: j['roomSummary']?.toString() ?? '',
    status: j['status']?.toString() ?? 'ACTIVE',
    bookedBookingId: j['bookedBookingId'] == null ? null : asInt(j['bookedBookingId']),
    rooms: ((j['rooms'] as List?) ?? const [])
        .map((e) => SavedQuotationRoom.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList(),
  );
}
