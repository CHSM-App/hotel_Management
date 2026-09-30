import '../models/staff.dart';
import '../repository/staff_repo.dart';

class StaffUsecase {
  final StaffRepository repository;

  StaffUsecase(this.repository);

  Future<List<StaffMember>> staff() => repository.staff();

  Future<int> createStaff(Map<String, dynamic> body) =>
      repository.createStaff(body);

  Future<StaffMember?> updateStaff(int id, Map<String, dynamic> body) =>
      repository.updateStaff(id, body);

  Future<void> resetStaffPassword(int id, String tempPassword) =>
      repository.resetStaffPassword(id, tempPassword);

  Future<RolesCatalog> roles() => repository.roles();

  Future<String> createRole(Map<String, dynamic> body) =>
      repository.createRole(body);

  Future<LodgeRole> updateRole(String roleKey, Map<String, dynamic> body) =>
      repository.updateRole(roleKey, body);

  Future<LodgeRole> resetRole(String roleKey) => repository.resetRole(roleKey);

  Future<void> deleteRole(String roleKey) => repository.deleteRole(roleKey);
}
