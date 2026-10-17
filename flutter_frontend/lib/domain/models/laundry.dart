import 'json.dart';

/// Laundry — hotel linen through the wash, and guest clothes taken in at the
/// desk. Mirrors LaundryPanel.jsx's two tabs field-for-field.

// ---------------------------------------------------------------------------
// Hotel linen
// ---------------------------------------------------------------------------

/// What the lodge's own laundry is recorded as, so Send/Receive can offer it
/// as a one-tap choice alongside a named outside vendor.
const kOwnLaundry = 'Own laundry';

/// One linen type's stock, split across the four places it can be — mirrors
/// mapLinenItem-shaped rows from GET /housekeeping/linen in
/// housekeeping.service.js's listLinen.
class LinenItem {
  final int id;
  final String name;
  final int totalOwned;
  final bool isActive;
  final int owned;
  final int withHousekeeping;
  final int dirty;
  final int inLaundry;
  final int clean;
  final bool short;
  final int lostTotal;

  const LinenItem({
    required this.id,
    this.name = '',
    this.totalOwned = 0,
    this.isActive = true,
    this.owned = 0,
    this.withHousekeeping = 0,
    this.dirty = 0,
    this.inLaundry = 0,
    this.clean = 0,
    this.short = false,
    this.lostTotal = 0,
  });

  factory LinenItem.fromJson(Map<String, dynamic> json) => LinenItem(
    id: asInt(json['id']),
    name: asStringOrNull(json['name']) ?? '',
    totalOwned: asInt(json['totalOwned']),
    isActive: asBool(json['isActive']),
    owned: asInt(json['owned']),
    withHousekeeping: asInt(json['withHousekeeping']),
    dirty: asInt(json['dirty']),
    inLaundry: asInt(json['inLaundry']),
    clean: asInt(json['clean']),
    short: asBool(json['short']),
    lostTotal: asInt(json['lostTotal']),
  );
}

/// One line of a handover entry — "4 Bedsheet", "2 Towel".
class LinenHandoverLine {
  final String name;
  final int quantity;

  const LinenHandoverLine({required this.name, required this.quantity});

  factory LinenHandoverLine.fromJson(Map<String, dynamic> json) => LinenHandoverLine(
    name: asStringOrNull(json['name']) ?? '',
    quantity: asInt(json['quantity']),
  );
}

/// Linen changed in one room that housekeeping has not handed over yet —
/// mirrors listHandovers in housekeeping.service.js.
class LinenHandover {
  final String key;
  final String? roomNumber;
  // A venue the linen changed in, where it wasn't a room — mirrors
  // listHandovers' venue_name (housekeeping.service.js).
  final String? venueName;
  final String? changedBy;
  final String? changedById;
  final String changedAt;
  final List<int> movementIds;
  final List<LinenHandoverLine> lines;

  const LinenHandover({
    required this.key,
    this.roomNumber,
    this.venueName,
    this.changedBy,
    this.changedById,
    this.changedAt = '',
    this.movementIds = const [],
    this.lines = const [],
  });

  factory LinenHandover.fromJson(Map<String, dynamic> json) => LinenHandover(
    key: asStringOrNull(json['key']) ?? '',
    roomNumber: asStringOrNull(json['roomNumber']),
    venueName: asStringOrNull(json['venueName']),
    changedBy: asStringOrNull(json['changedBy']),
    changedById: asStringOrNull(json['changedById']),
    changedAt: json['changedAt']?.toString() ?? '',
    movementIds: (json['movementIds'] as List? ?? []).map((e) => asInt(e)).toList(),
    lines: (json['lines'] as List? ?? []).map((e) => LinenHandoverLine.fromJson(e as Map<String, dynamic>)).toList(),
  );

  int get pieces => lines.fold(0, (n, l) => n + l.quantity);

  /// A room by its number, or a venue by its own name — mirrors the web's
  /// `h.roomNumber ?? h.venueName ?? '—'`.
  String get placeLabel => roomNumber ?? venueName ?? '—';
}

/// Linen changed in rooms waiting with housekeeping, grouped by who has it —
/// a client-side grouping of [LinenHandover]s, mirrors the staffGroups
/// construction in LaundryPanel.jsx's LinenTab.
class LinenStaffGroup {
  final String key;
  final String name;
  final List<LinenHandover> handovers;
  final List<int> movementIds;
  final int pieces;
  final Map<String, int> byItem;

  const LinenStaffGroup({
    required this.key,
    required this.name,
    this.handovers = const [],
    this.movementIds = const [],
    this.pieces = 0,
    this.byItem = const {},
  });

