import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/billing_viewmodel.dart';
import '../../presentation/view_models/events_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'billing_screen.dart' show BillingInvoiceCard, BillingRowCard;
import 'issue_event_bill_screen.dart';

enum _EventBillingTab { toBill, issued }

/// Event billing — the Events group's own billing row (mirrors the web's
/// `<Billing stream="event" />`, OwnerDashboard.jsx): every confirmed
/// function still to be settled, and the bills already issued for one.
///
/// A third stream alongside room and restaurant billing rather than a tab
/// bolted onto [BillingScreen] — the queue here comes from the events
/// catalogue (confirmed functions), not from [BillingViewModel.queue], so it
/// reads its own provider for the "to bill" list and only borrows
/// [BillingViewModel] for opening a function's bill and for the issued list,
/// the same shared machinery the event detail screen's "Settle & bill"
/// already uses.
class EventBillingScreen extends ConsumerStatefulWidget {
  const EventBillingScreen({super.key});

  @override
  ConsumerState<EventBillingScreen> createState() => _EventBillingScreenState();
}

class _EventBillingScreenState extends ConsumerState<EventBillingScreen> {
  _EventBillingTab _tab = _EventBillingTab.toBill;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() => Future.wait([
    ref.read(eventsViewModelProvider.notifier).loadEvents(status: 'CONFIRMED'),
    ref.read(billingViewModelProvider.notifier).load(),
  ]);

  @override
  Widget build(BuildContext context) {
    final events = ref.watch(eventsViewModelProvider);
    final billing = ref.watch(billingViewModelProvider);

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
          _Toggle(
            tab: _tab,
            toBillCount: events.isLoading ? null : events.events.length,
            onChanged: (v) => setState(() => _tab = v),
          ),
          const SizedBox(height: AppTheme.s12),
          if (_tab == _EventBillingTab.toBill)
            ..._queue(events)
          else
            ..._issued(billing),
        ],
      ),
    );
  }

  // ── Ready to bill ────────────────────────────────────────────────────────

  List<Widget> _queue(EventsState state) {
    if (state.isLoading && state.events.isEmpty) {
      return const [
        SizedBox(height: 120),
        Center(child: CircularProgressIndicator()),
      ];
    }
    if (state.error != null && state.events.isEmpty) {
      return [
        NeuNotice(
          icon: Icons.cloud_off_rounded,
          message: state.error!,
          action: NeuButton(onPressed: _load, child: const Text('Try again')),
        ),
      ];
    }
    // The server itself only returns CONFIRMED rows for this query — nothing
    // still an enquiry/hold, and nothing already settled or cancelled.
    final rows = state.events;
    if (rows.isEmpty) {
      return const [
        SizedBox(height: 80),
        NeuNotice(
          icon: Icons.task_alt_rounded,
          message: 'Nothing waiting to be billed.',
        ),
      ];
    }
    return [
      for (final event in rows)
        Padding(
          padding: const EdgeInsets.only(bottom: AppTheme.s4 + 2),
          child: BillingRowCard(
            icon: Icons.celebration_outlined,
            title: event.title.isNotEmpty ? event.title : event.venueName,
            subtitle: [
              event.venueName,
              event.organiserName,
              'Total ${formatPrice(event.totalAmount)}',
            ].where((s) => s.isNotEmpty).join(' · '),
            amount: event.balanceDue,
            amountLabel: 'To collect',
            onTap: () async {
              await ref.read(billingViewModelProvider.notifier).openEvent(event);
              if (!mounted) return;
              await Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const IssueEventBillScreen()),
              );
              if (!mounted) return;
              await _load();
            },
          ),
        ),
    ];
  }

  // ── Issued ────────────────────────────────────────────────────────────────

  List<Widget> _issued(BillingState state) => state.invoices.when(
    loading: () => const [
      SizedBox(height: 120),
      Center(child: CircularProgressIndicator()),
    ],
    error: (e, _) => [
      NeuNotice(
        icon: Icons.cloud_off_rounded,
        message: 'Could not load the bills.',
        action: NeuButton(onPressed: _load, child: const Text('Try again')),
      ),
    ],
    data: (allRows) {
      // Same split as the web's own streamOf(): only a function's own bills
      // belong here, the same way Restaurant billing's issued list keeps out
      // everything but FOOD-kind ones.
      final rows = allRows.where((inv) => inv.isEventBill).toList();
      if (rows.isEmpty) {
        return const [
          SizedBox(height: 80),
          NeuNotice(
            icon: Icons.receipt_long_rounded,
            message: 'No bills issued yet.',
          ),
        ];
      }
      return [
        for (final invoice in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s4 + 2),
            child: BillingInvoiceCard(invoice: invoice),
          ),
      ];
    },
  );
}

// ── Which list ──────────────────────────────────────────────────────────────

/// Same sliding-pill segmented control [BillingScreen]'s own toggle uses —
/// just the two segments this stream has, since a function is never a food
/// tab.
class _Toggle extends StatelessWidget {
  final _EventBillingTab tab;
  final int? toBillCount;
  final ValueChanged<_EventBillingTab> onChanged;

  const _Toggle({
    required this.tab,
    required this.toBillCount,
    required this.onChanged,
  });

  static const double _height = 40;

  @override
  Widget build(BuildContext context) {
    final segments = [
      (
        tab: _EventBillingTab.toBill,
        label: toBillCount == null
            ? 'Ready to bill'
            : 'Ready to bill ($toBillCount)',
      ),
      (tab: _EventBillingTab.issued, label: 'Bills'),
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
