import '../models/food_order.dart';
import '../models/menu.dart';
import '../repository/orders_repo.dart';

class OrdersUsecase {
  final OrdersRepository repository;

  OrdersUsecase(this.repository);

  /// What the kitchen is working on.
  Future<List<FoodOrder>> queue() => repository.queue();

  /// A day's orders, for looking back at what happened.
  Future<List<FoodOrder>> orders({String? date, String? status}) =>
      repository.orders(date: date, status: status);

  /// Move an order on, or call it off.
  ///
  /// A reason is only meaningful on a cancellation — the schema accepts it on
  /// any transition and stores it against the row, so it is passed only where
  /// it means something.
  Future<FoodOrder> setStatus(int id, String status, {String? cancelReason}) =>
      repository.setStatus(
        id,
        status,
        cancelReason: status == 'CANCELLED' ? cancelReason : null,
      );

  /// Tick one dish off a ticket, or take the tick back.
  Future<FoodOrder> setItemReady(int id, int itemId, bool ready) =>
      repository.setItemReady(id, itemId, ready);

  /// Put through an order somebody dictated at the counter.
  Future<FoodOrder> createCounterOrder({
    int? roomId,
    int? tableId,
    String guestName = '',
    String note = '',
    required List<OrderLineDraft> lines,
  }) => repository.createCounterOrder({
    // An order goes to a room or a table, never both — the server refuses the
    // pair outright, so only the one that was chosen is sent.
    if (roomId != null) 'roomId': roomId,
    if (tableId != null && roomId == null) 'tableId': tableId,
    if (guestName.trim().isNotEmpty) 'guestName': guestName.trim(),
    if (note.trim().isNotEmpty) 'note': note.trim(),
    'items': lines.map((l) => l.toJson()).toList(),
  });

  Future<List<MenuSection>> menu() => repository.menu();

  Future<List<DiningTable>> tables() => repository.tables();
}
