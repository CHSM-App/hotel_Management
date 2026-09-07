library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/food_order.dart';
import '../../domain/models/menu.dart';
import '../../domain/usecase/orders_usecase.dart';
import 'booking_viewmodel.dart' show BookingViewModel;

/// Which list the Food section is showing.
enum OrdersTab { queue, history }

class OrdersState {
  final OrdersTab tab;

  /// What the kitchen is working on. Refreshed on a timer.
  final AsyncValue<List<FoodOrder>> queue;

  /// One day's orders, for looking back.
  final AsyncValue<List<FoodOrder>> history;

  /// The day the history is showing.
  final DateTime historyDate;

  /// A status the history is narrowed to, or null for all of them.
  final String? historyStatus;

  /// True only while a tap is in flight. The poll deliberately does not set
  /// this — a spinner appearing every ten seconds on a wall tablet is worse
  /// than no spinner at all.
  final bool working;

  final String? error;

  /// Moves on its own so the "waiting 12m" labels stay honest without every
  /// card holding a timer of its own.
  final DateTime now;

  const OrdersState({
    this.tab = OrdersTab.queue,
    this.queue = const AsyncValue.loading(),
    this.history = const AsyncValue.loading(),
    required this.historyDate,
    this.historyStatus,
    this.working = false,
    this.error,
    required this.now,
  });

  OrdersState copyWith({
    OrdersTab? tab,
    AsyncValue<List<FoodOrder>>? queue,
    AsyncValue<List<FoodOrder>>? history,
    DateTime? historyDate,
    String? historyStatus,
    bool clearHistoryStatus = false,
    bool? working,
    String? error,
    bool clearError = false,
    DateTime? now,
  }) => OrdersState(
    tab: tab ?? this.tab,
    queue: queue ?? this.queue,
    history: history ?? this.history,
    historyDate: historyDate ?? this.historyDate,
    historyStatus: clearHistoryStatus
        ? null
        : (historyStatus ?? this.historyStatus),
    working: working ?? this.working,
    error: clearError ? null : (error ?? this.error),
    now: now ?? this.now,
  );

  List<FoodOrder> get liveOrders => queue.valueOrNull ?? const [];

  /// Tickets nobody has accepted yet. These came from a guest's own phone
  /// rather than from staff, so they are the ones the kitchen has not seen.
  int get needsAccepting =>
      liveOrders.where((o) => o.status == 'PENDING').length;
}

/// The kitchen queue, and the day behind it.
///
/// Polls, because the server offers nothing better: there is no websocket and
/// no push anywhere in this backend, so "live" means asking again. Ten seconds
/// matches the web kitchen screen — fast enough that a cook is not staring at a
/// stale ticket, slow enough not to be a request a second from a tablet that
/// sits on all day.
class OrdersViewModel extends StateNotifier<OrdersState> {
  final OrdersUsecase usecase;

  Timer? _poll;
  Timer? _clock;

  /// Stops two refreshes overlapping. A slow answer on a bad connection would
  /// otherwise stack up behind the timer and land out of order, redrawing the
  /// queue as it was rather than as it is.
  bool _refreshing = false;

  static const pollInterval = Duration(seconds: 10);

