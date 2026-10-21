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
import 'bill_ui.dart';

/// Settle & bill a function — styled like [IssueBillScreen], but for a venue
/// hire rather than a stay: no nights, no late checkout, no cycle discount, and
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
      backgroundColor: AppTheme.bg,
      appBar: billAppBar(
        title: 'Issue bill',
        subtitle: state.eventTarget?.title,
        onBack: () {
          vm.closeEvent();
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
    final amounts = preview.amounts;

    if (preview.alreadyInvoiced) {
      return const NeuNotice(
        icon: Icons.check_circle_outline_rounded,
        message: 'This function has already been billed.',
      );
    }

    final lines = preview.roomCharges;

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
              label: kDocumentLabels[amounts?.documentType] ?? 'Bill of supply',
              chip: preview.isGstRegistered ? 'GST' : 'Non-GST',
              title: preview.guestName,
              subtitle: [
                preview.eventTitle ?? 'Function',
                if (preview.venueName != null) preview.venueName!,
                '${preview.billablePax} plates',
              ].join('  ·  '),
              total: amounts?.totalAmount ?? 0,
            ),
            Padding(
              padding: const EdgeInsets.all(AppTheme.s12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const BillSectionLabel('Charges'),
                  for (final line in lines)
                    BillRowLine(label: line.label, value: line.amount),
                  if ((amounts?.roomSubtotal ?? 0) > 0 && lines.length != 1)
                    BillRowLine(
                      label: 'Venue charges',
                      value: amounts!.roomSubtotal,
                      strong: lines.length > 1,
                    ),
                  if ((amounts?.foodSubtotal ?? 0) > 0)
                    BillRowLine(label: 'Catering', value: amounts!.foodSubtotal),
                  if ((amounts?.discountAmount ?? 0) > 0)
                    BillRowLine(
                      label: 'Discount'
                          '${state.discountReason.trim().isNotEmpty ? ' – ${state.discountReason.trim()}' : ''}',
                      value: -amounts!.discountAmount,
                    ),

                  if (preview.extrasOnDay.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    _ExtrasNotice(preview: preview),
                  ],

                  billHairline,

                  if ((amounts?.cgstAmount ?? 0) > 0 ||
                      (amounts?.foodCgstAmount ?? 0) > 0)
                    const BillSectionLabel('Tax included in total'),
                  if ((amounts?.cgstAmount ?? 0) > 0 || (amounts?.sgstAmount ?? 0) > 0) ...[
                    BillRowLine(
                      label: 'CGST (${amounts?.cgstRatePercent ?? 0}%)',
                      value: amounts?.cgstAmount ?? 0,
                      muted: true,
                    ),
                    BillRowLine(
                      label: 'SGST (${amounts?.sgstRatePercent ?? 0}%)',
                      value: amounts?.sgstAmount ?? 0,
                      muted: true,
                    ),
                  ],
                  if ((amounts?.foodCgstAmount ?? 0) > 0 || (amounts?.foodSgstAmount ?? 0) > 0) ...[
                    BillRowLine(
                      label: 'CGST (${amounts?.foodCgstRatePercent ?? 0}%) on food',
                      value: amounts?.foodCgstAmount ?? 0,
                      muted: true,
                    ),
                    BillRowLine(
                      label: 'SGST (${amounts?.foodSgstRatePercent ?? 0}%) on food',
                      value: amounts?.foodSgstAmount ?? 0,
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
                  if (preview.advancePaid > 0)
                    BillRowLine(
                      label: preview.advanceReceiptNumbers == null
                          ? 'Less advance'
                          : 'Less advance (Rec. ${preview.advanceReceiptNumbers})',
                      value: -preview.advancePaid,
                    ),
                  const SizedBox(height: AppTheme.s8),
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

        // ── The discount ────────────────────────────────────────────────────
        const SizedBox(height: AppTheme.s12),
        _EventDiscountSection(state: state),

        // ── How it was paid ─────────────────────────────────────────────────
        const SizedBox(height: AppTheme.s16),
        BillPaymentHeader(nothingDue: state.nothingDue, balanceDue: state.balanceDue),
        if (!state.nothingDue) ...[
          const SizedBox(height: AppTheme.s8),
          _PaymentRows(state: state),
        ],

        const SizedBox(height: AppTheme.s16),
        if (state.error != null) ...[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
            decoration: BoxDecoration(
              color: AppTheme.danger.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(AppTheme.rSmall),
              border: Border.all(color: AppTheme.danger.withValues(alpha: 0.25)),
            ),
            child: Row(
              children: [
                const Icon(Icons.error_outline_rounded, color: AppTheme.danger, size: 16),
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: Text(
                    state.error!,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.danger),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppTheme.s12),
        ],
        _IssueBar(state: state, preview: preview),
      ],
    );
  }
}

/// What was added on the day, kept inside the bill card. Unpriced extras are
/// called out because they block the bill until every one has a price.
class _ExtrasNotice extends StatelessWidget {
  final EventBillPreview preview;

  const _ExtrasNotice({required this.preview});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 2, bottom: 2),
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8 + 2, vertical: AppTheme.s8),
      decoration: BoxDecoration(
        color: AppTheme.accent.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Added on the day: ${preview.extrasOnDay.map((x) => '${x.label}${x.quantity > 1 ? ' × ${x.quantity}' : ''}'
                ' (${x.needsPricing ? 'price to set' : formatPrice(x.amount)})').join(' · ')}'
            ' — included above.',
            style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
          ),
          if (preview.hasUnpricedExtras) ...[
            const SizedBox(height: 4),
            const Text(
              'Price every extra before this bill can be issued.',
              style: TextStyle(color: AppTheme.danger, fontSize: 11.5, fontWeight: FontWeight.w600),
            ),
          ],
        ],
      ),
    );
  }
}

