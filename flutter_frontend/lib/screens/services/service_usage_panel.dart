import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/lodge_service.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../housekeeping/housekeeping_parts.dart';
import '../theme.dart';
import 'start_usage_screen.dart';

/// Service use — mirrors the 'usage' view in ServicesPanel.jsx: start a
/// service when the guest begins, mark it completed when done, which sends
/// it to Billing > Services to bill.
class ServiceUsagePanel extends ConsumerStatefulWidget {
  const ServiceUsagePanel({super.key});

  @override
  ConsumerState<ServiceUsagePanel> createState() => _ServiceUsagePanelState();
}

class _ServiceUsagePanelState extends ConsumerState<ServiceUsagePanel> {
  // ServicesScreen triggers the initial loadUsages/loadServices/
  // loadInHouseGuests once, and keeps lodgeServicesViewModelProvider alive
  // for as long as the screen is open — switching sub-tabs here no longer
  // needs (or should repeat) its own load.

  final _search = TextEditingController();

  // ALL | IN_USE (Active) | COMPLETED (History) | CANCELLED.
  String _filter = 'ALL';

  // The status filter's own door — a funnel icon beside the search box that
  // folds the status chips open directly underneath, same as the Guest
  // register screen (register_screen.dart)'s own _FilterButton/_StatusChips.
  bool _filterOpen = false;
  final LayerLink _filterLink = LayerLink();
  final OverlayPortalController _filterPortalController = OverlayPortalController();

  void _toggleFilterOpen() {
    setState(() => _filterOpen = !_filterOpen);
    if (_filterOpen) {
      _filterPortalController.show();
    } else {
      _filterPortalController.hide();
    }
  }

