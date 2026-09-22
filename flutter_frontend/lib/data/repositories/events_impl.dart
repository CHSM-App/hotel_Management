import '../../domain/models/event_booking.dart';
import '../../domain/models/invoice.dart';
import '../../domain/repository/events_repo.dart';
import '../api/api_service.dart';

class EventsImpl implements EventsRepository {
  final ApiService api;

  EventsImpl(this.api);

  @override
  Future<List<EventVenue>> venues({bool includeInactive = false}) =>
      api.eventVenues(includeInactive: includeInactive);

  @override
  Future<void> createVenue({
    required String name,
    int? capacityPax,
    required num baseCharge,
  }) => api.createEventVenue(name: name, capacityPax: capacityPax, baseCharge: baseCharge);

  @override
  Future<void> updateVenue(
    int id, {
    String? name,
    int? capacityPax,
    num? baseCharge,
    bool? isActive,
  }) => api.updateEventVenue(
    id,
    name: name,
    capacityPax: capacityPax,
    baseCharge: baseCharge,
    isActive: isActive,
  );

  @override
  Future<List<EventAddon>> addons({bool includeInactive = false}) =>
      api.eventAddons(includeInactive: includeInactive);

  @override
  Future<void> createAddon({
    required String name,
    required num defaultAmount,
    bool isPerUnit = false,
  }) => api.createEventAddon(name: name, defaultAmount: defaultAmount, isPerUnit: isPerUnit);

  @override
  Future<void> updateAddon(
    int id, {
    String? name,
    num? defaultAmount,
    bool? isPerUnit,
    bool? isActive,
  }) => api.updateEventAddon(
    id,
    name: name,
    defaultAmount: defaultAmount,
    isPerUnit: isPerUnit,
    isActive: isActive,
  );

  @override
  Future<EventAvailability> availability({
    required int venueId,
    required String startAt,
    required String endAt,
    int? excludeId,
  }) => api.eventAvailability(
    venueId: venueId,
    startAt: startAt,
    endAt: endAt,
    excludeId: excludeId,
  );

  @override
  Future<EventQuoteResult> quote(Map<String, dynamic> body) => api.eventQuote(body);

  @override
  Future<List<EventBooking>> events({
    String? fromDate,
    String? toDate,
    String? status,
    int? venueId,
    bool includeClosed = false,
  }) => api.events(
    fromDate: fromDate,
    toDate: toDate,
    status: status,
    venueId: venueId,
    includeClosed: includeClosed,
  );

  @override
  Future<EventBooking> event(int id) => api.event(id);

  @override
  Future<EventBooking> createEvent(Map<String, dynamic> body) => api.createEvent(body);

  @override
  Future<EventBooking> updateEvent(int id, Map<String, dynamic> body) =>
      api.updateEvent(id, body);

  @override
  Future<EventBooking> addExtra(
    int id, {
    required String label,
    int quantity = 1,
    num? agreedAmount,
  }) => api.addEventExtra(id, label: label, quantity: quantity, agreedAmount: agreedAmount);

  @override
  Future<EventBooking> priceExtra(int id, int lineId, num agreedAmount) =>
      api.priceEventExtra(id, lineId, agreedAmount);

  @override
  Future<EventBooking> removeExtra(int id, int lineId) => api.removeEventExtra(id, lineId);

  @override
  Future<EventBooking> hold(int id, {int holdHours = 48}) =>
      api.holdEvent(id, holdHours: holdHours);

  @override
  Future<EventBooking> confirm(int id) => api.confirmEvent(id);

  @override
  Future<EventBooking> release(int id) => api.releaseEvent(id);

  @override
  Future<EventBooking> cancel(int id, {required String reason, num? refundAmount}) =>
      api.cancelEvent(id, reason: reason, refundAmount: refundAmount);

  @override
  Future<List<AdvanceReceipt>> advanceReceipts(int eventId) =>
      api.eventAdvanceReceipts(eventId);

  @override
  Future<AdvanceReceipt> issueAdvanceReceipt(int eventId, Map<String, dynamic> body) =>
      api.issueEventAdvanceReceipt(eventId, body);
}
