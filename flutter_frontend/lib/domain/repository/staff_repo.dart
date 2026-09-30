import '../models/staff.dart';

/// Staff logins and the roles that gate what each one can reach — mirrors
/// StaffAndRoles.jsx's shell exactly: one screen, two tabs, one fetch that
/// loads both.
abstract class StaffRepository {
  Future<List<StaffMember>> staff();

  /// Answers with the new login's id — the caller reloads [staff] itself
  /// rather than trusting a partial echo back.
  Future<int> createStaff(Map<String, dynamic> body);

  Future<StaffMember?> updateStaff(int id, Map<String, dynamic> body);

  Future<void> resetStaffPassword(int id, String tempPassword);

  Future<RolesCatalog> roles();

  /// Answers with the new role's key.
  Future<String> createRole(Map<String, dynamic> body);

  Future<LodgeRole> updateRole(String roleKey, Map<String, dynamic> body);

  /// Drops a built-in role's lodge-specific override, back to the default.
  Future<LodgeRole> resetRole(String roleKey);

  Future<void> deleteRole(String roleKey);
}
