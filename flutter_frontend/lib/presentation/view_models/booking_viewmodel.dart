library;

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/draft.dart';
import '../../domain/models/late_checkout.dart';
import '../../domain/models/quote.dart';
import '../../domain/models/room.dart';
import '../../domain/usecase/booking_usecase.dart';

/// What the desk has chosen so far, and what the server says it costs.
///
/// One state object for the whole take-a-booking flow, because every part of it
/// depends on the parts before: the rooms depend on the dates, the quote
/// depends on the room, the extras and the agreed rate, and changing a date
/// invalidates all of it.
class BookingState {
  final bool isLoading;
  final String? error;

  // ── The register ─────────────────────────────────────────────────────────
  /// Every stay, unfiltered. The server has no status filter — GET /bookings
  /// takes a date range and nothing else — so the status the desk picked is
  /// applied here rather than sent, which is what the web register does too.
  final AsyncValue<List<Booking>> register;
  final String statusFilter;

  /// The nights the register is asking the server about. Null at both ends
  /// means "whatever the server shows by default" — the state this opens in.
  /// Unlike the status filter these are sent, because the row set itself
  /// changes: a stay outside the window is not on the phone to be filtered.
  final DateTime? registerFrom;
  final DateTime? registerTo;

  // ── Taking a booking ─────────────────────────────────────────────────────
  final DateTime? checkIn;
  final DateTime? checkOut;
  final AsyncValue<List<Room>>? rooms;
  final Room? room;

  /// chargeId → what the desk has set for it. Absent means the extra is off.
  final Map<int, ExtraDraft> extras;

  /// The nightly room rate reception agreed, where it is not the category's
  /// own. Held as typed text; blank means the category price.
  final String roomTotal;

  /// A concession off the whole quote, as typed. Blank means none.
  ///
  /// Not a re-negotiated nightly rate — that is [roomTotal]. This comes off
  /// the total after the nights and extras are priced, which is why it is sent
  /// whole rather than divided by the nights the way an agreed total is.
  final String discount;

  final Quote? quote;
  final bool quoting;
  final bool submitting;

  const BookingState({
    this.isLoading = false,
    this.error,
    this.register = const AsyncValue.loading(),
    this.statusFilter = 'ALL',
    this.registerFrom,
    this.registerTo,
    this.checkIn,
    this.checkOut,
    this.rooms,
    this.room,
    this.extras = const {},
    this.roomTotal = '',
    this.discount = '',
    this.quote,
    this.quoting = false,
    this.submitting = false,
  });

  BookingState copyWith({
    bool? isLoading,
    String? error,
    bool clearError = false,
    AsyncValue<List<Booking>>? register,
    String? statusFilter,
    DateTime? registerFrom,
    DateTime? registerTo,
    /// Back to the server's default window. Needed because a null argument
    /// above means "leave it alone", so there is otherwise no way to say
    /// "no dates" once a range has been set.
    bool clearRegisterRange = false,
    DateTime? checkIn,
    DateTime? checkOut,
    AsyncValue<List<Room>>? rooms,
    Room? room,
    bool clearRoom = false,
    Map<int, ExtraDraft>? extras,
    String? roomTotal,
    String? discount,
    Quote? quote,
    bool clearQuote = false,
    bool? quoting,
    bool? submitting,
  }) => BookingState(
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : (error ?? this.error),
    register: register ?? this.register,
    statusFilter: statusFilter ?? this.statusFilter,
    registerFrom: clearRegisterRange
        ? null
        : (registerFrom ?? this.registerFrom),
    registerTo: clearRegisterRange ? null : (registerTo ?? this.registerTo),
    checkIn: checkIn ?? this.checkIn,
    checkOut: checkOut ?? this.checkOut,
    rooms: rooms ?? this.rooms,
    room: clearRoom ? null : (room ?? this.room),
    extras: extras ?? this.extras,
    roomTotal: roomTotal ?? this.roomTotal,
    discount: discount ?? this.discount,
    quote: clearQuote ? null : (quote ?? this.quote),
    quoting: quoting ?? this.quoting,
    submitting: submitting ?? this.submitting,
  );

  int get nights => (checkIn != null && checkOut != null)
      ? checkOut!.difference(checkIn!).inDays
      : 0;

  bool get datesChosen => nights > 0;

