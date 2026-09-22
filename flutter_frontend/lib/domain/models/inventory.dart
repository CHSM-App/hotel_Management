import 'json.dart';

/// Something the kitchen buys and counts — rice, oil, gas. Recipes draw down
/// against it. See inventory.schema.js for the fixed unit/category lists this
/// mirrors.
class RawMaterial {
  final int id;
  final String name;
  final String unit;
  final String category;
  final num quantity;
  final num lowStockThreshold;
  final bool isActive;

  /// The count is wrong, not merely low — see mapMaterial's own comment on
  /// the server. Cooked more than the books say was bought.
  final bool isNegative;
  final bool isLow;
  final int usedByDishes;

  const RawMaterial({
    required this.id,
    this.name = '',
    this.unit = 'KG',
    this.category = 'OTHER',
    this.quantity = 0,
    this.lowStockThreshold = 0,
    this.isActive = true,
    this.isNegative = false,
    this.isLow = false,
    this.usedByDishes = 0,
  });

  factory RawMaterial.fromJson(Map<String, dynamic> json) => RawMaterial(
    id: asInt(json['id']),
    name: asStringOrNull(json['name']) ?? '',
    unit: asStringOrNull(json['unit']) ?? 'KG',
    category: asStringOrNull(json['category']) ?? 'OTHER',
    quantity: asNumOrNull(json['quantity']) ?? 0,
    lowStockThreshold: asNumOrNull(json['lowStockThreshold']) ?? 0,
    isActive: asBool(json['isActive']),
    isNegative: asBool(json['isNegative']),
    isLow: asBool(json['isLow']),
    usedByDishes: asInt(json['usedByDishes']),
  );
}

/// One row of a material's ledger, from GET /inventory/movements.
class StockMovement {
  final int id;
  final int materialId;
  final String materialName;
  final String unit;
  final num changeQty;
  final num balanceAfter;
  final String reason;
  final int? orderId;
  final int? orderNumber;
  final String? itemName;
  final String? note;
  final String? byName;
  final String createdAt;

  const StockMovement({
    required this.id,
    this.materialId = 0,
    this.materialName = '',
    this.unit = 'KG',
    this.changeQty = 0,
    this.balanceAfter = 0,
    this.reason = '',
    this.orderId,
    this.orderNumber,
    this.itemName,
    this.note,
    this.byName,
    this.createdAt = '',
  });

  factory StockMovement.fromJson(Map<String, dynamic> json) => StockMovement(
    id: asInt(json['id']),
    materialId: asInt(json['materialId']),
    materialName: asStringOrNull(json['materialName']) ?? '',
    unit: asStringOrNull(json['unit']) ?? 'KG',
    changeQty: asNumOrNull(json['changeQty']) ?? 0,
    balanceAfter: asNumOrNull(json['balanceAfter']) ?? 0,
    reason: asStringOrNull(json['reason']) ?? '',
    orderId: asIntOrNull(json['orderId']),
    orderNumber: asIntOrNull(json['orderNumber']),
    itemName: asStringOrNull(json['itemName']),
    note: asStringOrNull(json['note']),
    byName: asStringOrNull(json['byName']),
    createdAt: json['createdAt']?.toString() ?? '',
  );
}

/// One dish's recipe status, from GET /inventory/recipes — whether it has
/// been described at all, not what it's made of (see [ItemRecipe] for that).
class RecipeDishSummary {
  final int itemId;
  final String name;
  final int categoryId;
  final String categoryName;
  final String? foodType;
  final bool isActive;
  final int portionCount;
  final int lineCount;

  /// Some sizes were given a recipe and others weren't — flagged rather than
  /// silently treated as "no recipe for the rest".
  final bool partialSizes;

  const RecipeDishSummary({
    required this.itemId,
    this.name = '',
    this.categoryId = 0,
    this.categoryName = '',
    this.foodType,
    this.isActive = true,
    this.portionCount = 0,
    this.lineCount = 0,
    this.partialSizes = false,
  });

  factory RecipeDishSummary.fromJson(Map<String, dynamic> json) =>
      RecipeDishSummary(
        itemId: asInt(json['itemId']),
        name: asStringOrNull(json['name']) ?? '',
        categoryId: asInt(json['categoryId']),
        categoryName: asStringOrNull(json['categoryName']) ?? '',
        foodType: asStringOrNull(json['foodType']),
        isActive: asBool(json['isActive']),
        portionCount: asInt(json['portionCount']),
        lineCount: asInt(json['lineCount']),
        partialSizes: asBool(json['partialSizes']),
      );
}

/// A dish's size, as named in a recipe — [ItemRecipe.portions] carries only
/// the id and label a recipe line can point at, not the price MenuPortion
/// itself carries.
class RecipePortionRef {
  final int id;
  final String label;

  const RecipePortionRef({required this.id, this.label = ''});

  factory RecipePortionRef.fromJson(Map<String, dynamic> json) =>
      RecipePortionRef(
        id: asInt(json['id']),
        label: asStringOrNull(json['label']) ?? '',
      );
}

/// One ingredient line of a recipe. [portionId] null means "applies at any
/// size" — see itemRecipeSchema's own comment on the server.
class RecipeLine {
  final int id;
  final int? portionId;
  final int materialId;
  final String materialName;
  final String unit;
  final num quantity;

  const RecipeLine({
    this.id = 0,
    this.portionId,
    required this.materialId,
    this.materialName = '',
    this.unit = 'KG',
    this.quantity = 0,
  });

  factory RecipeLine.fromJson(Map<String, dynamic> json) => RecipeLine(
    id: asInt(json['id']),
    portionId: asIntOrNull(json['portionId']),
    materialId: asInt(json['materialId']),
    materialName: asStringOrNull(json['materialName']) ?? '',
    unit: asStringOrNull(json['unit']) ?? 'KG',
    quantity: asNumOrNull(json['quantity']) ?? 0,
  );

  Map<String, dynamic> toJson() => {
    'portionId': portionId,
    'materialId': materialId,
    'quantity': quantity,
  };
}

/// One dish with its sizes and its ingredient lines — GET/PUT
/// /inventory/recipes/:itemId in full, everything the recipe editor needs in
/// one call.
class ItemRecipe {
  final int itemId;
  final String name;
  final String? foodType;
  final List<RecipePortionRef> portions;
  final List<RecipeLine> lines;

  const ItemRecipe({
    required this.itemId,
    this.name = '',
    this.foodType,
    this.portions = const [],
    this.lines = const [],
  });

  factory ItemRecipe.fromJson(Map<String, dynamic> json) => ItemRecipe(
    itemId: asInt(json['itemId']),
    name: asStringOrNull(json['name']) ?? '',
    foodType: asStringOrNull(json['foodType']),
    portions: (json['portions'] as List? ?? const [])
        .map((e) => RecipePortionRef.fromJson(e as Map<String, dynamic>))
        .toList(),
    lines: (json['lines'] as List? ?? const [])
        .map((e) => RecipeLine.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}
