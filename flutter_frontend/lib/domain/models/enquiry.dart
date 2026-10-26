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
  final String? summary;
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
    this.summary,
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
    summary: asStringOrNull(json['summary']),
    notes: asStringOrNull(json['notes']),
    status: json['status']?.toString() ?? 'NEW',
    createdAt: asStringOrNull(json['createdAt']),
    handledAt: asStringOrNull(json['handledAt']),
  );

  /// Still waiting on the lodge — the two states a Converted/Close makes sense
  /// from.
  bool get isOpen => status == 'NEW' || status == 'CONTACTED';
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
