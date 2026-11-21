library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/bar.dart';
import '../../domain/usecase/bar_usecase.dart';

/// Bar orders, billing and history — the working side of the bar.
class BarState {
  final bool isLoading;
  final bool submitting;
  final String? error;

  /// Set when a bill is refused only because some items are undelivered, so
  /// the screen can offer "Bill anyway" instead of a dead-end error.
  final String? pendingMessage;
  final List<BarOrder> orders;
  final List<BarTab> tabs;
  final List<BarOrder> history;
  final List<BarBillRow> bills;
  final BarTargets targets;
  final double taxPercent;

  const BarState({
    this.isLoading = false,
    this.submitting = false,
    this.error,
    this.pendingMessage,
    this.orders = const [],
    this.tabs = const [],
    this.history = const [],
    this.bills = const [],
    this.targets = const BarTargets(),
    this.taxPercent = 0,
  });

  BarState copyWith({
    bool? isLoading,
    bool? submitting,
    String? error,
    bool clearError = false,
    String? pendingMessage,
    bool clearPending = false,
    List<BarOrder>? orders,
    List<BarTab>? tabs,
    List<BarOrder>? history,
    List<BarBillRow>? bills,
    BarTargets? targets,
    double? taxPercent,
  }) => BarState(
    isLoading: isLoading ?? this.isLoading,
    submitting: submitting ?? this.submitting,
    error: clearError ? null : (error ?? this.error),
    pendingMessage: clearPending ? null : (pendingMessage ?? this.pendingMessage),
    orders: orders ?? this.orders,
    tabs: tabs ?? this.tabs,
    history: history ?? this.history,
    bills: bills ?? this.bills,
    targets: targets ?? this.targets,
    taxPercent: taxPercent ?? this.taxPercent,
  );

  /// Open orders still on the floor: ready-to-bill ones have moved to Bills.
  List<BarOrder> get openOrders => orders.where((o) => !o.readyToBill).toList();
}

class BarViewModel extends StateNotifier<BarState> {
  final BarUsecase usecase;

  BarViewModel(this.usecase) : super(const BarState());

  /// [silent] is the background poll: no spinner, and a failed refresh keeps
  /// what is already on screen instead of replacing it with an error.
  Future<void> loadOrders({bool silent = false}) async {
    if (!silent) state = state.copyWith(isLoading: true, clearError: true);
    try {
      final orders = await usecase.orders();
      state = state.copyWith(isLoading: false, orders: orders);
    } catch (e) {
      state = silent ? state : state.copyWith(isLoading: false, error: apiErrorMessage(e));
    }
  }

  Future<void> loadTabs() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final tabs = await usecase.tabs();
      final menu = await usecase.menu();
      state = state.copyWith(isLoading: false, tabs: tabs, taxPercent: menu.settings.taxPercent);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
    }
  }

  Future<void> loadTargets() async {
    try {
      state = state.copyWith(targets: await usecase.targets());
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
    }
  }

  Future<void> loadBills(String from, String to) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      state = state.copyWith(isLoading: false, bills: await usecase.bills(from, to));
    } catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
    }
  }

  Future<void> loadHistory(String from, String to) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      state = state.copyWith(isLoading: false, history: await usecase.history(from, to));
    } catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
    }
  }

  /// Runs a write, then refreshes the open orders. False (with [BarState.error]
  /// set) when the server refused.
  Future<bool> _run(Future<void> Function() action) async {
    state = state.copyWith(submitting: true, clearError: true, clearPending: true);
    try {
      await action();
      state = state.copyWith(submitting: false);
      await loadOrders(silent: true);
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> placeOrder(Map<String, dynamic> body) => _run(() => usecase.createOrder(body));

  Future<bool> addItems(int id, Map<String, dynamic> body) => _run(() => usecase.addItems(id, body));

  Future<bool> setItemQty(int id, int itemId, int qty) => _run(() => usecase.setItemQty(id, itemId, qty));

  Future<bool> cancelItem(int id, int itemId) => _run(() => usecase.cancelItem(id, itemId));

  Future<bool> cancelOrder(int id) => _run(() => usecase.cancelOrder(id));

  Future<bool> deliverOrder(int id) => _run(() => usecase.deliverOrder(id));

  Future<bool> deliverItem(int id, int itemId) => _run(() => usecase.deliverItem(id, itemId));

  Future<bool> deliverFoodItem(int foodOrderId, int itemId) =>
      _run(() => usecase.deliverFoodItem(foodOrderId, itemId));

  Future<bool> readyToBill(int id) => _run(() => usecase.readyToBill(id));

  Future<bool> addToRoom(List<int> orderIds, int bookingId, int roomId) => _run(() async {
    for (final id in orderIds) {
      await usecase.addToRoom(id, bookingId, roomId);
    }
  });

  /// Issues the bill. Null when it was refused: for undelivered items
  /// [BarState.pendingMessage] is set (offer Bill anyway), otherwise
  /// [BarState.error].
  Future<BarBill?> issueBill({
    required List<int> orderIds,
    String? customerName,
    required List<({String method, double amount, String? reference})> payments,
    bool billAnyway = false,
  }) async {
    state = state.copyWith(submitting: true, clearError: true, clearPending: true);
    try {
      final name = (customerName ?? '').trim();
      final bill = await usecase.issueBill({
        'orderIds': orderIds,
        'customerName': name.isEmpty ? null : name,
        'billAnyway': billAnyway,
        'payments': [
          for (final p in payments) {'method': p.method, 'amount': p.amount, 'reference': p.reference},
        ],
      });
      state = state.copyWith(submitting: false);
      await loadTabs();
      await loadOrders(silent: true);
      return bill;
    } catch (e) {
      final pending = apiErrorField(e) == 'pending';
      state = state.copyWith(
        submitting: false,
        error: pending ? null : apiErrorMessage(e),
        pendingMessage: pending ? apiErrorMessage(e) : null,
      );
      return null;
    }
  }

  Future<BarBill?> loadBill(int id) async {
    try {
      return await usecase.bill(id);
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return null;
    }
  }
}
