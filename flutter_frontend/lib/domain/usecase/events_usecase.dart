import '../models/event_booking.dart';
import '../models/invoice.dart';
import '../repository/events_repo.dart';

class EventsUsecase {
  final EventsRepository repository;

  EventsUsecase(this.repository);

  Future<List<EventVenue>> venues({bool includeInactive = false}) =>
      repository.venues(includeInactive: includeInactive);

  Future<void> createVenue({
    required String name,
    int? capacityPax,
    required num baseCharge,
  }) => repository.createVenue(name: name, capacityPax: capacityPax, baseCharge: baseCharge);

  Future<void> updateVenue(
    int id, {
    String? name,
    int? capacityPax,
    num? baseCharge,
    bool? isActive,
  }) => repository.updateVenue(
    id,
    name: name,
    capacityPax: capacityPax,
    baseCharge: baseCharge,
    isActive: isActive,
  );

  Future<List<EventAddon>> addons({bool includeInactive = false}) =>
      repository.addons(includeInactive: includeInactive);

  Future<void> createAddon({
    required String name,
    required num defaultAmount,
    bool isPerUnit = false,
  }) => repository.createAddon(name: name, defaultAmount: defaultAmount, isPerUnit: isPerUnit);

  Future<void> updateAddon(
    int id, {
    String? name,
    num? defaultAmount,
    bool? isPerUnit,
    bool? isActive,
  }) => repository.updateAddon(
    id,
    name: name,
    defaultAmount: defaultAmount,
    isPerUnit: isPerUnit,
    isActive: isActive,
  );

  Future<EventAvailability> availability({
    required int venueId,
    required String startAt,
    required String endAt,
    int? excludeId,
  }) => repository.availability(
    venueId: venueId,
    startAt: startAt,
    endAt: endAt,
    excludeId: excludeId,
  );

  Future<EventQuoteResult> quote(Map<String, dynamic> body) => repository.quote(body);

  Future<List<EventBooking>> events({
    String? fromDate,
    String? toDate,
    String? status,
    int? venueId,
    bool includeClosed = false,
  }) => repository.events(
    fromDate: fromDate,
    toDate: toDate,
    status: status,
    venueId: venueId,
    includeClosed: includeClosed,
  );

  Future<EventBooking> event(int id) => repository.event(id);

  Future<EventBooking> createEvent(Map<String, dynamic> body) => repository.createEvent(body);

  Future<EventBooking> updateEvent(int id, Map<String, dynamic> body) =>
      repository.updateEvent(id, body);

  Future<EventBooking> addExtra(
    int id, {
    required String label,
    int quantity = 1,
    num? agreedAmount,
  }) => repository.addExtra(id, label: label, quantity: quantity, agreedAmount: agreedAmount);

  Future<EventBooking> priceExtra(int id, int lineId, num agreedAmount) =>
      repository.priceExtra(id, lineId, agreedAmount);

  Future<EventBooking> removeExtra(int id, int lineId) => repository.removeExtra(id, lineId);

  Future<EventBooking> hold(int id, {int holdHours = 48}) =>
      repository.hold(id, holdHours: holdHours);

  Future<EventBooking> confirm(int id) => repository.confirm(id);

  Future<EventBooking> release(int id) => repository.release(id);

  Future<EventBooking> cancel(int id, {required String reason, num? refundAmount}) =>
      repository.cancel(id, reason: reason, refundAmount: refundAmount);

  Future<List<AdvanceReceipt>> advanceReceipts(int eventId) =>
      repository.advanceReceipts(eventId);

  Future<AdvanceReceipt> issueAdvanceReceipt(int eventId, Map<String, dynamic> body) =>
      repository.issueAdvanceReceipt(eventId, body);
}
