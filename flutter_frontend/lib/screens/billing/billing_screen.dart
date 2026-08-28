import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/invoice.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/billing_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'bill_pdf.dart';
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
            padding: const EdgeInsets.only(bottom: AppTheme.s12),
            child: NeuCard(
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
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          stay.guestName ?? 'Guest',
                          style: Theme.of(context).textTheme.titleMedium,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const Icon(Icons.chevron_right, color: AppTheme.muted),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Room ${stay.roomNumber ?? '—'}'
                    '${stay.categoryName != null ? ' · ${stay.categoryName}' : ''}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: AppTheme.s12),
                  Row(
                    children: [
                      _Figure(label: 'Stay', value: stay.totalPrice),
                      const SizedBox(width: AppTheme.s24),
                      if ((stay.advanceAmount ?? 0) > 0)
                        _Figure(label: 'Advance', value: stay.advanceAmount),
                      const Spacer(),
                      _Figure(
                        label: 'To collect',
                        value: stay.balanceDue,
                        strong: true,
                      ),
                    ],
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
            padding: const EdgeInsets.only(bottom: AppTheme.s12),
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

  @override
  Widget build(BuildContext context) {
    Widget tab(String label, bool selected, VoidCallback onTap) =>
        Expanded(
          child: GestureDetector(
            onTap: onTap,
            child: selected
                ? NeuPressed(
                    radius: AppTheme.rMedium,
                    padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                    child: Center(
                      child: Text(
                        label,
                        style: const TextStyle(
                          color: AppTheme.accent,
                          fontWeight: FontWeight.w500,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  )
                : NeuCard(
                    shadow: AppTheme.subtle,
                    padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                    child: Center(
                      child: Text(
                        label,
                        style: const TextStyle(
                          color: AppTheme.text,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ),
          ),
        );

    return Row(
      children: [
        tab(
          queueCount == null ? 'To bill' : 'To bill ($queueCount)',
          !showIssued,
          () => onChanged(false),
        ),
        const SizedBox(width: AppTheme.s8),
        tab('Issued', showIssued, () => onChanged(true)),
      ],
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
          ),
          const SizedBox(height: AppTheme.s12),
          Row(
            children: [
              _Figure(label: 'Total', value: invoice.totalAmount),
              const SizedBox(width: AppTheme.s24),
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
            const SizedBox(height: AppTheme.s8),
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
            const SizedBox(height: AppTheme.s8),
            Text(
              'Voided: ${invoice.voidReason}',
              style: const TextStyle(color: AppTheme.danger, fontSize: 11),
            ),
          ],
          const SizedBox(height: AppTheme.s12),
          Row(
            children: [
              // Offered on a void bill too: the desk still has to be able to
              // produce the document it issued, marked void, when somebody
              // asks what happened to that number.
              NeuButton(
                onPressed: () => _sharePdf(context, ref),
                padding: const EdgeInsets.symmetric(
                  horizontal: AppTheme.s16,
                  vertical: AppTheme.s8,
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.download_rounded,
                      size: 16,
                      color: AppTheme.heading,
                    ),
                    SizedBox(width: 6),
                    Text('PDF'),
                  ],
                ),
              ),
              const Spacer(),
              if (!invoice.isVoid)
                TextButton(
                  onPressed: () => _confirmVoid(context, ref),
                  child: const Text(
                    'Void this bill',
                    style: TextStyle(color: AppTheme.danger, fontSize: 13),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  /// Build the document and hand it to the platform's share sheet, which is
  /// where "save to Files", "send on WhatsApp" and "print" all live on a phone.
  Future<void> _sharePdf(BuildContext context, WidgetRef ref) async {
    final lodgeName = ref.read(authViewModelProvider).me?.lodge.name;
    try {
      await BillPdf.share(invoice, lodgeName: lodgeName);
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not build the PDF.'),
          backgroundColor: AppTheme.heading,
        ),
      );
    }
  }

  Future<void> _confirmVoid(BuildContext context, WidgetRef ref) async {
    final controller = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text('Void this bill?', style: TextStyle(color: AppTheme.heading)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              // A void is not a delete: the document stays on file and its
              // number is never reused, because a gap in the series is what an
              // auditor asks about.
              'The bill stays on file marked void, and its number is not '
              'reused. Say why.',
              style: TextStyle(color: AppTheme.text, fontSize: 13),
            ),
            const SizedBox(height: AppTheme.s16),
            NeuField(controller: controller, label: 'Reason', maxLength: 200),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Keep it'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text(
              'Void',
              style: TextStyle(color: AppTheme.danger),
            ),
          ),
        ],
      ),
    );

    if (reason == null || reason.isEmpty || !context.mounted) return;
    final ok = await ref
        .read(billingViewModelProvider.notifier)
        .voidInvoice(invoice.id, reason);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(ok ? 'Bill voided.' : 'Could not void that bill.'),
        backgroundColor: AppTheme.heading,
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
