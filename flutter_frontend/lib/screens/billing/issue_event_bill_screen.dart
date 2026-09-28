import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/invoice.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/billing_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/payment_row.dart';
import '../theme.dart';
import 'bill_receipt_screen.dart';

/// Settle & bill a function — mirrors IssueBillScreen, but for a venue hire
/// rather than a stay: no nights, no late checkout, no cycle discount, and
/// an "extras on the day" reminder that blocks the bill until every extra
/// has a price, the same rule the server enforces.
class IssueEventBillScreen extends ConsumerWidget {
  const IssueEventBillScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(billingViewModelProvider);
    final vm = ref.read(billingViewModelProvider.notifier);
    final preview = state.eventPreview;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          state.eventTarget?.title ?? 'Settle & bill',
          overflow: TextOverflow.ellipsis,
        ),
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          onPressed: () {
            vm.closeEvent();
            Navigator.of(context).pop();
          },
        ),
      ),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: AppTheme.maxContentWidth),
            child: preview == null
                ? Center(
                    child: state.previewing
                        ? const CircularProgressIndicator()
                        : NeuNotice(
                            icon: Icons.cloud_off_rounded,
                            message: state.error ?? 'Could not load this bill.',
                            action: NeuButton(
                              onPressed: vm.refreshEventPreview,
                              child: const Text('Try again'),
                            ),
                          ),
                  )
                : _Body(state: state, preview: preview),
          ),
        ),
      ),
    );
  }
}

class _Body extends ConsumerWidget {
  final BillingState state;
  final EventBillPreview preview;

  const _Body({required this.state, required this.preview});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(billingViewModelProvider.notifier);
    final amounts = preview.amounts;

    if (preview.alreadyInvoiced) {
      return const NeuNotice(
        icon: Icons.check_circle_outline_rounded,
        message: 'This function has already been billed.',
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s8, AppTheme.s12, AppTheme.s24),
      children: [
        NeuCard(
          radius: AppTheme.rMedium,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          AppTheme.accent.withValues(alpha: 0.16),
                          AppTheme.accent.withValues(alpha: 0.06),
                        ],
                      ),
                      borderRadius: BorderRadius.circular(AppTheme.rSmall),
                    ),
                    child: const Icon(Icons.receipt_long_rounded, color: AppTheme.accent, size: 18),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  Expanded(
                    child: Text(
                      kDocumentLabels[amounts?.documentType] ?? 'Bill',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppTheme.accent.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      preview.isGstRegistered ? 'GST' : 'Non-GST',
                      style: const TextStyle(color: AppTheme.accent, fontSize: 10.5, fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.s8),
              Text(
                '${preview.eventTitle ?? 'Function'} · ${preview.venueName ?? '—'} · ${preview.billablePax} guests',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const Divider(height: AppTheme.s24),

              for (final line in preview.roomCharges) _Row(label: line.label, value: line.amount),

              if (preview.foodItems.isNotEmpty) ...[
                const SizedBox(height: AppTheme.s4),
                Text('Catering', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.heading)),
                for (final item in preview.foodItems)
                  _Row(label: '${item.name} (${item.quantity} × ${formatPrice(item.unitPrice)})', value: item.lineTotal),
              ],

              if ((amounts?.discountAmount ?? 0) > 0)
                _Row(label: 'Discount', value: -amounts!.discountAmount),

              const Divider(height: AppTheme.s24),

              if ((amounts?.cgstAmount ?? 0) > 0 || (amounts?.sgstAmount ?? 0) > 0) ...[
                _Row(label: 'CGST (${amounts?.cgstRatePercent ?? 0}%)', value: amounts?.cgstAmount ?? 0, muted: true),
                _Row(label: 'SGST (${amounts?.sgstRatePercent ?? 0}%)', value: amounts?.sgstAmount ?? 0, muted: true),
              ],
              if ((amounts?.foodCgstAmount ?? 0) > 0 || (amounts?.foodSgstAmount ?? 0) > 0) ...[
                _Row(label: 'CGST (${amounts?.foodCgstRatePercent ?? 0}%) on food', value: amounts?.foodCgstAmount ?? 0, muted: true),
                _Row(label: 'SGST (${amounts?.foodSgstRatePercent ?? 0}%) on food', value: amounts?.foodSgstAmount ?? 0, muted: true),
              ],
              if ((amounts?.roundOff ?? 0) != 0)
                _Row(label: 'Round off', value: amounts!.roundOff, muted: true),

              _Row(label: 'Grand total', value: amounts?.totalAmount ?? 0, strong: true),

              if (preview.advancePaid > 0)
                _Row(
                  label: preview.advanceReceiptNumbers == null
                      ? 'Less advance'
                      : 'Less advance (Rec. ${preview.advanceReceiptNumbers})',
                  value: -preview.advancePaid,
                ),

              const SizedBox(height: AppTheme.s4),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
                decoration: BoxDecoration(
                  color: AppTheme.accent.withValues(alpha: 0.07),
                  borderRadius: BorderRadius.circular(AppTheme.rSmall),
                ),
                child: Row(
                  children: [
                    Text('Balance due', style: Theme.of(context).textTheme.titleSmall),
                    const Spacer(),
                    Text(
                      formatPrice(preview.balanceDue),
                      style: const TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w700, fontSize: 17),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),

        if (preview.extrasOnDay.isNotEmpty) ...[
          const SizedBox(height: AppTheme.s12),
          NeuCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Extras on the day', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: AppTheme.s8),
                for (final e in preview.extrasOnDay)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${e.label}${e.quantity > 1 ? ' × ${e.quantity}' : ''}',
                            style: const TextStyle(color: AppTheme.text, fontSize: 13),
                          ),
                        ),
                        Text(
                          e.needsPricing ? 'price to set' : formatPrice(e.amount),
                          style: TextStyle(color: e.needsPricing ? AppTheme.danger : AppTheme.text, fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                if (preview.hasUnpricedExtras) ...[
                  const SizedBox(height: 4),
                  const Text(
                    'Close this screen and set a price on each extra before the bill can be issued.',
                    style: TextStyle(color: AppTheme.danger, fontSize: 12),
                  ),
                ],
              ],
            ),
          ),
        ],

