import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show LogicalKeyboardKey;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/domain/models/booking.dart';
import 'package:hotel_manager/domain/models/draft.dart';
import 'package:hotel_manager/domain/models/guest_match.dart';
import 'package:hotel_manager/domain/models/invoice_window.dart';
import 'package:hotel_manager/domain/models/late_checkout.dart';
import 'package:hotel_manager/domain/models/me.dart';
import 'package:hotel_manager/domain/models/quote.dart';
import 'package:hotel_manager/domain/models/room.dart';
import 'package:hotel_manager/domain/models/session.dart';
import 'package:hotel_manager/domain/models/staff_alert.dart';
import 'package:hotel_manager/domain/models/tape_chart.dart';
import 'package:hotel_manager/domain/repository/auth_repo.dart';
import 'package:hotel_manager/domain/repository/booking_repo.dart';
import 'package:hotel_manager/domain/usecase/auth_usecase.dart';
import 'package:hotel_manager/domain/usecase/booking_usecase.dart';
import 'package:hotel_manager/core/offline/outbox_status.dart';
import 'package:hotel_manager/presentation/providers/network_provider.dart';
import 'package:hotel_manager/presentation/providers/usecase_provider.dart';
import 'package:hotel_manager/screens/bookings/booking_detail_screen.dart';
import 'package:hotel_manager/screens/bookings/take_booking_screen.dart';
import 'package:hotel_manager/screens/shell/dashboard_shell.dart';
import 'package:hotel_manager/screens/shell/feature.dart';
import 'package:hotel_manager/screens/theme.dart';

/// Renders the signed-in app against a canned /me and tape chart.
///
/// The point is not to assert pixels. It is that a screen which throws while
/// building shows as an empty page on a device and says nothing about why —
/// so the tree gets pumped here, where the exception is the test failure.

// ── Fakes ───────────────────────────────────────────────────────────────────

class _FakeAuth implements AuthRepository {
  final Me answer;
  _FakeAuth(this.answer);

  @override
  Future<Me> me() async => answer;

  @override
  Future<Session> login(Credentials credentials) async =>
      const Session(token: 't', role: 'OWNER');

  @override
  Future<Map<String, dynamic>> sendPasswordOtp(String currentPassword) async =>
      throw UnimplementedError();

  @override
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
    required String otp,
  }) async => throw UnimplementedError();

  @override
  Future<Me> updateMyLodge(Map<String, dynamic> body) async =>
      throw UnimplementedError();

  @override
  Future<void> forgotPassword({
    required String identifier,
    required String newPassword,
  }) async => throw UnimplementedError();

  @override
  Future<Me> updateMyLodgeLogo(FormData form) async =>
      throw UnimplementedError();

  @override
  Future<Me> removeMyLodgeLogo() async => throw UnimplementedError();

  @override
  Future<Me> updateMyLodgeHeroImage(FormData form) async =>
      throw UnimplementedError();

  @override
  Future<Me> removeMyLodgeHeroImage() async => throw UnimplementedError();
}

/// One stay for the chart, and the room it sits on. The chart needs both a
/// room roster and a booking list — a fixture built from bookings alone would
/// have no way to say a room is vacant.
class _Stay {
  final Booking booking;
  final String categoryName;

  const _Stay(this.booking) : categoryName = 'Standard';
}

class _FakeBookings implements BookingRepository {
  final List<_Stay> stays;
  _FakeBookings(this.stays);

  List<Booking> get rows => stays.map((s) => s.booking).toList();

  @override
  Future<List<Booking>> bookings({String? fromDate, String? toDate}) async =>
      rows;

  @override
  Future<TapeChartData> tapeChart({
    required String startDate,
    required String endDate,
  }) async => TapeChartData(
    rooms: [
      for (final s in stays)
        TapeChartRoom(
          id: s.booking.roomId ?? s.booking.id,
          roomNumber: s.booking.roomNumber ?? '?',
          categoryName: s.categoryName,
        ),
    ],
    bookings: [
      for (final s in stays)
        TapeChartBooking(
          id: s.booking.id,
          roomId: s.booking.roomId ?? s.booking.id,
          guestName: s.booking.guestName,
          guestPhone: s.booking.guestPhone,
          checkInDate: s.booking.checkInDate,
          checkOutDate: s.booking.checkOutDate,
          status: s.booking.status,
          totalPrice: s.booking.totalPrice,
        ),
    ],
  );

  @override
  Future<Booking> cancel(int id, [Map<String, dynamic>? body]) async =>
      Booking(id: id, status: 'CANCELLED');

