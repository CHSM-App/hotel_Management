import 'package:dio/dio.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/booking_edit.dart';
import '../../domain/models/draft.dart';
import '../../domain/models/guest_match.dart';
import '../../domain/models/invoice_window.dart';
import '../../domain/models/late_checkout.dart';
import '../../domain/models/quote.dart';
import '../../domain/models/room.dart';
import '../../domain/models/staff_alert.dart';
import '../../domain/models/tape_chart.dart';
import '../../domain/repository/booking_repo.dart';
import '../../core/offline/offline_desk.dart';
import '../../core/offline/offline_interceptor.dart';
import '../../core/offline/offline_store.dart';
import '../api/api_service.dart';

/// The server first, the device when it cannot be reached.
///
/// Every operation is still resolved against a lock on the server, which stays
/// the authority: a booking taken offline is queued and checked again at sync,
/// and a room that was sold twice in the meantime comes back as a conflict for
/// the desk to resolve. See [OfflineDesk] for what the device can do alone.
class BookingImpl implements BookingRepository {
  final ApiService api;

  /// What answers when the network can't (see [OfflineDesk]). Null in tests
  /// that exercise the plain online path.
  final OfflineDesk? desk;

  BookingImpl(this.api, [this.desk]);

  /// The server first; the device's own answer only when the server cannot be
  /// reached. A real answer from the server — a refusal, a validation message —
  /// is never replaced by a local guess.
  Future<T> _orOffline<T>(
    Future<T> Function() online,
    Future<T> Function(OfflineDesk desk) offline,
  ) async {
    try {
      return await online();
    } on OfflineUnavailable {
      final d = desk;
      if (d == null) rethrow;
      return offline(d);
    }
  }

  /// The server's own copy of a booking as the HTTP cache last saw it, for the
  /// engine to work from when it has to act on a booking offline.
  Future<Map<String, dynamic>?> _cachedRaw(int id) async {
    final raw = await desk?.store.cachedGet('/bookings/$id');
    final b = raw is Map ? raw['booking'] : null;
    return b is Map ? b.cast<String, dynamic>() : null;
  }

  /// A booking that exists only on this device, or whose server id is now
  /// known, resolved to the id the server understands (null: not synced yet).
  Future<int?> _serverId(int id) async {
    if (id >= 0) return id;
    return desk?.store.serverIdFor(id);
  }

  @override
  Future<List<Room>> availableRooms(String checkInDate, String checkOutDate) =>
      _orOffline(
        () => api
            .availableRooms(checkInDate: checkInDate, checkOutDate: checkOutDate)
            .then((r) => r.rooms),
        (d) => d.availableRooms(checkInDate, checkOutDate),
      );

  @override
  Future<TapeChartData> tapeChart({
    required String startDate,
    required String endDate,
  }) async {
    // Whatever the server (or its cache) says, with this device's own changes
    // laid over it; and when there is nothing for these dates at all, the
    // window downloaded earlier.
    final base = await _orOffline(
      () => api.tapeChart(startDate: startDate, endDate: endDate),
      (d) => d.chartFromReference(),
    );
    final d = desk;
    return d == null ? base : d.overlayChart(base);
  }

  @override
  Future<Quote> priceQuote({
    required int roomId,
    required String checkInDate,
    required String checkOutDate,
    String? chargeIds,
    num? basePriceOverride,
    num? discountAmount,
    List<int>? bedIds,
  }) => _orOffline(
    () => api.priceQuote(
      roomId: roomId,
      checkInDate: checkInDate,
      checkOutDate: checkOutDate,
      chargeIds: chargeIds,
      basePriceOverride: basePriceOverride,
      discountAmount: discountAmount,
      bedIds: bedIds,
    ),
    (d) => d.priceQuote(
      roomId: roomId,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      chargeIds: chargeIds,
      basePriceOverride: basePriceOverride,
      discountAmount: discountAmount,
      bedIds: bedIds,
    ),
  );

  @override
  Future<MultiRoomQuote> multiRoomPriceQuote({
    required List<Map<String, dynamic>> rooms,
    required String checkInDate,
    required String checkOutDate,
    num? discountAmount,
  }) => api.multiRoomPriceQuote(
    rooms: rooms,
    checkInDate: checkInDate,
    checkOutDate: checkOutDate,
    discountAmount: discountAmount,
  );

  @override
  Future<AvailableBeds> availableBeds({
    required int roomId,
    required String checkInDate,
    required String checkOutDate,
  }) => api.availableBeds(
    roomId: roomId,
    checkInDate: checkInDate,
    checkOutDate: checkOutDate,
  );

  @override
  Future<List<Booking>> bookings({String? fromDate, String? toDate}) async {
    final d = desk;
    final base = await _orOffline(
      () => api.bookings(fromDate: fromDate, toDate: toDate),
      (d) => d.bookingsFromReference(fromDate, toDate),
    );
    return d == null ? base : d.overlayBookings(base);
  }

  @override
  Future<Booking> booking(int id) async {
    final d = desk;
    // This device's own copy wins while changes made here are still waiting to
    // reach the server — it is newer than anything the server could say.
    final local = await d?.localBooking(id);
    if (local != null) return local;
    try {
      return await api.booking(id);
    } on OfflineUnavailable {
      // Never opened while online: show what the downloaded chart has.
      final basic = await d?.bookingFromReference(id);
      if (basic == null) rethrow;
      return basic;
    }
  }

