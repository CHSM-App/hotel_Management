import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/draft.dart';
import '../../domain/models/invoice.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/billing_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'bill_receipt_screen.dart';

/// The food side of billing: a table, a room, or a takeaway with delivered
/// food nobody has paid for. Same shape as [IssueBillScreen] — what it says,
/// then how the money came in — but no room, no nights, no overstay: a food
/// bill is the food side on its own.
class IssueFoodBillScreen extends ConsumerWidget {
  const IssueFoodBillScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(billingViewModelProvider);
    final vm = ref.read(billingViewModelProvider.notifier);
    final preview = state.foodPreview;

    return Scaffold(
      appBar: AppBar(
        title: Text(state.foodTarget?.tableLabel ?? 'Bill'),
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          onPressed: () {
            vm.closeFood();
            Navigator.of(context).pop();
          },
        ),
      ),
      body: SafeArea(
        child: preview == null
            ? Center(
                child: state.previewing
                    ? const CircularProgressIndicator()
                    : NeuNotice(
                        icon: Icons.cloud_off_rounded,
                        message: state.error ?? 'Could not load this bill.',
                        action: NeuButton(
                          onPressed: vm.refreshFoodPreview,
                          child: const Text('Try again'),
                        ),
                      ),
              )
            : _Body(state: state, preview: preview),
      ),
    );
  }
}

class _Body extends ConsumerWidget {
  final BillingState state;
  final FoodBillPreview preview;