  @override
  Future<Map<String, dynamic>> sendWhatsApp(int id) async => {'status': 'sent'};

  @override
  Future<List<Room>> availableRooms(String a, String b) async => const [];

  @override
  Future<Quote> priceQuote({
    required int roomId,
    required String checkInDate,
    required String checkOutDate,
    String? chargeIds,
    num? basePriceOverride,
    num? discountAmount,
    List<int>? bedIds,
  }) async => const Quote();

  @override
  Future<MultiRoomQuote> multiRoomPriceQuote({
    required List<Map<String, dynamic>> rooms,
    required String checkInDate,
    required String checkOutDate,
    num? discountAmount,
  }) async => const MultiRoomQuote();

  @override
  Future<AvailableBeds> availableBeds({
    required int roomId,
    required String checkInDate,
    required String checkOutDate,
  }) async => const AvailableBeds(pricePerNight: 0);

  @override
  Future<Booking> booking(int id) async =>
      rows.firstWhere((b) => b.id == id, orElse: () => Booking(id: id));

  @override
  Future<List<CheckAlert>> checkinAlerts() async => const [];

  @override
  Future<List<CheckAlert>> checkoutAlerts() async => const [];

  @override
  Future<List<GuestMatch>> searchGuests(String query) async => const [];

  @override
  Future<Response<List<int>>> idProof(int bookingId) async =>
      Response(requestOptions: RequestOptions(path: ''), data: const []);

  @override
  Future<Response<List<int>>> guestIdProof(int bookingId, int guestId) async =>
      Response(requestOptions: RequestOptions(path: ''), data: const []);

  @override
  Future<Booking> createBooking(FormData form) async => const Booking(id: 1);

  @override
  Future<Booking> checkIn(int id, FormData form) async =>
      Booking(id: id, status: 'CHECKED_IN');

  @override
  Future<List<Room>> availableRoomsForBooking(
    int bookingId, {
    required String checkOutDate,
    String? checkInDate,
  }) async => const [];

  @override
  Future<Booking> updateBooking(int id, FormData form) async =>
      Booking(id: id);

  @override
  Future<BookingRevision> reviseBooking(int id, FormData form) =>
      throw UnimplementedError();

  @override
  Future<InvoiceEditWindow?> invoiceEditWindow(int id) =>
      throw UnimplementedError();

  @override
  Future<PastWindow> pastWindow(String billingSide) =>
      throw UnimplementedError();

  @override
  Future<int> createPastBooking(FormData form) => throw UnimplementedError();

  @override
  Future<LateCheckout> lateCheckout(int id) async =>
      LateCheckout(bookingId: id);

  @override
  Future<Booking> checkOut(int id, Map<String, dynamic> body) async =>
      Booking(id: id, status: 'CHECKED_OUT');

  @override
  Future<LateCheckout> roomLateCheckout(int id, int roomId) async =>
      LateCheckout(bookingId: id);

  @override
  Future<Booking> checkOutRoom(
    int id,
    int roomId,
    Map<String, dynamic> body,
  ) async => Booking(id: id, status: 'CHECKED_OUT');

  @override
  Future<List<BookingDraft>> drafts() async => const [];

  @override
  Future<BookingDraft> draft(int id) async =>
      BookingDraft(id: id, form: DraftForm());

  @override
  Future<BookingDraft> createDraft(Map<String, dynamic> form) async =>
      BookingDraft(id: 1, form: DraftForm());

  @override
  Future<BookingDraft> updateDraft(int id, Map<String, dynamic> form) async =>
      BookingDraft(id: id, form: DraftForm());

  @override
  Future<void> deleteDraft(int id) async {}
}

/// The real payload for this property: an owner with every permission, rooms
/// but no food. Six of the eight sections apply.
Me _owner() => Me.fromJson(const {
  'user': {
    'id': '46',
    'name': 'Suresh Naik',
    'role': 'OWNER',
    'roleName': 'Owner',
    'permissions': [
      'rooms.manage',
      'bookings.manage',
      'billing.manage',
      'guests.view',
      'reports.view',
      'staff.manage',
      'food.manage',
      'orders.manage',
    ],
  },
  'lodge': {
    'id': '1',
    'name': 'Anand Executive Home Stay',
    'hasRooms': true,
    'servesFood': false,
  },
});

