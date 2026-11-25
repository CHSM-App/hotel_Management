import 'dart:convert';

import 'package:dio/dio.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/invoice.dart';
import '../../domain/models/late_checkout.dart';
import '../../domain/models/quote.dart';
import '../../domain/models/room.dart';
import '../../domain/models/tape_chart.dart';
import '../../domain/pricing/bill_pricing.dart';
import '../../domain/pricing/late_checkout_calc.dart';
import '../../domain/pricing/stay_pricing.dart';
import 'offline_interceptor.dart';
import 'offline_store.dart';
import 'reference_data.dart';

/// The front desk with no network.
///
/// Everything the booking, check-in, check-out and billing screens ask of the
/// server, answered from what the device downloaded (see [ReferenceData]) and
/// what it has done itself since (see [OfflineStore.stayGet]) — and every
/// action recorded so it can be replayed to the server, in order, when the
/// network is back.
///
/// Availability and prices worked out here are advisory: the server stays the
/// authority. A room sold twice by two devices that were both offline is
/// caught when the second one syncs and handed to the desk to sort out, and a
/// bill the server would price differently is held rather than issued.
///
/// Scope is the common path — one ordinary room per booking. Dormitory beds and
/// multi-room bookings throw [OfflineUnavailable] with a plain reason, so the
/// screen says what needs a connection instead of showing an error.
class OfflineDesk {
  final OfflineStore store;
  OfflineDesk(this.store);

  // ── Reference data ───────────────────────────────────────────────────────

  Future<ReferenceData?> reference() async {
    final m = await store.refGet('bootstrap');
    if (m == null) return null;
    return ReferenceData.fromJson(m, fetchedAt: m['_fetchedAt'] as String?);
  }

  Future<void> saveReference(Map<String, dynamic> bootstrap) =>
      store.refPut('bootstrap', {...bootstrap, '_fetchedAt': DateTime.now().toIso8601String()});

  Future<ReferenceData> _need() async {
    final ref = await reference();
    if (ref == null) {
      throw OfflineUnavailable.because(
        'Connect once to download the rooms and rates, then this works offline.',
      );
    }
    return ref;
  }

  static String istToday() =>
      DateTime.now().toUtc().add(const Duration(minutes: 330)).toIso8601String().substring(0, 10);

  static String _nowIso() => DateTime.now().toUtc().toIso8601String();

  // ── Reading: rooms, prices, the chart ────────────────────────────────────

  /// Every ordinary room with nothing on it across [checkIn, checkOut).
  /// Advisory: built from the downloaded chart plus whatever this device has
  /// booked since, so a room another device sold meanwhile is only caught at sync.
  Future<List<Room>> availableRooms(String checkIn, String? checkOutDate) async {
    final checkOut = checkOutDate ?? _openEnd;
    final ref = await _need();
    final held = await _heldRanges(ref);
    final out = <Room>[];
    for (final json in ref.roomsJson) {
      final room = Room.fromJson(json);
      // Beds are sold one at a time and need the server's per-bed answer.
      if (room.isDormitory) continue;
      final taken = held.any(
        (h) => h.roomId == room.id && h.checkIn.compareTo(checkOut) < 0 && h.checkOut.compareTo(checkIn) > 0,
      );
      if (!taken) out.add(room);
    }
    return out;
  }

  /// What an open-ended stay (no check-out date yet) holds its room until: the
  /// far future, so it blocks the room exactly as the server's own checks do.
  static const _openEnd = '9999-12-31';

  /// A stored check-out date, or [_openEnd] when the stay has none.
  static String _endOf(Object? v) {
    final t = '$v';
    return v == null || t == 'null' || t.isEmpty ? _openEnd : t.substring(0, 10);
  }

  static const _openStayNeedsConnection =
      'Stays with no check-out date need a connection to be booked or closed.';