  static List<LinenStaffGroup> groupOf(List<LinenHandover> handovers) {
    final groups = <String, _MutableGroup>{};
    final order = <String>[];
    for (final h in handovers) {
      final key = h.changedById ?? 'unknown';
      var g = groups[key];
      if (g == null) {
        g = _MutableGroup(key: key, name: h.changedBy ?? 'Staff not recorded');
        groups[key] = g;
        order.add(key);
      }
      g.handovers.add(h);
      g.movementIds.addAll(h.movementIds);
      for (final l in h.lines) {
        g.pieces += l.quantity;
        g.byItem[l.name] = (g.byItem[l.name] ?? 0) + l.quantity;
      }
    }
    return order
        .map((k) => groups[k]!)
        .map((g) => LinenStaffGroup(key: g.key, name: g.name, handovers: g.handovers, movementIds: g.movementIds, pieces: g.pieces, byItem: g.byItem))
        .toList();
  }
}

class _MutableGroup {
  final String key;
  final String name;
  final List<LinenHandover> handovers = [];
  final List<int> movementIds = [];
  int pieces = 0;
  final Map<String, int> byItem = {};
  _MutableGroup({required this.key, required this.name});
}

/// One row of linen moving — changed, sent, received, lost or damaged.
/// Mirrors listLinenMovements in housekeeping.service.js.
class LinenMovement {
  final int id;
  final String kind; // CHANGED | SENT | RECEIVED | LOST | DAMAGED
  final String? source;
  final int quantity;
  final String? note;
  final String? washedBy;
  final num? washCharge;
  final String createdAt;
  final String itemName;
  final String? roomNumber;
  final String? venueName;
  final String? userName;

  const LinenMovement({
    required this.id,
    this.kind = '',
    this.source,
    this.quantity = 0,
    this.note,
    this.washedBy,
    this.washCharge,
    this.createdAt = '',
    this.itemName = '',
    this.roomNumber,
    this.venueName,
    this.userName,
  });

  factory LinenMovement.fromJson(Map<String, dynamic> json) => LinenMovement(
    id: asInt(json['id']),
    kind: asStringOrNull(json['kind']) ?? '',
    source: asStringOrNull(json['source']),
    quantity: asInt(json['quantity']),
    note: asStringOrNull(json['note']),
    washedBy: asStringOrNull(json['washedBy']),
    washCharge: asNumOrNull(json['washCharge']),
    createdAt: json['createdAt']?.toString() ?? '',
    itemName: asStringOrNull(json['itemName']) ?? '',
    roomNumber: asStringOrNull(json['roomNumber']),
    venueName: asStringOrNull(json['venueName']),
    userName: asStringOrNull(json['userName']),
  );

  /// A room by its number, or a venue by its own name — mirrors the web's
  /// `m.roomNumber || m.venueName || ''`.
  String get placeLabel => roomNumber ?? venueName ?? '';
}

const kLinenMoveLabel = {
  'CHANGED': 'Changed in a room or venue',
  'SENT': 'Sent for washing',
  'RECEIVED': 'Received washed',
  'LOST': 'Marked lost',
  'DAMAGED': 'Marked damaged',
};

/// GET /housekeeping/linen's whole payload — items, their recent history,
/// handovers waiting with housekeeping, and who washed last.
class LinenBoard {
  final List<LinenItem> items;
  final List<LinenMovement> movements;
  final List<LinenHandover> handovers;
  final String lastWashedBy;
  // True where the property keeps its linen in Asset Inventory, under the
  // "Bedsheets & Towels" category — Laundry then only reads it; adding an
  // item or changing its name/count happens there instead. Mirrors the
  // `managedInAssets` flag housekeeping.controller.js's listLinen adds.
  final bool managedInAssets;

  const LinenBoard({
    this.items = const [],
    this.movements = const [],
    this.handovers = const [],
    this.lastWashedBy = '',
    this.managedInAssets = false,
  });

  factory LinenBoard.fromJson(Map<String, dynamic> json) => LinenBoard(
    items: (json['items'] as List? ?? []).map((e) => LinenItem.fromJson(e as Map<String, dynamic>)).toList(),
    movements: (json['movements'] as List? ?? []).map((e) => LinenMovement.fromJson(e as Map<String, dynamic>)).toList(),
    handovers: (json['handovers'] as List? ?? []).map((e) => LinenHandover.fromJson(e as Map<String, dynamic>)).toList(),
    lastWashedBy: asStringOrNull(json['lastWashedBy']) ?? '',
    managedInAssets: asBool(json['managedInAssets']),
  );
}

