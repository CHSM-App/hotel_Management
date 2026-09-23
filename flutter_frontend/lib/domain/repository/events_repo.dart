import 'package:dio/dio.dart';

import '../models/event_booking.dart';
import '../models/invoice.dart';

/// Events & functions — mirrors Events.jsx/EventForm.jsx/EventDetail.jsx.
abstract class EventsRepository {
  Future<List<EventVenue>> venues({bool includeInactive = false});

  Future<void> createVenue(FormData form);

  Future<void> updateVenue(int id, FormData form);

  Future<void> setVenueActive(int id, bool isActive);

  Future<void> deleteVenueImage(int venueId, int imageId);

  Future<List<EventAddon>> addons({bool includeInactive = false});

  Future<void> createAddon({
    required String name,
    required num defaultAmount,
    bool isPerUnit = false,
  });

  Future<void> updateAddon(
    int id, {
    String? name,
    num? defaultAmount,
    bool? isPerUnit,
    bool? isActive,
  });

  Future<EventAvailability> availability({
    required int venueId,
    required String startAt,
    required String endAt,
    int? excludeId,
  });

  Future<EventQuoteResult> quote(Map<String, dynamic> body);

  Future<List<EventBooking>> events({
    String? fromDate,
    String? toDate,
    String? status,
    int? venueId,
    bool includeClosed = false,
  });

  Future<EventBooking> event(int id);

  Future<EventBooking> createEvent(Map<String, dynamic> body);

  Future<EventBooking> updateEvent(int id, Map<String, dynamic> body);

  Future<EventBooking> addExtra(
    int id, {
    required String label,
    int quantity = 1,
    num? agreedAmount,
  });

  Future<EventBooking> priceExtra(int id, int lineId, num agreedAmount);

  Future<EventBooking> removeExtra(int id, int lineId);

  Future<EventBooking> hold(int id, {int holdHours = 48});

  Future<EventBooking> confirm(int id);

  Future<EventBooking> release(int id);

  Future<EventBooking> cancel(int id, {required String reason, num? refundAmount});

  Future<List<AdvanceReceipt>> advanceReceipts(int eventId);

  Future<AdvanceReceipt> issueAdvanceReceipt(int eventId, Map<String, dynamic> body);
}