  Future<List<({int roomId, String checkIn, String checkOut})>> _heldRanges(ReferenceData ref) async {
    final stays = await store.staysAll();
    final localIds = {for (final s in stays) _id(s)};
    final out = <({int roomId, String checkIn, String checkOut})>[];

    for (final b in (ref.chart['bookings'] as List? ?? const [])) {
      final m = b as Map;
      if (localIds.contains(int.tryParse('${m['id']}'))) continue;
      final status = '${m['status']}';
      if (status != 'BOOKED' && status != 'CHECKED_IN') continue;
      out.add((
        roomId: int.parse('${m['roomId']}'),
        checkIn: '${m['checkInDate']}'.substring(0, 10),
        checkOut: _endOf(m['checkOutDate']),
      ));
    }
    for (final s in stays) {
      for (final r in _rooms(s)) {
        final status = '${r['status']}';
        if (status != 'BOOKED' && status != 'CHECKED_IN') continue;
        out.add((
          roomId: int.parse('${r['roomId']}'),
          checkIn: '${r['checkInDate'] ?? s['checkInDate']}'.substring(0, 10),
          checkOut: _endOf(r['checkOutDate'] ?? s['checkOutDate']),
        ));
      }
    }
    return out;
  }

  Future<Quote> priceQuote({
    required int roomId,
    required String checkIn,
    required String? checkOut,
    String? chargeIds,
    num? basePriceOverride,
    num? discountAmount,
    List<int>? bedIds,
  }) async {
    if (checkOut == null) throw OfflineUnavailable.because(_openStayNeedsConnection);
    final ref = await _need();
    if (bedIds != null && bedIds.isNotEmpty) {
      throw OfflineUnavailable.because('Dormitory beds can\'t be priced offline.');
    }
    return _quote(
      ref,
      roomId,
      checkIn,
      checkOut,
      parseChargeSelections(chargeIds),
      basePriceOverride,
      discountAmount ?? 0,
    );
  }

  Quote _quote(
    ReferenceData ref,
    int roomId,
    String checkIn,
    String checkOut,
    List<ChargePick> picks,
    num? basePriceOverride,
    num discount,
  ) {
    final room = ref.roomJson(roomId);
    if (room == null) throw OfflineUnavailable.because('That room isn\'t in the downloaded rate list.');
    if (room['isDormitory'] == true) {
      throw OfflineUnavailable.because('Dormitory bookings need a connection.');
    }
    try {
      return StayPricing.quote(
        categoryName: room['categoryName']?.toString() ?? '',
        categoryBasePrice: (room['categoryBasePrice'] as num?) ?? 0,
        seasons: ref.seasons,
        charges: ref.chargesOf(room),
        selections: picks,
        checkIn: checkIn,
        checkOut: checkOut,
        basePriceOverride: basePriceOverride,
        discount: discount,
      );
    } on PricingUnsupported catch (e) {
      throw OfflineUnavailable.because(e.message);
    }
  }

  /// The room chart when the network can't supply one for these dates: the
  /// window downloaded earlier.
  Future<TapeChartData> chartFromReference() async {
    final ref = await _need();
    return TapeChartData.fromJson(ref.chart);
  }

  // ── Stays this device has changed ────────────────────────────────────────

  static int _id(Map<String, dynamic> stay) => int.parse('${stay['id']}');

  static List<Map<String, dynamic>> _rooms(Map<String, dynamic> stay) => [
    for (final r in (stay['rooms'] as List? ?? const []))
      if ((r as Map)['status'] != 'CANCELLED') r.cast<String, dynamic>(),
  ];

  Future<Booking?> localBooking(int id) async {
    final raw = await store.stayGet(id);
    return raw == null ? null : Booking.fromJson(raw);
  }

  /// The chart with this device's own changes laid over it.
  Future<TapeChartData> overlayChart(TapeChartData base) async {
    final stays = await store.staysAll();
    if (stays.isEmpty) return base;
    final mine = {for (final s in stays) _id(s)};
    final bookings = [
      for (final b in base.bookings)
        if (!mine.contains(b.id)) b,
    ];
    for (final s in stays) {
      if (s['status'] == 'CANCELLED') continue;
      for (final r in _rooms(s)) {
        bookings.add(
          TapeChartBooking.fromJson({
            'id': s['id'],
            'roomId': r['roomId'],
            'guestName': s['guestName'],
            'guestPhone': s['guestPhone'],
            'bookingNumber': s['bookingNumber'],
            'checkInDate': r['checkInDate'] ?? s['checkInDate'],
            'checkOutDate': r['checkOutDate'] ?? s['checkOutDate'],
            'status': r['status'] ?? s['status'],
            'totalPrice': r['totalPrice'] ?? s['totalPrice'],
          }),
        );
      }
    }
    return TapeChartData(rooms: base.rooms, bookings: bookings, cancelled: base.cancelled, drafts: base.drafts);
  }

