import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/invoice.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'report_widgets.dart';

const List<(String, String, IconData)> _kBillTypeFilters = [
  ('ALL', 'All bills', Icons.apps_rounded),
  ('room', 'Room', Icons.hotel_rounded),
  ('restaurant', 'Restaurant', Icons.restaurant_rounded),
  ('event', 'Events', Icons.celebration_rounded),
];

/// Every issued bill in a period, as a spreadsheet — the register itself;
/// nothing here issues, voids or sends a bill. Mirrors the web's Reports >
/// Bills tab (BillsReport in Billing.jsx), filtered client-side off the same
/// `invoices()` list the Billing screen's own history reads.
class BillsReportPanel extends ConsumerStatefulWidget {
  final String fromDate;
  final String toDate;

  const BillsReportPanel({super.key, required this.fromDate, required this.toDate});

  @override
  ConsumerState<BillsReportPanel> createState() => _BillsReportPanelState();
}

class _BillsReportPanelState extends ConsumerState<BillsReportPanel> {
  String _type = 'ALL';
  String _search = '';
  final _searchController = TextEditingController();

  bool _filterOpen = false;
  final LayerLink _filterLink = LayerLink();
  final OverlayPortalController _filterPortalController = OverlayPortalController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _toggleFilterOpen() {
    setState(() => _filterOpen = !_filterOpen);
    if (_filterOpen) {
      _filterPortalController.show();
    } else {
      _filterPortalController.hide();
    }
  }

  void _selectType(String type) {
    setState(() => _type = type);
    _toggleFilterOpen();
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(reportsViewModelProvider).billsReport;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, 0, AppTheme.s16, AppTheme.s8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Container(
                  height: 48,
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s4),
                  decoration: BoxDecoration(
                    color: AppTheme.card,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: AppTheme.shadowDark, width: 1.3),
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
                          controller: _searchController,
                          style: const TextStyle(color: AppTheme.heading, fontSize: 14),
                          decoration: const InputDecoration(
                            hintText: 'Bill number, guest, room or table',
                            hintStyle: TextStyle(color: AppTheme.muted, fontSize: 14),
                            border: InputBorder.none,
                            isDense: true,
                            contentPadding: EdgeInsets.symmetric(vertical: 13),
                          ),
                          onChanged: (v) => setState(() => _search = v),
                        ),
                      ),
                      if (_search.isNotEmpty)
                        GestureDetector(
                          onTap: () {
                            _searchController.clear();
                            setState(() => _search = '');
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
              CompositedTransformTarget(
                link: _filterLink,
                child: OverlayPortal(
                  controller: _filterPortalController,
                  overlayChildBuilder: (context) => Stack(
                    children: [
                      Positioned.fill(
                        child: GestureDetector(
                          behavior: HitTestBehavior.translucent,
                          onTap: _toggleFilterOpen,
                        ),
                      ),
                      CompositedTransformFollower(
                        link: _filterLink,
                        showWhenUnlinked: false,
                        targetAnchor: Alignment.bottomRight,
                        followerAnchor: Alignment.topRight,
                        offset: const Offset(0, AppTheme.s8),
                        child: Align(
                          alignment: Alignment.topRight,
                          child: Material(
                            color: Colors.transparent,
                            child: _BillTypeChips(selected: _type, onSelect: _selectType),
                          ),
                        ),
                      ),
                    ],
                  ),
                  child: _BillTypeFilterButton(
                    selected: _type,
                    open: _filterOpen,
                    onTap: _toggleFilterOpen,
                  ),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s16, 0, AppTheme.s16, AppTheme.s32),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              switch (async) {
                null || AsyncLoading() => const ReportLoading(),
                AsyncError(:final error) => ReportError(message: error.toString()),
                AsyncData(:final value) => _Loaded(
                  invoices: value,
                  fromDate: widget.fromDate,
                  toDate: widget.toDate,
                  type: _type,
                  search: _search,
                ),
                _ => const SizedBox.shrink(),
              },
            ],
          ),
        ),
      ],
    );
  }
}

/// 'ROOM', 'ROOM_FOOD', 'TABLE', 'EVENT', 'ADVANCE' or 'SERVICE' — what a bill
/// was for, same split the web's billSource() makes.
String _billSource(Invoice inv) {
  if (inv.kind == 'EVENT') return 'EVENT';
  if (inv.kind == 'SERVICE') return 'SERVICE';
  if (inv.kind == 'FOOD') {
    return (inv.tableLabel ?? '').startsWith('Room') ? 'ROOM' : 'TABLE';
  }
  return 'ROOM';
}

const Map<String, String> _kSourceLabel = {
  'ROOM': 'Room',
  'TABLE': 'Table',
  'EVENT': 'Function',
  'ADVANCE': 'Advance',
  'SERVICE': 'Services',
};

/// 'room', 'restaurant' or 'event' — which filter chip a bill falls under.
String _streamOf(Invoice inv) {
  if (inv.kind == 'FOOD') return 'restaurant';
  if (inv.kind == 'EVENT') return 'event';
  return 'room';
}

bool _matchesSearch(Invoice inv, String needle) {
  if (needle.isEmpty) return true;
  final fields = [inv.invoiceNumber, inv.guestName, inv.roomNumber, inv.tableLabel, inv.guestPhone];
  return fields.any((f) => f != null && f.toLowerCase().contains(needle));
}

