import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/invoice.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/billing_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'advance_receipt_screen.dart';
import 'invoice_preview_screen.dart';
import 'issue_bill_screen.dart';
import 'issue_food_bill_screen.dart';
import 'numbering_screen.dart';

enum _BillingTab { toBill, food, issued, numbering }

/// Billing: what still has to be billed, and what already has been.
///
/// Two lists rather than the web's single screen with a modal over it. A phone
/// has no room to lay a bill over a queue, so the bill is a page of its own —
/// but the flow is the same one: pick a stay, check what it says, record what
/// the guest handed over, issue.
class BillingScreen extends ConsumerStatefulWidget {
  /// True for the "Restaurant billing" entry under the Restaurant group —
  /// mirrors the web's `<Billing stream="restaurant" />` (OwnerDashboard.jsx):
  /// only table/takeaway tabs and their own bills, the room queue left out
  /// entirely rather than shown and empty.
  final bool restaurantOnly;

  const BillingScreen({super.key, this.restaurantOnly = false});

  @override
  ConsumerState<BillingScreen> createState() => _BillingScreenState();
}

class _BillingScreenState extends ConsumerState<BillingScreen> {
  late _BillingTab _tab =
      widget.restaurantOnly ? _BillingTab.food : _BillingTab.toBill;

  final _search = TextEditingController();

  // 'table' is the landing view — mirrors the web's own `useState('sheet')`:
  // lists open as a spreadsheet, the cards one toggle away. 'cards' is the
  // easier read for one stay/table/bill at a time on a phone.
  String _view = 'table';

  // The Bills tab's own date range — mirrors BILL_DATE_PRESETS in
  // Billing.jsx. 'all' means no filter; 'custom' reads [_customFrom]/
  // [_customTo].
  String _dateFilterKey = 'all';
  DateTime? _customFrom;
  DateTime? _customTo;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() => ref.read(billingViewModelProvider.notifier).load();