  /// The register when the network can't supply it: the stays on the
  /// downloaded chart, in the dates asked for.
  Future<List<Booking>> bookingsFromReference(String? from, String? to) async {
    final ref = await _need();
    final numbers = {
      for (final r in (ref.chart['rooms'] as List? ?? const [])) '${(r as Map)['id']}': r['roomNumber'],
    };
    return [
      for (final b in (ref.chart['bookings'] as List? ?? const []))
        if (_overlaps(b as Map, from, to))
          Booking.fromJson({...b.cast<String, dynamic>(), 'roomNumber': numbers['${b['roomId']}']}),
    ];
  }

  /// The little the downloaded chart knows about one stay (guest, room, dates,
  /// status) — shown when its full record was never saved on this device.
  Future<Booking?> bookingFromReference(int id) async {
    final ref = await _need();
    final numbers = {
      for (final r in (ref.chart['rooms'] as List? ?? const [])) '${(r as Map)['id']}': r['roomNumber'],
    };
    for (final b in (ref.chart['bookings'] as List? ?? const [])) {
      if ((b as Map)['id'].toString() == '$id') {
        return Booking.fromJson({...b.cast<String, dynamic>(), 'roomNumber': numbers['${b['roomId']}']});
      }
    }
    return null;
  }

  static bool _overlaps(Map b, String? from, String? to) {
    final inDate = '${b['checkInDate']}'.substring(0, 10);
    final outDate = _endOf(b['checkOutDate']);
    if (to != null && inDate.compareTo(to) > 0) return false;
    if (from != null && outDate.compareTo(from) < 0) return false;
    return true;
  }

  Future<List<Booking>> overlayBookings(List<Booking> base) async {
    final stays = await store.staysAll();
    if (stays.isEmpty) return base;
    final mine = {for (final s in stays) _id(s): Booking.fromJson(s)};
    return [
      for (final b in base) mine.remove(b.id) ?? b,
      ...mine.values,
    ];
  }

  /// A booking made on this device: priced and saved here, queued to be sent.
  Future<Booking> createBooking(FormData form, {String? key}) async =>
      createBookingFrom(await FormSnapshot.capture(form, key ?? newUuid()), key: key);

