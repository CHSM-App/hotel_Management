import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'draft.dart';
import 'quote.dart';
import 'room.dart';

/// One further room on a multi-room booking — room 1 itself still lives on
/// [BookingState]'s own `room`/`bedIds`/`extras`/`roomTotal` fields (see
/// booking_viewmodel.dart); this is the shape for every room after that.
class ExtraRoomDraft {
  /// Non-null only when this room already exists on the booking being
  /// edited — carried back on save so the server updates it in place rather
  /// than reading it as a new room.
  final int? bookingRoomId;

  final Room? room;
  final List<int> bedIds;
  final bool buyout;

  /// This room's own dates — null while "same dates for all rooms" is on,
  /// in which case the booking's shared dates apply (see
  /// [MultiRoomLogic.roomDates]).
  final DateTime? checkIn;
  final DateTime? checkOut;

  final Map<int, ExtraDraft> extras;

  /// The nightly rate agreed for this room, where it is not the category's
  /// own. Typed text; blank means the category price.
  final String roomTotal;

  /// BOOKED, CHECKED_IN, CHECKED_OUT or CANCELLED — 'BOOKED' for a room just
  /// picked and not yet saved. Only a BOOKED room can be removed.
  final String status;

  /// This room's own slice of the last multi-room quote.
  final RoomQuote? quote;

  /// This card's own available-rooms fetch, for the different-dates path
  /// where each extra room asks against its own dates independently.
  final AsyncValue<List<Room>>? availableRooms;

  /// This card's own available-beds fetch, once a dormitory room is picked —
  /// kept per card the same way [availableRooms] is, since each extra room's
  /// dates (and so its own free beds) can differ from every other room's.
  final AsyncValue<AvailableBeds>? availableBeds;

  const ExtraRoomDraft({
    this.bookingRoomId,
    this.room,
    this.bedIds = const [],
    this.buyout = false,
    this.checkIn,
    this.checkOut,
    this.extras = const {},
    this.roomTotal = '',
    this.status = 'BOOKED',
    this.quote,
    this.availableRooms,
    this.availableBeds,
  });

  ExtraRoomDraft copyWith({
    int? bookingRoomId,
    Room? room,
    bool clearRoom = false,
    List<int>? bedIds,
    bool clearBedIds = false,
    bool? buyout,
    DateTime? checkIn,
    DateTime? checkOut,
    bool clearDates = false,
    Map<int, ExtraDraft>? extras,
    String? roomTotal,
    String? status,
    RoomQuote? quote,
    bool clearQuote = false,
    AsyncValue<List<Room>>? availableRooms,
    AsyncValue<AvailableBeds>? availableBeds,
    bool clearAvailableBeds = false,
  }) => ExtraRoomDraft(
    bookingRoomId: bookingRoomId ?? this.bookingRoomId,
    room: clearRoom ? null : (room ?? this.room),
    bedIds: (clearRoom || clearBedIds) ? const [] : (bedIds ?? this.bedIds),
    buyout: clearRoom ? false : (buyout ?? this.buyout),
    checkIn: clearDates ? null : (checkIn ?? this.checkIn),
    checkOut: clearDates ? null : (checkOut ?? this.checkOut),
    extras: clearRoom ? const {} : (extras ?? this.extras),
    roomTotal: clearRoom ? '' : (roomTotal ?? this.roomTotal),
    status: status ?? this.status,
    quote: clearQuote ? null : (quote ?? this.quote),
    availableRooms: availableRooms ?? this.availableRooms,
    availableBeds: (clearRoom || clearAvailableBeds)
        ? null
        : (availableBeds ?? this.availableBeds),
  );

  /// A room actually picked, as opposed to a blank slot waiting for one
  /// (the different-dates path's freshly "+ Add another room" card).
  bool get isPicked => room != null;
}