  /// A stay starting later than today.
  ///
  /// Compared as whole days, not as instants: a booking made at 9pm for
  /// tomorrow is a reservation, and one made at 9pm for tonight is not.
  bool get isFutureCheckIn {
    final start = checkIn;
    if (start == null) return false;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    return DateTime(start.year, start.month, start.day).isAfter(today);
  }

  /// What kind of stay this is, decided by the date rather than asked.
  ///
  /// A booking whose first night is tonight is somebody standing at the desk —
  /// the web form flips to WALK_IN the moment the check-in date is today or
  /// earlier, and a walk-in is checked in as soon as it is created. Only a
  /// stay that starts on a later date is a reservation.
  String get bookingType => isFutureCheckIn ? 'RESERVATION' : 'WALK_IN';

  bool get isWalkIn => bookingType == 'WALK_IN';

  /// Whether the desk has narrowed the register to particular nights.
  bool get hasRegisterRange => registerFrom != null || registerTo != null;

  /// The register as the desk asked to see it.
  List<Booking> get visibleRegister {
    final all = register.valueOrNull ?? const <Booking>[];
    if (statusFilter == 'ALL') return all;
    return all.where((b) => b.status == statusFilter).toList();
  }
}

class BookingViewModel extends StateNotifier<BookingState> {
  final BookingUsecase usecase;

  BookingViewModel(this.usecase) : super(const BookingState());

  static String iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';

  /// Divide a whole-stay total into the per-night figure the server stores.
  ///
  /// Reception negotiates a total — "call it 350 for the two nights" — and the
  /// booking stores a rate. Divided by the nights alone, never by the count: an
  /// agreed figure is what the whole line costs, so three beds at an agreed 100
  /// is 100, not three times 33.33.
  static num? perNight(String typed, int nights) {
    final total = num.tryParse(typed.trim());
    if (total == null || total <= 0) return null;
    final per = nights <= 0 ? 1 : nights;
    return (total / per * 100).round() / 100;
  }

  // ── The register ─────────────────────────────────────────────────────────

