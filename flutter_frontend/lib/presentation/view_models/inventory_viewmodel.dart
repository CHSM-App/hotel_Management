library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/inventory.dart';
import '../../domain/usecase/food_setup_usecase.dart';

/// Menu & QR codes > Inventory + Recipes — the store cupboard and what each
/// dish takes out of it, loaded together the same way RecipesPanel.jsx loads
/// both /inventory/recipes and /inventory/materials at once (a recipe row
/// picker needs the material list before it can offer anything).
class InventoryState {
  final bool isLoading;
  final String? error;
  final List<RawMaterial> materials;
  final List<RecipeDishSummary> dishes;
  final bool submitting;

  const InventoryState({
    this.isLoading = false,
    this.error,
    this.materials = const [],
    this.dishes = const [],
    this.submitting = false,
  });

  InventoryState copyWith({
    bool? isLoading,
    String? error,
    bool clearError = false,
    List<RawMaterial>? materials,
    List<RecipeDishSummary>? dishes,
    bool? submitting,
  }) => InventoryState(
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : (error ?? this.error),
    materials: materials ?? this.materials,
    dishes: dishes ?? this.dishes,
    submitting: submitting ?? this.submitting,
  );
}

class InventoryViewModel extends StateNotifier<InventoryState> {
  final FoodSetupUsecase usecase;

  InventoryViewModel(this.usecase) : super(const InventoryState());

  Future<void> load() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final results = await Future.wait([
        usecase.materials(includeInactive: true),
        usecase.recipeSummaries(),
      ]);
      state = state.copyWith(
        isLoading: false,
        materials: results[0] as List<RawMaterial>,
        dishes: results[1] as List<RecipeDishSummary>,
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
    }
  }

  // ── Materials ─────────────────────────────────────────────────────────────

  Future<bool> saveMaterial({
    int? id,
    required String name,
    String unit = 'KG',
    required String category,
    num quantity = 0,
    num lowStockThreshold = 0,
  }) async {
    if (state.submitting) return false;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateMaterial(id, name: name, category: category, lowStockThreshold: lowStockThreshold);
      } else {
        await usecase.createMaterial(
          name: name,
          unit: unit,
          category: category,
          quantity: quantity,
          lowStockThreshold: lowStockThreshold,
        );
      }
      state = state.copyWith(submitting: false);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> adjustStock(int id, {required String mode, required num quantity, String note = ''}) async {
    if (state.submitting) return false;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await usecase.adjustStock(id, mode: mode, quantity: quantity, note: note);
      state = state.copyWith(submitting: false);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> setMaterialActive(int id, bool isActive) async {
    try {
      await usecase.setMaterialActive(id, isActive);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> deleteMaterial(int id) async {
    try {
      await usecase.deleteMaterial(id);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  Future<List<StockMovement>?> movements(int materialId) async {
    try {
      return await usecase.movements(materialId: materialId, limit: 100);
    } catch (_) {
      return null;
    }
  }

  // ── Recipes ───────────────────────────────────────────────────────────────

  Future<ItemRecipe?> openRecipe(int itemId) async {
    try {
      return await usecase.itemRecipe(itemId);
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return null;
    }
  }

  Future<bool> saveRecipe(int itemId, List<Map<String, dynamic>> lines) async {
    if (state.submitting) return false;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await usecase.setItemRecipe(itemId, lines);
      state = state.copyWith(submitting: false);
      await load();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }
}
