import '../models/food_order.dart';
import '../models/menu.dart';
import '../models/room.dart';

abstract class OrdersRepository {
  /// Everything still cooking, whatever day it was placed.
  Future<List<FoodOrder>> queue();

  /// One IST day, or (via [from]/[to]) a wider period, optionally narrowed
  /// to a status.
  Future<List<FoodOrder>> orders({
    String? date,
    String? from,
    String? to,
    String? status,
  });

  Future<FoodOrder> setStatus(int id, String status, {String? cancelReason});

  Future<FoodOrder> setItemReady(int id, int itemId, bool ready);

  /// The captain carrying one ready dish out to the guest.
  Future<FoodOrder> setItemDelivered(int id, int itemId);

  /// The captain saying a fully delivered order is done and the guest is
  /// ready to pay: it leaves the "My orders" list and shows up in Billing's
  /// "Food to bill" queue.
  Future<FoodOrder> markReadyToBill(int id);

  Future<FoodOrder> createCounterOrder(Map<String, dynamic> body);

  /// Replace an unbilled order's items wholesale.
  Future<FoodOrder> editOrder(
    int id,
    List<Map<String, dynamic>> items,
    String note,
  );

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

  /// Who is checked into a room, for the counter order screen to show
  /// beside the picker once a room is selected.
  Future<RoomOccupancy> roomOccupancy(int roomId);
}