  void _applyDatePreset(String key) {
    final range = billingDatePresetRange(key);
    setState(() {
      _dateFilterKey = key;
      _customFrom = range.$1;
      _customTo = range.$2;
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(billingViewModelProvider);
    // "Food to bill" now lives only on Restaurant billing — the same split
    // the web makes between its plain Billing (stream="room", no tables tab
    // at all) and its stream="restaurant" page, which is the only one that
    // ever renders one.
    final tab = widget.restaurantOnly
        ? (_tab == _BillingTab.issued ? _BillingTab.issued : _BillingTab.food)
        : (_tab == _BillingTab.food ? _BillingTab.toBill : _tab);

    final toggle = _Toggle(
      tab: tab,
      showRoom: !widget.restaurantOnly,
      showFood: widget.restaurantOnly,
      // FoodBillingScreen already wraps restaurant billing with its own
      // external Numbering segment (see its _onNumbering) — showing a
      // second one here, nested inside the same screen, would be the same
      // settings reachable two confusing ways.
      showNumbering: !widget.restaurantOnly,
      toBillCount: state.queue.valueOrNull?.length,
      foodCount: state.foodQueue.valueOrNull?.length,
      onChanged: (v) => setState(() => _tab = v),
    );

    if (tab == _BillingTab.numbering) {
      return Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppTheme.s12,
              AppTheme.s8,
              AppTheme.s12,
              0,
            ),
            child: toggle,
          ),
          const Expanded(
            child: Padding(
              padding: EdgeInsets.all(AppTheme.s12),
              child: NumberingScreen(),
            ),
          ),
        ],
      );
    }

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
          toggle,
          const SizedBox(height: AppTheme.s12),
          BillingSearchAndViewToggle(
            controller: _search,
            view: _view,
            onViewChanged: (v) => setState(() => _view = v),
            onSearchChanged: () => setState(() {}),
          ),
          const SizedBox(height: AppTheme.s12),
          if (tab == _BillingTab.issued) ...[
            BillingDateFilterRow(
              filterKey: _dateFilterKey,
              from: _customFrom,
              to: _customTo,
              onPresetSelected: _applyDatePreset,
              onFromChanged: (v) => setState(() {
                _customFrom = v;
                _dateFilterKey = 'custom';
              }),
              onToChanged: (v) => setState(() {
                _customTo = v;
                _dateFilterKey = 'custom';
              }),
            ),
            const SizedBox(height: AppTheme.s12),
          ],
          if (tab == _BillingTab.food)
            ..._food(state)
          else if (tab == _BillingTab.issued)
            ..._issued(state, restaurantOnly: widget.restaurantOnly)
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
    data: (allRows) {
      final needle = _search.text.trim().toLowerCase();
      final rows = needle.isEmpty
          ? allRows
          : allRows.where((tab) =>
              (tab.tableLabel ?? '').toLowerCase().contains(needle) ||
              (tab.guestName ?? '').toLowerCase().contains(needle) ||
              (tab.customerPhone ?? '').toLowerCase().contains(needle)).toList();
      if (rows.isEmpty) {
        return const [
          SizedBox(height: 80),
          NeuNotice(
            icon: Icons.task_alt_rounded,
            message: 'Nothing waiting — everything served has been billed.',
          ),
        ];
      }
      final queueRows = [
        for (final tab in rows)
          BillingQueueRow(
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
            subtitle:
                (tab.isTakeaway
                    ? [
                        if (tab.customerPhone != null) tab.customerPhone!,
                        'Placed ${formatTimeOfDay(tab.openedAt)}',
                      ].join(' · ')
                    : '${tab.orderCount} order${tab.orderCount == 1 ? '' : 's'} '
                          '· since ${formatTimeOfDay(tab.openedAt)}') +
                (tab.liveOrderCount > 0
                    ? ' · ${tab.liveOrderCount} still in progress'
                    : ''),
            amount: tab.subtotal,
          ),
      ];
      if (_view == 'table') return [BillingQueueTable(rows: queueRows)];
      return [
        for (final row in queueRows)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s4 + 2),
            child: BillingRowCard(
              onTap: row.onTap,
              icon: row.icon,
              title: row.title,
              subtitle: row.subtitle,
              amount: row.amount,
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
    data: (allRows) {
      final needle = _search.text.trim().toLowerCase();
      final rows = needle.isEmpty
          ? allRows
          : allRows.where((stay) =>
              (stay.roomNumber ?? '').toLowerCase().contains(needle) ||
              (stay.guestName ?? '').toLowerCase().contains(needle) ||
              (stay.categoryName ?? '').toLowerCase().contains(needle)).toList();
      if (rows.isEmpty) {
        return const [
          SizedBox(height: 80),
          NeuNotice(
            icon: Icons.task_alt_rounded,
            message: 'Nothing waiting to be billed.',
          ),
        ];
      }
      // The State's own mounted, not the closure's context — this widget is
      // rebuilt by the list around it, and checking the wrong one is
      // checking whether a context that has already been replaced is still
      // good.
      final queueRows = [
        for (final stay in rows)
          BillingQueueRow(
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
      ];
      if (_view == 'table') return [BillingQueueTable(rows: queueRows)];
      return [
        for (final row in queueRows)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s4 + 2),
            child: BillingRowCard(
              onTap: row.onTap,
              roomLabel: row.roomLabel,
              title: row.title,
              subtitle: row.subtitle,
              amount: row.amount,
              amountLabel: row.amountLabel,
            ),
          ),
      ];
    },
  );

  // ── Issued ────────────────────────────────────────────────────────────────

  List<Widget> _issued(BillingState state, {required bool restaurantOnly}) {
    if (state.invoices.isLoading || state.advanceReceipts.isLoading) {
      return const [
        SizedBox(height: 120),
        Center(child: CircularProgressIndicator()),
      ];
    }
    // The list renders what it has, same as the web's own `invoices ||
    // receipts` — a receipts fetch that failed doesn't hide the invoices
    // that loaded fine, and the reverse.
    final invoices = state.invoices.valueOrNull;
    final receipts = state.advanceReceipts.valueOrNull;
    if (invoices == null && receipts == null) {
      return [
        NeuNotice(
          icon: Icons.cloud_off_rounded,
          message: 'Could not load the bills.',
          action: NeuButton(onPressed: _load, child: const Text('Try again')),
        ),
      ];
    }
    final allRows = [
      for (final inv in invoices ?? const <Invoice>[]) BillDocument.ofInvoice(inv),
      // A FOOD invoice has no receipt of its own (an advance is only ever
      // taken against a stay or a function), so merging receipts in plainly
      // never adds one to the restaurant stream below.
      for (final r in receipts ?? const <AdvanceReceipt>[]) BillDocument.ofReceipt(r),
    ];
    // Same split as the web's own streamOf(): a FOOD-kind bill is a
    // restaurant document and an event bill (or a receipt taken against one)
    // its own "event" stream — EventBillingScreen's issued list, not this
    // one — so both are kept out of room billing entirely rather than
    // shown and looking out of place among room/stay bills.
    final streamRows = restaurantOnly
        ? allRows.where((d) => d.kind == 'FOOD').toList()
        : allRows.where((d) => d.kind != 'FOOD' && !d.isEventBill).toList();
    final needle = _search.text.trim().toLowerCase();
    final searched = needle.isEmpty
        ? streamRows
        : streamRows.where((d) =>
            (d.invoiceNumber ?? '').toLowerCase().contains(needle) ||
            (d.guestName ?? '').toLowerCase().contains(needle) ||
            (d.roomNumber ?? '').toLowerCase().contains(needle) ||
            (d.venueName ?? '').toLowerCase().contains(needle) ||
            (d.tableLabel ?? '').toLowerCase().contains(needle)).toList();
    final rows = searched
        .where((d) => matchesBillingDateRange(d.createdAt, _customFrom, _customTo))
        .toList();
    if (rows.isEmpty) {
      return const [
        SizedBox(height: 80),
        NeuNotice(
          icon: Icons.receipt_long_rounded,
          message: 'No bills issued yet.',
        ),
      ];
    }
    if (_view == 'table') return [BillingInvoiceTable(documents: rows)];
    return [
      for (final doc in rows)
        Padding(
          padding: const EdgeInsets.only(bottom: AppTheme.s4 + 2),
          child: BillingInvoiceCard(document: doc),
        ),
    ];
  }
}

