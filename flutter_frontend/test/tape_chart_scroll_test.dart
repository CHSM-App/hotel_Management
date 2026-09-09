import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/domain/models/booking.dart';
import 'package:hotel_manager/domain/models/late_checkout.dart';
import 'package:hotel_manager/domain/models/quote.dart';
import 'package:hotel_manager/domain/models/room.dart';
import 'package:hotel_manager/domain/models/tape_chart.dart';
import 'package:hotel_manager/domain/repository/booking_repo.dart';
import 'package:hotel_manager/presentation/providers/repository_provider.dart';
import 'package:hotel_manager/presentation/providers/view_model_provider.dart';
import 'package:hotel_manager/screens/bookings/tape_chart.dart';

/// A repository that hands back a few rooms in one category and counts every
/// `tapeChart` fetch, so the test can tell whether dragging near the far edge
/// actually asks the server for a wider window rather than just relying on
/// it.
class _FakeBookingRepository implements BookingRepository {
  int tapeChartCalls = 0;

  @override
  Future<TapeChartData> tapeChart({
    required String startDate,
    required String endDate,
  }) async {
    tapeChartCalls++;
    return TapeChartData(
      rooms: [
        for (var i = 1; i <= 6; i++)
          TapeChartRoom(
            id: i,
            roomNumber: '10$i',
            floor: '1',
            categoryName: 'Standard',
          ),
      ],
      bookings: const [],
    );
  }

  @override
  Future<List<Room>> availableRooms(String checkInDate, String checkOutDate) =>
      throw UnimplementedError();

  @override
  Future<Quote> priceQuote({
    required int roomId,
    required String checkInDate,
    required String checkOutDate,
    String? chargeIds,
    num? basePriceOverride,
    num? discountAmount,
  }) => throw UnimplementedError();

  @override
  Future<List<Booking>> bookings({String? fromDate, String? toDate}) =>
      throw UnimplementedError();

  @override
  Future<Booking> booking(int id) => throw UnimplementedError();

  @override
  Future<Response<List<int>>> idProof(int bookingId) =>
      throw UnimplementedError();

  @override
  Future<Response<List<int>>> guestIdProof(int bookingId, int guestId) =>
      throw UnimplementedError();

  @override
  Future<Booking> createBooking(FormData form) => throw UnimplementedError();

  @override
  Future<Booking> checkIn(int id, FormData form) => throw UnimplementedError();

  @override
  Future<List<Room>> availableRoomsForBooking(
    int bookingId, {
    required String checkOutDate,
    String? checkInDate,
  }) => throw UnimplementedError();

  @override
  Future<Booking> updateBooking(int id, FormData form) =>
      throw UnimplementedError();

  @override
  Future<LateCheckout> lateCheckout(int id) => throw UnimplementedError();

  @override
  Future<Booking> checkOut(int id, Map<String, dynamic> body) =>
      throw UnimplementedError();

  @override
  Future<Booking> cancel(int id, [Map<String, dynamic>? body]) =>
      throw UnimplementedError();
}

/// A horizontally scrollable strip that a desk could actually drag: not the
/// date header or the decorative scrollbar strip (both `NeverScrollableScrollPhysics`,
/// or too narrow to have anything to scroll), and not some unrelated strip
/// elsewhere on the screen with nothing to overflow into.
Finder _findDraggableRoomRow(WidgetTester tester) {
  final candidates = find.byWidgetPredicate(
    (w) =>
        w is Scrollable &&
        w.axisDirection == AxisDirection.right &&
        w.physics is! NeverScrollableScrollPhysics,
  );
  for (var i = 0; i < candidates.evaluate().length; i++) {
    final state = tester.state<ScrollableState>(candidates.at(i));
    if (state.position.maxScrollExtent > 0) return candidates.at(i);
  }
  throw StateError('no draggable room row found');
}

void main() {
  testWidgets(
    'dragging a room row near the far edge grows the chart window',
    (tester) async {
      final repo = _FakeBookingRepository();
      final container = ProviderContainer(
        overrides: [bookingRepositoryProvider.overrideWithValue(repo)],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: Scaffold(body: TapeChart())),
        ),
      );
      await tester.pumpAndSettle();

      final before = container.read(bookingViewModelProvider);
      expect(before.chart.hasValue, isTrue, reason: 'initial fetch should land');
      expect(before.chartTo.difference(before.chartFrom).inDays, 30);

      final row = _findDraggableRoomRow(tester);

      // A drag hard enough, and long enough, to cross several near-edge
      // thresholds in a row — the same as a desk dragging their thumb across
      // the chart rather than nudging it once.
      for (var i = 0; i < 6; i++) {
        await tester.drag(row, const Offset(-500, 0));
        await tester.pump(const Duration(milliseconds: 50));
      }
      await tester.pumpAndSettle();

      final after = container.read(bookingViewModelProvider);
      expect(
        after.chartTo.difference(after.chartFrom).inDays,
        greaterThan(30),
        reason: 'dragging near the far edge should have grown the window '
            'past its initial 30 days',
      );
      expect(repo.tapeChartCalls, greaterThan(1));
    },
  );
}
