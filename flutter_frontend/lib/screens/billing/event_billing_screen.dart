import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/event_booking.dart';
import '../../domain/models/invoice.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/billing_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/pill_tabs.dart';
import '../theme.dart';
import 'billing_screen.dart'
    show
        BillingDateFilterRow,
        BillingInvoiceCard,
        BillingInvoiceTable,
        BillingSearchAndViewToggle,
        billingDatePresetRange,
        matchesBillingDateRange;
import 'issue_event_bill_screen.dart';
import 'numbering_screen.dart';

enum _EventBillingTab { ready, issued, numbering }

/// Event billing — the Events group's own billing row (mirrors the web's
/// `<Billing stream="event" />`, OwnerDashboard.jsx): Ready to bill, Bills,
/// and Numbering — the same three tabs stream="event" renders there
/// (`/billing/event-queue` feeds "Ready to bill" there too).
class EventBillingScreen extends ConsumerStatefulWidget {
  const EventBillingScreen({super.key});

  @override
  ConsumerState<EventBillingScreen> createState() => _EventBillingScreenState();
}

class _EventBillingScreenState extends ConsumerState<EventBillingScreen> {
  // Lands on "Ready to bill" — mirrors the web's own
  // `defaultTab = billsEvents ? 'functions' : 'bills'` for this stream.
  _EventBillingTab _tab = _EventBillingTab.ready;

  final _search = TextEditingController();

  // Lists land on the spreadsheet view — mirrors the web's own
  // `useState('sheet')` in Billing.jsx.
  String _view = 'table';

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
    final billing = ref.watch(billingViewModelProvider);

    final toggle = _Toggle(
      tab: _tab,
      readyCount: billing.eventQueue.valueOrNull?.length,
      onChanged: (v) => setState(() => _tab = v),
    );

    if (_tab == _EventBillingTab.numbering) {
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
            hint: 'Search function, venue, organiser',
          ),
          const SizedBox(height: AppTheme.s12),
          if (_tab == _EventBillingTab.issued) ...[
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
          if (_tab == _EventBillingTab.ready) ..._ready(billing),
          if (_tab == _EventBillingTab.issued) ..._issued(billing),
        ],
      ),
    );
  }

  // ── Ready to bill ────────────────────────────────────────────────────────

  List<Widget> _ready(BillingState state) => state.eventQueue.when(
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
          : allRows
                .where(
                  (ev) =>
                      ev.title.toLowerCase().contains(needle) ||
                      ev.organiserName.toLowerCase().contains(needle) ||
                      ev.venueName.toLowerCase().contains(needle),
                )
                .toList();
      if (rows.isEmpty) {
        return const [
          SizedBox(height: 80),
          NeuNotice(
            icon: Icons.task_alt_rounded,
            message: 'Nothing waiting to be billed.',
          ),
        ];
      }
      Future<void> openEvent(EventBooking ev) async {
        await ref.read(billingViewModelProvider.notifier).openEvent(ev);
        if (!mounted) return;
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const IssueEventBillScreen()),
        );
        if (!mounted) return;
        await _load();
      }

      if (_view == 'table') {
        return [EventReadyToBillTable(events: rows, onBill: openEvent)];
      }
      return [
        for (final ev in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s4 + 2),
            child: EventReadyToBillCard(event: ev, onBill: () => openEvent(ev)),
          ),
      ];
    },
  );

  // ── Issued ────────────────────────────────────────────────────────────────

  List<Widget> _issued(BillingState state) {
    if (state.invoices.isLoading || state.advanceReceipts.isLoading) {
      return const [
        SizedBox(height: 120),
        Center(child: CircularProgressIndicator()),
      ];
    }
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
      for (final r in receipts ?? const <AdvanceReceipt>[]) BillDocument.ofReceipt(r),
    ];
    // Same split as the web's own streamOf(): only a function's own bills —
    // or a receipt taken against one — belong here, the same way Restaurant
    // billing's issued list keeps out everything but FOOD-kind ones.
    final streamRows = allRows.where((d) => d.isEventBill).toList();
    final needle = _search.text.trim().toLowerCase();
    final searched = needle.isEmpty
        ? streamRows
        : streamRows.where((d) =>
            (d.invoiceNumber ?? '').toLowerCase().contains(needle) ||
            (d.guestName ?? '').toLowerCase().contains(needle) ||
            (d.venueName ?? '').toLowerCase().contains(needle)).toList();
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

// ── Which list ──────────────────────────────────────────────────────────────