// ── A queue row ──────────────────────────────────────────────────────────────

/// The shared shape behind every "to bill" row — room, food, and (from
/// event_billing_screen.dart) function: a colour spine down the left edge
/// (the same device the register page's booking cards use to make status
/// legible before the eye lands on any text), a two-line title block, and a
/// trailing figure — with a real ink ripple on tap rather than [NeuCard]'s
/// bare [GestureDetector], since a list a cashier taps through all shift is
/// worth the tactile feedback.
class BillingRowCard extends StatelessWidget {
  final IconData? icon;
  final String? roomLabel;
  final String title;
  final String subtitle;
  final num? amount;
  final String? amountLabel;
  final VoidCallback onTap;

  const BillingRowCard({
    super.key,
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

  /// False on "Restaurant billing" — the room queue never shows there, the
  /// same way the web's own stream="restaurant" page never renders it.
  final bool showRoom;
  final bool showFood;

  /// Last, and deliberately not first — same order and reasoning as the
  /// web's own `tabs` array in Billing.jsx: numbering is set once at setup
  /// and then left alone, while the other tabs are used every day.
  final bool showNumbering;
  final int? toBillCount;
  final int? foodCount;
  final ValueChanged<_BillingTab> onChanged;

  const _Toggle({
    required this.tab,
    this.showRoom = true,
    required this.showFood,
    this.showNumbering = false,
    required this.toBillCount,
    required this.foodCount,
    required this.onChanged,
  });

  static const double _height = 40;

  @override
  Widget build(BuildContext context) {
    final segments = [
      if (showRoom)
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
      if (showNumbering) (tab: _BillingTab.numbering, label: 'Numbering'),
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

class BillingInvoiceCard extends ConsumerWidget {
  final BillDocument document;

  const BillingInvoiceCard({super.key, required this.document});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (document.isReceipt) {
      return _AdvanceReceiptCard(receipt: document.receipt!);
    }
    final invoice = document.invoice!;
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

/// The same card shape as [BillingInvoiceCard], read off an [AdvanceReceipt]
/// instead of an [Invoice] — a receipt states what it took and what the stay
/// or function still owes, not a tax breakdown of its own.
class _AdvanceReceiptCard extends StatelessWidget {
  final AdvanceReceipt receipt;

  const _AdvanceReceiptCard({required this.receipt});

  @override
  Widget build(BuildContext context) {
    final tint = receipt.isVoid ? AppTheme.danger : AppTheme.vacant;

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
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => AdvanceReceiptScreen(receipt: receipt)),
          ),
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
                              child: Icon(Icons.payments_outlined, size: 16, color: tint),
                            ),
                            const SizedBox(width: AppTheme.s8),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    '${kDocumentLabels[receipt.documentType] ?? 'Receipt'} '
                                    '${receipt.receiptNumber ?? ''}',
                                    style: Theme.of(context).textTheme.titleMedium,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  const SizedBox(height: 1),
                                  Text(
                                    [
                                      receipt.guestName,
                                      if (receipt.isEventReceipt)
                                        receipt.venueName ?? receipt.eventTitle ?? 'Function'
                                      else if (receipt.roomNumber != null)
                                        'Room ${receipt.roomNumber}'
                                            '${receipt.isDormitory ? ' · Dormitory' : ''}',
                                      formatIsoDate(receipt.createdAt),
                                    ].whereType<String>().where((s) => s.isNotEmpty).join(' · '),
                                    style: Theme.of(context).textTheme.bodySmall,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ],
                              ),
                            ),
                            if (receipt.isVoid)
                              Container(
                                margin: const EdgeInsets.only(left: AppTheme.s8),
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  color: AppTheme.danger.withValues(alpha: 0.1),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: Text(
                                  'Void',
                                  style: Theme.of(context)
                                      .textTheme
                                      .labelSmall
                                      ?.copyWith(color: AppTheme.danger),
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
                              child: _Figure(label: 'Received', value: receipt.amountReceived),
                            ),
                            const Spacer(),
                            if (!receipt.isVoid && receipt.balanceDue > 0)
                              _Figure(
                                label: 'Still due',
                                value: receipt.balanceDue,
                                strong: true,
                              )
                            else if (!receipt.isVoid)
                              const Text(
                                'Covers it in full',
                                style: TextStyle(
                                  color: AppTheme.vacant,
                                  fontWeight: FontWeight.w700,
                                  fontSize: 13,
                                ),
                              ),
                          ],
                        ),
                        if (receipt.isVoid && receipt.voidReason != null) ...[
                          const SizedBox(height: AppTheme.s4),
                          Text(
                            'Voided: ${receipt.voidReason}',
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

// ── Search + card/spreadsheet toggle ───────────────────────────────────────

/// The search box and cards/table toggle shared by every billing queue —
/// mirrors the same row in AssetsListPanel, reused here (and by
/// EventBillingScreen) so room, food and event billing all search and
/// switch views the same way.
class BillingSearchAndViewToggle extends StatelessWidget {
  final TextEditingController controller;
  final String view;
  final ValueChanged<String> onViewChanged;
  final VoidCallback onSearchChanged;
  final String hint;

  const BillingSearchAndViewToggle({
    super.key,
    required this.controller,
    required this.view,
    required this.onViewChanged,
    required this.onSearchChanged,
    this.hint = 'Search guest, room, bill no.',
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Container(
            height: 48,
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s4),
            decoration: BoxDecoration(
              color: AppTheme.card,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: AppTheme.border),
              boxShadow: AppTheme.subtle,
            ),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppTheme.accent.withValues(alpha: 0.10),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.search_rounded, size: 17, color: AppTheme.accent),
                ),
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: TextField(
                    controller: controller,
                    onChanged: (_) => onSearchChanged(),
                    style: const TextStyle(color: AppTheme.heading, fontSize: 14),
                    decoration: InputDecoration(
                      hintText: hint,
                      hintStyle: const TextStyle(color: AppTheme.muted, fontSize: 14),
                      border: InputBorder.none,
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(vertical: 13),
                    ),
                  ),
                ),
                if (controller.text.isNotEmpty)
                  GestureDetector(
                    onTap: () {
                      controller.clear();
                      onSearchChanged();
                    },
                    behavior: HitTestBehavior.opaque,
                    child: Container(
                      width: 30,
                      height: 30,
                      margin: const EdgeInsets.only(right: 2),
                      alignment: Alignment.center,
                      decoration: const BoxDecoration(color: AppTheme.bg, shape: BoxShape.circle),
                      child: const Icon(Icons.close_rounded, size: 15, color: AppTheme.muted),
                    ),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(width: AppTheme.s8),
        _BillingViewToggleButton(view: view, onSelect: onViewChanged),
      ],
    );
  }
}

