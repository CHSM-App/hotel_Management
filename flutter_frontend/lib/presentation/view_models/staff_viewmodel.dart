library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/staff.dart';
import '../../domain/usecase/staff_usecase.dart';

/// Staff logins and the roles that gate them — one notifier for the whole
/// screen, the same shape ExpensesViewModel keeps for its own multi-tab
/// section, so both tabs of StaffRolesScreen share one load.
class StaffState {
  final bool isLoading;
  final String? error;
  final List<StaffMember> staff;
  final List<LodgeRole> roles;
  final List<PermissionInfo> permissions;
  final bool submitting;

  const StaffState({
    this.isLoading = false,
    this.error,
    this.staff = const [],
    this.roles = const [],
    this.permissions = const [],
    this.submitting = false,
  });

  StaffState copyWith({
    bool? isLoading,
    String? error,
    bool clearError = false,
    List<StaffMember>? staff,
    List<LodgeRole>? roles,
    List<PermissionInfo>? permissions,
    bool? submitting,
  }) => StaffState(
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : (error ?? this.error),
    staff: staff ?? this.staff,
    roles: roles ?? this.roles,
    permissions: permissions ?? this.permissions,
    submitting: submitting ?? this.submitting,
  );

  String labelFor(String permissionKey) => permissions
      .firstWhere(
        (p) => p.key == permissionKey,
        orElse: () => PermissionInfo(
          key: permissionKey,
          label: permissionKey,
          description: '',
        ),
      )
      .label;
}

class StaffViewModel extends StateNotifier<StaffState> {
  final StaffUsecase usecase;

  StaffViewModel(this.usecase) : super(const StaffState());

  Future<void> loadAll() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final results = await Future.wait([usecase.staff(), usecase.roles()]);
      final staff = results[0] as List<StaffMember>;
      final catalog = results[1] as RolesCatalog;
      state = state.copyWith(
        isLoading: false,
        staff: staff,
        roles: catalog.roles,
        permissions: catalog.permissions,
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
    }
  }

  // ── Staff ─────────────────────────────────────────────────────────────

  Future<bool> saveStaff(Map<String, dynamic> body, {int? id}) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateStaff(id, body);
      } else {
        await usecase.createStaff(body);
      }
      state = state.copyWith(submitting: false);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  /// Owners can't be disabled from here — the backend refuses the last
  /// active owner anyway; the caller hides the control for that row instead
  /// of only ever offering an error.
  Future<bool> toggleStaffActive(StaffMember member) async {
    try {
      await usecase.updateStaff(member.id, {'isActive': !member.isActive});
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> resetPassword(int id, String tempPassword) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await usecase.resetStaffPassword(id, tempPassword);
      state = state.copyWith(submitting: false);
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  // ── Roles ─────────────────────────────────────────────────────────────

  Future<bool> saveRole(Map<String, dynamic> body, {String? roleKey}) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (roleKey != null) {
        await usecase.updateRole(roleKey, body);
      } else {
        await usecase.createRole(body);
      }
      state = state.copyWith(submitting: false);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> resetRole(String roleKey) async {
    try {
      await usecase.resetRole(roleKey);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> deleteRole(String roleKey) async {
    try {
      await usecase.deleteRole(roleKey);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  void clearError() => state = state.copyWith(clearError: true);
}
