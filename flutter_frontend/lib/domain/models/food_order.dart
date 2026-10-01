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

  /// The menu dish (and, for one that offers sizes, the portion) this line
  /// was ordered from — null for neither only if the dish has since been
  /// deleted from the menu. Carried so an edit can be pre-filled from the
  /// menu the same way it was originally built, the same as the web's own
  /// editOrder modal.
  final int? menuItemId;
  final int? portionId;

  /// When the kitchen ticked this line off, or null while it is still cooking.
  final String? readyAt;

  /// When the captain carried this dish out to the guest, or null while it
  /// is sitting ready and waiting.
  final String? deliveredAt;

  /// The menu section this dish belongs to ("Starters", "Soups", …), so a
  /// ticket can be read by course the same way OrdersPanel.jsx's own
  /// renderSections groups it. Null for a dish whose category has since
  /// been removed — reads as "Other".
  final String? category;
  final int categorySort;

  const FoodOrderItem({
    required this.id,
    required this.name,
    this.unitPrice = 0,
    this.quantity = 1,
    this.lineTotal = 0,
    this.menuItemId,
    this.portionId,
    this.readyAt,
    this.deliveredAt,
    this.category,
    this.categorySort = 0,
  });

  bool get isReady => readyAt != null;
  bool get isDelivered => deliveredAt != null;

  factory FoodOrderItem.fromJson(Map<String, dynamic> json) => FoodOrderItem(
    id: asInt(json['id']),
    name: asStringOrNull(json['name']) ?? '',
    unitPrice: asNumOrNull(json['unitPrice']) ?? 0,
    quantity: asIntOrNull(json['quantity']) ?? 1,
    lineTotal: asNumOrNull(json['lineTotal']) ?? 0,
    menuItemId: asIntOrNull(json['menuItemId']),
    portionId: asIntOrNull(json['portionId']),
    readyAt: asStringOrNull(json['readyAt']),
    deliveredAt: asStringOrNull(json['deliveredAt']),
    category: asStringOrNull(json['category']),
    categorySort: asIntOrNull(json['categorySort']) ?? 0,
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

  /// Once an invoice carries the order its lines are money — no more edits.
  final bool billed;

  /// Marked by the captain once a fully delivered order is done and the
  /// guest is ready to pay: it then shows up in Billing's "Food to bill".
  final bool readyToBill;

  final int? invoiceId;

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
    this.billed = false,
    this.readyToBill = false,
    this.invoiceId,
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
    billed: json['billed'] == true,
    readyToBill: json['readyToBill'] == true,
    invoiceId: asIntOrNull(json['invoiceId']),
    nextStatuses: (json['nextStatuses'] as List? ?? const [])
        .map((e) => e.toString())
        .toList(),
    items: (json['items'] as List? ?? const [])
        .map((e) => FoodOrderItem.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  /// A fully delivered, unbilled order the captain can send to Billing's
  /// "Food to bill" queue.
  bool get canMarkReadyToBill => status == 'DELIVERED' && !billed && !readyToBill;

  /// Unbilled, not sent to billing, not called off — the same rule
  /// OrdersPanel.jsx's `canEdit`/`editable` checks. Its items can still be
  /// changed, whatever status it is otherwise sitting at.
  bool get isEditable => !billed && !readyToBill && status != 'CANCELLED';

  String get statusLabel => kOrderStatusLabels[status] ?? status;

  /// Who this is for, in the words the kitchen uses: a room, a table, or the
  /// counter. Never a raw source code.
  String get target {
    if (roomNumber != null && roomNumber!.isNotEmpty) return 'Room $roomNumber';
    if (tableLabel != null && tableLabel!.isNotEmpty) return tableLabel!;
    return 'Counter';
  }

  /// Whether this order matches a History search — order number, who it's
  /// for, the guest's name or phone, its note, or a dish on it — same
  /// fields OrdersPanel.jsx's own `matchesSearch` checks. An empty [query]
  /// always matches.
  bool matchesSearch(String query) {
    final needle = query.trim().toLowerCase();
    if (needle.isEmpty) return true;
    final haystacks = [
      '#$orderNumber',
      target,
      guestName,
      note,
      for (final item in items) item.name,
    ];
    return haystacks.any(
      (h) => (h ?? '').toLowerCase().contains(needle),
    );
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

/// Who is checked into a room, looked up when it's picked as a counter
/// order's destination — so staff can eyeball the register before charging
/// food to somebody's stay. Mirrors the web's /orders/room-occupancy/:id.
class RoomOccupancy {
  final bool occupied;
  final String? guestName;
  final String? guestPhone;

  const RoomOccupancy({
    required this.occupied,
    this.guestName,
    this.guestPhone,
  });

  factory RoomOccupancy.fromJson(Map<String, dynamic> json) => RoomOccupancy(
    occupied: json['occupied'] == true,
    guestName: json['guestName'] as String?,
    guestPhone: json['guestPhone'] as String?,
  );
}