String _billParty(Invoice inv) {
  if (inv.kind == 'FOOD') return inv.tableLabel ?? 'Counter';
  if (inv.kind == 'EVENT') return '${inv.guestName} · ${inv.venueName ?? 'Function'}';
  return inv.guestName ?? '—';
}

const Map<String, String> _kDocumentLabel = {
  'TAX_INVOICE': 'Tax invoice',
  'BILL_OF_SUPPLY': 'Bill of supply',
  'CASH_RECEIPT': 'Cash receipt',
  'RECEIPT_VOUCHER': 'Receipt voucher',
  'ADVANCE_RECEIPT': 'Advance receipt',
};

class _Loaded extends StatelessWidget {
  final List<Invoice> invoices;
  final String fromDate;
  final String toDate;
  final String type;
  final String search;

  const _Loaded({
    required this.invoices,
    required this.fromDate,
    required this.toDate,
    required this.type,
    required this.search,
  });

  @override
  Widget build(BuildContext context) {
    final needle = search.trim().toLowerCase();
    final rows = invoices.where((inv) {
      final day = (inv.createdAt ?? '').isEmpty ? null : inv.createdAt!.substring(0, 10);
      final inRange = day == null || ((fromDate.isEmpty || day.compareTo(fromDate) >= 0) && (toDate.isEmpty || day.compareTo(toDate) <= 0));
      return inRange && (type == 'ALL' || _streamOf(inv) == type) && _matchesSearch(inv, needle);
    }).toList()
      ..sort((a, b) => (b.createdAt ?? '').compareTo(a.createdAt ?? ''));

    final live = rows.where((i) => i.status != 'VOID').toList();
    final total = live.fold<num>(0, (sum, i) => sum + i.totalAmount);

    if (rows.isEmpty) {
      return const NeuNotice(icon: Icons.receipt_long_outlined, message: 'No bills match.');
    }

    return ReportDataTable(
      columns: const [
        ReportTableColumn('Bill no.', width: 80),
        ReportTableColumn('Date', width: 80),
        ReportTableColumn('Billed for', width: 90),
        ReportTableColumn('Guest / Table', width: 120),
        ReportTableColumn('Room', width: 60),
        ReportTableColumn('Document', width: 100),
        ReportTableColumn('Status', width: 70),
        ReportTableColumn('Amount', width: 84, align: TextAlign.right),
      ],
      rows: [for (final inv in rows) _row(inv)],
      totals: [
        '${rows.length} bill${rows.length == 1 ? '' : 's'}',
        '', '', '', '', '', '',
        formatPrice(total),
      ],
    );
  }

  List<String> _row(Invoice inv) => [
    inv.invoiceNumber ?? '—',
    inv.createdAt == null ? '—' : formatDateTime(inv.createdAt),
    _kSourceLabel[_billSource(inv)] ?? '—',
    _billParty(inv),
    inv.kind == 'FOOD' || inv.kind == 'EVENT' ? '—' : (inv.roomNumber ?? '—'),
    _kDocumentLabel[inv.documentType] ?? inv.documentType ?? '—',
    inv.status == 'VOID' ? 'Void' : 'Issued',
    formatPrice(inv.totalAmount),
  ];
}

/// The search bar's side filter — same round, badge-carrying button the
/// events list's own filter icon is drawn as, opening [_BillTypeChips]
/// folded underneath it rather than a menu.
class _BillTypeFilterButton extends StatelessWidget {
  final String selected;
  final bool open;
  final VoidCallback onTap;

  const _BillTypeFilterButton({required this.selected, required this.open, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final on = selected != 'ALL' || open;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 48,
        height: 48,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          gradient: on
              ? const LinearGradient(colors: [AppTheme.accent, AppTheme.sidebarBrand])
              : null,
          color: on ? null : AppTheme.card,
          shape: BoxShape.circle,
          border: on ? null : Border.all(color: AppTheme.shadowDark, width: 1.3),
          boxShadow: on
              ? [BoxShadow(color: AppTheme.accent.withValues(alpha: 0.3), blurRadius: 8, offset: const Offset(0, 2))]
              : AppTheme.subtle,
        ),
        child: Stack(
          clipBehavior: Clip.none,
          alignment: Alignment.center,
          children: [
            Icon(Icons.filter_alt_rounded, size: 19, color: on ? Colors.white : AppTheme.accent),
            if (selected != 'ALL')
              Positioned(
                top: -4,
                right: -6,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppTheme.accent, width: 1.2),
                  ),
                  constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                  child: const Text(
                    '1',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppTheme.accent, fontSize: 9, fontWeight: FontWeight.w800),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The folded-open bill-type panel — All bills, Room, Restaurant and Events
/// as one pick, mirroring [_EventStatusChips]'s left-rule chip list.
class _BillTypeChips extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _BillTypeChips({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return NeuFilterPanel(
      title: 'FILTER BY BILL TYPE',
      children: [
        for (final (key, label, icon) in _kBillTypeFilters)
          NeuFilterRow(
            label: label,
            icon: icon,
            on: selected == key,
            onTap: () => onSelect(key),
          ),
      ],
    );
  }
}
