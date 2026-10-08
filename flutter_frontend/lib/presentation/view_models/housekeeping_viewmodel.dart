library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/housekeeping.dart';
import '../../domain/usecase/housekeeping_usecase.dart';

/// Housekeeping — the room board and its issues log in one notifier, the way
/// HousekeepingPanel.jsx keeps both tabs' state in one component tree.
class HousekeepingState {
  final bool roomsLoading;
  final bool issuesLoading;
  final String? error;
  final List<HousekeepingRoom> rooms;
  // Event venues on the same board — empty wherever Events is off, same as
  // the web's `venues` state in HousekeepingPanel.jsx.
  final List<HousekeepingRoom> venues;
  final List<HousekeepingIssue> issues;
  final OpenIssueSummary issueSummary;
  final bool submitting;

  const HousekeepingState({
    this.roomsLoading = false,
    this.issuesLoading = false,
    this.error,
    this.rooms = const [],
    this.venues = const [],
    this.issues = const [],
    this.issueSummary = const OpenIssueSummary(),
    this.submitting = false,
  });

  HousekeepingState copyWith({
    bool? roomsLoading,
    bool? issuesLoading,
    String? error,
    bool clearError = false,
    List<HousekeepingRoom>? rooms,
    List<HousekeepingRoom>? venues,
    List<HousekeepingIssue>? issues,
    OpenIssueSummary? issueSummary,
    bool? submitting,
  }) => HousekeepingState(
    roomsLoading: roomsLoading ?? this.roomsLoading,
    issuesLoading: issuesLoading ?? this.issuesLoading,
    error: clearError ? null : (error ?? this.error),
    rooms: rooms ?? this.rooms,
    venues: venues ?? this.venues,
    issues: issues ?? this.issues,
    issueSummary: issueSummary ?? this.issueSummary,
    submitting: submitting ?? this.submitting,
  );
}

class HousekeepingViewModel extends StateNotifier<HousekeepingState> {
  final HousekeepingUsecase usecase;

  HousekeepingViewModel(this.usecase) : super(const HousekeepingState());

  Future<void> loadRooms() async {
    state = state.copyWith(roomsLoading: true, clearError: true);
    try {
      final rooms = await usecase.rooms();
      state = state.copyWith(roomsLoading: false, rooms: rooms);
    } catch (e) {
      state = state.copyWith(roomsLoading: false, error: apiErrorMessage(e));
    }
  }

  Future<void> loadVenues() async {
    try {
      state = state.copyWith(venues: await usecase.venues());
    } catch (_) {
      // A venue list that fails must not take the rooms board down with it —
      // mirrors the web's own `.catch(() => ({ venues: [] }))`.
    }
  }

  Future<void> loadIssues() async {
    state = state.copyWith(issuesLoading: true, clearError: true);
    try {
      final issues = await usecase.issues(scope: 'all');
      state = state.copyWith(issuesLoading: false, issues: issues);
    } catch (e) {
      state = state.copyWith(issuesLoading: false, error: apiErrorMessage(e));
    }
  }

  Future<void> loadIssueSummary() async {
    try {
      state = state.copyWith(issueSummary: await usecase.openIssueSummary());
    } catch (_) {
      // The badge is a convenience; the Issues tab itself still loads fully.
    }
  }

  Future<bool> _run(Future<void> Function() action) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await action();
      state = state.copyWith(submitting: false);
      await Future.wait([loadRooms(), loadVenues(), loadIssueSummary()]);
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> startCleaning(int roomId) => _run(() => usecase.startCleaning(roomId));

  Future<bool> releaseRoom(int roomId) => _run(() => usecase.releaseRoom(roomId));

  Future<bool> finishCleaning(int roomId, Map<String, dynamic> body) => _run(() => usecase.finishCleaning(roomId, body));

  Future<bool> markDirty(int roomId) => _run(() => usecase.markDirty(roomId));

  Future<bool> setOutOfOrder(int roomId, Map<String, dynamic> body) => _run(() => usecase.setOutOfOrder(roomId, body));

  Future<bool> startVenueCleaning(int venueId) => _run(() => usecase.startVenueCleaning(venueId));

  Future<bool> releaseVenue(int venueId) => _run(() => usecase.releaseVenue(venueId));

  Future<bool> finishVenueCleaning(int venueId, Map<String, dynamic> body) => _run(() => usecase.finishVenueCleaning(venueId, body));

  Future<bool> markVenueDirty(int venueId) => _run(() => usecase.markVenueDirty(venueId));

  Future<bool> setVenueOutOfOrder(int venueId, Map<String, dynamic> body) => _run(() => usecase.setVenueOutOfOrder(venueId, body));

  Future<bool> closeIssue(int logId, Map<String, dynamic> body) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await usecase.closeIssue(logId, body);
      state = state.copyWith(submitting: false);
      await Future.wait([loadIssues(), loadIssueSummary()]);
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  void clearError() => state = state.copyWith(clearError: true);
}
