import '../../presentation/view_models/booking_viewmodel.dart';
import 'charge_selections.dart';
import 'draft.dart';
import 'extra_room.dart';
import 'quote.dart';
import 'room.dart';

/// Pure logic for a multi-room booking form — mirrors the web's
/// multiRoom.js one-for-one. Room 1 lives on [BookingState] itself
/// (`room`/`bedIds`/`extras`/`roomTotal`); every further room is one entry
/// of [BookingState.extraRooms]. None of this touches Riverpod beyond the
/// [BookingState]/[ExtraRoomDraft] shapes themselves, so it is tested the
/// same way [BookingViewModel.perNight]/[BookingViewModel.wholeAmount] are —
/// by calling it directly, no view model involved.
class MultiRoomLogic {
  const MultiRoomLogic._();

  /// A fresh, empty extra-room slot — the different-dates path's "+ Add
  /// another room".
  static ExtraRoomDraft blankExtraRoom({DateTime? checkIn, DateTime? checkOut}) =>
      ExtraRoomDraft(checkIn: checkIn, checkOut: checkOut);

  /// The dates one extra room actually uses: the booking's shared dates
  /// while "same dates for all rooms" is on, else its own (falling back to
  /// the shared ones if it hasn't set any yet).
  static (DateTime, DateTime)? roomDates(BookingState state, ExtraRoomDraft room) {
    if (!state.multiRoomDifferentDates) {
      final ci = state.checkIn, co = state.checkOut;
      return (ci != null && co != null) ? (ci, co) : null;
    }
    final ci = room.checkIn ?? state.checkIn;
    final co = room.checkOut ?? state.checkOut;
    return (ci != null && co != null) ? (ci, co) : null;
  }

  /// Extra rooms with an actual room chosen — a blank "+ Add another room"
  /// slot nobody picked anything in is not part of the booking.
  static List<ExtraRoomDraft> pickedExtraRooms(BookingState state) =>
      state.extraRooms.where((r) => r.isPicked).toList();

  /// The overall span the booking covers: the earliest check-in and the
  /// latest check-out across room 1 and every picked extra room.
  static (DateTime, DateTime)? bookingWindow(BookingState state) {
    final spans = <(DateTime, DateTime)>[
      if (state.checkIn != null && state.checkOut != null)
        (state.checkIn!, state.checkOut!),
      for (final r in pickedExtraRooms(state))
        if (roomDates(state, r) != null) roomDates(state, r)!,
    ];
    if (spans.isEmpty) return null;
    var earliest = spans.first.$1;
    var latest = spans.first.$2;
    for (final s in spans.skip(1)) {
      if (s.$1.isBefore(earliest)) earliest = s.$1;
      if (s.$2.isAfter(latest)) latest = s.$2;
    }
    return (earliest, latest);
  }

  /// Every room id currently on the booking — room 1 plus every picked
  /// extra, as a set (a room can only be picked once).
  static Set<int> pickedRoomIds(BookingState state) => {
    if (state.room != null) state.room!.id,
    for (final r in pickedExtraRooms(state)) r.room!.id,
  };

  /// A short display label for a room, e.g. "101 · Deluxe".
  static String roomMeta(Room room) =>
      room.categoryName.isEmpty ? room.roomNumber : '${room.roomNumber} · ${room.categoryName}';

  /// The `rooms[]` array sent on save — room 1 first, then each picked extra
  /// room, in the shape the server's `rooms[]` schema expects.
  static List<Map<String, dynamic>> roomsPayload(BookingState state) {
    num? perNight(String typed, int nights) =>
        BookingViewModel.perNight(typed, nights);

    Map<String, dynamic> roomEntry({
      int? bookingRoomId,
      required Room room,
      required List<int> bedIds,
      DateTime? checkIn,
      DateTime? checkOut,
      required String roomTotal,
      required Map<int, ExtraDraft> extras,
      required int nights,
    }) {
      final rate = perNight(roomTotal, nights);
      return {
        if (bookingRoomId != null) 'bookingRoomId': bookingRoomId,
        'roomId': room.id,
        if (room.isDormitory) 'bedIds': bedIds,
        if (checkIn != null) 'checkInDate': BookingViewModel.iso(checkIn),
        if (checkOut != null) 'checkOutDate': BookingViewModel.iso(checkOut),
        if (rate != null) 'basePriceOverride': rate,
        'switchableCharges': ChargeSelections.chargesPayload(extras, nights),
      };
    }

    final rooms = <Map<String, dynamic>>[];
    if (state.room != null) {
      rooms.add(
        roomEntry(
          bookingRoomId: state.primaryBookingRoomId,
          room: state.room!,
          bedIds: state.bedIds,
          roomTotal: state.roomTotal,
          extras: state.extras,
          nights: state.nights,
        ),
      );
    }
    for (final r in pickedExtraRooms(state)) {
      final dates = roomDates(state, r);
      final nights = dates == null ? 0 : dates.$2.difference(dates.$1).inDays;
      rooms.add(
        roomEntry(
          bookingRoomId: r.bookingRoomId,
          room: r.room!,
          bedIds: r.bedIds,
          checkIn: state.multiRoomDifferentDates ? dates?.$1 : null,
          checkOut: state.multiRoomDifferentDates ? dates?.$2 : null,
          roomTotal: r.roomTotal,
          extras: r.extras,
          nights: nights,
        ),
      );
    }
    return rooms;
  }