// ---------------------------------------------------------------------------
// Guest laundry
// ---------------------------------------------------------------------------

/// A garment and the price it was last charged — offered back on the next
/// order's form, mirrors listRecentGarments.
class RecentGarment {
  final String name;
  final num price;

  const RecentGarment({required this.name, this.price = 0});

  factory RecentGarment.fromJson(Map<String, dynamic> json) => RecentGarment(
    name: asStringOrNull(json['name']) ?? '',
    price: asNum(json['price']),
  );
}

/// A guest currently checked in, for the New laundry form's guest picker —
/// mirrors listInHouse. Named apart from the unrelated InHouseGuest in
/// domain/models/invoice.dart (that one has no roomId, which this needs
/// since one booking can hold several rooms).
class LaundryGuestStay {
  final int bookingId;
  final int roomId;
  final String? roomNumber;
  final String guestName;

  const LaundryGuestStay({required this.bookingId, required this.roomId, this.roomNumber, this.guestName = ''});

  factory LaundryGuestStay.fromJson(Map<String, dynamic> json) => LaundryGuestStay(
    bookingId: asInt(json['bookingId']),
    roomId: asInt(json['roomId']),
    roomNumber: asStringOrNull(json['roomNumber']),
    guestName: asStringOrNull(json['guestName']) ?? '',
  );
}

/// One garment line on a laundry order.
class LaundryOrderItem {
  final int id;
  final String name;
  final int quantity;
  final num unitPrice;
  final num lineTotal;

  const LaundryOrderItem({required this.id, this.name = '', this.quantity = 0, this.unitPrice = 0, this.lineTotal = 0});

  factory LaundryOrderItem.fromJson(Map<String, dynamic> json) => LaundryOrderItem(
    id: asInt(json['id']),
    name: asStringOrNull(json['name']) ?? '',
    quantity: asInt(json['quantity']),
    unitPrice: asNum(json['unitPrice']),
    lineTotal: asNum(json['lineTotal']),
  );
}

/// Sent to wash (RECEIVED/WASHING), back from the wash (READY), handed to the
/// guest (DELIVERED), or CANCELLED. Mirrors mapOrder in housekeeping.service.js.
class LaundryOrder {
  final int id;
  final int tagNumber;
  final String status;
  final String? roomNumber;
  final String guestName;
  final String? guestPhone;
  final String? note;
  final String? washedBy;
  final String? vendorPhone;
  final num? washCharge;
  final String? washedBackAt;
  final String receivedAt;
  final String? deliveredAt;
  final int pieces;
  final num total;
  final List<LaundryOrderItem> items;

  const LaundryOrder({
    required this.id,
    this.tagNumber = 0,
    this.status = 'RECEIVED',
    this.roomNumber,
    this.guestName = '',
    this.guestPhone,
    this.note,
    this.washedBy,
    this.vendorPhone,
    this.washCharge,
    this.washedBackAt,
    this.receivedAt = '',
    this.deliveredAt,
    this.pieces = 0,
    this.total = 0,
    this.items = const [],
  });

  factory LaundryOrder.fromJson(Map<String, dynamic> json) => LaundryOrder(
    id: asInt(json['id']),
    tagNumber: asInt(json['tagNumber']),
    status: asStringOrNull(json['status']) ?? 'RECEIVED',
    roomNumber: asStringOrNull(json['roomNumber']),
    guestName: asStringOrNull(json['guestName']) ?? '',
    guestPhone: asStringOrNull(json['guestPhone']),
    note: asStringOrNull(json['note']),
    washedBy: asStringOrNull(json['washedBy']),
    vendorPhone: asStringOrNull(json['vendorPhone']),
    washCharge: asNumOrNull(json['washCharge']),
    washedBackAt: asStringOrNull(json['washedBackAt']),
    receivedAt: json['receivedAt']?.toString() ?? '',
    deliveredAt: asStringOrNull(json['deliveredAt']),
    pieces: asInt(json['pieces']),
    total: asNum(json['total']),
    items: (json['items'] as List? ?? []).map((e) => LaundryOrderItem.fromJson(e as Map<String, dynamic>)).toList(),
  );

  bool get isOpen => status != 'DELIVERED' && status != 'CANCELLED';
}

/// Sent to wash, received back, handed over, or all of them — the "Show"
/// filter on the Guest laundry tab.
const kLaundryStatusLabel = {'RECEIVED': 'In wash', 'WASHING': 'In wash', 'READY': 'Received', 'DELIVERED': 'Handed over', 'CANCELLED': 'Cancelled'};