  Future<Booking> createBookingFrom(FormSnapshot snap, {String? key}) async {
    final ref = await _need();
    final f = {for (final e in snap.fields) e[0]: e[1]};
    if (f.containsKey('rooms')) {
      throw OfflineUnavailable.because('Bookings with several rooms need a connection.');
    }
    if (f.containsKey('bedIds')) {
      throw OfflineUnavailable.because('Dormitory beds can\'t be booked offline.');
    }
    final roomId = int.parse(f['roomId'] ?? '0');
    final checkIn = f['checkInDate']!;
    final checkOut = f['checkOutDate'];
    if (checkOut == null || checkOut.isEmpty) {
      throw OfflineUnavailable.because(_openStayNeedsConnection);
    }

    final picks = <ChargePick>[
      for (final c in (_jsonList(f['switchableCharges'])))
        ChargePick(
          int.parse('${c['id']}'),
          int.parse('${c['quantity'] ?? 1}'),
          c['agreedAmount'] == null ? null : double.tryParse('${c['agreedAmount']}'),
        ),
    ];
    final quote = _quote(
      ref,
      roomId,
      checkIn,
      checkOut,
      picks,
      num.tryParse(f['basePriceOverride'] ?? ''),
      num.tryParse(f['discountAmount'] ?? '') ?? 0,
    );

    // The same room cannot be sold twice from one device either.
    final held = await _heldRanges(ref);
    if (held.any((h) => h.roomId == roomId && h.checkIn.compareTo(checkOut) < 0 && h.checkOut.compareTo(checkIn) > 0)) {
      throw OfflineUnavailable.because('That room is already booked for part of that date range.');
    }

    final room = ref.roomJson(roomId)!;
    final seq = await store.nextSeq('booking');
    final localId = -seq;
    final number = 'OFF-${seq.toString().padLeft(4, '0')}';

    final advance = num.tryParse(f['advanceAmount'] ?? '') ?? 0;
    final lines = _jsonList(f['advanceLines']);
    final nights = [for (final n in quote.nights) {'date': n.date, 'amount': n.total}];
    final roomCharges = [
      for (final c in quote.charges) {'label': c.label, 'amount': c.amount, 'nights': nights.length},
    ];
    final raw = <String, dynamic>{
      'id': localId,
      'bookingNumber': number,
      'roomId': roomId,
      'roomNumber': room['roomNumber'],
      'categoryName': room['categoryName'],
      'guestName': f['guestName'],
      'guestPhone': f['guestPhone'],
      'numGuests': int.tryParse(f['numGuests'] ?? '') ?? 1,
      'checkInDate': checkIn,
      'checkOutDate': checkOut,
      'status': 'BOOKED',
      'bookingType': f['bookingType'],
      'totalPrice': quote.totalPrice,
      'discountAmount': quote.discountAmount,
      'advanceAmount': advance == 0 ? null : advance,
      'advancePaymentMethod': f['advancePaymentMethod'],
      'advanceReference': f['advanceReference'],
      'advancePaymentLines': lines.isNotEmpty
          ? lines
          : (advance > 0 ? [{'method': f['advancePaymentMethod'], 'amount': advance}] : []),
      'idProofType': f['idProofType'],
      'idProofNumber': f['idProofNumber'],
      'basePriceOverride': num.tryParse(f['basePriceOverride'] ?? ''),
      'guests': _jsonList(f['guests']),
      'vehicles': _jsonList(f['vehicles']),
      'roomCharges': roomCharges,
      'foodOrders': <dynamic>[],
      'serviceUsages': <dynamic>[],
      'hasIssuedInvoice': false,
      'offlinePending': true,
      'rooms': [
        {
          'bookingRoomId': localId,
          'roomId': roomId,
          'roomNumber': room['roomNumber'],
          'categoryName': room['categoryName'],
          'maxOccupancy': room['maxOccupancy'],
          'isDormitory': false,
          'checkInDate': checkIn,
          'checkOutDate': checkOut,
          'status': 'BOOKED',
          'totalPrice': quote.totalPrice,
          'discountAmount': quote.discountAmount,
          'grossTotalPrice': quote.grossTotal,
          'roomCharges': roomCharges,
          'nights': nights,
          'lateCheckoutCharge': 0,
        },
      ],
    };

    await store.stayPut(localId, raw);
    await store.enqueue(
      feature: 'booking.create',
      method: 'POST',
      path: '/bookings',
      snapshot: snap,
      clientUuid: key,
      meta: {'bookingRef': localId, 'guestName': f['guestName']},
    );
    return Booking.fromJson(raw);
  }

  /// Check a guest in — a booking made here, or one the server already knows
  /// and this device has cached.
  Future<Booking> checkIn(int id, FormData form, {Map<String, dynamic>? cachedRaw, String? key}) async =>
      checkInFrom(id, await FormSnapshot.capture(form, key ?? newUuid()), cachedRaw: cachedRaw, key: key);

