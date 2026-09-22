import 'package:dio/dio.dart';

import '../models/inventory.dart';
import '../models/menu.dart';

/// The web dashboard's "Menu & QR codes" section — everything under
/// food.manage that isn't taking an order, which is what [OrdersRepository]
/// covers instead. One interface for all four areas (menu, inventory,
/// recipes, tables), the same way [RoomsRepository] groups rooms, categories,
/// charges and seasons — they are read and edited together on this screen,
/// even though each gets its own view model.
abstract class FoodSetupRepository {
  // Menu: sections & dishes
  Future<List<MenuSection>> menu();
  Future<int> createMenuCategory({required String name, required int sortOrder});
  Future<void> updateMenuCategory(int id, {required String name, required int sortOrder});
  Future<void> setMenuCategoryActive(int id, bool isActive);
  Future<void> setMenuCategoryAvailability(int id, bool isAvailable);
  Future<void> deleteMenuCategory(int id);

  Future<int> createMenuItem(FormData form);
  Future<void> updateMenuItem(int id, FormData form);
  Future<void> setMenuItemAvailability(int id, bool isAvailable);
  Future<void> setMenuItemActive(int id, bool isActive);
  Future<void> deleteMenuItem(int id);
  Future<void> setItemPortions(int itemId, List<Map<String, dynamic>> portions);

  // Settings
  Future<FoodSettings> foodSettings();
  Future<FoodSettings> updateFoodSettings(FoodSettings settings);

  // Inventory: raw materials & their ledger
  Future<List<RawMaterial>> materials({bool includeInactive});
  Future<int> createMaterial({
    required String name,
    required String unit,
    required String category,
    num quantity,
    num lowStockThreshold,
  });
  Future<RawMaterial> updateMaterial(
    int id, {
    required String name,
    required String category,
    num lowStockThreshold,
  });
  Future<RawMaterial> setMaterialActive(int id, bool isActive);
  Future<void> deleteMaterial(int id);
  Future<RawMaterial> adjustStock(int id, {required String mode, required num quantity, String note});
  Future<List<StockMovement>> movements({int? materialId, int limit});

  // Recipes
  Future<List<RecipeDishSummary>> recipeSummaries();
  Future<ItemRecipe> itemRecipe(int itemId);
  Future<ItemRecipe> setItemRecipe(int itemId, List<Map<String, dynamic>> lines);

  // Tables
  Future<List<DiningTable>> allTables();
  Future<void> createTable({required String label, int? seats});
  Future<void> bulkCreateTables({
    required String prefix,
    required int rangeStart,
    required int rangeEnd,
    int? seats,
  });
  Future<void> updateTable(int id, {required String label, int? seats});
  Future<void> setTableActive(int id, bool isActive);
  Future<void> regenerateTableQr(int id);
  Future<void> deleteTable(int id);
}
