import 'package:dio/dio.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/late_checkout.dart';
import '../../domain/models/quote.dart';
import '../../domain/models/room.dart';
import '../../domain/models/tape_chart.dart';
import '../../domain/repository/booking_repo.dart';
import '../api/api_service.dart';

/// Pure-remote, and deliberately so.
///
/// The blueprint's repositories are local-first with a sqflite mirror and an
/// outbox for offline writes. None of that is here, and it should not be: every
/// operation in this file is a decision about a room somebody else may also be
/// selling. Availability, the price of a stay and the act of taking a booking
/// are all resolved against a lock on the server — a phone that queued a
/// booking offline and drained it later would be a phone that sells a room
/// twice. Failures rethrow so the desk is told, rather than being shown a
/// cached answer that may already be wrong.
class BookingImpl implements BookingRepository {
  final ApiService api;

  BookingImpl(this.api);

  @override
  Future<List<Room>> availableRooms(String checkInDate, String checkOutDate) =>
      api
          .availableRooms(checkInDate: checkInDate, checkOutDate: checkOutDate)
          .then((r) => r.rooms);

  @override
  Future<TapeChartData> tapeChart({
    required String startDate,
    required String endDate,
  }) => api.tapeChart(startDate: startDate, endDate: endDate);

  @override
  Future<Quote> priceQuote({
    required int roomId,
    required String checkInDate,
    required String checkOutDate,
    String? chargeIds,
    num? basePriceOverride,
    num? discountAmount,
  }) => api.priceQuote(
    roomId: roomId,
    checkInDate: checkInDate,
    checkOutDate: checkOutDate,
    chargeIds: chargeIds,
    basePriceOverride: basePriceOverride,
    discountAmount: discountAmount,
  );

  @override
  Future<List<Booking>> bookings({String? fromDate, String? toDate}) =>
      api.bookings(fromDate: fromDate, toDate: toDate);

  @override
  Future<Booking> booking(int id) => api.booking(id);

  @override
  Future<Booking> createBooking(FormData form) => api.createBooking(form);

  @override
  Future<Booking> checkIn(int id, FormData form) => api.checkIn(id, form);

  @override
  Future<LateCheckout> lateCheckout(int id) => api.lateCheckout(id);

  @override
  Future<Booking> checkOut(int id, Map<String, dynamic> body) =>
      api.checkOut(id, body);

  @override
  Future<Booking> cancel(int id) => api.cancelBooking(id);
}
