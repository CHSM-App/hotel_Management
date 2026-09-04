import '../models/food_order.dart';
import '../models/menu.dart';

abstract class OrdersRepository {
  /// Everything still cooking, whatever day it was placed.
  Future<List<FoodOrder>> queue();

  /// One IST day, optionally narrowed to a status.
  Future<List<FoodOrder>> orders({String? date, String? status});

  Future<FoodOrder> setStatus(int id, String status, {String? cancelReason});

  Future<FoodOrder> setItemReady(int id, int itemId, bool ready);

  Future<FoodOrder> createCounterOrder(Map<String, dynamic> body);

  Future<List<MenuSection>> menu();

  Future<List<DiningTable>> tables();
}
