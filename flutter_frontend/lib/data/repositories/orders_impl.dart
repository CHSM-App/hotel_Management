import '../../domain/models/food_order.dart';
import '../../domain/models/menu.dart';
import '../../domain/models/room.dart';
import '../../domain/repository/orders_repo.dart';
import '../api/api_service.dart';

/// Pure-remote, like the rest.
///
/// A kitchen queue is the least cacheable thing in the app: its whole value is
/// that it says what is true right now. A cached ticket is a dish nobody is
/// cooking, or one being cooked twice.
class OrdersImpl implements OrdersRepository {
  final ApiService api;

  OrdersImpl(this.api);

  @override
  Future<List<FoodOrder>> queue() => api.orderQueue();

  @override
  Future<List<FoodOrder>> orders({
    String? date,
    String? from,
    String? to,
    String? status,
  }) => api.orders(date: date, from: from, to: to, status: status);

  @override
  Future<FoodOrder> setStatus(int id, String status, {String? cancelReason}) =>
      api.setOrderStatus(id, status, cancelReason: cancelReason);

  @override
  Future<FoodOrder> setItemReady(int id, int itemId, bool ready) =>
      api.setItemReady(id, itemId, ready);

  @override
  Future<FoodOrder> setItemDelivered(int id, int itemId) =>
      api.setItemDelivered(id, itemId);

  @override
  Future<FoodOrder> markReadyToBill(int id) => api.markReadyToBill(id);

  @override
  Future<FoodOrder> createCounterOrder(Map<String, dynamic> body) =>
      api.createCounterOrder(body);

  @override
  Future<FoodOrder> editOrder(
    int id,
    List<Map<String, dynamic>> items,
    String note,
  ) => api.editOrder(id, items, note);

  @override
  Future<List<MenuSection>> menu() => api.menu();

  @override
  Future<List<DiningTable>> tables() => api.tables();

  @override
  Future<List<RoomListing>> roomsForOrder() => api.rooms();

  @override
  Future<void> clearFoodPinLockout(String roomNumber) =>
      api.clearFoodPinLockout(roomNumber);

  @override
  Future<RoomOccupancy> roomOccupancy(int roomId) => api.roomOccupancy(roomId);
}
