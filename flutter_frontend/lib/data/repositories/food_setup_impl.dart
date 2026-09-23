import 'package:dio/dio.dart';

import '../../domain/models/inventory.dart';
import '../../domain/models/menu.dart';
import '../../domain/repository/food_setup_repo.dart';
import '../api/api_service.dart';

class FoodSetupImpl implements FoodSetupRepository {
  final ApiService api;

  FoodSetupImpl(this.api);

  @override
  Future<List<MenuSection>> menu() => api.menu();

  @override
  Future<int> createMenuCategory({required String name, required int sortOrder}) =>
      api.createMenuCategory(name: name, sortOrder: sortOrder);

  @override
  Future<void> updateMenuCategory(int id, {required String name, required int sortOrder}) =>
      api.updateMenuCategory(id, name: name, sortOrder: sortOrder);

  @override
  Future<void> setMenuCategoryActive(int id, bool isActive) =>
      api.setMenuCategoryActive(id, isActive);

  @override
  Future<void> setMenuCategoryAvailability(int id, bool isAvailable) =>
      api.setMenuCategoryAvailability(id, isAvailable);

  @override
  Future<void> deleteMenuCategory(int id) => api.deleteMenuCategory(id);

  @override
  Future<int> createMenuItem(FormData form) => api.createMenuItem(form);

  @override
  Future<void> updateMenuItem(int id, FormData form) => api.updateMenuItem(id, form);

  @override
  Future<void> setMenuItemAvailability(int id, bool isAvailable) =>
      api.setMenuItemAvailability(id, isAvailable);

  @override
  Future<void> setMenuItemActive(int id, bool isActive) => api.setMenuItemActive(id, isActive);

  @override
  Future<void> deleteMenuItem(int id) => api.deleteMenuItem(id);

  @override
  Future<void> setItemPortions(int itemId, List<Map<String, dynamic>> portions) =>
      api.setItemPortions(itemId, portions);

  @override
  Future<FoodSettings> foodSettings() => api.foodSettings();

  @override
  Future<FoodSettings> updateFoodSettings(FoodSettings settings) =>
      api.updateFoodSettings(settings);

  @override
  Future<List<RawMaterial>> materials({bool includeInactive = true}) =>
      api.materials(includeInactive: includeInactive);

  @override
  Future<int> createMaterial({
    required String name,
    required String unit,
    required String category,
    num quantity = 0,
    num lowStockThreshold = 0,
  }) => api.createMaterial(
    name: name,
    unit: unit,
    category: category,
    quantity: quantity,
    lowStockThreshold: lowStockThreshold,
  );

  @override
  Future<RawMaterial> updateMaterial(
    int id, {
    required String name,
    required String category,
    num lowStockThreshold = 0,
  }) => api.updateMaterial(id, name: name, category: category, lowStockThreshold: lowStockThreshold);

  @override
  Future<RawMaterial> setMaterialActive(int id, bool isActive) =>
      api.setMaterialActive(id, isActive);

  @override
  Future<void> deleteMaterial(int id) => api.deleteMaterial(id);

  @override
  Future<RawMaterial> adjustStock(
    int id, {
    required String mode,
    required num quantity,
    String note = '',
  }) => api.adjustStock(id, mode: mode, quantity: quantity, note: note);

  @override
  Future<List<StockMovement>> movements({int? materialId, int limit = 100}) =>
      api.movements(materialId: materialId, limit: limit);

  @override
  Future<List<RecipeDishSummary>> recipeSummaries() => api.recipeSummaries();

  @override
  Future<ItemRecipe> itemRecipe(int itemId) => api.itemRecipe(itemId);

  @override
  Future<ItemRecipe> setItemRecipe(int itemId, List<Map<String, dynamic>> lines) =>
      api.setItemRecipe(itemId, lines);

  @override
  Future<List<DiningTable>> allTables() => api.allTables();

  @override
  Future<void> createTable({required String label, int? seats}) =>
      api.createTable(label: label, seats: seats);

  @override
  Future<void> bulkCreateTables({
    required String prefix,
    required int rangeStart,
    required int rangeEnd,
    int? seats,
  }) => api.bulkCreateTables(prefix: prefix, rangeStart: rangeStart, rangeEnd: rangeEnd, seats: seats);

  @override
  Future<void> updateTable(int id, {required String label, int? seats}) =>
      api.updateTable(id, label: label, seats: seats);

  @override
  Future<void> setTableActive(int id, bool isActive) => api.setTableActive(id, isActive);

  @override
  Future<void> regenerateTableQr(int id) => api.regenerateTableQr(id);

  @override
  Future<void> deleteTable(int id) => api.deleteTable(id);
}
