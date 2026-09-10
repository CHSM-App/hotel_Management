import 'package:dio/dio.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/category.dart';
import '../../domain/models/draft.dart';
import '../../domain/models/food_order.dart';
import '../../domain/models/invoice.dart';
import '../../domain/models/late_checkout.dart';
import '../../domain/models/me.dart';
import '../../domain/models/menu.dart';
import '../../domain/models/quote.dart';
import '../../domain/models/report.dart';
import '../../domain/models/room.dart';
import '../../domain/models/season.dart';
import '../../domain/models/session.dart';
import '../../domain/models/switchable_charge_listing.dart';
import '../../domain/models/tape_chart.dart';

/// Every endpoint the app talks to, in one place.
///
/// Same server as the web front desk, so paths mirror backend/src/app.js
/// exactly. Where the two clients call the same route they must send the same
/// shape — a rule already earned once: POST /bookings runs through the ID-proof
/// upload middleware, so its body has to be a form even when no document is
/// attached, and a JSON body there is simply rejected.
///
/// Hand-written rather than Retrofit-generated; see the note in pubspec.yaml.
/// The shape is the same either way — one class, one method per endpoint, and
/// nothing above data/ knows Dio exists.
class ApiService {
  final Dio _dio;

  ApiService(this._dio);

  // ===== AUTH =====

  /// Staff sign-in. OWNER, RECEPTION and KITCHEN come through this door;
  /// SUPERADMIN has a separate one this app does not offer.
  Future<Session> login(Credentials credentials) async {
    final res = await _dio.post('/auth/login', data: credentials.toJson());
    return Session.fromJson(_map(res.data));
  }

  /// No OTP — resets the password for whoever's phone or email is given, the
  /// same door the web login's "Forgot password?" link uses.
  Future<void> forgotPassword({
    required String identifier,
    required String newPassword,
  }) async {
    await _dio.post(
      '/auth/forgot-password',
      data: {'identifier': identifier, 'newPassword': newPassword},
    );
  }

  // ===== SESSION =====

  /// Who is signed in, and what this property is.
  Future<Me> me() async {
    final res = await _dio.get('/me');
    return Me.fromJson(_map(res.data));
  }

  /// Step 1 of changing a password: the server checks [currentPassword] and
  /// texts a 6-digit code to the account's phone over WhatsApp. Answers with
  /// the masked phone and when the code expires, for the confirmation step.
  Future<Map<String, dynamic>> sendPasswordOtp(String currentPassword) async {
    final res = await _dio.post(
      '/me/password/otp',
      data: {'currentPassword': currentPassword},
    );
    return _map(res.data);
  }

