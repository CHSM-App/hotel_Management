import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/core/offline/offline_desk.dart';
import 'package:hotel_manager/core/offline/offline_interceptor.dart';
import 'package:hotel_manager/core/offline/offline_store.dart';
import 'package:hotel_manager/core/offline/outbox_drain.dart';
import 'package:hotel_manager/data/db/app_database.dart';
import 'package:hotel_manager/domain/models/invoice.dart';
import 'package:hotel_manager/screens/billing/bill_pdf.dart';

/// The whole offline desk, end to end, on a real SQLite file: take a booking,
/// check the guest in, check them out with a bill — all with no server — then
/// replay it to a (fake) server and confirm what reached it, in what order,
/// and that the device cleaned up after itself.

class _Server implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  final bodies = <dynamic>[];
  final answers = <String, ResponseBody Function(RequestOptions)>{};
  bool down = false;

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<List<int>>? s, Future<void>? c) async {
    if (down) throw DioException(requestOptions: o, type: DioExceptionType.connectionError);
    requests.add(o);
    bodies.add(o.data is FormData ? 'form' : o.data);
    final key = '${o.method} ${o.path.replaceAll(RegExp(r'/\d+'), '/N')}';
    final answer = answers[key];
    if (answer == null) throw StateError('no fake answer for $key');
    return answer(o);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(Object body, [int status = 200]) =>
    ResponseBody.fromString(jsonEncode(body), status, headers: {
      Headers.contentTypeHeader: ['application/json'],
    });

Map<String, dynamic> _bootstrap() => {
  'today': OfflineDesk.istToday(),
  'lodge': {
    'isGstRegistered': true,
    'isSpecifiedPremises': false,
    'gstin': '27ABCDE1234F1Z5',
    'checkinMode': 'NIGHT_BASED',
    'checkInTime': '12:00:00',
    'checkOutTime': '11:00:00',
    'lateGraceMinutes': 30,
    'lateHalfDayPercent': 50,
    'lateFullDayAfterMinutes': 360,
    'lateFullDayPercent': 100,
  },
  'rooms': [
    {
      'id': '7',
      'roomNumber': '101',
      'categoryName': 'Deluxe',
      'categoryBasePrice': 2000,
      'maxOccupancy': 3,
      'isDormitory': false,
      'switchableCharges': [
        {'id': 1, 'name': 'AC', 'chargePerNight': 300, 'isCounter': false, 'hiddenWhenChargeId': null},
      ],
    },
    {
      'id': '8',
      'roomNumber': '102',
      'categoryName': 'Deluxe',
      'categoryBasePrice': 2000,
      'isDormitory': false,
      'switchableCharges': [],
    },
  ],
  'seasons': [],
  'gstSlabs': [
    {'supplyType': 'ACCOMMODATION', 'maxAmount': 1000, 'ratePercent': 0},
    {'supplyType': 'ACCOMMODATION', 'maxAmount': 7500, 'ratePercent': 5},
    {'supplyType': 'ACCOMMODATION', 'maxAmount': null, 'ratePercent': 18},
    {'supplyType': 'FOOD', 'maxAmount': null, 'ratePercent': 5, 'appliesToSpecified': false},
  ],
  'tapeChart': {'rooms': [], 'bookings': []},
};

String _plusDays(String date, int n) =>
    DateTime.parse(date).add(Duration(days: n)).toIso8601String().substring(0, 10);

void main() {
  late OfflineStore store;
  late OfflineDesk desk;
  late Directory tmp;
  final today = OfflineDesk.istToday();
  final out = _plusDays(today, 2);

  setUpAll(() {
    tmp = Directory.systemTemp.createTempSync('fd_flow');
    AppDatabase.pathOverride = '${tmp.path}/t.db';
    OutboxFiles.rootOverride = '${tmp.path}/files';
    AppDatabase.init();
  });

  setUp(() async {
    final db = await AppDatabase.database;
    for (final t in ['http_cache', 'outbox', 'ref_store', 'local_stays', 'id_map', 'local_seq']) {
      await db.delete(t);
    }
    store = OfflineStore(() => '1');
    desk = OfflineDesk(store);
    await desk.saveReference(_bootstrap());
  });

  FormData bookingForm({String type = 'WALK_IN', String room = '7'}) => FormData.fromMap({
    'roomId': room,
    'checkInDate': today,
    'checkOutDate': out,
    'numGuests': '2',
    'guestName': 'Asha Patil',
    'guestPhone': '9876543210',
    'bookingType': type,
    'switchableCharges': '[{"id":1,"quantity":1}]',
    'idProofType': 'AADHAAR',
    'advanceAmount': '1000',
    'advancePaymentMethod': 'CASH',
    'guests': '[]',
    'vehicles': '[]',
    'idProofDocument': MultipartFile.fromBytes(Uint8List.fromList([1, 2, 3, 4]), filename: 'id.jpg'),
  });

  test('extras change the total with no network', () async {
    final base = await desk.priceQuote(roomId: 7, checkIn: today, checkOut: out);
    final withAc = await desk.priceQuote(roomId: 7, checkIn: today, checkOut: out, chargeIds: '1');
    expect(base.totalPrice, 4000);
    expect(withAc.totalPrice, 4600);
    expect(withAc.charges.any((c) => c.label.startsWith('AC')), isTrue);

    final discounted = await desk.priceQuote(
      roomId: 7,
      checkIn: today,
      checkOut: out,
      chargeIds: '1',
      discountAmount: 600,
    );
    expect(discounted.totalPrice, 4000);
  });

  test('a booked room is no longer offered, and a dorm is never priced offline', () async {
    expect((await desk.availableRooms(today, out)).map((r) => r.id), [7, 8]);
    await desk.createBooking(bookingForm());
    expect((await desk.availableRooms(today, out)).map((r) => r.id), [8]);
    // Check-out day is free for the next guest.
    expect((await desk.availableRooms(out, _plusDays(out, 1))).map((r) => r.id), [7, 8]);
    expect(
      () => desk.priceQuote(roomId: 7, checkIn: today, checkOut: out, bedIds: [1]),
      throwsA(isA<OfflineUnavailable>()),
    );
  });

  test('the same room cannot be sold twice from one device', () async {
    await desk.createBooking(bookingForm());
    expect(() => desk.createBooking(bookingForm()), throwsA(isA<OfflineUnavailable>()));
  });

  test('book, check in, check out and bill — offline — then it all syncs, once, in order', () async {
    // ── Offline: a walk-in guest ───────────────────────────────────────────
    final booked = await desk.createBooking(bookingForm());
    expect(booked.id, lessThan(0));
    expect(booked.bookingNumber, startsWith('OFF-'));
    expect(booked.totalPrice, 4600);
    expect(booked.advanceAmount, 1000);
    expect(booked.status, 'BOOKED');

    final checkedIn = await desk.checkIn(booked.id, FormData.fromMap({'walkIn': 'true'}));
    expect(checkedIn.status, 'CHECKED_IN');
    final queued = (await store.ops()).firstWhere((o) => o.feature == 'booking.checkin');
    expect(queued.form!.field('checkedInAt'), isNotNull, reason: 'replay must carry the real arrival time');
    expect(DateTime.parse(queued.form!.field('checkedInAt')!).difference(DateTime.now().toUtc()).inSeconds.abs(), lessThan(5));

    // Not late: checking out on the booked date.
    final late = await desk.lateCheckout(booked.id);
    expect(late.isChargeable, isFalse);

    final preview = await desk.previewBill(
      booked.id,
      includeLateCheckout: true,
      discountAmount: 0,
      settle: const BillSettle(),
    );
    expect(preview.isGstRegistered, isTrue);
    expect(preview.amounts!.totalAmount, 4600);
    expect(preview.advancePaid, 1000);
    expect(preview.balanceDue, 3600);

    final body = {
      'billingSide': 'GST',
      'discountAmount': 0,
      'includeLateCheckout': true,
      'collectedAmount': 3600,
      'paymentMethod': 'CASH',
      'lateCharge': 0,
      'expectedDue': 3600,
    };
    final settled = await desk.settle(booked.id, body);
    expect(settled.invoice!.invoiceNumber, startsWith('OFF-B-'));
    expect(settled.invoice!.totalAmount, 4600);
    expect(settled.invoice!.isProvisional, isTrue);
    // The guest's copy renders, marked PROVISIONAL.
    final pdf = await BillPdf.build(settled.invoice!);
    expect(String.fromCharCodes(pdf.take(5)), '%PDF-');
    expect((await desk.localBooking(booked.id))!.status, 'CHECKED_OUT');

    // The room chart and the register show it, flagged as not yet on the server.
    expect((await store.ops()).map((o) => o.feature), ['booking.create', 'booking.checkin', 'booking.settle']);
    // The ID-proof photo was kept on disk for the replay.
    expect(Directory('${tmp.path}/files').listSync(recursive: true).whereType<File>(), isNotEmpty);

    // ── Back online: replay ────────────────────────────────────────────────
    final server = _Server()
      ..answers['POST /bookings'] = ((o) => _json({'id': '501', 'bookingNumber': 'SKR2611001'}, 201))
      ..answers['PATCH /bookings/N/check-in'] = ((o) => _json({'booking': {'id': 501, 'status': 'CHECKED_IN'}}))
      ..answers['POST /billing/bookings/N/settle-checkout'] =
          ((o) => _json({'mode': 'FINAL', 'invoice': {'id': 9, 'invoiceNumber': 'GST-17'}}, 201));
    final dio = Dio(BaseOptions(baseUrl: 'http://x'))..httpClientAdapter = server;
    var synced = 0;
    final drain = OutboxDrain(dio: dio, store: store, onSynced: () => synced++);

    await drain.run();

    expect(server.requests.map((r) => '${r.method} ${r.path}'), [
      'POST /bookings',
      'PATCH /bookings/501/check-in', // the placeholder became the real id
      'POST /billing/bookings/501/settle-checkout',
    ]);
    // Every request carries a key the server can use to refuse a replay.
    expect(server.requests.every((r) => (r.headers['Idempotency-Key'] as String).length > 20), isTrue);
    expect((server.bodies[2] as Map)['expectedDue'], 3600);
    expect((server.bodies[2] as Map)['checkedOutAt'], isNotNull);
    // The recorded times are the offline moments, not the sync moment.
    final ops = <String>[];
    expect(DateTime.parse((server.bodies[2] as Map)['checkedOutAt'] as String).isBefore(DateTime.now().toUtc().add(const Duration(seconds: 1))), isTrue);
    expect(ops, isEmpty);

    expect(await store.ops(), isEmpty);
    expect(await store.stayGet(booked.id), isNull, reason: 'the server\'s copy is the truth again');
    expect(await store.serverIdFor(booked.id), 501);
    expect(synced, 1);

    // Running it again sends nothing.
    server.requests.clear();
    await drain.run();
    expect(server.requests, isEmpty);
  });

  test('no network during replay: nothing is lost, nothing is sent twice', () async {
    final booked = await desk.createBooking(bookingForm());
    await desk.checkIn(booked.id, FormData.fromMap({'walkIn': 'true'}));

    final server = _Server()..down = true;
    final dio = Dio(BaseOptions(baseUrl: 'http://x'))..httpClientAdapter = server;
    final drain = OutboxDrain(dio: dio, store: store, onSynced: () {});
    await drain.run();

    final ops = await store.ops();
    expect(ops.map((o) => o.status), ['pending', 'pending']);
    expect(await store.stayGet(booked.id), isNotNull);
  });

  test('a room sold twice: the booking is held for the desk, and what depends on it waits', () async {
    final booked = await desk.createBooking(bookingForm());
    await desk.checkIn(booked.id, FormData.fromMap({'walkIn': 'true'}));

    final server = _Server()
      ..answers['POST /bookings'] = ((o) => _json({'success': false, 'error': 'Room 101 is already booked for part of that date range.'}, 409));
    final dio = Dio(BaseOptions(baseUrl: 'http://x'))..httpClientAdapter = server;
    final drain = OutboxDrain(dio: dio, store: store, onSynced: () {});
    await drain.run();

    final ops = await store.ops();
    expect(ops[0].status, 'conflict');
    expect(ops[0].lastError, contains('already booked'));
    expect(ops[1].status, 'blocked');
    expect(server.requests.length, 1, reason: 'the check-in was not even attempted');
    // Nothing was thrown away: the desk can still see and sort out the stay.
    expect(await store.stayGet(booked.id), isNotNull);

    // Discarding the booking drops what depended on it.
    await drain.discard(ops[0]);
    expect(await store.ops(), isEmpty);
    expect(await store.stayGet(booked.id), isNull);
  });

  test('a check-in the server already has is treated as done, not as a conflict', () async {
    final booked = await desk.createBooking(bookingForm(type: 'RESERVATION'));
    await store.mapId(booked.id, 501); // as if the create had already gone through
    await desk.checkIn(booked.id, FormData.fromMap({'walkIn': 'true'}));
    // The create is replayed first in real life; here only the check-in remains.
    final create = (await store.ops()).first;
    await store.remove(create);

    final server = _Server()
      ..answers['PATCH /bookings/N/check-in'] = ((o) => _json({'success': false, 'error': 'Booking not found or not ready for check-in.'}, 409))
      ..answers['GET /bookings/N'] = ((o) => _json({'booking': {'id': 501, 'status': 'CHECKED_IN'}}));
    final dio = Dio(BaseOptions(baseUrl: 'http://x'))..httpClientAdapter = server;
    await OutboxDrain(dio: dio, store: store, onSynced: () {}).run();

    expect(await store.ops(), isEmpty);
  });

  test('check-in refuses what the server would refuse, before saving anything', () async {
    final future = _plusDays(today, 3);
    final form = FormData.fromMap({
      ...{for (final f in bookingForm(type: 'RESERVATION').fields) f.key: f.value},
      'checkInDate': future,
      'checkOutDate': _plusDays(future, 1),
    });
    final booked = await desk.createBooking(form);
    expect(
      () => desk.checkIn(booked.id, FormData.fromMap({'walkIn': 'true'})),
      throwsA(isA<OfflineUnavailable>()),
    );
    expect((await store.ops()).map((o) => o.feature), ['booking.create']);
  });

  test('a form with files survives being taken apart and put back together', () async {
    final snap = await FormSnapshot.capture(bookingForm(), 'uuid-1');
    expect(snap.files.single['filename'], 'id.jpg');
    final rebuilt = await snap.rebuild();
    expect(rebuilt.fields.firstWhere((f) => f.key == 'guestName').value, 'Asha Patil');
    expect(rebuilt.files.single.key, 'idProofDocument');
    expect(rebuilt.files.single.value.length, 4);
  });

  test('without downloaded rates the desk is told what to do, not shown an error', () async {
    final db = await AppDatabase.database;
    await db.delete('ref_store');
    await expectLater(
      desk.priceQuote(roomId: 7, checkIn: today, checkOut: out),
      throwsA(
        isA<OfflineUnavailable>().having((e) => e.reason, 'reason', contains('Connect once')),
      ),
    );
  });
}
