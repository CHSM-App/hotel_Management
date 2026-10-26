import 'json.dart';

/// GET /me — who is signed in, and what this property is.
///
/// The bottom bar is built from these two together: `permissions` says what
/// this login may reach, and the lodge's capability flags say what the property
/// actually has. A restaurant hides the rooms tabs even for an owner who can
/// reach everything, exactly as the web dashboard does.
class Me {
  final MeUser user;
  final Lodge lodge;

  const Me({required this.user, required this.lodge});

  factory Me.fromJson(Map<String, dynamic> json) => Me(
    user: MeUser.fromJson(json['user'] as Map<String, dynamic>),
    lodge: Lodge.fromJson(json['lodge'] as Map<String, dynamic>),
  );
}

class MeUser {
  final int id;
  final String name;
  final String? email;
  final String? phone;
  final String role;
  final String? roleName;
  final List<String> permissions;

  const MeUser({
    required this.id,
    required this.name,
    this.email,
    this.phone,
    required this.role,
    this.roleName,
    this.permissions = const [],
  });

  factory MeUser.fromJson(Map<String, dynamic> json) => MeUser(
    // users.id is a BIGINT and arrives as a string.
    id: asInt(json['id']),
    name: json['name']?.toString() ?? '',
    email: asStringOrNull(json['email']),
    // Stored as a number in some rows, text in others; the screen wants text.
    phone: asStringOrNull(json['phone']),
    role: json['role']?.toString() ?? '',
    roleName: asStringOrNull(json['roleName']),
    permissions:
        (json['permissions'] as List?)?.map((e) => e.toString()).toList() ??
        const [],
  );

  bool can(String permission) => permissions.contains(permission);

  /// True if this login holds any one of the given permissions — mirrors the
  /// web's array-based `permission: [...]` any-of check in propertyProfile.js.
  bool canAny(List<String> anyOf) =>
      anyOf.any((permission) => permissions.contains(permission));
}

class Lodge {
  final int id;
  final String name;
  final String? slug;

  /// The 3-4 letter start of every booking number (SKR2610001) — set by
  /// Vengurla Tech, read-only here.
  final String? bookingCode;
  final String? phone;
  final String? whatsappNumber;
  final String? address;
  final String? city;
  final String? state;
  final String? nameMr;
  final String? addressMr;
  final double? latitude;
  final double? longitude;

  /// HOUR_24, NIGHT_BASED, CYCLE or HYBRID — set by Vengurla Tech, not editable here.
  final String? checkinMode;

  /// GST-registered properties issue tax invoices; the rest issue bills of
  /// supply. Every price here is GST-inclusive either way — tax is extracted
  /// from within the amount, never added on top.
  final bool isGstRegistered;
  final String? gstin;
  final bool isSpecifiedPremises;

  /// Null when no logo has been uploaded — `/hotel-logos/<file>`, served
  /// without auth, so it loads straight into an `Image.network`.
  final String? logoUrl;

  /// Whether [logoUrl] also prints on the bill masthead, not just the
  /// dashboard brand mark — a separate switch so a logo can exist without
  /// committing to it on every printed document.
  final bool showLogoOnReceipt;

  /// Owner/staff-set hero background of the public page — `/lodge-hero-images/<file>`.
  /// Null falls back to the first room/venue photo.
  final String? heroImageUrl;

  // ── What this property is ────────────────────────────────────────────────
  final bool hasRooms;
  final bool servesFood;
  final bool foodRoomService;
  final bool foodTableService;
  final bool hasEvents;
  final bool hasAssets;
  final bool hasExpenses;
  final bool hasOtherServices;
  final bool hasHousekeeping;
  final bool hasLaundry;

  const Lodge({
    required this.id,
    required this.name,
    this.slug,
    this.bookingCode,
    this.phone,
    this.whatsappNumber,
    this.address,
    this.city,
    this.state,
    this.nameMr,
    this.addressMr,
    this.latitude,
    this.longitude,
    this.checkinMode,
    this.isGstRegistered = false,
    this.gstin,
    this.isSpecifiedPremises = false,
    this.logoUrl,
    this.showLogoOnReceipt = false,
    this.heroImageUrl,
    this.hasRooms = false,
    this.servesFood = false,
    this.foodRoomService = false,
    this.foodTableService = false,
    this.hasEvents = false,
    this.hasAssets = false,
    this.hasExpenses = false,
    this.hasOtherServices = false,
    this.hasHousekeeping = false,
    this.hasLaundry = false,
  });

  factory Lodge.fromJson(Map<String, dynamic> json) => Lodge(
    id: asInt(json['id']),
    name: json['name']?.toString() ?? '',
    slug: asStringOrNull(json['slug']),
    bookingCode: asStringOrNull(json['bookingCode']),
    phone: asStringOrNull(json['phone']),
    whatsappNumber: asStringOrNull(json['whatsappNumber']),
    address: asStringOrNull(json['address']),
    city: asStringOrNull(json['city']),
    state: asStringOrNull(json['state']),
    nameMr: asStringOrNull(json['nameMr']),
    addressMr: asStringOrNull(json['addressMr']),
    latitude: _asDoubleOrNull(json['latitude']),
    longitude: _asDoubleOrNull(json['longitude']),
    checkinMode: asStringOrNull(json['checkinMode']),
    isGstRegistered: asBool(json['isGstRegistered']),
    gstin: asStringOrNull(json['gstin']),
    isSpecifiedPremises: asBool(json['isSpecifiedPremises']),
    logoUrl: asStringOrNull(json['logoUrl']),
    showLogoOnReceipt: asBool(json['showLogoOnReceipt']),
    heroImageUrl: asStringOrNull(json['heroImageUrl']),
    hasRooms: asBool(json['hasRooms']),
    servesFood: asBool(json['servesFood']),
    foodRoomService: asBool(json['foodRoomService']),
    foodTableService: asBool(json['foodTableService']),
    hasEvents: asBool(json['hasEvents']),
    hasAssets: asBool(json['hasAssets']),
    hasExpenses: asBool(json['hasExpenses']),
    hasOtherServices: asBool(json['hasOtherServices']),
    hasHousekeeping: asBool(json['hasHousekeeping']),
    hasLaundry: asBool(json['hasLaundry']),
  );
}

double? _asDoubleOrNull(dynamic value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  return double.tryParse(value.toString());
}
