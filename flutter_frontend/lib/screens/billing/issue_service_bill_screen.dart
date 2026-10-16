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
      appBar: AppBar(
        titleSpacing: AppTheme.s4,
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          onPressed: () {
            vm.closeServiceBill();
            Navigator.of(context).pop();
          },
        ),
        title: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [AppTheme.accent, Color(0xFF10499A)],
                ),
                borderRadius: BorderRadius.circular(AppTheme.rSmall + 2),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x331457AD),
                    offset: Offset(0, 3),
                    blurRadius: 8,
                  ),
                ],
              ),
              child: const Icon(Icons.room_service_rounded, color: Colors.white, size: 18),
            ),
            const SizedBox(width: AppTheme.s12),
            const Expanded(
              child: Text('Bill services', overflow: TextOverflow.ellipsis, maxLines: 1),
            ),
          ],
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(3),
          child: Container(
            height: 3,
            decoration: const BoxDecoration(
              gradient: LinearGradient(colors: [AppTheme.accent, Color(0x001457AD)]),
            ),
          ),
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
        NeuCard(
          radius: AppTheme.rLarge,
          shadow: AppTheme.elevated,
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
                      gradient: const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [AppTheme.accent, Color(0xFF10499A)],
                      ),
                      borderRadius: BorderRadius.circular(AppTheme.rSmall + 2),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x331457AD),
                          offset: Offset(0, 3),
                          blurRadius: 8,
                        ),
                      ],
                    ),
                    child: const Icon(
                      Icons.room_service_rounded,
                      color: Colors.white,
                      size: 18,
                    ),
                  ),
                  const SizedBox(width: AppTheme.s12),
                  Expanded(
                    child: Text(
                      (preview.tableLabel ?? 'SERVICES').toUpperCase(),
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.4,
                        color: AppTheme.heading,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.s16),

              if (preview.customerName != null) ...[
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppTheme.s12,
                    vertical: AppTheme.s8,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.bg,
                    borderRadius: BorderRadius.circular(AppTheme.rSmall),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.person_outline_rounded, size: 16, color: AppTheme.muted),
                      const SizedBox(width: AppTheme.s8),
                      Expanded(
                        child: Text(
                          preview.customerPhone != null
                              ? '${preview.customerName} · ${preview.customerPhone}'
                              : preview.customerName!,
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppTheme.s12),
              ],

              // The selected uses, itemised — read back against what was
              // ticked on the Services tab before committing to a document
              // that can only be voided, not edited.
              for (final u in usages)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppTheme.s8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Container(
                        width: 28,
                        height: 28,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: AppTheme.accent.withValues(alpha: 0.08),
                          borderRadius: BorderRadius.circular(AppTheme.rSmall),
                        ),
                        child: const Icon(Icons.spa_outlined, color: AppTheme.accent, size: 14),
                      ),
                      const SizedBox(width: AppTheme.s8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              u.serviceName,
                              style: const TextStyle(
                                color: AppTheme.heading,
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                              overflow: TextOverflow.ellipsis,
                              maxLines: 1,
                            ),
                            Text(
                              '${u.quantity} × ${formatPrice(u.unitPrice)}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: AppTheme.s8),
                      Text(
                        formatPrice(u.lineTotal),
                        style: const TextStyle(
                          color: AppTheme.heading,
                          fontWeight: FontWeight.w700,
                          fontSize: 13.5,
                        ),
                      ),
                    ],
                  ),
                ),

              const SectionDivider(),

              Text(
                preview.isGstRegistered
                    ? 'Issued under GSTIN ${preview.gstin ?? '—'}.'
                    : "This property isn't GST registered — every bill is a "
                          'cash receipt.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: AppTheme.s12),

              if ((amounts?.serviceSubtotal ?? 0) > 0)
                _Row(label: 'Services', value: amounts!.serviceSubtotal),

              if ((amounts?.discountAmount ?? 0) > 0)
                _Row(
                  label: 'Discount (${amounts!.discountPercent}%)',
                  value: -amounts.discountAmount,
                ),

              if ((amounts?.serviceCgstAmount ?? 0) > 0 ||
                  (amounts?.serviceSgstAmount ?? 0) > 0) ...[
                _Row(
                  label: 'CGST (${amounts?.serviceCgstRatePercent ?? 0}%)',
                  value: amounts?.serviceCgstAmount ?? 0,
                  muted: true,
                ),
                _Row(
                  label: 'SGST (${amounts?.serviceSgstRatePercent ?? 0}%)',
                  value: amounts?.serviceSgstAmount ?? 0,
                  muted: true,
                ),
              ],
              if ((amounts?.roundOff ?? 0) != 0)
                _Row(
                  label: 'Round off',
                  value: amounts!.roundOff,
                  muted: true,
                ),

              const Divider(height: AppTheme.s16),
              _Row(
                label: kDocumentLabels[amounts?.documentType] ?? 'Total',
                value: amounts?.totalAmount ?? 0,
                strong: true,
              ),

              const SizedBox(height: AppTheme.s8),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppTheme.s16,
                  vertical: AppTheme.s12,
                ),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      AppTheme.accent.withValues(alpha: 0.14),
                      AppTheme.accent.withValues(alpha: 0.05),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(AppTheme.rMedium),
                  border: Border.all(color: AppTheme.accent.withValues(alpha: 0.18)),
                ),
                child: Row(
                  children: [
                    Text(
                      'Balance due',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const Spacer(),
                    Text(
                      formatPrice(preview.balanceDue),
                      style: const TextStyle(
                        color: AppTheme.accent,
                        fontWeight: FontWeight.w800,
                        fontSize: 19,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),

        // ── How it was paid ─────────────────────────────────────────────────
        const SizedBox(height: AppTheme.s16),
        NeuCard(
          radius: AppTheme.rLarge,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SectionLabel('Record how the guest paid', icon: Icons.payments_rounded),
              const SizedBox(height: AppTheme.s8),
              Text(
                state.nothingDue
                    ? 'Nothing is left to collect — issue it as it stands.'
                    : '${formatPrice(state.balanceDue)} is due. Choose the payment '
                          'type for each amount taken.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              if (!state.nothingDue) ...[
                const SizedBox(height: AppTheme.s12),
                _PaymentRows(state: state),
              ],
            ],
          ),
        ),

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

// ── One line of the document ────────────────────────────────────────────────

class _Row extends StatelessWidget {
  final String label;
  final num value;
  final bool strong;
  final bool muted;

  const _Row({
    required this.label,
    required this.value,
    this.strong = false,
    this.muted = false,
  });

  @override
  Widget build(BuildContext context) {
    final colour = strong
        ? AppTheme.heading
        : muted
        ? AppTheme.muted
        : AppTheme.text;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.s8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: colour,
                fontSize: strong ? 15 : 13,
                fontWeight: strong ? FontWeight.w500 : FontWeight.w400,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          Text(
            formatPrice(value),
            style: TextStyle(
              color: colour,
              fontSize: strong ? 16 : 13,
              fontWeight: strong ? FontWeight.w500 : FontWeight.w400,
            ),
          ),
        ],
      ),
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

