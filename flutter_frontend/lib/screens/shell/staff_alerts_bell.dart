import 'package:flutter/material.dart';

import '../../domain/models/staff_alert.dart';
import '../theme.dart';

/// Category metadata — mirrors CATEGORY_META/CATEGORY_ORDER in
/// frontend/src/components/StaffAlertsBell.jsx. Order here is display order;
/// a category with nothing to show simply never appears.
class _CategoryMeta {
  final String label;
  final Color color;
  final IconData icon;

  const _CategoryMeta(this.label, this.color, this.icon);
}

const _categoryMeta = <String, _CategoryMeta>{
  'enquiry': _CategoryMeta('Enquiries', Color(0xFFDB2777), Icons.chat_bubble_rounded),
  'checkin': _CategoryMeta('Arrivals today', Color(0xFF2563EB), Icons.login_rounded),
  'checkout': _CategoryMeta('Check-outs', Color(0xFFEA580C), Icons.logout_rounded),
  'order': _CategoryMeta('Kitchen', Color(0xFFD97706), Icons.room_service_rounded),
  'workOrder': _CategoryMeta('Maintenance', Color(0xFF7C3AED), Icons.build_rounded),
  'coverage': _CategoryMeta('Coverage', Color(0xFF0D9488), Icons.shield_rounded),
  'housekeeping': _CategoryMeta('Housekeeping', Color(0xFF16A34A), Icons.cleaning_services_rounded),
  'reports': _CategoryMeta('Reports', Color(0xFF0284C7), Icons.bar_chart_rounded),
};

const _categoryOrder = ['enquiry', 'checkin', 'checkout', 'order', 'workOrder', 'coverage', 'housekeeping', 'reports'];

/// The bell in the top bar: every category of thing worth a staff member's
/// attention right now, grouped under its own heading on its own page —
/// same full-page treatment every other detail screen in the app gets
/// (StaffAlertsBell.jsx is the web's dropdown-panel equivalent).
class StaffAlertsBell extends StatefulWidget {
  final List<StaffAlert> alerts;

  /// Runs when staff tap an alert's action button (an enquiry's "View") —
  /// the shell takes them to the section where it is handled.
  final ValueChanged<StaffAlert>? onAction;

  const StaffAlertsBell({super.key, required this.alerts, this.onAction});

  @override
  State<StaffAlertsBell> createState() => _StaffAlertsBellState();
}

