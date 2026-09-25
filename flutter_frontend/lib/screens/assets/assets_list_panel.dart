import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'asset_detail_screen.dart';
import 'asset_form_sheet.dart';
import 'work_orders_panel.dart';

/// Assets > Assets — mirrors the Register tab in AssetsPanel.jsx: a search
/// box, a status filter, and every unit on file, tap-through to its detail.
class AssetsListPanel extends ConsumerStatefulWidget {
  const AssetsListPanel({super.key});

  @override
  ConsumerState<AssetsListPanel> createState() => _AssetsListPanelState();
}

class _AssetsListPanelState extends ConsumerState<AssetsListPanel> {
  final _search = TextEditingController();
  String _status = '';

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(assetsViewModelProvider.notifier).loadAssets());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _viewDetails(BuildContext context, WidgetRef ref, Asset a) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => AssetDetailScreen(assetId: a.id)),
    );
    ref.read(assetsViewModelProvider.notifier).loadAssets();
  }

  // Soft-delete, same as deleteAsset in AssetsPanel.jsx — service history
  // stays, the asset just stops showing in the register.
  Future<void> _confirmDelete(BuildContext context, WidgetRef ref, Asset a) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text('Delete asset?', style: TextStyle(color: AppTheme.heading)),
        content: Text(
          'Delete "${a.name}"? Its service history is kept, but it won\'t show in the register.',
          style: const TextStyle(color: AppTheme.text),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete', style: TextStyle(color: AppTheme.danger)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await ref.read(assetsViewModelProvider.notifier).deleteAsset(a.id);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(assetsViewModelProvider);
    final needle = _search.text.trim().toLowerCase();
    final shown = [...state.assets]
      ..removeWhere((a) =>
          (_status.isNotEmpty && a.status != _status) ||
          (needle.isNotEmpty &&
              !a.name.toLowerCase().contains(needle) &&
              !(a.assetTag ?? '').toLowerCase().contains(needle) &&
              !a.categoryName.toLowerCase().contains(needle) &&
              !a.serialNumber.toLowerCase().contains(needle)))
      ..sort((a, b) => a.name.compareTo(b.name));
    final openWorkOrders = shown.fold<int>(0, (sum, a) => sum + a.openWorkOrders);

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(assetsViewModelProvider.notifier).loadAssets(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, 88),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: NeuField(
                      controller: _search,
                      label: '',
                      hint: 'Search name, tag, category',
                      suffix: const Padding(
                        padding: EdgeInsets.only(right: AppTheme.s8),
                        child: Icon(Icons.search_rounded, size: 20, color: AppTheme.muted),
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  _StatusFilterButton(selected: _status, onSelect: (s) => setState(() => _status = s)),
                ],
              ),
              const SizedBox(height: AppTheme.s12),
              if (state.isLoading && state.assets.isEmpty)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else if (state.error != null && state.assets.isEmpty)
                NeuNotice(icon: Icons.cloud_off_rounded, message: state.error!)
              else if (shown.isEmpty)
                const NeuNotice(icon: Icons.inventory_2_outlined, message: 'No assets match. Tap + to register one.')
              else ...[
                _SummaryStrip(count: shown.length, openWorkOrders: openWorkOrders),
                const SizedBox(height: AppTheme.s8),
                for (final a in shown)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: _AssetCard(
                      asset: a,
                      onTap: () => _viewDetails(context, ref, a),
                      onViewDetails: () => _viewDetails(context, ref, a),
                      onEdit: () async {
                        await showAssetFormSheet(context, asset: a);
                        ref.read(assetsViewModelProvider.notifier).loadAssets();
                      },
                      onReportIssue: () => showReportIssueDialog(context, assetId: a.id),
                      onDelete: () => _confirmDelete(context, ref, a),
                    ),
                  ),
              ],
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
            onPressed: () async {
              await showAssetFormSheet(context);
              ref.read(assetsViewModelProvider.notifier).loadAssets();
            },
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

/// A quick "N assets · N open work orders" line above the list — mirrors the
/// summary strip in ExpensesListPanel, so the register reads as one number
/// count instead of forcing a manual scroll-and-tally.
class _SummaryStrip extends StatelessWidget {
  final int count;
  final int openWorkOrders;

  const _SummaryStrip({required this.count, required this.openWorkOrders});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text('$count asset${count == 1 ? '' : 's'}', style: const TextStyle(color: AppTheme.muted, fontSize: 12.5, fontWeight: FontWeight.w500)),
        if (openWorkOrders > 0) ...[
          const Text(' · ', style: TextStyle(color: AppTheme.muted, fontSize: 12.5)),
          Text(
            '$openWorkOrders open work order${openWorkOrders == 1 ? '' : 's'}',
            style: const TextStyle(color: AppTheme.danger, fontSize: 12.5, fontWeight: FontWeight.w700),
          ),
        ],
      ],
    );
  }
}

