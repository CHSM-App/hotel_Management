import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart';
import '../../domain/models/expense.dart';
import '../../domain/models/income.dart';
import '../../domain/models/report.dart';
import '../../domain/usecase/assets_usecase.dart';
import '../../domain/usecase/expenses_usecase.dart';
import '../../domain/usecase/income_usecase.dart';
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

/// The register/work-order pair the Assets report tab needs, fetched
/// together the same way AssetsReportPanel.jsx's Reports tab loads them.
class AssetsReportData {
  final List<Asset> assets;
  final List<WorkOrder> workOrders;

  const AssetsReportData({this.assets = const [], this.workOrders = const []});
}

/// Reports: the full tab set the website's Reports/Analysis page offers —
/// Overview, Room Bookings, Events & functions, Food orders, Tax & GST,
/// Profit & Loss, Expenses, Other Income, Assets — mirroring
/// frontend/src/pages/lodge/ReportsPanel.jsx's ALL_TABS.
///
/// Bookings/Occupancy/GST/Events/Food/Profit&Loss share one date range and
/// reload together on [setRange], the same "eager, whichever sub-tab is
/// showing" convention this view model already used for the first three —
/// simpler than web's per-tab lazy fetch, and no report here is expensive
/// enough to make that trade-off matter. Expenses/Other Income/Assets are
/// full-history (not date-ranged) and are fetched once, since they answer a
/// different question ("what's on file") than the rest of this screen.
class ReportsState {
  final String fromDate;
  final String toDate;
  final AsyncValue<BookingsReport>? bookings;
  final AsyncValue<OccupancyReport>? occupancy;
  final AsyncValue<GstSummaryReport>? gst;
  final AsyncValue<EventsReport>? events;
  final AsyncValue<FoodOrdersReport>? foodOrders;
  final AsyncValue<ProfitLossReport>? profitLoss;
  final String plGranularity;
  final AsyncValue<ProfitLossHistory>? plHistory;
  final AsyncValue<List<Expense>>? expensesReport;
  final AsyncValue<List<IncomeEntry>>? incomeReport;
  final AsyncValue<AssetsReportData>? assetsReport;

  const ReportsState({
    required this.fromDate,
    required this.toDate,
    this.bookings,
    this.occupancy,
    this.gst,
    this.events,
    this.foodOrders,
    this.profitLoss,
    this.plGranularity = 'year',
    this.plHistory,
    this.expensesReport,
    this.incomeReport,
    this.assetsReport,
  });

  bool get validRange => fromDate.isNotEmpty && toDate.isNotEmpty && toDate.compareTo(fromDate) >= 0;

  ReportsState copyWith({
    String? fromDate,
    String? toDate,
    AsyncValue<BookingsReport>? bookings,
    AsyncValue<OccupancyReport>? occupancy,
    AsyncValue<GstSummaryReport>? gst,
    AsyncValue<EventsReport>? events,
    AsyncValue<FoodOrdersReport>? foodOrders,
    AsyncValue<ProfitLossReport>? profitLoss,
    String? plGranularity,
    AsyncValue<ProfitLossHistory>? plHistory,
    AsyncValue<List<Expense>>? expensesReport,
    AsyncValue<List<IncomeEntry>>? incomeReport,
    AsyncValue<AssetsReportData>? assetsReport,
  }) => ReportsState(
    fromDate: fromDate ?? this.fromDate,
    toDate: toDate ?? this.toDate,
    bookings: bookings ?? this.bookings,
    occupancy: occupancy ?? this.occupancy,
    gst: gst ?? this.gst,
    events: events ?? this.events,
    foodOrders: foodOrders ?? this.foodOrders,
    profitLoss: profitLoss ?? this.profitLoss,
    plGranularity: plGranularity ?? this.plGranularity,
    plHistory: plHistory ?? this.plHistory,
    expensesReport: expensesReport ?? this.expensesReport,
    incomeReport: incomeReport ?? this.incomeReport,
    assetsReport: assetsReport ?? this.assetsReport,
  );
}

class ReportsViewModel extends StateNotifier<ReportsState> {
  final ReportsUsecase usecase;
  final ExpensesUsecase expensesUsecase;
  final AssetsUsecase assetsUsecase;
  final IncomeUsecase incomeUsecase;

