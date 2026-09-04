import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/domain/models/booking.dart';
import 'package:hotel_manager/domain/models/late_checkout.dart';
import 'package:hotel_manager/domain/models/me.dart';
import 'package:hotel_manager/domain/models/quote.dart';
import 'package:hotel_manager/domain/models/room.dart';
import 'package:hotel_manager/domain/models/session.dart';
import 'package:hotel_manager/domain/repository/auth_repo.dart';
import 'package:hotel_manager/domain/repository/booking_repo.dart';
import 'package:hotel_manager/domain/usecase/auth_usecase.dart';
import 'package:hotel_manager/domain/usecase/booking_usecase.dart';
import 'package:hotel_manager/presentation/providers/usecase_provider.dart';
import 'package:hotel_manager/screens/shell/dashboard_shell.dart';
import 'package:hotel_manager/screens/theme.dart';

/// Renders the signed-in app against a canned /me and register.
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
}

class _FakeBookings implements BookingRepository {
  final List<Booking> rows;
  _FakeBookings(this.rows);

  @override
  Future<List<Booking>> bookings({String? fromDate, String? toDate}) async =>
      rows;

  @override
  Future<Booking> cancel(int id) async => Booking(id: id, status: 'CANCELLED');

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
  }) async => const Quote();

  @override
  Future<Booking> booking(int id) async => Booking(id: id);

  @override
  Future<Booking> createBooking(FormData form) async => const Booking(id: 1);

  @override
  Future<Booking> checkIn(int id, FormData form) async => Booking(id: id);

  @override
  Future<LateCheckout> lateCheckout(int id) async =>
      LateCheckout(bookingId: id);

  @override
  Future<Booking> checkOut(int id, Map<String, dynamic> body) async =>
      Booking(id: id);
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

Widget _app(Me me, List<Booking> rows) => ProviderScope(
  overrides: [
    authUsecaseProvider.overrideWithValue(AuthUsecase(_FakeAuth(me))),
    bookingUsecaseProvider.overrideWithValue(
      BookingUsecase(_FakeBookings(rows)),
    ),
  ],
  child: MaterialApp(theme: AppTheme.light, home: const DashboardShell()),
);

void main() {
  testWidgets('the shell draws the property, the tabs and the register', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(_owner(), [
        Booking.fromJson(const {
          'id': '66',
          'guestName': 'Sukhada Kudalkar',
          'roomNumber': '202',
          'checkInDate': '2026-08-27',
          'checkOutDate': '2026-08-29',
          'status': 'BOOKED',
          'totalPrice': 6400,
        }),
      ]),
    );
    // Two pumps: one for the microtask that loads /me, one for the register.
    await tester.pumpAndSettle();

    // The property is named.
    expect(find.text('Anand Executive Home Stay'), findsOneWidget);

    // Four tabs plus More. Food and Menu are absent: this property sells no
    // food, and a permission alone must not open them.
    expect(find.text('Bookings'), findsWidgets);
    expect(find.text('Billing'), findsOneWidget);
    expect(find.text('Guests'), findsOneWidget);
    expect(find.text('Rooms'), findsOneWidget);
    expect(find.text('More'), findsOneWidget);
    expect(find.text('Food'), findsNothing);
    expect(find.text('Menu'), findsNothing);

    // And the body is the register, not an empty page.
    expect(find.text('Sukhada Kudalkar'), findsOneWidget);
    expect(find.text('Take a booking'), findsOneWidget);
  });

  testWidgets('an empty register still draws the bar and the way in', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_owner(), const []));
    await tester.pumpAndSettle();

    expect(find.text('No stays here yet.'), findsOneWidget);
    expect(find.text('Take a booking'), findsOneWidget);
    expect(find.text('More'), findsOneWidget);
  });

  testWidgets('a section with no screen yet says so rather than going blank', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_owner(), const []));
    await tester.pumpAndSettle();

    // Rooms, not Billing — billing has a real screen now, so tapping it
    // would open the queue rather than the stub this is about.
    await tester.tap(find.text('Rooms'));
    await tester.pumpAndSettle();

    expect(find.textContaining('not on the phone yet'), findsOneWidget);
  });

  // ── Advancing a reservation ───────────────────────────────────────────────
  //
  // A reservation used to be a dead end here: it could never be checked in, so
  // it could never be checked out, so it could never be billed. These pin the
  // actions to the states the server will actually accept them in.

  testWidgets('a reservation whose date has come offers check in and cancel', (
    tester,
  ) async {
    final today = DateTime.now();
    await tester.pumpWidget(
      _app(_owner(), [
        Booking.fromJson({
          'id': '70',
          'guestName': 'Nikhil Parab',
          'roomNumber': '101',
          'checkInDate': _iso(today),
          'checkOutDate': _iso(today.add(const Duration(days: 2))),
          'status': 'BOOKED',
          'totalPrice': 3000,
        }),
      ]),
    );
    await tester.pumpAndSettle();

    expect(find.text('Check in'), findsOneWidget);
    expect(find.text('Cancel'), findsOneWidget);
    expect(find.text('Check out'), findsNothing);
  });

  testWidgets('a reservation for a later date cannot be checked in yet', (
    tester,
  ) async {
    final later = DateTime.now().add(const Duration(days: 10));
    await tester.pumpWidget(
      _app(_owner(), [
        Booking.fromJson({
          'id': '71',
          'guestName': 'Asha Redkar',
          'roomNumber': '102',
          'checkInDate': _iso(later),
          'checkOutDate': _iso(later.add(const Duration(days: 1))),
          'status': 'BOOKED',
          'totalPrice': 1500,
        }),
      ]),
    );
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
        Booking.fromJson({
          'id': '72',
          'guestName': 'Rohan Sawant',
          'roomNumber': '103',
          'checkInDate': _iso(today.subtract(const Duration(days: 1))),
          'checkOutDate': _iso(today.add(const Duration(days: 1))),
          'status': 'CHECKED_IN',
          'totalPrice': 2000,
        }),
      ]),
    );
    await tester.pumpAndSettle();

    // Cancel is absent on purpose: the server only cancels a BOOKED stay, and
    // a guest who is already in the room leaves by checking out.
    expect(find.text('Check out'), findsOneWidget);
    expect(find.text('Check in'), findsNothing);
    expect(find.text('Cancel'), findsNothing);
  });
}

String _iso(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-'
    '${d.month.toString().padLeft(2, '0')}-'
    '${d.day.toString().padLeft(2, '0')}';
