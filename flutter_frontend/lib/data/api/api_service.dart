import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/category.dart';
import '../../domain/models/draft.dart';
import '../../domain/models/event_booking.dart';
import '../../domain/models/food_order.dart';
import '../../domain/models/guest_match.dart';
import '../../domain/models/inventory.dart';
import '../../domain/models/invoice.dart';
import '../../domain/models/json.dart';
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

  /// Guests this property has had before, matched on a partly-typed name —
  /// the same lookup the web booking form's own typeahead runs.
  Future<List<GuestMatch>> searchGuests(String query) async {
    final res = await _dio.get(
      '/bookings/guest-search',
      queryParameters: {'q': query},
    );
    final body = _map(res.data);
    return (body['guests'] as List? ?? [])
        .map((e) => GuestMatch.fromJson(e as Map<String, dynamic>))
        .toList();
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

  /// Tables, rooms, and takeaways holding delivered food nobody has paid for.
  Future<List<FoodTab>> foodTabs() async {
    final res = await _dio.get('/billing/food-tabs');
    return (_map(res.data)['tabs'] as List? ?? [])
        .map((e) => FoodTab.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// What a food bill will say. `tab` is the opaque id the queue row itself
  /// carries — "table-3", "room-12", "counter-88" — passed straight through.
  Future<FoodBillPreview> previewFoodBill(String tab) async {
    final res = await _dio.get('/billing/food-tabs/$tab/preview');
    return FoodBillPreview.fromJson(_map(res.data));
  }

  /// Close one tab — sweeps every delivered order on it into one document.
  Future<Invoice> issueFoodInvoice(
    String tab,
    Map<String, dynamic> body,
  ) async {
    final res = await _dio.post('/billing/food-tabs/$tab/invoice', data: body);
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

  /// Send the already-built bill PDF to the guest on WhatsApp. The server
  /// stores it behind a link and texts that link through an approved
  /// template — nothing here opens the device's own WhatsApp or asks for an
  /// attachment. [phone] overrides the number on file for this one send;
  /// left null, the server falls back to the guest's own number.
  Future<WhatsAppShareResult> shareInvoiceWhatsApp(
    int invoiceId,
    Uint8List pdfBytes,
    String filename, {
    String? phone,
  }) async {
    final form = FormData.fromMap({
      'bill': MultipartFile.fromBytes(pdfBytes, filename: filename),
      if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
    });
    final res = await _dio.post(
      '/billing/invoices/$invoiceId/share/whatsapp',
      data: form,
    );
    return WhatsAppShareResult.fromJson(_map(res.data));
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

  // ===== MENU MANAGEMENT (food.manage) =====

  Future<int> createMenuCategory({
    required String name,
    required int sortOrder,
  }) async {
    final res = await _dio.post(
      '/menu/categories',
      data: {'name': name, 'sortOrder': sortOrder},
    );
    return asInt(_map(res.data)['id']);
  }

  Future<void> updateMenuCategory(
    int id, {
    required String name,
    required int sortOrder,
  }) async {
    await _dio.patch(
      '/menu/categories/$id',
      data: {'name': name, 'sortOrder': sortOrder},
    );
  }

  Future<void> setMenuCategoryActive(int id, bool isActive) async {
    await _dio.patch('/menu/categories/$id/status', data: {'isActive': isActive});
  }

  /// The kitchen's "the fish ran out" switch, thrown over a whole section —
  /// see setCategoryItemsAvailable on the server.
  Future<void> setMenuCategoryAvailability(int id, bool isAvailable) async {
    await _dio.patch(
      '/menu/categories/$id/availability',
      data: {'isAvailable': isAvailable},
    );
  }

  Future<void> deleteMenuCategory(int id) async {
    await _dio.delete('/menu/categories/$id');
  }

  /// Add a dish. Multipart, for the photo — see createMenuItemSchema on the
  /// server for the field names this form must carry.
  Future<int> createMenuItem(FormData form) async {
    final res = await _dio.post('/menu/items', data: form);
    return asInt(_map(res.data)['id']);
  }

  Future<void> updateMenuItem(int id, FormData form) async {
    await _dio.patch('/menu/items/$id', data: form);
  }

  Future<void> setMenuItemAvailability(int id, bool isAvailable) async {
    await _dio.patch(
      '/menu/items/$id/availability',
      data: {'isAvailable': isAvailable},
    );
  }

  Future<void> setMenuItemActive(int id, bool isActive) async {
    await _dio.patch('/menu/items/$id/status', data: {'isActive': isActive});
  }

  Future<void> deleteMenuItem(int id) async {
    await _dio.delete('/menu/items/$id');
  }

  /// A dish's whole size list, replaced wholesale — an empty list is the way
  /// back to a single-price dish. See setItemPortions on the server.
  Future<void> setItemPortions(int itemId, List<Map<String, dynamic>> portions) async {
    await _dio.put('/menu/items/$itemId/portions', data: {'portions': portions});
  }

  Future<FoodSettings> foodSettings() async {
    final res = await _dio.get('/menu/settings');
    return FoodSettings.fromJson(_map(res.data)['settings'] as Map<String, dynamic>);
  }

  Future<FoodSettings> updateFoodSettings(FoodSettings settings) async {
    final res = await _dio.patch('/menu/settings', data: settings.toJson());
    return FoodSettings.fromJson(_map(res.data)['settings'] as Map<String, dynamic>);
  }

  // ===== INVENTORY (food.manage) =====

  Future<List<RawMaterial>> materials({bool includeInactive = true}) async {
    final res = await _dio.get(
      '/inventory/materials',
      queryParameters: {'includeInactive': includeInactive},
    );
    return (_map(res.data)['materials'] as List? ?? [])
        .map((e) => RawMaterial.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<int> createMaterial({
    required String name,
    required String unit,
    required String category,
    num quantity = 0,
    num lowStockThreshold = 0,
  }) async {
    final res = await _dio.post(
      '/inventory/materials',
      data: {
        'name': name,
        'unit': unit,
        'category': category,
        'quantity': quantity,
        'lowStockThreshold': lowStockThreshold,
      },
    );
    return asInt(_map(res.data)['id']);
  }

  /// The unit can't be changed once anything has been counted in it — see
  /// updateMaterialSchema's own comment on the server — so it isn't sent here.
  Future<RawMaterial> updateMaterial(
    int id, {
    required String name,
    required String category,
    num lowStockThreshold = 0,
  }) async {
    final res = await _dio.patch(
      '/inventory/materials/$id',
      data: {'name': name, 'category': category, 'lowStockThreshold': lowStockThreshold},
    );
    return RawMaterial.fromJson(_map(res.data)['material'] as Map<String, dynamic>);
  }

  Future<RawMaterial> setMaterialActive(int id, bool isActive) async {
    final res = await _dio.patch(
      '/inventory/materials/$id/status',
      data: {'isActive': isActive},
    );
    return RawMaterial.fromJson(_map(res.data)['material'] as Map<String, dynamic>);
  }

  Future<void> deleteMaterial(int id) async {
    await _dio.delete('/inventory/materials/$id');
  }

  /// Stock arriving (ADD) or a shelf count that disagrees with the book
  /// (SET) — see adjustStockSchema on the server for the two modes.
  Future<RawMaterial> adjustStock(
    int id, {
    required String mode,
    required num quantity,
    String note = '',
  }) async {
    final res = await _dio.post(
      '/inventory/materials/$id/adjust',
      data: {'mode': mode, 'quantity': quantity, 'note': note},
    );
    return RawMaterial.fromJson(_map(res.data)['material'] as Map<String, dynamic>);
  }

  Future<List<StockMovement>> movements({int? materialId, int limit = 100}) async {
    final res = await _dio.get(
      '/inventory/movements',
      queryParameters: {
        if (materialId != null) 'materialId': materialId,
        'limit': limit,
      },
    );
    return (_map(res.data)['movements'] as List? ?? [])
        .map((e) => StockMovement.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Which dishes have a recipe and which don't — the Recipes tab's own list,
  /// distinct from [menu] which is the guest-facing sections-and-dishes shape.
  Future<List<RecipeDishSummary>> recipeSummaries() async {
    final res = await _dio.get('/inventory/recipes');
    return (_map(res.data)['dishes'] as List? ?? [])
        .map((e) => RecipeDishSummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<ItemRecipe> itemRecipe(int itemId) async {
    final res = await _dio.get('/inventory/recipes/$itemId');
    return ItemRecipe.fromJson(_map(res.data)['recipe'] as Map<String, dynamic>);
  }

  /// A dish's whole ingredient list, replaced wholesale — same
  /// replace-don't-diff rule as [setItemPortions].
  Future<ItemRecipe> setItemRecipe(int itemId, List<Map<String, dynamic>> lines) async {
    final res = await _dio.put('/inventory/recipes/$itemId', data: {'lines': lines});
    return ItemRecipe.fromJson(_map(res.data)['recipe'] as Map<String, dynamic>);
  }

  // ===== TABLES MANAGEMENT (food.manage) =====

  /// Every table, active or not — [tables] above only ever needs to offer an
  /// order the active ones, so this is the setup screen's own fuller list.
  Future<List<DiningTable>> allTables() async {
    final res = await _dio.get('/tables');
    return (_map(res.data)['tables'] as List? ?? [])
        .map((e) => DiningTable.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> createTable({required String label, int? seats}) async {
    await _dio.post('/tables', data: {'label': label, 'seats': seats});
  }

  Future<void> bulkCreateTables({
    required String prefix,
    required int rangeStart,
    required int rangeEnd,
    int? seats,
  }) async {
    await _dio.post(
      '/tables/bulk',
      data: {
        'prefix': prefix,
        'rangeStart': rangeStart,
        'rangeEnd': rangeEnd,
        'seats': seats,
      },
    );
  }

  Future<void> updateTable(int id, {required String label, int? seats}) async {
    await _dio.patch('/tables/$id', data: {'label': label, 'seats': seats});
  }

  Future<void> setTableActive(int id, bool isActive) async {
    await _dio.patch('/tables/$id/status', data: {'isActive': isActive});
  }

  /// Issues a fresh QR token, killing every printed copy of the old code.
  Future<void> regenerateTableQr(int id) async {
    await _dio.post('/tables/$id/regenerate-qr');
  }

  Future<void> deleteTable(int id) async {
    await _dio.delete('/tables/$id');
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

  // ===== EVENTS & FUNCTIONS (events.manage) =====

  /// Halls and lawns that can be hired — the Setup tab's Venues card.
  Future<List<EventVenue>> eventVenues({bool includeInactive = false}) async {
    final res = await _dio.get(
      '/events/venues',
      queryParameters: {'includeInactive': includeInactive},
    );
    return (_map(res.data)['venues'] as List? ?? [])
        .map((e) => EventVenue.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Multipart so any newly picked photos can ride along under the `images`
  /// field, the same way [createRoom] does.
  Future<void> createEventVenue(FormData form) async {
    await _dio.post('/events/venues', data: form);
  }

  /// Multipart when a field (or a photo) is actually being edited — the
  /// route runs through the same multer middleware a photo upload would.
  /// The activate/deactivate toggle takes the JSON door instead via
  /// [setEventVenueActive]: multer only reads a multipart body, so a
  /// boolean sent as a form field would arrive as the string "true"/"false"
  /// and fail the server's `z.boolean()` check. See venueImageUpload.js's
  /// own comment on this.
  Future<void> updateEventVenue(int id, FormData form) async {
    await _dio.patch('/events/venues/$id', data: form);
  }

  Future<void> setEventVenueActive(int id, bool isActive) async {
    await _dio.patch('/events/venues/$id', data: {'isActive': isActive});
  }

  Future<void> deleteEventVenueImage(int venueId, int imageId) async {
    await _dio.delete('/events/venues/$venueId/images/$imageId');
  }

  /// Extras quoted on top of venue and plates — DJ, decor, mandap.
  Future<List<EventAddon>> eventAddons({bool includeInactive = false}) async {
    final res = await _dio.get(
      '/events/addons',
      queryParameters: {'includeInactive': includeInactive},
    );
    return (_map(res.data)['addons'] as List? ?? [])
        .map((e) => EventAddon.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> createEventAddon({
    required String name,
    required num defaultAmount,
    bool isPerUnit = false,
  }) async {
    await _dio.post(
      '/events/addons',
      data: {
        'name': name,
        'defaultAmount': defaultAmount,
        'isPerUnit': isPerUnit,
      },
    );
  }

  Future<void> updateEventAddon(
    int id, {
    String? name,
    num? defaultAmount,
    bool? isPerUnit,
    bool? isActive,
  }) async {
    await _dio.patch(
      '/events/addons/$id',
      data: {
        if (name != null) 'name': name,
        if (defaultAmount != null) 'defaultAmount': defaultAmount,
        if (isPerUnit != null) 'isPerUnit': isPerUnit,
        if (isActive != null) 'isActive': isActive,
      },
    );
  }

  /// Whether a venue is free over a window, and what it clashes with if not
  /// — an enquiry is still allowed onto a taken slot, so the desk decides.
  Future<EventAvailability> eventAvailability({
    required int venueId,
    required String startAt,
    required String endAt,
    int? excludeId,
  }) async {
    final res = await _dio.get(
      '/events/availability',
      queryParameters: {
        'venueId': venueId,
        'startAt': startAt,
        'endAt': endAt,
        if (excludeId != null) 'excludeId': excludeId,
      },
    );
    return EventAvailability.fromJson(_map(res.data));
  }

  /// The live price as a function form is filled in — re-fetched on every
  /// change to venue, pax, rate or add-ons, the same as [priceQuote].
  Future<EventQuoteResult> eventQuote(Map<String, dynamic> body) async {
    final res = await _dio.post('/events/quote', data: body);
    return EventQuoteResult.fromJson(_map(res.data));
  }

  /// The diary/list's own fetch, over a date range and optionally narrowed
  /// to a status or venue.
  Future<List<EventBooking>> events({
    String? fromDate,
    String? toDate,
    String? status,
    int? venueId,
    bool includeClosed = false,
  }) async {
    final res = await _dio.get(
      '/events',
      queryParameters: {
        if (fromDate != null) 'fromDate': fromDate,
        if (toDate != null) 'toDate': toDate,
        if (status != null) 'status': status,
        if (venueId != null) 'venueId': venueId,
        'includeClosed': includeClosed,
      },
    );
    return (_map(res.data)['events'] as List? ?? [])
        .map((e) => EventBooking.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<EventBooking> event(int id) async {
    final res = await _dio.get('/events/$id');
    return EventBooking.fromJson(_map(res.data)['event'] as Map<String, dynamic>);
  }

  /// Write down a function enquiry, hold or confirmation. The advance, if
  /// any, is receipted server-side in the same request — see
  /// createEventHandler on the server.
  Future<EventBooking> createEvent(Map<String, dynamic> body) async {
    final res = await _dio.post('/events', data: body);
    return EventBooking.fromJson(_map(res.data)['event'] as Map<String, dynamic>);
  }

  Future<EventBooking> updateEvent(int id, Map<String, dynamic> body) async {
    final res = await _dio.patch('/events/$id', data: body);
    return EventBooking.fromJson(_map(res.data)['event'] as Map<String, dynamic>);
  }

  /// Something asked for on the day — more chairs, a second mic — noted so
  /// it reaches the bill. A price can be typed now or left for later.
  Future<EventBooking> addEventExtra(
    int id, {
    required String label,
    int quantity = 1,
    num? agreedAmount,
  }) async {
    final res = await _dio.post(
      '/events/$id/extras',
      data: {
        'label': label,
        'quantity': quantity,
        if (agreedAmount != null) 'agreedAmount': agreedAmount,
      },
    );
    return EventBooking.fromJson(_map(res.data)['event'] as Map<String, dynamic>);
  }

  Future<EventBooking> priceEventExtra(int id, int lineId, num agreedAmount) async {
    final res = await _dio.patch(
      '/events/$id/extras/$lineId',
      data: {'agreedAmount': agreedAmount},
    );
    return EventBooking.fromJson(_map(res.data)['event'] as Map<String, dynamic>);
  }

  Future<EventBooking> removeEventExtra(int id, int lineId) async {
    final res = await _dio.delete('/events/$id/extras/$lineId');
    return EventBooking.fromJson(_map(res.data)['event'] as Map<String, dynamic>);
  }

  Future<EventBooking> holdEvent(int id, {int holdHours = 48}) async {
    final res = await _dio.patch(
      '/events/$id/hold',
      data: {'holdHours': holdHours},
    );
    return EventBooking.fromJson(_map(res.data)['event'] as Map<String, dynamic>);
  }

  Future<EventBooking> confirmEvent(int id) async {
    final res = await _dio.patch('/events/$id/confirm');
    return EventBooking.fromJson(_map(res.data)['event'] as Map<String, dynamic>);
  }

  Future<EventBooking> releaseEvent(int id) async {
    final res = await _dio.patch('/events/$id/release');
    return EventBooking.fromJson(_map(res.data)['event'] as Map<String, dynamic>);
  }

  Future<EventBooking> cancelEvent(
    int id, {
    required String reason,
    num? refundAmount,
  }) async {
    final res = await _dio.patch(
      '/events/$id/cancel',
      data: {
        'reason': reason,
        if (refundAmount != null) 'refundAmount': refundAmount,
      },
    );
    return EventBooking.fromJson(_map(res.data)['event'] as Map<String, dynamic>);
  }

  /// Every advance receipt written against this function, newest first —
  /// same shape [advanceReceipts] answers for a room stay.
  Future<List<AdvanceReceipt>> eventAdvanceReceipts(int eventId) async {
    final res = await _dio.get('/billing/events/$eventId/advance-receipts');
    return (_map(res.data)['receipts'] as List? ?? [])
        .map((e) => AdvanceReceipt.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Money taken with an existing function — the detail screen's "Take
  /// advance" action, same door AdvanceReceiptModal.jsx uses.
  Future<AdvanceReceipt> issueEventAdvanceReceipt(
    int eventId,
    Map<String, dynamic> body,
  ) async {
    final res = await _dio.post(
      '/billing/events/$eventId/advance-receipt',
      data: body,
    );
    final map = _map(res.data);
    final receipt = map['receipt'];
    return AdvanceReceipt.fromJson(
      receipt is Map<String, dynamic> ? receipt : map,
    );
  }

  /// Dio hands back `dynamic`; every one of these routes answers with an
  /// object. Narrowed in one place so no call site has to cast.
  Map<String, dynamic> _map(dynamic data) {
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return Map<String, dynamic>.from(data);
    throw StateError('Expected an object from the server, got ${data.runtimeType}');
  }
}
