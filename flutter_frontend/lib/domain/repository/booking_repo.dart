import 'package:dio/dio.dart';

import '../models/booking.dart';
import '../models/late_checkout.dart';
import '../models/quote.dart';
import '../models/room.dart';
import '../models/tape_chart.dart';

abstract class BookingRepository {
  Future<List<Room>> availableRooms(String checkInDate, String checkOutDate);

  /// The tape chart's own fetch — every active room plus every stay, draft
  /// and cancellation touching [startDate, endDate).
  Future<TapeChartData> tapeChart({
    required String startDate,
    required String endDate,
  });

  Future<Quote> priceQuote({
    required int roomId,
    required String checkInDate,
    required String checkOutDate,
    String? chargeIds,
    num? basePriceOverride,
    num? discountAmount,
  });

  /// The register over a date range. Both ends optional; omitting them asks
  /// for the server's own default window.
  Future<List<Booking>> bookings({String? fromDate, String? toDate});

  Future<Booking> booking(int id);

  /// The primary guest's uploaded ID proof, raw bytes plus content type.
  Future<Response<List<int>>> idProof(int bookingId);

  Future<Response<List<int>>> guestIdProof(int bookingId, int guestId);

  Future<Booking> createBooking(FormData form);

  Future<Booking> checkIn(int id, FormData form);

  /// Rooms free for an edit — this booking's own occupancy excluded, so the
  /// room it is already in reads as free rather than conflicting with
  /// itself.
  Future<List<Room>> availableRoomsForBooking(
    int bookingId, {
    required String checkOutDate,
    String? checkInDate,
  });

  /// Correct a booking already on file.
  Future<Booking> updateBooking(int id, FormData form);

  Future<LateCheckout> lateCheckout(int id);

  Future<Booking> checkOut(int id, Map<String, dynamic> body);

  /// Call off a reservation. Only a BOOKED stay can be cancelled. [body]
  /// settles whatever advance was on file.
  Future<Booking> cancel(int id, [Map<String, dynamic>? body]);
}
