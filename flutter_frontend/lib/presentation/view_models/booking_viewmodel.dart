library;

import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/draft.dart';
import '../../domain/models/guest_match.dart';
import '../../domain/models/late_checkout.dart';
import '../../domain/models/quote.dart';
import '../../domain/models/room.dart';
import '../../domain/models/tape_chart.dart';
import '../../domain/usecase/booking_usecase.dart';
import '../../core/network/api_error_message.dart';

/// What the desk has chosen so far, and what the server says it costs.
///
/// One state object for the whole take-a-booking flow, because every part of it
/// depends on the parts before: the rooms depend on the dates, the quote
/// depends on the room, the extras and the agreed rate, and changing a date
/// invalidates all of it.
class BookingState {
  final bool isLoading;
  final String? error;

  // ── The tape chart ───────────────────────────────────────────────────────
  /// GET /bookings/tape-chart's own answer for [chartFrom, chartTo) — every
  /// active room whether or not it has a stay in the window, plus every
  /// booking that touches it. The same purpose-built fetch the web tape chart
  /// itself draws from, rather than the setup screen's room list and the
  /// register's own fetch composed together.
  final AsyncValue<TapeChartData> chart;
  final DateTime chartFrom;
  final DateTime chartTo;

  /// What the desk has typed into the chart's own search box — a guest's
  /// name, phone, ID or invoice number, matched the same way the web tape
  /// chart's search does.
  final String chartSearch;

  /// Which of the search's own hits is the active one, for the prev/next
  /// stepper. Clamped against the hit count in [chartSearchHits] rather than
  /// stored raw, so a query that now matches fewer stays cannot point past
  /// the end of them.
  final int chartHitIndex;

  // ── Taking a booking ─────────────────────────────────────────────────────

  /// Non-null once this whole flow is correcting an existing booking rather
  /// than taking a new one. Changes what [loadRooms] asks for — an edit's
  /// own room stays free rather than reading as conflicting with itself —
  /// and what [submit] eventually does with the answers.
  final int? editBookingId;

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

  /// The desk's own choice between the two pills, where the dates leave room
  /// for one — null means nothing has been chosen and [bookingType] falls
  /// back to what the dates say. Cleared on every date change: the web
  /// form's own toggle re-derives from scratch each time the dates move
  /// rather than carrying a stale choice onto a different stay.
  final bool? bookingTypeOverride;

  /// Non-null once this flow is continuing a booking that was parked as a
  /// draft rather than starting fresh — "Save draft" updates this row
  /// instead of laying down a second copy, and the moment the stay is
  /// actually taken this row is thrown away: it was only ever a stand-in.
  final int? draftId;

  BookingState({
    this.isLoading = false,
    this.error,
    this.chart = const AsyncValue.loading(),
    DateTime? chartFrom,
    DateTime? chartTo,
    this.chartSearch = '',
    this.chartHitIndex = 0,
    this.editBookingId,
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
    this.bookingTypeOverride,
    this.draftId,
  }) : chartFrom = chartFrom ?? _startOfMonth(_today()),
       chartTo = chartTo ?? _startOfNextMonth(_today());

  static DateTime _today() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  static DateTime _startOfMonth(DateTime d) => DateTime(d.year, d.month, 1);

  static DateTime _startOfNextMonth(DateTime d) =>
      DateTime(d.year, d.month + 1, 1);