  const _Body({required this.state, required this.preview});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(billingViewModelProvider.notifier);
    final amounts = preview.amounts;

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppTheme.s16,
        AppTheme.s8,
        AppTheme.s16,
        AppTheme.s32,
      ),
      children: [
        // ── The document ────────────────────────────────────────────────────
        NeuCard(
          radius: AppTheme.rLarge,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                (preview.tableLabel ?? '—').toUpperCase(),
                style: const TextStyle(
                  color: AppTheme.muted,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4,
                ),
              ),
              const SizedBox(height: AppTheme.s12),

              // Who a takeaway is for — a table or a room tab has nobody
              // behind it, the same split the web bill modal makes.
              if (preview.customerName != null) ...[
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Customer',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                    Text(
                      preview.customerPhone != null
                          ? '${preview.customerName} · ${preview.customerPhone}'
                          : preview.customerName!,
                      style: const TextStyle(color: AppTheme.text, fontSize: 13),
                    ),
                  ],
                ),
                const SizedBox(height: AppTheme.s12),
              ],

              // What's being swept onto this bill, itemised — read back
              // against what actually went out before committing to a
              // document that can only be voided, not edited.
              for (final item in preview.foodItems)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppTheme.s8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              item.name,
                              style: const TextStyle(
                                color: AppTheme.heading,
                                fontSize: 13,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            Text(
                              '${item.quantity} × ${formatPrice(item.unitPrice)}',
                              style: const TextStyle(
                                color: AppTheme.muted,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: AppTheme.s8),
                      Text(
                        formatPrice(item.lineTotal),
                        style: const TextStyle(color: AppTheme.text, fontSize: 13),
                      ),
                    ],
                  ),
                ),
              if (preview.orderNumbers.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppTheme.s8),
                  child: Text(
                    'From order${preview.orderNumbers.length == 1 ? '' : 's'} '
                    '${preview.orderNumbers.map((n) => '#$n').join(', ')}',
                    style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                  ),
                ),

              const Divider(height: AppTheme.s24),

              Text(
                'BILL',
                style: const TextStyle(
                  color: AppTheme.muted,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4,
                ),
              ),
              const SizedBox(height: AppTheme.s8),
              Text(
                preview.isGstRegistered
                    ? 'Issued under GSTIN ${preview.gstin ?? '—'}.'
                    : "This property isn't GST registered — every bill is a "
                          'cash receipt.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: AppTheme.s12),

              // Food is its own taxed block — the same split GSTR-1 reports
              // on — so it prints on its own rather than folded into a
              // generic subtotal, exactly as the web bill does.
              if ((amounts?.foodSubtotal ?? 0) > 0)
                _Row(label: 'Food', value: amounts!.foodSubtotal),

              if ((amounts?.discountAmount ?? 0) > 0)
                _Row(
                  label: 'Discount (${amounts!.discountPercent}%)',
                  value: -amounts.discountAmount,
                ),

              // A food bill's own tax rides on the food-specific fields, not
              // the room ones — those are always zero here (see
              // priceFoodBill/buildBreakdown on the server, which passes
              // roomSubtotal/cgstAmount/sgstAmount as 0 for a table tab).
              if ((amounts?.foodCgstAmount ?? 0) > 0 ||
                  (amounts?.foodSgstAmount ?? 0) > 0) ...[
                _Row(
                  label: 'CGST (${amounts?.foodCgstRatePercent ?? 0}%) on food',
                  value: amounts?.foodCgstAmount ?? 0,
                  muted: true,
                ),
                _Row(
                  label: 'SGST (${amounts?.foodSgstRatePercent ?? 0}%) on food',
                  value: amounts?.foodSgstAmount ?? 0,
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
              _Row(
                label: 'Balance due',
                value: preview.balanceDue,
                strong: true,
              ),
            ],
          ),
        ),

        // ── How it was paid ─────────────────────────────────────────────────
        const SizedBox(height: AppTheme.s24),
        Text(
          'Record how the guest paid',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: AppTheme.s4),
        Text(
          state.nothingDue
              ? 'Nothing is left to collect — issue it as it stands.'
              : '${formatPrice(state.balanceDue)} is due. Choose the payment '
                    'type for each amount taken.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: AppTheme.s12),
        if (!state.nothingDue) _PaymentRows(state: state),

        const SizedBox(height: AppTheme.s24),
        if (state.error != null) ...[
          Text(
            state.error!,
            style: const TextStyle(color: AppTheme.danger, fontSize: 13),
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

                  final invoice = await vm.issueFood();
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
                              style: const TextStyle(
                                color: AppTheme.heading,
                                fontSize: 17,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: AppTheme.s8),
                            const Text(
                              'The bill is cut. Open the receipt now, or '
                              'head back to the billing list.',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: AppTheme.muted,
                                fontSize: 13,
                              ),
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

                  vm.closeFood();
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

    return NeuCard(
      child: Column(
        children: [
          for (var i = 0; i < state.payment.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s12),
              child: _PaymentRow(
                key: ValueKey(i),
                line: state.payment[i],
                onRemove: state.payment.length == 1
                    ? null
                    : () => vm.removePaymentRow(i),
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
                  fontWeight: FontWeight.w500,
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
                style: const TextStyle(color: AppTheme.danger, fontSize: 12),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _PaymentRow extends StatefulWidget {
  final PaymentDraft line;
  final VoidCallback? onRemove;
  final VoidCallback onChanged;

  const _PaymentRow({
    super.key,
    required this.line,
    required this.onRemove,
    required this.onChanged,
  });

  @override
  State<_PaymentRow> createState() => _PaymentRowState();
}

class _PaymentRowState extends State<_PaymentRow> {
  late final _amount = TextEditingController(text: widget.line.amount);
  late final _reference = TextEditingController(text: widget.line.reference);

  @override
  void didUpdateWidget(covariant _PaymentRow old) {
    super.didUpdateWidget(old);
    if (_amount.text != widget.line.amount) {
      _amount.text = widget.line.amount;
    }
  }

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: NeuPressed(
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: widget.line.method,
                    isExpanded: true,
                    dropdownColor: AppTheme.bg,
                    hint: const Text(
                      'Choose one',
                      style: TextStyle(color: AppTheme.muted, fontSize: 14),
                    ),
                    items: [
                      for (final e in kPaymentMethods.entries)
                        DropdownMenuItem(value: e.key, child: Text(e.value)),
                    ],
                    onChanged: (m) {
                      setState(() => widget.line.method = m);
                      widget.onChanged();
                    },
                  ),
                ),
              ),
            ),
            const SizedBox(width: AppTheme.s8),
            SizedBox(
              width: 96,
              child: NeuPressed(
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                child: TextField(
                  controller: _amount,
                  keyboardType: TextInputType.number,
                  textAlign: TextAlign.right,
                  onTap: () => _amount.selection = TextSelection(
                    baseOffset: 0,
                    extentOffset: _amount.text.length,
                  ),
                  onChanged: (v) {
                    widget.line.amount = v;
                    widget.onChanged();
                  },
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontSize: 13,
                  ),
                  decoration: const InputDecoration(
                    hintText: '0',
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(vertical: 10),
                  ),
                ),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 20),
              color: widget.onRemove == null
                  ? AppTheme.muted.withValues(alpha: 0.4)
                  : AppTheme.danger,
              onPressed: widget.onRemove,
            ),
          ],
        ),
        if (needsPaymentReference(widget.line.method)) ...[
          const SizedBox(height: AppTheme.s8),
          NeuField(
            controller: _reference,
            label: 'Transaction number',
            hint: widget.line.method == 'UPI'
                ? 'UPI reference / UTR'
                : 'Approval code',
            maxLength: 64,
            onChanged: (v) {
              widget.line.reference = v;
              widget.onChanged();
            },
          ),
        ],
      ],
    );
  }
}
