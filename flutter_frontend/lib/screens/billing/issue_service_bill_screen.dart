import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/invoice.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/billing_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/payment_row.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';
import 'bill_receipt_screen.dart';
import 'bill_ui.dart';

/// The service side of billing: one or more completed laundry/pool/gaming
/// uses, selected on the Services tab, billed on their own document. Same
/// shape as [IssueFoodBillScreen] — what it says, then how the money came
/// in — but no table, no advance: a service bill is just the selected uses.
class IssueServiceBillScreen extends ConsumerWidget {
  const IssueServiceBillScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(billingViewModelProvider);
    final vm = ref.read(billingViewModelProvider.notifier);
    final preview = state.servicePreview;

    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: billAppBar(
        title: 'Bill services',
        subtitle: preview?.customerName,
        onBack: () {
          vm.closeServiceBill();
          Navigator.of(context).pop();
        },
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
                              onPressed: vm.refreshServicePreview,
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
  final ServiceBillPreview preview;

  const _Body({required this.state, required this.preview});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(billingViewModelProvider.notifier);
    final amounts = preview.amounts;
    final usages = state.serviceTarget ?? const [];

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppTheme.s12,
        AppTheme.s8,
        AppTheme.s12,
        AppTheme.s24,
      ),
      children: [
        // ── The document ────────────────────────────────────────────────────
        BillCard(
          children: [
            BillHero(
              label: kDocumentLabels[amounts?.documentType] ?? 'Service bill',
              chip: preview.isGstRegistered ? 'GST' : 'Non-GST',
              title: preview.customerName ?? (preview.tableLabel ?? 'Services'),
              subtitle: preview.customerName != null
                  ? [
                      if (preview.customerPhone != null) preview.customerPhone!,
                      '${usages.length} ${usages.length == 1 ? 'service' : 'services'}',
                    ].join('  ·  ')
                  : '${usages.length} ${usages.length == 1 ? 'service' : 'services'}',
              total: amounts?.totalAmount ?? 0,
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppTheme.s12,
                AppTheme.s12,
                AppTheme.s12,
                AppTheme.s12,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // The selected uses, itemised — read back against what was
                  // ticked on the Services tab before committing to a document
                  // that can only be voided, not edited.
                  const BillSectionLabel('Services'),
                  for (final u in usages)
                    BillItemRow(
                      name: u.serviceName,
                      detail: '${u.quantity} × ${formatPrice(u.unitPrice)}',
                      value: u.lineTotal,
                    ),
                  billHairline,
                  if ((amounts?.serviceSubtotal ?? 0) > 0)
                    BillRowLine(label: 'Services', value: amounts!.serviceSubtotal),
                  if ((amounts?.discountAmount ?? 0) > 0)
                    BillRowLine(
                      label: 'Discount (${amounts!.discountPercent}%)',
                      value: -amounts.discountAmount,
                    ),
                  if ((amounts?.serviceCgstAmount ?? 0) > 0 ||
                      (amounts?.serviceSgstAmount ?? 0) > 0) ...[
                    const BillSectionLabel('Tax included in total'),
                    BillRowLine(
                      label: 'CGST (${amounts?.serviceCgstRatePercent ?? 0}%)',
                      value: amounts?.serviceCgstAmount ?? 0,
                      muted: true,
                    ),
                    BillRowLine(
                      label: 'SGST (${amounts?.serviceSgstRatePercent ?? 0}%)',
                      value: amounts?.serviceSgstAmount ?? 0,
                      muted: true,
                    ),
                  ],
                  if ((amounts?.roundOff ?? 0) != 0)
                    BillRowLine(label: 'Round off', value: amounts!.roundOff, muted: true),
                  billHairline,
                  BillRowLine(
                    label: 'Grand total',
                    value: amounts?.totalAmount ?? 0,
                    strong: true,
                  ),
                  const SizedBox(height: 4),
                  BillBalanceBox(balance: preview.balanceDue),
                  const SizedBox(height: 8),
                  Text(
                    preview.isGstRegistered
                        ? 'Issued under GSTIN ${preview.gstin ?? '—'}.'
                        : "This property isn't GST registered — every bill is a "
                              'cash receipt.',
                    style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                  ),
                ],
              ),
            ),
          ],
        ),

        // ── How it was paid ─────────────────────────────────────────────────
        const SizedBox(height: AppTheme.s16),
        BillPaymentHeader(nothingDue: state.nothingDue, balanceDue: state.balanceDue),
        if (!state.nothingDue) ...[
          const SizedBox(height: AppTheme.s8),
          BillPanel(child: _PaymentRows(state: state)),
        ],

        const SizedBox(height: AppTheme.s16),
        if (state.error != null) ...[
          Text(
            state.error!,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppTheme.danger),
          ),
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

                  final invoice = await vm.issueServiceBill();
                  if (invoice == null) return;

                  if (!context.mounted) return;
                  final wantsReceipt = await showDialog<bool>(
                    context: context,
                    barrierDismissible: false,
                    builder: (context) => Dialog(
                      backgroundColor: AppTheme.bg,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppTheme.rLarge),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(
                          AppTheme.s24,
                          AppTheme.s24,
                          AppTheme.s24,
                          AppTheme.s16,
                        ),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              width: 56,
                              height: 56,
                              decoration: BoxDecoration(
                                color: AppTheme.vacant.withValues(alpha: 0.12),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(
                                Icons.check_circle_rounded,
                                color: AppTheme.vacant,
                                size: 32,
                              ),
                            ),
                            const SizedBox(height: AppTheme.s16),
                            Text(
                              '${kDocumentLabels[invoice.documentType] ?? 'Bill'} '
                              '${invoice.invoiceNumber ?? ''} issued',
                              textAlign: TextAlign.center,
                              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: AppTheme.s8),
                            Text(
                              'The bill is cut. Open the receipt now, or '
                              'head back to the billing list.',
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
                                  Icon(
                                    Icons.receipt_long_rounded,
                                    size: 18,
                                    color: Colors.white,
                                  ),
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

                  vm.closeServiceBill();
                  navigator.pop();

                  if (wantsReceipt == true) {
                    navigator.push(
                      MaterialPageRoute(
                        builder: (_) => BillReceiptScreen(
                          invoice: invoice,
                          lodgeName: lodgeName,
                        ),
                      ),
                    );
                  }
                },
          child: state.issuing
              ? const SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : const Text('Issue bill'),
        ),
      ],
    );
  }
}