class _Toggle extends StatelessWidget {
  final _EventBillingTab tab;
  final int? readyCount;
  final ValueChanged<_EventBillingTab> onChanged;

  const _Toggle({
    required this.tab,
    this.readyCount,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return PillTabs(
      selected: tab.name,
      onSelect: (k) => onChanged(_EventBillingTab.values.byName(k)),
      tabs: [
        PillTab('ready', 'Ready to bill', Icons.pending_actions_rounded, count: readyCount),
        const PillTab('issued', 'Bills', Icons.receipt_long_rounded),
        const PillTab('numbering', 'Numbering', Icons.pin_rounded),
      ],
    );
  }
}

// ── Ready to bill, as a spreadsheet ─────────────────────────────────────────

/// A function's own columns — mirrors the web's `billing-sheet__ready` table
/// for `stream="event"` in Billing.jsx: Function / Organiser / Venue / Date /
/// Guests / Total / Advance paid / To collect, with a tinted header and a
/// totals footer — the same shape [ReadyToBillTable] gives stays, but a
/// function has no room/stay pair to show instead.
class EventReadyToBillTable extends StatelessWidget {
  final List<EventBooking> events;
  final ValueChanged<EventBooking> onBill;

  const EventReadyToBillTable({
    super.key,
    required this.events,
    required this.onBill,
  });

  static const List<(String label, double width, bool numeric)> _columns = [
    ('Function', 150, false),
    ('Organiser', 130, false),
    ('Venue', 90, false),
    ('Date', 100, false),
    ('Guests', 70, true),
    ('Total', 100, true),
    ('Advance paid', 110, true),
    ('To collect', 110, true),
  ];

  static const double _actionWidth = 76;

