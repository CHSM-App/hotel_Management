import 'package:dio/dio.dart';

import '../models/booking.dart';
import '../models/late_checkout.dart';
import '../models/quote.dart';
import '../models/room.dart';

abstract class BookingRepository {
  Future<List<Room>> availableRooms(String checkInDate, String checkOutDate);

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

  Future<Booking> createBooking(FormData form);

  Future<Booking> checkIn(int id, FormData form);

  Future<LateCheckout> lateCheckout(int id);

  Future<Booking> checkOut(int id, Map<String, dynamic> body);

  /// Call off a reservation. Only a BOOKED stay can be cancelled.
  Future<Booking> cancel(int id);
}
