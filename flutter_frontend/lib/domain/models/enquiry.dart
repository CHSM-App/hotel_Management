import 'json.dart';

/// One enquiry a guest sent from the lodge's public page — GET /enquiries.
/// Stored first (rather than only handed to WhatsApp) so the lodge sees it
/// whether or not the guest pressed send; kept for 30 days.
class Enquiry {
  final int id;

  /// What the guest is shown (and can quote) after submitting — ENQ-XXXXXX.
  final String referenceCode;

  /// ROOM, EVENT, SERVICE or GENERAL.
  final String kind;
  final String name;
  final String phone;
  final String? checkInDate;
  final String? checkOutDate;
  final String? eventDate;
  final String? eventType;
  final int? guests;
  final int? roomTypeId;
  final int? venueId;

  /// Room-extra ids on a ROOM enquiry, event add-on ids on an EVENT one —
  /// two unrelated id spaces, resolved against [EnquiryCatalogue].
  final List<int> addonIds;
  final String? notes;

  /// NEW, CONTACTED, CONVERTED or CLOSED.
  final String status;
  final String? createdAt;
  final String? handledAt;

  const Enquiry({
    required this.id,
    required this.referenceCode,
    required this.kind,
    required this.name,
    required this.phone,
    this.checkInDate,
    this.checkOutDate,
    this.eventDate,
    this.eventType,
    this.guests,
    this.roomTypeId,
    this.venueId,
    this.addonIds = const [],
    this.notes,
    required this.status,
    this.createdAt,
    this.handledAt,
  });

  factory Enquiry.fromJson(Map<String, dynamic> json) => Enquiry(
    id: asInt(json['id']),
    referenceCode: json['referenceCode']?.toString() ?? '',
    kind: json['kind']?.toString() ?? 'GENERAL',
    name: json['name']?.toString() ?? '',
    phone: json['phone']?.toString() ?? '',
    checkInDate: asStringOrNull(json['checkInDate']),
    checkOutDate: asStringOrNull(json['checkOutDate']),
    eventDate: asStringOrNull(json['eventDate']),
    eventType: asStringOrNull(json['eventType']),
    guests: asIntOrNull(json['guests']),
    roomTypeId: asIntOrNull(json['roomTypeId']),
    venueId: asIntOrNull(json['venueId']),
    addonIds: [
      for (final v in (json['addonIds'] as List? ?? const []))
        if (asIntOrNull(v) != null) asIntOrNull(v)!,
    ],
    notes: asStringOrNull(json['notes']),
    status: json['status']?.toString() ?? 'NEW',
    createdAt: asStringOrNull(json['createdAt']),
    handledAt: asStringOrNull(json['handledAt']),
  );

  /// Still waiting on the lodge — the two states a Converted/Close makes sense
  /// from.
  bool get isOpen => status == 'NEW' || status == 'CONTACTED';
}

/// GET /enquiries/catalogue — id -> name maps for turning an enquiry's
/// roomTypeId / venueId / addonIds back into words.
class EnquiryCatalogue {
  final Map<int, String> roomTypes;
  final Map<int, String> venues;
  final Map<int, String> addons;
  final Map<int, String> roomExtras;

  const EnquiryCatalogue({
    this.roomTypes = const {},
    this.venues = const {},
    this.addons = const {},
    this.roomExtras = const {},
  });

  factory EnquiryCatalogue.fromJson(Map<String, dynamic> json) {
    Map<int, String> byId(String key) => {
      for (final m in (json[key] as List? ?? const []))
        asInt((m as Map)['id']): m['name']?.toString() ?? '',
    };
    return EnquiryCatalogue(
      roomTypes: byId('roomTypes'),
      venues: byId('venues'),
      addons: byId('addons'),
      roomExtras: byId('roomExtras'),
    );
  }

  /// Names for [e]'s extras — room extras for a ROOM enquiry, event add-ons
  /// for an EVENT one. Ids with no match read as nothing.
  List<String> extrasFor(Enquiry e) {
    final map = e.kind == 'ROOM' ? roomExtras : addons;
    return [
      for (final id in e.addonIds)
        if ((map[id] ?? '').isNotEmpty) map[id]!,
    ];
  }
}

/// One row of GET /enquiries/summary — the NEW ones only, for the alert bell.
class EnquiryAlertItem {
  final int id;
  final String referenceCode;
  final String kind;
  final String name;

  const EnquiryAlertItem({
    required this.id,
    required this.referenceCode,
    required this.kind,
    required this.name,
  });

  factory EnquiryAlertItem.fromJson(Map<String, dynamic> json) =>
      EnquiryAlertItem(
        id: asInt(json['id']),
        referenceCode: json['referenceCode']?.toString() ?? '',
        kind: json['kind']?.toString() ?? 'GENERAL',
        name: json['name']?.toString() ?? '',
      );
}
