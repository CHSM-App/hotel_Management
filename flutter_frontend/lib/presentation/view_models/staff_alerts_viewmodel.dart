import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/staff_alert.dart';
import '../../domain/usecase/assets_usecase.dart';
import '../../domain/usecase/booking_usecase.dart';
import '../../domain/usecase/housekeeping_usecase.dart';
import '../../domain/usecase/orders_usecase.dart';

const _monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/// A toast fired once, for the dashboard to show and then clear — mirrors
/// each web alert hook's own `toast.show(...)` call, just carried through
/// state instead of a side-effecting import, since a StateNotifier has no
/// context to pop a SnackBar from itself.
class StaffAlertToast {
  final String message;
  final bool urgent;

  const StaffAlertToast(this.message, {this.urgent = false});
}

class StaffAlertsState {
  final List<StaffAlert> alerts;
  final StaffAlertToast? toast;

  const StaffAlertsState({this.alerts = const [], this.toast});

  StaffAlertsState copyWith({List<StaffAlert>? alerts, StaffAlertToast? toast, bool clearToast = false}) =>
      StaffAlertsState(alerts: alerts ?? this.alerts, toast: clearToast ? null : (toast ?? this.toast));
}

/// Every category the web's StaffAlertsBell polls, consolidated into one
/// notifier rather than one class per category — the six hooks
/// (useCheckinAlerts, useCheckoutAlerts, useWorkOrderAlerts, useCoverageAlerts,
/// usePendingOrderAlerts, useReportsReminder) plus useOpenIssues differ only
/// in source, poll interval and whether a transition into "new/overdue" is
/// worth a toast — one timer-owning class covers all seven here.
class StaffAlertsViewModel extends StateNotifier<StaffAlertsState> {
  final BookingUsecase bookingUsecase;
  final AssetsUsecase assetsUsecase;
  final OrdersUsecase ordersUsecase;
  final HousekeepingUsecase housekeepingUsecase;

  StaffAlertsViewModel(
    this.bookingUsecase,
    this.assetsUsecase,
    this.ordersUsecase,
    this.housekeepingUsecase,
  ) : super(const StaffAlertsState());

  final Map<String, List<StaffAlert>> _byCategory = {};
  final List<Timer> _timers = [];
  bool _started = false;

  static const _pendingOrderThresholdMinutes = 20;
  static const _coverageWindowDays = 30;

  void start({
    required bool canCheckin,
    required bool canCheckout,
    required bool canWorkOrders,
    required bool canCoverage,
    required bool canPendingOrders,
    required bool canHousekeeping,
    required bool canReports,
  }) {
    if (_started) return;
    _started = true;

    if (canCheckin) _poll('checkin', const Duration(seconds: 60), _loadCheckin);
    if (canCheckout) _poll('checkout', const Duration(seconds: 60), _loadCheckout);
    if (canWorkOrders) _poll('workOrder', const Duration(seconds: 60), _loadWorkOrders);
    if (canCoverage) _poll('coverage', const Duration(seconds: 300), _loadCoverage);
    if (canPendingOrders) _poll('order', const Duration(seconds: 60), _loadPendingOrders);
    if (canHousekeeping) _poll('housekeeping', const Duration(seconds: 30), _loadHousekeeping);
    if (canReports) _poll('reports', const Duration(seconds: 3600), _loadReportsReminder);
  }

  void _poll(String category, Duration interval, Future<void> Function() load) {
    load();
    _timers.add(Timer.periodic(interval, (_) => load()));
  }

  void _merge(String category, List<StaffAlert> items) {
    _byCategory[category] = items;
    state = state.copyWith(alerts: _byCategory.values.expand((l) => l).toList());
  }

  void _toast(String message, {bool urgent = false}) {
    state = state.copyWith(toast: StaffAlertToast(message, urgent: urgent));
  }

  void clearToast() => state = state.copyWith(clearToast: true);

  // ── Check-in / check-out ────────────────────────────────────────────────

  Set<int>? _overdueCheckin;