  /// Load the stays in the chosen window. Status filtering is done on what
  /// comes back; the dates are the server's job, because they decide which
  /// rows exist at all.
  Future<void> loadRegister() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final list = await usecase.bookings(
        fromDate: state.registerFrom == null ? null : iso(state.registerFrom!),
        toDate: state.registerTo == null ? null : iso(state.registerTo!),
      );
      state = state.copyWith(
        isLoading: false,
        register: AsyncValue.data(list),
      );
    } catch (e, st) {
      state = state.copyWith(
        isLoading: false,
        error: messageFor(e),
        register: AsyncValue.error(e, st),
      );
    }
  }

  /// Show only these. No refetch: the server would return the same rows.
  void setStatusFilter(String status) =>
      state = state.copyWith(statusFilter: status);

  /// Ask the server for a different stretch of nights. Refetches, because
  /// these rows are not on the phone yet.
  Future<void> setRegisterRange(DateTime from, DateTime to) async {
    state = state.copyWith(registerFrom: from, registerTo: to);
    await loadRegister();
  }

  /// Back to the server's default window.
  Future<void> clearRegisterRange() async {
    state = state.copyWith(clearRegisterRange: true);
    await loadRegister();
  }

  // ── Checking out ─────────────────────────────────────────────────────────

  /// Ask how late the guest is.
  ///
  /// Checking out is two steps whenever a guest has run past their deadline:
  /// find out what the policy says that is worth, then let reception decide. A
  /// guest who is on time never sees the detour — the caller checks
  /// [LateCheckout.isChargeable] and goes straight through.
  Future<LateCheckout?> askLateCheckout(int bookingId) async {
    state = state.copyWith(clearError: true);
    try {
      return await usecase.lateCheckout(bookingId);
    } catch (e) {
      state = state.copyWith(error: messageFor(e));
      return null;
    }
  }

  /// Check the guest out, charging whatever reception settled on.
  Future<Booking?> checkOut(int bookingId, {num lateCharge = 0}) async {
    if (state.submitting) return null;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      final booking = await usecase.checkOut(bookingId, lateCharge: lateCharge);
      state = state.copyWith(submitting: false);
      await loadRegister();
      return booking;
    } catch (e) {
      state = state.copyWith(submitting: false, error: messageFor(e));
      return null;
    }
  }

  // ── Advancing a reservation ──────────────────────────────────────────────

  /// Check a reservation in at the door.
  ///
  /// A walk-in is checked in by [submit] the moment it is created, but a
  /// reservation waits — and without this it waited forever: it could never
  /// reach CHECKED_IN, so it could never be checked out, so it could never be
  /// billed. The phone could take a booking it had no way to finish.
  ///
  /// The ID proof is optional here and mandatory at the server, which is not a
  /// contradiction: a stay booked on this app already sent one, and the server
  /// only insists when nothing is on file. Sending blanks would overwrite what
  /// is there, so untouched fields are left out entirely.
  Future<Booking?> checkInReservation(
    int bookingId, {
    String? idProofType,
    String? idProofNumber,
    List<PaymentDraft> advanceLines = const [],
  }) async {
    if (state.submitting) return null;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      final paid = advanceLines.where((l) => l.value > 0).toList();
      final advance = sumPayments(paid);

      final form = FormData.fromMap({
        if (idProofType != null) 'idProofType': idProofType,
        if (idProofNumber != null && idProofNumber.trim().isNotEmpty)
          'idProofNumber': idProofNumber.trim(),
        if (advance > 0) ...{
          'advanceAmount': '$advance',
          'advancePaymentMethod': paid.first.method!,
          if (needsPaymentReference(paid.first.method) &&
              paid.first.reference.trim().isNotEmpty)
            'advanceReference': paid.first.reference.trim(),
          if (paid.length > 1)
            'advanceLines': _jsonList(paid.map((l) => l.toJson())),
        },
      });

      final booking = await usecase.checkIn(bookingId, form);
      state = state.copyWith(submitting: false);
      await loadRegister();
      return booking;
    } catch (e) {
      state = state.copyWith(submitting: false, error: messageFor(e));
      return null;
    }
  }

  /// Call off a reservation nobody came for.
  ///
  /// Only offered on a stay still at BOOKED — the server refuses anything
  /// further along, and a guest already in the room leaves by checking out.
  Future<Booking?> cancelBooking(int bookingId) async {
    if (state.submitting) return null;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      final booking = await usecase.cancel(bookingId);
      state = state.copyWith(submitting: false);
      await loadRegister();
      return booking;
    } catch (e) {
      state = state.copyWith(submitting: false, error: messageFor(e));
      return null;
    }
  }

  /// One stay, in full — the detail endpoint carries what a register row does
  /// not, such as every tender the advance actually arrived by.
  Future<Booking?> loadBooking(int id) async {
    try {
      return await usecase.booking(id);
    } catch (e) {
      state = state.copyWith(error: messageFor(e));
      return null;
    }
  }

  // ── Taking a booking ─────────────────────────────────────────────────────

  /// Choose the nights. Anything chosen after the dates is invalidated by
  /// changing them — a room free last week may not be free this one, and a
  /// quote for three nights means nothing once it is four.
  Future<void> setDates(DateTime checkIn, DateTime checkOut) async {
    state = state.copyWith(
      checkIn: checkIn,
      checkOut: checkOut,
      clearRoom: true,
      clearQuote: true,
      extras: const {},
      roomTotal: '',
      clearError: true,
    );
    await loadRooms();
  }

  Future<void> loadRooms() async {
    if (!state.datesChosen) return;
    state = state.copyWith(rooms: const AsyncValue.loading());
    try {
      final rooms = await usecase.availableRooms(
        iso(state.checkIn!),
        iso(state.checkOut!),
      );
      state = state.copyWith(rooms: AsyncValue.data(rooms));
    } catch (e, st) {
      state = state.copyWith(
        rooms: AsyncValue.error(e, st),
        error: messageFor(e),
      );
    }
  }

  Future<void> selectRoom(Room room) async {
    state = state.copyWith(
      room: room,
      extras: const {},
      roomTotal: '',
      clearQuote: true,
    );
    await refreshQuote();
  }

  /// Turn an extra on or off.
  Future<void> toggleExtra(int chargeId, bool on) async {
    final next = Map<int, ExtraDraft>.from(state.extras);
    if (on) {
      next[chargeId] = ExtraDraft();
    } else {
      next.remove(chargeId);
    }
    state = state.copyWith(extras: next);
    await refreshQuote();
  }

  /// How many of a counted extra.
  Future<void> setExtraQuantity(int chargeId, int quantity) async {
    if (quantity <= 0) return toggleExtra(chargeId, false);
    final next = Map<int, ExtraDraft>.from(state.extras);
    final current = next[chargeId] ?? ExtraDraft();
    next[chargeId] = ExtraDraft(
      quantity: quantity,
      // The agreed figure is for the line, not per unit, so it survives a
      // change of count untouched.
      agreedTotal: current.agreedTotal,
    );
    state = state.copyWith(extras: next);
    await refreshQuote();
  }

  /// What reception agreed for this extra across the whole stay. Blank puts it
  /// back on the lodge's own rate.
  Future<void> setExtraTotal(int chargeId, String total) async {
    final next = Map<int, ExtraDraft>.from(state.extras);
    final current = next[chargeId] ?? ExtraDraft();
    next[chargeId] = ExtraDraft(
      quantity: current.quantity,
      agreedTotal: total,
    );
    state = state.copyWith(extras: next);
    await refreshQuote();
  }

  /// What reception agreed for the room across the whole stay. Blank puts it
  /// back on the category's own rate.
  Future<void> setRoomTotal(String total) async {
    state = state.copyWith(roomTotal: total);
    await refreshQuote();
  }

  /// Take a concession off the whole stay. Blank means none.
  Future<void> setDiscount(String amount) async {
    state = state.copyWith(discount: amount);
    await refreshQuote();
  }

  /// The concession as a number, or null when nothing was typed.
  ///
  /// Whole, not per night: a concession is against the total the nights and
  /// extras came to, which is why it does not go through [perNight] the way an
  /// agreed room total does.
  static num? wholeAmount(String typed) {
    final value = num.tryParse(typed.trim());
    return (value == null || value <= 0) ? null : value;
  }

  /// Ask the server what it costs.
  ///
  /// Never worked out here. Taking money off can move a night into a different
  /// GST band and change the rounding, so the only total that can be trusted is
  /// the one the server returns — and it is the same figure the bill will use.
  Future<void> refreshQuote() async {
    final room = state.room;
    if (room == null || !state.datesChosen) return;

    state = state.copyWith(quoting: true, clearError: true);
    try {
      final quote = await usecase.priceQuote(
        roomId: room.id,
        checkInDate: iso(state.checkIn!),
        checkOutDate: iso(state.checkOut!),
        chargeIds: chargeIdsParam(),
        basePriceOverride: perNight(state.roomTotal, state.nights),
        discountAmount: wholeAmount(state.discount),
      );
      state = state.copyWith(quoting: false, quote: quote);
    } catch (e) {
      state = state.copyWith(quoting: false, error: messageFor(e));
    }
  }

  /// The extras, in the wire format the pricing engine parses:
  /// `id:quantity@agreedRate`, comma separated. The rate is omitted entirely
  /// when nothing was agreed, which the server reads as "charge whatever the
  /// lodge charges" — sending an empty value would be a different thing.
  String? chargeIdsParam() {
    if (state.extras.isEmpty) return null;
    final parts = state.extras.entries.map((e) {
      final agreed = perNight(e.value.agreedTotal, state.nights);
      final spec = '${e.key}:${e.value.quantity}';
      return agreed == null ? spec : '$spec@$agreed';
    });
    return parts.join(',');
  }

  /// Take the booking.
  ///
  /// Returns the stay on success, null on failure with [BookingState.error]
  /// set. Guarded against a second tap: the server holds a lock that stops two
  /// devices booking one room, but nothing stops one device asking twice.
  Future<Booking?> submit({
    required String guestName,
    required String guestPhone,
    required int numGuests,
    String? idProofType,
    String? idProofNumber,
    List<GuestDraft> guests = const [],
    List<PaymentDraft> advanceLines = const [],
  }) async {
    if (state.submitting) return null;
    final room = state.room;
    if (room == null || !state.datesChosen) return null;

    state = state.copyWith(submitting: true, clearError: true);
    try {
      final paid = advanceLines.where((l) => l.value > 0).toList();
      final advance = sumPayments(paid);
      final rate = perNight(state.roomTotal, state.nights);
      final discount = wholeAmount(state.discount);

      final form = FormData.fromMap({
        'roomId': '${room.id}',
        'checkInDate': iso(state.checkIn!),
        'checkOutDate': iso(state.checkOut!),
        'numGuests': '$numGuests',
        'guestName': guestName.trim(),
        'guestPhone': guestPhone.trim(),
        // Not a fixed value: a stay starting today is a walk-in and is checked
        // in below, a later one is a reservation and waits.
        'bookingType': state.bookingType,
        if (rate != null) 'basePriceOverride': '$rate',
        // Sent whole. The quote the desk agreed to was priced with this off
        // it, so leaving it out here would book the stay at a total nobody
        // was shown.
        if (discount != null) 'discountAmount': '$discount',
        if (idProofType != null) 'idProofType': idProofType,
        if (idProofNumber != null && idProofNumber.trim().isNotEmpty)
          'idProofNumber': idProofNumber.trim(),
        // The array parts of this multipart body ride as JSON strings, which is
        // how the controller parses them.
        'guests': _jsonList(guests.map((g) => g.toJson())),
        'vehicles': '[]',
        'switchableCharges': _extrasJson(),
        if (advance > 0) ...{
          'advanceAmount': '$advance',
          // The first tender. The booking row keeps one method whatever the
          // rows say, and the register reads it.
          'advancePaymentMethod': paid.first.method!,
          if (needsPaymentReference(paid.first.method) &&
              paid.first.reference.trim().isNotEmpty)
            'advanceReference': paid.first.reference.trim(),
          // Only on a real split. One line is what the server already
          // synthesises from the method above.
          if (paid.length > 1)
            'advanceLines': _jsonList(paid.map((l) => l.toJson())),
        },
      });

      final booking = await usecase.createBooking(form);

      // A walk-in is somebody at the desk, so the stay is checked in as soon
      // as it exists rather than left sitting as a reservation nobody will
      // ever come back to advance.
      //
      // Deliberately after the booking, and deliberately unable to undo it: if
      // the check-in fails the stay is still real and still correct, and the
      // desk can advance it by hand. Throwing here would report a booking that
      // was taken as one that failed, which is the worse of the two lies.
      if (state.isWalkIn) {
        try {
          final checkedIn = await usecase.checkIn(booking.id, FormData());
          state = state.copyWith(submitting: false);
          return checkedIn;
        } catch (_) {
          state = state.copyWith(submitting: false);
          return booking;
        }
      }

      state = state.copyWith(submitting: false);
      return booking;
    } catch (e) {
      state = state.copyWith(submitting: false, error: messageFor(e));
      return null;
    }
  }

  /// Hand-rolled rather than dart:convert, so a string never lands unescaped.
  String _jsonList(Iterable<Map<String, dynamic>> rows) {
    String value(dynamic v) {
      if (v == null) return 'null';
      if (v is num) return '$v';
      if (v is bool) return '$v';
      final escaped = v
          .toString()
          .replaceAll('\\', r'\\')
          .replaceAll('"', r'\"')
          .replaceAll('\n', r'\n');
      return '"$escaped"';
    }

    final objects = rows.map(
      (row) =>
          '{${row.entries.map((e) => '"${e.key}":${value(e.value)}').join(',')}}',
    );
    return '[${objects.join(',')}]';
  }

  String _extrasJson() => _jsonList(
    state.extras.entries.map((e) {
      final agreed = perNight(e.value.agreedTotal, state.nights);
      return {
        'id': e.key,
        'quantity': e.value.quantity,
        if (agreed != null) 'agreedAmount': agreed,
      };
    }),
  );

  /// Clear the flow, for starting another booking. The register is kept —
  /// it belongs to the screen behind this one.
  void reset() => state = BookingState(
    register: state.register,
    statusFilter: state.statusFilter,
    registerFrom: state.registerFrom,
    registerTo: state.registerTo,
  );

  /// The server's own words where it sent any — "This room is already booked
  /// for part of that date range" is the whole answer, and no generic string
  /// can replace it.
  static String messageFor(Object e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map && data['message'] is String) return data['message'];
      switch (e.type) {
        case DioExceptionType.connectionTimeout:
        case DioExceptionType.sendTimeout:
        case DioExceptionType.receiveTimeout:
          return 'The server took too long to answer.';
        case DioExceptionType.connectionError:
          return 'Cannot reach the server. Check the wifi and try again.';
        default:
          return 'Something went wrong. Try again.';
      }
    }
    return 'Something went wrong. Try again.';
  }
}
