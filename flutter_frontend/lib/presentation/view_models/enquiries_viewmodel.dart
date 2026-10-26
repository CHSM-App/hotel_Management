library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/enquiry.dart';
import '../../domain/usecase/enquiries_usecase.dart';

/// The Enquiries inbox — mirrors Enquiries.jsx: one list load, then the
/// status filter, search and sort are all applied client-side.
class EnquiriesState {
  final bool isLoading;
  final String? error;

  /// Null until the first load finishes, so "No enquiries yet" is never shown
  /// for a list that simply hasn't arrived.
  final List<Enquiry>? rows;

  /// Which enquiry a status change is in flight for.
  final int? busyId;

  const EnquiriesState({
    this.isLoading = false,
    this.error,
    this.rows,
    this.busyId,
  });

  EnquiriesState copyWith({
    bool? isLoading,
    String? error,
    bool clearError = false,
    List<Enquiry>? rows,
    int? busyId,
    bool clearBusy = false,
  }) => EnquiriesState(
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : (error ?? this.error),
    rows: rows ?? this.rows,
    busyId: clearBusy ? null : (busyId ?? this.busyId),
  );
}

class EnquiriesViewModel extends StateNotifier<EnquiriesState> {
  final EnquiriesUsecase usecase;

  EnquiriesViewModel(this.usecase) : super(const EnquiriesState());

  Future<void> load() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final rows = await usecase.enquiries();
      state = state.copyWith(isLoading: false, rows: rows);
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: apiErrorMessage(e),
        // Keep an empty list rather than null, so a failed first load shows
        // the error and not an endless spinner.
        rows: state.rows ?? const [],
      );
    }
  }

  /// Moves one enquiry to [status]; true when the server took it. The caller
  /// refreshes the alert bell afterwards.
  Future<bool> setStatus(int id, String status) async {
    state = state.copyWith(busyId: id, clearError: true);
    try {
      final updated = await usecase.updateStatus(id, status);
      state = state.copyWith(
        clearBusy: true,
        rows: [
          for (final r in state.rows ?? const <Enquiry>[])
            r.id == id ? updated : r,
        ],
      );
      return true;
    } catch (e) {
      state = state.copyWith(clearBusy: true, error: apiErrorMessage(e));
      return false;
    }
  }
}