  /// Step 2: the current password again, the new one, and the code just
  /// texted. All three travel together so a stolen code alone is useless.
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
    required String otp,
  }) async {
    await _dio.patch(
      '/me/password',
      data: {
        'currentPassword': currentPassword,
        'newPassword': newPassword,
        'otp': otp,
      },
    );
  }

  /// What an owner may edit about their own property. Answers with the whole
  /// `/me` payload; only the lodge half of it has changed.
  Future<Me> updateMyLodge(Map<String, dynamic> body) async {
    final res = await _dio.patch('/me/lodge', data: body);
    return Me.fromJson(_map(res.data));
  }

  // ===== BOOKINGS =====

  /// Rooms free across the whole range. The server excludes anything already
  /// booked over those nights — availability is never decided on the phone.
  Future<AvailableRooms> availableRooms({
    required String checkInDate,
    required String checkOutDate,
  }) async {
    final res = await _dio.get(
      '/bookings/available-rooms',
      queryParameters: {
        'checkInDate': checkInDate,
        'checkOutDate': checkOutDate,
      },
    );
    return AvailableRooms.fromJson(_map(res.data));
  }

  /// What a stay costs. Re-fetched on every change to the room, the dates, the
  /// extras or the agreed rate, because any of them can move the total in ways
  /// the client cannot work out for itself.
  Future<Quote> priceQuote({
    required int roomId,
    required String checkInDate,
    required String checkOutDate,
    String? chargeIds,
    num? basePriceOverride,
    num? discountAmount,
  }) async {
    final res = await _dio.get(
      '/bookings/price-quote',
      queryParameters: {
        'roomId': roomId,
        'checkInDate': checkInDate,
        'checkOutDate': checkOutDate,
        if (chargeIds != null && chargeIds.isNotEmpty) 'chargeIds': chargeIds,
        if (basePriceOverride != null) 'basePriceOverride': basePriceOverride,
        if (discountAmount != null) 'discountAmount': discountAmount,
      },
    );
    return Quote.fromJson(_map(res.data));
  }

  /// The register, over a date range.
  ///
  /// A date range and nothing else — the controller reads fromDate and toDate
  /// and no other filter, so the status this used to send was accepted by Dio,
  /// ignored by the server, and made every chip show the same list. Status is a
  /// question about rows already in hand, and is answered in the view model.
  Future<List<Booking>> bookings({
    String? fromDate,
    String? toDate,
  }) async {
    final res = await _dio.get(
      '/bookings',
      queryParameters: {
        if (fromDate != null) 'fromDate': fromDate,
        if (toDate != null) 'toDate': toDate,
      },
    );
    final body = _map(res.data);
    return (body['bookings'] as List? ?? [])
        .map((e) => Booking.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<Booking> booking(int id) async {
    final res = await _dio.get('/bookings/$id');
    return Booking.fromJson(_map(res.data)['booking'] as Map<String, dynamic>);
  }

  /// The tape chart's own fetch: every active room plus every stay, draft and
  /// cancellation touching [startDate, endDate) in one call, rather than the
  /// setup screen's room list and the register's own fetch composed together.
  Future<TapeChartData> tapeChart({
    required String startDate,
    required String endDate,
  }) async {
    final res = await _dio.get(
      '/bookings/tape-chart',
      queryParameters: {'startDate': startDate, 'endDate': endDate},
    );
    return TapeChartData.fromJson(_map(res.data));
  }

  /// Take a booking. Multipart, for the reason in the class comment.
  Future<Booking> createBooking(FormData form) async {
    final res = await _dio.post('/bookings', data: form);
    final body = _map(res.data);
    // The controller answers with the created row directly on this route,
    // rather than the {booking} envelope the read endpoints use.
    final booking = body['booking'];
    return Booking.fromJson(
      (booking is Map<String, dynamic> ? booking : body),
    );
  }

  Future<Booking> checkIn(int id, FormData form) async {
    final res = await _dio.patch('/bookings/$id/check-in', data: form);
    return Booking.fromJson(_map(res.data)['booking'] as Map<String, dynamic>);
  }

  /// Rooms free for an edit — the same shape [availableRooms] answers, but
  /// asked against this booking's own occupancy excluded, so the room it is
  /// already in reads as free rather than conflicting with itself.
  Future<AvailableRooms> availableRoomsForBooking(
    int bookingId, {
    required String checkOutDate,
    String? checkInDate,
  }) async {
    final res = await _dio.get(
      '/bookings/$bookingId/available-rooms',
      queryParameters: {
        'checkOutDate': checkOutDate,
        if (checkInDate != null && checkInDate.isNotEmpty)
          'checkInDate': checkInDate,
      },
    );
    return AvailableRooms.fromJson(_map(res.data));
  }

  /// Correct a booking already on file — any of its fields, independently.
  /// Multipart for the same reason [createBooking] is: an ID proof scan can
  /// ride along with it.
  Future<Booking> updateBooking(int id, FormData form) async {
    final res = await _dio.patch('/bookings/$id', data: form);
    return Booking.fromJson(_map(res.data)['booking'] as Map<String, dynamic>);
  }

  /// How late the guest is, and what the policy says that is worth. Asked
  /// before every checkout — one that is on time answers isChargeable false
  /// and the desk is never detained.
  Future<LateCheckout> lateCheckout(int id) async {
    final res = await _dio.get('/bookings/$id/late-checkout');
    return LateCheckout.fromJson(
      _map(res.data)['lateCheckout'] as Map<String, dynamic>,
    );
  }

  Future<Booking> checkOut(int id, Map<String, dynamic> body) async {
    final res = await _dio.patch('/bookings/$id/check-out', data: body);
    return Booking.fromJson(_map(res.data)['booking'] as Map<String, dynamic>);
  }

  /// The primary guest's uploaded ID proof — an image or a PDF, whichever
  /// they handed over at check-in. Raw bytes plus the content type the
  /// server sent, so the viewer can tell a photo from a scanned PDF.
  Future<Response<List<int>>> idProof(int bookingId) => _dio.get<List<int>>(
    '/bookings/$bookingId/id-proof',
    options: Options(responseType: ResponseType.bytes),
  );

  Future<Response<List<int>>> guestIdProof(int bookingId, int guestId) =>
      _dio.get<List<int>>(
        '/bookings/$bookingId/guests/$guestId/id-proof',
        options: Options(responseType: ResponseType.bytes),
      );

  /// Call off a reservation nobody came for.
  ///
  /// The UPDATE behind it matches `status = 'BOOKED'` — a stay that has
  /// already been checked in cannot be cancelled, only checked out. The
  /// server answers 409 in that case rather than silently doing nothing.
  /// [body] settles whatever advance was on file: a refund back to the
  /// guest, or — on a stay that held none — a charge taken on the spot.
  Future<Booking> cancelBooking(int id, [Map<String, dynamic>? body]) async {
    final res = await _dio.patch('/bookings/$id/cancel', data: body);
    return Booking.fromJson(_map(res.data)['booking'] as Map<String, dynamic>);
  }

  // ===== BOOKING DRAFTS =====

  /// Every parked booking on this property — the same list the web drafts
  /// panel draws from.
  Future<List<BookingDraft>> drafts() async {
    final res = await _dio.get('/bookings/drafts');
    final body = _map(res.data);
    return (body['drafts'] as List? ?? [])
        .map((e) => BookingDraft.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<BookingDraft> draft(int id) async {
    final res = await _dio.get('/bookings/drafts/$id');
    return BookingDraft.fromJson(
      _map(res.data)['draft'] as Map<String, dynamic>,
    );
  }

  Future<BookingDraft> createDraft(Map<String, dynamic> form) async {
    final res = await _dio.post('/bookings/drafts', data: {'form': form});
    return BookingDraft.fromJson(
      _map(res.data)['draft'] as Map<String, dynamic>,
    );
  }

  Future<BookingDraft> updateDraft(int id, Map<String, dynamic> form) async {
    final res = await _dio.put('/bookings/drafts/$id', data: {'form': form});
    return BookingDraft.fromJson(
      _map(res.data)['draft'] as Map<String, dynamic>,
    );
  }

  Future<void> deleteDraft(int id) async {
    await _dio.delete('/bookings/drafts/$id');
  }

  // ===== BILLING =====

  /// Stays that have checked out and have no bill yet.
  Future<List<BillableStay>> billingQueue() async {
    final res = await _dio.get('/billing/queue');
    return (_map(res.data)['bookings'] as List? ?? [])
        .map((e) => BillableStay.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// What the bill will say. Re-fetched when the overstay decision changes,
  /// because adding that charge can move a night into a different GST band and
  /// change the rounding — the totals are never adjusted on the phone.
  Future<BillPreview> previewBill(
    int bookingId, {
    bool includeLateCheckout = true,
    num discountAmount = 0,
    String? discountReason,
  }) async {
    final res = await _dio.get(
      '/billing/bookings/$bookingId/preview',
      queryParameters: {
        'includeLateCheckout': includeLateCheckout,
        if (discountAmount > 0) ...{
          'discountAmount': discountAmount,
          'discountReason': (discountReason ?? '').trim(),
        },
      },
    );
    return BillPreview.fromJson(_map(res.data));
  }

  /// Cut the bill. This burns a serial and cannot be undone — only voided.
  Future<Invoice> issueInvoice(
    int bookingId,
    Map<String, dynamic> body,
  ) async {
    final res = await _dio.post(
      '/billing/bookings/$bookingId/invoice',
      data: body,
    );
    final map = _map(res.data);
    final invoice = map['invoice'];
    return Invoice.fromJson(
      invoice is Map<String, dynamic> ? invoice : map,
    );
  }

  /// Bills already issued.
  Future<List<Invoice>> invoices() async {
    final res = await _dio.get('/billing/invoices');
    return (_map(res.data)['invoices'] as List? ?? [])
        .map((e) => Invoice.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<Invoice> invoice(int id) async {
    final res = await _dio.get('/billing/invoices/$id');
    final map = _map(res.data);
    final invoice = map['invoice'];
    return Invoice.fromJson(
      invoice is Map<String, dynamic> ? invoice : map,
    );
  }

  /// Cancel a bill that should not have been issued. The document stays on
  /// file marked void — a serial is never reused and a row is never deleted.
  Future<Invoice> voidInvoice(int id, String reason) async {
    final res = await _dio.post(
      '/billing/invoices/$id/void',
      data: {'reason': reason},
    );
    final map = _map(res.data);
    final invoice = map['invoice'];
    return Invoice.fromJson(
      invoice is Map<String, dynamic> ? invoice : map,
    );
  }

  /// Every advance receipt written against this stay, newest first.
  Future<List<AdvanceReceipt>> advanceReceipts(int bookingId) async {
    final res = await _dio.get('/billing/bookings/$bookingId/advance-receipts');
    return (_map(res.data)['receipts'] as List? ?? [])
        .map((e) => AdvanceReceipt.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Write one — money handed over now, while the stay is still reserved or
  /// in house. Burns a serial the same way an invoice does.
  Future<AdvanceReceipt> issueAdvanceReceipt(
    int bookingId,
    Map<String, dynamic> body,
  ) async {
    final res = await _dio.post(
      '/billing/bookings/$bookingId/advance-receipt',
      data: body,
    );
    final map = _map(res.data);
    final receipt = map['receipt'];
    return AdvanceReceipt.fromJson(
      receipt is Map<String, dynamic> ? receipt : map,
    );
  }

  /// Cancel a receipt that should not have been issued. Stays on file marked
  /// void — a serial is never reused and a row is never deleted.
  Future<AdvanceReceipt> voidAdvanceReceipt(int id, String reason) async {
    final res = await _dio.post(
      '/billing/advance-receipts/$id/void',
      data: {'reason': reason},
    );
    final map = _map(res.data);
    final receipt = map['receipt'];
    return AdvanceReceipt.fromJson(
      receipt is Map<String, dynamic> ? receipt : map,
    );
  }

  // ===== FOOD ORDERS =====

  /// Everything still in play, whatever day it was placed.
  ///
  /// Deliberately not date-filtered: an order placed at 11:45pm and
  /// delivered at 12:05am must not vanish off the kitchen screen when the
  /// IST date rolls over mid-service. This is the endpoint the queue polls.
  Future<List<FoodOrder>> orderQueue() async {
    final res = await _dio.get('/orders/queue');
    return _orders(res.data);
  }

  /// One IST day of orders, optionally narrowed to a status.
  Future<List<FoodOrder>> orders({String? date, String? status}) async {
    final res = await _dio.get(
      '/orders',
      queryParameters: {
        if (date != null) 'date': date,
        if (status != null) 'status': status,
      },
    );
    return _orders(res.data);
  }

  /// Move an order on. The status must be one the order itself offered in
  /// nextStatuses — the server recomputes that and refuses anything else.
  Future<FoodOrder> setOrderStatus(
    int id,
    String status, {
    String? cancelReason,
  }) async {
    final res = await _dio.patch(
      '/orders/$id/status',
      data: {
        'status': status,
        if (cancelReason != null && cancelReason.isNotEmpty)
          'cancelReason': cancelReason,
      },
    );
    return FoodOrder.fromJson(_map(res.data)['order'] as Map<String, dynamic>);
  }

  /// Tick one dish off a ticket, or take the tick back.
  ///
  /// Answers with the whole order so the screen redraws from what the server
  /// says rather than guessing what the tick did to the rest of the ticket.
  Future<FoodOrder> setItemReady(int id, int itemId, bool ready) async {
    final res = await _dio.patch(
      '/orders/$id/items/$itemId/ready',
      data: {'ready': ready},
    );
    return FoodOrder.fromJson(_map(res.data)['order'] as Map<String, dynamic>);
  }

  /// An order reception typed in. Skips PENDING — staff entered it, so
  /// there is nothing for the kitchen to accept.
  Future<FoodOrder> createCounterOrder(Map<String, dynamic> body) async {
    final res = await _dio.post('/orders', data: body);
    final map = _map(res.data);
    final order = map['order'];
    return FoodOrder.fromJson(
      order is Map<String, dynamic> ? order : map,
    );
  }

  /// A guest who mistypes their room's food PIN five times locks it out of
  /// ordering for fifteen minutes. Reception clears it from here rather than
  /// waiting out the timer.
  Future<void> clearFoodPinLockout(String roomNumber) async {
    await _dio.delete('/orders/pin-lockouts/${Uri.encodeComponent(roomNumber)}');
  }

  // ===== MENU (read-only, for taking an order) =====

  /// The menu, in sections. Readable with orders.manage as well as
  /// food.manage, so the kitchen can see what it is cooking.
  Future<List<MenuSection>> menu() async {
    final res = await _dio.get('/menu');
    return (_map(res.data)['sections'] as List? ?? [])
        .map((e) => MenuSection.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// The dining tables an order can be attached to.
  Future<List<DiningTable>> tables() async {
    final res = await _dio.get('/tables');
    return (_map(res.data)['tables'] as List? ?? [])
        .map((e) => DiningTable.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  List<FoodOrder> _orders(dynamic data) =>
      (_map(data)['orders'] as List? ?? [])
          .map((e) => FoodOrder.fromJson(e as Map<String, dynamic>))
          .toList();

  // ===== ROOMS & RATES (rooms.manage) =====

  /// Every room on the setup screen — status, photos and all, not just what is
  /// free for a chosen stay.
  Future<List<RoomListing>> rooms() async {
    final res = await _dio.get('/rooms');
    return (_map(res.data)['rooms'] as List? ?? [])
        .map((e) => RoomListing.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Add one room, or a bulk range. Multipart because photos ride along on a
  /// single-room add.
  Future<void> createRoom(FormData form) async {
    await _dio.post('/rooms', data: form);
  }

  Future<void> updateRoom(int id, FormData form) async {
    await _dio.patch('/rooms/$id', data: form);
  }

  Future<void> setRoomActive(int id, bool isActive) async {
    await _dio.patch('/rooms/$id/status', data: {'isActive': isActive});
  }

  Future<void> deleteRoom(int id) async {
    await _dio.delete('/rooms/$id');
  }

  Future<void> deleteRoomImage(int roomId, int imageId) async {
    await _dio.delete('/rooms/$roomId/images/$imageId');
  }

  // ===== CATEGORIES (rate plans) =====

  Future<List<RoomCategory>> categories() async {
    final res = await _dio.get('/categories');
    return (_map(res.data)['categories'] as List? ?? [])
        .map((e) => RoomCategory.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> createCategory({required String name, required num basePrice}) async {
    await _dio.post('/categories', data: {'name': name, 'basePrice': basePrice});
  }

  Future<void> updateCategory(
    int id, {
    required String name,
    required num basePrice,
  }) async {
    await _dio.patch('/categories/$id', data: {'name': name, 'basePrice': basePrice});
  }

  Future<void> setCategoryActive(int id, bool isActive) async {
    await _dio.patch('/categories/$id/status', data: {'isActive': isActive});
  }

  Future<void> deleteCategory(int id) async {
    await _dio.delete('/categories/$id');
  }

  // ===== SWITCHABLE CHARGES (booking extras) =====

  Future<List<SwitchableChargeListing>> switchableCharges() async {
    final res = await _dio.get('/switchable-charges');
    return (_map(res.data)['switchableCharges'] as List? ?? [])
        .map((e) => SwitchableChargeListing.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> createSwitchableCharge({
    required String name,
    required num chargePerNight,
  }) async {
    await _dio.post(
      '/switchable-charges',
      data: {'name': name, 'chargePerNight': chargePerNight},
    );
  }

  Future<void> updateSwitchableCharge(
    int id, {
    required String name,
    required num chargePerNight,
  }) async {
    await _dio.patch(
      '/switchable-charges/$id',
      data: {'name': name, 'chargePerNight': chargePerNight},
    );
  }

  Future<void> setSwitchableChargeActive(int id, bool isActive) async {
    await _dio.patch('/switchable-charges/$id/status', data: {'isActive': isActive});
  }

  Future<void> deleteSwitchableCharge(int id) async {
    await _dio.delete('/switchable-charges/$id');
  }

  // ===== SEASONS =====

  Future<List<Season>> seasons() async {
    final res = await _dio.get('/seasons');
    return (_map(res.data)['seasons'] as List? ?? [])
        .map((e) => Season.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> createSeason({
    required String name,
    required String startDate,
    required String endDate,
    required num adjustmentPercent,
  }) async {
    await _dio.post(
      '/seasons',
      data: {
        'name': name,
        'startDate': startDate,
        'endDate': endDate,
        'adjustmentPercent': adjustmentPercent,
      },
    );
  }

  Future<void> updateSeason(
    int id, {
    required String name,
    required String startDate,
    required String endDate,
    required num adjustmentPercent,
  }) async {
    await _dio.patch(
      '/seasons/$id',
      data: {
        'name': name,
        'startDate': startDate,
        'endDate': endDate,
        'adjustmentPercent': adjustmentPercent,
      },
    );
  }

  Future<void> deleteSeason(int id) async {
    await _dio.delete('/seasons/$id');
  }

  // ===== REPORTS (reports.view) =====

  /// The booking register over a date range — the same figures the web
  /// dashboard's Reports > Bookings tab shows and the Excel/PDF export uses.
  Future<BookingsReport> bookingsReport({
    required String fromDate,
    required String toDate,
  }) async {
    final res = await _dio.get(
      '/reports/bookings',
      queryParameters: {'fromDate': fromDate, 'toDate': toDate},
    );
    return BookingsReport.fromJson(_map(res.data));
  }

  /// Day-by-day occupancy over a date range.
  Future<OccupancyReport> occupancyReport({
    required String fromDate,
    required String toDate,
  }) async {
    final res = await _dio.get(
      '/reports/occupancy',
      queryParameters: {'fromDate': fromDate, 'toDate': toDate},
    );
    return OccupancyReport.fromJson(_map(res.data));
  }

  /// The GST filing summary — invoice-wise totals grouped by document type.
  Future<GstSummaryReport> gstSummary({
    required String fromDate,
    required String toDate,
  }) async {
    final res = await _dio.get(
      '/reports/gst-summary',
      queryParameters: {'fromDate': fromDate, 'toDate': toDate},
    );
    return GstSummaryReport.fromJson(_map(res.data));
  }

  /// Dio hands back `dynamic`; every one of these routes answers with an
  /// object. Narrowed in one place so no call site has to cast.
  Map<String, dynamic> _map(dynamic data) {
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return Map<String, dynamic>.from(data);
    throw StateError('Expected an object from the server, got ${data.runtimeType}');
  }
}
