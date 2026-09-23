library;

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/event_booking.dart';
import '../../domain/models/invoice.dart';
import '../../domain/usecase/events_usecase.dart';

/// Events & functions — one notifier for the whole section (List, Setup and
/// the function detail sheet), the way Events.jsx keeps venues/addons/list
/// state in one component and passes them down rather than each tab owning
/// its own copy. [bumps] plays the same part `bumps` does there: anything
/// that changes a function increments it, and screens that show one just
/// re-read after.
class EventsState {
  final bool isLoading;
  final String? error;
  final List<EventBooking> events;
  final List<EventVenue> venues;
  final List<EventAddon> addons;
  final bool catalogueLoading;
  final bool submitting;
  final int bumps;

  const EventsState({
    this.isLoading = false,
    this.error,
    this.events = const [],
    this.venues = const [],
    this.addons = const [],
    this.catalogueLoading = false,
    this.submitting = false,
    this.bumps = 0,
  });

  EventsState copyWith({
    bool? isLoading,
    String? error,
    bool clearError = false,
    List<EventBooking>? events,
    List<EventVenue>? venues,
    List<EventAddon>? addons,
    bool? catalogueLoading,
    bool? submitting,
    int? bumps,
  }) => EventsState(
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : (error ?? this.error),
    events: events ?? this.events,
    venues: venues ?? this.venues,
    addons: addons ?? this.addons,
    catalogueLoading: catalogueLoading ?? this.catalogueLoading,
    submitting: submitting ?? this.submitting,
    bumps: bumps ?? this.bumps,
  );

  /// Active venues, plus any inactive one still in [alsoKeep] — the same
  /// rule the web venue picker applies so a function already on a retired
  /// venue doesn't lose the ability to show its own name.
  List<EventVenue> pickableVenues([String? alsoKeep]) => venues
      .where((v) => v.isActive || v.id.toString() == alsoKeep)
      .toList();

  List<EventAddon> get activeAddons => addons.where((a) => a.isActive).toList();
}

class EventsViewModel extends StateNotifier<EventsState> {
  final EventsUsecase usecase;

  EventsViewModel(this.usecase) : super(const EventsState());

  Future<void> loadCatalogue() async {
    state = state.copyWith(catalogueLoading: true, clearError: true);
    try {
      final results = await Future.wait([
        usecase.venues(includeInactive: true),
        usecase.addons(includeInactive: true),
      ]);
      state = state.copyWith(
        catalogueLoading: false,
        venues: results[0] as List<EventVenue>,
        addons: results[1] as List<EventAddon>,
      );
    } catch (e) {
      state = state.copyWith(catalogueLoading: false, error: apiErrorMessage(e));
    }
  }

  Future<void> loadEvents({
    String? fromDate,
    String? toDate,
    String? status,
    int? venueId,
    bool includeClosed = true,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final events = await usecase.events(
        fromDate: fromDate,
        toDate: toDate,
        status: status,
        venueId: venueId,
        includeClosed: includeClosed,
      );
      state = state.copyWith(isLoading: false, events: events);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
    }
  }

  void _bump() => state = state.copyWith(bumps: state.bumps + 1);

  // ── Setup: venues ──────────────────────────────────────────────────────

  Future<bool> saveVenue(FormData form, {int? id}) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateVenue(id, form);
      } else {
        await usecase.createVenue(form);
      }
      state = state.copyWith(submitting: false);
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> toggleVenue(EventVenue venue) async {
    try {
      await usecase.setVenueActive(venue.id, !venue.isActive);
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> deleteVenueImage(int venueId, int imageId) async {
    try {
      await usecase.deleteVenueImage(venueId, imageId);
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  // ── Setup: add-ons ─────────────────────────────────────────────────────

  Future<bool> saveAddon({int? id, required String name, required num defaultAmount, bool isPerUnit = false}) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateAddon(id, name: name, defaultAmount: defaultAmount, isPerUnit: isPerUnit);
      } else {
        await usecase.createAddon(name: name, defaultAmount: defaultAmount, isPerUnit: isPerUnit);
      }
      state = state.copyWith(submitting: false);
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> toggleAddon(EventAddon addon) async {
    try {
      await usecase.updateAddon(addon.id, isActive: !addon.isActive);
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  // ── A function's own form/detail ───────────────────────────────────────

  Future<EventAvailability?> checkAvailability({
    required int venueId,
    required String startAt,
    required String endAt,
    int? excludeId,
  }) async {
    try {
      return await usecase.availability(
        venueId: venueId,
        startAt: startAt,
        endAt: endAt,
        excludeId: excludeId,
      );
    } catch (_) {
      return null;
    }
  }

  Future<EventQuoteResult?> fetchQuote(Map<String, dynamic> body) async {
    try {
      return await usecase.quote(body);
    } catch (_) {
      return null;
    }
  }

  Future<EventBooking?> fetchEvent(int id) async {
    try {
      return await usecase.event(id);
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return null;
    }
  }

  Future<EventBooking?> createEvent(Map<String, dynamic> body) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      final event = await usecase.createEvent(body);
      state = state.copyWith(submitting: false);
      _bump();
      return event;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return null;
    }
  }

  Future<EventBooking?> updateEvent(int id, Map<String, dynamic> body) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      final event = await usecase.updateEvent(id, body);
      state = state.copyWith(submitting: false);
      _bump();
      return event;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return null;
    }
  }

  Future<EventBooking?> addExtra(int id, {required String label, int quantity = 1, num? agreedAmount}) async {
    try {
      final event = await usecase.addExtra(id, label: label, quantity: quantity, agreedAmount: agreedAmount);
      _bump();
      return event;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return null;
    }
  }

  Future<EventBooking?> priceExtra(int id, int lineId, num agreedAmount) async {
    try {
      final event = await usecase.priceExtra(id, lineId, agreedAmount);
      _bump();
      return event;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return null;
    }
  }

  Future<EventBooking?> removeExtra(int id, int lineId) async {
    try {
      final event = await usecase.removeExtra(id, lineId);
      _bump();
      return event;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return null;
    }
  }

  Future<EventBooking?> hold(int id, {int holdHours = 48}) => _transition(() => usecase.hold(id, holdHours: holdHours));

  Future<EventBooking?> confirm(int id) => _transition(() => usecase.confirm(id));

  Future<EventBooking?> release(int id) => _transition(() => usecase.release(id));

  Future<EventBooking?> cancel(int id, {required String reason, num? refundAmount}) =>
      _transition(() => usecase.cancel(id, reason: reason, refundAmount: refundAmount));

  Future<EventBooking?> _transition(Future<EventBooking> Function() run) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      final event = await run();
      state = state.copyWith(submitting: false);
      _bump();
      return event;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return null;
    }
  }

  Future<List<AdvanceReceipt>> advanceReceipts(int eventId) async {
    try {
      return await usecase.advanceReceipts(eventId);
    } catch (_) {
      return const [];
    }
  }

  Future<AdvanceReceipt?> issueAdvanceReceipt(int eventId, Map<String, dynamic> body) async {
    try {
      final receipt = await usecase.issueAdvanceReceipt(eventId, body);
      _bump();
      return receipt;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return null;
    }
  }

  void clearError() => state = state.copyWith(clearError: true);
}
