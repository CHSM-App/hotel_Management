import 'package:dio/dio.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/invoice.dart';
import '../../domain/models/late_checkout.dart';
import '../../domain/models/me.dart';
import '../../domain/models/quote.dart';
import '../../domain/models/room.dart';
import '../../domain/models/session.dart';

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

  // ===== SESSION =====

  /// Who is signed in, and what this property is.
  Future<Me> me() async {
    final res = await _dio.get('/me');
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

  /// The register.
  Future<List<Booking>> bookings({
    String? status,
    String? fromDate,
    String? toDate,
  }) async {
    final res = await _dio.get(
      '/bookings',
      queryParameters: {
        if (status != null) 'status': status,
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

  Future<Booking> cancelBooking(int id, Map<String, dynamic> body) async {
    final res = await _dio.patch('/bookings/$id/cancel', data: body);
    return Booking.fromJson(_map(res.data)['booking'] as Map<String, dynamic>);
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
  }) async {
    final res = await _dio.get(
      '/billing/bookings/$bookingId/preview',
      queryParameters: {'includeLateCheckout': includeLateCheckout},
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

  /// Dio hands back `dynamic`; every one of these routes answers with an
  /// object. Narrowed in one place so no call site has to cast.
  Map<String, dynamic> _map(dynamic data) {
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return Map<String, dynamic>.from(data);
    throw StateError('Expected an object from the server, got ${data.runtimeType}');
  }
}