  Future<Booking> checkInFrom(int id, FormSnapshot snapIn, {Map<String, dynamic>? cachedRaw, String? key}) async {
    var snap = snapIn;
    final raw = await store.stayGet(id) ?? cachedRaw;
    if (raw == null) {
      throw OfflineUnavailable.because('Open this booking once while connected, then it can be checked in offline.');
    }
    final f = {for (final e in snap.fields) e[0]: e[1]};
    final stay = Map<String, dynamic>.from(raw);

    final status = '${stay['status']}';
    if (status == 'CHECKED_IN') return Booking.fromJson(stay);
    if (status != 'BOOKED') {
      throw OfflineUnavailable.because('This booking is not ready for check-in.');
    }
    // The same rules the server applies at check-in, so a guest is not checked
    // in here only to be refused when it syncs.
    final checkInDate = '${stay['checkInDate']}'.substring(0, 10);
    if (checkInDate.compareTo(istToday()) > 0) {
      throw OfflineUnavailable.because('This booking is for a future date — check-in opens on the reserved date.');
    }
    final hasIdType = (stay['idProofType'] != null && '${stay['idProofType']}'.isNotEmpty) || (f['idProofType']?.isNotEmpty ?? false);
    if (!hasIdType) throw OfflineUnavailable.because('Choose the ID proof type to check in.');

    final now = _nowIso();
    // The moment the guest really arrived. Sent with the replay so the server
    // records it, not the time the connection came back.
    snap = FormSnapshot([...snap.fields.where((x) => x[0] != 'checkedInAt'), ['checkedInAt', now]], snap.files);
    stay['status'] = 'CHECKED_IN';
    stay['actualCheckInAt'] = now;
    stay['rooms'] = [
      for (final r in (stay['rooms'] as List? ?? const []))
        {
          ...(r as Map).cast<String, dynamic>(),
          if (r['status'] == 'BOOKED') ...{'status': 'CHECKED_IN', 'actualCheckInAt': now},
        },
    ];
    if (f['idProofType'] != null) stay['idProofType'] = f['idProofType'];
    if (f['idProofNumber'] != null) stay['idProofNumber'] = f['idProofNumber'];
    final more = num.tryParse(f['advanceAmount'] ?? '') ?? 0;
    if (more > 0) {
      stay['advanceAmount'] = ((stay['advanceAmount'] as num?) ?? 0) + more;
      stay['advancePaymentMethod'] ??= f['advancePaymentMethod'];
    }
    stay['offlinePending'] = true;

    await store.stayPut(id, stay);
    await store.enqueue(
      feature: 'booking.checkin',
      method: 'PATCH',
      path: '/bookings/{id}/check-in',
      snapshot: snap,
      clientUuid: key,
      meta: {'bookingRef': id, 'guestName': stay['guestName'], 'at': now},
    );
    return Booking.fromJson(stay);
  }

  // ── Check-out and the bill ───────────────────────────────────────────────

  Future<Map<String, dynamic>> _stayRaw(int id, Map<String, dynamic>? cachedRaw) async {
    final raw = await store.stayGet(id) ?? cachedRaw;
    if (raw == null) {
      throw OfflineUnavailable.because('Open this booking once while connected, then it can be billed offline.');
    }
    return raw;
  }

  Map<String, dynamic> _singleRoom(Map<String, dynamic> stay) {
    final rooms = _rooms(stay);
    if (rooms.length != 1) {
      throw OfflineUnavailable.because('Bills for bookings with several rooms need a connection.');
    }
    return rooms.first;
  }

  List<double> _nights(Map<String, dynamic> room) {
    // An open stay is dated and priced by the server as it closes.
    if (room['checkOutDate'] == null) throw OfflineUnavailable.because(_openStayNeedsConnection);
    final list = room['nights'] as List?;
    if (list != null && list.isNotEmpty) {
      return [for (final n in list) ((n as Map)['amount'] as num).toDouble()];
    }
    // A stay booked before per-night rates were stored: an even split.
    final count = nightsBetween('${room['checkInDate']}', '${room['checkOutDate']}');
    return List.filled(count, round2(((room['totalPrice'] as num?) ?? 0) / count));
  }

  Future<LateCheckout> lateCheckout(int id, {Map<String, dynamic>? cachedRaw}) async {
    final ref = await _need();
    final stay = await _stayRaw(id, cachedRaw);
    final room = _rooms(stay).firstWhere((r) => r['status'] == 'CHECKED_IN', orElse: () => _rooms(stay).first);
    final nights = _nights(room);
    final json = lateCheckoutAnswer(
      bookingId: id,
      checkinMode: ref.checkinMode,
      checkInDate: '${room['checkInDate']}'.substring(0, 10),
      checkOutDate: '${room['checkOutDate']}'.substring(0, 10),
      checkOutTime: ref.checkOutTime,
      checkInTime: ref.checkInTime,
      earlyArrivalFrom: ref.earlyArrivalFrom,
      actualCheckInAt: DateTime.tryParse('${room['actualCheckInAt'] ?? stay['actualCheckInAt']}'),
      at: DateTime.now().toUtc(),
      policy: ref.policy,
      lastNightRate: nights.isEmpty ? 0 : nights.last,
      roomId: int.tryParse('${room['roomId']}'),
      roomNumber: '${room['roomNumber']}',
    );
    return LateCheckout.fromJson(json);
  }

  /// The bill as it would be issued at check-out now — same shape as the
  /// server's preview, so the bill screen is unchanged.
  Future<BillPreview> previewBill(
    int id, {
    required bool includeLateCheckout,
    required num discountAmount,
    String? discountReason,
    required BillSettle? settle,
    Map<String, dynamic>? cachedRaw,
  }) async {
    final ref = await _need();
    final stay = await _stayRaw(id, cachedRaw);
    final json = _previewJson(ref, stay, includeLateCheckout, discountAmount, settle);
    return BillPreview.fromJson(json);
  }

