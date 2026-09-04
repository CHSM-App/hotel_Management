import 'json.dart';

/// A room category / rate plan, from GET /categories.
///
/// The base price is what a room in this category sells for — the same
/// figure the "Add room" picker on the web shows next to each option.
class RoomCategory {
  final int id;
  final String name;
  final num basePrice;
  final bool isActive;

  const RoomCategory({
    required this.id,
    required this.name,
    required this.basePrice,
    required this.isActive,
  });

  factory RoomCategory.fromJson(Map<String, dynamic> json) => RoomCategory(
    id: asInt(json['id']),
    name: json['name']?.toString() ?? '',
    basePrice: asNum(json['basePrice']),
    isActive: asBool(json['isActive']),
  );
}
