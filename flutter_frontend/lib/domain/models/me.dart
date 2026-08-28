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
  final bool mustResetPassword;

  const MeUser({
    required this.id,
    required this.name,
    this.email,
    this.phone,
    required this.role,
    this.roleName,
    this.permissions = const [],
    this.mustResetPassword = false,
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
    mustResetPassword: asBool(json['mustResetPassword']),
  );

  bool can(String permission) => permissions.contains(permission);
}

class Lodge {
  final int id;
  final String name;
  final String? slug;
  final String? phone;
  final String? address;
  final String? city;
  final String? state;

  /// GST-registered properties issue tax invoices; the rest issue bills of
  /// supply. Every price here is GST-inclusive either way — tax is extracted
  /// from within the amount, never added on top.
  final bool isGstRegistered;
  final String? gstin;

  // ── What this property is ────────────────────────────────────────────────
  final bool hasRooms;
  final bool servesFood;
  final bool foodRoomService;
  final bool foodTableService;

  const Lodge({
    required this.id,
    required this.name,
    this.slug,
    this.phone,
    this.address,
    this.city,
    this.state,
    this.isGstRegistered = false,
    this.gstin,
    this.hasRooms = false,
    this.servesFood = false,
    this.foodRoomService = false,
    this.foodTableService = false,
  });

  factory Lodge.fromJson(Map<String, dynamic> json) => Lodge(
    id: asInt(json['id']),
    name: json['name']?.toString() ?? '',
    slug: asStringOrNull(json['slug']),
    phone: asStringOrNull(json['phone']),
    address: asStringOrNull(json['address']),
    city: asStringOrNull(json['city']),
    state: asStringOrNull(json['state']),
    isGstRegistered: asBool(json['isGstRegistered']),
    gstin: asStringOrNull(json['gstin']),
    hasRooms: asBool(json['hasRooms']),
    servesFood: asBool(json['servesFood']),
    foodRoomService: asBool(json['foodRoomService']),
    foodTableService: asBool(json['foodTableService']),
  );
}