  @override
  Future<List<CheckAlert>> checkinAlerts() => api.checkinAlerts();

  @override
  Future<List<CheckAlert>> checkoutAlerts() => api.checkoutAlerts();

  @override
  Future<List<GuestMatch>> searchGuests(String query) =>
      api.searchGuests(query);

  @override
  Future<Response<List<int>>> idProof(int bookingId) => api.idProof(bookingId);

  @override
  Future<Response<List<int>>> guestIdProof(int bookingId, int guestId) =>
      api.guestIdProof(bookingId, guestId);

  @override
  Future<Booking> createBooking(FormData form) async {
    final d = desk;
    if (d == null) return api.createBooking(form);
    // A multipart form can only be sent once, so it is taken apart first: a
    // fresh copy goes to the server carrying a key, and if that fails for want
    // of a network the very same snapshot (and key) is what gets queued — so a
    // reply lost on the way back cannot turn into a second booking.
    final key = newUuid();
    final snap = await FormSnapshot.capture(form, key);
    try {
      final booking = await api.createBooking(await snap.rebuild(), idempotencyKey: key);
      await snap.deleteFiles();
      return booking;
    } on OfflineUnavailable {
      return d.createBookingFrom(snap, key: key);
    } catch (_) {
      await snap.deleteFiles();
      rethrow;
    }
  }

  @override
  Future<Booking> checkIn(int id, FormData form) async {
    final serverId = await _serverId(id);
    final d = desk;
    if (d == null) return api.checkIn(id, form);
    final key = newUuid();
    final snap = await FormSnapshot.capture(form, key);
    // Already on the server and no changes of ours are waiting: ask it.
    if (serverId != null && await d.store.stayGet(id) == null) {
      try {
        final booking = await api.checkIn(serverId, await snap.rebuild(), idempotencyKey: key);
        await snap.deleteFiles();
        return booking;
      } on OfflineUnavailable {
        // fall through to the device's own path, with the same snapshot
      } catch (_) {
        await snap.deleteFiles();
        rethrow;
      }
    }
    try {
      return await d.checkInFrom(id, snap, cachedRaw: await _cachedRaw(id), key: key);
    } catch (_) {
      // Refused here (a future date, no ID type): nothing was queued.
      await snap.deleteFiles();
      rethrow;
    }
  }

  @override
  Future<List<Room>> availableRoomsForBooking(
    int bookingId, {
    required String checkOutDate,
    String? checkInDate,
  }) => api
      .availableRoomsForBooking(
        bookingId,
        checkOutDate: checkOutDate,
        checkInDate: checkInDate,
      )
      .then((r) => r.rooms);

  @override
  Future<Booking> updateBooking(int id, FormData form) =>
      api.updateBooking(id, form);

  // Money / invoice-numbering paths: online only, no offline fallback.
  @override
  Future<BookingRevision> reviseBooking(int id, FormData form) =>
      api.reviseBooking(id, form);

  @override
  Future<List<BookingEdit>> bookingEdits(int id) => api.bookingEdits(id);

  @override
  Future<InvoiceEditWindow?> invoiceEditWindow(int id) =>
      api.invoiceEditWindow(id);

  @override
  Future<PastWindow> pastWindow(String billingSide) =>
      api.pastWindow(billingSide);

  @override
  Future<int> createPastBooking(FormData form) => api.createPastBooking(form);

  @override
  Future<LateCheckout> lateCheckout(int id) => _orOffline(
    () => api.lateCheckout(id),
    (d) async => d.lateCheckout(id, cachedRaw: await _cachedRaw(id)),
  );

  @override
  Future<Booking> checkOut(int id, Map<String, dynamic> body) =>
      api.checkOut(id, body);

  @override
  Future<LateCheckout> roomLateCheckout(int id, int roomId) =>
      api.roomLateCheckout(id, roomId);

  @override
  Future<Booking> checkOutRoom(int id, int roomId, Map<String, dynamic> body) =>
      api.checkOutRoom(id, roomId, body);

  @override
  Future<Booking> cancel(int id, [Map<String, dynamic>? body]) =>
      api.cancelBooking(id, body);

  @override
  Future<Map<String, dynamic>> sendWhatsApp(int id) {
    if (id < 0) {
      throw OfflineUnavailable.because('The WhatsApp message can be sent once this booking has synced.');
    }
    return api.sendBookingWhatsApp(id);
  }

  @override
  // Drafts live on the server; offline there is simply none to list.
  Future<List<BookingDraft>> drafts() => _orOffline(() => api.drafts(), (_) async => const []);

  @override
  Future<BookingDraft> draft(int id) => api.draft(id);

  @override
  Future<BookingDraft> createDraft(Map<String, dynamic> form) =>
      api.createDraft(form);

  @override
  Future<BookingDraft> updateDraft(int id, Map<String, dynamic> form) =>
      api.updateDraft(id, form);

  @override
  Future<void> deleteDraft(int id) => api.deleteDraft(id);
}
