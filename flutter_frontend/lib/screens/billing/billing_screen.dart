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
  bool _showIssued = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() => ref.read(billingViewModelProvider.notifier).load();

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(billingViewModelProvider);

    return RefreshIndicator(
      onRefresh: _load,
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppTheme.s16,
          AppTheme.s8,
          AppTheme.s16,
          AppTheme.s32,
        ),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          _Toggle(
            showIssued: _showIssued,
            queueCount: state.queue.valueOrNull?.length,
            onChanged: (v) => setState(() => _showIssued = v),
          ),
          const SizedBox(height: AppTheme.s16),
          if (_showIssued) ..._issued(state) else ..._queue(state),
        ],
      ),
    );
  }

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
            padding: const EdgeInsets.only(bottom: AppTheme.s8),
            child: NeuCard(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.s12,
                vertical: AppTheme.s12,
              ),
              // The State's own mounted, not the closure's context — this
              // widget is rebuilt by the list around it, and checking the
              // wrong one is checking whether a context that has already been
              // replaced is still good.
              onTap: () async {
                await ref.read(billingViewModelProvider.notifier).open(stay);
                if (!mounted) return;
                await Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const IssueBillScreen()),
                );
                if (!mounted) return;
                await _load();
              },
              child: Row(
                children: [
                  // Room number as a small badge — the one fact worth
                  // reading at a glance before the guest's name.
                  Container(
                    width: 40,
                    height: 40,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppTheme.bg,
                      borderRadius: BorderRadius.circular(AppTheme.rSmall),
                    ),
                    child: Text(
                      stay.roomNumber ?? '—',
                      style: const TextStyle(
                        color: AppTheme.heading,
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                    ),
                  ),
                  const SizedBox(width: AppTheme.s12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          stay.guestName ?? 'Guest',
                          style: Theme.of(context).textTheme.titleMedium,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          [
                            if (stay.categoryName != null) stay.categoryName!,
                            'Stay ${formatPrice(stay.totalPrice)}',
                            if ((stay.advanceAmount ?? 0) > 0)
                              'Adv ${formatPrice(stay.advanceAmount)}',
                          ].join(' · '),
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
                      Text(
                        'To collect',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      Text(
                        formatPrice(stay.balanceDue),
                        style: const TextStyle(
                          color: AppTheme.heading,
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(width: 2),
                  const Icon(
                    Icons.chevron_right,
                    color: AppTheme.muted,
                    size: 20,
                  ),
                ],
              ),
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
            padding: const EdgeInsets.only(bottom: AppTheme.s8),
            child: _InvoiceCard(invoice: invoice),
          ),
      ];
    },
  );
}

// ── Which list ──────────────────────────────────────────────────────────────

class _Toggle extends StatelessWidget {
  final bool showIssued;
  final int? queueCount;
  final ValueChanged<bool> onChanged;

  const _Toggle({
    required this.showIssued,
    required this.queueCount,
    required this.onChanged,
  });

  static const double _height = 44;

  @override
  Widget build(BuildContext context) {
    final toBillLabel =
        queueCount == null ? 'To bill' : 'To bill ($queueCount)';

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
            alignment:
                showIssued ? Alignment.centerRight : Alignment.centerLeft,
            child: FractionallySizedBox(
              widthFactor: 0.5,
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
              segment(toBillLabel, !showIssued, () => onChanged(false)),
              segment('Issued', showIssued, () => onChanged(true)),
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
    return NeuCard(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.s12,
        vertical: AppTheme.s12,
      ),
      // Print/Download/Share/Void used to live here, four buttons deep in a
      // card meant to be a queue row — they overflowed a narrow phone no
      // matter how they were packed. The bill now opens on its own page,
      // where those actions have a full-width row to themselves.
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => InvoicePreviewScreen(invoice: invoice)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${kDocumentLabels[invoice.documentType] ?? 'Bill'} '
                  '${invoice.invoiceNumber ?? ''}',
                  style: Theme.of(context).textTheme.titleMedium,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (invoice.isVoid)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.danger.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: const Text(
                    'Void',
                    style: TextStyle(
                      color: AppTheme.danger,
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            [
              invoice.guestName,
              if (invoice.roomNumber != null) 'Room ${invoice.roomNumber}',
              formatIsoDate(invoice.createdAt),
            ].whereType<String>().where((s) => s.isNotEmpty).join(' · '),
            style: Theme.of(context).textTheme.bodySmall,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: AppTheme.s8),
          Row(
            children: [
              _Figure(label: 'Total', value: invoice.totalAmount),
              const SizedBox(width: AppTheme.s16),
              if (invoice.advancePaid > 0)
                _Figure(label: 'Advance', value: invoice.advancePaid),
              const Spacer(),
              _Figure(
                label: 'Collected',
                value: invoice.balanceCollected,
                strong: true,
              ),
            ],
          ),
          // How the balance was tendered, one row per method. A bill paid part
          // cash, part UPI says both — a single method against a split is a
          // statement the guest can see is wrong.
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
        Text(label, style: Theme.of(context).textTheme.bodySmall),
        Text(
          formatPrice(value),
          style: TextStyle(
            color: strong ? AppTheme.heading : AppTheme.text,
            fontSize: strong ? 16 : 14,
            fontWeight: strong ? FontWeight.w500 : FontWeight.w400,
          ),
        ),
      ],
    );
  }
}
