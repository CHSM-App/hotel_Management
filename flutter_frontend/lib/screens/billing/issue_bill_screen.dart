import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/invoice.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/billing_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/payment_row.dart';
import '../theme.dart';
import 'bill_receipt_screen.dart';

/// "4h 8m late" / "35 min late" / "on time" — mirrors the web screen's own
/// `lateLabel()` (Billing.jsx) so the two read the overstay the same way.
String lateCheckoutLabel(int minutes) {
  if (minutes <= 0) return 'on time';
  if (minutes < 60) return '$minutes min late';
  final hours = minutes ~/ 60;
  final mins = minutes % 60;
  return mins == 0 ? '${hours}h late' : '${hours}h ${mins}m late';
}

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
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        title: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text(
                      'Issue bill',
                      style: TextStyle(
                        color: AppTheme.heading,
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.2,
                      ),
                    ),
                    if (state.target?.guestName != null)
                      Text(
                        [
                          state.target!.guestName!,
                          if (preview?.roomNumber != null) 'Room ${preview!.roomNumber}',
                        ].join('  ·  '),
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppTheme.muted,
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                  ],
                ),
        leading: IconButton(
                  icon: const Icon(Icons.arrow_back_rounded, color: AppTheme.heading),
                  onPressed: () {
                    vm.close();
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
                              onPressed: vm.refreshPreview,
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
        AppTheme.s12,
        AppTheme.s8,
        AppTheme.s12,
        AppTheme.s24,
      ),
      children: [
        // ── The whole stay, for when a figure gets queried ──────────────────
        // Shut by default and loaded only when opened — most bills are issued
        // off the summary below, and this is for the one where the guest
        // queries a figure and the desk needs the whole stay without leaving
        // the bill it's halfway through writing. Mirrors the web screen's own
        // "View full stay details".
        if (preview.bookingId != null) ...[
          _StayDetailsExpander(bookingId: preview.bookingId!),
          const SizedBox(height: AppTheme.s12),
        ],

        // ── What's being swept onto this bill, itemised ─────────────────────
        // Staff read this back against what actually went to the room before
        // committing to a document they can only void — the same breakdown
        // the web screen shows above its own bill card.
        if (preview.foodItems.isNotEmpty) ...[
          _ItemisedSection(
            title: 'Food ordered during the stay',
            icon: Icons.restaurant_rounded,
            hint: preview.orderNumbers.isEmpty
                ? null
                : 'From order${preview.orderNumbers.length == 1 ? '' : 's'} '
                      '${preview.orderNumbers.map((n) => '#$n').join(', ')}',
            children: [
              for (final item in preview.foodItems)
                _ItemRow(
                  name: item.name,
                  detail: '${item.quantity} × ${formatPrice(item.unitPrice)}',
                  value: item.lineTotal,
                ),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
        ],
        if (preview.serviceItems.isNotEmpty) ...[
          _ItemisedSection(
            title: 'Other services',
            icon: Icons.design_services_rounded,
            children: [
              for (final item in preview.serviceItems)
                _ItemRow(
                  name: item.name,
                  detail: '${item.quantity} × ${formatPrice(item.unitPrice)}'
                      '${item.gstRatePercent > 0 ? ' · GST ${item.gstRatePercent}%' : ''}',
                  value: item.lineTotal,
                ),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
        ],

        // ── The document ────────────────────────────────────────────────────
        NeuCard(
          padding: EdgeInsets.zero,
          radius: AppTheme.rMedium,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
                _BillHero(preview: preview, amounts: amounts),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppTheme.s12,
                  0,
                  AppTheme.s12,
                  AppTheme.s12,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 2),
                    const _SectionLabel('Charges'),

                    if (roomBillSections(preview.roomCharges) case final sections?)
                      for (final section in sections)
                        _RoomSectionRows(section: section)
                    else
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

                    if ((amounts?.serviceSubtotal ?? 0) > 0)
                      _Row(label: 'Other services', value: amounts!.serviceSubtotal),

                    if ((amounts?.discountAmount ?? 0) > 0)
                      _Row(
                        label: 'Discount (${amounts!.discountPercent}%)',
                        value: -amounts.discountAmount,
                      ),

                    const Divider(height: 14, thickness: 0.8, color: AppTheme.border),

                    // The tax is inside the total, not added to it. Shown so
                    // the guest can see what was charged, and so the figures
                    // reconcile with what is filed.
                    //
                    // Room and food taxed separately — different SACs at
                    // different rates, which is the split GSTR-1 reports on —
                    // so each prints its own CGST/SGST pair rather than one
                    // merged figure, same as the web bill.
                    if ((amounts?.cgstAmount ?? 0) > 0 ||
                        (amounts?.foodCgstAmount ?? 0) > 0 ||
                        (amounts?.serviceCgstAmount ?? 0) > 0)
                      const _SectionLabel('Tax included in total'),
                    if ((amounts?.cgstAmount ?? 0) > 0 || (amounts?.sgstAmount ?? 0) > 0) ...[
                      _Row(
                        label: 'CGST (${amounts?.cgstRatePercent ?? 0}%)',
                        value: amounts?.cgstAmount ?? 0,
                        muted: true,
                      ),
                      _Row(
                        label: 'SGST (${amounts?.sgstRatePercent ?? 0}%)',
                        value: amounts?.sgstAmount ?? 0,
                        muted: true,
                      ),
                    ],
                    if ((amounts?.foodCgstAmount ?? 0) > 0 || (amounts?.foodSgstAmount ?? 0) > 0) ...[
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
                    if ((amounts?.serviceCgstAmount ?? 0) > 0 || (amounts?.serviceSgstAmount ?? 0) > 0) ...[
                      _Row(
                        label: 'CGST (${amounts?.serviceCgstRatePercent ?? 0}%) on services',
                        value: amounts?.serviceCgstAmount ?? 0,
                        muted: true,
                      ),
                      _Row(
                        label: 'SGST (${amounts?.serviceSgstRatePercent ?? 0}%) on services',
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

                    const Divider(height: 14, thickness: 0.8, color: AppTheme.border),
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

                    const SizedBox(height: AppTheme.s8),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppTheme.sidebarBrandWash,
                        borderRadius: BorderRadius.circular(AppTheme.rSmall),
                        border: Border.all(color: AppTheme.sidebarBrandWashEdge),
                      ),
                      child: Row(
                        children: [
                          const Text(
                            'BALANCE DUE',
                            style: TextStyle(
                              color: AppTheme.sidebarBrandInk,
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.6,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            formatPrice(preview.balanceDue),
                            style: const TextStyle(
                              color: AppTheme.sidebarBrandInk,
                              fontWeight: FontWeight.w800,
                              fontSize: 17,
                              letterSpacing: -0.3,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),

        // ── The overstay charge ─────────────────────────────────────────────
        // Reception agreed this with the guest at the door, but the bill is
        // written here — a manager who decides the overstay isn't worth
        // charging drops it without sending the guest back to the desk.
        // Dropping it affects this document only: the booking keeps what was
        // agreed and how late the guest actually was. Mirrors the web
        // screen's own "Add to bill" / "Leave it off" pair.
        if (preview.lateCheckoutAgreed > 0) ...[
          const SizedBox(height: AppTheme.s12),
          _PanelCard(
            icon: Icons.schedule_rounded,
            iconColor: AppTheme.checkout,
            title: 'Late checkout',
            subtitle: lateCheckoutLabel(preview.lateCheckoutMinutes),
            trailing: Text(
              formatPrice(preview.lateCheckoutAgreed),
              style: TextStyle(
                color: state.includeLateCheckout ? AppTheme.heading : AppTheme.muted,
                fontWeight: FontWeight.w800,
                fontSize: 15,
                decoration: state.includeLateCheckout ? null : TextDecoration.lineThrough,
              ),
            ),
            children: [
              Row(
                children: [
                  Expanded(
                    child: _ToggleButton(
                      label: 'Add to bill',
                      selected: state.includeLateCheckout,
                      enabled: !state.previewing,
                      onTap: () => vm.setLateCheckout(true),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: _ToggleButton(
                      label: 'Leave it off',
                      selected: !state.includeLateCheckout,
                      enabled: !state.previewing,
                      onTap: () => vm.setLateCheckout(false),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                state.includeLateCheckout
                    ? "Taxed at the room's own rate."
                    : 'Not charged. Stays on record as '
                          '${lateCheckoutLabel(preview.lateCheckoutMinutes)}.',
                style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
              ),
            ],
          ),
        ],

        // ── The guest who left early ────────────────────────────────────────
        // Only ever set on a CYCLE stay: the bill still carries every night
        // that was sold, and this is where the desk decides whether to give
        // the unused ones back. It fills the discount below.
        if (preview.earlyCheckout != null) ...[
          const SizedBox(height: AppTheme.s12),
          _EarlyCheckoutNotice(state: state, earlyCheckout: preview.earlyCheckout!),
        ],

        // ── The discount ─────────────────────────────────────────────────────
        // Only a cycle property discounts here: on the other two modes the
        // bill is what the stay costs and any concession is settled through
        // what the guest hands over.
        if (state.isCycleStay) ...[
          const SizedBox(height: AppTheme.s12),
          _DiscountSection(state: state),
        ],

        // ── How it was paid ─────────────────────────────────────────────────
        const SizedBox(height: AppTheme.s16),
        Row(
          children: [
            Container(
              width: 24,
              height: 24,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppTheme.accent,
                borderRadius: BorderRadius.circular(7),
              ),
              child: const Icon(Icons.payments_rounded, color: Colors.white, size: 13),
            ),
            const SizedBox(width: 10),
            const Text(
              'Record payment',
              style: TextStyle(color: AppTheme.heading, fontSize: 14, fontWeight: FontWeight.w700),
            ),
            const Spacer(),
            Text(
              state.nothingDue ? 'Nothing due' : '${formatPrice(state.balanceDue)} due',
              style: TextStyle(
                color: state.nothingDue ? AppTheme.vacant : AppTheme.accent,
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Padding(
          padding: const EdgeInsets.only(left: 34),
          child: Text(
            state.nothingDue
                ? 'The advance covers this bill — issue it as it stands.'
                : 'Choose the payment type for each amount taken.',
            style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
          ),
        ),
        const SizedBox(height: AppTheme.s8),
        // No rows at all when nothing is due — the desk has nothing to
        // record, and a set of payment rows sitting empty under a line
        // saying there is nothing to collect is a form contradicting itself.
        if (!state.nothingDue) _PaymentRows(state: state),

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

// ── Header band & pinned action bar ─────────────────────────────────────────

/// The navy cap of the bill: which document this is, who it is for, and the
/// figure the desk is about to collect, readable at a glance.
class _BillHero extends StatelessWidget {
  final BillPreview preview;
  final BillSide? amounts;

  const _BillHero({required this.preview, required this.amounts});

  @override
  Widget build(BuildContext context) {
    final guest = preview.guestName;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, AppTheme.s12),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppTheme.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.receipt_long_rounded, color: AppTheme.muted, size: 14),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  (kDocumentLabels[amounts?.documentType] ?? 'Bill').toUpperCase(),
                  style: const TextStyle(
                    color: AppTheme.muted,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.8,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              // Which document is issued is the property's business, not the
              // desk's: a registered lodge issues on the GST side, and an
              // unregistered one has nothing else to issue.
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppTheme.sidebarBrandWash,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  preview.isGstRegistered ? 'GST' : 'Non-GST',
                  style: const TextStyle(color: AppTheme.sidebarBrandInk, fontSize: 10, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (guest != null && guest.isNotEmpty)
                      Text(
                        guest,
                        style: const TextStyle(
                          color: AppTheme.heading,
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.2,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    const SizedBox(height: 2),
                    Text(
                      [
                        'Room ${preview.roomNumber ?? '—'}',
                        nightsLabel(preview.nights),
                        if (preview.isDormitory)
                          preview.bedLabel != null ? 'Bed ${preview.bedLabel}' : 'Whole dorm',
                      ].join('  ·  '),
                      style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  const Text(
                    'GRAND TOTAL',
                    style: TextStyle(
                      color: AppTheme.muted,
                      fontSize: 9.5,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.6,
                    ),
                  ),
                  Text(
                    formatPrice(amounts?.totalAmount ?? 0),
                    style: const TextStyle(
                      color: AppTheme.heading,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.4,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The action card at the end of the page: what is due, and the one button that
/// cuts the bill. Always in reach however long the bill above it runs.
class _IssueBar extends ConsumerWidget {
  final BillingState state;
  final BillPreview preview;

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
              // Shut until the money recorded equals what is owed, and while
              // the request is in flight. Issuing burns a serial and there is
              // no undo, only a void.
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

/// A compact titled panel: a coloured icon badge, a title with a one-line
/// subtitle, an optional figure on the right, then its controls underneath.
class _PanelCard extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final Widget? trailing;
  final List<Widget> children;

  const _PanelCard({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.children,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
      ),
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
                  color: iconColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, size: 15, color: iconColor),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: AppTheme.heading,
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      subtitle,
                      style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              if (trailing != null) trailing!,
            ],
          ),
          const SizedBox(height: 10),
          ...children,
        ],
      ),
    );
  }
}

/// A small-caps caption heading a group of lines on the bill.
class _SectionLabel extends StatelessWidget {
  final String text;

  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 2, bottom: 6),
      child: Text(
        text.toUpperCase(),
        style: const TextStyle(
          color: AppTheme.muted,
          fontSize: 10,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.7,
        ),
      ),
    );
  }
}

// ── One line of the document ────────────────────────────────────────────────

/// One room of a multi-room bill: a heading naming the room, then its own
/// rate line and extras, then its own total — the same per-room cut the web
/// bill prints (see `roomSections` in `multiRoom.js`), so each room can be
/// checked without the others.
class _RoomSectionRows extends StatelessWidget {
  final RoomBillSection section;

  const _RoomSectionRows({required this.section});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: AppTheme.s8),
      padding: const EdgeInsets.fromLTRB(AppTheme.s8, AppTheme.s8, AppTheme.s8, 2),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 3,
                height: 12,
                decoration: BoxDecoration(
                  color: AppTheme.accent.withValues(alpha: 0.5),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: 6),
              Text(
                'Room ${section.room} · ${nightsLabel(section.base.nights)}',
                style: const TextStyle(
                  color: AppTheme.muted,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.1,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          _Row(label: section.base.label, value: section.base.amount),
          for (final extra in section.extras)
            _Row(label: extra.label, value: extra.amount),
          if (section.extras.isNotEmpty)
            _Row(
              label: 'Room ${section.room} total',
              value: section.total,
              strong: true,
            ),
        ],
      ),
    );
  }
}

/// A titled card of line items swept onto the bill — food or other services
/// — shown above the document itself so staff can check it against what
/// actually went to the room before committing to paper. Mirrors the web
/// screen's "Food ordered during the stay" / "Other services" sections.
class _ItemisedSection extends StatelessWidget {
  final String title;
  final IconData icon;
  final List<Widget> children;
  final String? hint;

  const _ItemisedSection({
    required this.title,
    required this.icon,
    required this.children,
    this.hint,
  });

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s12, AppTheme.s12, AppTheme.s8),
            child: Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        AppTheme.accent.withValues(alpha: 0.16),
                        AppTheme.sidebarBrand.withValues(alpha: 0.08),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(AppTheme.rSmall),
                  ),
                  child: Icon(icon, size: 14, color: AppTheme.accent),
                ),
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: Text(title, style: Theme.of(context).textTheme.titleMedium),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s8, AppTheme.s12, AppTheme.s4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final (i, child) in children.indexed) ...[
                  if (i > 0)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: AppTheme.s4),
                      child: Divider(height: 1, color: AppTheme.bg),
                    ),
                  child,
                ],
                if (hint != null) ...[
                  const SizedBox(height: AppTheme.s4),
                  Text(hint!, style: Theme.of(context).textTheme.bodySmall),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ItemRow extends StatelessWidget {
  final String name;
  final String detail;
  final num value;

  const _ItemRow({required this.name, required this.detail, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.s4 + 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 1),
                Text(
                  detail,
                  style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          Text(
            formatPrice(value),
            style: const TextStyle(color: AppTheme.heading, fontSize: 13.5, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

/// One half of a two-way choice — "Add to bill" / "Leave it off" — styled
/// like the web screen's own `.toggle-group` buttons: both always on screen,
/// the chosen one filled in.
class _ToggleButton extends StatelessWidget {
  final String label;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  const _ToggleButton({
    required this.label,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppTheme.accent : AppTheme.bg,
      borderRadius: BorderRadius.circular(AppTheme.rSmall),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        onTap: enabled ? onTap : null,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppTheme.rSmall),
            border: Border.all(
              color: selected ? AppTheme.accent : AppTheme.muted.withValues(alpha: 0.3),
            ),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? Colors.white : AppTheme.text,
              fontWeight: FontWeight.w600,
              fontSize: 12.5,
            ),
          ),
        ),
      ),
    );
  }
}

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
      padding: const EdgeInsets.only(bottom: 5),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: colour,
                fontSize: strong ? 14.5 : (muted ? 12 : 13),
                fontWeight: strong ? FontWeight.w700 : FontWeight.w400,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          Text(
            formatPrice(value),
            style: TextStyle(
              color: colour,
              fontSize: strong ? 15 : (muted ? 12 : 13),
              fontWeight: strong ? FontWeight.w800 : FontWeight.w500,
              fontFeatures: const [FontFeature.tabularFigures()],
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
                    Text(
                      'Guest left early',
                      style: Theme.of(context).textTheme.titleSmall,
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
                style: Theme.of(context).textTheme.titleSmall,
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
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppTheme.heading),
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

    return _PanelCard(
      icon: Icons.local_offer_rounded,
      iconColor: AppTheme.edit,
      title: 'Discount',
      subtitle: discount > 0
          ? '${formatPrice(discountAmount)} off · printed on the bill'
          : 'None on this bill',
      children: [
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

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        children: [
          for (var i = 0; i < state.payment.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
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
          const Divider(height: 14, thickness: 0.8, color: AppTheme.border),
          Row(
            children: [
              const Text(
                'Recorded',
                style: TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
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
          // Shown as the desk types, not only when Issue is pressed — the
          // button beside it is disabled, and a disabled button with no stated
          // reason is the one people press twice and then telephone about.
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

// ── The whole stay, on request ──────────────────────────────────────────────

/// Shut by default, loaded only when opened — most bills are issued off the
/// summary above, and this is for the one where the guest queries a figure
/// and the desk needs the whole stay, night by night, without leaving the
/// bill it's halfway through writing. Mirrors the web screen's own
/// `loadStayDetails()` + `<StayDetails showOutstanding={false} />`.
class _StayDetailsExpander extends ConsumerStatefulWidget {
  final int bookingId;

  const _StayDetailsExpander({required this.bookingId});

  @override
  ConsumerState<_StayDetailsExpander> createState() =>
      _StayDetailsExpanderState();
}

class _StayDetailsExpanderState extends ConsumerState<_StayDetailsExpander> {
  bool _open = false;
  bool _loading = false;
  String? _error;
  Booking? _booking;

  Future<void> _toggle() async {
    setState(() => _open = !_open);
    if (_open && _booking == null && !_loading) {
      setState(() {
        _loading = true;
        _error = null;
      });
      final booking = await ref
          .read(bookingViewModelProvider.notifier)
          .loadBooking(widget.bookingId);
      if (!mounted) return;
      setState(() {
        _loading = false;
        _booking = booking;
        if (booking == null) _error = 'Could not load this stay.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(AppTheme.rMedium),
            onTap: _toggle,
            child: Padding(
              padding: const EdgeInsets.all(AppTheme.s12),
              child: Row(
                children: [
                  Container(
                    width: 30,
                    height: 30,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          AppTheme.accent.withValues(alpha: 0.16),
                          AppTheme.sidebarBrand.withValues(alpha: 0.08),
                        ],
                      ),
                      borderRadius: BorderRadius.circular(AppTheme.rSmall),
                    ),
                    child: const Icon(
                      Icons.fact_check_rounded,
                      color: AppTheme.accent,
                      size: 16,
                    ),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  Expanded(
                    child: Text(
                      'View full stay details',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    margin: const EdgeInsets.only(right: 6),
                    decoration: BoxDecoration(
                      color: AppTheme.sidebarBrandWash,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      _open ? 'Hide' : 'Show',
                      style: const TextStyle(
                        color: AppTheme.sidebarBrandInk,
                        fontSize: 10.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  AnimatedRotation(
                    duration: const Duration(milliseconds: 150),
                    turns: _open ? 0.5 : 0,
                    child: const Icon(
                      Icons.keyboard_arrow_down_rounded,
                      color: AppTheme.muted,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (_open)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppTheme.s12,
                0,
                AppTheme.s12,
                AppTheme.s12,
              ),
              child: _loading
                  ? const Padding(
                      padding: EdgeInsets.symmetric(vertical: AppTheme.s16),
                      child: Center(child: CircularProgressIndicator()),
                    )
                  : _error != null
                  ? Text(_error!, style: const TextStyle(color: AppTheme.danger))
                  : _booking == null
                  ? const SizedBox.shrink()
                  : _StayDetailsContent(booking: _booking!),
            ),
        ],
      ),
    );
  }
}

/// The five sections a booking is taken through, read back read-only — same
/// order and numbering the web's own `StayDetails.jsx` lays them out in, so a
/// stay read here and read there is one record, not two summaries of it.
class _StayDetailsContent extends StatelessWidget {
  final Booking booking;

  const _StayDetailsContent({required this.booking});

  @override
  Widget build(BuildContext context) {
    final nights = booking.nights;
    final lateBy = _lateByLabel(booking.lateCheckoutMinutes);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 1 — Stay & room
        _DetailSection(
          number: 1,
          icon: Icons.meeting_room_rounded,
          title: 'Stay & room',
          children: [
            _Fact(
              label: booking.isMultiRoom ? 'Rooms' : 'Room',
              value: booking.isMultiRoom
                  ? '${booking.roomCount} rooms · ${booking.roomNumbers ?? ''}'
                  : '${booking.roomNumber ?? '—'} · ${booking.categoryName ?? '—'}',
            ),
            _Fact(
              label: 'Dates',
              value:
                  '${formatIsoDate(booking.checkInDate)} – '
                  '${formatIsoDate(booking.checkOutDate)}'
                  '${nights != null ? ' · ${nightsLabel(nights)}' : ''}',
            ),
            _Fact(
              label: 'Came in',
              value: booking.actualCheckInAt != null
                  ? formatDateTime(booking.actualCheckInAt)
                  : 'Not arrived yet',
            ),
            _Fact(
              label: 'Left',
              value: booking.actualCheckOutAt != null
                  ? formatDateTime(booking.actualCheckOutAt)
                  : booking.actualCheckInAt != null
                  ? 'Still staying'
                  : 'Not arrived yet',
            ),
            if (lateBy != null)
              _Fact(
                label: 'Left late by',
                value:
                    '$lateBy · '
                    '${booking.lateCheckoutCharge > 0 ? '${formatPrice(booking.lateCheckoutCharge)} agreed' : 'no charge taken'}',
              ),
            if (booking.switchableCharges.isNotEmpty)
              _Fact(
                label: 'Extras',
                value: booking.switchableCharges
                    .map((c) => c.quantity > 1 ? '${c.name} ×${c.quantity}' : c.name)
                    .join(' · '),
              ),
          ],
        ),
        const SizedBox(height: 10),

        // 2 — Guest details
        _DetailSection(
          number: 2,
          icon: Icons.people_alt_rounded,
          title: 'Guest details',
          children: [
            Text(
              '${booking.numGuests ?? 1} guest'
              '${(booking.numGuests ?? 1) == 1 ? '' : 's'}'
              '${booking.childCount > 0 ? ' · ${booking.numGuests! - booking.childCount} adult${booking.numGuests! - booking.childCount == 1 ? '' : 's'} and ${booking.childCount} child${booking.childCount == 1 ? '' : 'ren'}' : ''}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: AppTheme.s8),
            _PersonRow(
              name: booking.guestName ?? '—',
              role: 'Primary guest',
              meta: [
                if (booking.guestPhone != null) booking.guestPhone!,
                if (booking.idProofType != null) _idProofLabel(booking.idProofType!),
              ].join(' · '),
            ),
            for (final g in booking.guests)
              _PersonRow(
                name: g.name,
                role: g.isChild ? 'Child' : null,
                meta: [
                  if (g.phone != null) g.phone!,
                  if (g.idProofType != null) _idProofLabel(g.idProofType!),
                ].join(' · '),
              ),
          ],
        ),
        const SizedBox(height: AppTheme.s12),

        // 3 — Advance payment
        _DetailSection(
          number: 3,
          icon: Icons.payments_rounded,
          title: booking.paidInFull ? 'Payment' : 'Advance payment',
          children: [
            if (booking.advanceAmount != null) ...[
              _Fact(
                label: booking.paidInFull ? 'Paid in full' : 'Taken',
                value:
                    '${formatPrice(booking.advanceAmount)} · '
                    '${booking.advanceDescription}',
              ),
              if (booking.advanceReference != null)
                _Fact(label: 'Transaction no.', value: booking.advanceReference!),
            ] else
              Text('No advance taken.', style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
        const SizedBox(height: AppTheme.s12),

        // 4 — Vehicles
        _DetailSection(
          number: 4,
          icon: Icons.directions_car_filled_rounded,
          title: 'Vehicles',
          children: [
            if (booking.vehicles.isEmpty)
              Text('None on file.', style: Theme.of(context).textTheme.bodySmall)
            else
              for (final v in booking.vehicles)
                _PersonRow(
                  name: v.number,
                  meta: v.type != null ? _vehicleTypeLabel(v.type!) : 'Type not recorded',
                ),
          ],
        ),
        const SizedBox(height: AppTheme.s12),

        // 5 — Price breakdown
        _DetailSection(
          number: 5,
          icon: Icons.receipt_long_rounded,
          title: 'Price breakdown',
          children: [
            const Text(
              'Room',
              style: TextStyle(color: AppTheme.muted, fontSize: 11.5, fontWeight: FontWeight.w800),
            ),
            for (final line in booking.roomCharges)
              _ItemRow(
                name: line.label,
                detail: line.nights > 1 && line.amount > 0 ? '× ${line.nights} nights' : '',
                value: line.amount,
              ),
            _Row(
              label: 'Room charge for ${nights == 1 ? 'the night' : 'all nights'}',
              value: booking.totalPrice ?? 0,
              strong: true,
            ),
            if (booking.lateCheckoutCharge > 0)
              _Row(label: 'Agreed for leaving late', value: booking.lateCheckoutCharge),
            if (booking.foodOrdersOpen.isNotEmpty) ...[
              const SizedBox(height: AppTheme.s8),
              const Text(
                'Food',
                style: TextStyle(color: AppTheme.muted, fontSize: 11.5, fontWeight: FontWeight.w800),
              ),
              for (final o in booking.foodOrdersOpen)
                _ItemRow(
                  name: 'Order #${o.orderNumber}',
                  detail: o.origin == 'ROOM_SERVICE'
                      ? 'room service'
                      : 'from ${o.placedFrom ?? 'restaurant'}',
                  value: o.subtotal,
                ),
              _Row(label: 'Food ordered', value: booking.foodOpenTotal, strong: true),
            ],
            if (booking.servicesOpen.isNotEmpty) ...[
              const SizedBox(height: AppTheme.s8),
              const Text(
                'Services',
                style: TextStyle(color: AppTheme.muted, fontSize: 11.5, fontWeight: FontWeight.w800),
              ),
              for (final u in booking.servicesOpen)
                _ItemRow(
                  name: u.name,
                  detail: '${formatPrice(u.unitPrice ?? (u.quantity == 0 ? 0 : u.amount / u.quantity))} '
                      'per ${u.unitLabel} × ${u.quantity}',
                  value: u.amount,
                ),
              _Row(
                label: 'Services used · ${booking.servicesOpen.length} '
                    '${booking.servicesOpen.length == 1 ? 'item' : 'items'}',
                value: booking.servicesOpenTotal,
                strong: true,
              ),
            ],
            if (booking.advanceAmount != null) ...[
              const SizedBox(height: AppTheme.s8),
              const Text(
                'Payments',
                style: TextStyle(color: AppTheme.muted, fontSize: 11.5, fontWeight: FontWeight.w800),
              ),
              _Row(
                label: booking.paidInFull ? 'Paid in full at booking' : 'Advance already paid',
                value: -booking.advanceAmount!,
              ),
            ],
          ],
        ),
      ],
    );
  }
}

String? _lateByLabel(int? minutes) {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return '$minutes minutes';
  final hours = minutes ~/ 60;
  final mins = minutes % 60;
  return mins == 0 ? '$hours hours' : '${hours}h ${mins}m';
}

String _idProofLabel(String type) =>
    type.isEmpty ? type : type[0] + type.substring(1).toLowerCase().replaceAll('_', ' ');

const _kVehicleTypeLabels = <String, String>{
  'TWO_WHEELER': 'Two wheeler',
  'FOUR_WHEELER': 'Four wheeler',
  'TRAVELLER': 'Traveller',
  'BUS': 'Bus',
};

String _vehicleTypeLabel(String type) => _kVehicleTypeLabels[type] ?? type;

/// One of the five sections a booking is taken through — its own tinted
/// sub-card with an icon badge, a number chip, and a hairline divider before
/// the facts it holds, so a long read-only stay record breaks into
/// scannable pieces instead of one unbroken column of text.
class _DetailSection extends StatelessWidget {
  final int number;
  final IconData icon;
  final String title;
  final List<Widget> children;

  const _DetailSection({
    required this.number,
    required this.icon,
    required this.title,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 9),
            decoration: const BoxDecoration(
              color: AppTheme.sidebarBrandWash,
              border: Border(bottom: BorderSide(color: AppTheme.sidebarBrandWashEdge, width: 0.8)),
            ),
            child: Row(
              children: [
                Container(
                  width: 24,
                  height: 24,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppTheme.accent,
                    borderRadius: BorderRadius.circular(7),
                  ),
                  child: Icon(icon, size: 13, color: Colors.white),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(
                      color: AppTheme.sidebarBrandInk,
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.1,
                    ),
                  ),
                ),
                Text(
                  '0$number',
                  style: TextStyle(
                    color: AppTheme.accent.withValues(alpha: 0.45),
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.4,
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s8, AppTheme.s12, AppTheme.s8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: children,
            ),
          ),
        ],
      ),
    );
  }
}

/// One label/value pair, stacked the way the web's own `.detail-fact` reads.
class _Fact extends StatelessWidget {
  final String label;
  final String value;

  const _Fact({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 82,
            child: Text(
              label,
              style: const TextStyle(color: AppTheme.muted, fontSize: 12, fontWeight: FontWeight.w500),
            ),
          ),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(color: AppTheme.heading, fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// One person (a guest or a vehicle) — a name, and whatever is known beside
/// it. Mirrors the web's own `.detail-person`.
class _PersonRow extends StatelessWidget {
  final String name;
  final String? role;
  final String meta;

  const _PersonRow({required this.name, this.role, this.meta = ''});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.s4 + 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                name,
                style: const TextStyle(color: AppTheme.text, fontSize: 13, fontWeight: FontWeight.w600),
              ),
              if (role != null) ...[
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(
                    color: AppTheme.accent.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    role!,
                    style: const TextStyle(color: AppTheme.accent, fontSize: 9.5, fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ],
          ),
          if (meta.isNotEmpty)
            Text(meta, style: const TextStyle(color: AppTheme.muted, fontSize: 11.5)),
        ],
      ),
    );
  }
}