  BookingState copyWith({
    bool? isLoading,
    String? error,
    bool clearError = false,
    AsyncValue<TapeChartData>? chart,
    DateTime? chartFrom,
    DateTime? chartTo,
    String? chartSearch,
    int? chartHitIndex,
    int? editBookingId,
    bool clearEditBookingId = false,
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
    bool? bookingTypeOverride,
    bool clearBookingTypeOverride = false,
    int? draftId,
    bool clearDraftId = false,
  }) => BookingState(
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : (error ?? this.error),
    chart: chart ?? this.chart,
    chartFrom: chartFrom ?? this.chartFrom,
    chartTo: chartTo ?? this.chartTo,
    chartSearch: chartSearch ?? this.chartSearch,
    chartHitIndex: chartHitIndex ?? this.chartHitIndex,
    editBookingId: clearEditBookingId
        ? null
        : (editBookingId ?? this.editBookingId),
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
    bookingTypeOverride: clearBookingTypeOverride
        ? null
        : (bookingTypeOverride ?? this.bookingTypeOverride),
    draftId: clearDraftId ? null : (draftId ?? this.draftId),
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

  /// What kind of stay this is.
  ///
  /// The dates decide the default the moment they are chosen — a stay whose
  /// first night is tonight defaults to somebody standing at the desk, and one
  /// starting later defaults to a reservation — but the desk can still flip
  /// the pill between them the same way the web form's own toggle does,
  /// except onto Walk-in for a future date: that one is never on offer,
  /// because a walk-in is checked in the moment it is created.
  String get bookingType {
    if (isFutureCheckIn) return 'RESERVATION';
    if (bookingTypeOverride != null) {
      return bookingTypeOverride! ? 'WALK_IN' : 'RESERVATION';
    }
    return 'WALK_IN';
  }

  bool get isWalkIn => bookingType == 'WALK_IN';

  /// The chart's nights, [chartFrom, chartTo) — a stay is drawn on a night if
  /// it covers that night at all, so the last date is exclusive the way a
  /// check-out date already is everywhere else in this app.
  List<DateTime> get chartDates {
    final days = chartTo.difference(chartFrom).inDays;
    return [for (var i = 0; i < days; i++) chartFrom.add(Duration(days: i))];
  }

  /// The roster grouped by category, each room carrying only the stays that
  /// touch [chartFrom, chartTo) — the server sends every active room already;
  /// this only sorts stays onto them and bands them by category, the same
  /// grouping the web tape chart draws.
  List<ChartSection> get chartSections {
    final data = chart.valueOrNull;
    if (data == null) return const [];

    final byRoom = <int, List<TapeChartBooking>>{};
    for (final b in data.bookings) {
      if (b.status == 'CANCELLED') continue;
      (byRoom[b.roomId] ??= []).add(b);
    }

    final draftsByRoom = <int, List<TapeChartDraft>>{};
    for (final d in data.drafts) {
      (draftsByRoom[d.roomId] ??= []).add(d);
    }

    final byCategory = <String, List<ChartRoom>>{};
    for (final room in data.rooms) {
      (byCategory[room.categoryName] ??= []).add(
        ChartRoom(
          room: room,
          stays: byRoom[room.id] ?? const [],
          drafts: draftsByRoom[room.id] ?? const [],
        ),
      );
    }

    return byCategory.entries
        .map((e) => ChartSection(categoryName: e.key, rooms: e.value))
        .toList()
      ..sort((a, b) => a.categoryName.compareTo(b.categoryName));
  }

  /// Every stay the chart's search box currently answers to, across every
  /// room and category — not just the ones on screen, the same way the web
  /// search reaches the whole window rather than only the visible card.
  List<TapeChartBooking> get chartSearchHits {
    final needle = chartSearch.trim().toLowerCase();
    if (needle.isEmpty) return const [];
    final data = chart.valueOrNull;
    if (data == null) return const [];
    final squashedNeedle = _squash(needle);
    return data.bookings.where((b) {
      if (b.status == 'CANCELLED') return false;
      final fields = b.searchFields;
      if (fields.any((f) => f.contains(needle))) return true;
      return squashedNeedle.isNotEmpty &&
          fields.any((f) => _squash(f).contains(squashedNeedle));
    }).toList();
  }

  /// The hit the prev/next stepper is currently on, clamped to the list —
  /// a query that now matches fewer stays should not point past the end.
  TapeChartBooking? get chartActiveHit {
    final hits = chartSearchHits;
    if (hits.isEmpty) return null;
    return hits[chartHitIndex.clamp(0, hits.length - 1)];
  }

  /// The same string with everything but letters and digits stripped — an
  /// invoice or ID number gets written down half a dozen punctuated ways, and
  /// none of them is wrong, so both sides of a search are squashed before the
  /// second comparison the way the web search box does it.
  static String _squash(String text) =>
      text.replaceAll(RegExp(r'[^a-z0-9]'), '');
}

/// One room's row on the tape chart, with only the stays inside the visible
/// window — a night with none of them is vacant.
class ChartRoom {
  final TapeChartRoom room;
  final List<TapeChartBooking> stays;
  final List<TapeChartDraft> drafts;