        const SizedBox(height: AppTheme.s16),
        Row(
          children: [
            const Icon(Icons.payments_outlined, color: AppTheme.accent, size: 18),
            const SizedBox(width: AppTheme.s8),
            Text('Record how the organiser paid', style: Theme.of(context).textTheme.titleMedium),
          ],
        ),
        const SizedBox(height: AppTheme.s4),
        Text(
          state.nothingDue
              ? 'The advance already covers this bill. Nothing is left to collect — issue it as it stands.'
              : '${formatPrice(state.balanceDue)} is due. Choose the payment type for each amount taken.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: AppTheme.s12),
        if (!state.nothingDue) _PaymentRows(state: state),

        const SizedBox(height: AppTheme.s16),
        if (state.error != null) ...[
          Text(state.error!, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppTheme.danger)),
          const SizedBox(height: AppTheme.s12),
        ],
        NeuButton(
          primary: true,
          expand: true,
          onPressed: (state.issuing || state.settlementProblem != null)
              ? null
              : () async {
                  final navigator = Navigator.of(context);
                  final lodgeName = ref.read(authViewModelProvider).me?.lodge.name;

                  final invoice = await vm.issueEvent();
                  if (invoice == null) return;

                  if (!context.mounted) return;
                  final wantsReceipt = await showDialog<bool>(
                    context: context,
                    barrierDismissible: false,
                    builder: (context) => Dialog(
                      backgroundColor: AppTheme.bg,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rLarge)),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(AppTheme.s24, AppTheme.s24, AppTheme.s24, AppTheme.s16),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              width: 56,
                              height: 56,
                              decoration: BoxDecoration(color: AppTheme.vacant.withValues(alpha: 0.12), shape: BoxShape.circle),
                              child: const Icon(Icons.check_circle_rounded, color: AppTheme.vacant, size: 32),
                            ),
                            const SizedBox(height: AppTheme.s16),
                            Text(
                              '${kDocumentLabels[invoice.documentType] ?? 'Bill'} ${invoice.invoiceNumber ?? ''} issued',
                              textAlign: TextAlign.center,
                              style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
                            ),
                            const SizedBox(height: AppTheme.s8),
                            Text(
                              'The bill is cut. Open the receipt now, or head back to the function.',
                              textAlign: TextAlign.center,
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                            const SizedBox(height: AppTheme.s24),
                            NeuButton(
                              primary: true,
                              expand: true,
                              onPressed: () => Navigator.pop(context, true),
                              child: const Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(Icons.receipt_long_rounded, size: 18, color: Colors.white),
                                  SizedBox(width: 8),
                                  Text('Receipt'),
                                ],
                              ),
                            ),
                            const SizedBox(height: AppTheme.s8),
                            NeuButton(
                              expand: true,
                              onPressed: () => Navigator.pop(context, false),
                              child: const Text('Done'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );

                  vm.closeEvent();
                  navigator.pop(invoice);

                  if (wantsReceipt == true) {
                    navigator.push(
                      MaterialPageRoute(builder: (_) => BillReceiptScreen(invoice: invoice, lodgeName: lodgeName)),
                    );
                  }
                },
          child: state.issuing
              ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Issue bill'),
        ),
      ],
    );
  }
}

class _Row extends StatelessWidget {
  final String label;
  final num value;
  final bool strong;
  final bool muted;

  const _Row({required this.label, required this.value, this.strong = false, this.muted = false});

  @override
  Widget build(BuildContext context) {
    final colour = strong ? AppTheme.heading : muted ? AppTheme.muted : AppTheme.text;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.s8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(color: colour, fontSize: strong ? 15 : 13, fontWeight: strong ? FontWeight.w500 : FontWeight.w400),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          Text(
            formatPrice(value),
            style: TextStyle(color: colour, fontSize: strong ? 16 : 13, fontWeight: strong ? FontWeight.w500 : FontWeight.w400),
          ),
        ],
      ),
    );
  }
}

class _PaymentRows extends ConsumerWidget {
  final BillingState state;

  const _PaymentRows({required this.state});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(billingViewModelProvider.notifier);
    final problem = state.settlementProblem;

    return NeuCard(
      child: Column(
        children: [
          for (var i = 0; i < state.payment.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s12),
              child: PaymentRow(
                key: ValueKey(i),
                line: state.payment[i],
                onRemove: state.payment.length == 1 ? null : () => vm.removePaymentRow(i),
                onChanged: vm.touch,
              ),
            ),
          if (state.payment.length < 5)
            NeuButton(
              expand: true,
              onPressed: vm.addPaymentRow,
              padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
              child: const Text('+ Add another payment'),
            ),
          const Divider(height: AppTheme.s24),
          Row(
            children: [
              Expanded(child: Text('Recorded', style: Theme.of(context).textTheme.bodySmall)),
              Text(
                formatPrice(state.collected),
                style: TextStyle(
                  color: state.settles ? AppTheme.vacant : AppTheme.danger,
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
          if (problem != null) ...[
            const SizedBox(height: AppTheme.s8),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(problem, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.danger)),
            ),
          ],
        ],
      ),
    );
  }
}
