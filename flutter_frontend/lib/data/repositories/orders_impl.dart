import '../../domain/models/food_order.dart';
import '../../domain/models/menu.dart';
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
  Future<List<FoodOrder>> orders({String? date, String? status}) =>
      api.orders(date: date, status: status);

  @override
  Future<FoodOrder> setStatus(int id, String status, {String? cancelReason}) =>
      api.setOrderStatus(id, status, cancelReason: cancelReason);

  @override
  Future<FoodOrder> setItemReady(int id, int itemId, bool ready) =>
      api.setItemReady(id, itemId, ready);

  @override
  Future<FoodOrder> createCounterOrder(Map<String, dynamic> body) =>
      api.createCounterOrder(body);

  @override
  Future<List<MenuSection>> menu() => api.menu();

  @override
  Future<List<DiningTable>> tables() => api.tables();
}