  const ChartRoom({
    required this.room,
    required this.stays,
    this.drafts = const [],
  });

  /// The stay covering this night, if any. [day] is a bare date — nights are
  /// compared as whole days, never as instants.
  ///
  /// The room a booking occupies is not always exactly `[checkInDate,
  /// checkOutDate)` — the same adjustment the web tape chart's own tile
  /// renderer makes:
  ///  - A CHECKED_OUT stay holds no night from today on, even if it was sold
  ///    further — someone who left early should not still tint nights they
  ///    never used.
  ///
  /// An overdue CHECKED_IN guest (past their sold checkout date but not yet
  /// checked out) is *not* drawn past that date either: the web tape chart
  /// only extends such a stay in its internal occupancy map (to block new
  /// bookings on those nights), but its rendered tile stops at the original
  /// checkOutDate regardless. Since this method only feeds the visible tile
  /// here, it mirrors that render-time cutoff rather than the occupancy-map
  /// extension.
  ///
  /// Where two stays both technically claim a night — a newer booking placed
  /// into a room whose prior stay hasn't been checked out yet — the later one
  /// in [stays] wins, the same way the web tape chart's own occupancy map
  /// does: it writes one booking per day into a map in server order, so
  /// whichever booking is listed later simply overwrites the earlier one's
  /// claim on a shared night. The last match here is that same overwrite,
  /// without building a map of its own.
  TapeChartBooking? stayOn(DateTime day) {
    final today = _today();
    TapeChartBooking? found;
    for (final b in stays) {
      final inDate = DateTime.tryParse(b.checkInDate ?? '');
      var outDate = DateTime.tryParse(b.checkOutDate ?? '');
      if (inDate == null || outDate == null) continue;
      if (b.status == 'CHECKED_OUT' && outDate.isAfter(today)) {
        outDate = today;
      }
      if (!day.isBefore(inDate) && day.isBefore(outDate)) found = b;
    }
    return found;
  }

  /// The draft parked on this night, if any and if no real booking already
  /// holds it — a draft reserves nothing, so a night a booking covers always
  /// reads as that booking, never as the draft underneath it.
  TapeChartDraft? draftOn(DateTime day) {
    if (stayOn(day) != null) return null;
    for (final d in drafts) {
      final inDate = DateTime.tryParse(d.checkInDate ?? '');
      final outDate = DateTime.tryParse(d.checkOutDate ?? '');
      if (inDate == null || outDate == null) continue;
      if (!day.isBefore(inDate) && day.isBefore(outDate)) return d;
    }
    return null;
  }

  static DateTime _today() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }
}

/// One category's band on the chart — the web groups the same way, so a room
/// reads in the same place on both screens.
class ChartSection {
  final String categoryName;
  final List<ChartRoom> rooms;

  const ChartSection({required this.categoryName, required this.rooms});
}

class BookingViewModel extends StateNotifier<BookingState> {
  final BookingUsecase usecase;

  /// The chart's own window and step size — the web tape chart's own
  /// WINDOW_DAYS, so a step here lands on the same nights a step there would.
  static const chartWindowDays = 30;

  /// How far the window can grow from repeated pulls into the past or future
  /// — the web tape chart's own MAX_WINDOW_DAYS. A season's worth of nights
  /// (April through October, say) is a real desk question, so growth stops
  /// well past that rather than fetching an unbounded span.
  static const chartMaxSpanDays = 400;

  BookingViewModel(this.usecase) : super(BookingState());

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

  // ── The tape chart ───────────────────────────────────────────────────────

  /// Load the chart's own window from GET /bookings/tape-chart — every active
  /// room and every stay touching it in one fetch, refetched in full rather
  /// than cached past its first load: a room added or retired on the setup
  /// screen, or a stay taken since, should show up without the desk needing
  /// to know to come back here.
  ///
  /// [silent] keeps whatever is already drawn on screen while the fetch is
  /// in flight instead of swapping the whole chart for a spinner — a window
  /// grown from scrolling near an edge only adds a few more days to what is
  /// already there, and tearing the whole tree down for that would unmount
  /// every row's `ScrollController` mid-drag, snapping the chart back to its
  /// start and making the scroll that asked for more nights look like it did
  /// nothing at all.
  Future<void> loadChart({bool silent = false}) async {
    if (!silent || !state.chart.hasValue) {
      state = state.copyWith(chart: const AsyncValue.loading());
    }
    try {
      final data = await usecase.tapeChart(
        startDate: iso(state.chartFrom),
        endDate: iso(state.chartTo),
      );
      state = state.copyWith(chart: AsyncValue.data(data));
    } catch (e, st) {
      state = state.copyWith(error: messageFor(e), chart: AsyncValue.error(e, st));
    }
  }

