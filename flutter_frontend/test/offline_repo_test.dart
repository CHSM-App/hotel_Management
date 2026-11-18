import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/core/offline/offline_desk.dart';
import 'package:hotel_manager/core/offline/offline_interceptor.dart';
import 'package:hotel_manager/core/offline/offline_store.dart';
import 'package:hotel_manager/data/api/api_service.dart';
import 'package:hotel_manager/data/db/app_database.dart';
import 'package:hotel_manager/data/repositories/billing_impl.dart';
import 'package:hotel_manager/data/repositories/booking_impl.dart';
import 'package:hotel_manager/domain/models/invoice.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart' show ConflictAlgorithm;

/// The same offline desk, but entered the way the app enters it: through the
/// repositories, the generated API and the real interceptor chain — so what is
/// being checked is the wiring (an offline write is refused by the interceptor,
/// caught by the repository, and handed to the device), not only the engine.

class _Net implements HttpClientAdapter {
  final seen = <RequestOptions>[];
  bool down = false;
  ResponseBody Function(RequestOptions)? onRequest;

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<List<int>>? s, Future<void>? c) async {
    seen.add(o);
    if (down) throw DioException(requestOptions: o, type: DioExceptionType.connectionError);
    final answer = onRequest;
    if (answer == null) throw StateError('unexpected request ${o.method} ${o.path}');
    return answer(o);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(Object body, [int status = 200]) =>
    ResponseBody.fromString(jsonEncode(body), status, headers: {
      Headers.contentTypeHeader: ['application/json'],
    });

String _plus(String d, int n) => DateTime.parse(d).add(Duration(days: n)).toIso8601String().substring(0, 10);

void main() {
  final today = OfflineDesk.istToday();
  final out = _plus(today, 2);
  late OfflineStore store;
  late OfflineDesk desk;
  late _Net net;
  late BookingImpl bookings;
  late BillingImpl billing;
  var offline = false;

  setUpAll(() {
    final tmp = Directory.systemTemp.createTempSync('fd_repo');
    AppDatabase.pathOverride = '${tmp.path}/t.db';
    OutboxFiles.rootOverride = '${tmp.path}/files';
    AppDatabase.init();
  });

  setUp(() async {
    final db = await AppDatabase.database;
    for (final t in ['http_cache', 'outbox', 'ref_store', 'local_stays', 'id_map', 'local_seq']) {
      await db.delete(t);
    }
    offline = false;
    store = OfflineStore(() => '1');
    desk = OfflineDesk(store);
    await desk.saveReference({
      'today': today,
      'lodge': {
        'isGstRegistered': true,
        'checkinMode': 'NIGHT_BASED',
        'checkInTime': '12:00:00',
        'checkOutTime': '11:00:00',
        'lateGraceMinutes': 30,
      },
      'rooms': [
        {
          'id': '7',
          'roomNumber': '101',
          'categoryName': 'Deluxe',
          'categoryBasePrice': 2000,
          'isDormitory': false,
          'switchableCharges': [
            {'id': 1, 'name': 'AC', 'chargePerNight': 300},
          ],
        },
      ],
      'seasons': [],
      'gstSlabs': [
        {'supplyType': 'ACCOMMODATION', 'maxAmount': 7500, 'ratePercent': 5},
        {'supplyType': 'ACCOMMODATION', 'maxAmount': null, 'ratePercent': 18},
      ],
      'tapeChart': {
        'rooms': [
          {'id': '7', 'roomNumber': '101', 'categoryName': 'Deluxe'},
        ],
        'bookings': [],
      },
    });

    net = _Net();
    final dio = Dio(BaseOptions(baseUrl: 'http://x'))
      ..httpClientAdapter = net
      ..interceptors.add(OfflineInterceptor(isOffline: () => offline, scope: () => '1'));
    final api = ApiService(dio);
    bookings = BookingImpl(api, desk);
    billing = BillingImpl(api, desk);
  });

  FormData form() => FormData.fromMap({
    'roomId': '7',
    'checkInDate': today,
    'checkOutDate': out,
    'numGuests': '2',
    'guestName': 'Asha Patil',
    'guestPhone': '9876543210',
    'bookingType': 'RESERVATION',
    'switchableCharges': '[{"id":1,"quantity":1}]',
    'idProofType': 'AADHAAR',
    'guests': '[]',
    'vehicles': '[]',
    'idProofDocument': MultipartFile.fromBytes(Uint8List.fromList([9, 9]), filename: 'id.jpg'),
  });

  test('offline: rooms, then a quote that moves with the extras — no request ever leaves the phone', () async {
    offline = true;
    final rooms = await bookings.availableRooms(today, out);
    expect(rooms.map((r) => r.roomNumber), ['101']);

    final plain = await bookings.priceQuote(roomId: 7, checkInDate: today, checkOutDate: out);
    final withAc = await bookings.priceQuote(roomId: 7, checkInDate: today, checkOutDate: out, chargeIds: '1');
    expect(plain.totalPrice, 4000);
    expect(withAc.totalPrice, 4600);
    expect(net.seen, isEmpty);
  });

  test('offline: a booking is saved here, shows on the chart and in the register, and is queued', () async {
    offline = true;
    final booked = await bookings.createBooking(form());
    expect(booked.id, lessThan(0));
    expect(booked.offlinePending, isTrue);

    final chart = await bookings.tapeChart(startDate: today, endDate: out);
    expect(chart.bookings.where((b) => b.id == booked.id), hasLength(1));
    // The room is taken now.
    expect(await bookings.availableRooms(today, out), isEmpty);
    expect((await bookings.booking(booked.id)).guestName, 'Asha Patil');
    expect((await store.ops()).single.feature, 'booking.create');
    expect(net.seen, isEmpty);
  });

  test('offline: the register and the drafts list still open', () async {
    offline = true;
    await bookings.createBooking(form());
    final register = await bookings.bookings(fromDate: today, toDate: out);
    expect(register.map((b) => b.guestName), ['Asha Patil']);
    expect(await bookings.drafts(), isEmpty);
  });

  test('online: the key goes with the request and nothing is queued', () async {
    net.onRequest = (o) => _json({'id': '77', 'bookingNumber': 'SKR2611001'}, 201);
    final booked = await bookings.createBooking(form());
    expect(booked.id, 77);
    expect((net.seen.single.headers['Idempotency-Key'] as String).length, greaterThan(20));
    expect(await store.ops(), isEmpty);
    expect(await store.staysAll(), isEmpty);
  });

  test('online, but the reply never came: the SAME key is what gets queued, so it cannot become two bookings', () async {
    net.down = true; // a transport failure after the request was attempted
    final booked = await bookings.createBooking(form());
    expect(booked.id, lessThan(0));
    final sentKey = net.seen.single.headers['Idempotency-Key'];
    expect((await store.ops()).single.clientUuid, sentKey);
  });

  test('a real refusal from the server is shown to the desk, never replaced by a local guess', () async {
    net.onRequest = (o) => _json({'success': false, 'error': 'Room 101 is already booked for part of that date range.'}, 409);
    await expectLater(
      bookings.createBooking(form()),
      throwsA(isA<DioException>().having((e) => e.response?.statusCode, 'status', 409)),
    );
    expect(await store.ops(), isEmpty, reason: 'nothing queued for something the server declined');
  });

  test('a booking the server already has: check in, check out and bill it — offline', () async {
    // What the app downloaded earlier: the server's own copy, in the HTTP cache.
    final db = await AppDatabase.database;
    await db.insert('http_cache', {
      'scope': '1',
      'url': '/bookings/12',
      'fetched_at': DateTime.now().toIso8601String(),
      'body': jsonEncode({
        'booking': {
          'id': '12',
          'bookingNumber': 'SKR2611012',
          'guestName': 'Ravi Kale',
          'guestPhone': '9000000000',
          'status': 'BOOKED',
          'checkInDate': today,
          'checkOutDate': out,
          'roomId': '7',
          'roomNumber': '101',
          'categoryName': 'Deluxe',
          'totalPrice': 4000,
          'advanceAmount': 500,
          'idProofType': 'AADHAAR',
          'foodOrders': [],
          'serviceUsages': [],
          'rooms': [
            {
              'bookingRoomId': '30',
              'roomId': '7',
              'roomNumber': '101',
              'status': 'BOOKED',
              'checkInDate': today,
              'checkOutDate': out,
              'totalPrice': 4000,
              'roomCharges': [
                {'label': 'Deluxe ₹2,000', 'amount': 4000, 'nights': 2},
              ],
              'nights': [
                {'date': today, 'amount': 2000},
                {'date': _plus(today, 1), 'amount': 2000},
              ],
            },
          ],
        },
      }),
    }, conflictAlgorithm: ConflictAlgorithm.replace);

    offline = true;

    final checkedIn = await bookings.checkIn(12, FormData.fromMap({'walkIn': 'true'}));
    expect(checkedIn.status, 'CHECKED_IN');
    // The detail screen reads it back as checked in, flagged as not yet synced.
    final again = await bookings.booking(12);
    expect(again.status, 'CHECKED_IN');
    expect(again.offlinePending, isTrue);

    final late = await bookings.lateCheckout(12);
    expect(late.isChargeable, isFalse);

    final preview = await billing.preview(12, settle: const BillSettle());
    expect(preview.amounts!.totalAmount, 4000);
    expect(preview.balanceDue, 3500);

    final result = await billing.settle(12, {
      'billingSide': 'GST',
      'discountAmount': 0,
      'includeLateCheckout': true,
      'collectedAmount': 3500,
      'paymentMethod': 'UPI',
      'paymentReference': 'UTR1',
      'lateCharge': 0,
      'expectedDue': 3500,
    });
    expect(result.invoice!.isProvisional, isTrue);
    expect(result.invoice!.totalAmount, 4000);
    expect((await bookings.booking(12)).status, 'CHECKED_OUT');

    expect((await store.ops()).map((o) => o.feature), ['booking.checkin', 'booking.settle']);
    expect(net.seen.where((r) => r.method != 'GET'), isEmpty, reason: 'no write left the phone');
  });

  test('a booking never downloaded can\'t be checked in offline — and says what to do', () async {
    offline = true;
    await expectLater(
      bookings.checkIn(999, FormData.fromMap({'walkIn': 'true'})),
      throwsA(isA<OfflineUnavailable>().having((e) => e.reason, 'reason', contains('once while connected'))),
    );
    expect(await store.ops(), isEmpty);
  });
}