  @override
  Widget build(BuildContext context) {
    final width =
        _columns.fold<double>(0, (sum, c) => sum + c.$2) + _actionWidth;

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
                    color: AppTheme.sidebarBrandWash,
                    border: Border(
                      bottom: BorderSide(
                        color: AppTheme.sidebarBrandWashEdge,
                        width: 0.8,
                      ),
                    ),
                  ),
                  child: Row(
                    children: [
                      for (final c in _columns)
                        SizedBox(
                          width: c.$2,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: AppTheme.s8,
                              vertical: 10,
                            ),
                            child: Text(
                              c.$1.toUpperCase(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              textAlign: c.$3
                                  ? TextAlign.right
                                  : TextAlign.left,
                              style: const TextStyle(
                                color: AppTheme.sidebarBrandInk,
                                fontSize: 10.5,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 0.3,
                              ),
                            ),
                          ),
                        ),
                      SizedBox(width: _actionWidth),
                    ],
                  ),
                ),
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.sizeOf(context).height * 0.6,
                  ),
                  child: ListView(
                    shrinkWrap: true,
                    padding: EdgeInsets.zero,
                    children: [
                      for (var i = 0; i < events.length; i++)
                        _EventReadyToBillRow(
                          event: events[i],
                          shaded: i.isOdd,
                          onBill: () => onBill(events[i]),
                        ),
                      _EventReadyToBillFooter(events: events),
                    ],
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

class _EventReadyToBillRow extends StatelessWidget {
  final EventBooking event;
  final bool shaded;
  final VoidCallback onBill;

  const _EventReadyToBillRow({
    required this.event,
    required this.shaded,
    required this.onBill,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: shaded ? AppTheme.border.withValues(alpha: 0.25) : AppTheme.card,
        border: const Border(
          bottom: BorderSide(color: AppTheme.border, width: 0.8),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SizedBox(
            width: 150,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.s8,
                vertical: 10,
              ),
              child: Text(
                event.title.isEmpty ? 'Function' : event.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
          SizedBox(
            width: 130,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.s8,
                vertical: 8,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    event.organiserName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppTheme.text,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (event.organiserPhone.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      event.organiserPhone,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppTheme.muted, fontSize: 10),
                    ),
                  ],
                ],
              ),
            ),
          ),
          SizedBox(
            width: 90,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.s8,
                vertical: 10,
              ),
              child: Text(
                event.venueName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: AppTheme.text, fontSize: 12),
              ),
            ),
          ),
          SizedBox(
            width: 100,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.s8,
                vertical: 10,
              ),
              child: Text(
                formatIsoDate(event.startAt),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: AppTheme.text, fontSize: 11.5),
              ),
            ),
          ),
          _numCell(70, '${event.billablePax}'),
          _numCell(100, formatPrice(event.totalAmount), bold: true, color: AppTheme.heading),
          _numCell(
            110,
            event.advanceAmount > 0 ? '− ${formatPrice(event.advanceAmount)}' : '—',
            color: AppTheme.muted,
          ),
          _numCell(
            110,
            formatPrice(event.balanceDue),
            bold: true,
            color: AppTheme.accent,
            fontSize: 13.5,
          ),
          SizedBox(
            width: EventReadyToBillTable._actionWidth,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8),
              child: _EventBillPillButton(onPressed: onBill),
            ),
          ),
        ],
      ),
    );
  }

  Widget _numCell(
    double width,
    String text, {
    bool bold = false,
    Color color = AppTheme.text,
    double fontSize = 12.5,
  }) {
    return SizedBox(
      width: width,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.s8,
          vertical: 10,
        ),
        child: Text(
          text,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.right,
          style: TextStyle(
            color: color,
            fontSize: fontSize,
            fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

/// Same solid-gradient "Bill" pill [ReadyToBillTable] ends each row on.
class _EventBillPillButton extends StatelessWidget {
  final VoidCallback onPressed;

  const _EventBillPillButton({required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [AppTheme.accent, AppTheme.sidebarBrand],
            ),
            borderRadius: BorderRadius.circular(999),
            boxShadow: [
              BoxShadow(
                color: AppTheme.accent.withValues(alpha: 0.3),
                blurRadius: 6,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: const Text(
            'Bill',
            style: TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}

/// "N function(s) to bill", and the same two sums as the web's own
/// `<tfoot>` — the advance taken and the total still to collect.
class _EventReadyToBillFooter extends StatelessWidget {
  final List<EventBooking> events;

  const _EventReadyToBillFooter({required this.events});

  @override
  Widget build(BuildContext context) {
    num sumOf(num Function(EventBooking) f) =>
        events.fold<num>(0, (sum, e) => sum + f(e));
    final advanceTotal = sumOf((e) => e.advanceAmount);

    Widget cell(double width, String text, {bool strong = false}) => SizedBox(
      width: width,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.s8,
          vertical: 10,
        ),
        child: Text(
          text,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.right,
          style: TextStyle(
            color: AppTheme.heading,
            fontSize: strong ? 13 : 12,
            fontWeight: strong ? FontWeight.w800 : FontWeight.w600,
          ),
        ),
      ),
    );

    return Container(
      decoration: const BoxDecoration(
        color: AppTheme.bg,
        border: Border(top: BorderSide(color: AppTheme.border, width: 0.8)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SizedBox(
            width: 150 + 130 + 90 + 100,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.s8,
                vertical: 10,
              ),
              child: Text(
                '${events.length} function${events.length == 1 ? '' : 's'} to bill',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
          cell(70, ''),
          cell(100, formatPrice(sumOf((e) => e.totalAmount)), strong: true),
          cell(110, advanceTotal > 0 ? '− ${formatPrice(advanceTotal)}' : '—'),
          cell(110, formatPrice(sumOf((e) => e.balanceDue)), strong: true),
          SizedBox(width: EventReadyToBillTable._actionWidth),
        ],
      ),
    );
  }
}

// ── Ready to bill, as a card ────────────────────────────────────────────────

/// The mobile-friendly read of one [_EventReadyToBillRow] — same information,
/// stacked instead of columned, for the cards view of the queue.
class EventReadyToBillCard extends StatelessWidget {
  final EventBooking event;
  final VoidCallback onBill;

  const EventReadyToBillCard({
    super.key,
    required this.event,
    required this.onBill,
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
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppTheme.s12,
          AppTheme.s8 + 2,
          AppTheme.s12,
          AppTheme.s8,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
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
                        AppTheme.accent.withValues(alpha: 0.85),
                        AppTheme.sidebarBrand.withValues(alpha: 0.85),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: const Icon(
                    Icons.celebration_rounded,
                    color: Colors.white,
                    size: 15,
                  ),
                ),
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        event.title.isEmpty ? 'Function' : event.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppTheme.heading,
                          fontSize: 13.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        [
                          event.organiserName,
                          event.venueName,
                          formatIsoDate(event.startAt),
                          '${event.billablePax} guests',
                          if (event.unpricedExtras > 0)
                            '${event.unpricedExtras} extra(s) still to price',
                        ].where((s) => s.isNotEmpty).join(' · '),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppTheme.s8),
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'TO COLLECT',
                        style: TextStyle(
                          color: AppTheme.muted,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.3,
                        ),
                      ),
                      Text(
                        formatPrice(event.balanceDue),
                        style: const TextStyle(
                          color: AppTheme.accent,
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
                _EventBillPillButton(onPressed: onBill),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
