import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/customer.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'customer_form_screen.dart';

/// A customer's profile — avatar, opt-in status, stay/spend/loyalty stats,
/// the facts (email, last visit, ID proof, tags, notes) and their stay/event
/// history. Mirrors the "view mode" of Customers.jsx's own profile modal, as
/// its own full page, same treatment every other detail/form in the app gets.
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

    return ListView(
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
      children: [
        // ── Identity ──────────────────────────────────────────────────
        Container(
          padding: const EdgeInsets.all(AppTheme.s16),
          decoration: BoxDecoration(
            color: AppTheme.card,
            borderRadius: BorderRadius.circular(AppTheme.rMedium),
            border: Border.all(color: AppTheme.border),
            boxShadow: AppTheme.subtle,
          ),
          child: Row(
            children: [
              Container(
                width: 56,
                height: 56,
                alignment: Alignment.center,
                decoration: const BoxDecoration(color: AppTheme.sidebarBrandWash, shape: BoxShape.circle),
                child: Text(
                  c.name.isNotEmpty ? c.name[0].toUpperCase() : '?',
                  style: const TextStyle(color: AppTheme.sidebarBrandInk, fontWeight: FontWeight.w700, fontSize: 22),
                ),
              ),
              const SizedBox(width: AppTheme.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(c.name, style: Theme.of(context).textTheme.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        const Icon(Icons.call_outlined, size: 13, color: AppTheme.muted),
                        const SizedBox(width: 4),
                        Text(c.phone, style: const TextStyle(color: AppTheme.muted, fontSize: 13)),
                      ],
                    ),
                  ],
                ),
              ),
              _Badge(
                text: c.marketingOptIn ? 'Opted in' : 'Opted out',
                color: c.marketingOptIn ? AppTheme.checkout : AppTheme.muted,
              ),
            ],
          ),
        ),
        const SizedBox(height: AppTheme.s12),

        // ── Stats — two per row, loyalty points included ────────────────
        // Wrapped in IntrinsicHeight: a bare Row with crossAxisAlignment:
        // stretch inside a ListView gets an unbounded (0..Infinity) height
        // constraint and cannot resolve "stretch to fill", which crashes
        // layout. IntrinsicHeight measures the row's tallest child first and
        // hands the Row a finite height, so stretch (equalizing both cards
        // even when one carries a sub-line and the other doesn't) works.
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: _StatCard(
                  value: '${c.totalStays}',
                  sub: formatPrice(c.totalRoomSpend),
                  label: 'Room stays',
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: _StatCard(
                  value: '${c.totalEvents}',
                  sub: formatPrice(c.totalEventSpend),
                  label: 'Functions',
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppTheme.s8),
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: _StatCard(
                  value: formatPrice(c.totalSpend),
                  label: 'Total spend',
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: _StatCard(
                  value: '${c.loyaltyPoints}',
                  sub: 'Coming soon',
                  label: 'Loyalty points',
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppTheme.s12),

        // ── Facts ─────────────────────────────────────────────────────
        Container(
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s4),
          decoration: BoxDecoration(
            color: AppTheme.card,
            borderRadius: BorderRadius.circular(AppTheme.rMedium),
            border: Border.all(color: AppTheme.border),
            boxShadow: AppTheme.subtle,
          ),
          child: Column(
            children: [
              _FactRow(Icons.alternate_email_rounded, 'Email', c.email ?? '—'),
              _FactRow(
                Icons.event_available_rounded,
                'Last visit',
                (c.lastStayDate ?? c.lastEventDate) != null
                    ? formatIsoDate(c.lastStayDate ?? c.lastEventDate)
                    : '—',
              ),
              _FactRow(
                Icons.badge_outlined,
                'ID proof',
                (c.idProofType != null && c.idProofType!.isNotEmpty)
                    ? '${c.idProofType} ${c.idProofNumber ?? ''}'.trim()
                    : '—',
              ),
              _FactRow(Icons.sell_outlined, 'Tags', (c.tags != null && c.tags!.isNotEmpty) ? c.tags! : '—'),
              _FactRow(Icons.notes_rounded, 'Notes', (c.notes != null && c.notes!.isNotEmpty) ? c.notes! : '—', isLast: true),
            ],
          ),
        ),
        const SizedBox(height: AppTheme.s16),

        // ── History ───────────────────────────────────────────────────
        Row(
          children: [
            Text('History', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(width: AppTheme.s8),
            if (detail.history.isNotEmpty)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                child: Text('${detail.history.length}', style: const TextStyle(color: AppTheme.accent, fontSize: 11, fontWeight: FontWeight.w800)),
              ),
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        if (detail.history.isEmpty)
          const NeuNotice(message: 'No stays or bookings yet.', icon: Icons.history_rounded)
        else
          for (final h in detail.history) ...[
            _HistoryRow(item: h),
            const SizedBox(height: AppTheme.s8),
          ],
      ],
    );
  }
}

/// One KPI tile — plain: the headline number, an optional small sub-line
/// (spend, or "Coming soon" for loyalty) and a label underneath. No icon —
/// kept deliberately plain so the number is the only thing that draws the
/// eye.
class _StatCard extends StatelessWidget {
  final String value;
  final String? sub;
  final String label;

  const _StatCard({
    required this.value,
    this.sub,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.subtle,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (sub != null) ...[
            Align(
              alignment: Alignment.centerRight,
              child: Text(sub!, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppTheme.muted, fontSize: 11, fontWeight: FontWeight.w600)),
            ),
            const SizedBox(height: AppTheme.s8),
          ],
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppTheme.heading, fontSize: 20, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 11.5, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

class _FactRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final bool isLast;

  const _FactRow(this.icon, this.label, this.value, {this.isLast = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
      decoration: isLast
          ? null
          : const BoxDecoration(border: Border(bottom: BorderSide(color: AppTheme.border, width: 0.8))),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: AppTheme.muted),
          const SizedBox(width: AppTheme.s8),
          SizedBox(
            width: 82,
            child: Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 13)),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(color: AppTheme.text, fontSize: 13, fontWeight: FontWeight.w500)),
          ),
        ],
      ),
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
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.subtle,
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
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
