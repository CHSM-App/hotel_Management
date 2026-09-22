library;

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/menu.dart';
import '../../domain/usecase/food_setup_usecase.dart';

/// Menu & QR codes > Menu — sections and dishes, mirroring MenuPanel.jsx.
class MenuState {
  final bool isLoading;
  final String? error;
  final List<MenuSection> sections;
  final bool submitting;

  const MenuState({
    this.isLoading = false,
    this.error,
    this.sections = const [],
    this.submitting = false,
  });

  MenuState copyWith({
    bool? isLoading,
    String? error,
    bool clearError = false,
    List<MenuSection>? sections,
    bool? submitting,
  }) => MenuState(
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : (error ?? this.error),
    sections: sections ?? this.sections,
    submitting: submitting ?? this.submitting,
  );
}

class MenuViewModel extends StateNotifier<MenuState> {
  final FoodSetupUsecase usecase;

  MenuViewModel(this.usecase) : super(const MenuState());

  Future<void> load() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final sections = await usecase.menu();
      state = state.copyWith(isLoading: false, sections: sections);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
    }
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  Future<bool> saveSection({int? id, required String name, required int sortOrder}) async {
    if (state.submitting) return false;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateMenuCategory(id, name: name, sortOrder: sortOrder);
      } else {
        await usecase.createMenuCategory(name: name, sortOrder: sortOrder);
      }
      state = state.copyWith(submitting: false);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> setSectionActive(int id, bool isActive) async {
    try {
      await usecase.setMenuCategoryActive(id, isActive);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  /// Marks every dish in the section available/unavailable in one go — the
  /// day-end "the fish ran out" action.
  Future<bool> setSectionAvailability(int id, bool isAvailable) async {
    try {
      await usecase.setMenuCategoryAvailability(id, isAvailable);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> deleteSection(int id) async {
    try {
      await usecase.deleteMenuCategory(id);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  // ── Dishes ────────────────────────────────────────────────────────────────

  /// Saves the dish itself, then its size list — the size editor needs the
  /// dish's own id, which a brand-new dish only gets from the first call's
  /// response, exactly as MenuPanel.jsx's handleItemSubmit does.
  Future<bool> saveItem(
    FormData form, {
    int? itemId,
    required List<Map<String, dynamic>> portions,
  }) async {
    if (state.submitting) return false;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      int savedId;
      if (itemId != null) {
        await usecase.updateMenuItem(itemId, form);
        savedId = itemId;
      } else {
        savedId = await usecase.createMenuItem(form);
      }
      await usecase.setItemPortions(savedId, portions);
      state = state.copyWith(submitting: false);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> setItemAvailability(int id, bool isAvailable) async {
    try {
      await usecase.setMenuItemAvailability(id, isAvailable);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> setItemActive(int id, bool isActive) async {
    try {
      await usecase.setMenuItemActive(id, isActive);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> deleteItem(int id) async {
    try {
      await usecase.deleteMenuItem(id);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }
}
