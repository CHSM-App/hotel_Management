import 'json.dart';

/// One size of a dish, where a dish is sold in sizes.
class MenuPortion {
  final int id;
  final String label;
  final num price;
  final bool isAvailable;

  const MenuPortion({
    required this.id,
    this.label = '',
    this.price = 0,
    this.isAvailable = true,
  });

  factory MenuPortion.fromJson(Map<String, dynamic> json) => MenuPortion(
    id: asInt(json['id']),
    label: asStringOrNull(json['label']) ?? '',
    price: asNumOrNull(json['price']) ?? 0,
    isAvailable: asBool(json['isAvailable']),
  );
}

/// A dish.
class MenuItem {
  final int id;
  final int categoryId;
  final String name;
  final String? description;
  final num price;

  /// VEG, NON_VEG or EGG — drawn as the mark rather than spelled out.
  final String? foodType;

  /// The kitchen's out-of-stock switch. An unavailable dish is shown and not
  /// orderable rather than hidden, so the desk can tell a guest it is off
  /// today instead of that it does not exist.
  final bool isAvailable;

  final bool isActive;
  final int sortOrder;

  /// The dish photo's filename, served under /menu-images — see
  /// menu.service.js's mapItem. Null for a dish with none.
  final String? image;
  final List<MenuPortion> portions;

  const MenuItem({
    required this.id,
    this.categoryId = 0,
    this.name = '',
    this.description,
    this.price = 0,
    this.foodType,
    this.isAvailable = true,
    this.isActive = true,
    this.sortOrder = 0,
    this.image,
    this.portions = const [],
  });

  factory MenuItem.fromJson(Map<String, dynamic> json) => MenuItem(
    id: asInt(json['id']),
    categoryId: asInt(json['categoryId']),
    name: asStringOrNull(json['name']) ?? '',
    description: asStringOrNull(json['description']),
    price: asNumOrNull(json['price']) ?? 0,
    foodType: asStringOrNull(json['foodType']),
    isAvailable: asBool(json['isAvailable']),
    isActive: asBool(json['isActive']),
    sortOrder: asInt(json['sortOrder']),
    image: asStringOrNull(json['image']),
    portions: (json['portions'] as List? ?? const [])
        .map((e) => MenuPortion.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  /// A dish sold in sizes has no single price of its own — the portion carries
  /// it, and the server refuses a line that names one without the other.
  bool get hasPortions => portions.isNotEmpty;

  /// What to order at, given a chosen size.
  num priceFor(MenuPortion? portion) => portion?.price ?? price;

  /// Whether this can be put on a ticket at all.
  bool get orderable => isActive && isAvailable;
}

/// A section of the menu.
class MenuSection {
  final int id;
  final String name;
  final bool isActive;
  final int sortOrder;
  final List<MenuItem> items;

  const MenuSection({
    required this.id,
    this.name = '',
    this.isActive = true,
    this.sortOrder = 0,
    this.items = const [],
  });

  factory MenuSection.fromJson(Map<String, dynamic> json) => MenuSection(
    id: asInt(json['id']),
    name: asStringOrNull(json['name']) ?? '',
    isActive: asBool(json['isActive']),
    sortOrder: asInt(json['sortOrder']),
    items: (json['items'] as List? ?? const [])
        .map((e) => MenuItem.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}

/// A table guests sit at.
///
/// [seats] and [qrToken] only matter to the setup screen (tables_panel.dart,
/// qr_codes_panel.dart) — the order-taking screens that first defined this
/// model never read either, so both default away rather than becoming
/// required and forcing a call site nobody asked to change.
class DiningTable {
  final int id;
  final String label;
  final bool isActive;
  final int? seats;

  /// The opaque id printed into this table's QR code — see qr.js's
  /// tableOrderUrl equivalent, [foodQrUrls] below.
  final String? qrToken;

  const DiningTable({
    required this.id,
    this.label = '',
    this.isActive = true,
    this.seats,
    this.qrToken,
  });

  factory DiningTable.fromJson(Map<String, dynamic> json) => DiningTable(
    id: asInt(json['id']),
    label: asStringOrNull(json['label']) ?? '',
    isActive: asBool(json['isActive']),
    seats: asIntOrNull(json['seats']),
    qrToken: asStringOrNull(json['qrToken']),
  );
}

/// GET/PATCH /menu/settings — the switches under Food setup > Settings.
///
/// [hasRooms] rides along read-only: it decides whether [foodRoomService] can
/// be turned on at all, but is set by Vengurla Tech at onboarding, never by
/// this screen — see foodSettingsSchema's own comment on the server.
class FoodSettings {
  final bool hasRooms;
  final bool servesFood;
  final bool foodRoomService;
  final bool foodTableService;

  const FoodSettings({
    this.hasRooms = false,
    this.servesFood = false,
    this.foodRoomService = false,
    this.foodTableService = false,
  });

  factory FoodSettings.fromJson(Map<String, dynamic> json) => FoodSettings(
    hasRooms: asBool(json['hasRooms']),
    servesFood: asBool(json['servesFood']),
    foodRoomService: asBool(json['foodRoomService']),
    foodTableService: asBool(json['foodTableService']),
  );

  FoodSettings copyWith({
    bool? servesFood,
    bool? foodRoomService,
    bool? foodTableService,
  }) => FoodSettings(
    hasRooms: hasRooms,
    servesFood: servesFood ?? this.servesFood,
    foodRoomService: foodRoomService ?? this.foodRoomService,
    foodTableService: foodTableService ?? this.foodTableService,
  );

  Map<String, dynamic> toJson() => {
    'servesFood': servesFood,
    'foodRoomService': foodRoomService,
    'foodTableService': foodTableService,
  };
}

/// A line the desk is building on a counter order, before it is sent.
class OrderLineDraft {
  final MenuItem item;
  final MenuPortion? portion;
  int quantity;

  OrderLineDraft({required this.item, this.portion, this.quantity = 1});

  num get unitPrice => item.priceFor(portion);

  num get lineTotal => unitPrice * quantity;

  String get label =>
      portion == null ? item.name : '${item.name} · ${portion!.label}';

  /// The shape orderItemsSchema takes. portionId is left out entirely rather
  /// than sent null for a dish that has no sizes.
  Map<String, dynamic> toJson() => {
    'itemId': item.id,
    if (portion != null) 'portionId': portion!.id,
    'quantity': quantity,
  };
}
