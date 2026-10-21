import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart';
import '../../domain/models/expense.dart' show kPaymentMethods, kPaymentMethodLabel, kPaymentReferenceLabel, kPaymentStatuses;
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';
import 'asset_icons.dart';
import 'asset_stat_grid.dart';

// Full option set for the payment-status dropdown — same reasoning as its
// twin in expense_form_screen.dart / asset_form_sheet.dart.
const _paymentStatusOptionLabel = {'PAID': 'Paid in full', 'PARTIAL': 'Partially paid', 'PENDING': 'Pending'};

/// Assets > Work orders — mirrors the Work Orders tab in AssetsPanel.jsx: a
/// status filter and every breakdown/service ticket, newest first, with a
/// FAB to open one and a tap-through to update or close it.
class WorkOrdersPanel extends ConsumerStatefulWidget {
  const WorkOrdersPanel({super.key});

  @override
  ConsumerState<WorkOrdersPanel> createState() => _WorkOrdersPanelState();
}

class _WorkOrdersPanelState extends ConsumerState<WorkOrdersPanel> {
  final _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(assetsViewModelProvider.notifier).loadAssets(includeInactive: true);
      ref.read(assetsViewModelProvider.notifier).loadCatalogue();
    });
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  List<AssetStat> _summaryStats(List<WorkOrder> workOrders) {
    final open = workOrders.where((w) => w.status == 'OPEN').length;
    final inProgress = workOrders.where((w) => w.status == 'IN_PROGRESS').length;
    final closed = workOrders.where((w) => w.status == 'CLOSED').length;
    return [
      AssetStat(label: 'Open', value: '$open', accent: open > 0),
      AssetStat(label: 'In progress', value: '$inProgress'),
      AssetStat(label: 'Closed', value: '$closed'),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(assetsViewModelProvider);
    final needle = _search.text.trim().toLowerCase();
    final shown = [...state.workOrders]
      ..removeWhere((w) =>
          needle.isNotEmpty &&
          !w.assetName.toLowerCase().contains(needle) &&
          !(kIssueTypeLabel[w.issueType] ?? w.issueType).toLowerCase().contains(needle) &&
          !w.description.toLowerCase().contains(needle) &&
          !w.assignedToName.toLowerCase().contains(needle) &&
          !(w.vendorName ?? '').toLowerCase().contains(needle))
      ..sort((a, b) => b.openedAt.compareTo(a.openedAt));

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(assetsViewModelProvider.notifier).loadCatalogue(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, 88),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              Container(
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
                          hintText: 'Search work orders…',
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
              const SizedBox(height: AppTheme.s12),
              if (state.workOrders.isNotEmpty) ...[
                AssetStatGrid(items: _summaryStats(state.workOrders)),
                const SizedBox(height: AppTheme.s12),
              ],
              if (state.catalogueLoading && state.workOrders.isEmpty)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else if (state.error != null && state.workOrders.isEmpty)
                NeuNotice(icon: Icons.cloud_off_rounded, message: state.error!)
              else if (shown.isEmpty)
                NeuNotice(
                  icon: Icons.build_outlined,
                  message: state.workOrders.isEmpty
                      ? 'No work orders match. Tap + to report an issue.'
                      : 'No work order matches this search.',
                )
              else
                for (final w in shown)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppTheme.s8),
                    child: _WorkOrderCard(
                      workOrder: w,
                      onTap: () => showWorkOrderDialog(context, workOrder: w),
                    ),
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
            onPressed: state.assets.isEmpty ? null : () => showReportIssueDialog(context),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

Color _workOrderStatusColor(String status) => switch (status) {
  'OPEN' => AppTheme.danger,
  'IN_PROGRESS' => AppTheme.draft,
  _ => AppTheme.vacant,
};

class _WorkOrderCard extends StatelessWidget {
  final WorkOrder workOrder;
  final VoidCallback onTap;

  const _WorkOrderCard({required this.workOrder, required this.onTap});

  Color get _statusColor => _workOrderStatusColor(workOrder.status);

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          IconBadge(icon: issueTypeIcon(workOrder.issueType), color: _statusColor),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        workOrder.assetName,
                        style: Theme.of(context).textTheme.titleSmall,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(color: _statusColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                      child: Text(
                        kWorkOrderStatusLabel[workOrder.status] ?? workOrder.status,
                        style: TextStyle(color: _statusColor, fontSize: 10.5, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  '${kIssueTypeLabel[workOrder.issueType] ?? workOrder.issueType} · ${formatDateTime(workOrder.openedAt)}',
                  style: Theme.of(context).textTheme.bodySmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  workOrder.description,
                  style: const TextStyle(color: AppTheme.text, fontSize: 12.5),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                if (workOrder.assignedToName.isNotEmpty || workOrder.vendorName != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    [workOrder.assignedToName, workOrder.vendorName].whereType<String>().where((s) => s.isNotEmpty).join(' · '),
                    style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A colored status pill for the work order form's status picker — same
/// red/amber/green language as the list card's status chip, so picking a
/// status previews the color it'll show as once saved.
class _StatusOption extends StatelessWidget {
  final String label;
  final Color color;
  final bool selected;
  final VoidCallback onTap;

  const _StatusOption({required this.label, required this.color, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
        decoration: BoxDecoration(
          color: selected ? color.withValues(alpha: 0.12) : AppTheme.bg,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: selected ? color : AppTheme.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (selected) ...[
              Icon(Icons.circle, size: 8, color: color),
              const SizedBox(width: 6),
            ],
            Text(label, style: TextStyle(color: selected ? color : AppTheme.text, fontSize: 12.5, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}

/// Whoever is on the hook for an asset right now — the AMC vendor if there's
/// a live one, otherwise whoever gave the warranty, otherwise nobody. Mirrors
/// resolveActiveCoverageVendor in AssetsPanel.jsx: coverage periods come back
/// newest-end-date-first, so the first non-expired row of each type is that
/// type's current one, and AMC is checked first because an asset under an
/// active AMC is contractually that vendor's problem even if the maker's
/// warranty technically hasn't lapsed yet.
Future<int?> _resolveActiveCoverageVendorId(WidgetRef ref, int assetId) async {
  final periods = await ref.read(assetsViewModelProvider.notifier).coverage(assetId);
  final today = DateTime.now();
  CoveragePeriod? current(String type) {
    for (final p in periods) {
      if (p.coverageType != type || p.vendorId == null) continue;
      final end = DateTime.tryParse(p.endDate);
      if (end != null && !end.isBefore(today)) return p;
    }
    return null;
  }

  return (current('AMC') ?? current('WARRANTY'))?.vendorId;
}

/// Opens "Report an issue", optionally pre-selected to one asset — used by
/// the row menu's Report issue action, same shorthand as reportIssue() in
/// AssetsPanel.jsx. With no asset given, this is the FAB's plain "+".
Future<void> showReportIssueDialog(BuildContext context, {int? assetId}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => _WorkOrderFormScreen(presetAssetId: assetId)),
  );
}

/// Opens a work order for editing — used by the asset detail screen's
/// service history list, same as clicking a row in AssetsPanel.jsx's
/// service-history ledger.
Future<void> showWorkOrderDialog(BuildContext context, {required WorkOrder workOrder}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => _WorkOrderFormScreen(workOrder: workOrder)),
  );
}

/// Report an issue / Edit work order / Bulk work order — one screen with the
/// same Single ↔ Bulk by category toggle as the web modal. Bulk opens one
/// work order for every active asset in a category at once (a contractor's
/// routine AMC visit); Single (and editing) file one against a chosen asset.
class _WorkOrderFormScreen extends ConsumerStatefulWidget {
  final WorkOrder? workOrder;
  final int? presetAssetId;
  const _WorkOrderFormScreen({this.workOrder, this.presetAssetId});

  @override
  ConsumerState<_WorkOrderFormScreen> createState() => _WorkOrderFormScreenState();
}

class _WorkOrderFormScreenState extends ConsumerState<_WorkOrderFormScreen> {
  bool _bulk = false;

  int? _assetId;
  int? _categoryId;
  late String _issueType = widget.workOrder?.issueType ?? 'BREAKDOWN';
  late String _status = widget.workOrder?.status ?? 'OPEN';
  late int? _vendorId = widget.workOrder?.vendorId;
  late final _description = TextEditingController(text: widget.workOrder?.description ?? '');
  late final _assignedTo = TextEditingController(text: widget.workOrder?.assignedToName ?? '');
  late final _partsCost = TextEditingController(text: widget.workOrder?.partsCost?.toString() ?? '');
  late final _laborCost = TextEditingController(text: widget.workOrder?.laborCost?.toString() ?? '');
  late final _resolutionNote = TextEditingController(text: widget.workOrder?.resolutionNote ?? '');
  // Forwarded onto the expense a costed work order auto-generates — never
  // stored on the work order itself (see paymentMethodSchema in
  // assets.schema.js), so there's nothing on [widget.workOrder] to seed
  // these from.
  String _paymentStatus = 'PAID';
  String _paymentMethod = 'CASH';
  final _amountPaid = TextEditingController();
  final _referenceNumber = TextEditingController();
  String? _error;
  bool _submitAttempted = false;

  bool get _isEdit => widget.workOrder != null;

  String? get _categoryError =>
      (_submitAttempted && _bulk && _categoryId == null) ? 'Choose a category.' : null;
  String? get _assetError =>
      (_submitAttempted && !_bulk && _assetId == null) ? 'Choose an asset.' : null;
  String? get _descriptionError =>
      (_submitAttempted && _description.text.trim().isEmpty) ? 'Describe the issue.' : null;

  final _categoryOrAssetFieldKey = GlobalKey();
  final _descriptionFieldKey = GlobalKey();
  final _descriptionFocus = FocusNode();

  void _scrollToFirstError() {
    GlobalKey? key;
    FocusNode? focus;
    if (_categoryError != null || _assetError != null) {
      key = _categoryOrAssetFieldKey;
    } else if (_descriptionError != null) {
      key = _descriptionFieldKey;
      focus = _descriptionFocus;
    }
    if (key == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ctx = key!.currentContext;
      if (ctx != null) {
        Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 300), curve: Curves.easeOut, alignment: 0.15);
      }
      focus?.requestFocus();
    });
  }

  @override
  void initState() {
    super.initState();
    _assetId = widget.presetAssetId ?? widget.workOrder?.assetId;
    if (!_isEdit && _assetId != null) _prefillVendor(_assetId!);
  }

  Future<void> _prefillVendor(int assetId) async {
    final vendorId = await _resolveActiveCoverageVendorId(ref, assetId);
    if (mounted && vendorId != null) setState(() => _vendorId = vendorId);
  }

  @override
  void dispose() {
    _description.dispose();
    _assignedTo.dispose();
    _partsCost.dispose();
    _laborCost.dispose();
    _resolutionNote.dispose();
    _amountPaid.dispose();
    _referenceNumber.dispose();
    _descriptionFocus.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _submitAttempted = true);
    if (_categoryError != null || _assetError != null || _descriptionError != null) {
      _scrollToFirstError();
      return;
    }
    final vm = ref.read(assetsViewModelProvider.notifier);
    bool ok;
    if (_isEdit) {
      ok = await vm.updateWorkOrder(widget.workOrder!.id, {
        'status': _status,
        'issueType': _issueType,
        'description': _description.text.trim(),
        'assignedToName': _assignedTo.text.trim(),
        'vendorId': _vendorId,
        'partsCost': num.tryParse(_partsCost.text.trim()),
        'laborCost': num.tryParse(_laborCost.text.trim()),
        'paymentMethod': _paymentMethod,
        'paymentStatus': _paymentStatus,
        'amountPaid': _paymentStatus == 'PARTIAL' ? _amountPaid.text.trim() : '',
        'referenceNumber': _paymentStatus != 'PENDING' ? _referenceNumber.text.trim() : '',
        'resolutionNote': _resolutionNote.text.trim(),
      });
    } else if (_bulk) {
      ok = await vm.saveWorkOrdersBulk({
        'categoryId': _categoryId,
        'issueType': _issueType,
        'description': _description.text.trim(),
        'assignedToName': _assignedTo.text.trim(),
        'vendorId': _vendorId,
      });
    } else {
      ok = await vm.saveWorkOrder({
        'assetId': _assetId,
        'issueType': _issueType,
        'description': _description.text.trim(),
        'assignedToName': _assignedTo.text.trim(),
        'vendorId': _vendorId,
      });
    }
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(assetsViewModelProvider).error ?? 'Could not save the work order.');
    }
  }

  /// The same accent-tinted focus/hover tint the rest of the app's
  /// dropdowns open with, instead of Material's plain grey highlight on the
  /// selected row.
  Widget _accentDropdownTheme(BuildContext context, Widget child) {
    return Theme(
      data: Theme.of(context).copyWith(
        focusColor: AppTheme.accent.withValues(alpha: 0.1),
        hoverColor: AppTheme.accent.withValues(alpha: 0.06),
      ),
      child: child,
    );
  }

  DropdownMenuItem<int?> _nullableMenuItem(int? id, String label, int? selectedValue) {
    final selected = id == selectedValue;
    return DropdownMenuItem<int?>(
      value: id,
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13.5,
                color: selected ? AppTheme.accent : AppTheme.text,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
              ),
            ),
          ),
          if (selected) const Icon(Icons.check_rounded, color: AppTheme.accent, size: 16),
        ],
      ),
    );
  }

  DropdownMenuItem<int> _menuItem(int id, String label, bool selected) {
    return DropdownMenuItem<int>(
      value: id,
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13.5,
                color: selected ? AppTheme.accent : AppTheme.text,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
              ),
            ),
          ),
          if (selected) const Icon(Icons.check_rounded, color: AppTheme.accent, size: 16),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(assetsViewModelProvider);
    final issueTypes = _bulk ? ['ROUTINE_SERVICE', 'BREAKDOWN'] : kIssueTypeLabel.keys.toList();

    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _isEdit ? 'Work order' : (_bulk ? 'Bulk work order' : 'Report an issue'),
              overflow: TextOverflow.ellipsis,
              maxLines: 1,
            ),
            if (_isEdit) Text(
              widget.workOrder!.assetName,
              overflow: TextOverflow.ellipsis,
              maxLines: 1,
              style: const TextStyle(color: AppTheme.muted, fontSize: 12, fontWeight: FontWeight.w500),
            ),
          ],
        ),
      ),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: AppTheme.maxContentWidth),
            child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s12, AppTheme.s12, AppTheme.s16),
          children: [
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
              const SizedBox(height: AppTheme.s12),
            ],
            if (!_isEdit) ...[
              Align(
                alignment: Alignment.centerLeft,
                child: ModeToggle(
                  options: const {'single': 'Single', 'bulk': 'Bulk by category'},
                  selected: _bulk ? 'bulk' : 'single',
                  onSelect: (v) => setState(() => _bulk = v == 'bulk'),
                ),
              ),
              const SizedBox(height: AppTheme.s16),
            ],

            if (_bulk || !_isEdit) ...[
              NeuCard(
                key: _categoryOrAssetFieldKey,
                radius: AppTheme.rLarge,
                shadow: AppTheme.elevated,
                padding: const EdgeInsets.all(AppTheme.s12 + 2),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SectionLabel(_bulk ? 'Category' : 'Asset', number: 1, icon: Icons.inventory_2_rounded),
                    const SizedBox(height: AppTheme.s12),
                    if (_bulk) ...[
                      Text(
                        'Opens one work order for every active asset in the category you pick — e.g. every '
                        "split AC, all at once, for a contractor's routine visit.",
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: AppTheme.s12),
                      const RequiredLabel('Category'),
                      const SizedBox(height: 4),
                      NeuPressed(
                        hasError: _categoryError != null,
                        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                        child: _accentDropdownTheme(
                          context,
                          DropdownButtonHideUnderline(
                            child: DropdownButton<int>(
                              isExpanded: true,
                              value: _categoryId,
                              dropdownColor: AppTheme.card,
                              borderRadius: BorderRadius.circular(AppTheme.rMedium),
                              elevation: 3,
                              itemHeight: null,
                              hint: const Text('Choose a category', style: TextStyle(color: AppTheme.muted, fontSize: 13.5)),
                              items: [
                                for (final c in state.activeCategories)
                                  _menuItem(c.id, c.name, c.id == _categoryId),
                              ],
                              onChanged: (v) => setState(() => _categoryId = v),
                            ),
                          ),
                        ),
                      ),
                      if (_categoryError != null) ...[
                        const SizedBox(height: AppTheme.s4),
                        Text(_categoryError!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
                      ],
                    ] else ...[
                      const RequiredLabel('Asset'),
                      const SizedBox(height: 4),
                      NeuPressed(
                        hasError: _assetError != null,
                        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                        child: _accentDropdownTheme(
                          context,
                          DropdownButtonHideUnderline(
                            child: DropdownButton<int>(
                              isExpanded: true,
                              value: _assetId,
                              dropdownColor: AppTheme.card,
                              borderRadius: BorderRadius.circular(AppTheme.rMedium),
                              elevation: 3,
                              itemHeight: null,
                              hint: const Text('Choose an asset', style: TextStyle(color: AppTheme.muted, fontSize: 13.5)),
                              items: [
                                for (final a in state.assets) _menuItem(a.id, a.name, a.id == _assetId),
                              ],
                              onChanged: (v) {
                                setState(() => _assetId = v);
                                if (v != null) _prefillVendor(v);
                              },
                            ),
                          ),
                        ),
                      ),
                      if (_assetError != null) ...[
                        const SizedBox(height: AppTheme.s4),
                        Text(_assetError!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
                      ],
                    ],
                  ],
                ),
              ),
              const SizedBox(height: AppTheme.s12),
            ],

            NeuCard(
              radius: AppTheme.rLarge,
              shadow: AppTheme.elevated,
              padding: const EdgeInsets.all(AppTheme.s12 + 2),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SectionLabel('Issue', number: _bulk || !_isEdit ? 2 : 1, icon: Icons.report_problem_rounded),
                  const SizedBox(height: AppTheme.s12),
                  Text('Type', style: AppTheme.fieldLabel(context)),
                  const SizedBox(height: 6),
                  ModeToggle(
                    options: {for (final t in issueTypes) t: kIssueTypeLabel[t] ?? t},
                    selected: _issueType,
                    onSelect: (v) => setState(() => _issueType = v),
                  ),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    dense: true,
                    key: _descriptionFieldKey,
                    controller: _description,
                    label: 'Description',
                    hint: _bulk ? 'e.g. Quarterly AMC service visit' : "Won't switch on",
                    required: true,
                    maxLength: 400,
                    errorText: _descriptionError,
                    focusNode: _descriptionFocus,
                    onChanged: (_) => setState(() {}),
                  ),
                  if (_isEdit) ...[
                    const SizedBox(height: AppTheme.s12),
                    Text('Status', style: AppTheme.fieldLabel(context)),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: AppTheme.s8,
                      runSpacing: AppTheme.s8,
                      children: [
                        for (final s in kWorkOrderStatuses)
                          _StatusOption(
                            label: kWorkOrderStatusLabel[s]!,
                            color: _workOrderStatusColor(s),
                            selected: _status == s,
                            onTap: () => setState(() => _status = s),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s12),

            NeuCard(
              radius: AppTheme.rLarge,
              shadow: AppTheme.elevated,
              padding: const EdgeInsets.all(AppTheme.s12 + 2),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SectionLabel('Assignment', number: _bulk || !_isEdit ? 3 : 2, icon: Icons.assignment_ind_rounded),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(dense: true, controller: _assignedTo, label: 'Assigned to (optional)', hint: 'In-house handyman name', forceCapitalizeWords: true),
                  const SizedBox(height: AppTheme.s8),
                  Text('Vendor', style: AppTheme.fieldLabel(context)),
                  const SizedBox(height: 4),
                  NeuPressed(
                    padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                    child: _accentDropdownTheme(
                      context,
                      DropdownButtonHideUnderline(
                        child: DropdownButton<int?>(
                          isExpanded: true,
                          value: _vendorId,
                          dropdownColor: AppTheme.card,
                          borderRadius: BorderRadius.circular(AppTheme.rMedium),
                          elevation: 3,
                          itemHeight: null,
                          hint: const Text('None', style: TextStyle(color: AppTheme.muted, fontSize: 13.5)),
                          items: [
                            _nullableMenuItem(null, 'None', _vendorId),
                            for (final v in state.activeVendors) _nullableMenuItem(v.id, v.name, _vendorId),
                          ],
                          onChanged: (v) => setState(() => _vendorId = v),
                        ),
                      ),
                    ),
                  ),
                  if (!_bulk) ...[
                    const SizedBox(height: 4),
                    const Text(
                      "Filled in from the asset's current AMC or warranty, if it has one on file — change it if "
                      'someone else is doing this repair.',
                      style: TextStyle(color: AppTheme.muted, fontSize: 11.5),
                    ),
                  ],
                  if (_isEdit) ...[
                    const SizedBox(height: AppTheme.s8),
                    Row(
                      children: [
                        Expanded(child: NeuField(dense: true, controller: _partsCost, label: 'Parts cost', keyboardType: TextInputType.number)),
                        const SizedBox(width: AppTheme.s8),
                        Expanded(child: NeuField(dense: true, controller: _laborCost, label: 'Labor cost', keyboardType: TextInputType.number)),
                      ],
                    ),
                    // Forwarded onto the expense a costed work order
                    // auto-generates — mirrors woForm.paymentStatus/
                    // paymentMethod/amountPaid/referenceNumber in
                    // AssetsPanel.jsx.
                    const SizedBox(height: AppTheme.s12),
                    Text('Payment status', style: AppTheme.fieldLabel(context)),
                    const SizedBox(height: 4),
                    OptionDropdown(
                      values: kPaymentStatuses,
                      labels: _paymentStatusOptionLabel,
                      selected: _paymentStatus,
                      onSelect: (v) => setState(() => _paymentStatus = v),
                    ),
                    if (_paymentStatus != 'PENDING') ...[
                      const SizedBox(height: AppTheme.s12),
                      Text('Paid via', style: AppTheme.fieldLabel(context)),
                      const SizedBox(height: 4),
                      OptionDropdown(
                        values: kPaymentMethods,
                        labels: kPaymentMethodLabel,
                        selected: _paymentMethod,
                        onSelect: (v) => setState(() => _paymentMethod = v),
                      ),
                      if (kPaymentReferenceLabel[_paymentMethod] != null) ...[
                        const SizedBox(height: AppTheme.s8),
                        NeuField(dense: true, controller: _referenceNumber, label: kPaymentReferenceLabel[_paymentMethod]!),
                      ],
                    ],
                    if (_paymentStatus == 'PARTIAL') ...[
                      const SizedBox(height: AppTheme.s8),
                      NeuField(dense: true, controller: _amountPaid, label: 'Amount paid so far', keyboardType: TextInputType.number),
                    ],
                    const SizedBox(height: AppTheme.s8),
                    NeuField(dense: true, controller: _resolutionNote, label: 'Resolution note (optional)', maxLength: 400),
                  ],
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s16),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: state.submitting ? null : _save,
              child: state.submitting
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text(_isEdit ? 'Save changes' : (_bulk ? 'Create work orders' : 'Save')),
            ),
          ],
        ),
          ),
        ),
      ),
    );
  }
}