  Future<void> _loadCheckin() async {
    try {
      final list = await bookingUsecase.checkinAlerts();
      final nowOverdue = list.where((a) => a.overdue).map((a) => a.bookingRoomId).toSet();
      if (_overdueCheckin != null) {
        for (final a in list) {
          if (a.overdue && !_overdueCheckin!.contains(a.bookingRoomId)) {
            _toast(a.message, urgent: true);
          }
        }
      }
      _overdueCheckin = nowOverdue;
      _merge(
        'checkin',
        list.map((a) => StaffAlert(id: 'checkin-${a.bookingRoomId}', category: 'checkin', message: a.message, urgent: a.overdue)).toList(),
      );
    } catch (_) {
      _merge('checkin', const []);
    }
  }

  Set<int>? _overdueCheckout;

  Future<void> _loadCheckout() async {
    try {
      final list = await bookingUsecase.checkoutAlerts();
      final nowOverdue = list.where((a) => a.overdue).map((a) => a.bookingRoomId).toSet();
      if (_overdueCheckout != null) {
        for (final a in list) {
          if (a.overdue && !_overdueCheckout!.contains(a.bookingRoomId)) {
            _toast(a.message, urgent: true);
          }
        }
      }
      _overdueCheckout = nowOverdue;
      _merge(
        'checkout',
        list.map((a) => StaffAlert(id: 'checkout-${a.bookingRoomId}', category: 'checkout', message: a.message, urgent: a.overdue)).toList(),
      );
    } catch (_) {
      _merge('checkout', const []);
    }
  }

  // ── Work orders ─────────────────────────────────────────────────────────

  static const _issueTypeLabel = {'BREAKDOWN': 'Breakdown', 'ROUTINE_SERVICE': 'Routine service'};

  Set<int>? _seenWorkOrderIds;

  String _relativeTime(String iso) {
    final then = DateTime.tryParse(iso);
    if (then == null) return '';
    final mins = DateTime.now().difference(then).inMinutes.clamp(0, 1 << 30);
    if (mins < 60) return '$mins min ago';
    final hours = (mins / 60).round();
    if (hours < 24) return '${hours}h ago';
    return '${(hours / 24).round()}d ago';
  }

  Future<void> _loadWorkOrders() async {
    try {
      final list = await assetsUsecase.workOrders(status: 'OPEN');
      final ids = list.map((w) => w.id).toSet();
      if (_seenWorkOrderIds != null) {
        for (final w in list) {
          if (!_seenWorkOrderIds!.contains(w.id)) {
            _toast('New work order — ${w.assetName}: ${_issueTypeLabel[w.issueType] ?? w.issueType}.');
          }
        }
      }
      _seenWorkOrderIds = ids;
      _merge(
        'workOrder',
        list
            .map((w) => StaffAlert(
                  id: 'workorder-${w.id}',
                  category: 'workOrder',
                  message: 'New work order — ${w.assetName}: ${_issueTypeLabel[w.issueType] ?? w.issueType} (opened ${_relativeTime(w.openedAt)}).',
                ))
            .toList(),
      );
    } catch (_) {
      _merge('workOrder', const []);
    }
  }

  // ── Warranty / AMC coverage ─────────────────────────────────────────────

  int _daysUntil(String iso) {
    final target = DateTime(int.parse(iso.substring(0, 4)), int.parse(iso.substring(5, 7)), int.parse(iso.substring(8, 10)));
    final today = DateTime.now();
    final todayMidnight = DateTime(today.year, today.month, today.day);
    return target.difference(todayMidnight).inDays;
  }

  String _dateLabel(String iso) {
    final d = DateTime(int.parse(iso.substring(0, 4)), int.parse(iso.substring(5, 7)), int.parse(iso.substring(8, 10)));
    return '${d.day} ${_monthNames[d.month - 1].substring(0, 3)} ${d.year}';
  }

  Future<void> _loadCoverage() async {
    try {
      final assets = await assetsUsecase.assets();
      final out = <StaffAlert>[];
      for (final a in assets) {
        for (final entry in {'warrantyExpiry': 'Warranty', 'amcExpiry': 'AMC'}.entries) {
          final iso = entry.key == 'warrantyExpiry' ? a.warrantyExpiry : a.amcExpiry;
          if (iso == null || iso.length < 10) continue;
          final days = _daysUntil(iso);
          if (days > _coverageWindowDays) continue;
          out.add(StaffAlert(
            id: 'coverage-${a.id}-${entry.key}',
            category: 'coverage',
            message: days < 0
                ? '${a.name} — ${entry.value} coverage expired on ${_dateLabel(iso)}.'
                : '${a.name} — ${entry.value} coverage expires on ${_dateLabel(iso)}.',
          ));
        }
      }
      _merge('coverage', out);
    } catch (_) {
      _merge('coverage', const []);
    }
  }

