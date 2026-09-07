import 'json.dart';

/// GET /bookings/tape-chart's own answer: every active room for the window,
/// and every stay, draft and cancellation that touches it — the same
/// purpose-built payload the web tape chart draws from, in place of
/// composing the setup screen's room list with the register's own fetch.
class TapeChartData {
  final List<TapeChartRoom> rooms;
  final List<TapeChartBooking> bookings;
  final List<TapeChartCancelled> cancelled;

  const TapeChartData({
    this.rooms = const [],
    this.bookings = const [],
    this.cancelled = const [],
  });

  factory TapeChartData.fromJson(Map<String, dynamic> json) => TapeChartData(
    rooms:
        (json['rooms'] as List?)
            ?.map((e) => TapeChartRoom.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    bookings:
        (json['bookings'] as List?)
            ?.map((e) => TapeChartBooking.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    cancelled:
        (json['cancelled'] as List?)
            ?.map((e) => TapeChartCancelled.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
  );
}

/// One room on the chart — every active room in the lodge, whether or not it
/// has a stay in the window, which is what lets a fully vacant room still
/// draw a row.
class TapeChartRoom {
  final int id;
  final String roomNumber;
  final String? floor;
  final String categoryName;

  const TapeChartRoom({
    required this.id,
    required this.roomNumber,
    this.floor,
    required this.categoryName,
  });

  factory TapeChartRoom.fromJson(Map<String, dynamic> json) => TapeChartRoom(
    id: asInt(json['id']),
    roomNumber: json['roomNumber']?.toString() ?? '',
    floor: asStringOrNull(json['floor']),
    categoryName: json['categoryName']?.toString() ?? '',
  );
}

/// One stay overlapping the window — a leaner cut of [Booking] built for the
/// grid and its search box rather than the register or the detail sheet: no
/// [Booking.advanceAmount], because the tape chart never shows one.
class TapeChartBooking {
  final int id;
  final int roomId;
  final String? guestName;
  final String? guestPhone;
  final String? idProofNumber;
  final String? invoiceNumber;
  final List<String> coGuestNames;
  final List<String> coGuestIdNumbers;
  final String? checkInDate;
  final String? checkOutDate;
  final String? status;
  final num? totalPrice;

  const TapeChartBooking({
    required this.id,
    required this.roomId,
    this.guestName,
    this.guestPhone,
    this.idProofNumber,
    this.invoiceNumber,
    this.coGuestNames = const [],
    this.coGuestIdNumbers = const [],
    this.checkInDate,
    this.checkOutDate,
    this.status,
    this.totalPrice,
  });

  factory TapeChartBooking.fromJson(Map<String, dynamic> json) =>
      TapeChartBooking(
        id: asInt(json['id']),
        roomId: asInt(json['roomId']),
        guestName: asStringOrNull(json['guestName']),
        guestPhone: asStringOrNull(json['guestPhone']),
        idProofNumber: asStringOrNull(json['idProofNumber']),
        invoiceNumber: asStringOrNull(json['invoiceNumber']),
        coGuestNames: _stringList(json['coGuestNames']),
        coGuestIdNumbers: _stringList(json['coGuestIdNumbers']),
        checkInDate: asStringOrNull(json['checkInDate']),
        checkOutDate: asStringOrNull(json['checkOutDate']),
        status: asStringOrNull(json['status']),
        totalPrice: asNumOrNull(json['totalPrice']),
      );

  static List<String> _stringList(dynamic value) =>
      (value as List?)?.map((e) => e.toString()).toList() ?? const [];

  /// Every field the desk can search on, lower-cased once rather than per
  /// keystroke — the same fields the web search box reaches, so a guest
  /// answers to the same query on either screen.
  List<String> get searchFields => [
    guestName,
    guestPhone,
    invoiceNumber,
    idProofNumber,
    ...coGuestNames,
    ...coGuestIdNumbers,
  ].whereType<String>().where((s) => s.isNotEmpty).map((s) => s.toLowerCase()).toList();
}

/// A stay cancelled inside the window — kept separate from [TapeChartBooking]
/// because the server's own shape for it is smaller and has no search fields;
/// used only to know a night is free again despite once having a booking on it.
class TapeChartCancelled {
  final int id;
  final int roomId;
  final String? checkInDate;
  final String? checkOutDate;

  const TapeChartCancelled({
    required this.id,
    required this.roomId,
    this.checkInDate,
    this.checkOutDate,
  });

  factory TapeChartCancelled.fromJson(Map<String, dynamic> json) =>
      TapeChartCancelled(
        id: asInt(json['id']),
        roomId: asInt(json['roomId']),
        checkInDate: asStringOrNull(json['checkInDate']),
        checkOutDate: asStringOrNull(json['checkOutDate']),
      );
}
