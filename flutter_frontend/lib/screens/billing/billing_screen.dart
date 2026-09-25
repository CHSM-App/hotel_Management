import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/invoice.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/billing_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'invoice_preview_screen.dart';
import 'issue_bill_screen.dart';
import 'issue_food_bill_screen.dart';

enum _BillingTab { toBill, food, issued }

/// Billing: what still has to be billed, and what already has been.
///
/// Two lists rather than the web's single screen with a modal over it. A phone
/// has no room to lay a bill over a queue, so the bill is a page of its own —
/// but the flow is the same one: pick a stay, check what it says, record what
/// the guest handed over, issue.
class BillingScreen extends ConsumerStatefulWidget {
  const BillingScreen({super.key});

  @override
  ConsumerState<BillingScreen> createState() => _BillingScreenState();
}

class _BillingScreenState extends ConsumerState<BillingScreen> {
  _BillingTab _tab = _BillingTab.toBill;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() => ref.read(billingViewModelProvider.notifier).load();

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(billingViewModelProvider);
    // A lodge bills stays, a restaurant bills open tables, and one with meals
    // does both — same split the web billing screen makes between its own
    // "Ready to bill" and "Food to bill" tabs.
    final servesFood = ref.watch(authViewModelProvider).me?.lodge.servesFood ?? false;
    final tab = servesFood || _tab != _BillingTab.food ? _tab : _BillingTab.toBill;

    return RefreshIndicator(
      onRefresh: _load,
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppTheme.s12,
          AppTheme.s8,
          AppTheme.s12,
          AppTheme.s24,
        ),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          _Toggle(
            tab: tab,
            showFood: servesFood,
            toBillCount: state.queue.valueOrNull?.length,
            foodCount: state.foodQueue.valueOrNull?.length,
            onChanged: (v) => setState(() => _tab = v),
          ),
          const SizedBox(height: AppTheme.s12),
          if (tab == _BillingTab.food)
            ..._food(state)
          else if (tab == _BillingTab.issued)
            ..._issued(state)
          else
            ..._queue(state),
        ],
      ),
    );
  }

  // ── Food to bill ─────────────────────────────────────────────────────────

  List<Widget> _food(BillingState state) => state.foodQueue.when(
    loading: () => const [
      SizedBox(height: 120),
      Center(child: CircularProgressIndicator()),
    ],
    error: (e, _) => [
      NeuNotice(
        icon: Icons.cloud_off_rounded,
        message: 'Could not load open tables.',
        action: NeuButton(onPressed: _load, child: const Text('Try again')),
      ),
    ],
    data: (rows) {
      if (rows.isEmpty) {
        return const [
          SizedBox(height: 80),
          NeuNotice(
            icon: Icons.task_alt_rounded,
            message: 'Nothing waiting — everything served has been billed.',
          ),
        ];
      }
      return [
        for (final tab in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s4 + 2),
            child: _RowCard(
              onTap: () async {
                await ref.read(billingViewModelProvider.notifier).openFood(tab);
                if (!mounted) return;
                await Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const IssueFoodBillScreen()),
                );
                if (!mounted) return;
                await _load();
              },
              icon: tab.isTakeaway
                  ? Icons.shopping_bag_outlined
                  : Icons.restaurant_rounded,
              title: tab.guestName != null
                  ? '${tab.tableLabel} · ${tab.guestName}'
                  : tab.tableLabel ?? 'Counter',
              subtitle: tab.isTakeaway
                  ? [
                      if (tab.customerPhone != null) tab.customerPhone!,
                      'Placed ${formatTimeOfDay(tab.openedAt)}',
                    ].join(' · ')
                  : '${tab.orderCount} order${tab.orderCount == 1 ? '' : 's'} '
                        '· since ${formatTimeOfDay(tab.openedAt)}',
              amount: tab.subtotal,
            ),
          ),
      ];
    },
  );

  // ── To bill ───────────────────────────────────────────────────────────────

  List<Widget> _queue(BillingState state) => state.queue.when(
    loading: () => const [
      SizedBox(height: 120),
      Center(child: CircularProgressIndicator()),
    ],
    error: (e, _) => [
      NeuNotice(
        icon: Icons.cloud_off_rounded,
        message: 'Could not load the billing queue.',
        action: NeuButton(onPressed: _load, child: const Text('Try again')),
      ),
    ],
    data: (rows) {
      if (rows.isEmpty) {
        return const [
          SizedBox(height: 80),
          NeuNotice(
            icon: Icons.task_alt_rounded,
            message: 'Nothing waiting to be billed.',
          ),
        ];
      }
      return [
        for (final stay in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s4 + 2),
            // The State's own mounted, not the closure's context — this
            // widget is rebuilt by the list around it, and checking the
            // wrong one is checking whether a context that has already been
            // replaced is still good.
            child: _RowCard(
              onTap: () async {
                await ref.read(billingViewModelProvider.notifier).open(stay);
                if (!mounted) return;
                await Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const IssueBillScreen()),
                );
                if (!mounted) return;
                await _load();
              },
              roomLabel: stay.roomNumber,
              title: stay.guestName ?? 'Guest',
              subtitle: [
                if (stay.categoryName != null) stay.categoryName!,
                'Stay ${formatPrice(stay.totalPrice)}',
                if ((stay.advanceAmount ?? 0) > 0)
                  'Adv ${formatPrice(stay.advanceAmount)}',
              ].join(' · '),
              amount: stay.balanceDue,
              amountLabel: 'To collect',
            ),
          ),
      ];
    },
  );

  // ── Issued ────────────────────────────────────────────────────────────────

  List<Widget> _issued(BillingState state) => state.invoices.when(
    loading: () => const [
      SizedBox(height: 120),
      Center(child: CircularProgressIndicator()),
    ],
    error: (e, _) => [
      NeuNotice(
        icon: Icons.cloud_off_rounded,
        message: 'Could not load the bills.',
        action: NeuButton(onPressed: _load, child: const Text('Try again')),
      ),
    ],
    data: (rows) {
      if (rows.isEmpty) {
        return const [
          SizedBox(height: 80),
          NeuNotice(
            icon: Icons.receipt_long_rounded,
            message: 'No bills issued yet.',
          ),
        ];
      }
      return [
        for (final invoice in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s4 + 2),
            child: _InvoiceCard(invoice: invoice),
          ),
      ];
    },
  );
}

