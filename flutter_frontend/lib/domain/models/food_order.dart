import 'json.dart';

/// How an order reads on screen, in the kitchen's own words.
///
/// Mirrors STATUS_LABEL in frontend/src/pages/lodge/OrdersPanel.jsx, so an
/// order called out across a kitchen sounds the same whichever screen the
/// person reading it happens to be at.
const kOrderStatusLabels = <String, String>{
  'PENDING': 'Needs accepting',
  'QUEUED': 'In the queue',
  'PREPARING': 'Preparing',
  'READY': 'Ready',
  'DELIVERED': 'Delivered',
  'CANCELLED': 'Cancelled',
};

/// The button that moves an order to a given state.
///
/// Only ever rendered from an order's own [FoodOrder.nextStatuses], which the
/// server computes — the phone never decides which transitions are legal, it
/// only names the ones it was handed.
const kOrderActionLabels = <String, String>{
  'QUEUED': 'Accept',
  'PREPARING': 'Start cooking',
  'READY': 'Ready',
  'DELIVERED': 'Delivered',
  'CANCELLED': 'Cancel',
};

/// One dish on a ticket.
class FoodOrderItem {
  final int id;
  final String name;
  final num unitPrice;
  final int quantity;
  final num lineTotal;

  /// When the kitchen ticked this line off, or null while it is still cooking.
  final String? readyAt;

  const FoodOrderItem({
    required this.id,
    required this.name,
    this.unitPrice = 0,
    this.quantity = 1,
    this.lineTotal = 0,
    this.readyAt,
  });

  bool get isReady => readyAt != null;

  factory FoodOrderItem.fromJson(Map<String, dynamic> json) => FoodOrderItem(
    id: asInt(json['id']),
    name: asStringOrNull(json['name']) ?? '',
    unitPrice: asNumOrNull(json['unitPrice']) ?? 0,
    quantity: asIntOrNull(json['quantity']) ?? 1,
    lineTotal: asNumOrNull(json['lineTotal']) ?? 0,
    readyAt: asStringOrNull(json['readyAt']),
  );
}

/// A ticket.
class FoodOrder {
  final int id;

  /// Restarts daily and is called across the kitchen — this is the number the
  /// cook shouts, not [id].
  final int orderNumber;

  final String? orderDate;

  /// ROOM, TABLE or COUNTER.
  final String source;

  final String? roomNumber;
  final String? tableLabel;
  final String? guestName;
  final String? note;
  final String status;
  final num subtotal;
  final String? placedAt;
  final String? cancelReason;

  /// Where this order may go next, decided by the server.
  final List<String> nextStatuses;

  final List<FoodOrderItem> items;

  const FoodOrder({
    required this.id,
    this.orderNumber = 0,
    this.orderDate,
    this.source = 'COUNTER',
    this.roomNumber,
    this.tableLabel,
    this.guestName,
    this.note,
    this.status = 'PENDING',
    this.subtotal = 0,
    this.placedAt,
    this.cancelReason,
    this.nextStatuses = const [],
    this.items = const [],
  });

  factory FoodOrder.fromJson(Map<String, dynamic> json) => FoodOrder(
    id: asInt(json['id']),
    orderNumber: asIntOrNull(json['orderNumber']) ?? 0,
    orderDate: asStringOrNull(json['orderDate']),
    source: asStringOrNull(json['source']) ?? 'COUNTER',
    roomNumber: asStringOrNull(json['roomNumber']),
    tableLabel: asStringOrNull(json['tableLabel']),
    guestName: asStringOrNull(json['guestName']),
    note: asStringOrNull(json['note']),
    status: asStringOrNull(json['status']) ?? 'PENDING',
    subtotal: asNumOrNull(json['subtotal']) ?? 0,
    placedAt: asStringOrNull(json['placedAt']),
    cancelReason: asStringOrNull(json['cancelReason']),
    nextStatuses: (json['nextStatuses'] as List? ?? const [])
        .map((e) => e.toString())
        .toList(),
    items: (json['items'] as List? ?? const [])
        .map((e) => FoodOrderItem.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  String get statusLabel => kOrderStatusLabels[status] ?? status;

  /// Who this is for, in the words the kitchen uses: a room, a table, or the
  /// counter. Never a raw source code.
  String get target {
    if (roomNumber != null && roomNumber!.isNotEmpty) return 'Room $roomNumber';
    if (tableLabel != null && tableLabel!.isNotEmpty) return tableLabel!;
    return 'Counter';
  }

  /// How long this ticket has been waiting, from when the guest placed it.
  ///
  /// Null when the server sent no timestamp rather than zero — "just now" and
  /// "not known" are different things on a kitchen screen.
  Duration? waitingFor(DateTime now) {
    final placed = DateTime.tryParse(placedAt ?? '');
    if (placed == null) return null;
    final elapsed = now.difference(placed.toLocal());
    return elapsed.isNegative ? Duration.zero : elapsed;
  }
}
