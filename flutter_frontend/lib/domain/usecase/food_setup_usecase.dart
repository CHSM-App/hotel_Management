import 'package:dio/dio.dart';

import '../models/inventory.dart';
import '../models/menu.dart';
import '../repository/food_setup_repo.dart';

class FoodSetupUsecase {
  final FoodSetupRepository repository;

  FoodSetupUsecase(this.repository);

  // Menu
  Future<List<MenuSection>> menu() => repository.menu();
  Future<int> createMenuCategory({required String name, required int sortOrder}) =>
      repository.createMenuCategory(name: name, sortOrder: sortOrder);
  Future<void> updateMenuCategory(int id, {required String name, required int sortOrder}) =>
      repository.updateMenuCategory(id, name: name, sortOrder: sortOrder);
  Future<void> setMenuCategoryActive(int id, bool isActive) =>
      repository.setMenuCategoryActive(id, isActive);
  Future<void> setMenuCategoryAvailability(int id, bool isAvailable) =>
      repository.setMenuCategoryAvailability(id, isAvailable);
  Future<void> deleteMenuCategory(int id) => repository.deleteMenuCategory(id);

  Future<int> createMenuItem(FormData form) => repository.createMenuItem(form);
  Future<void> updateMenuItem(int id, FormData form) => repository.updateMenuItem(id, form);
  Future<void> setMenuItemAvailability(int id, bool isAvailable) =>
      repository.setMenuItemAvailability(id, isAvailable);
  Future<void> setMenuItemActive(int id, bool isActive) =>
      repository.setMenuItemActive(id, isActive);
  Future<void> deleteMenuItem(int id) => repository.deleteMenuItem(id);
  Future<void> setItemPortions(int itemId, List<Map<String, dynamic>> portions) =>
      repository.setItemPortions(itemId, portions);

  // Settings
  Future<FoodSettings> foodSettings() => repository.foodSettings();
  Future<FoodSettings> updateFoodSettings(FoodSettings settings) =>
      repository.updateFoodSettings(settings);

  // Inventory
  Future<List<RawMaterial>> materials({bool includeInactive = true}) =>
      repository.materials(includeInactive: includeInactive);
  Future<int> createMaterial({
    required String name,
    required String unit,
    required String category,
    num quantity = 0,
    num lowStockThreshold = 0,
  }) => repository.createMaterial(
    name: name,
    unit: unit,
    category: category,
    quantity: quantity,
    lowStockThreshold: lowStockThreshold,
  );
  Future<RawMaterial> updateMaterial(
    int id, {
    required String name,
    required String category,
    num lowStockThreshold = 0,
  }) => repository.updateMaterial(id, name: name, category: category, lowStockThreshold: lowStockThreshold);
  Future<RawMaterial> setMaterialActive(int id, bool isActive) =>
      repository.setMaterialActive(id, isActive);
  Future<void> deleteMaterial(int id) => repository.deleteMaterial(id);
  Future<RawMaterial> adjustStock(
    int id, {
    required String mode,
    required num quantity,
    String note = '',
  }) => repository.adjustStock(id, mode: mode, quantity: quantity, note: note);
  Future<List<StockMovement>> movements({int? materialId, int limit = 100}) =>
      repository.movements(materialId: materialId, limit: limit);

  // Recipes
  Future<List<RecipeDishSummary>> recipeSummaries() => repository.recipeSummaries();
  Future<ItemRecipe> itemRecipe(int itemId) => repository.itemRecipe(itemId);
  Future<ItemRecipe> setItemRecipe(int itemId, List<Map<String, dynamic>> lines) =>
      repository.setItemRecipe(itemId, lines);

  // Tables
  Future<List<DiningTable>> allTables() => repository.allTables();
  Future<void> createTable({required String label, int? seats}) =>
      repository.createTable(label: label, seats: seats);
  Future<void> bulkCreateTables({
    required String prefix,
    required int rangeStart,
    required int rangeEnd,
    int? seats,
  }) => repository.bulkCreateTables(prefix: prefix, rangeStart: rangeStart, rangeEnd: rangeEnd, seats: seats);
  Future<void> updateTable(int id, {required String label, int? seats}) =>
      repository.updateTable(id, label: label, seats: seats);
  Future<void> setTableActive(int id, bool isActive) => repository.setTableActive(id, isActive);
  Future<void> regenerateTableQr(int id) => repository.regenerateTableQr(id);
  Future<void> deleteTable(int id) => repository.deleteTable(id);
}