  OrdersViewModel(this.usecase)
    : super(OrdersState(historyDate: _today(), now: DateTime.now())) {
    loadQueue();
    _poll = Timer.periodic(pollInterval, (_) => loadQueue(silent: true));
    // Separate from the poll: the elapsed labels move on their own minute and
    // must keep moving even when the network is down.
    _clock = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) state = state.copyWith(now: DateTime.now());
    });
  }

  static DateTime _today() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  static String iso(DateTime d) => BookingViewModel.iso(d);

  @override
  void dispose() {
    _poll?.cancel();
    _clock?.cancel();
    super.dispose();
  }

  void setTab(OrdersTab tab) {
    state = state.copyWith(tab: tab, clearError: true);
    if (tab == OrdersTab.history) loadHistory();
  }

  /// Refresh the queue.
  ///
  /// [silent] is the timer's own call: it leaves whatever is on screen in
  /// place and does not raise an error, because one failed poll on a patchy
  /// connection is not worth replacing a working screen with a message. The
  /// next tick usually fixes it, and a tap reports properly.
  Future<void> loadQueue({bool silent = false}) async {
    if (_refreshing) return;
    _refreshing = true;
    try {
      final orders = await usecase.queue();
      if (!mounted) return;
      state = state.copyWith(
        queue: AsyncValue.data(orders),
        now: DateTime.now(),
        clearError: true,
      );
    } catch (e, st) {
      if (!mounted) return;
      if (silent) {
        // Only surface a background failure when there is nothing to show —
        // an empty screen with no explanation is worse than a stale one.
        if (state.queue.valueOrNull == null) {
          state = state.copyWith(queue: AsyncValue.error(e, st));
        }
      } else {
        state = state.copyWith(
          queue: AsyncValue.error(e, st),
          error: BookingViewModel.messageFor(e),
        );
      }
    } finally {
      _refreshing = false;
    }
  }

  Future<void> loadHistory() async {
    state = state.copyWith(history: const AsyncValue.loading());
    try {
      final orders = await usecase.orders(
        date: iso(state.historyDate),
        status: state.historyStatus,
      );
      if (!mounted) return;
      state = state.copyWith(history: AsyncValue.data(orders));
    } catch (e, st) {
      if (!mounted) return;
      state = state.copyWith(
        history: AsyncValue.error(e, st),
        error: BookingViewModel.messageFor(e),
      );
    }
  }

  Future<void> setHistoryDate(DateTime day) async {
    state = state.copyWith(historyDate: day);
    await loadHistory();
  }

  Future<void> setHistoryStatus(String? status) async {
    state = status == null
        ? state.copyWith(clearHistoryStatus: true)
        : state.copyWith(historyStatus: status);
    await loadHistory();
  }

  /// Move an order on.
  ///
  /// The queue is reloaded from the server rather than patched in place: a
  /// delivered order leaves the queue entirely, and working that out here
  /// would be re-deriving a rule the server has already applied.
  Future<bool> advance(int id, String status, {String? cancelReason}) async {
    if (state.working) return false;
    state = state.copyWith(working: true, clearError: true);
    try {
      await usecase.setStatus(id, status, cancelReason: cancelReason);
      if (!mounted) return true;
      state = state.copyWith(working: false);
      await loadQueue();
      if (state.tab == OrdersTab.history) await loadHistory();
      return true;
    } catch (e) {
      if (!mounted) return false;
      state = state.copyWith(
        working: false,
        error: BookingViewModel.messageFor(e),
      );
      return false;
    }
  }

  /// Tick one dish off a ticket, or take the tick back.
  Future<bool> setItemReady(int orderId, int itemId, bool ready) async {
    if (state.working) return false;
    state = state.copyWith(working: true, clearError: true);
    try {
      await usecase.setItemReady(orderId, itemId, ready);
      if (!mounted) return true;
      state = state.copyWith(working: false);
      await loadQueue();
      return true;
    } catch (e) {
      if (!mounted) return false;
      state = state.copyWith(
        working: false,
        error: BookingViewModel.messageFor(e),
      );
      return false;
    }
  }

  /// Put through an order taken at the counter.
  Future<FoodOrder?> placeCounterOrder({
    int? roomId,
    int? tableId,
    String guestName = '',
    String note = '',
    required List<OrderLineDraft> lines,
  }) async {
    if (state.working || lines.isEmpty) return null;
    state = state.copyWith(working: true, clearError: true);
    try {
      final order = await usecase.createCounterOrder(
        roomId: roomId,
        tableId: tableId,
        guestName: guestName,
        note: note,
        lines: lines,
      );
      if (!mounted) return order;
      state = state.copyWith(working: false);
      await loadQueue();
      return order;
    } catch (e) {
      if (!mounted) return null;
      state = state.copyWith(
        working: false,
        error: BookingViewModel.messageFor(e),
      );
      return null;
    }
  }

  Future<List<MenuSection>> menu() => usecase.menu();

  Future<List<DiningTable>> tables() => usecase.tables();
}
