import '../models/food_order.dart';
import '../models/menu.dart';
import '../models/room.dart';

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

  /// Every room, for the counter order screen's own target picker — same
  /// GET /rooms the Rooms & rates screen uses, fetched independently here
  /// because this call only means anything to whichever role also holds
  /// `rooms.manage`; a role without it gets a 403 the screen treats the same
  /// as "no rooms to offer" rather than an error.
  Future<List<RoomListing>> roomsForOrder();

  /// Clear a room's food-PIN lockout so the guest can order again without
  /// waiting out the timer.
  Future<void> clearFoodPinLockout(String roomNumber);
}