  Map<String, dynamic> _previewJson(
    ReferenceData ref,
    Map<String, dynamic> stay,
    bool includeLate,
    num discount,
    BillSettle? settle,
  ) {
    if (settle == null) {
      throw OfflineUnavailable.because('Re-issuing a bill needs a connection.');
    }
    if (settle.roomId != null) {
      throw OfflineUnavailable.because('Checking one room out of several needs a connection.');
    }
    if ('${stay['status']}' != 'CHECKED_IN') {
      throw OfflineUnavailable.because('This booking is not checked in.');
    }
    final room = _singleRoom(stay);

    // Other services on the room bill carry their own GST rate, which the
    // device does not hold.
    final services = [
      for (final u in (stay['serviceUsages'] as List? ?? const []))
        if ((u as Map)['onRoomBill'] == true && u['billed'] != true) u,
    ];
    if (services.isNotEmpty) {
      throw OfflineUnavailable.because('This stay has other services on the bill — those need a connection.');
    }
    final foodOrders = [
      for (final o in (stay['foodOrders'] as List? ?? const []))
        if ((o as Map)['onRoomBill'] == true &&
            o['billed'] != true &&
            (o['status'] == 'READY' || o['status'] == 'DELIVERED'))
          o.cast<String, dynamic>(),
    ];

    // A discount given on an order shows under its own section; the device does
    // not price that, so the server does.
    if (foodOrders.any((o) => ((o['discount'] as num?) ?? 0) > 0)) {
      throw OfflineUnavailable.because('This stay has a discount on its restaurant orders — that needs a connection.');
    }

    final grossNights = _nights(room);
    final alreadyLate = (stay['lateCheckoutCharge'] as num?) ?? (room['lateCheckoutCharge'] as num?) ?? 0;
    final lateTotal = round2(alreadyLate + settle.lateCharge);
    final bill = priceStayBill(
      grossNights: grossNights,
      lateCheckoutCharge: lateTotal,
      includeLateCheckout: includeLate,
      discountAmount: discount,
      slabs: ref.slabs,
      gstRegistered: ref.isGstRegistered,
      foodSubtotals: [for (final o in foodOrders) (o['subtotal'] as num)],
      foodRate: ref.foodRate,
    );

    final advance = (stay['advanceAmount'] as num?) ?? 0;
    final foodItems = <Map<String, dynamic>>[];
    for (final o in foodOrders) {
      for (final i in (o['items'] as List? ?? const [])) {
        final qty = (i as Map)['quantity'] as num? ?? 1;
        final total = i['lineTotal'] as num? ?? 0;
        foodItems.add({'name': i['name'], 'unitPrice': qty == 0 ? 0 : round2(total / qty), 'quantity': qty, 'lineTotal': total});
      }
    }

    return {
      'bookingId': _id(stay),
      'guestName': stay['guestName'],
      'roomNumber': room['roomNumber'],
      'categoryName': room['categoryName'],
      'checkInDate': room['checkInDate'],
      'checkOutDate': room['checkOutDate'],
      'isDormitory': false,
      'nights': grossNights.length,
      'nightsSubtotal': bill.nightsSubtotal,
      'roomCharges': room['roomCharges'] ?? const [],
      'lateCheckoutCharge': bill.grossLate,
      'discountBase': bill.grossSubtotal,
      'discountAmount': bill.discount,
      'lateCheckoutAgreed': lateTotal,
      'includeLateCheckout': includeLate,
      'lateCheckoutMinutes': null,
      'advancePaid': advance,
      'advanceOnly': advance,
      'roomPaymentsPaid': 0,
      'settleMode': 'FINAL',
      'advanceReceiptNumbers': null,
      'isGstRegistered': ref.isGstRegistered,
      'gstin': ref.gstin,
      'foodOrders': [
        for (final o in foodOrders) {'id': o['id'], 'orderNumber': o['orderNumber'], 'subtotal': o['subtotal']},
      ],
      'foodItems': foodItems,
      'orderNumbers': [for (final o in foodOrders) o['orderNumber']],
      'serviceItems': const <dynamic>[],
      'gst': bill.gst,
      'nonGst': bill.nonGst,
      'document': {'checkinMode': ref.checkinMode},
      'alreadyInvoiced': false,
    };
  }