  void _selectFilter(String key) {
    setState(() => _filter = key);
    _toggleFilterOpen();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(lodgeServicesViewModelProvider);

    if (state.isLoadingUsages && state.usages.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    final needle = _search.text.trim().toLowerCase();
    final searched = needle.isEmpty
        ? state.usages
        : state.usages
            .where((u) =>
                u.serviceName.toLowerCase().contains(needle) ||
                (u.guestName ?? '').toLowerCase().contains(needle) ||
                (u.roomNumber ?? '').toLowerCase().contains(needle))
            .toList();

    final counts = {
      'ALL': searched.length,
      'IN_USE': searched.where((u) => u.status == 'IN_USE').length,
      'COMPLETED': searched.where((u) => u.status == 'COMPLETED').length,
      'CANCELLED': searched.where((u) => u.status == 'CANCELLED').length,
    };
    final shown = _filter == 'ALL' ? searched : searched.where((u) => u.status == _filter).toList();

    return Stack(
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(lodgeServicesViewModelProvider.notifier).loadUsages(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, AppTheme.s32 + 56),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              if (state.error != null) ...[
                _ErrorBanner(state.error!),
                const SizedBox(height: AppTheme.s12),
              ],
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    child: _SearchField(
                      controller: _search,
                      hint: 'Search by service, guest or room…',
                      onChanged: (_) => setState(() {}),
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
                                child: _UsageFilterChips(
                                  selected: _filter,
                                  counts: counts,
                                  onSelect: _selectFilter,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                      child: _FilterButton(
                        on: _filter != 'ALL',
                        open: _filterOpen,
                        onTap: _toggleFilterOpen,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.s12),
              const Text(
                'Start a service when the guest begins, mark it completed when done — it then appears in Billing > Services to bill, where it is billed or added to the guest’s room bill.',
                style: TextStyle(color: AppTheme.muted, fontSize: 11.5),
              ),
              const SizedBox(height: AppTheme.s12),
              if (shown.isEmpty)
                NeuNotice(
                  icon: Icons.spa_outlined,
                  message: state.usages.isEmpty ? 'Nothing yet.' : 'Nothing matches this search.',
                )
              else
                for (final u in shown)
                  _UsageCard(
                    usage: u,
                    onView: () => showUsageDetailDialog(context, u),
                    onComplete: () => ref.read(lodgeServicesViewModelProvider.notifier).completeUsage(u.id),
                    onCancel: () => ref.read(lodgeServicesViewModelProvider.notifier).cancelUsage(u.id),
                  ),
            ],
          ),
        ),
        Positioned(
          right: AppTheme.s16,
          bottom: AppTheme.s16,
          child: FloatingActionButton(
            backgroundColor: AppTheme.accent,
            foregroundColor: Colors.white,
            elevation: 2,
            onPressed: () => showStartUsageScreen(context),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

/// Every field the card itself has no room for — mirrors ServicesPanel.jsx's
/// own detailUsage modal: amount/units/rate/GST, then guest details, timing
/// and billing, each under its own heading.
void showUsageDetailDialog(BuildContext context, ServiceUsage usage) {
  showDialog<void>(
    context: context,
    barrierColor: Colors.black.withValues(alpha: 0.4),
    builder: (_) => _UsageDetailDialog(usage: usage),
  );
}

class _UsageDetailDialog extends StatelessWidget {
  final ServiceUsage usage;
  const _UsageDetailDialog({required this.usage});

  @override
  Widget build(BuildContext context) {
    final tone = switch (usage.status) {
      'IN_USE' => AppTheme.edit,
      'CANCELLED' => AppTheme.danger,
      _ => usage.billed ? AppTheme.muted : AppTheme.checkedIn,
    };
    final billingTone = usage.billed ? AppTheme.muted : (usage.onRoomBill ? AppTheme.edit : AppTheme.checkedIn);
    final billingLabel = usage.billed ? 'Billed' : (usage.onRoomBill ? 'On room bill' : 'Ready to bill');

    return Dialog(
      backgroundColor: AppTheme.card,
      insetPadding: const EdgeInsets.all(AppTheme.s16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rLarge)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppTheme.s16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(usage.serviceName, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w800, fontSize: 18)),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  StatusPill(label: kServiceUsageStatusLabel[usage.status] ?? usage.status, color: tone),
                  const SizedBox(width: AppTheme.s8),
                  GestureDetector(
                    onTap: () => Navigator.of(context).pop(),
                    behavior: HitTestBehavior.opaque,
                    child: const Icon(Icons.close_rounded, size: 20, color: AppTheme.muted),
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.s16),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(AppTheme.s12),
                decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(AppTheme.rMedium)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('AMOUNT', style: TextStyle(color: AppTheme.muted, fontSize: 10.5, fontWeight: FontWeight.w700, letterSpacing: 0.4)),
                    const SizedBox(height: 4),
                    Text(formatPrice(usage.lineTotal), style: const TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w800, fontSize: 24)),
                    const SizedBox(height: AppTheme.s12),
                    Row(
                      children: [
                        _StatCell(label: 'UNITS', value: '${usage.quantity} ${usage.unitLabel}'),
                        _StatCell(label: 'RATE', value: '${formatPrice(usage.unitPrice)} / ${usage.unitLabel}'),
                        _StatCell(label: 'GST', value: '${usage.gstRatePercent}%'),
                      ],
                    ),
                  ],
                ),
              ),
              _DetailSection(
                title: 'Guest details',
                rows: [
                  ('Entry', usage.roomNumber != null ? 'Room guest · Room ${usage.roomNumber}' : 'Walk-in'),
                  ('Customer name', usage.guestName ?? ''),
                  ('Phone', usage.guestPhone ?? ''),
                  ('Note', usage.note ?? ''),
                ],
              ),
              _DetailSection(
                title: 'Timing',
                rows: [
                  ('Started', formatDateTime(usage.startedAt)),
                  ('Completed', formatDateTime(usage.completedAt)),
                ],
              ),
              _DetailSection(
                title: 'Billing',
                rows: [
                  ('Status', usage.status == 'COMPLETED' ? billingLabel : '—'),
                  ('Billed', usage.billed ? 'Yes' : 'No'),
                ],
                rowColors: {'Status': usage.status == 'COMPLETED' ? billingTone : null},
                last: true,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatCell extends StatelessWidget {
  final String label;
  final String value;
  const _StatCell({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 9.5, fontWeight: FontWeight.w700, letterSpacing: 0.3)),
          const SizedBox(height: 2),
          Text(value, style: const TextStyle(color: AppTheme.heading, fontSize: 12.5, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

/// One "SECTION TITLE" + a run of label/value rows — mirrors each
/// form-section block ServicesPanel.jsx's own detail modal renders.
class _DetailSection extends StatelessWidget {
  final String title;
  final List<(String, String)> rows;
  final Map<String, Color?> rowColors;
  final bool last;

  const _DetailSection({required this.title, required this.rows, this.rowColors = const {}, this.last = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(top: AppTheme.s16, bottom: last ? 0 : 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title.toUpperCase(), style: const TextStyle(color: AppTheme.muted, fontSize: 10.5, fontWeight: FontWeight.w700, letterSpacing: 0.4)),
          const SizedBox(height: AppTheme.s8),
          for (final (label, value) in rows) ...[
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 11.5, fontWeight: FontWeight.w600)),
                  ),
                  Expanded(
                    child: Text(
                      value.isEmpty ? '—' : value,
                      textAlign: TextAlign.right,
                      style: TextStyle(
                        color: rowColors[label] ?? (value.isEmpty ? AppTheme.muted : AppTheme.heading),
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          if (!last) const Divider(height: 1, color: AppTheme.border),
        ],
      ),
    );
  }
}

class _UsageCard extends StatelessWidget {
  final ServiceUsage usage;
  final VoidCallback onView;
  final VoidCallback onComplete;
  final VoidCallback onCancel;

  const _UsageCard({required this.usage, required this.onView, required this.onComplete, required this.onCancel});

  @override
  Widget build(BuildContext context) {
    final tone = switch (usage.status) {
      'IN_USE' => AppTheme.edit,
      'CANCELLED' => AppTheme.danger,
      _ => usage.billed ? AppTheme.muted : AppTheme.checkedIn,
    };
    // Room / guest / billing note, without the status — the status gets its
    // own pill instead of sitting inline in the text.
    final meta = [
      if (usage.roomNumber != null) 'Room ${usage.roomNumber}',
      if (usage.guestName != null && usage.guestName!.isNotEmpty) usage.guestName!,
      if (usage.status == 'COMPLETED') (usage.billed ? 'billed' : (usage.onRoomBill ? 'on room bill' : 'ready to bill')),
    ].join(' · ');
    final showActions = usage.status == 'IN_USE' || (!usage.billed && usage.status != 'CANCELLED');

    return Container(
      margin: const EdgeInsets.only(bottom: AppTheme.s8),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.extruded,
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.s8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${usage.serviceName} × ${usage.quantity}', style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 5),
                  Row(
                    children: [
                      StatusPill(label: kServiceUsageStatusLabel[usage.status] ?? usage.status, color: tone),
                      if (meta.isNotEmpty) ...[
                        const SizedBox(width: 6),
                        Expanded(child: Text(meta, style: const TextStyle(color: AppTheme.muted, fontSize: 11.5), maxLines: 1, overflow: TextOverflow.ellipsis)),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppTheme.s8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(formatPrice(usage.lineTotal), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w800, fontSize: 14)),
                const SizedBox(height: 6),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CompactActionButton(label: 'View', color: AppTheme.edit, onTap: onView),
                    if (showActions) ...[
                      if (usage.status == 'IN_USE') ...[
                        const SizedBox(width: 6),
                        CompactActionButton(label: 'Complete', color: AppTheme.accent, primary: true, onTap: onComplete),
                      ],
                      if (!usage.billed && usage.status != 'CANCELLED') ...[
                        const SizedBox(width: 6),
                        CompactActionButton(label: 'Cancel', color: AppTheme.danger, onTap: onCancel),
                      ],
                    ],
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Same pill-shaped search field other list screens use (expenses_list_
/// panel.dart, orders_screen.dart) — a circular accent-tinted icon badge, a
/// borderless field, and a clear (×) button once there is something typed.
class _SearchField extends StatelessWidget {
  final TextEditingController controller;
  final String hint;
  final ValueChanged<String> onChanged;

  const _SearchField({required this.controller, required this.hint, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
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
            decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.10), shape: BoxShape.circle),
            child: const Icon(Icons.search_rounded, size: 17, color: AppTheme.accent),
          ),
          const SizedBox(width: AppTheme.s8),
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onChanged,
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
                onChanged('');
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
    );
  }
}

/// The status filter's own circular funnel button — same look as the Guest
/// register screen's own _FilterButton: plain card when off, an accent
/// gradient once a non-"All" status is picked (or the chip list is open).
class _FilterButton extends StatelessWidget {
  final bool on;
  final bool open;
  final VoidCallback onTap;

  const _FilterButton({required this.on, required this.open, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final active = on || open;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 48,
        height: 48,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          gradient: active ? const LinearGradient(colors: [AppTheme.accent, AppTheme.sidebarBrand]) : null,
          color: active ? null : AppTheme.card,
          shape: BoxShape.circle,
          border: active ? null : Border.all(color: AppTheme.shadowDark, width: 1.3),
          boxShadow: active
              ? [BoxShadow(color: AppTheme.accent.withValues(alpha: 0.3), blurRadius: 8, offset: const Offset(0, 2))]
              : AppTheme.subtle,
        ),
        child: Icon(Icons.filter_alt_rounded, size: 19, color: active ? Colors.white : AppTheme.accent),
      ),
    );
  }
}

/// The status chip list that folds open under the filter button — same
/// floating card the Guest register screen's own _StatusChips renders.
class _UsageFilterChips extends StatelessWidget {
  final String selected;
  final Map<String, int> counts;
  final ValueChanged<String> onSelect;

  const _UsageFilterChips({required this.selected, required this.counts, required this.onSelect});

  static const _order = ['ALL', 'IN_USE', 'COMPLETED', 'CANCELLED'];
  static const _labels = {'ALL': 'All', 'IN_USE': 'Active', 'COMPLETED': 'History', 'CANCELLED': 'Cancelled'};
  static const _icons = {
    'ALL': Icons.apps_rounded,
    'IN_USE': Icons.play_circle_outline_rounded,
    'COMPLETED': Icons.history_rounded,
    'CANCELLED': Icons.cancel_outlined,
  };

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 190,
      decoration: BoxDecoration(color: AppTheme.card, borderRadius: BorderRadius.circular(AppTheme.rMedium), boxShadow: AppTheme.subtle),
      padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final key in _order)
            _UsageFilterChip(
              label: _labels[key]!,
              count: counts[key] ?? 0,
              on: selected == key,
              color: key == 'IN_USE' ? AppTheme.edit : (key == 'CANCELLED' ? AppTheme.danger : (key == 'COMPLETED' ? AppTheme.checkedIn : AppTheme.accent)),
              icon: _icons[key]!,
              onTap: () => onSelect(key),
            ),
        ],
      ),
    );
  }
}

class _UsageFilterChip extends StatelessWidget {
  final String label;
  final int count;
  final bool on;
  final Color color;
  final IconData icon;
  final VoidCallback onTap;

  const _UsageFilterChip({required this.label, required this.count, required this.on, required this.color, required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
        decoration: BoxDecoration(
          color: on ? color.withValues(alpha: 0.10) : Colors.transparent,
          border: Border(left: BorderSide(color: on ? color : Colors.transparent, width: 3)),
        ),
        child: Row(
          children: [
            Icon(icon, size: 16, color: on ? color : AppTheme.muted),
            const SizedBox(width: AppTheme.s8),
            Expanded(
              child: Text(label, style: TextStyle(color: on ? color : AppTheme.text, fontSize: 13, fontWeight: on ? FontWeight.w600 : FontWeight.w400)),
            ),
            Text('$count', style: TextStyle(color: on ? color : AppTheme.muted, fontSize: 12, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  final String message;
  const _ErrorBanner(this.message);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(color: AppTheme.danger.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppTheme.danger, size: 18),
          const SizedBox(width: AppTheme.s8),
          Expanded(child: Text(message, style: const TextStyle(color: AppTheme.danger, fontSize: 13))),
        ],
      ),
    );
  }
}
