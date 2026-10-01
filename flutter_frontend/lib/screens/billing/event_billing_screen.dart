import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/invoice.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/billing_viewmodel.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'billing_screen.dart'
    show
        BillingDateFilterRow,
        BillingInvoiceCard,
        BillingInvoiceTable,
        BillingSearchAndViewToggle,
        billingDatePresetRange,
        matchesBillingDateRange;
import 'numbering_screen.dart';

enum _EventBillingTab { issued, numbering }

/// Event billing — the Events group's own billing row (mirrors the web's
/// `<Billing stream="event" />`, OwnerDashboard.jsx): just Bills and
/// Numbering, the same two tabs stream="event" renders there. A function
/// still to be settled is reached from the event itself ("Settle & bill" on
/// event_detail_screen.dart), not from a queue tab here — the web never
/// renders one for this stream, so this screen doesn't invent one either.
class EventBillingScreen extends ConsumerStatefulWidget {
  const EventBillingScreen({super.key});

  @override
  ConsumerState<EventBillingScreen> createState() => _EventBillingScreenState();
}

class _EventBillingScreenState extends ConsumerState<EventBillingScreen> {
  _EventBillingTab _tab = _EventBillingTab.issued;

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
          ..._issued(billing),
        ],
      ),
    );
  }

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

/// Same sliding-pill segmented control [BillingScreen]'s own toggle uses —
/// just the two segments this stream has: Bills and Numbering, the same
/// pair stream="event" renders on the web.
class _Toggle extends StatelessWidget {
  final _EventBillingTab tab;
  final ValueChanged<_EventBillingTab> onChanged;

  const _Toggle({required this.tab, required this.onChanged});

  static const double _height = 40;

  @override
  Widget build(BuildContext context) {
    final segments = [
      (tab: _EventBillingTab.issued, label: 'Bills'),
      (tab: _EventBillingTab.numbering, label: 'Numbering'),
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
          AnimatedAlign(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            alignment: Alignment(-1 + (2 * slot) / (segments.length - 1), 0),
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