  ReportsViewModel(
    this.usecase,
    this.expensesUsecase,
    this.assetsUsecase,
    this.incomeUsecase,
  ) : super(ReportsState(fromDate: startOfMonthIso(), toDate: todayIso())) {
    _loadAll();
    _loadStatic();
    _loadPlHistory();
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

  void setPlGranularity(String granularity) {
    if (granularity == state.plGranularity) return;
    state = state.copyWith(plGranularity: granularity);
    _loadPlHistory();
  }

  Future<void> refresh() => Future.wait([_loadAll(), _loadStatic(), _loadPlHistory()]);

  Future<void> _loadAll() async {
    if (!state.validRange) return;
    final from = state.fromDate;
    final to = state.toDate;

    state = state.copyWith(
      bookings: const AsyncValue.loading(),
      occupancy: const AsyncValue.loading(),
      gst: const AsyncValue.loading(),
      events: const AsyncValue.loading(),
      foodOrders: const AsyncValue.loading(),
      profitLoss: const AsyncValue.loading(),
    );

    await Future.wait([
      _loadBookings(from, to),
      _loadOccupancy(from, to),
      _loadGst(from, to),
      _loadEvents(from, to),
      _loadFoodOrders(from, to),
      _loadProfitLoss(from, to),
    ]);
  }

  /// Full-history, not date-ranged — fetched once, not on every [setRange].
  Future<void> _loadStatic() async {
    state = state.copyWith(
      expensesReport: const AsyncValue.loading(),
      incomeReport: const AsyncValue.loading(),
      assetsReport: const AsyncValue.loading(),
    );
    await Future.wait([_loadExpensesReport(), _loadIncomeReport(), _loadAssetsReport()]);
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

  Future<void> _loadEvents(String from, String to) async {
    try {
      final report = await usecase.eventsReport(fromDate: from, toDate: to);
      if (state.fromDate == from && state.toDate == to) {
        state = state.copyWith(events: AsyncValue.data(report));
      }
    } catch (e, st) {
      if (state.fromDate == from && state.toDate == to) {
        state = state.copyWith(events: AsyncValue.error(RoomsViewModel.messageFor(e), st));
      }
    }
  }

  Future<void> _loadFoodOrders(String from, String to) async {
    try {
      final report = await usecase.foodOrdersReport(fromDate: from, toDate: to);
      if (state.fromDate == from && state.toDate == to) {
        state = state.copyWith(foodOrders: AsyncValue.data(report));
      }
    } catch (e, st) {
      if (state.fromDate == from && state.toDate == to) {
        state = state.copyWith(foodOrders: AsyncValue.error(RoomsViewModel.messageFor(e), st));
      }
    }
  }

  Future<void> _loadProfitLoss(String from, String to) async {
    try {
      final report = await usecase.profitLoss(fromDate: from, toDate: to);
      if (state.fromDate == from && state.toDate == to) {
        state = state.copyWith(profitLoss: AsyncValue.data(report));
      }
    } catch (e, st) {
      if (state.fromDate == from && state.toDate == to) {
        state = state.copyWith(profitLoss: AsyncValue.error(RoomsViewModel.messageFor(e), st));
      }
    }
  }

  Future<void> _loadPlHistory() async {
    final granularity = state.plGranularity;
    state = state.copyWith(plHistory: const AsyncValue.loading());
    try {
      final history = await usecase.profitLossHistory(granularity: granularity);
      if (state.plGranularity == granularity) {
        state = state.copyWith(plHistory: AsyncValue.data(history));
      }
    } catch (e, st) {
      if (state.plGranularity == granularity) {
        state = state.copyWith(plHistory: AsyncValue.error(RoomsViewModel.messageFor(e), st));
      }
    }
  }

  Future<void> _loadExpensesReport() async {
    try {
      final expenses = await expensesUsecase.expenses();
      state = state.copyWith(expensesReport: AsyncValue.data(expenses));
    } catch (e, st) {
      state = state.copyWith(expensesReport: AsyncValue.error(RoomsViewModel.messageFor(e), st));
    }
  }

  Future<void> _loadIncomeReport() async {
    try {
      final income = await incomeUsecase.income();
      state = state.copyWith(incomeReport: AsyncValue.data(income));
    } catch (e, st) {
      state = state.copyWith(incomeReport: AsyncValue.error(RoomsViewModel.messageFor(e), st));
    }
  }

  Future<void> _loadAssetsReport() async {
    try {
      final results = await Future.wait([
        assetsUsecase.assets(includeInactive: true),
        assetsUsecase.workOrders(),
      ]);
      state = state.copyWith(
        assetsReport: AsyncValue.data(
          AssetsReportData(
            assets: results[0] as List<Asset>,
            workOrders: results[1] as List<WorkOrder>,
          ),
        ),
      );
    } catch (e, st) {
      state = state.copyWith(assetsReport: AsyncValue.error(RoomsViewModel.messageFor(e), st));
    }
  }
}
