import 'package:dio/dio.dart';

import '../models/booking.dart';
import '../models/draft.dart';
import '../models/late_checkout.dart';
import '../models/quote.dart';
import '../models/room.dart';
import '../models/tape_chart.dart';
import '../repository/booking_repo.dart';

class BookingUsecase {
  final BookingRepository repository;

  BookingUsecase(this.repository);

  /// Which rooms are free across these nights.
  Future<List<Room>> availableRooms(String checkIn, String checkOut) =>
      repository.availableRooms(checkIn, checkOut);

  /// The tape chart's own fetch.
  Future<TapeChartData> tapeChart({
    required String startDate,
    required String endDate,
  }) => repository.tapeChart(startDate: startDate, endDate: endDate);

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

  /// The primary guest's uploaded ID proof, raw bytes plus content type.
  Future<Response<List<int>>> idProof(int bookingId) =>
      repository.idProof(bookingId);

  Future<Response<List<int>>> guestIdProof(int bookingId, int guestId) =>
      repository.guestIdProof(bookingId, guestId);

  /// Take the booking.
  Future<Booking> createBooking(FormData form) =>
      repository.createBooking(form);

  /// Check the guest in.
  Future<Booking> checkIn(int id, FormData form) =>
      repository.checkIn(id, form);

  /// Rooms free for an edit of this booking.
  Future<List<Room>> availableRoomsForBooking(
    int bookingId, {
    required String checkOutDate,
    String? checkInDate,
  }) => repository.availableRoomsForBooking(
    bookingId,
    checkOutDate: checkOutDate,
    checkInDate: checkInDate,
  );

  /// Correct a booking already on file.
  Future<Booking> updateBooking(int id, FormData form) =>
      repository.updateBooking(id, form);

  /// How late the guest is, and what that is worth.
  Future<LateCheckout> lateCheckout(int id) => repository.lateCheckout(id);

  /// Check the guest out, charging whatever reception settled on for the
  /// overstay — zero when they were on time or it was waived.
  Future<Booking> checkOut(int id, {num lateCharge = 0}) =>
      repository.checkOut(id, {'lateCharge': lateCharge});

  /// Call off a reservation. Only a stay still sitting at BOOKED can be
  /// cancelled; the server answers 409 for anything further along.
  Future<Booking> cancel(int id, [Map<String, dynamic>? body]) =>
      repository.cancel(id, body);

  /// Every parked booking on this property.
  Future<List<BookingDraft>> drafts() => repository.drafts();

  /// One parked booking, in full — its form, for reopening it.
  Future<BookingDraft> draft(int id) => repository.draft(id);

  /// Park a new booking form.
  Future<BookingDraft> createDraft(Map<String, dynamic> form) =>
      repository.createDraft(form);

  /// Update a parked booking form already on file.
  Future<BookingDraft> updateDraft(int id, Map<String, dynamic> form) =>
      repository.updateDraft(id, form);

  /// Throw away a parked booking form.
  Future<void> deleteDraft(int id) => repository.deleteDraft(id);
}