  /// Check out and bill, offline: the stay is closed here, a provisional bill
  /// is built for the guest, and the real settlement is queued. The real
  /// invoice number is the server's, assigned when this reaches it — so the
  /// guest's copy says PROVISIONAL and carries a number of this device's own.
  Future<SettleResult> settle(
    int id,
    Map<String, dynamic> body, {
    int? roomId,
    Map<String, dynamic>? cachedRaw,
    String? key,
  }) async {
    final ref = await _need();
    final stay = Map<String, dynamic>.from(await _stayRaw(id, cachedRaw));
    final settle = BillSettle(roomId: roomId, lateCharge: (body['lateCharge'] as num?) ?? 0);
    final preview = _previewJson(
      ref,
      stay,
      body['includeLateCheckout'] != false,
      (body['discountAmount'] as num?) ?? 0,
      settle,
    );
    final side = (ref.isGstRegistered ? preview['gst'] : preview['nonGst']) as Map<String, dynamic>;

    final billSeq = await store.nextSeq('bill');
    final number = 'OFF-B-${billSeq.toString().padLeft(4, '0')}';
    final now = _nowIso();
    final me = (await store.cachedGet('/me')) as Map?;
    final lodge = (me?['lodge'] as Map?)?.cast<String, dynamic>() ?? const {};
    final room = _singleRoom(stay);

    final lines = (body['paymentLines'] as List?) ??
        (((body['collectedAmount'] as num?) ?? 0) > 0
            ? [
                {
                  'method': body['paymentMethod'],
                  'amount': body['collectedAmount'],
                  if (body['paymentReference'] != null) 'reference': body['paymentReference'],
                },
              ]
            : const []);

    final invoice = <String, dynamic>{
      'id': -billSeq,
      'kind': 'STAY',
      'bookingId': id,
      'bookingNumber': stay['bookingNumber'],
      'invoiceNumber': number,
      'documentType': side['documentType'],
      'billingSide': ref.isGstRegistered ? 'GST' : 'NON_GST',
      'status': 'ISSUED',
      'createdAt': now,
      'guestName': stay['guestName'],
      'guestPhone': stay['guestPhone'],
      'numGuests': stay['numGuests'],
      'roomNumber': room['roomNumber'],
      'categoryName': room['categoryName'],
      'isDormitory': false,
      'checkInDate': room['checkInDate'],
      'checkOutDate': room['checkOutDate'],
      'actualCheckInAt': room['actualCheckInAt'] ?? stay['actualCheckInAt'],
      'actualCheckOutAt': now,
      'checkinMode': ref.checkinMode,
      'checkOutTime': ref.checkOutTime,
      'nightsSubtotal': preview['nightsSubtotal'],
      'roomCharges': preview['roomCharges'],
      'lateCheckoutCharge': preview['lateCheckoutCharge'],
      'roomSubtotal': side['subtotal'],
      'cgstAmount': side['cgstAmount'],
      'sgstAmount': side['sgstAmount'],
      'cgstRatePercent': side['cgstRatePercent'],
      'sgstRatePercent': side['sgstRatePercent'],
      'roomTaxable': side['roomTaxable'],
      'foodSubtotal': side['foodSubtotal'],
      'foodCgstAmount': side['foodCgstAmount'],
      'foodSgstAmount': side['foodSgstAmount'],
      'foodCgstRatePercent': side['foodCgstRatePercent'],
      'foodSgstRatePercent': side['foodSgstRatePercent'],
      'foodTaxable': side['foodTaxable'],
      'serviceSubtotal': 0,
      'discountAmount': side['discountAmount'],
      'discountPercent': side['discountPercent'],
      'discountReason': body['discountReason'],
      'roundOff': side['roundOff'],
      'totalAmount': side['totalAmount'],
      'advancePaid': preview['advancePaid'],
      'foodItems': preview['foodItems'],
      'serviceItems': const <dynamic>[],
      'paymentLines': lines,
      'balanceCollected': body['collectedAmount'],
      'balancePaymentMethod': body['paymentMethod'],
      'gstin': ref.gstin,
      'isGstRegistered': ref.isGstRegistered,
      'lodgeName': lodge['name'],
      'lodgeAddress': lodge['address'],
      'lodgePhone': lodge['phone'],
      'lodgeCity': lodge['city'],
      'lodgeState': lodge['state'],
      'lodgeLogoUrl': lodge['logoUrl'],
    };

    stay['status'] = 'CHECKED_OUT';
    stay['actualCheckOutAt'] = now;
    stay['lateCheckoutCharge'] = preview['lateCheckoutCharge'];
    stay['hasIssuedInvoice'] = true;
    stay['invoiceNumber'] = number;
    stay['billAmount'] = side['totalAmount'];
    stay['rooms'] = [
      for (final r in (stay['rooms'] as List? ?? const []))
        {...(r as Map).cast<String, dynamic>(), 'status': 'CHECKED_OUT', 'actualCheckOutAt': now},
    ];
    stay['provisionalInvoice'] = invoice;
    stay['offlinePending'] = true;
    await store.stayPut(id, stay);

    await store.enqueue(
      feature: 'booking.settle',
      method: 'POST',
      path: '/billing/bookings/{id}/settle-checkout',
      clientUuid: key,
      json: {...body, 'checkedOutAt': now, 'invoiceAt': now},
      meta: {
        'bookingRef': id,
        'guestName': stay['guestName'],
        'offlineTotal': side['totalAmount'],
        'provisionalNumber': number,
      },
    );
    return SettleResult(mode: 'FINAL', invoice: Invoice.fromJson(invoice));
  }

