import 'json.dart';

/// A returning guest, offered back as a suggestion while a name is typed on a
/// new booking — GET /bookings/guest-search?q=. See the same lookup on the
/// web desk's own booking form (Bookings.jsx's GuestNameField).
class GuestMatch {
  /// The stay this suggestion was read off — quoted back on save as the
  /// booking to copy the ID document from.
  final int bookingId;

  final String name;
  final String? phone;
  final String? idProofType;
  final String? idProofNumber;

  /// Whether the document behind [idProofType]/[idProofNumber] is actually
  /// still on disk — checked server-side, never assumed from the row alone.
  final bool hasIdProofDocument;

  final int stayCount;
  final String? lastStayDate;

  const GuestMatch({
    required this.bookingId,
    required this.name,
    this.phone,
    this.idProofType,
    this.idProofNumber,
    this.hasIdProofDocument = false,
    this.stayCount = 1,
    this.lastStayDate,
  });

  factory GuestMatch.fromJson(Map<String, dynamic> json) => GuestMatch(
    bookingId: asInt(json['bookingId']),
    name: json['name']?.toString() ?? '',
    phone: asStringOrNull(json['phone']),
    idProofType: asStringOrNull(json['idProofType']),
    idProofNumber: asStringOrNull(json['idProofNumber']),
    hasIdProofDocument: asBool(json['hasIdProofDocument']),
    stayCount: asInt(json['stayCount'], fallback: 1),
    lastStayDate: asStringOrNull(json['lastStayDate']),
  );
}