Widget _app(Me me, List<_Stay> stays) => ProviderScope(
  overrides: [
    // No connectivity probe (it keeps a periodic timer alive past the test).
    networkStatusProvider.overrideWith((ref) => Stream.value(true)),
    pendingOutboxCountProvider.overrideWith((ref) => Stream.value(0)),
    attentionOutboxCountProvider.overrideWith((ref) => Stream.value(0)),
    authUsecaseProvider.overrideWithValue(AuthUsecase(_FakeAuth(me))),
    bookingUsecaseProvider.overrideWithValue(
      BookingUsecase(_FakeBookings(stays)),
    ),
  ],
  child: MaterialApp(theme: AppTheme.light, home: const DashboardShell()),
);

void main() {
  // Every section the owner can reach, at a desktop, a laptop, a small window
  // and a phone: none may throw while laying out (an overflow, an unbounded
  // width, a bad constraint). Data-less, so this guards the frames and
  // empty/error states; the table and grid widgets have their own tests.
  for (final size in const [
    Size(1920, 1080),
    Size(1280, 720),
    Size(960, 600),
    Size(400, 800),
  ]) {
    testWidgets('every section lays out at ${size.width.toInt()}x${size.height.toInt()}', (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final me = _owner();
      final compact = size.shortestSide < AppTheme.bpMedium;

      await tester.pumpWidget(_app(me, const []));
      await tester.pumpAndSettle();

      for (final f in kFeatures.where((f) => f.availableTo(me))) {
        if (compact) {
          await tester.tap(find.byIcon(Icons.menu_rounded));
          await tester.pumpAndSettle();
        }
        if (f.group != null && find.text(f.title).evaluate().isEmpty) {
          final header = find.text(f.group!.toUpperCase());
          if (header.evaluate().isNotEmpty) {
            await tester.tap(header.first);
            await tester.pumpAndSettle();
          }
        }
        final item = find.text(f.title);
        if (item.evaluate().isEmpty) continue;
        await tester.tap(item.first);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: '${f.title} at $size');
      }
    });
  }

  for (final size in const [Size(1920, 1080), Size(1280, 720), Size(900, 700), Size(400, 800)]) {
    testWidgets('booking detail lays out at ${size.width.toInt()} wide', (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      final stay = _Stay(
        Booking.fromJson(const {
          'id': '66',
          'roomId': '202',
          'guestName': 'Sukhada Kudalkar',
          'guestPhone': '9000000000',
          'roomNumber': '202',
          'checkInDate': '2026-08-27',
          'checkOutDate': '2026-08-29',
          'status': 'BOOKED',
          'totalPrice': 6400,
          'advanceAmount': 1000,
        }),
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            networkStatusProvider.overrideWith((ref) => Stream.value(true)),
            pendingOutboxCountProvider.overrideWith((ref) => Stream.value(0)),
            attentionOutboxCountProvider.overrideWith((ref) => Stream.value(0)),
            bookingUsecaseProvider.overrideWithValue(BookingUsecase(_FakeBookings([stay]))),
          ],
          child: MaterialApp(theme: AppTheme.light, home: const BookingDetailScreen(bookingId: 66)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Sukhada Kudalkar'), findsWidgets);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('desktop room chart: status legend on top, New booking bar below, month fits', (tester) async {
    tester.view.physicalSize = const Size(1920, 1080);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final now = DateTime.now();
    String iso(DateTime d) => d.toIso8601String().substring(0, 10);
    await tester.pumpWidget(
      _app(_owner(), [
        _Stay(
          Booking.fromJson({
            'id': '66',
            'roomId': '202',
            'guestName': 'Sukhada Kudalkar',
            'roomNumber': '202',
            'checkInDate': iso(now),
            'checkOutDate': iso(now.add(const Duration(days: 2))),
            'status': 'CHECKED_IN',
            'totalPrice': 6400,
          }),
        ),
      ]),
    );
    await tester.pumpAndSettle();

    // Legend: every status colour is named, with today's count.
    for (final label in ['Vacant', 'Reserved', 'Checked in', 'Stayed', 'Draft', 'Not ready']) {
      expect(find.text(label), findsOneWidget, reason: label);
    }
    // The bottom bar's labelled button (not just a floating +).
    // New booking and Drafts are buttons in the chart's top row; no bottom bar.
    expect(find.widgetWithText(FilledButton, 'New booking'), findsOneWidget);
    // Drafts, at the top as on the web - opens the list of parked bookings.
    await tester.tap(find.widgetWithText(FilledButton, 'Drafts'));
    await tester.pumpAndSettle();
    expect(find.text('Draft bookings'), findsOneWidget);
    expect(find.text('No drafts parked.'), findsOneWidget);
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    // Month navigation is there, since the whole month is on screen at once.
    expect(find.byTooltip('Next month'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('phone room chart: no legend bar, floating + stays', (tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(_app(_owner(), const []));
    await tester.pumpAndSettle();
    expect(find.text('Reserved'), findsNothing);
    expect(find.widgetWithText(FilledButton, 'New booking'), findsNothing);
    expect(find.byIcon(Icons.add_rounded), findsOneWidget);
  });

  for (final size in const [Size(1920, 1080), Size(1280, 720), Size(900, 700), Size(400, 800)]) {
    testWidgets('new booking lays out at ${size.width.toInt()} wide', (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            networkStatusProvider.overrideWith((ref) => Stream.value(true)),
            pendingOutboxCountProvider.overrideWith((ref) => Stream.value(0)),
            attentionOutboxCountProvider.overrideWith((ref) => Stream.value(0)),
            bookingUsecaseProvider.overrideWithValue(BookingUsecase(_FakeBookings(const []))),
          ],
          child: MaterialApp(theme: AppTheme.light, home: const TakeBookingScreen()),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('New booking'), findsWidgets);
      // The price summary column is a wide-window thing.
      expect(find.text('PRICE SUMMARY'), size.width >= 1100 ? findsOneWidget : findsNothing);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('desktop: maximize view hides sidebar and top bar, Esc brings them back', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1600, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(_app(_owner(), const []));
    await tester.pumpAndSettle();

    // Normal: the rail names the property, and the top bar offers the toggle.
    expect(find.text('Anand Executive Home Stay'), findsOneWidget);
    expect(find.byIcon(Icons.fullscreen_rounded), findsOneWidget);

    await tester.tap(find.byIcon(Icons.fullscreen_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Anand Executive Home Stay'), findsNothing);
    expect(find.byIcon(Icons.fullscreen_exit_rounded), findsOneWidget);
    // The section is still there, now with the whole window.
    expect(find.text('No active rooms yet.'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('Anand Executive Home Stay'), findsOneWidget);

    // F11 toggles it too.
    await tester.sendKeyEvent(LogicalKeyboardKey.f11);
    await tester.pumpAndSettle();
    expect(find.text('Anand Executive Home Stay'), findsNothing);
  });

  testWidgets('phone: no maximize button, the drawer layout is unchanged', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(_app(_owner(), const []));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.fullscreen_rounded), findsNothing);
    expect(find.byIcon(Icons.menu_rounded), findsOneWidget);
  });

  testWidgets('the shell draws the property, the tabs and the chart', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(_owner(), [
        _Stay(
          Booking.fromJson(const {
            'id': '66',
            'roomId': '202',
            'guestName': 'Sukhada Kudalkar',
            'roomNumber': '202',
            'checkInDate': '2026-08-27',
            'checkOutDate': '2026-08-29',
            'status': 'BOOKED',
            'totalPrice': 6400,
          }),
        ),
      ]),
    );
    // Two pumps: one for the microtask that loads /me, one for the chart.
    await tester.pumpAndSettle();

    // The property is named.
    expect(find.text('Anand Executive Home Stay'), findsOneWidget);

    // The sidebar's own ungrouped sections, and the group headers for the
    // ones this owner can reach but that start collapsed. Food and Menu are
    // absent: this property sells no food, and a permission alone must not
    // open them.
    expect(find.text('Room Chart'), findsWidgets);
    expect(find.text('Room billing'), findsOneWidget);
    expect(find.text('Booking Details'), findsOneWidget);
    expect(find.text('ROOMS'), findsOneWidget);
    expect(find.text('FINANCE & MANAGEMENT'), findsOneWidget);
    expect(find.text('Food orders'), findsNothing);
    expect(find.text('Menu & QR codes'), findsNothing);

    // And the body is the chart, not an empty page — the room this stay is
    // on is drawn, and the way in to a new one is offered.
    expect(find.text('202'), findsOneWidget);
    expect(find.byIcon(Icons.add_rounded), findsOneWidget);
  });

  testWidgets('a lodge with no rooms yet still draws the sidebar and the way in', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_owner(), const []));
    await tester.pumpAndSettle();

    expect(find.text('No active rooms yet.'), findsOneWidget);
    expect(find.byIcon(Icons.add_rounded), findsOneWidget);
    expect(find.text('Room billing'), findsOneWidget);
  });

  testWidgets('the group holding the landing section starts open, others do not', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_owner(), const []));
    await tester.pumpAndSettle();

    // Room Chart lands the desk inside the Rooms group, so Rooms starts
    // expanded — its sibling rows are reachable without a tap.
    expect(find.text('Rooms & rates'), findsOneWidget);

    // Finance & Management holds nothing the landing section is in, so it
    // starts collapsed, the same way the web sidebar's own dropdown groups
    // default to closed until you open them.
    expect(find.text('Reports & Analytics'), findsNothing);
    await tester.tap(find.text('FINANCE & MANAGEMENT'));
    await tester.pumpAndSettle();

    expect(find.text('Reports & Analytics'), findsOneWidget);

    // Tapping the header again folds it back away.
    await tester.tap(find.text('FINANCE & MANAGEMENT'));
    await tester.pumpAndSettle();

    expect(find.text('Reports & Analytics'), findsNothing);
  });

  testWidgets('picking another section in the same open group switches the body', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_owner(), const []));
    await tester.pumpAndSettle();

    expect(find.text('No active rooms yet.'), findsOneWidget);

    await tester.tap(find.text('Booking Details'));
    await tester.pumpAndSettle();

    // The tape chart is gone — the sidebar moved the body to the register.
    expect(find.text('No active rooms yet.'), findsNothing);
  });

  // ── Advancing a reservation ───────────────────────────────────────────────
  //
  // A reservation used to be a dead end here: it could never be checked in, so
  // it could never be checked out, so it could never be billed. These pin the
  // actions to the states the server will actually accept them in. The tape
  // chart keeps them behind a tap on the stay's own tile rather than showing
  // every action on the screen at once, so each test opens that sheet first.

  testWidgets('a reservation whose date has come offers check in and cancel', (
    tester,
  ) async {
    final today = DateTime.now();
    await tester.pumpWidget(
      _app(_owner(), [
        _Stay(
          Booking.fromJson({
            'id': '70',
            'roomId': '101',
            'guestName': 'Nikhil Parab',
            'roomNumber': '101',
            'checkInDate': _iso(today),
            'checkOutDate': _iso(today.add(const Duration(days: 2))),
            'status': 'BOOKED',
            'totalPrice': 3000,
          }),
        ),
      ]),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('101'));
    await tester.pumpAndSettle();

    expect(find.text('Check in'), findsOneWidget);
    expect(find.text('Cancel booking'), findsOneWidget);
    expect(find.text('Check out'), findsNothing);
  });

  testWidgets('a reservation for a later date cannot be checked in yet', (
    tester,
  ) async {
    final later = DateTime.now().add(const Duration(days: 10));
    await tester.pumpWidget(
      _app(_owner(), [
        _Stay(
          Booking.fromJson({
            'id': '71',
            'roomId': '102',
            'guestName': 'Asha Redkar',
            'roomNumber': '102',
            'checkInDate': _iso(later),
            'checkOutDate': _iso(later.add(const Duration(days: 1))),
            'status': 'BOOKED',
            'totalPrice': 1500,
          }),
        ),
      ]),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('102'));
    await tester.pumpAndSettle();

    // The server opens check-in on the reserved date and answers 409 before
    // it, so the button is not offered — the date it opens is said instead.
    expect(find.text('Check in'), findsNothing);
    expect(find.textContaining('Check-in opens'), findsOneWidget);
    expect(find.text('Cancel booking'), findsOneWidget);
  });

  testWidgets('a guest already in the room is checked out, not checked in', (
    tester,
  ) async {
    final today = DateTime.now();
    await tester.pumpWidget(
      _app(_owner(), [
        _Stay(
          Booking.fromJson({
            'id': '72',
            'roomId': '103',
            'guestName': 'Rohan Sawant',
            'roomNumber': '103',
            'checkInDate': _iso(today.subtract(const Duration(days: 1))),
            'checkOutDate': _iso(today.add(const Duration(days: 1))),
            'status': 'CHECKED_IN',
            'totalPrice': 2000,
          }),
        ),
      ]),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('103'));
    await tester.pumpAndSettle();

    // Cancel is absent on purpose: the server only cancels a BOOKED stay, and
    // a guest who is already in the room leaves by checking out.
    expect(find.text('Check out'), findsOneWidget);
    expect(find.text('Check in'), findsNothing);
    expect(find.text('Cancel booking'), findsNothing);
  });
}

String _iso(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-'
    '${d.month.toString().padLeft(2, '0')}-'
    '${d.day.toString().padLeft(2, '0')}';
