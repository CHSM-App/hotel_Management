import '../../domain/models/staff.dart';
import '../../domain/repository/staff_repo.dart';
import '../api/api_service.dart';

class StaffImpl implements StaffRepository {
  final ApiService api;

  StaffImpl(this.api);

  @override
  Future<List<StaffMember>> staff() => api.staff();

  @override
  Future<int> createStaff(Map<String, dynamic> body) => api.createStaff(body);

  @override
  Future<StaffMember?> updateStaff(int id, Map<String, dynamic> body) =>
      api.updateStaff(id, body);

  @override
  Future<void> resetStaffPassword(int id, String tempPassword) =>
      api.resetStaffPassword(id, tempPassword);

  @override
  Future<RolesCatalog> roles() => api.roles();

  @override
  Future<String> createRole(Map<String, dynamic> body) => api.createRole(body);

  @override
  Future<LodgeRole> updateRole(String roleKey, Map<String, dynamic> body) =>
      api.updateRole(roleKey, body);

  @override
  Future<LodgeRole> resetRole(String roleKey) => api.resetRole(roleKey);

  @override
  Future<void> deleteRole(String roleKey) => api.deleteRole(roleKey);
}