  /// Flattens a [MultiRoomQuote] into the single flat [Quote] shape the
  /// existing quote card already renders — room 1's own lines pass through
  /// unprefixed, every further room's lines get labelled "Room {n} · {label}"
  /// so the desk can tell which room's line an editable total belongs to.
  static Quote combineQuote(MultiRoomQuote response, List<String> roomNumbers) {
    final charges = <QuoteLine>[];
    final nights = <QuoteNight>[];
    for (var i = 0; i < response.rooms.length; i++) {
      final room = response.rooms[i];
      if (i == 0) {
        charges.addAll(room.charges);
      } else {
        final label = i < roomNumbers.length ? roomNumbers[i] : 'Room ${i + 1}';
        charges.addAll(
          room.charges.map(
            (c) => QuoteLine(
              label: 'Room $label · ${c.label}',
              amount: c.amount,
              isBase: c.isBase,
              chargeId: c.chargeId,
              quantity: c.quantity,
            ),
          ),
        );
      }
      nights.addAll(room.nights);
    }
    return Quote(
      charges: charges,
      nights: nights,
      // The totals come from the top-level multi-room response, not by
      // re-summing each room here — the server has already apportioned the
      // discount and rounded once, and re-summing risks a paisa of drift.
      grossTotal: response.grossTotal,
      discountAmount: response.discountAmount,
      totalPrice: response.totalPrice,
    );
  }

  /// When room 1 is removed, the first extra room (if any) is promoted into
  /// its slot — a booking never has an empty room 1 while it still has other
  /// rooms. Resets any typed discount: it was agreed against the previous
  /// set of rooms.
  static BookingState promoteFirstExtra(BookingState state) {
    final extras = state.extraRooms;
    if (extras.isEmpty) {
      return state.copyWith(
        clearRoom: true,
        clearQuote: true,
        discount: '',
      );
    }
    final promoted = extras.first;
    return state.copyWith(
      room: promoted.room,
      clearRoom: promoted.room == null,
      bedIds: promoted.bedIds,
      clearBedIds: promoted.bedIds.isEmpty,
      buyout: promoted.buyout,
      extras: promoted.extras,
      roomTotal: promoted.roomTotal,
      extraRooms: extras.skip(1).toList(),
      clearQuote: true,
      discount: '',
    );
  }

  /// The single function driving the room chooser's ticks: the first room
  /// ticked fills room 1, every further tick appends an extra room, and
  /// un-ticking a room removes it from wherever it is — promoting the next
  /// one up if room 1 itself was un-ticked. Always resets any typed
  /// discount, since it was agreed against a different set of rooms.
  static BookingState toggleRoomChoice(BookingState state, Room room) {
    if (state.room?.id == room.id) {
      return promoteFirstExtra(state);
    }
    final extraIndex = state.extraRooms.indexWhere((r) => r.room?.id == room.id);
    if (extraIndex != -1) {
      final next = List<ExtraRoomDraft>.from(state.extraRooms)
        ..removeAt(extraIndex);
      return state.copyWith(
        extraRooms: next,
        clearQuote: true,
        discount: '',
      );
    }
    if (state.room == null) {
      return state.copyWith(
        room: room,
        clearBedIds: true,
        clearAvailableBeds: true,
        extras: const {},
        roomTotal: '',
        clearQuote: true,
        discount: '',
      );
    }
    final next = List<ExtraRoomDraft>.from(state.extraRooms)
      ..add(ExtraRoomDraft(room: room));
    return state.copyWith(extraRooms: next, clearQuote: true, discount: '');
  }
}