  /// The advance receipt for a booking made on this device — provisional, with
  /// no tax split, until the server issues the real one at sync.
  Future<List<AdvanceReceipt>> advanceReceipts(int id) async {
    final stay = await store.stayGet(id);
    if (stay == null) return const [];
    final advance = (stay['advanceAmount'] as num?) ?? 0;
    if (advance <= 0) return const [];
    final seq = await store.nextSeq('adv-$id');
    final ref = await reference();
    final me = (await store.cachedGet('/me')) as Map?;
    final lodge = (me?['lodge'] as Map?)?.cast<String, dynamic>() ?? const {};
    final total = (stay['totalPrice'] as num?) ?? 0;
    final lines = (stay['advancePaymentLines'] as List?) ?? const [];
    return [
      AdvanceReceipt.fromJson({
        'id': id * 1000 - seq,
        'receiptNumber': 'OFF-A-${(id.abs()).toString().padLeft(4, '0')}',
        'billingSide': (ref?.isGstRegistered ?? false) ? 'GST' : 'NON_GST',
        'amountReceived': advance,
        'cgstAmount': 0,
        'sgstAmount': 0,
        'cgstRatePercent': 0,
        'sgstRatePercent': 0,
        'roundOff': 0,
        'stayTotal': total,
        'balanceDue': total - advance,
        'paymentMethod': stay['advancePaymentMethod'],
        'paymentReference': stay['advanceReference'],
        'paymentLines': lines,
        'status': 'ISSUED',
        'createdAt': _nowIso(),
        'bookingNumber': stay['bookingNumber'],
        'guestName': stay['guestName'],
        'guestPhone': stay['guestPhone'],
        'numGuests': stay['numGuests'],
        'roomNumber': stay['roomNumber'],
        'categoryName': stay['categoryName'],
        'checkInDate': stay['checkInDate'],
        'checkOutDate': stay['checkOutDate'],
        'gstin': ref?.gstin,
        'isGstRegistered': ref?.isGstRegistered ?? false,
        'lodgeName': lodge['name'],
        'lodgeAddress': lodge['address'],
        'lodgePhone': lodge['phone'],
        'lodgeCity': lodge['city'],
        'lodgeState': lodge['state'],
        'lodgeLogoUrl': lodge['logoUrl'],
      }),
    ];
  }

  static List<Map<String, dynamic>> _jsonList(String? raw) {
    if (raw == null || raw.isEmpty) return const [];
    // The booking screen writes these as JSON text inside the multipart form.
    final decoded = _tryDecode(raw);
    return [
      for (final e in (decoded is List ? decoded : const []))
        if (e is Map) e.cast<String, dynamic>(),
    ];
  }

  static dynamic _tryDecode(String raw) {
    try {
      return jsonDecode(raw);
    } catch (_) {
      return null;
    }
  }
}
