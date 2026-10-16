import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/customer.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'customer_form_screen.dart';

/// A customer's profile — gradient identity banner, compact stat tiles, a
/// details panel (email, last visit, ID proof, notes, tags) and the stay/event
/// history. Mirrors the "view mode" of Customers.jsx's own profile modal, as
/// its own full page. Responsive: stats go 2 → 4 across, details and history
/// 1 → 2 columns on wider screens, content capped at a readable width.
Future<void> showCustomerDetailScreen(BuildContext context, int customerId) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => CustomerDetailScreen(customerId: customerId)),
  );
}

class CustomerDetailScreen extends ConsumerStatefulWidget {
  final int customerId;
  const CustomerDetailScreen({super.key, required this.customerId});

  @override
  ConsumerState<CustomerDetailScreen> createState() => _CustomerDetailScreenState();
}

class _CustomerDetailScreenState extends ConsumerState<CustomerDetailScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(
      () => ref.read(customersViewModelProvider.notifier).loadDetail(widget.customerId),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(customersViewModelProvider);
    final detail = state.selected;

    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        title: Text(detail?.customer.name ?? 'Customer'),
        actions: [
          if (detail != null)
            IconButton(
              icon: const Icon(Icons.edit_outlined),
              tooltip: 'Edit details',
              onPressed: () => showCustomerFormScreen(context, customer: detail.customer),
            ),
        ],
      ),
      body: SafeArea(
        child: state.detailLoading
            ? const Center(child: CircularProgressIndicator())
            : state.error != null
                ? NeuNotice(
                    message: state.error!,
                    icon: Icons.cloud_off_rounded,
                    action: NeuButton(
                      onPressed: () => ref
                          .read(customersViewModelProvider.notifier)
                          .loadDetail(widget.customerId),
                      child: const Text('Try again'),
                    ),
                  )
                : detail == null
                    ? const SizedBox.shrink()
                    : _Body(detail: detail),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  final CustomerDetail detail;
  const _Body({required this.detail});

  @override
  Widget build(BuildContext context) {
    final c = detail.customer;
    final lastVisit = c.lastStayDate ?? c.lastEventDate;
    final tags = (c.tags ?? '').split(',').map((t) => t.trim()).where((t) => t.isNotEmpty).toList();

    return LayoutBuilder(
      builder: (context, constraints) {
        // Content is capped at 960, so size columns off the capped width.
        final contentWidth =
            (constraints.maxWidth > 960 ? 960.0 : constraints.maxWidth) - AppTheme.s16 * 2;
        final wide = contentWidth >= 560;
        final statCols = contentWidth >= 680 ? 4 : 2;

        final stats = [
          _StatData(Icons.bed_rounded, AppTheme.accent, '${c.totalStays}', 'Room stays', formatPrice(c.totalRoomSpend)),
          _StatData(Icons.celebration_rounded, AppTheme.edit, '${c.totalEvents}', 'Functions', formatPrice(c.totalEventSpend)),
          _StatData(Icons.payments_rounded, AppTheme.checkout, formatPrice(c.totalSpend), 'Total spend', null),
          _StatData(Icons.workspace_premium_rounded, AppTheme.muted, '${c.loyaltyPoints}', 'Loyalty points', 'Coming soon'),
        ];

        final facts = [
          _FactData(Icons.alternate_email_rounded, 'Email', c.email),
          _FactData(Icons.event_available_rounded, 'Last visit', lastVisit != null ? formatIsoDate(lastVisit) : null),
          _FactData(
            Icons.badge_outlined,
            'ID proof',
            (c.idProofType != null && c.idProofType!.isNotEmpty)
                ? '${c.idProofType} ${c.idProofNumber ?? ''}'.trim()
                : null,
          ),
          _FactData(Icons.notes_rounded, 'Notes', c.notes),
        ];

        return Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 960),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
              children: [
                _HeroCard(customer: c),
                const SizedBox(height: AppTheme.s8),
                _grid(contentWidth, statCols, [for (final s in stats) _StatCard(data: s)]),
                const SizedBox(height: AppTheme.s8),
                _Panel(
                  title: 'Details',
                  icon: Icons.info_outline_rounded,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _grid(
                        contentWidth - AppTheme.s12 * 2 - 2,
                        wide ? 2 : 1,
                        [for (final f in facts) _FactTile(data: f)],
                        gap: AppTheme.s12,
                      ),
                      if (tags.isNotEmpty) ...[
                        const SizedBox(height: AppTheme.s12),
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: [for (final t in tags) _Badge(text: t, color: AppTheme.edit)],
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: AppTheme.s12),
                Row(
                  children: [
                    const Icon(Icons.history_rounded, size: 16, color: AppTheme.accent),
                    const SizedBox(width: 6),
                    Text('History', style: Theme.of(context).textTheme.titleSmall),
                    const SizedBox(width: AppTheme.s8),
                    if (detail.history.isNotEmpty)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppTheme.accent.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          '${detail.history.length}',
                          style: const TextStyle(color: AppTheme.accent, fontSize: 11, fontWeight: FontWeight.w800),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: AppTheme.s8),
                if (detail.history.isEmpty)
                  const NeuNotice(message: 'No stays or bookings yet.', icon: Icons.history_rounded)
                else
                  _grid(contentWidth, wide ? 2 : 1, [for (final h in detail.history) _HistoryRow(item: h)]),
              ],
            ),
          ),
        );
      },
    );
  }

  /// Equal-width wrapped grid — children size to their own content height.
  static Widget _grid(double maxWidth, int cols, List<Widget> children, {double gap = AppTheme.s8}) {
    final w = (maxWidth - gap * (cols - 1)) / cols;
    return Wrap(
      spacing: gap,
      runSpacing: gap,
      children: [for (final c in children) SizedBox(width: w, child: c)],
    );
  }
}

