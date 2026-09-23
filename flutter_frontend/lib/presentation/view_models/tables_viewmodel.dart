library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/menu.dart';
import '../../domain/usecase/food_setup_usecase.dart';

/// Menu & QR codes > Tables — mirroring TablesPanel.jsx. Kept apart from
/// [MenuViewModel] because a lodge with table service off never loads this
/// at all (see menu_setup_screen.dart's conditional tab).
class TablesState {
  final bool isLoading;
  final String? error;
  final List<DiningTable> tables;
  final bool submitting;

  const TablesState({
    this.isLoading = false,
    this.error,
    this.tables = const [],
    this.submitting = false,
  });

  TablesState copyWith({
    bool? isLoading,
    String? error,
    bool clearError = false,
    List<DiningTable>? tables,
    bool? submitting,
  }) => TablesState(
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : (error ?? this.error),
    tables: tables ?? this.tables,
    submitting: submitting ?? this.submitting,
  );
}

class TablesViewModel extends StateNotifier<TablesState> {
  final FoodSetupUsecase usecase;

  TablesViewModel(this.usecase) : super(const TablesState());

  Future<void> load() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final tables = await usecase.allTables();
      state = state.copyWith(isLoading: false, tables: tables);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
    }
  }

  Future<bool> saveTable({int? id, required String label, int? seats}) async {
    if (state.submitting) return false;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateTable(id, label: label, seats: seats);
      } else {
        await usecase.createTable(label: label, seats: seats);
      }
      state = state.copyWith(submitting: false);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> saveBulk({
    required String prefix,
    required int rangeStart,
    required int rangeEnd,
    int? seats,
  }) async {
    if (state.submitting) return false;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await usecase.bulkCreateTables(
        prefix: prefix,
        rangeStart: rangeStart,
        rangeEnd: rangeEnd,
        seats: seats,
      );
      state = state.copyWith(submitting: false);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> setActive(int id, bool isActive) async {
    try {
      await usecase.setTableActive(id, isActive);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> regenerateQr(int id) async {
    try {
      await usecase.regenerateTableQr(id);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> delete(int id) async {
    try {
      await usecase.deleteTable(id);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }
}
