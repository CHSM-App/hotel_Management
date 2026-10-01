import '../models/food_order.dart';
import '../models/menu.dart';
import '../models/room.dart';
import '../repository/orders_repo.dart';

class OrdersUsecase {
  final OrdersRepository repository;

  OrdersUsecase(this.repository);

  /// What the kitchen is working on.
  Future<List<FoodOrder>> queue() => repository.queue();

  /// A day's orders, for looking back at what happened — or, with [from]/
  /// [to], a wider period (a captain's "My orders" looks back a month).
  Future<List<FoodOrder>> orders({
    String? date,
    String? from,
    String? to,
    String? status,
  }) => repository.orders(date: date, from: from, to: to, status: status);

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

  /// Carry one ready dish out to the guest.
  Future<FoodOrder> setItemDelivered(int id, int itemId) =>
      repository.setItemDelivered(id, itemId);

  /// Send a fully delivered order to Billing's "Food to bill" queue.
  Future<FoodOrder> markReadyToBill(int id) =>
      repository.markReadyToBill(id);

  /// Put through an order somebody dictated at the counter.
  Future<FoodOrder> createCounterOrder({
    int? roomId,
    int? tableId,
    String guestName = '',
    String guestPhone = '',
    String note = '',
    required List<OrderLineDraft> lines,
  }) => repository.createCounterOrder({
    // An order goes to a room or a table, never both — the server refuses the
    // pair outright, so only the one that was chosen is sent.
    if (roomId != null) 'roomId': roomId,
    if (tableId != null && roomId == null) 'tableId': tableId,
    if (guestName.trim().isNotEmpty) 'guestName': guestName.trim(),
    if (guestPhone.trim().isNotEmpty) 'guestPhone': guestPhone.trim(),
    if (note.trim().isNotEmpty) 'note': note.trim(),
    'items': lines.map((l) => l.toJson()).toList(),
  });

  /// Replace an unbilled order's items wholesale — the captain correcting
  /// what was rung in.
  Future<FoodOrder> editOrder(
    int id,
    List<OrderLineDraft> lines,
    String note,
  ) => repository.editOrder(
    id,
    lines.map((l) => l.toJson()).toList(),
    note.trim(),
  );

  Future<List<MenuSection>> menu() => repository.menu();

  Future<List<DiningTable>> tables() => repository.tables();

  Future<List<RoomListing>> roomsForOrder() => repository.roomsForOrder();

  /// Clear a room's food-PIN lockout.
  Future<void> clearFoodPinLockout(String roomNumber) =>
      repository.clearFoodPinLockout(roomNumber);

  /// Who is checked into a room, so the counter order screen can show it
  /// beside the picker once a room is selected.
  Future<RoomOccupancy> roomOccupancy(int roomId) =>
      repository.roomOccupancy(roomId);
}
