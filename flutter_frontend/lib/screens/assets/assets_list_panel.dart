import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'asset_detail_screen.dart';
import 'asset_form_sheet.dart';
import 'work_orders_panel.dart';

/// Assets > Assets — mirrors the Register tab in AssetsPanel.jsx: a search
/// box and every unit on file, either as cards or as a spreadsheet-style
/// table, tap-through to its detail either way.
class AssetsListPanel extends ConsumerStatefulWidget {
  const AssetsListPanel({super.key});

  @override
  ConsumerState<AssetsListPanel> createState() => _AssetsListPanelState();
}

class _AssetsListPanelState extends ConsumerState<AssetsListPanel> {
  final _search = TextEditingController();

  // 'cards' is the everyday view — one asset at a time is easy to read on a
  // phone. 'table' is the sheet-style view for scanning every asset's
  // warranty/AMC/location at once, mirroring assetView in AssetsPanel.jsx.
  String _view = 'cards';

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(assetsViewModelProvider.notifier).loadAssets(includeInactive: true));
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
    ref.read(assetsViewModelProvider.notifier).loadAssets(includeInactive: true);
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
          a.status == 'RETIRED' ||
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
          onRefresh: () => ref.read(assetsViewModelProvider.notifier).loadAssets(includeInactive: true),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, 88),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              Row(
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
                              controller: _search,
                              onChanged: (_) => setState(() {}),
                              style: const TextStyle(color: AppTheme.heading, fontSize: 14),
                              decoration: const InputDecoration(
                                hintText: 'Search name, tag, category',
                                hintStyle: TextStyle(color: AppTheme.muted, fontSize: 14),
                                border: InputBorder.none,
                                isDense: true,
                                contentPadding: EdgeInsets.symmetric(vertical: 13),
                              ),
                            ),
                          ),
                          if (_search.text.isNotEmpty)
                            GestureDetector(
                              onTap: () => setState(() => _search.clear()),
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
                  _ViewToggleButton(view: _view, onSelect: (v) => setState(() => _view = v)),
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
                if (_view == 'table')
                  _AssetTable(
                    assets: shown,
                    onTap: (a) => _viewDetails(context, ref, a),
                    onEdit: (a) async {
                      await showAssetFormSheet(context, asset: a);
                      ref.read(assetsViewModelProvider.notifier).loadAssets(includeInactive: true);
                    },
                    onReportIssue: (a) => showReportIssueDialog(context, assetId: a.id),
                    onDelete: (a) => _confirmDelete(context, ref, a),
                  )
                else
                  for (final a in shown)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: _AssetCard(
                        asset: a,
                        onTap: () => _viewDetails(context, ref, a),
                        onViewDetails: () => _viewDetails(context, ref, a),
                        onEdit: () async {
                          await showAssetFormSheet(context, asset: a);
                          ref.read(assetsViewModelProvider.notifier).loadAssets(includeInactive: true);
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
              ref.read(assetsViewModelProvider.notifier).loadAssets(includeInactive: true);
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

/// Cards vs. spreadsheet — mirrors the toggle-group in AssetsPanel.jsx's
/// own asset-view-toggle, sitting where the status filter icon used to be.
class _ViewToggleButton extends StatelessWidget {
  final String view;
  final ValueChanged<String> onSelect;

  const _ViewToggleButton({required this.view, required this.onSelect});

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

class _AssetTableColumn {
  final String key;
  final String label;
  final double width;
  final TextAlign align;

  const _AssetTableColumn(this.key, this.label, {this.width = 100, this.align = TextAlign.left});
}

const _kAssetTableColumns = [
  _AssetTableColumn('tag', 'Tag', width: 86),
  _AssetTableColumn('name', 'Name', width: 160),
  _AssetTableColumn('category', 'Category', width: 110),
  _AssetTableColumn('location', 'Location', width: 96),
  _AssetTableColumn('status', 'Status', width: 84),
  _AssetTableColumn('warranty', 'Warranty', width: 92),
  _AssetTableColumn('amc', 'AMC', width: 92),
  _AssetTableColumn('openWos', 'Open WOs', width: 76, align: TextAlign.right),
];

/// The sheet-style view — every asset's tag/name/category/location/status/
/// warranty/AMC/open-work-orders in one scrollable, sortable grid, mirroring
/// the web table (TABLE_SORT_ACCESSORS/asset-table in AssetsPanel.jsx):
/// clickable column headers, a coloured status pill, and a per-row ⋮ menu
/// for the same actions the card view offers.
class _AssetTable extends StatefulWidget {
  final List<Asset> assets;
  final ValueChanged<Asset> onTap;
  final ValueChanged<Asset> onEdit;
  final ValueChanged<Asset> onReportIssue;
  final ValueChanged<Asset> onDelete;

  const _AssetTable({
    required this.assets,
    required this.onTap,
    required this.onEdit,
    required this.onReportIssue,
    required this.onDelete,
  });

  @override
  State<_AssetTable> createState() => _AssetTableState();
}

class _AssetTableState extends State<_AssetTable> {
  // null key means unsorted (register order) — three-state toggle per
  // column, same cycle as toggleTableSort in AssetsPanel.jsx: asc -> desc ->
  // unsorted.
  String? _sortKey;
  bool _sortDesc = false;

  String _location(Asset a) {
    if (a.roomNumber != null) return 'Room ${a.roomNumber}';
    return [if (a.floor.isNotEmpty) 'Floor ${a.floor}', a.department].where((s) => s.isNotEmpty).join(' · ');
  }

  Comparable? _sortValue(Asset a, String key) => switch (key) {
    'tag' => a.assetTag,
    'name' => a.name,
    'category' => a.categoryName,
    'location' => _location(a),
    'status' => kAssetStatusLabel[a.status] ?? a.status,
    'warranty' => a.warrantyExpiry,
    'amc' => a.amcExpiry,
    'openWos' => a.openWorkOrders,
    _ => null,
  };

  List<Asset> get _sorted {
    final key = _sortKey;
    if (key == null) return widget.assets;
    final dir = _sortDesc ? -1 : 1;
    final sorted = [...widget.assets];
    sorted.sort((a, b) {
      final av = _sortValue(a, key);
      final bv = _sortValue(b, key);
      final aEmpty = av == null || av == '';
      final bEmpty = bv == null || bv == '';
      // Nulls/empties sink to the bottom regardless of direction — same as
      // the web's own sort, where "no warranty on file" isn't meaningfully
      // before or after a real date.
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (av is num && bv is num) return (av - bv).sign.toInt() * dir;
      return av.toString().toLowerCase().compareTo(bv.toString().toLowerCase()) * dir;
    });
    return sorted;
  }

  void _toggleSort(String key) {
    setState(() {
      if (_sortKey != key) {
        _sortKey = key;
        _sortDesc = false;
      } else if (!_sortDesc) {
        _sortDesc = true;
      } else {
        _sortKey = null;
        _sortDesc = false;
      }
    });
  }

  Color _statusColor(String status) => switch (status) {
    'IN_USE' => AppTheme.vacant,
    'UNDER_REPAIR' => AppTheme.draft,
    _ => AppTheme.muted,
  };

  @override
  Widget build(BuildContext context) {
    final rows = _sorted;
    final width = _kAssetTableColumns.fold<double>(0, (sum, c) => sum + c.width) + 36;

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
                      for (final c in _kAssetTableColumns)
                        SizedBox(
                          width: c.width,
                          child: GestureDetector(
                            onTap: () => _toggleSort(c.key),
                            behavior: HitTestBehavior.opaque,
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
                              child: Row(
                                mainAxisAlignment: c.align == TextAlign.right ? MainAxisAlignment.end : MainAxisAlignment.start,
                                children: [
                                  Flexible(
                                    child: Text(
                                      c.label.toUpperCase(),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: Theme.of(context).textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.3),
                                    ),
                                  ),
                                  const SizedBox(width: 2),
                                  Icon(
                                    _sortKey != c.key
                                        ? Icons.unfold_more_rounded
                                        : (_sortDesc ? Icons.arrow_drop_down_rounded : Icons.arrow_drop_up_rounded),
                                    size: 14,
                                    color: _sortKey == c.key ? AppTheme.accent : AppTheme.muted,
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      const SizedBox(width: 36),
                    ],
                  ),
                ),
                for (var i = 0; i < rows.length; i++) _AssetTableRow(asset: rows[i], shaded: i.isOdd, statusColor: _statusColor, parent: widget),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AssetTableRow extends StatelessWidget {
  final Asset asset;
  final bool shaded;
  final Color Function(String) statusColor;
  final _AssetTable parent;

  const _AssetTableRow({required this.asset, required this.shaded, required this.statusColor, required this.parent});

  String _location(Asset a) {
    if (a.roomNumber != null) return 'Room ${a.roomNumber}';
    return [if (a.floor.isNotEmpty) 'Floor ${a.floor}', a.department].where((s) => s.isNotEmpty).join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final cells = {
      'tag': asset.assetTag ?? '—',
      'name': asset.name,
      'category': asset.categoryName,
      'location': _location(asset).isEmpty ? '—' : _location(asset),
      'warranty': asset.warrantyExpiry != null ? formatIsoDate(asset.warrantyExpiry!) : '—',
      'amc': asset.amcExpiry != null ? formatIsoDate(asset.amcExpiry!) : '—',
      'openWos': asset.openWorkOrders > 0 ? '${asset.openWorkOrders}' : '—',
    };
    final color = statusColor(asset.status);

    return GestureDetector(
      onTap: () => parent.onTap(asset),
      behavior: HitTestBehavior.opaque,
      child: Container(
        decoration: BoxDecoration(
          color: shaded ? AppTheme.border.withValues(alpha: 0.25) : AppTheme.card,
          border: const Border(bottom: BorderSide(color: AppTheme.border, width: 0.8)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            for (final c in _kAssetTableColumns)
              SizedBox(
                width: c.width,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
                  child: c.key == 'status'
                      ? Align(
                          alignment: Alignment.centerLeft,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                            child: Text(
                              kAssetStatusLabel[asset.status] ?? asset.status,
                              style: TextStyle(color: color, fontSize: 10.5, fontWeight: FontWeight.w700),
                            ),
                          ),
                        )
                      : Text(
                          cells[c.key] ?? '',
                          textAlign: c.align,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: c.key == 'tag' ? AppTheme.muted : (c.key == 'category' ? AppTheme.accent : AppTheme.text),
                            fontSize: 12.5,
                            fontWeight: c.key == 'name' ? FontWeight.w600 : FontWeight.w400,
                          ),
                        ),
                ),
              ),
            SizedBox(
              width: 36,
              child: PopupMenuButton<String>(
                padding: EdgeInsets.zero,
                icon: const Icon(Icons.more_vert_rounded, size: 18, color: AppTheme.muted),
                onSelected: (v) => switch (v) {
                  'view' => parent.onTap(asset),
                  'edit' => parent.onEdit(asset),
                  'report' => parent.onReportIssue(asset),
                  'delete' => parent.onDelete(asset),
                  _ => null,
                },
                itemBuilder: (context) => const [
                  PopupMenuItem(value: 'view', child: Text('View details')),
                  PopupMenuItem(value: 'edit', child: Text('Edit asset')),
                  PopupMenuItem(value: 'report', child: Text('Report an issue')),
                  PopupMenuItem(value: 'delete', child: Text('Delete')),
                ],
              ),
            ),
          ],
        ),
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
