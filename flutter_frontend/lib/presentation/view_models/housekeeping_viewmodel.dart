library;

import 'dart:async';

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
  // Which single room/venue or issue has a request in flight — lets the
  // board disable and spin just the row being acted on instead of every
  // row on the screen going into "busy" together.
  final int? busyRoomId;
  // Keyed by HousekeepingIssue.key (logId:kind), not logId alone — a finish-
  // cleaning submission with both a problem and a found item logs them under
  // the same logId, so logId alone can't tell which one is in flight.
  final String? busyIssueKey;

  const HousekeepingState({
    this.roomsLoading = false,
    this.issuesLoading = false,
    this.error,
    this.rooms = const [],
    this.venues = const [],
    this.issues = const [],
    this.issueSummary = const OpenIssueSummary(),
    this.submitting = false,
    this.busyRoomId,
    this.busyIssueKey,
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
    int? busyRoomId,
    bool clearBusyRoomId = false,
    String? busyIssueKey,
    bool clearBusyIssueKey = false,
  }) => HousekeepingState(
    roomsLoading: roomsLoading ?? this.roomsLoading,
    issuesLoading: issuesLoading ?? this.issuesLoading,
    error: clearError ? null : (error ?? this.error),
    rooms: rooms ?? this.rooms,
    venues: venues ?? this.venues,
    issues: issues ?? this.issues,
    issueSummary: issueSummary ?? this.issueSummary,
    submitting: submitting ?? this.submitting,
    busyRoomId: clearBusyRoomId ? null : (busyRoomId ?? this.busyRoomId),
    busyIssueKey: clearBusyIssueKey ? null : (busyIssueKey ?? this.busyIssueKey),
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

  // A mutation that already succeeded must not be left looking unchanged on
  // screen just because the refresh right after it hit one bad network
  // beat — so the refresh gets a few quick retries of its own before it's
  // allowed to give up and wait for the next periodic reload.
  Future<void> _reloadBoard() async {
    for (var attempt = 0; attempt < 3; attempt++) {
      await Future.wait([loadRooms(), loadVenues(), loadIssueSummary()]);
      if (state.error == null) return;
      await Future.delayed(Duration(milliseconds: 500 * (attempt + 1)));
    }
  }

  Future<void> _reloadIssues() async {
    for (var attempt = 0; attempt < 3; attempt++) {
      await Future.wait([loadIssues(), loadIssueSummary()]);
      if (state.error == null) return;
      await Future.delayed(Duration(milliseconds: 500 * (attempt + 1)));
    }
  }

  // A room/venue's new status, right after an action that is known to
  // succeed server-side — applied immediately so "Start cleaning" shows
  // "Finish" straight away and a finished room leaves the to-clean list
  // without waiting on a round trip, mirroring roomStatusOf in
  // housekeeping.service.js. `null` fields are explicit clears, not "leave
  // as is" — every field the transition touches is always passed.
  HousekeepingRoom _withStatus(
    HousekeepingRoom r, {
    required String status,
    String? cleaningStartedAt,
    String? cleaningBy,
    String? cleanedAt,
    String? outOfOrderNote,
    String? dirtySince,
  }) => HousekeepingRoom(
    id: r.id,
    kind: r.kind,
    roomNumber: r.roomNumber,
    categoryName: r.categoryName,
    floor: r.floor,
    guestName: r.guestName,
    guestCheckOut: r.guestCheckOut,
    guestsIn: r.guestsIn,
    leavingToday: r.leavingToday,
    cleanedAt: cleanedAt ?? r.cleanedAt,
    cleanedBy: r.cleanedBy,
    openIssues: r.openIssues,
    status: status,
    arrivingToday: r.arrivingToday,
    cleaningBy: cleaningBy,
    cleaningStartedAt: cleaningStartedAt,
    outOfOrderNote: outOfOrderNote,
    lastCleanedAt: r.lastCleanedAt,
    dirtySince: dirtySince,
    eventTitle: r.eventTitle,
    eventEndsAt: r.eventEndsAt,
    nextEventTitle: r.nextEventTitle,
    nextEventAt: r.nextEventAt,
  );

  List<HousekeepingRoom> _patchList(List<HousekeepingRoom> list, int roomId, HousekeepingRoom Function(HousekeepingRoom) patch) => [
    for (final r in list) if (r.id == roomId) patch(r) else r,
  ];

  Future<bool> _run(int roomId, Future<void> Function() action, {HousekeepingRoom Function(HousekeepingRoom)? patch}) async {
    state = state.copyWith(submitting: true, busyRoomId: roomId, clearError: true);
    try {
      await action();
      state = state.copyWith(
        submitting: false,
        clearBusyRoomId: true,
        rooms: patch == null ? null : _patchList(state.rooms, roomId, patch),
        venues: patch == null ? null : _patchList(state.venues, roomId, patch),
      );
      // Authoritative refresh in the background — its failure (a network
      // blip) must not undo the optimistic update above.
      unawaited(_reloadBoard());
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, clearBusyRoomId: true, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> startCleaning(int roomId) => _run(
    roomId,
    () => usecase.startCleaning(roomId),
    patch: (r) => _withStatus(r, status: 'CLEANING', cleaningStartedAt: DateTime.now().toIso8601String()),
  );

  Future<bool> releaseRoom(int roomId) => _run(roomId, () => usecase.releaseRoom(roomId), patch: (r) => _withStatus(r, status: 'DIRTY', dirtySince: r.dirtySince));

  Future<bool> finishCleaning(int roomId, Map<String, dynamic> body) => _run(
    roomId,
    () => usecase.finishCleaning(roomId, body),
    patch: (r) => body['blockRoom'] == true
        ? _withStatus(r, status: 'OUT_OF_ORDER', outOfOrderNote: body['issues'] as String?, cleanedAt: DateTime.now().toIso8601String())
        : _withStatus(r, status: 'READY', cleanedAt: DateTime.now().toIso8601String()),
  );

  Future<bool> markDirty(int roomId) =>
      _run(roomId, () => usecase.markDirty(roomId), patch: (r) => _withStatus(r, status: 'DIRTY', dirtySince: r.dirtySince ?? DateTime.now().toIso8601String()));

  Future<bool> setOutOfOrder(int roomId, Map<String, dynamic> body) => _run(
    roomId,
    () => usecase.setOutOfOrder(roomId, body),
    patch: (r) => body['outOfOrder'] == true
        ? _withStatus(r, status: 'OUT_OF_ORDER', outOfOrderNote: body['note'] as String?)
        : _withStatus(r, status: 'DIRTY', dirtySince: DateTime.now().toIso8601String()),
  );

  Future<bool> startVenueCleaning(int venueId) => _run(
    venueId,
    () => usecase.startVenueCleaning(venueId),
    patch: (r) => _withStatus(r, status: 'CLEANING', cleaningStartedAt: DateTime.now().toIso8601String()),
  );

  Future<bool> releaseVenue(int venueId) => _run(venueId, () => usecase.releaseVenue(venueId), patch: (r) => _withStatus(r, status: 'DIRTY', dirtySince: r.dirtySince));

  Future<bool> finishVenueCleaning(int venueId, Map<String, dynamic> body) => _run(
    venueId,
    () => usecase.finishVenueCleaning(venueId, body),
    patch: (r) => body['blockRoom'] == true
        ? _withStatus(r, status: 'OUT_OF_ORDER', outOfOrderNote: body['issues'] as String?, cleanedAt: DateTime.now().toIso8601String())
        : _withStatus(r, status: 'READY', cleanedAt: DateTime.now().toIso8601String()),
  );

  Future<bool> markVenueDirty(int venueId) =>
      _run(venueId, () => usecase.markVenueDirty(venueId), patch: (r) => _withStatus(r, status: 'DIRTY', dirtySince: r.dirtySince ?? DateTime.now().toIso8601String()));

  Future<bool> setVenueOutOfOrder(int venueId, Map<String, dynamic> body) => _run(
    venueId,
    () => usecase.setVenueOutOfOrder(venueId, body),
    patch: (r) => body['outOfOrder'] == true
        ? _withStatus(r, status: 'OUT_OF_ORDER', outOfOrderNote: body['note'] as String?)
        : _withStatus(r, status: 'DIRTY', dirtySince: DateTime.now().toIso8601String()),
  );

  Future<bool> closeIssue(int logId, Map<String, dynamic> body) async {
    final kind = body['kind'] as String;
    final key = '$logId:$kind';
    state = state.copyWith(submitting: true, busyIssueKey: key, clearError: true);
    try {
      await usecase.closeIssue(logId, body);
      // Reflect the close in the list right away: the mutation already
      // succeeded, and a flaky follow-up refresh must not leave a closed
      // issue looking open until something else happens to reload the tab.
      state = state.copyWith(
        submitting: false,
        clearBusyIssueKey: true,
        issues: [
          for (final i in state.issues)
            if (i.key == key)
              HousekeepingIssue(
                logId: i.logId,
                roomId: i.roomId,
                roomNumber: i.roomNumber,
                space: i.space,
                kind: i.kind,
                text: i.text,
                reportedAt: i.reportedAt,
                reportedBy: i.reportedBy,
                closedAt: DateTime.now().toIso8601String(),
                closedBy: i.closedBy,
                resolution: (body['note'] as String?)?.isNotEmpty == true ? body['note'] as String : i.resolution,
                roomBlocked: i.roomBlocked,
              )
            else
              i,
        ],
      );
      // Authoritative refresh in the background — its failure (a network
      // blip) must not undo the optimistic update above.
      unawaited(_reloadIssues());
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, clearBusyIssueKey: true, error: apiErrorMessage(e));
      return false;
    }
  }

  void clearError() => state = state.copyWith(clearError: true);
}