  // ── Pending table orders ────────────────────────────────────────────────

  Set<int>? _seenPendingOrderIds;

  Future<void> _loadPendingOrders() async {
    try {
      final orders = await ordersUsecase.queue();
      final now = DateTime.now();
      final overdue = orders.where((o) {
        if (o.status != 'PENDING' || o.placedAt == null) return false;
        final placed = DateTime.tryParse(o.placedAt!);
        if (placed == null) return false;
        return now.difference(placed).inMinutes >= _pendingOrderThresholdMinutes;
      }).toList();
      final ids = overdue.map((o) => o.id).toSet();
      if (_seenPendingOrderIds != null) {
        for (final o in overdue) {
          if (!_seenPendingOrderIds!.contains(o.id)) {
            _toast('Table ${o.tableLabel ?? '—'} · Order #${o.orderNumber} is still waiting for the kitchen to accept it.', urgent: true);
          }
        }
      }
      _seenPendingOrderIds = ids;
      _merge(
        'order',
        overdue.map((o) {
          final waited = now.difference(DateTime.parse(o.placedAt!)).inMinutes;
          return StaffAlert(
            id: 'order-${o.id}',
            category: 'order',
            message: 'Table ${o.tableLabel ?? '—'} · Order #${o.orderNumber} — still waiting $waited min for the kitchen to accept it.',
            urgent: true,
          );
        }).toList(),
      );
    } catch (_) {
      _merge('order', const []);
    }
  }

  // ── Housekeeping ─────────────────────────────────────────────────────────

  String? _seenLatestIssueKey;
  int? _seenIssueCount;

  Future<void> _loadHousekeeping() async {
    try {
      final issues = await housekeepingUsecase.issues(scope: 'open');
      final latest = issues.isEmpty ? null : issues.first;
      final latestKey = latest?.key;
      if (_seenLatestIssueKey != null &&
          latestKey != null &&
          latestKey != _seenLatestIssueKey &&
          _seenIssueCount != null &&
          issues.length > _seenIssueCount!) {
        final what = latest!.kind == 'FOUND' ? 'Item found' : 'Problem reported';
        _toast('${latest.spaceLabel}: $what — ${latest.text}');
      }
      _seenLatestIssueKey = latestKey;
      _seenIssueCount = issues.length;
      _merge(
        'housekeeping',
        issues
            .map((i) => StaffAlert(
                  id: 'housekeeping-${i.logId}-${i.kind}',
                  category: 'housekeeping',
                  message: '${i.spaceLabel}: ${i.kind == 'FOUND' ? 'Item found' : 'Problem reported'} — ${i.text}',
                ))
            .toList(),
      );
    } catch (_) {
      _merge('housekeeping', const []);
    }
  }

  // ── Monthly reports reminder ─────────────────────────────────────────────

  int _daysInMonth(int year, int month) => DateTime(year, month + 1, 0).day;

  Future<void> _loadReportsReminder() async {
    final now = DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30));
    final lastDay = _daysInMonth(now.year, now.month);

    var targetYear = now.year;
    var targetMonth = now.month;
    var show = false;
    if (now.day == lastDay) {
      show = true;
    } else if (now.day <= 3) {
      show = true;
      targetMonth -= 1;
      if (targetMonth == 0) {
        targetMonth = 12;
        targetYear -= 1;
      }
    }

    _merge(
      'reports',
      show
          ? [
              StaffAlert(
                id: 'reports-reminder',
                category: 'reports',
                message: 'Monthly reports for ${_monthNames[targetMonth - 1]} $targetYear are ready for your review.',
              ),
            ]
          : const [],
    );
  }

  @override
  void dispose() {
    for (final t in _timers) {
      t.cancel();
    }
    super.dispose();
  }
}
