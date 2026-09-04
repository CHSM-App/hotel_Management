import 'package:dio/dio.dart';

import '../models/booking.dart';
import '../models/late_checkout.dart';
import '../models/quote.dart';
import '../models/room.dart';
import '../repository/booking_repo.dart';

class BookingUsecase {
  final BookingRepository repository;

  BookingUsecase(this.repository);

  /// Which rooms are free across these nights.
  Future<List<Room>> availableRooms(String checkIn, String checkOut) =>
      repository.availableRooms(checkIn, checkOut);

  /// What this stay would cost.
  Future<Quote> priceQuote({
    required int roomId,
    required String checkInDate,
    required String checkOutDate,
    String? chargeIds,
    num? basePriceOverride,
    num? discountAmount,
  }) => repository.priceQuote(
    roomId: roomId,
    checkInDate: checkInDate,
    checkOutDate: checkOutDate,
    chargeIds: chargeIds,
    basePriceOverride: basePriceOverride,
    discountAmount: discountAmount,
  );

  /// The register, over the nights the desk asked about.
  Future<List<Booking>> bookings({String? fromDate, String? toDate}) =>
      repository.bookings(fromDate: fromDate, toDate: toDate);

  /// One stay, in full.
  Future<Booking> booking(int id) => repository.booking(id);

  /// Take the booking.
  Future<Booking> createBooking(FormData form) =>
      repository.createBooking(form);

  /// Check the guest in.
  Future<Booking> checkIn(int id, FormData form) =>
      repository.checkIn(id, form);

  /// How late the guest is, and what that is worth.
  Future<LateCheckout> lateCheckout(int id) => repository.lateCheckout(id);

  /// Check the guest out, charging whatever reception settled on for the
  /// overstay — zero when they were on time or it was waived.
  Future<Booking> checkOut(int id, {num lateCharge = 0}) =>
      repository.checkOut(id, {'lateCharge': lateCharge});

  /// Call off a reservation. Only a stay still sitting at BOOKED can be
  /// cancelled; the server answers 409 for anything further along.
  Future<Booking> cancel(int id) => repository.cancel(id);
}