/// The range a Bills tab filter key stands for, as of right now — 'all'
/// means no bounds, everything else mirrors BILL_DATE_PRESETS in
/// Billing.jsx. Shared so the screen can compute it once and hand the same
/// pair to both the filter row's checkmarks and the list's own filtering.
(DateTime?, DateTime?) billingDatePresetRange(String key) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  return switch (key) {
    'today' => (today, today),
    'month' => (DateTime(now.year, now.month, 1), today),
    'year' => (DateTime(now.year, 1, 1), today),
    _ => (null, null),
  };
}

/// Whether a document's own date falls inside [from, to] — both ends
/// inclusive, and no filter at all when both are null (the "All time" case,
/// and the starting state before anything is picked).
bool matchesBillingDateRange(String? createdAt, DateTime? from, DateTime? to) {
  if (from == null && to == null) return true;
  final created = DateTime.tryParse(createdAt ?? '');
  if (created == null) return false;
  final day = DateTime(created.year, created.month, created.day);
  if (from != null && day.isBefore(from)) return false;
  if (to != null && day.isAfter(to)) return false;
  return true;
}

/// The Bills tab's own date range — a From/To pair always visible, same as
/// the web's own always-on date inputs, with a filter icon offering the
/// common shortcuts (BILL_DATE_PRESETS in Billing.jsx) instead of hunting for
/// two dates by hand.
class BillingDateFilterRow extends StatelessWidget {
  final String filterKey;
  final DateTime? from;
  final DateTime? to;
  final ValueChanged<String> onPresetSelected;
  final ValueChanged<DateTime?> onFromChanged;
  final ValueChanged<DateTime?> onToChanged;