// ── A queue row ──────────────────────────────────────────────────────────────

/// The shared shape behind every "to bill" / "food to bill" row: a colour
/// spine down the left edge (the same device the register page's booking
/// cards use to make status legible before the eye lands on any text), a
/// two-line title block, and a trailing figure — with a real ink ripple on
/// tap rather than [NeuCard]'s bare [GestureDetector], since a list a
/// cashier taps through all shift is worth the tactile feedback.
class _RowCard extends StatelessWidget {
  final IconData? icon;
  final String? roomLabel;
  final String title;
  final String subtitle;
  final num? amount;
  final String? amountLabel;
  final VoidCallback onTap;

  const _RowCard({
    this.icon,
    this.roomLabel,
    required this.title,
    required this.subtitle,
    required this.amount,
    this.amountLabel,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.extruded,
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          highlightColor: AppTheme.accent.withValues(alpha: 0.04),
          splashColor: AppTheme.accent.withValues(alpha: 0.08),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(width: 4, color: AppTheme.accent),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppTheme.s12,
                      AppTheme.s8,
                      AppTheme.s12,
                      AppTheme.s8,
                    ),
                    child: Row(
                      children: [
                        if (icon != null) ...[
                          Icon(icon, color: AppTheme.accent, size: 19),
                          const SizedBox(width: AppTheme.s8),
                        ],
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Row(
                                children: [
                                  Flexible(
                                    child: Text(
                                      title,
                                      style: Theme.of(context).textTheme.titleMedium,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  if (roomLabel != null) ...[
                                    const SizedBox(width: AppTheme.s8),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 8,
                                        vertical: 3,
                                      ),
                                      decoration: BoxDecoration(
                                        color: AppTheme.accent.withValues(alpha: 0.1),
                                        borderRadius: BorderRadius.circular(999),
                                      ),
                                      child: Text(
                                        'Room $roomLabel',
                                        style: const TextStyle(
                                          color: AppTheme.accent,
                                          fontSize: 11,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                              const SizedBox(height: 2),
                              Text(
                                subtitle,
                                style: Theme.of(context).textTheme.bodySmall,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: AppTheme.s8),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (amountLabel != null)
                              Text(
                                amountLabel!,
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            Text(
                              formatPrice(amount),
                              style: const TextStyle(
                                color: AppTheme.heading,
                                fontWeight: FontWeight.w700,
                                fontSize: 15,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(width: AppTheme.s4),
                        Icon(
                          Icons.chevron_right_rounded,
                          color: AppTheme.muted.withValues(alpha: 0.7),
                          size: 20,
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ── Which list ──────────────────────────────────────────────────────────────

class _Toggle extends StatelessWidget {
  final _BillingTab tab;
  final bool showFood;
  final int? toBillCount;
  final int? foodCount;
  final ValueChanged<_BillingTab> onChanged;

  const _Toggle({
    required this.tab,
    required this.showFood,
    required this.toBillCount,
    required this.foodCount,
    required this.onChanged,
  });

  static const double _height = 40;

  @override
  Widget build(BuildContext context) {
    final segments = [
      (
        tab: _BillingTab.toBill,
        label: toBillCount == null
            ? 'Ready to bill'
            : 'Ready to bill ($toBillCount)',
      ),
      if (showFood)
        (
          tab: _BillingTab.food,
          label: foodCount == null ? 'Food to bill' : 'Food to bill ($foodCount)',
        ),
      (tab: _BillingTab.issued, label: 'Bills'),
    ];
    final index = segments.indexWhere((s) => s.tab == tab);
    final slot = index < 0 ? 0 : index;

    Widget segment(String label, bool selected, VoidCallback onTap) =>
        Expanded(
          child: GestureDetector(
            onTap: onTap,
            behavior: HitTestBehavior.opaque,
            child: SizedBox(
              height: _height,
              child: Center(
                child: AnimatedDefaultTextStyle(
                  duration: const Duration(milliseconds: 200),
                  curve: Curves.easeOut,
                  style: TextStyle(
                    color: selected ? AppTheme.accent : AppTheme.muted,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                    fontSize: 13,
                  ),
                  child: Text(label, overflow: TextOverflow.ellipsis),
                ),
              ),
            ),
          ),
        );

    return Container(
      height: _height,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
      ),
      child: Stack(
        children: [
          // The sliding "pill" behind the active label — the one thing the
          // old pressed-vs-card pair lacked: a state that reads as selected
          // even when it sits on a page that's nearly the same shade.
          AnimatedAlign(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            alignment: Alignment(-1 + (2 * slot) / (segments.length - 1).clamp(1, 999), 0),
            child: FractionallySizedBox(
              widthFactor: 1 / segments.length,
              child: Container(
                height: _height - 8,
                decoration: BoxDecoration(
                  color: AppTheme.card,
                  borderRadius: BorderRadius.circular(AppTheme.rMedium - 4),
                  boxShadow: AppTheme.extruded,
                ),
              ),
            ),
          ),
          Row(
            children: [
              for (final s in segments)
                segment(s.label, s.tab == tab, () => onChanged(s.tab)),
            ],
          ),
        ],
      ),
    );
  }
}

// ── An issued bill ──────────────────────────────────────────────────────────

class _InvoiceCard extends ConsumerWidget {
  final Invoice invoice;

  const _InvoiceCard({required this.invoice});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tint = invoice.isVoid ? AppTheme.danger : AppTheme.accent;

    return Container(
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.extruded,
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          highlightColor: AppTheme.accent.withValues(alpha: 0.04),
          splashColor: AppTheme.accent.withValues(alpha: 0.08),
          // Print/Download/Share/Void used to live here, four buttons deep in
          // a card meant to be a queue row — they overflowed a narrow phone
          // no matter how they were packed. The bill now opens on its own
          // page, where those actions have a full-width row to themselves.
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => InvoicePreviewScreen(invoice: invoice)),
          ),
          // The same colour spine the queue rows use — accent for a live
          // bill, danger for a voided one, so a void reads before the eye
          // even reaches the chip.
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(width: 4, color: tint),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(AppTheme.s12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 34,
                              height: 34,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                  colors: [
                                    tint.withValues(alpha: 0.16),
                                    tint.withValues(alpha: 0.06),
                                  ],
                                ),
                                borderRadius: BorderRadius.circular(AppTheme.rSmall),
                              ),
                              child: Icon(
                                invoice.isEventBill
                                    ? Icons.celebration_outlined
                                    : invoice.tableLabel != null
                                    ? Icons.restaurant_rounded
                                    : Icons.receipt_long_rounded,
                                size: 16,
                                color: tint,
                              ),
                            ),
                            const SizedBox(width: AppTheme.s8),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    '${kDocumentLabels[invoice.documentType] ?? 'Bill'} '
                                    '${invoice.invoiceNumber ?? ''}',
                                    style: Theme.of(context).textTheme.titleMedium,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  const SizedBox(height: 1),
                                  Text(
                                    [
                                      invoice.guestName,
                                      if (invoice.isEventBill)
                                        invoice.venueName ?? 'Function'
                                      else if (invoice.roomNumber != null)
                                        'Room ${invoice.roomNumber}'
                                            '${invoice.isDormitory ? ' · Dormitory' : ''}'
                                      else if (invoice.tableLabel != null)
                                        invoice.tableLabel,
                                      formatIsoDate(invoice.createdAt),
                                    ].whereType<String>().where((s) => s.isNotEmpty).join(' · '),
                                    style: Theme.of(context).textTheme.bodySmall,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ],
                              ),
                            ),
                            if (invoice.isVoid)
                              Container(
                                margin: const EdgeInsets.only(left: AppTheme.s8),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 10,
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: AppTheme.danger.withValues(alpha: 0.1),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: Text(
                                  'Void',
                                  style: Theme.of(
                                    context,
                                  ).textTheme.labelSmall?.copyWith(color: AppTheme.danger),
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: AppTheme.s12),
                        Container(height: 1, color: AppTheme.border),
                        const SizedBox(height: AppTheme.s8),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            Flexible(
                              child: _Figure(label: 'Total', value: invoice.totalAmount),
                            ),
                            if (invoice.advancePaid > 0) ...[
                              const SizedBox(width: AppTheme.s16),
                              Flexible(
                                child: _Figure(
                                  label: 'Advance',
                                  value: invoice.advancePaid,
                                ),
                              ),
                            ],
                            const Spacer(),
                            _Figure(
                              label: 'Collected',
                              value: invoice.balanceCollected,
                              strong: true,
                            ),
                          ],
                        ),
                        // How the balance was tendered, one row per method. A
                        // bill paid part cash, part UPI says both — a single
                        // method against a split is a statement the guest can
                        // see is wrong.
                        if (invoice.tenders.length > 1) ...[
                          const SizedBox(height: AppTheme.s4),
                          for (final t in invoice.tenders)
                            Padding(
                              padding: const EdgeInsets.only(top: 2),
                              child: Text(
                                '${t.method} ${formatPrice(t.amount)}'
                                '${t.reference != null ? ' · ${t.reference}' : ''}',
                                style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                              ),
                            ),
                        ],
                        if (invoice.isVoid && invoice.voidReason != null) ...[
                          const SizedBox(height: AppTheme.s4),
                          Text(
                            'Voided: ${invoice.voidReason}',
                            style: const TextStyle(color: AppTheme.danger, fontSize: 11),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ── A labelled figure ───────────────────────────────────────────────────────

class _Figure extends StatelessWidget {
  final String label;
  final num? value;
  final bool strong;

  const _Figure({required this.label, required this.value, this.strong = false});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: Theme.of(context).textTheme.bodySmall,
          overflow: TextOverflow.ellipsis,
        ),
        Text(
          formatPrice(value),
          style: strong
              ? const TextStyle(
                  color: AppTheme.heading,
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                )
              : Theme.of(context).textTheme.bodyMedium,
          overflow: TextOverflow.ellipsis,
        ),
      ],
    );
  }
}
