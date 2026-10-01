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
  final String? guestPhone;
  final String? note;
  final String status;
  final num subtotal;
  final String? placedAt;
  final String? deliveredAt;
  final String? cancelledAt;
  final String? cancelReason;

  /// The table, room and booking this order belongs to — carried so a
  /// delivered order can be billed straight from here, the same opaque key
  /// (`table-5`, `room-12`, `counter-88`) Billing's own food queue uses. A
  /// room order tied to a live booking is left off that direct path: its
  /// food rides on the stay bill instead, the same exception
  /// OrdersPanel.jsx's own `canIssue` makes.
  final int? tableId;
  final int? roomId;
  final int? bookingId;

  /// A guest's own QR scan has nobody behind it until someone accepts it;
  /// a staff-entered order carries its author from the start — same split
  /// OrdersPanel.jsx's own `SourceTag` reads.
  final bool guestOrder;

  /// Who accepted (a guest order) or took (a staff order) this ticket, once
  /// somebody has — null on a still-unaccepted guest order.
  final String? handledBy;

  /// Once an invoice carries the order its lines are money — no more edits.
  final bool billed;

  /// Marked by the captain once a fully delivered order is done and the
  /// guest is ready to pay: it then shows up in Billing's "Food to bill".
  final bool readyToBill;

  final int? invoiceId;

  /// The bill number once one has been issued — shown under the status
  /// badge, same as OrdersPanel.jsx's own `Bill {o.invoiceNumber}` note.
  final String? invoiceNumber;

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
    this.guestPhone,
    this.note,
    this.status = 'PENDING',
    this.subtotal = 0,
    this.placedAt,
    this.deliveredAt,
    this.cancelledAt,
    this.cancelReason,
    this.tableId,
    this.roomId,
    this.bookingId,
    this.guestOrder = false,
    this.handledBy,
    this.billed = false,
    this.readyToBill = false,
    this.invoiceId,
    this.invoiceNumber,
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
    guestPhone: asStringOrNull(json['guestPhone']),
    note: asStringOrNull(json['note']),
    status: asStringOrNull(json['status']) ?? 'PENDING',
    subtotal: asNumOrNull(json['subtotal']) ?? 0,
    placedAt: asStringOrNull(json['placedAt']),
    deliveredAt: asStringOrNull(json['deliveredAt']),
    cancelledAt: asStringOrNull(json['cancelledAt']),
    cancelReason: asStringOrNull(json['cancelReason']),
    tableId: asIntOrNull(json['tableId']),
    roomId: asIntOrNull(json['roomId']),
    bookingId: asIntOrNull(json['bookingId']),
    guestOrder: json['guestOrder'] == true,
    handledBy: asStringOrNull(json['handledBy']),
    billed: json['billed'] == true,
    readyToBill: json['readyToBill'] == true,
    invoiceId: asIntOrNull(json['invoiceId']),
    invoiceNumber: asStringOrNull(json['invoiceNumber']),
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

  /// Delivered and not yet billed — the base condition both "Ready to bill"
  /// and "Issue bill" share. Unlike [canMarkReadyToBill] this stays true once
  /// [readyToBill] is set: a login that can issue the bill directly may still
  /// do so for an order a captain already sent to the queue.
  bool get isDeliveredUnbilled => status == 'DELIVERED' && !billed;

  /// A room order still tied to a live booking bills through the stay's own
  /// room bill at checkout, not as a standalone food invoice — same
  /// exception OrdersPanel.jsx's own `canIssue` carves out
  /// (`order.source !== 'ROOM' || !order.bookingId`).
  bool get billableAsFoodTab => source != 'ROOM' || bookingId == null;

  /// The opaque key Billing's own food queue addresses this ticket's tab by
  /// — `table-5`, `counter-88`, `room-12` — so "Issue bill" can open the
  /// right bill without first reading the queue itself.
  String get billingTabKey => switch (source) {
    'TABLE' => 'table-$tableId',
    'COUNTER' => 'counter-$id',
    _ => 'room-$roomId',
  };

  /// Unbilled, not sent to billing, not called off — the same rule
  /// OrdersPanel.jsx's `canEdit`/`editable` checks. Its items can still be
  /// changed, whatever status it is otherwise sitting at.
  bool get isEditable => !billed && !readyToBill && status != 'CANCELLED';

  String get statusLabel => kOrderStatusLabels[status] ?? status;

  /// Who the food is for: the name (and number) typed at the counter, or the
  /// guest staying in the room. Null for a table order nobody has named yet
  /// — same as OrdersPanel.jsx's own `Customer` component.
  String? get customerLabel {
    if ((guestName ?? '').isEmpty && (guestPhone ?? '').isEmpty) return null;
    final name = guestName ?? '';
    final phone = guestPhone ?? '';
    if (name.isNotEmpty && phone.isNotEmpty) return '$name · $phone';
    return name.isNotEmpty ? name : phone;
  }

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

  /// How long this ticket actually took, once it is settled — from placed to
  /// delivered or cancelled, same as History's own "Took" column
  /// (OrdersPanel.jsx's `elapsedLabel(o.placedAt, new Date(settledAt))`).
  /// Null while it is still live.
  Duration? get took {
    final settledIso = deliveredAt ?? cancelledAt;
    final placed = DateTime.tryParse(placedAt ?? '');
    final settled = DateTime.tryParse(settledIso ?? '');
    if (placed == null || settled == null) return null;
    final elapsed = settled.difference(placed);
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
