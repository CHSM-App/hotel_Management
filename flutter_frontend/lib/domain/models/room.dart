import 'json.dart';

/// A room offered for a date range, from GET /bookings/available-rooms.
///
/// The server has already excluded anything booked across those nights, so a
/// room in this list is sellable — the phone never decides availability for
/// itself. That matters: two clerks on two devices must not be able to talk
/// themselves into the same room, and only the server holds the lock that
/// stops it.
class Room {
  final int id;
  final String roomNumber;
  final String? floor;
  final String? bedSize;
  final String? bathroomType;
  final int? maxOccupancy;
  final String? description;
  final String categoryName;
  final num categoryBasePrice;
  final List<SwitchableCharge> switchableCharges;

  const Room({
    required this.id,
    required this.roomNumber,
    this.floor,
    this.bedSize,
    this.bathroomType,
    this.maxOccupancy,
    this.description,
    required this.categoryName,
    required this.categoryBasePrice,
    this.switchableCharges = const [],
  });

  factory Room.fromJson(Map<String, dynamic> json) => Room(
    // rooms.id is a BIGINT and arrives as a string — see json.dart.
    id: asInt(json['id']),
    roomNumber: json['roomNumber']?.toString() ?? '',
    floor: asStringOrNull(json['floor']),
    bedSize: asStringOrNull(json['bedSize']),
    bathroomType: asStringOrNull(json['bathroomType']),
    maxOccupancy: asIntOrNull(json['maxOccupancy']),
    description: asStringOrNull(json['description']),
    categoryName: json['categoryName']?.toString() ?? '',
    categoryBasePrice: asNum(json['categoryBasePrice']),
    switchableCharges:
        (json['switchableCharges'] as List?)
            ?.map((e) => SwitchableCharge.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
  );
}

/// An optional extra — AC, an extra bed. Priced per night, added flat after any
/// seasonal uplift, never compounded with it.
class SwitchableCharge {
  final int id;
  final String name;
  final num chargePerNight;

  /// Extras that come in counts (extra beds) get a quantity box; the rest are
  /// a plain on/off.
  final bool isCounter;

  const SwitchableCharge({
    required this.id,
    required this.name,
    required this.chargePerNight,
    this.isCounter = false,
  });

  factory SwitchableCharge.fromJson(Map<String, dynamic> json) =>
      SwitchableCharge(
        id: asInt(json['id']),
        name: json['name']?.toString() ?? '',
        chargePerNight: asNum(json['chargePerNight']),
        isCounter: asBool(json['isCounter']),
      );
}

/// GET /bookings/available-rooms returns the rooms plus the clashes that made
/// the others unavailable. Only the rooms are modelled — the phone offers what
/// is free rather than explaining what is not.
class AvailableRooms {
  final List<Room> rooms;

  const AvailableRooms({this.rooms = const []});

  factory AvailableRooms.fromJson(Map<String, dynamic> json) => AvailableRooms(
    rooms:
        (json['rooms'] as List?)
            ?.map((e) => Room.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
  );
}
