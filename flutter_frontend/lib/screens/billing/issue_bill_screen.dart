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

/// The bill itself: what it says, and what the guest handed over.
///
/// Every figure is the server's. The desk cannot edit a total here — a bill is
/// what the stay cost, worked out night by night with the tax taken from inside
/// each amount, and the one thing the desk decides is how the money arrived.
class IssueBillScreen extends ConsumerWidget {
  const IssueBillScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(billingViewModelProvider);
    final vm = ref.read(billingViewModelProvider.notifier);
    final preview = state.preview;

    return Scaffold(
      appBar: AppBar(
        title: Text(state.target?.guestName ?? 'Bill'),
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          onPressed: () {
            vm.close();
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
                          onPressed: vm.refreshPreview,
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
  final BillPreview preview;

  const _Body({required this.state, required this.preview});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(billingViewModelProvider.notifier);
    final amounts = preview.amounts;

    // A bill already exists for this stay. Issuing again would burn a second
    // serial on one stay, so there is nothing to do here but leave.
    if (preview.alreadyInvoiced) {
      return const NeuNotice(
        icon: Icons.check_circle_outline_rounded,
        message: 'This stay has already been billed.',
      );
    }

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
              Row(
                children: [
                  Expanded(
                    child: Text(
                      kDocumentLabels[amounts?.documentType] ?? 'Bill',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  // Which document is issued is the property's business, not
                  // the desk's: a registered lodge issues on the GST side, and
                  // an unregistered one has nothing else to issue.
                  Text(
                    preview.isGstRegistered ? 'GST' : 'Non-GST',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
              const SizedBox(height: 2),
              Text(
                'Room ${preview.roomNumber ?? '—'} · '
                '${nightsLabel(preview.nights)}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const Divider(height: AppTheme.s24),

              for (final line in preview.roomCharges)
                _Row(label: line.label, value: line.amount),

              if (preview.lateCheckoutCharge > 0)
                _Row(
                  label: 'Late checkout'
                      '${preview.lateCheckoutMinutes > 0 ? ' (${preview.lateCheckoutMinutes} min)' : ''}',
                  value: preview.lateCheckoutCharge,
                ),

              if ((amounts?.foodSubtotal ?? 0) > 0)
                _Row(label: 'Food', value: amounts!.foodSubtotal),

              if ((amounts?.discountAmount ?? 0) > 0)
                _Row(
                  label: 'Discount (${amounts!.discountPercent}%)',
                  value: -amounts.discountAmount,
                ),

              const Divider(height: AppTheme.s24),

              // The tax is inside the total, not added to it. Shown so the
              // guest can see what was charged, and so the figures reconcile
              // with what is filed.
              if (preview.isGstRegistered) ...[
                _Row(
                  label: 'CGST ${amounts?.cgstRatePercent ?? 0} %',
                  value: amounts?.cgstAmount ?? 0,
                  muted: true,
                ),
                _Row(
                  label: 'SGST ${amounts?.sgstRatePercent ?? 0} %',
                  value: amounts?.sgstAmount ?? 0,
                  muted: true,
                ),
              ],
              if ((amounts?.roundOff ?? 0) != 0)
                _Row(
                  label: 'Round off',
                  value: amounts!.roundOff,
                  muted: true,
                ),

              _Row(
                label: 'Grand total',
                value: amounts?.totalAmount ?? 0,
                strong: true,
              ),

              if (preview.advancePaid > 0)
                _Row(
                  label: preview.advanceReceiptNumbers == null
                      ? 'Less advance'
                      : 'Less advance (Rec. ${preview.advanceReceiptNumbers})',
                  value: -preview.advancePaid,
                ),

              const Divider(height: AppTheme.s16),
              _Row(
                label: 'Balance due',
                value: preview.balanceDue,
                strong: true,
              ),
            ],
          ),
        ),

        // ── The overstay charge ─────────────────────────────────────────────
        if (preview.lateCheckoutAgreed) ...[
          const SizedBox(height: AppTheme.s16),
          NeuCard(
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Bill the late checkout',
                        style: TextStyle(
                          color: AppTheme.heading,
                          fontSize: 14,
                        ),
                      ),
                      Text(
                        // Agreed at the desk already; this is the last chance
                        // to take it back off.
                        'Agreed with the guest at checkout.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                Switch(
                  value: state.includeLateCheckout,
                  activeThumbColor: AppTheme.accent,
                  onChanged: state.previewing ? null : vm.setLateCheckout,
                ),
              ],
            ),
          ),
        ],

        // ── The guest who left early ────────────────────────────────────────
        // Only ever set on a CYCLE stay: the bill still carries every night
        // that was sold, and this is where the desk decides whether to give
        // the unused ones back. It fills the discount below.
        if (preview.earlyCheckout != null) ...[
          const SizedBox(height: AppTheme.s16),
          _EarlyCheckoutNotice(state: state, earlyCheckout: preview.earlyCheckout!),
        ],

        // ── The discount ─────────────────────────────────────────────────────
        // Only a cycle property discounts here: on the other two modes the
        // bill is what the stay costs and any concession is settled through
        // what the guest hands over.
        if (state.isCycleStay) ...[
          const SizedBox(height: AppTheme.s16),
          _DiscountSection(state: state),
        ],

        // ── How it was paid ─────────────────────────────────────────────────
        const SizedBox(height: AppTheme.s24),
        Text(
          'Record how the guest paid',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: AppTheme.s4),
        Text(
          state.nothingDue
              ? 'The advance already covers this bill. Nothing is left to '
                    'collect — issue it as it stands.'
              : '${formatPrice(state.balanceDue)} is due. Choose the payment '
                    'type for each amount taken.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: AppTheme.s12),
        // No rows at all when nothing is due — the desk has nothing to
        // record, and a set of payment rows sitting empty under a line
        // saying there is nothing to collect is a form contradicting itself.
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
          // Shut until the money recorded equals what is owed, and while the
          // request is in flight. Issuing burns a serial and there is no undo,
          // only a void.
          onPressed: (state.issuing || state.settlementProblem != null)
              ? null
              : () async {
                  // Both taken before the await: after the pop this route's
                  // context is defunct, and reading a messenger or a navigator
                  // off it then is reading from a page that no longer exists.
                  final navigator = Navigator.of(context);
                  final lodgeName = ref.read(authViewModelProvider).me?.lodge.name;

                  final invoice = await vm.issue();
                  // A failure keeps the page open with the reason on it —
                  // there is nothing to go back to, the bill is not cut.
                  if (invoice == null) return;

                  // The bill exists; the desk chooses whether to look at the
                  // receipt now or just get back to the queue.
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

                  vm.close();
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
            ),
          ),
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

// ── The guest who left early ────────────────────────────────────────────────

/// The reason printed on the bill when the discount below comes from this
/// notice rather than being typed in directly — matching the web screen's own
/// so a bill reads the same regardless of which one wrote it.
const _kEarlyDiscountReason = 'Leaving early';

/// The unused-nights banner for a CYCLE guest who checked out before their
/// booked nights ran out. It shares the same discount fields the section
/// below writes to — typing here just fills those in with this reason.
class _EarlyCheckoutNotice extends ConsumerStatefulWidget {
  final BillingState state;
  final EarlyCheckout earlyCheckout;

  const _EarlyCheckoutNotice({required this.state, required this.earlyCheckout});

  @override
  ConsumerState<_EarlyCheckoutNotice> createState() => _EarlyCheckoutNoticeState();
}

class _EarlyCheckoutNoticeState extends ConsumerState<_EarlyCheckoutNotice> {
  late final _amount = TextEditingController(text: _reducing ? widget.state.discountInput : '');

  bool get _reducing => widget.state.discountReason == _kEarlyDiscountReason;

  @override
  void didUpdateWidget(covariant _EarlyCheckoutNotice old) {
    super.didUpdateWidget(old);
    final text = _reducing ? widget.state.discountInput : '';
    if (_amount.text != text) _amount.text = text;
  }

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final vm = ref.read(billingViewModelProvider.notifier);
    final early = widget.earlyCheckout;
    final reducing = _reducing;
    final discountAmount = widget.state.preview?.amounts?.discountAmount ?? 0;

    return Container(
      padding: const EdgeInsets.all(AppTheme.s16),
      decoration: BoxDecoration(
        color: AppTheme.checkout.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.checkout.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.error_outline_rounded, color: AppTheme.checkout, size: 20),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Guest left early',
                      style: TextStyle(
                        color: AppTheme.heading,
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      'Stayed ${early.actualNights} of ${early.plannedNights} '
                      '${early.plannedNights == 1 ? 'night' : 'nights'} booked · '
                      '${early.unusedNights} ${early.unusedNights == 1 ? 'night' : 'nights'} unused',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              Text(
                formatPrice(early.unusedAmount),
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Early-leaving discount',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const Text(
                      'Leave blank to charge in full',
                      style: TextStyle(color: AppTheme.muted, fontSize: 11),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppTheme.s12),
              SizedBox(
                width: 110,
                child: NeuPressed(
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                  child: TextField(
                    controller: _amount,
                    keyboardType: TextInputType.number,
                    textAlign: TextAlign.right,
                    onChanged: (v) {
                      vm.setDiscount(v);
                      vm.setDiscountReason(v.trim().isEmpty ? '' : _kEarlyDiscountReason);
                    },
                    style: const TextStyle(color: AppTheme.heading, fontSize: 14),
                    decoration: const InputDecoration(
                      prefixText: '₹ ',
                      hintText: '0',
                      border: InputBorder.none,
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(vertical: 10),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          Text(
            reducing && widget.state.cycleDiscount > 0
                ? '${formatPrice(discountAmount)} off · printed on the bill as '
                      '"Discount – $_kEarlyDiscountReason"'
                : 'Charging in full · all ${early.plannedNights} booked nights',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

// ── The discount ─────────────────────────────────────────────────────────

/// A discount the desk gives on a CYCLE stay, in rupees, with the reason that
/// prints beside it on the bill. The server caps the amount and solves the
/// document; this only carries what was typed.
class _DiscountSection extends ConsumerStatefulWidget {
  final BillingState state;

  const _DiscountSection({required this.state});

  @override
  ConsumerState<_DiscountSection> createState() => _DiscountSectionState();
}

class _DiscountSectionState extends ConsumerState<_DiscountSection> {
  late final _amount = TextEditingController(text: widget.state.discountInput);
  late final _reason = TextEditingController(text: widget.state.discountReason);

  // The early-checkout banner writes into these same two fields when the
  // desk fills the discount in from there instead — without this, typing up
  // there left this card showing whatever it started with, and a discount
  // that looked unset here was still the one that priced the bill.
  @override
  void didUpdateWidget(covariant _DiscountSection old) {
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
    final discountAmount = widget.state.preview?.amounts?.discountAmount ?? 0;

    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Discount',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: AppTheme.s12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: NeuField(
                  controller: _amount,
                  label: 'Amount',
                  hint: '0',
                  keyboardType: TextInputType.number,
                  onChanged: vm.setDiscount,
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: NeuField(
                  controller: _reason,
                  label: 'Reason (printed on bill)',
                  hint: 'e.g. Leaving early, regular guest',
                  maxLength: 100,
                  onChanged: vm.setDiscountReason,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          Text(
            discount > 0
                ? 'Shown on the bill as "Discount'
                      '${widget.state.discountReason.trim().isNotEmpty ? ' – ${widget.state.discountReason.trim()}' : ''}" '
                      'of ${formatPrice(discountAmount)}.'
                : 'No discount on this bill.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

// ── How the balance arrived ─────────────────────────────────────────────────

/// One row per way the money came in.
///
/// The balance due above does not move — it is what the stay cost. These rows
/// only say how it was settled, and the bill cannot be issued until they add up
/// to it.
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
          // Shown as the desk types, not only when Issue is pressed — the
          // button beside it is disabled, and a disabled button with no stated
          // reason is the one people press twice and then telephone about.
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

  // The single untouched row is kept tracking the balance due from the view
  // model (see BillingState.paymentTouched) — a discount typed after the row
  // was first seeded still has to land in it. Without this the box went on
  // showing whatever it opened with, even once the model's own figure moved.
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
                  // The box always holds a figure already and the desk is
                  // replacing it, never appending.
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
        // Only for money that left a trail — what the settlement statement is
        // matched against at month end.
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
