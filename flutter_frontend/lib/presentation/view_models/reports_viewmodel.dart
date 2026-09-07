import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/report.dart';
import '../../domain/usecase/reports_usecase.dart';
import 'rooms_viewmodel.dart' show RoomsViewModel;

String _pad2(int n) => n.toString().padLeft(2, '0');

String todayIso() {
  final d = DateTime.now();
  return '${d.year}-${_pad2(d.month)}-${_pad2(d.day)}';
}

String startOfMonthIso() {
  final d = DateTime.now();
  return '${d.year}-${_pad2(d.month)}-01';
}

int lastDayOfMonth(int year, int month) => DateTime(year, month + 1, 0).day;

/// Reports: the same three the web dashboard's Reports tab offers — the
/// booking register, occupancy, and the GST filing summary — over one shared
/// date range, mirroring frontend/src/pages/lodge/ReportsPanel.jsx.
class ReportsState {
  final String fromDate;
  final String toDate;
  final AsyncValue<BookingsReport>? bookings;
  final AsyncValue<OccupancyReport>? occupancy;
  final AsyncValue<GstSummaryReport>? gst;

  const ReportsState({
    required this.fromDate,
    required this.toDate,
    this.bookings,
    this.occupancy,
    this.gst,
  });

  bool get validRange => fromDate.isNotEmpty && toDate.isNotEmpty && toDate.compareTo(fromDate) >= 0;

  ReportsState copyWith({
    String? fromDate,
    String? toDate,
    AsyncValue<BookingsReport>? bookings,
    AsyncValue<OccupancyReport>? occupancy,
    AsyncValue<GstSummaryReport>? gst,
  }) => ReportsState(
    fromDate: fromDate ?? this.fromDate,
    toDate: toDate ?? this.toDate,
    bookings: bookings ?? this.bookings,
    occupancy: occupancy ?? this.occupancy,
    gst: gst ?? this.gst,
  );
}

class ReportsViewModel extends StateNotifier<ReportsState> {
  final ReportsUsecase usecase;

  ReportsViewModel(this.usecase)
    : super(ReportsState(fromDate: startOfMonthIso(), toDate: todayIso())) {
    _loadAll();
  }

  void setRange(String fromDate, String toDate) {
    state = state.copyWith(fromDate: fromDate, toDate: toDate);
    _loadAll();
  }

  void setMonth(int year, int month) {
    final from = '$year-${_pad2(month)}-01';
    final to = '$year-${_pad2(month)}-${_pad2(lastDayOfMonth(year, month))}';
    setRange(from, to);
  }

  Future<void> refresh() => _loadAll();

  Future<void> _loadAll() async {
    if (!state.validRange) return;
    final from = state.fromDate;
    final to = state.toDate;

    state = state.copyWith(
      bookings: const AsyncValue.loading(),
      occupancy: const AsyncValue.loading(),
      gst: const AsyncValue.loading(),
    );

    await Future.wait([
      _loadBookings(from, to),
      _loadOccupancy(from, to),
      _loadGst(from, to),
    ]);
  }

  Future<void> _loadBookings(String from, String to) async {
    try {
      final report = await usecase.bookingsReport(fromDate: from, toDate: to);
      if (state.fromDate == from && state.toDate == to) {
        state = state.copyWith(bookings: AsyncValue.data(report));
      }
    } catch (e, st) {
      if (state.fromDate == from && state.toDate == to) {
        state = state.copyWith(bookings: AsyncValue.error(RoomsViewModel.messageFor(e), st));
      }
    }
  }

  Future<void> _loadOccupancy(String from, String to) async {
    try {
      final report = await usecase.occupancyReport(fromDate: from, toDate: to);
      if (state.fromDate == from && state.toDate == to) {
        state = state.copyWith(occupancy: AsyncValue.data(report));
      }
    } catch (e, st) {
      if (state.fromDate == from && state.toDate == to) {
        state = state.copyWith(occupancy: AsyncValue.error(RoomsViewModel.messageFor(e), st));
      }
    }
  }

  Future<void> _loadGst(String from, String to) async {
    try {
      final report = await usecase.gstSummary(fromDate: from, toDate: to);
      if (state.fromDate == from && state.toDate == to) {
        state = state.copyWith(gst: AsyncValue.data(report));
      }
    } catch (e, st) {
      if (state.fromDate == from && state.toDate == to) {
        state = state.copyWith(gst: AsyncValue.error(RoomsViewModel.messageFor(e), st));
      }
    }
  }
}
