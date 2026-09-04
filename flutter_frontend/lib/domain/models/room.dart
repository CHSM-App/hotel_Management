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

/// One photo already uploaded to a room, from GET /rooms.
class RoomImage {
  final int id;
  final String filename;

  const RoomImage({required this.id, required this.filename});

  factory RoomImage.fromJson(Map<String, dynamic> json) => RoomImage(
    id: asInt(json['id']),
    filename: json['filename']?.toString() ?? '',
  );
}

/// A bed in a room's bed list — a family room is a double and two singles, so
/// this is a list rather than one enum. See rooms.schema.js on the server.
class RoomBed {
  final String size;
  final int count;

  const RoomBed({required this.size, required this.count});

  factory RoomBed.fromJson(Map<String, dynamic> json) => RoomBed(
    size: json['size']?.toString() ?? '',
    count: asInt(json['count'], fallback: 1),
  );
}

/// A room as GET /rooms (rooms.manage) returns it — the setup view, with
/// status, photos and every bed, as opposed to [Room] from
/// /bookings/available-rooms which is the booking-time view of a sellable
/// room for a chosen date range.
class RoomListing {
  final int id;
  final String roomNumber;
  final String? floor;
  final List<RoomBed> beds;
  final String? bathroomType;
  final int? maxOccupancy;
  final String? description;
  final bool isActive;
  final RoomCategoryRef category;
  final List<SwitchableCharge> switchableCharges;
  final List<RoomImage> images;
  final num price;

  const RoomListing({
    required this.id,
    required this.roomNumber,
    this.floor,
    this.beds = const [],
    this.bathroomType,
    this.maxOccupancy,
    this.description,
    required this.isActive,
    required this.category,
    this.switchableCharges = const [],
    this.images = const [],
    required this.price,
  });

  factory RoomListing.fromJson(Map<String, dynamic> json) => RoomListing(
    id: asInt(json['id']),
    roomNumber: json['roomNumber']?.toString() ?? '',
    floor: asStringOrNull(json['floor']),
    beds:
        (json['beds'] as List?)
            ?.map((e) => RoomBed.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    bathroomType: asStringOrNull(json['bathroomType']),
    maxOccupancy: asIntOrNull(json['maxOccupancy']),
    description: asStringOrNull(json['description']),
    isActive: asBool(json['isActive']),
    category: RoomCategoryRef.fromJson(
      json['category'] as Map<String, dynamic>,
    ),
    switchableCharges:
        (json['switchableCharges'] as List?)
            ?.map((e) => SwitchableCharge.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    images:
        (json['images'] as List?)
            ?.map((e) => RoomImage.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    price: asNum(json['price']),
  );
}

/// The category a room belongs to, as embedded in a room listing.
class RoomCategoryRef {
  final int id;
  final String name;
  final num basePrice;

  const RoomCategoryRef({
    required this.id,
    required this.name,
    required this.basePrice,
  });

  factory RoomCategoryRef.fromJson(Map<String, dynamic> json) =>
      RoomCategoryRef(
        id: asInt(json['id']),
        name: json['name']?.toString() ?? '',
        basePrice: asNum(json['basePrice']),
      );
}