  /// Snap the window back to whatever the current calendar month is right
  /// now — [BookingState]'s own default only ever runs once, the moment the
  /// provider is first created, so a chart left open (or a session merely
  /// signed out and back into) across a month boundary would otherwise keep
  /// showing the month it happened to open on rather than today's. Called
  /// fresh each time the tape chart screen mounts, so leaving it and coming
  /// back — another page, or a logout/login — reopens on today's month
  /// exactly the way a cold app start does, while a prev/next the desk had
  /// already made mid-visit still resets, the same as any other remount.
  ///
  /// Silent, like a near-edge grow: this fires automatically on every
  /// remount, not from the desk tapping prev/next, so it should revalidate
  /// quietly rather than flashing a spinner. That flash was also swapping
  /// the whole chart tree for one frame, which tore down and rebuilt every
  /// row's `ScrollController` — the tape chart's own scroll-to-today, timed
  /// against the pre-fetch render, would land the *old* controllers on
  /// today just before they were replaced by fresh ones back at the start
  /// of the month, leaving the desk to scroll there by hand. Keeping the
  /// previous render (and its controllers) on screen until the fetch
  /// resolves means there is only ever one set of controllers for
  /// scroll-to-today to land on.
  Future<void> resetChartToCurrentMonth() {
    final now = DateTime.now();
    final from = DateTime(now.year, now.month, 1);
    return setChartRange(
      from,
      DateTime(from.year, from.month + 1, 1),
      silent: true,
    );
  }

  /// Slide the chart to a different window and refetch.
  Future<void> setChartRange(DateTime from, DateTime to, {bool silent = false}) async {
    state = state.copyWith(chartFrom: from, chartTo: to);
    await loadChart(silent: silent);
  }

  /// What the desk has typed into the chart's own search box. Resets the
  /// stepper to the first hit — an index held from a longer, more specific
  /// query would otherwise point past the end of a shorter one's results.
  void setChartSearch(String text) =>
      state = state.copyWith(chartSearch: text, chartHitIndex: 0);

  /// Step the prev/next stepper by [n], wrapping — stepping past the last hit
  /// returns to the first, the way the web search's own stepper does.
  void stepChartHit(int n) {
    final count = state.chartSearchHits.length;
    if (count == 0) return;
    final next = (state.chartHitIndex + n) % count;
    state = state.copyWith(chartHitIndex: next < 0 ? next + count : next);
  }

  /// Step to the previous or next calendar month — the chart opens on the
  /// current month by default, so paging keeps that same whole-month framing
  /// rather than sliding by a fixed day count that would drift off the
  /// month boundary, and always back to a full month rather than whatever
  /// span the desk had scrolled to, the way stepping there resets a window
  /// that had grown from scrolling.
  Future<void> shiftChart(int direction) {
    final from = DateTime(state.chartFrom.year, state.chartFrom.month + direction, 1);
    return setChartRange(from, DateTime(from.year, from.month + 1, 1));
  }

  /// Pull the window's start further into the past, growing the span rather
  /// than sliding it — the same way the web tape chart prepends earlier
  /// nights when scrolled hard against its left edge, for a stay that has to
  /// be entered against a night further back than the window opened on. Kept
  /// the same nights already on screen, and does nothing once the span has
  /// already grown to [chartMaxSpanDays].
  Future<void> growPast() {
    final span = state.chartTo.difference(state.chartFrom).inDays;
    final remaining = chartMaxSpanDays - span;
    if (remaining <= 0) return Future.value();
    final grow = remaining < chartWindowDays ? remaining : chartWindowDays;
    return setChartRange(
      state.chartFrom.subtract(Duration(days: grow)),
      state.chartTo,
      silent: true,
    );
  }