class _StatusFilterButton extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _StatusFilterButton({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    final isFiltered = selected.isNotEmpty;
    return PopupMenuButton<String>(
      tooltip: 'Filter by status',
      initialValue: selected,
      onSelected: onSelect,
      offset: const Offset(0, 44),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rSmall), side: const BorderSide(color: AppTheme.border)),
      itemBuilder: (context) => [
        _item('', 'All'),
        for (final s in kAssetStatuses) _item(s, kAssetStatusLabel[s]!),
      ],
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: isFiltered ? AppTheme.accent.withValues(alpha: 0.1) : AppTheme.card,
              borderRadius: BorderRadius.circular(AppTheme.rSmall),
              border: Border.all(color: isFiltered ? AppTheme.accent : AppTheme.border, width: isFiltered ? 1.4 : 1),
            ),
            child: Icon(Icons.filter_list_rounded, size: 21, color: isFiltered ? AppTheme.accent : AppTheme.muted),
          ),
          if (isFiltered)
            Positioned(
              right: -2,
              top: -2,
              child: Container(
                width: 10,
                height: 10,
                decoration: const BoxDecoration(color: AppTheme.accent, shape: BoxShape.circle),
              ),
            ),
        ],
      ),
    );
  }

  PopupMenuItem<String> _item(String key, String label) {
    final isSelected = key == selected;
    return PopupMenuItem(
      value: key,
      child: Row(
        children: [
          Icon(
            isSelected ? Icons.radio_button_checked_rounded : Icons.radio_button_unchecked_rounded,
            size: 16,
            color: isSelected ? AppTheme.accent : AppTheme.muted,
          ),
          const SizedBox(width: 8),
          Text(label, style: TextStyle(color: AppTheme.text, fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500, fontSize: 13)),
        ],
      ),
    );
  }
}

class _AssetCard extends StatelessWidget {
  final Asset asset;
  final VoidCallback onTap;
  final VoidCallback onViewDetails;
  final VoidCallback onEdit;
  final VoidCallback onReportIssue;
  final VoidCallback onDelete;

  const _AssetCard({
    required this.asset,
    required this.onTap,
    required this.onViewDetails,
    required this.onEdit,
    required this.onReportIssue,
    required this.onDelete,
  });

  Color get _statusColor => switch (asset.status) {
    'IN_USE' => AppTheme.vacant,
    'UNDER_REPAIR' => AppTheme.draft,
    _ => AppTheme.muted,
  };

  IconData get _statusIcon => switch (asset.status) {
    'IN_USE' => Icons.check_circle_rounded,
    'UNDER_REPAIR' => Icons.build_rounded,
    'TRANSFERRED' => Icons.swap_horiz_rounded,
    _ => Icons.remove_circle_rounded,
  };

  @override
  Widget build(BuildContext context) {
    final location = [if (asset.floor.isNotEmpty) 'Floor ${asset.floor}', asset.locationNote].where((s) => s.isNotEmpty).join(' · ');

    // A colour bar down the left edge — the status reads at a glance even
    // before the eye lands on the chip, mirrors _RegisterCard in
    // RegisterScreen (the guest register this list borrows its look from).
    return GestureDetector(
      onTap: onTap,
      child: NeuCard(
        radius: AppTheme.rMedium,
        shadow: AppTheme.extruded,
        padding: EdgeInsets.zero,
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                width: 4,
                decoration: BoxDecoration(
                  color: _statusColor,
                  borderRadius: const BorderRadius.horizontal(left: Radius.circular(AppTheme.rMedium)),
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s8, AppTheme.s4, AppTheme.s8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              asset.name,
                              style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13.5, letterSpacing: -0.1),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                            decoration: BoxDecoration(color: _statusColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(_statusIcon, size: 10, color: _statusColor),
                                const SizedBox(width: 3),
                                Text(
                                  kAssetStatusLabel[asset.status] ?? asset.status,
                                  style: TextStyle(color: _statusColor, fontSize: 9.5, fontWeight: FontWeight.w700),
                                ),
                              ],
                            ),
                          ),
                          _AssetRowMenu(
                            onViewDetails: onViewDetails,
                            onEdit: onEdit,
                            onReportIssue: onReportIssue,
                            onDelete: onDelete,
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        [asset.categoryName, if (asset.assetTag != null) asset.assetTag!].join(' · '),
                        style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: AppTheme.s8),
                      Container(height: 1, color: AppTheme.border),
                      const SizedBox(height: AppTheme.s8),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            flex: 3,
                            child: _Field(label: 'Location', value: location.isEmpty ? '—' : location),
                          ),
                          const SizedBox(width: AppTheme.s8),
                          Expanded(
                            flex: 2,
                            child: _Field(
                              label: 'Work orders',
                              value: asset.openWorkOrders > 0 ? '${asset.openWorkOrders} open' : 'None open',
                              accent: asset.openWorkOrders > 0,
                              alignEnd: true,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  final String label;
  final String value;
  final bool accent;
  final bool alignEnd;

  const _Field({required this.label, required this.value, this.accent = false, this.alignEnd = false});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: alignEnd ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 9.5, fontWeight: FontWeight.w600)),
        const SizedBox(height: 1),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          textAlign: alignEnd ? TextAlign.end : TextAlign.start,
          style: TextStyle(
            color: accent ? AppTheme.danger : AppTheme.heading,
            fontSize: accent ? 12 : 11.5,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}

/// The ⋮ row menu — mirrors RowMenu in AssetsPanel.jsx: the rare/destructive
/// actions for one asset, folded behind a single button instead of a row of
/// buttons that would overflow the card on a phone width.
class _AssetRowMenu extends StatelessWidget {
  final VoidCallback onViewDetails;
  final VoidCallback onEdit;
  final VoidCallback onReportIssue;
  final VoidCallback onDelete;

  const _AssetRowMenu({
    required this.onViewDetails,
    required this.onEdit,
    required this.onReportIssue,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<VoidCallback>(
      tooltip: 'More actions',
      padding: EdgeInsets.zero,
      icon: const Icon(Icons.more_vert_rounded, size: 20, color: AppTheme.muted),
      onSelected: (action) => action(),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rSmall), side: const BorderSide(color: AppTheme.border)),
      itemBuilder: (context) => [
        PopupMenuItem(value: onViewDetails, child: const Text('View details')),
        PopupMenuItem(value: onEdit, child: const Text('Edit asset')),
        PopupMenuItem(value: onReportIssue, child: const Text('Report issue')),
        PopupMenuItem(
          value: onDelete,
          child: const Text('Delete asset', style: TextStyle(color: AppTheme.danger)),
        ),
      ],
    );
  }
}
