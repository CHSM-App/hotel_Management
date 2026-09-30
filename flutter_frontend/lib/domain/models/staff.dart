import 'json.dart';

/// One login on this property — mirrors the web's `mapUser` shape from
/// staff.service.js.
class StaffMember {
  final int id;
  final String name;
  final String? email;
  final String phone;
  final String roleKey;
  final String roleName;
  final bool isActive;

  /// True right after a reset — they'll be forced to choose their own on
  /// next sign-in. Shown as a small note next to Status, same as the web
  /// table's own "Temporary password" line.
  final bool mustResetPassword;

  const StaffMember({
    required this.id,
    required this.name,
    this.email,
    required this.phone,
    required this.roleKey,
    required this.roleName,
    required this.isActive,
    this.mustResetPassword = false,
  });

  factory StaffMember.fromJson(Map<String, dynamic> json) => StaffMember(
    id: asInt(json['id']),
    name: json['name']?.toString() ?? '',
    email: asStringOrNull(json['email']),
    phone: json['phone']?.toString() ?? '',
    roleKey: json['roleKey']?.toString() ?? '',
    roleName: json['roleName']?.toString() ?? '',
    isActive: asBool(json['isActive']),
    mustResetPassword: asBool(json['mustResetPassword']),
  );
}

/// A role available to this lodge — one of the built-ins (optionally
/// overridden for this property) or one it created itself. Mirrors the
/// web's `mapRole` shape from roles.service.js.
class LodgeRole {
  final int id;
  final String roleKey;
  final String name;
  final String? description;
  final bool isSystem;

  /// A built-in this lodge has customised — shown as "Customised" on the web
  /// so an owner can tell "changed from the default" apart from "left as
  /// shipped". [reset] drops the override.
  final bool isOverridden;
  final bool isCustom;
  final List<String> permissions;
  final bool isActive;

  const LodgeRole({
    required this.id,
    required this.roleKey,
    required this.name,
    this.description,
    required this.isSystem,
    required this.isOverridden,
    required this.isCustom,
    required this.permissions,
    required this.isActive,
  });

  factory LodgeRole.fromJson(Map<String, dynamic> json) => LodgeRole(
    id: asInt(json['id']),
    roleKey: json['roleKey']?.toString() ?? '',
    name: json['name']?.toString() ?? '',
    description: asStringOrNull(json['description']),
    isSystem: asBool(json['isSystem']),
    isOverridden: asBool(json['isOverridden']),
    isCustom: asBool(json['isCustom']),
    permissions:
        (json['permissions'] as List?)?.map((e) => e.toString()).toList() ??
        const [],
    isActive: asBool(json['isActive']),
  );
}

/// One entry in the fixed permission catalog GET /roles ships alongside the
/// role list — see permissions.js on the server. Cut to what this property
/// can actually do, so a rooms-only lodge is never offered a checkbox for a
/// section it doesn't have.
class PermissionInfo {
  final String key;
  final String label;
  final String description;

  const PermissionInfo({
    required this.key,
    required this.label,
    required this.description,
  });

  factory PermissionInfo.fromJson(Map<String, dynamic> json) =>
      PermissionInfo(
        key: json['key']?.toString() ?? '',
        label: json['label']?.toString() ?? '',
        description: json['description']?.toString() ?? '',
      );
}

/// GET /roles' whole payload — the roles list and the catalog it was built
/// against, fetched together so the screen never keeps its own copy of the
/// catalog in sync by hand.
class RolesCatalog {
  final List<LodgeRole> roles;
  final List<PermissionInfo> permissions;

  const RolesCatalog({required this.roles, required this.permissions});
}