  /// Push the window's end further into the future, growing the span rather
  /// than sliding it — the same way the web tape chart appends later nights
  /// once scrolled hard against its right edge, so scrolling forward keeps
  /// opening more nights the same way scrolling back does, rather than
  /// stopping dead at whatever the window opened on. Kept the same nights
  /// already on screen, and does nothing once the span has already grown to
  /// [chartMaxSpanDays].
  Future<void> growFuture() {
    final span = state.chartTo.difference(state.chartFrom).inDays;
    final remaining = chartMaxSpanDays - span;
    if (remaining <= 0) return Future.value();
    final grow = remaining < chartWindowDays ? remaining : chartWindowDays;
    return setChartRange(
      state.chartFrom,
      state.chartTo.add(Duration(days: grow)),
      silent: true,
    );
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
      await loadChart();
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
      await loadChart();
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
  ///
  /// [refundAmount]/[refundMethod] settle an advance that was on file — what
  /// goes back to the guest; whatever is left of it is kept as the
  /// cancellation charge automatically, by the server's own arithmetic, not
  /// sent as a separate figure. [cancellationCharge]/[chargeMethod] are the
  /// other shape of the same settlement, for a stay that held no advance to
  /// refund and is instead charged a fee on the spot.
  Future<Booking?> cancelBooking(
    int bookingId, {
    String? reason,
    num? refundAmount,
    String? refundMethod,
    num? cancellationCharge,
    String? chargeMethod,
  }) async {
    if (state.submitting) return null;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      final body = <String, dynamic>{
        if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
        if (refundAmount != null) 'refundAmount': refundAmount,
        if (refundAmount != null && refundAmount > 0 && refundMethod != null)
          'refundPaymentMethod': refundMethod,
        if (cancellationCharge != null) 'cancellationCharge': cancellationCharge,
        if (cancellationCharge != null && chargeMethod != null)
          'cancellationChargePaymentMethod': chargeMethod,
      };
      final booking = await usecase.cancel(
        bookingId,
        body.isEmpty ? null : body,
      );
      state = state.copyWith(submitting: false);
      await loadChart();
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

  /// Returning guests matching what's been typed so far. A convenience, not
  /// a field the form depends on — a failed lookup leaves the desk typing
  /// the name out, which is what they were doing anyway, so nothing here
  /// touches [state.error].
  Future<List<GuestMatch>> searchGuests(String query) async {
    try {
      return await usecase.searchGuests(query);
    } catch (_) {
      return [];
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
      clearBookingTypeOverride: true,
    );
    await loadRooms();
  }

  /// The desk overriding which pill applies — only meaningful where both are
  /// on offer, so an attempt to force Walk-in onto a future check-in date
  /// (never shown as a button, but reachable if the dates moved out from
  /// under an already-open toggle) is simply ignored.
  void setBookingType(String type) {
    if (state.isFutureCheckIn) return;
    state = state.copyWith(bookingTypeOverride: type == 'WALK_IN');
  }

  /// Open this whole flow onto a booking that already exists — the room, the
  /// nights and the extras it was taken with, ready to change. Same state,
  /// same fields [submit] already reads, because an edit is a booking whose
  /// questions have been answered once already; the only real difference is
  /// what happens at the end.
  Future<void> startEdit(Booking booking) async {
    final checkIn = DateTime.tryParse(booking.checkInDate ?? '');
    final checkOut = DateTime.tryParse(booking.checkOutDate ?? '');
    if (checkIn == null || checkOut == null) return;

    final extras = <int, ExtraDraft>{
      for (final c in booking.switchableCharges)
        c.id: ExtraDraft(
          quantity: c.quantity.round(),
          agreedTotal: c.agreedAmount == null ? '' : '${c.agreedAmount}',
        ),
    };

    state = state.copyWith(
      editBookingId: booking.id,
      checkIn: checkIn,
      checkOut: checkOut,
      clearRoom: true,
      clearQuote: true,
      extras: extras,
      roomTotal: booking.basePriceOverride == null
          ? ''
          : '${booking.basePriceOverride}',
      discount: booking.discountAmount == null || booking.discountAmount == 0
          ? ''
          : '${booking.discountAmount}',
      clearError: true,
    );
    await loadRooms();
    if (!state.isLoading) {
      final rooms = state.rooms?.valueOrNull;
      final match = rooms?.where((r) => r.id == booking.roomId).firstOrNull;
      if (match != null) await selectRoom(match);
    }
  }

  /// Open this flow onto a booking parked earlier — the dates it was typed
  /// against, ready to pick up where the desk left off. Everything else the
  /// draft carried (the guest, the extras, what was already put down) is not
  /// state this view model owns; the screen reads it straight off
  /// [BookingDraft.form] and sets it locally, the same way [startEdit]'s own
  /// caller fills the guest fields from the booking it is handed.
  Future<void> beginFromDraft(BookingDraft draft) async {
    final form = draft.form;
    state = state.copyWith(
      draftId: draft.id,
      clearEditBookingId: true,
      checkIn: form.checkInDate,
      checkOut: form.checkOutDate,
      clearRoom: true,
      clearQuote: true,
      extras: const {},
      roomTotal: '',
      discount: '',
      clearError: true,
      clearBookingTypeOverride: true,
    );
    if (!state.datesChosen) return;
    await loadRooms();
    final roomId = form.roomId;
    if (roomId == null) return;
    final rooms = state.rooms?.valueOrNull;
    final match = rooms?.where((r) => r.id == roomId).firstOrNull;
    if (match == null) return;
    // selectRoom clears extras/roomTotal (a fresh room quotes on its own
    // rate), so whatever the draft agreed is put back only once the room —
    // and the quote it starts — actually exists.
    await selectRoom(match);
    state = state.copyWith(
      extras: form.extras,
      roomTotal: form.roomTotal,
      discount: form.discount,
    );
    await refreshQuote();
  }

  /// One parked booking, in full — for reopening it from a tap on the tape
  /// chart's own yellow tile, which only ever carries the room and the dates.
  Future<BookingDraft?> loadDraft(int id) async {
    try {
      return await usecase.draft(id);
    } catch (e) {
      state = state.copyWith(error: messageFor(e));
      return null;
    }
  }

  /// Park what is on screen so far. Updates the same row if this flow is
  /// already continuing one — reopening a draft and saving it again should
  /// not lay down a second copy of the same half-finished booking.
  Future<bool> saveDraft(DraftForm form) async {
    if (state.submitting) return false;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      final saved = state.draftId == null
          ? await usecase.createDraft(form.toJson())
          : await usecase.updateDraft(state.draftId!, form.toJson());
      state = state.copyWith(submitting: false, draftId: saved.id);
      await loadChart();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: messageFor(e));
      return false;
    }
  }