/// A discount on a function's bill, in rupees, with the reason that prints
/// beside it — mirrors the web's own Discount section for `stream="event"`,
/// shown unconditionally rather than gated behind a cycle stay the way a
/// room bill's own [IssueBillScreen] discount is.
class _EventDiscountSection extends ConsumerStatefulWidget {
  final BillingState state;

  const _EventDiscountSection({required this.state});

  @override
  ConsumerState<_EventDiscountSection> createState() => _EventDiscountSectionState();
}

class _EventDiscountSectionState extends ConsumerState<_EventDiscountSection> {
  late final _amount = TextEditingController(text: widget.state.discountInput);
  late final _reason = TextEditingController(text: widget.state.discountReason);

  @override
  void didUpdateWidget(covariant _EventDiscountSection old) {
    super.didUpdateWidget(old);
    if (_amount.text != widget.state.discountInput) {
      _amount.text = widget.state.discountInput;
    }
    if (_reason.text != widget.state.discountReason) {
      _reason.text = widget.state.discountReason;
    }
  }

  @override
  void dispose() {
    _amount.dispose();
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final vm = ref.read(billingViewModelProvider.notifier);
    final discount = widget.state.cycleDiscount;
    final discountAmount = widget.state.eventPreview?.amounts?.discountAmount ?? 0;

    return BillPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 28,
                height: 28,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppTheme.edit.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.local_offer_rounded, size: 15, color: AppTheme.edit),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Discount',
                      style: TextStyle(
                        color: AppTheme.heading,
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      discount > 0
                          ? '${formatPrice(discountAmount)} off · printed on the bill'
                          : 'None on this bill',
                      style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                flex: 2,
                child: NeuField(
                  controller: _amount,
                  label: 'Amount',
                  hint: '0',
                  keyboardType: TextInputType.number,
                  dense: true,
                  onChanged: vm.setDiscount,
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                flex: 3,
                child: NeuField(
                  controller: _reason,
                  label: 'Reason (on bill)',
                  hint: 'e.g. Regular guest',
                  maxLength: 100,
                  dense: true,
                  onChanged: vm.setDiscountReason,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// One row per way the money came in. The balance above does not move; these
/// only say how it was settled, and the bill cannot be issued until they add
/// up to it.
class _PaymentRows extends ConsumerWidget {
  final BillingState state;

  const _PaymentRows({required this.state});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(billingViewModelProvider.notifier);
    final problem = state.settlementProblem;

    return BillPanel(
      child: Column(
        children: [
          for (var i = 0; i < state.payment.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: PaymentRow(
                key: ValueKey(i),
                compact: true,
                line: state.payment[i],
                onRemove: state.payment.length == 1 ? null : () => vm.removePaymentRow(i),
                onChanged: vm.touch,
              ),
            ),
          if (state.payment.length < 5)
            Align(
              alignment: Alignment.centerLeft,
              child: InkWell(
                borderRadius: BorderRadius.circular(AppTheme.rSmall),
                onTap: vm.addPaymentRow,
                child: const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 4, vertical: 6),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.add_circle_outline_rounded, size: 16, color: AppTheme.accent),
                      SizedBox(width: 6),
                      Text(
                        'Split payment',
                        style: TextStyle(
                          color: AppTheme.accent,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          billHairline,
          Row(
            children: [
              const Text('Recorded', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
              const Spacer(),
              Icon(
                state.settles ? Icons.check_circle_rounded : Icons.error_outline_rounded,
                size: 14,
                color: state.settles ? AppTheme.vacant : AppTheme.danger,
              ),
              const SizedBox(width: 4),
              Text(
                formatPrice(state.collected),
                style: TextStyle(
                  color: state.settles ? AppTheme.vacant : AppTheme.danger,
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          if (problem != null) ...[
            const SizedBox(height: 4),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                problem,
                style: const TextStyle(color: AppTheme.danger, fontSize: 11.5),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The action card at the end of the page: what is due, and the one button that
/// cuts the bill.
class _IssueBar extends ConsumerWidget {
  final BillingState state;
  final EventBillPreview preview;

  const _IssueBar({required this.state, required this.preview});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(billingViewModelProvider.notifier);
    return Container(
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, 12, AppTheme.s16, 12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        children: [
          Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'BALANCE DUE',
                style: TextStyle(
                  color: AppTheme.muted,
                  fontSize: 9.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.6,
                ),
              ),
              Text(
                formatPrice(preview.balanceDue),
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.3,
                ),
              ),
            ],
          ),
          const SizedBox(width: AppTheme.s16),
          Expanded(
            child: NeuButton(
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
                          MaterialPageRoute(
                            builder: (_) => BillReceiptScreen(invoice: invoice, lodgeName: lodgeName),
                          ),
                        );
                      }
                    },
              child: state.issuing
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.receipt_long_rounded, size: 18, color: Colors.white),
                        SizedBox(width: 8),
                        Text('Issue bill'),
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
