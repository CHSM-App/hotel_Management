library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/laundry.dart';
import '../../domain/usecase/laundry_usecase.dart';

/// Laundry — hotel linen and guest laundry in one notifier, the way
/// LaundryPanel.jsx keeps both tabs' state in one component tree.
class LaundryState {
  final bool isLoading;
  final String? error;
  final LinenBoard board;
  final List<LaundryOrder> orders;
  final List<RecentGarment> recentGarments;
  final List<LaundryGuestStay> inHouseGuests;
  final bool ordersLoading;
  final bool submitting;

  const LaundryState({
    this.isLoading = false,
    this.error,
    this.board = const LinenBoard(),
    this.orders = const [],
    this.recentGarments = const [],
    this.inHouseGuests = const [],
    this.ordersLoading = false,
    this.submitting = false,
  });

  LaundryState copyWith({
    bool? isLoading,
    String? error,
    bool clearError = false,
    LinenBoard? board,
    List<LaundryOrder>? orders,
    List<RecentGarment>? recentGarments,
    List<LaundryGuestStay>? inHouseGuests,
    bool? ordersLoading,
    bool? submitting,
  }) => LaundryState(
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : (error ?? this.error),
    board: board ?? this.board,
    orders: orders ?? this.orders,
    recentGarments: recentGarments ?? this.recentGarments,
    inHouseGuests: inHouseGuests ?? this.inHouseGuests,
    ordersLoading: ordersLoading ?? this.ordersLoading,
    submitting: submitting ?? this.submitting,
  );

  /// Linen types still tracked, not hidden — what the board actually shows.
  List<LinenItem> get activeItems => board.items.where((i) => i.isActive).toList();

  List<LinenItem> get hiddenItems => board.items.where((i) => !i.isActive).toList();

  /// Linen types with something waiting at the laundry right now.
  List<LinenItem> get atLaundry => activeItems.where((i) => i.inLaundry > 0).toList();

  int _total(int Function(LinenItem) field) => activeItems.fold(0, (n, i) => n + (field(i) < 0 ? 0 : field(i)));

  int get totalWithHousekeeping => _total((i) => i.withHousekeeping);

  int get totalDirty => _total((i) => i.dirty);

  int get totalInLaundry => _total((i) => i.inLaundry);

  int get totalClean => _total((i) => i.clean);

  List<LinenStaffGroup> get staffGroups => LinenStaffGroup.groupOf(board.handovers);

  /// Who washed the last batch, split into the OWN/VENDOR starting point
  /// Send and Receive open with — mirrors washerFrom in LaundryPanel.jsx.
  ({String washer, String washedBy}) get lastWasher {
    final last = board.lastWashedBy.trim();
    final own = last.toLowerCase() == kOwnLaundry.toLowerCase();
    return (washer: own ? 'OWN' : 'VENDOR', washedBy: own ? '' : last);
  }
}

class LaundryViewModel extends StateNotifier<LaundryState> {
  final LaundryUsecase usecase;

  LaundryViewModel(this.usecase) : super(const LaundryState());

  Future<void> loadBoard() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final board = await usecase.linenBoard();
      state = state.copyWith(isLoading: false, board: board);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
    }
  }

  Future<void> loadOrders() async {
    state = state.copyWith(ordersLoading: true, clearError: true);
    try {
      final orders = await usecase.laundryOrders(scope: 'all');
      state = state.copyWith(ordersLoading: false, orders: orders);
    } catch (e) {
      state = state.copyWith(ordersLoading: false, error: apiErrorMessage(e));
    }
  }

  Future<void> loadGuestLaundryExtras() async {
    try {
      final results = await Future.wait([usecase.recentGarments(), usecase.inHouseGuests()]);
      state = state.copyWith(
        recentGarments: results[0] as List<RecentGarment>,
        inHouseGuests: results[1] as List<LaundryGuestStay>,
      );
    } catch (_) {
      // Both are conveniences the form degrades without — same as the web,
      // which swallows these two fetch failures silently.
    }
  }

  Future<bool> _run(Future<void> Function() action) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await action();
      state = state.copyWith(submitting: false);
      await loadBoard();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> saveLinenItem(Map<String, dynamic> body, {int? id}) =>
      _run(() => id != null ? usecase.updateLinenItem(id, body) : usecase.createLinenItem(body));

  Future<bool> setLinenItemActive(int id, bool isActive) => _run(() => usecase.updateLinenItem(id, {'isActive': isActive}));

  Future<bool> receiveHandover(List<int> movementIds) => _run(() => usecase.receiveHandovers(movementIds));

  Future<bool> sendToLaundry(Map<String, dynamic> body) => _run(() => usecase.sendToLaundry(body));

  Future<bool> receiveFromLaundry(Map<String, dynamic> body) => _run(() => usecase.receiveFromLaundry(body));

  Future<bool> recordLoss(Map<String, dynamic> body) => _run(() => usecase.recordLoss(body));

  Future<bool> createLaundryOrder(Map<String, dynamic> body) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await usecase.createLaundryOrder(body);
      state = state.copyWith(submitting: false);
      await Future.wait([loadOrders(), loadGuestLaundryExtras()]);
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> setLaundryStatus(int id, Map<String, dynamic> body) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await usecase.setLaundryStatus(id, body);
      state = state.copyWith(submitting: false);
      await loadOrders();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  void clearError() => state = state.copyWith(clearError: true);
}
