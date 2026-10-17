library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/new_order_chime.dart';
import '../../domain/models/food_order.dart';
import '../../domain/models/menu.dart';
import '../../domain/models/room.dart';
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

  /// Which period History is showing — 'today', 'month' (the 1st through
  /// today) or 'custom' ([historyCustomFrom]..[historyCustomTo]) — same
  /// three OrdersPanel.jsx's own period control offers.
  final String historyPeriod;

  final DateTime historyCustomFrom;
  final DateTime historyCustomTo;

  /// A status the history is narrowed to, or null for all of them.
  final String? historyStatus;

  /// Narrows History by order number, who it's for, a guest's name or
  /// phone, its note, or a dish on it — client-side over whatever the
  /// current period already fetched, same as OrdersPanel.jsx's own search
  /// box.
  final String historySearch;

  /// 'sheet' (a dense spreadsheet, the default) or 'cards' — the same choice
  /// OrdersPanel.jsx's own `listView` offers, shared between the Kitchen
  /// queue and History the same way the web lifts it to one state.
  final String listView;

  /// A captain (`orders.take` without `orders.manage`) has no queue tab —
  /// this list is their queue instead: everything still open (not billed,
  /// not ready to bill, not cancelled) over the last month, rather than a
  /// single picked day, the same way OrdersPanel.jsx's compact History
  /// looks back a month for a captain.
  final bool myOrdersMode;

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
    this.historyPeriod = 'today',
    required this.historyCustomFrom,
    required this.historyCustomTo,
    this.historyStatus,
    this.historySearch = '',
    this.myOrdersMode = false,
    this.working = false,
    this.error,
    required this.now,
    this.listView = 'sheet',
  });

  OrdersState copyWith({
    OrdersTab? tab,
    AsyncValue<List<FoodOrder>>? queue,
    AsyncValue<List<FoodOrder>>? history,
    String? historyPeriod,
    DateTime? historyCustomFrom,
    DateTime? historyCustomTo,
    String? historyStatus,
    bool clearHistoryStatus = false,
    String? historySearch,
    bool? myOrdersMode,
    bool? working,
    String? error,
    bool clearError = false,
    DateTime? now,
    String? listView,
  }) => OrdersState(
    tab: tab ?? this.tab,
    queue: queue ?? this.queue,
    history: history ?? this.history,
    historyPeriod: historyPeriod ?? this.historyPeriod,
    historyCustomFrom: historyCustomFrom ?? this.historyCustomFrom,
    historyCustomTo: historyCustomTo ?? this.historyCustomTo,
    historySearch: historySearch ?? this.historySearch,
    historyStatus: clearHistoryStatus
        ? null
        : (historyStatus ?? this.historyStatus),
    myOrdersMode: myOrdersMode ?? this.myOrdersMode,
    working: working ?? this.working,
    error: clearError ? null : (error ?? this.error),
    now: now ?? this.now,
    listView: listView ?? this.listView,
  );

  List<FoodOrder> get liveOrders => queue.valueOrNull ?? const [];

  /// Tickets nobody has accepted yet. These came from a guest's own phone
  /// rather than from staff, so they are the ones the kitchen (or, in
  /// [myOrdersMode], the captain) has not seen. Read off [history] in
  /// myOrdersMode — [queue] is never populated for a login with no
  /// `orders.manage` — and only while the "Kitchen queue" tab's active scope
  /// is what [history] currently holds, the same as [needsAccepting]'s own
  /// reasoning for the real queue.
  int get needsAccepting => myOrdersMode
      ? (tab == OrdersTab.queue
            ? (history.valueOrNull ?? const [])
                  .where((o) => o.status == 'PENDING')
                  .length
            : 0)
      : liveOrders.where((o) => o.status == 'PENDING').length;
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

  /// The last `canWorkQueue` [configureForRole] actually acted on, so it can
  /// tell a real change (this login's permissions were still loading, or
  /// this same provider instance was reused for a different login) from a
  /// rebuild that says the same thing again. Null before the first call.
  bool? _configuredCanWorkQueue;

  /// Order ids seen on the previous [loadQueue] — OrdersPanel.jsx's own
  /// `knownIdsRef`. Null until the first fetch lands, so that fetch seeds the
  /// set silently instead of chiming for every order already cooking.
  Set<int>? _knownOrderIds;

  /// Guest (QR) order ids seen on the previous [loadHistory] while
  /// [OrdersState.myOrdersMode] is on — OrdersPanel.jsx's own
  /// `knownGuestIds`, which a captain's "Kitchen queue"/History pair relies
  /// on since they never see [loadQueue]'s real queue at all.
  Set<int>? _knownGuestIds;

  /// A new order nobody has seen yet — the same load-bearing alert
  /// OrdersPanel.jsx's synthesised Web Audio chime gives the kitchen screen,
  /// rebuilt sample-for-sample in [NewOrderChime] so this app sounds the same
  /// two-tone alert rather than a generic platform beep.
  void _chimeNewOrder() {
    NewOrderChime.play();
  }

  OrdersViewModel(this.usecase)
    : super(
        OrdersState(
          historyCustomFrom: _today(),
          historyCustomTo: _today(),
          now: DateTime.now(),
        ),
      ) {
    loadQueue();
    _poll = Timer.periodic(pollInterval, (_) => loadQueue(silent: true));
    // Separate from the poll: the elapsed labels move on their own minute and
    // must keep moving even when the network is down.
    _clock = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) state = state.copyWith(now: DateTime.now());
    });
  }

  /// Called on every build with whether this login currently holds
  /// `orders.manage` — cheap to call repeatedly, since it only acts when
  /// [canWorkQueue] actually differs from what it last configured for. That
  /// matters because a one-shot decision taken before `me` had finished
  /// loading (or left over from a previous login this same screen instance
  /// briefly showed) would otherwise stick forever, even once the real
  /// permissions came in.
  ///
  /// A captain (`orders.take` only) has no kitchen queue — GET /orders/queue
  /// answers 403 for them — but OrdersPanel.jsx still gives them the same two
  /// tabs everyone else gets, just backed differently: the first tab (still
  /// labelled "Kitchen queue" on the web, kept the same here) is [myOrdersMode]
  /// — everything of theirs still open, looked back a month rather than one
  /// picked day, since a single day is empty on any day they have not
  /// personally placed an order yet; the second, "History", is what has been
  /// settled (billed, sent to billing, or cancelled). A login that does hold
  /// orders.manage (kitchen, reception, owner) is switched back onto the
  /// real Kitchen queue + full-day History pair the same way.
  void configureForRole({required bool canWorkQueue}) {
    if (_configuredCanWorkQueue == canWorkQueue) return;
    _configuredCanWorkQueue = canWorkQueue;

    _poll?.cancel();
    if (canWorkQueue) {
      state = state.copyWith(myOrdersMode: false);
      _poll = Timer.periodic(pollInterval, (_) => loadQueue(silent: true));
      loadQueue();
    } else {
      state = state.copyWith(myOrdersMode: true);
      _poll = Timer.periodic(pollInterval, (_) => loadHistory(silent: true));
      loadHistory();
    }
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
    // In myOrdersMode both tabs are backed by [history] — "Kitchen queue"
    // for what's still open, "History" for what's settled — so switching
    // between them always needs a fresh fetch under the new scope, not just
    // when landing on History the way the real Kitchen-queue/History pair
    // does.
    // OrdersPanel.jsx remounts its History component on every tab change
    // (key={view}), which drops its own knownGuestIds ref — otherwise a
    // scope switch (active orders vs. settled ones) would look like a batch
    // of brand-new guest orders and chime for all of them at once.
    if (state.myOrdersMode) _knownGuestIds = null;
    if (state.myOrdersMode || tab == OrdersTab.history) loadHistory();
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

      // Chime for orders that weren't on the previous poll — see
      // _knownOrderIds.
      final ids = orders.map((o) => o.id).toSet();
      if (_knownOrderIds != null && ids.any((id) => !_knownOrderIds!.contains(id))) {
        _chimeNewOrder();
      }
      _knownOrderIds = ids;
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

  /// [silent] is the poll's own call in [myOrdersMode] — same reasoning as
  /// [loadQueue]'s: a captain's "My orders" is live the same way the queue
  /// is, and a spinner every ten seconds is worse than a stale list for the
  /// second it takes to catch up.
  Future<void> loadHistory({bool silent = false}) async {
    if (!silent) state = state.copyWith(history: const AsyncValue.loading());
    try {
      final range = _historyRange();
      // Only the captain's own "Kitchen queue" tab (what's still open) is
      // compact and looks back a month regardless of the period picker — the
      // same `scope === 'active'` condition OrdersPanel.jsx's own `compact`
      // reads. Their History tab (what's settled) is not compact: it gets
      // the full period picker and status filter, same as everyone else's.
      final compact = state.myOrdersMode && state.tab == OrdersTab.queue;
      final orders = compact
          ? await usecase.orders(from: iso(_monthStart()), to: iso(_today()))
          : await usecase.orders(
              from: iso(range.$1),
              to: iso(range.$2),
              status: state.historyStatus,
            );
      if (!mounted) return;
      // OrdersPanel.jsx's compact History applies a scope on top of the
      // period: 'active' (still open — not billed, not sent to billing, not
      // called off) on the "Kitchen queue" tab, 'done' (settled — billed,
      // sent to billing, or cancelled) on "History". Only meaningful in
      // myOrdersMode — the real History tab shows everything for the day.
      final visible = !state.myOrdersMode
          ? orders
          : state.tab == OrdersTab.queue
          ? orders.where((o) => !o.billed && !o.readyToBill && o.status != 'CANCELLED').toList()
          : orders.where((o) => o.billed || o.readyToBill || o.status == 'CANCELLED').toList();
      state = state.copyWith(history: AsyncValue.data(visible), clearError: true);

      // A captain never sees loadQueue's real queue, so guest QR orders are
      // chimed here instead — same reasoning OrdersPanel.jsx's own
      // `onNewGuestOrders` carries for the "my orders" history view.
      if (state.myOrdersMode) {
        final guestIds = orders.where((o) => o.guestOrder).map((o) => o.id).toSet();
        if (_knownGuestIds != null && guestIds.any((id) => !_knownGuestIds!.contains(id))) {
          _chimeNewOrder();
        }
        _knownGuestIds = guestIds;
      }
    } catch (e, st) {
      if (!mounted) return;
      if (silent && state.history.valueOrNull != null) return;
      state = state.copyWith(
        history: AsyncValue.error(e, st),
        error: BookingViewModel.messageFor(e),
      );
    }
  }

  static DateTime _monthStart() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, 1);
  }

  static DateTime _yearStart() {
    final now = DateTime.now();
    return DateTime(now.year, 1, 1);
  }

  /// The (from, to) pair the picked [OrdersState.historyPeriod] resolves
  /// to — same three the web's period control offers.
  (DateTime, DateTime) _historyRange() {
    switch (state.historyPeriod) {
      case 'month':
        return (_monthStart(), _today());
      case 'year':
        return (_yearStart(), _today());
      case 'custom':
        return (state.historyCustomFrom, state.historyCustomTo);
      default:
        return (_today(), _today());
    }
  }

  Future<void> setHistoryPeriod(String period) async {
    state = state.copyWith(historyPeriod: period);
    await loadHistory();
  }

  Future<void> setHistoryCustomRange(DateTime from, DateTime to) async {
    state = state.copyWith(
      historyPeriod: 'custom',
      historyCustomFrom: from,
      historyCustomTo: to,
    );
    await loadHistory();
  }

  Future<void> setHistoryStatus(String? status) async {
    state = status == null
        ? state.copyWith(clearHistoryStatus: true)
        : state.copyWith(historyStatus: status);
    await loadHistory();
  }

  /// Client-side only — narrows the already-fetched period's list, so
  /// typing doesn't reload the day, same as the web's own search box.
  void setHistorySearch(String query) =>
      state = state.copyWith(historySearch: query);

  /// Spreadsheet or cards — shared between the Kitchen queue and History,
  /// same as the web's own `listView`/`setListView`.
  void setListView(String view) => state = state.copyWith(listView: view);

  /// Move an order on.
  ///
  /// The queue is reloaded from the server rather than patched in place: a
  /// delivered order leaves the queue entirely, and working that out here
  /// would be re-deriving a rule the server has already applied. Skipped in
  /// [OrdersState.myOrdersMode] — a captain has no `orders.manage`, so
  /// GET /orders/queue is a 403 the action itself did not cause, and no
  /// screen of theirs reads [OrdersState.queue] anyway.
  Future<bool> advance(int id, String status, {String? cancelReason}) async {
    if (state.working) return false;
    state = state.copyWith(working: true, clearError: true);
    try {
      await usecase.setStatus(id, status, cancelReason: cancelReason);
      if (!mounted) return true;
      state = state.copyWith(working: false);
      if (!state.myOrdersMode) await loadQueue();
      if (state.myOrdersMode || state.tab == OrdersTab.history) {
        await loadHistory();
      }
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

  /// Carry one ready dish out to the guest. Once every dish on the order is
  /// delivered this way the server flips the whole order to DELIVERED — the
  /// list this action was called from (the kitchen queue, or a captain's
  /// history/"My orders") is reloaded either way, the same reasoning
  /// [advance] carries: re-deriving which list an order now belongs on is
  /// the server's rule, not this screen's to guess.
  Future<bool> deliverItem(int orderId, int itemId) async {
    if (state.working) return false;
    state = state.copyWith(working: true, clearError: true);
    try {
      await usecase.setItemDelivered(orderId, itemId);
      if (!mounted) return true;
      state = state.copyWith(working: false);
      if (!state.myOrdersMode) await loadQueue();
      await loadHistory();
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

  /// Send a fully delivered order to Billing's "Food to bill" queue.
  Future<bool> markReadyToBill(int id) async {
    if (state.working) return false;
    state = state.copyWith(working: true, clearError: true);
    try {
      await usecase.markReadyToBill(id);
      if (!mounted) return true;
      state = state.copyWith(working: false);
      await loadHistory();
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
    String guestPhone = '',
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
        guestPhone: guestPhone,
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

  /// Replace an unbilled order's items wholesale — the captain correcting
  /// what was rung in. Reloads whichever list the edited order actually
  /// belongs on, the same reasoning [advance] carries: a changed order can
  /// leave the kitchen's queue (all its items already cooked) or its
  /// unbilled total can move enough to matter to a screen showing it.
  Future<FoodOrder?> editOrder(
    int id,
    List<OrderLineDraft> lines,
    String note,
  ) async {
    if (state.working || lines.isEmpty) return null;
    state = state.copyWith(working: true, clearError: true);
    try {
      final order = await usecase.editOrder(id, lines, note);
      if (!mounted) return order;
      state = state.copyWith(working: false);
      if (!state.myOrdersMode) await loadQueue();
      if (state.myOrdersMode || state.tab == OrdersTab.history) {
        await loadHistory();
      }
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

  /// Rooms for the counter order screen's own target picker. Left for the
  /// screen to catch: a role without `rooms.manage` gets a 403 here, same as
  /// the web's own attempt, and the screen treats that the same as "no rooms
  /// to offer" rather than surfacing it as an error.
  Future<List<RoomListing>> roomsForOrder() => usecase.roomsForOrder();

  /// Who is checked into a room, so staff can eyeball the register before
  /// charging food to somebody's stay. Left for the screen to catch: a
  /// lookup failure must not block the order.
  Future<RoomOccupancy> roomOccupancy(int roomId) => usecase.roomOccupancy(roomId);
}