/// Gradient identity banner: avatar, name, contact line, opt-in pill.
class _HeroCard extends StatelessWidget {
  final Customer customer;
  const _HeroCard({required this.customer});

  @override
  Widget build(BuildContext context) {
    final c = customer;
    return Container(
      padding: const EdgeInsets.all(AppTheme.s16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppTheme.accent, AppTheme.accent.withValues(alpha: 0.72)],
        ),
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        boxShadow: AppTheme.subtle,
      ),
      child: Row(
        children: [
          Container(
            width: 56,
            height: 56,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.2),
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white.withValues(alpha: 0.5), width: 1.5),
            ),
            child: Text(
              c.name.isNotEmpty ? c.name[0].toUpperCase() : '?',
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 22),
            ),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  c.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Icon(Icons.call_outlined, size: 13, color: Colors.white.withValues(alpha: 0.85)),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        c.phone,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: Colors.white.withValues(alpha: 0.9), fontSize: 13),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        c.marketingOptIn ? Icons.check_circle_rounded : Icons.do_not_disturb_on_outlined,
                        size: 12,
                        color: Colors.white,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        c.marketingOptIn ? 'Opted in to offers' : 'Opted out of offers',
                        style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StatData {
  final IconData icon;
  final Color color;
  final String value;
  final String label;
  final String? sub;
  const _StatData(this.icon, this.color, this.value, this.label, this.sub);
}

/// Compact KPI tile: tinted icon badge, headline number, label + sub-line.
class _StatCard extends StatelessWidget {
  final _StatData data;
  const _StatCard({required this.data});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 72,
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.subtle,
      ),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: data.color.withValues(alpha: 0.12), shape: BoxShape.circle),
            child: Icon(data.icon, size: 16, color: data.color),
          ),
          const SizedBox(width: AppTheme.s8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  data.value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppTheme.heading, fontSize: 16, fontWeight: FontWeight.w800),
                ),
                Text(
                  data.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppTheme.muted, fontSize: 11, fontWeight: FontWeight.w500),
                ),
                if (data.sub != null)
                  Text(
                    data.sub!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: data.color, fontSize: 10.5, fontWeight: FontWeight.w700),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  final String title;
  final IconData icon;
  final Widget child;
  const _Panel({required this.title, required this.icon, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.subtle,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: AppTheme.accent),
              const SizedBox(width: 6),
              Text(title, style: Theme.of(context).textTheme.titleSmall),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          child,
        ],
      ),
    );
  }
}

class _FactData {
  final IconData icon;
  final String label;
  final String? value;
  const _FactData(this.icon, this.label, this.value);
}

class _FactTile extends StatelessWidget {
  final _FactData data;
  const _FactTile({required this.data});

  @override
  Widget build(BuildContext context) {
    final v = (data.value == null || data.value!.isEmpty) ? '—' : data.value!;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 28,
          height: 28,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(8)),
          child: Icon(data.icon, size: 15, color: AppTheme.muted),
        ),
        const SizedBox(width: AppTheme.s8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(data.label, style: const TextStyle(color: AppTheme.muted, fontSize: 11, fontWeight: FontWeight.w600)),
              const SizedBox(height: 1),
              Text(v, style: const TextStyle(color: AppTheme.text, fontSize: 13, fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ],
    );
  }
}

class _HistoryRow extends StatelessWidget {
  final CustomerHistoryItem item;
  const _HistoryRow({required this.item});

  @override
  Widget build(BuildContext context) {
    final isRoom = item.type == 'room';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 10),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.subtle,
      ),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.10), shape: BoxShape.circle),
            child: Icon(isRoom ? Icons.bed_rounded : Icons.celebration_rounded, size: 16, color: AppTheme.accent),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(item.label, style: Theme.of(context).textTheme.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 3),
                Wrap(
                  spacing: AppTheme.s8,
                  runSpacing: AppTheme.s4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (item.date != null)
                      Text(formatDateTime(item.date), style: const TextStyle(color: AppTheme.muted, fontSize: 11.5)),
                    _Badge(text: isRoom ? 'Room stay' : 'Function', color: AppTheme.accent),
                    if (item.status != null) _Badge(text: item.status!, color: AppTheme.muted),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          Text(
            formatPrice(item.amount),
            style: const TextStyle(color: AppTheme.heading, fontSize: 14, fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String text;
  final Color color;

  const _Badge({required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
      ),
      child: Text(
        text,
        style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }
}