/// A 3s loop — the bell rings (a quick back-and-forth wiggle) over the first
/// third, then sits still for the rest — repeated for as long as there is
/// something to show, so the icon keeps drawing the eye without being
/// distracting the whole time. The badge pulses on the same clock.
class _StaffAlertsBellState extends State<StaffAlertsBell> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _ring;
  late final Animation<double> _pulse;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 3000));

    _ring = TweenSequence<double>([
      TweenSequenceItem(tween: Tween(begin: 0.0, end: -0.22), weight: 1),
      TweenSequenceItem(tween: Tween(begin: -0.22, end: 0.22), weight: 1),
      TweenSequenceItem(tween: Tween(begin: 0.22, end: -0.14), weight: 1),
      TweenSequenceItem(tween: Tween(begin: -0.14, end: 0.14), weight: 1),
      TweenSequenceItem(tween: Tween(begin: 0.14, end: 0.0), weight: 1),
      TweenSequenceItem(tween: ConstantTween(0.0), weight: 5),
    ]).animate(_controller);

    _pulse = TweenSequence<double>([
      TweenSequenceItem(tween: Tween(begin: 1.0, end: 1.12), weight: 1),
      TweenSequenceItem(tween: Tween(begin: 1.12, end: 1.0), weight: 1),
      TweenSequenceItem(tween: ConstantTween(1.0), weight: 8),
    ]).animate(CurvedAnimation(parent: _controller, curve: const Interval(0, 0.25)));

    if (widget.alerts.isNotEmpty) _controller.repeat();
  }

  @override
  void didUpdateWidget(covariant StaffAlertsBell oldWidget) {
    super.didUpdateWidget(oldWidget);
    final hasAlerts = widget.alerts.isNotEmpty;
    if (hasAlerts && !_controller.isAnimating) {
      _controller.repeat();
    } else if (!hasAlerts && _controller.isAnimating) {
      _controller.stop();
      _controller.value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final count = widget.alerts.length;

    return IconButton(
      tooltip: count > 0 ? 'Staff alerts — $count ${count == 1 ? 'item' : 'items'}' : 'Staff alerts',
      visualDensity: VisualDensity.compact,
      padding: const EdgeInsets.all(4),
      onPressed: () => _open(context),
      icon: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) => SizedBox(
          width: 40,
          height: 40,
          child: Stack(
            clipBehavior: Clip.none,
            alignment: Alignment.center,
            children: [
              // Soft tinted circle behind the bell, matching the menu button.
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white.withValues(alpha: count > 0 ? 0.24 : 0.16),
                ),
                child: Transform.rotate(
                  angle: _ring.value,
                  alignment: Alignment.topCenter,
                  child: Icon(
                    count > 0 ? Icons.notifications_rounded : Icons.notifications_none_rounded,
                    color: Colors.white,
                    size: 21,
                  ),
                ),
              ),
              if (count > 0)
                Positioned(
                  right: -2,
                  top: -2,
                  child: Transform.scale(
                    scale: _pulse.value,
                    child: _CountBadge(count: count),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  void _open(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => StaffAlertsScreen(alerts: widget.alerts, onAction: widget.onAction),
      ),
    );
  }
}

/// Full-page staff alerts screen, reached by tapping the bell.
class StaffAlertsScreen extends StatelessWidget {
  final List<StaffAlert> alerts;
  final ValueChanged<StaffAlert>? onAction;

  const StaffAlertsScreen({super.key, required this.alerts, this.onAction});

  @override
  Widget build(BuildContext context) {
    final sections = [
      for (final category in _categoryOrder)
        (category: category, items: alerts.where((a) => a.category == category).toList()),
    ].where((s) => s.items.isNotEmpty).toList();

    final total = alerts.length;
    final urgentCount = alerts.where((a) => a.urgent).length;

    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Notifications'),
            if (total > 0) ...[
              const SizedBox(width: AppTheme.s8),
              _CountBadge(count: total),
            ],
          ],
        ),
      ),
      body: SafeArea(
        child: sections.isEmpty
            ? const _EmptyState()
            : ListView(
                padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s24),
                children: [
                  if (urgentCount > 0) _UrgentBanner(count: urgentCount),
                  for (final section in sections)
                    _Section(
                      category: section.category,
                      items: section.items,
                      onAction: onAction == null
                          ? null
                          : (a) {
                              Navigator.of(context).pop();
                              onAction!(a);
                            },
                    ),
                ],
              ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.s32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppTheme.accent.withValues(alpha: 0.08),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.notifications_none_rounded, size: 30, color: AppTheme.accent),
            ),
            const SizedBox(height: AppTheme.s16),
            Text(
              "You're all caught up",
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: AppTheme.s4),
            const Text(
              'Nothing needs attention right now.',
              style: TextStyle(color: AppTheme.muted, fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _UrgentBanner extends StatelessWidget {
  final int count;

  const _UrgentBanner({required this.count});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: AppTheme.s16),
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8 + 2),
      decoration: BoxDecoration(
        color: AppTheme.danger.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_rounded, size: 16, color: AppTheme.danger),
          const SizedBox(width: AppTheme.s8),
          Expanded(
            child: Text(
              '$count ${count == 1 ? 'item needs' : 'items need'} urgent attention',
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.danger),
            ),
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  final String category;
  final List<StaffAlert> items;
  final ValueChanged<StaffAlert>? onAction;

  const _Section({required this.category, required this.items, this.onAction});

  @override
  Widget build(BuildContext context) {
    final meta = _categoryMeta[category]!;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.s16 + AppTheme.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s8, left: AppTheme.s4),
            child: Text(
              meta.label.toUpperCase(),
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: AppTheme.muted,
                letterSpacing: 0.6,
              ),
            ),
          ),
          for (final a in items) _AlertRow(alert: a, meta: meta, onAction: onAction),
        ],
      ),
    );
  }
}

class _AlertRow extends StatelessWidget {
  final StaffAlert alert;
  final _CategoryMeta meta;
  final ValueChanged<StaffAlert>? onAction;

  const _AlertRow({required this.alert, required this.meta, this.onAction});

  @override
  Widget build(BuildContext context) {
    final urgent = alert.urgent;
    final accentColor = urgent ? AppTheme.danger : meta.color;

    return Container(
      margin: const EdgeInsets.only(bottom: AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        boxShadow: AppTheme.subtle,
        border: Border(left: BorderSide(color: accentColor, width: 3)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.s12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 38,
              height: 38,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: accentColor.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(meta.icon, size: 18, color: accentColor),
            ),
            const SizedBox(width: AppTheme.s12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    meta.label,
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppTheme.heading),
                  ),
                  const SizedBox(height: AppTheme.s4),
                  Text(
                    alert.message,
                    style: const TextStyle(fontSize: 13, height: 1.35, color: AppTheme.text),
                  ),
                  if (alert.actionLabel != null && onAction != null) ...[
                    const SizedBox(height: AppTheme.s8),
                    OutlinedButton(
                      onPressed: () => onAction!(alert),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: accentColor,
                        side: BorderSide(color: accentColor),
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                      ),
                      child: Text(alert.actionLabel!),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Same small red pill look as sidebar.dart's own `_CountBadge` — duplicated
/// rather than shared since that one is private to the sidebar file, and
/// this is the only other place that needs it.
class _CountBadge extends StatelessWidget {
  final int count;

  const _CountBadge({required this.count});

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 18),
      height: 18,
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(horizontal: 4),
      decoration: BoxDecoration(
        color: AppTheme.danger,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppTheme.navbar, width: 1.5),
      ),
      child: Text(
        count > 99 ? '99+' : '$count',
        style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w700, height: 1),
      ),
    );
  }
}