  /// Throw away a parked booking form — nothing agreed with a guest is lost,
  /// so this goes without confirmation the same way the web drafts panel's
  /// own delete does.
  Future<bool> deleteDraft(int id) async {
    try {
      await usecase.deleteDraft(id);
      await loadChart();
      return true;
    } catch (e) {
      state = state.copyWith(error: messageFor(e));
      return false;
    }
  }

  Future<void> loadRooms() async {
    if (!state.datesChosen) return;
    state = state.copyWith(rooms: const AsyncValue.loading());
    try {
      final editId = state.editBookingId;
      final rooms = editId == null
          ? await usecase.availableRooms(
              iso(state.checkIn!),
              iso(state.checkOut!),
            )
          : await usecase.availableRoomsForBooking(
              editId,
              checkOutDate: iso(state.checkOut!),
              checkInDate: iso(state.checkIn!),
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
    XFile? idProofFile,
    List<GuestDraft> guests = const [],
    List<VehicleDraft> vehicles = const [],
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

      final formMap = <String, dynamic>{
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
        'vehicles': _jsonList(
          vehicles.where((v) => !v.isEmpty).map((v) => v.toJson()),
        ),
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
        ..._idProofParts(idProofFile, guests),
      };

      final form = FormData.fromMap(formMap);

      final booking = await usecase.createBooking(form);

      // The draft was only ever a stand-in for this booking; it exists now,
      // so the stand-in goes — otherwise the chart would carry both, one of
      // them stale, for a night that is actually settled. Failure here is
      // not the desk's problem: the booking is real either way.
      final parkedDraftId = state.draftId;
      if (parkedDraftId != null) {
        state = state.copyWith(clearDraftId: true);
        unawaited(usecase.deleteDraft(parkedDraftId).catchError((_) {}));
      }

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
      // A 409 here means someone else took this room out from under the
      // desk between opening this form and pressing Save. Leaving it
      // selected would let Save be pressed again against the very room that
      // just failed, showing the same message forever — so it's dropped and
      // the list refreshed, forcing a different room to be picked.
      if (e is DioException && e.response?.statusCode == 409) {
        state = state.copyWith(clearRoom: true, clearQuote: true);
        await loadRooms();
      }
      return null;
    }
  }

  /// Save the corrections against a booking already on file.
  ///
  /// Every field rides independently — omitted means "leave this alone",
  /// which is why this sends only what an edit actually touches rather than
  /// the whole shape [submit] always does: a save that only fixed a phone
  /// number must not also silently clear the vehicles nobody was shown.
  Future<Booking?> updateBooking({
    required int bookingId,
    required String guestName,
    required String guestPhone,
    required int numGuests,
    String? idProofType,
    String? idProofNumber,
    XFile? idProofFile,
    List<GuestDraft> guests = const [],
    List<VehicleDraft> vehicles = const [],
  }) async {
    if (state.submitting) return null;
    final room = state.room;
    if (room == null || !state.datesChosen) return null;

    state = state.copyWith(submitting: true, clearError: true);
    try {
      final rate = perNight(state.roomTotal, state.nights);
      final discount = wholeAmount(state.discount);

      final formMap = <String, dynamic>{
        'roomId': '${room.id}',
        'checkInDate': iso(state.checkIn!),
        'checkOutDate': iso(state.checkOut!),
        'numGuests': '$numGuests',
        'guestName': guestName.trim(),
        'guestPhone': guestPhone.trim(),
        // Set either way, never omitted — blank is how a concession already
        // agreed gets taken back, and that has to reach the server as an
        // explicit 0 rather than being read as "leave it alone".
        'discountAmount': '${discount ?? 0}',
        if (rate != null) 'basePriceOverride': '$rate',
        if (idProofType != null) 'idProofType': idProofType,
        if (idProofNumber != null && idProofNumber.trim().isNotEmpty)
          'idProofNumber': idProofNumber.trim(),
        'guests': _jsonList(guests.map((g) => g.toJson())),
        'vehicles': _jsonList(
          vehicles.where((v) => !v.isEmpty).map((v) => v.toJson()),
        ),
        'switchableCharges': _extrasJson(),
        ..._idProofParts(idProofFile, guests),
      };

      final form = FormData.fromMap(formMap);

      final booking = await usecase.updateBooking(bookingId, form);
      state = state.copyWith(submitting: false);
      await loadChart();
      return booking;
    } catch (e) {
      state = state.copyWith(submitting: false, error: messageFor(e));
      // Same as in submit(): a 409 means the room just chosen is no longer
      // free, and refreshing the list is what drops it out of the picker so
      // Save can't be pressed again against it unchanged.
      if (e is DioException && e.response?.statusCode == 409) {
        await loadRooms();
      }
      return null;
    }
  }

  /// The multipart fields carrying whatever ID proof photos were taken or
  /// picked this session — `idProofDocument` for the primary guest and
  /// `guestIdProofDocument_<index>` for each additional one, matching the
  /// position that guest holds in the `guests` JSON array itself, which is
  /// the only thing that tells the server which row a file belongs to.
  Map<String, dynamic> _idProofParts(XFile? primary, List<GuestDraft> guests) {
    final parts = <String, dynamic>{
      if (primary != null)
        'idProofDocument': MultipartFile.fromFileSync(
          primary.path,
          filename: primary.name,
        ),
    };
    for (var i = 0; i < guests.length; i++) {
      final file = guests[i].idProofFile;
      if (file != null) {
        parts['guestIdProofDocument_$i'] = MultipartFile.fromFileSync(
          file.path,
          filename: file.name,
        );
      }
    }
    return parts;
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

  /// Clear the flow, for starting another booking. The chart is kept — it
  /// belongs to the screen behind this one.
  void reset() => state = BookingState(
    chart: state.chart,
    chartFrom: state.chartFrom,
    chartTo: state.chartTo,
    chartSearch: state.chartSearch,
    chartHitIndex: state.chartHitIndex,
  );

  /// The server's own words where it sent any — "This room is already booked
  /// for part of that date range" is the whole answer, and no generic string
  /// can replace it.
  static String messageFor(Object e) => apiErrorMessage(e);
}