// ── How the balance arrived ─────────────────────────────────────────────────

class _PaymentRows extends ConsumerWidget {
  final BillingState state;

  const _PaymentRows({required this.state});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(billingViewModelProvider.notifier);
    final problem = state.settlementProblem;

    return Column(
      children: [
        for (var i = 0; i < state.payment.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s12),
            child: PaymentRow(
              key: ValueKey(i),
              compact: true,
              line: state.payment[i],
              onRemove: state.payment.length == 1
                  ? null
                  : () => vm.removePaymentRow(i),
              onChanged: vm.touch,
            ),
          ),
        if (state.payment.length < 5)
          Align(
            alignment: Alignment.centerLeft,
            child: NeuButton(
              soft: true,
              minHeight: 36,
              onPressed: vm.addPaymentRow,
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.s16,
                vertical: AppTheme.s8,
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.add_rounded, size: 15, color: AppTheme.sidebarBrandInk),
                  SizedBox(width: 4),
                  Text('Add another payment'),
                ],
              ),
            ),
          ),
        const SectionDivider(),
        Row(
          children: [
            Expanded(
              child: Text(
                'Recorded',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
            Text(
              formatPrice(state.collected),
              style: TextStyle(
                color: state.settles ? AppTheme.vacant : AppTheme.danger,
                fontSize: 15,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        if (problem != null) ...[
          const SizedBox(height: AppTheme.s8),
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              problem,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.danger),
            ),
          ),
        ],
      ],
    );
  }
}