  const BillingDateFilterRow({
    super.key,
    required this.filterKey,
    required this.from,
    required this.to,
    required this.onPresetSelected,
    required this.onFromChanged,
    required this.onToChanged,
  });

  static const _presets = [
    ('all', 'All time'),
    ('today', 'Today'),
    ('month', 'This month'),
    ('year', 'This year'),
  ];

  Future<void> _pick(
    BuildContext context,
    DateTime? initial,
    ValueChanged<DateTime?> onChanged,
  ) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: initial ?? now,
      firstDate: DateTime(now.year - 5),
      lastDate: now,
    );
    if (picked != null) onChanged(picked);
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: _DateField(
            label: 'From',
            value: from,
            onTap: () => _pick(context, from, onFromChanged),
          ),
        ),
        const SizedBox(width: AppTheme.s8),
        Expanded(
          child: _DateField(
            label: 'To',
            value: to,
            onTap: () => _pick(context, to, onToChanged),
          ),
        ),
        const SizedBox(width: AppTheme.s8),
        PopupMenuButton<String>(
          tooltip: 'Date range',
          onSelected: onPresetSelected,
          padding: EdgeInsets.zero,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.rSmall),
            side: const BorderSide(color: AppTheme.border),
          ),
          itemBuilder: (context) => [
            for (final (key, label) in _presets)
              CheckedPopupMenuItem(
                value: key,
                checked: filterKey == key,
                child: Text(label),
              ),
          ],
          child: Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: filterKey == 'all' ? AppTheme.card : AppTheme.accent,
              borderRadius: BorderRadius.circular(AppTheme.rSmall),
              border: Border.all(
                color: filterKey == 'all' ? AppTheme.border : AppTheme.accent,
              ),
            ),
            child: Icon(
              Icons.filter_list_rounded,
              size: 19,
              color: filterKey == 'all' ? AppTheme.muted : Colors.white,
            ),
          ),
        ),
      ],
    );
  }
}

class _DateField extends StatelessWidget {
  final String label;
  final DateTime? value;
  final VoidCallback onTap;

