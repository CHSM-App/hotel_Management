import 'json.dart';

/// A booking extra as GET /switchable-charges (rooms.manage) returns it — the
/// setup view, with status, as opposed to the lean [SwitchableCharge] in
/// room.dart that rides along with a room listing at booking time.
class SwitchableChargeListing {
  final int id;
  final String name;
  final num chargePerNight;
  final bool isActive;
  final bool isCounter;

  const SwitchableChargeListing({
    required this.id,
    required this.name,
    required this.chargePerNight,
    required this.isActive,
    this.isCounter = false,
  });

  factory SwitchableChargeListing.fromJson(Map<String, dynamic> json) =>
      SwitchableChargeListing(
        id: asInt(json['id']),
        name: json['name']?.toString() ?? '',
        chargePerNight: asNum(json['chargePerNight']),
        isActive: asBool(json['isActive']),
        isCounter: asBool(json['isCounter']),
      );
}