  const _DateField({required this.label, required this.value, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final v = value;
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        height: 44,
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8),
        decoration: BoxDecoration(
          color: AppTheme.card,
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          border: Border.all(color: AppTheme.border),
        ),
        child: Row(
          children: [
            const Icon(Icons.calendar_today_rounded, size: 14, color: AppTheme.muted),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                v != null ? formatIsoDate(v.toIso8601String()) : label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: v != null ? AppTheme.heading : AppTheme.muted,
                  fontSize: 12.5,
                  fontWeight: v != null ? FontWeight.w600 : FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BillingViewToggleButton extends StatelessWidget {
  final String view;
  final ValueChanged<String> onSelect;

  const _BillingViewToggleButton({required this.view, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    Widget seg(String v, IconData icon) {
      final isSelected = v == view;
      return GestureDetector(
        onTap: () => onSelect(v),
        behavior: HitTestBehavior.opaque,
        child: Container(
          width: 40,
          height: 40,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: isSelected ? AppTheme.accent : Colors.transparent,
            borderRadius: BorderRadius.circular(AppTheme.rSmall - 2),
          ),
          child: Icon(icon, size: 19, color: isSelected ? Colors.white : AppTheme.muted),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          seg('cards', Icons.view_agenda_outlined),
          seg('table', Icons.table_rows_outlined),
        ],
      ),
    );
  }
}

// ── Queue, as a spreadsheet ─────────────────────────────────────────────────

/// The same shape [BillingRowCard] takes, pulled out so a queue — room,
/// food, or (from EventBillingScreen) function — can be filtered once and
/// then rendered as either cards or a table from the one list.
class BillingQueueRow {
  final IconData? icon;
  final String? roomLabel;
  final String title;
  final String subtitle;
  final num? amount;
  final String? amountLabel;
  final VoidCallback onTap;

  const BillingQueueRow({
    this.icon,
    this.roomLabel,
    required this.title,
    required this.subtitle,
    required this.amount,
    this.amountLabel,
    required this.onTap,
  });
}

class _QueueTableColumn {
  final String key;
  final String label;
  final double width;

  const _QueueTableColumn(this.key, this.label, {this.width = 120});
}

const _kQueueTableColumns = [
  _QueueTableColumn('label', 'Room / Item', width: 100),
  _QueueTableColumn('title', 'Guest / Details', width: 170),
  _QueueTableColumn('subtitle', 'Info', width: 200),
  _QueueTableColumn('amount', 'Amount', width: 110),
];

/// The sheet-style view of a billing queue — mirrors [_AssetTable] in
/// AssetsListPanel: a scrollable grid instead of one card per row, handy for
/// scanning every room/table due for a bill at once.
class BillingQueueTable extends StatelessWidget {
  final List<BillingQueueRow> rows;

  const BillingQueueTable({super.key, required this.rows});

  @override
  Widget build(BuildContext context) {
    final width = _kQueueTableColumns.fold<double>(0, (sum, c) => sum + c.width);

    return NeuCard(
      padding: EdgeInsets.zero,
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: width,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  decoration: const BoxDecoration(
                    color: AppTheme.bg,
                    border: Border(bottom: BorderSide(color: AppTheme.border, width: 0.8)),
                  ),
                  child: Row(
                    children: [
                      for (final c in _kQueueTableColumns)
                        SizedBox(
                          width: c.width,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
                            child: Text(
                              c.label.toUpperCase(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.3),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                for (var i = 0; i < rows.length; i++)
                  _QueueTableRow(row: rows[i], shaded: i.isOdd),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _QueueTableRow extends StatelessWidget {
  final BillingQueueRow row;
  final bool shaded;

  const _QueueTableRow({required this.row, required this.shaded});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: row.onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        decoration: BoxDecoration(
          color: shaded ? AppTheme.border.withValues(alpha: 0.25) : AppTheme.card,
          border: const Border(bottom: BorderSide(color: AppTheme.border, width: 0.8)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            for (final c in _kQueueTableColumns)
              SizedBox(
                width: c.width,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
                  child: switch (c.key) {
                    'label' => row.roomLabel != null
                        ? Text(
                            'Room ${row.roomLabel}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: AppTheme.accent, fontSize: 12.5, fontWeight: FontWeight.w700),
                          )
                        : Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (row.icon != null) Icon(row.icon, size: 15, color: AppTheme.accent),
                            ],
                          ),
                    'title' => Text(
                        row.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppTheme.heading, fontSize: 12.5, fontWeight: FontWeight.w600),
                      ),
                    'subtitle' => Text(
                        row.subtitle,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppTheme.text, fontSize: 12),
                      ),
                    'amount' => Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (row.amountLabel != null)
                            Text(row.amountLabel!, style: const TextStyle(color: AppTheme.muted, fontSize: 10)),
                          Text(
                            formatPrice(row.amount),
                            style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13),
                          ),
                        ],
                      ),
                    _ => const SizedBox.shrink(),
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ── Bills, as a spreadsheet ──────────────────────────────────────────────────

class _InvoiceTableColumn {
  final String key;
  final String label;
  final double width;

  const _InvoiceTableColumn(this.key, this.label, {this.width = 110});
}

// Same eight columns, same order, as the web's own history-table in
// Billing.jsx — "Bill no. / Date / Billed for / Guest · Table / Room /
// Document / Status / Amount" — so the sheet view reads as one screen
// whether it's opened on the desk's laptop or a phone.
const _kInvoiceTableColumns = [
  _InvoiceTableColumn('no', 'Bill no.', width: 90),
  _InvoiceTableColumn('date', 'Date', width: 96),
  _InvoiceTableColumn('billedFor', 'Billed for', width: 150),
  _InvoiceTableColumn('guest', 'Guest / Table', width: 140),
  _InvoiceTableColumn('room', 'Room', width: 70),
  _InvoiceTableColumn('document', 'Document', width: 130),
  _InvoiceTableColumn('status', 'Status', width: 90),
  _InvoiceTableColumn('amount', 'Amount', width: 100),
];

// What was sold — mirrors billSource()/SOURCE_LABEL in Billing.jsx: a room
// stay, a room that also carries food, a dining table, a function, or an
// advance taken against one of those.
String _billSource(BillDocument doc) {
  if (doc.kind == 'ADVANCE') return 'ADVANCE';
  if (doc.kind == 'EVENT') return 'EVENT';
  if (doc.kind == 'FOOD') {
    return (doc.tableLabel ?? '').startsWith('Room') ? 'ROOM' : 'TABLE';
  }
  return doc.foodSubtotal > 0 ? 'ROOM_FOOD' : 'ROOM';
}

const _kBillSourceLabel = {
  'ROOM': 'Room',
  'ROOM_FOOD': 'Room + food',
  'TABLE': 'Table',
  'EVENT': 'Function',
  'ADVANCE': 'Advance',
};

String _billSourceLabel(BillDocument doc) {
  final base = _kBillSourceLabel[_billSource(doc)] ?? '';
  return doc.isDormitory ? '$base · Dormitory' : base;
}

Color _billSourceColor(String source) => switch (source) {
  'ADVANCE' => AppTheme.vacant,
  'EVENT' => AppTheme.sidebarBrand,
  'TABLE' => AppTheme.checkout,
  _ => AppTheme.accent,
};

Color _documentTagColor(String? documentType) => switch (documentType) {
  'TAX_INVOICE' => AppTheme.vacant,
  'BILL_OF_SUPPLY' => AppTheme.muted,
  'CASH_RECEIPT' => AppTheme.checkedIn,
  'RECEIPT_VOUCHER' || 'ADVANCE_RECEIPT' => AppTheme.edit,
  _ => AppTheme.muted,
};

/// The sheet-style view of the issued bills — same grid shape as
/// [BillingQueueTable], one row per invoice or advance receipt.
class BillingInvoiceTable extends StatelessWidget {
  final List<BillDocument> documents;

  const BillingInvoiceTable({super.key, required this.documents});

  @override
  Widget build(BuildContext context) {
    final width = _kInvoiceTableColumns.fold<double>(0, (sum, c) => sum + c.width);

    return NeuCard(
      padding: EdgeInsets.zero,
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: width,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  decoration: const BoxDecoration(
                    color: AppTheme.bg,
                    border: Border(bottom: BorderSide(color: AppTheme.border, width: 0.8)),
                  ),
                  child: Row(
                    children: [
                      for (final c in _kInvoiceTableColumns)
                        SizedBox(
                          width: c.width,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
                            child: Text(
                              c.label.toUpperCase(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.3),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                for (var i = 0; i < documents.length; i++)
                  _InvoiceTableRow(document: documents[i], shaded: i.isOdd),
                _InvoiceTableFooter(documents: documents),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// "N documents (void bills not counted)", and the total they add up to —
/// mirrors the web's own `<tfoot>` row in Billing.jsx exactly, voids left out
/// of the sum the same way they're left out of the count.
class _InvoiceTableFooter extends StatelessWidget {
  final List<BillDocument> documents;

  const _InvoiceTableFooter({required this.documents});

  @override
  Widget build(BuildContext context) {
    final total = documents.fold<num>(
      0,
      (sum, d) => d.isVoid ? sum : sum + d.totalAmount,
    );
    final labelWidth = _kInvoiceTableColumns
        .where((c) => c.key != 'amount')
        .fold<double>(0, (sum, c) => sum + c.width);
    final amountWidth = _kInvoiceTableColumns
        .firstWhere((c) => c.key == 'amount')
        .width;

    return Container(
      decoration: const BoxDecoration(
        color: AppTheme.bg,
        border: Border(top: BorderSide(color: AppTheme.border, width: 0.8)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SizedBox(
            width: labelWidth,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
              child: Text(
                '${documents.length} document${documents.length == 1 ? '' : 's'} '
                '(void bills not counted)',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
              ),
            ),
          ),
          SizedBox(
            width: amountWidth,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
              child: Text(
                formatPrice(total),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.right,
                style: const TextStyle(color: AppTheme.heading, fontSize: 12.5, fontWeight: FontWeight.w700),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InvoiceTableRow extends StatelessWidget {
  final BillDocument document;
  final bool shaded;

  const _InvoiceTableRow({required this.document, required this.shaded});

  @override
  Widget build(BuildContext context) {
    final source = _billSource(document);
    // Guest / Table — a food bill names its table (or Counter), a function
    // bill its guest and venue together, everything else just the guest.
    final guestOrTable = document.kind == 'FOOD'
        ? (document.tableLabel ?? 'Counter')
        : document.kind == 'EVENT'
            ? [document.guestName, document.venueName ?? 'Function']
                .whereType<String>()
                .where((s) => s.isNotEmpty)
                .join(' · ')
            : (document.guestName ?? '—');
    // Room — blank for a table or a function, same as the web's own column.
    final room = document.kind == 'FOOD' || document.kind == 'EVENT'
        ? '—'
        : (document.roomNumber ?? '—');

    Widget tag(String label, Color color) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: color, fontSize: 10.5, fontWeight: FontWeight.w700),
      ),
    );

    return GestureDetector(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => document.isReceipt
              ? AdvanceReceiptScreen(receipt: document.receipt!)
              : InvoicePreviewScreen(invoice: document.invoice!),
        ),
      ),
      behavior: HitTestBehavior.opaque,
      child: Container(
        decoration: BoxDecoration(
          color: shaded ? AppTheme.border.withValues(alpha: 0.25) : AppTheme.card,
          border: const Border(bottom: BorderSide(color: AppTheme.border, width: 0.8)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            for (final c in _kInvoiceTableColumns)
              SizedBox(
                width: c.width,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
                  child: switch (c.key) {
                    'no' => Text(
                        document.invoiceNumber ?? '—',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppTheme.heading, fontSize: 12, fontWeight: FontWeight.w700),
                      ),
                    'date' => Text(
                        formatIsoDate(document.createdAt),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                      ),
                    'billedFor' => Align(
                        alignment: Alignment.centerLeft,
                        child: tag(_billSourceLabel(document), _billSourceColor(source)),
                      ),
                    'guest' => Text(
                        guestOrTable,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppTheme.text, fontSize: 12),
                      ),
                    'room' => Text(
                        room,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppTheme.heading, fontSize: 12, fontWeight: FontWeight.w600),
                      ),
                    'document' => Align(
                        alignment: Alignment.centerLeft,
                        child: tag(
                          kDocumentLabels[document.documentType] ?? 'Bill',
                          _documentTagColor(document.documentType),
                        ),
                      ),
                    // Only a receipt ever carries a balance still due — an
                    // issued invoice is itself the document that settles one.
                    'status' => document.isVoid
                        ? tag('Void', AppTheme.danger)
                        : (document.dueAfter > 0
                            ? Text(
                                '${formatPrice(document.dueAfter)} due',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(color: AppTheme.checkout, fontSize: 12, fontWeight: FontWeight.w700),
                              )
                            : tag('Issued', AppTheme.vacant)),
                    'amount' => Text(
                        formatPrice(document.totalAmount),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.right,
                        style: const TextStyle(color: AppTheme.heading, fontSize: 12.5, fontWeight: FontWeight.w700),
                      ),
                    _ => const SizedBox.shrink(),
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}
