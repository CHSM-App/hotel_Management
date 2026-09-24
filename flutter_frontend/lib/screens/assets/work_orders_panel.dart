import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// Assets > Work orders — mirrors the Work Orders tab in AssetsPanel.jsx: a
/// status filter and every breakdown/service ticket, newest first, with a
/// FAB to open one and a tap-through to update or close it.
class WorkOrdersPanel extends ConsumerStatefulWidget {
  const WorkOrdersPanel({super.key});

  @override
  ConsumerState<WorkOrdersPanel> createState() => _WorkOrdersPanelState();
}

class _WorkOrdersPanelState extends ConsumerState<WorkOrdersPanel> {
  String _status = '';

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(assetsViewModelProvider.notifier).loadAssets();
      ref.read(assetsViewModelProvider.notifier).loadCatalogue();
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(assetsViewModelProvider);
    final shown = _status.isEmpty
        ? state.workOrders
        : state.workOrders.where((w) => w.status == _status).toList();
    shown.sort((a, b) => b.openedAt.compareTo(a.openedAt));

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
              Align(
                alignment: Alignment.centerLeft,
                child: _StatusFilterButton(
                  selected: _status,
                  onSelect: (s) => setState(() => _status = s),
                ),
              ),
              const SizedBox(height: AppTheme.s12),
              if (state.catalogueLoading && state.workOrders.isEmpty)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else if (shown.isEmpty)
                const NeuNotice(
                  icon: Icons.build_outlined,
                  message: 'No work orders match. Tap + to report an issue.',
                )
              else
                for (final w in shown)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppTheme.s8),
                    child: _WorkOrderCard(
                      workOrder: w,
                      onTap: () => showDialog(
                        context: context,
                        builder: (_) => _WorkOrderDialog(workOrder: w),
                      ),
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
            onPressed: state.assets.isEmpty
                ? null
                : () => showDialog(context: context, builder: (_) => const _WorkOrderDialog()),
            child: const Icon(Icons.add_rounded),
          ),
        ),
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
        for (final s in kWorkOrderStatuses) _item(s, kWorkOrderStatusLabel[s]!),
      ],
      child: NeuPressed(
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
        focused: isFiltered,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.filter_list_rounded, size: 18, color: isFiltered ? AppTheme.accent : AppTheme.muted),
            const SizedBox(width: 6),
            Text(
              isFiltered ? kWorkOrderStatusLabel[selected]! : 'All statuses',
              style: TextStyle(color: isFiltered ? AppTheme.accent : AppTheme.text, fontSize: 13, fontWeight: FontWeight.w500),
            ),
          ],
        ),
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

class _WorkOrderCard extends StatelessWidget {
  final WorkOrder workOrder;
  final VoidCallback onTap;

  const _WorkOrderCard({required this.workOrder, required this.onTap});

  Color get _statusColor => switch (workOrder.status) {
    'OPEN' => AppTheme.danger,
    'IN_PROGRESS' => AppTheme.draft,
    _ => AppTheme.vacant,
  };

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(width: 4, height: 40, decoration: BoxDecoration(color: _statusColor, borderRadius: BorderRadius.circular(2))),
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
                        style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 14.5),
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
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12),
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

class _WorkOrderDialog extends ConsumerStatefulWidget {
  final WorkOrder? workOrder;
  const _WorkOrderDialog({this.workOrder});

  @override
  ConsumerState<_WorkOrderDialog> createState() => _WorkOrderDialogState();
}

class _WorkOrderDialogState extends ConsumerState<_WorkOrderDialog> {
  int? _assetId;
  late String _issueType = widget.workOrder?.issueType ?? 'BREAKDOWN';
  late String _status = widget.workOrder?.status ?? 'OPEN';
  late final _description = TextEditingController(text: widget.workOrder?.description ?? '');
  late final _assignedTo = TextEditingController(text: widget.workOrder?.assignedToName ?? '');
  late final _partsCost = TextEditingController(text: widget.workOrder?.partsCost?.toString() ?? '');
  late final _laborCost = TextEditingController(text: widget.workOrder?.laborCost?.toString() ?? '');
  late final _resolutionNote = TextEditingController(text: widget.workOrder?.resolutionNote ?? '');
  String? _error;

  bool get _isEdit => widget.workOrder != null;

  @override
  void dispose() {
    _description.dispose();
    _assignedTo.dispose();
    _partsCost.dispose();
    _laborCost.dispose();
    _resolutionNote.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_isEdit && _assetId == null) {
      setState(() => _error = 'Choose an asset.');
      return;
    }
    if (_description.text.trim().isEmpty) {
      setState(() => _error = 'Describe the issue.');
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
        'partsCost': num.tryParse(_partsCost.text.trim()),
        'laborCost': num.tryParse(_laborCost.text.trim()),
        'resolutionNote': _resolutionNote.text.trim(),
      });
    } else {
      ok = await vm.saveWorkOrder({
        'assetId': _assetId,
        'issueType': _issueType,
        'description': _description.text.trim(),
        'assignedToName': _assignedTo.text.trim(),
      });
    }
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(assetsViewModelProvider).error ?? 'Could not save the work order.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(assetsViewModelProvider);
    return AlertDialog(
      backgroundColor: AppTheme.bg,
      title: Text(_isEdit ? 'Work order · ${widget.workOrder!.assetName}' : 'Report an issue', style: const TextStyle(color: AppTheme.heading)),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
              const SizedBox(height: AppTheme.s8),
            ],
            if (!_isEdit) ...[
              const Text('Asset', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
              const SizedBox(height: 4),
              NeuPressed(
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<int>(
                    isExpanded: true,
                    value: _assetId,
                    dropdownColor: AppTheme.card,
                    hint: const Text('Choose an asset', style: TextStyle(color: AppTheme.muted, fontSize: 13.5)),
                    items: [
                      for (final a in state.assets)
                        DropdownMenuItem(value: a.id, child: Text(a.name, style: const TextStyle(fontSize: 13.5))),
                    ],
                    onChanged: (v) => setState(() => _assetId = v),
                  ),
                ),
              ),
              const SizedBox(height: AppTheme.s8),
            ],
            const Text('Type', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
            const SizedBox(height: 4),
            Wrap(
              spacing: AppTheme.s8,
              children: [
                for (final t in kIssueTypeLabel.keys)
                  ChoiceChip(
                    label: Text(kIssueTypeLabel[t]!),
                    selected: _issueType == t,
                    onSelected: (_) => setState(() => _issueType = t),
                  ),
              ],
            ),
            const SizedBox(height: AppTheme.s8),
            NeuField(controller: _description, label: 'Description', hint: "Won't switch on", required: true, maxLength: 400),
            const SizedBox(height: AppTheme.s8),
            NeuField(controller: _assignedTo, label: 'Assigned to (optional)', hint: 'In-house / vendor name'),
            if (_isEdit) ...[
              const SizedBox(height: AppTheme.s8),
              const Text('Status', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
              const SizedBox(height: 4),
              Wrap(
                spacing: AppTheme.s8,
                children: [
                  for (final s in kWorkOrderStatuses)
                    ChoiceChip(
                      label: Text(kWorkOrderStatusLabel[s]!),
                      selected: _status == s,
                      onSelected: (_) => setState(() => _status = s),
                    ),
                ],
              ),
              const SizedBox(height: AppTheme.s8),
              Row(
                children: [
                  Expanded(child: NeuField(controller: _partsCost, label: 'Parts cost', keyboardType: TextInputType.number)),
                  const SizedBox(width: AppTheme.s8),
                  Expanded(child: NeuField(controller: _laborCost, label: 'Labor cost', keyboardType: TextInputType.number)),
                ],
              ),
              const SizedBox(height: AppTheme.s8),
              NeuField(controller: _resolutionNote, label: 'Resolution note (optional)', maxLength: 400),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: state.submitting ? null : () => Navigator.pop(context), child: const Text('Cancel')),
        TextButton(onPressed: state.submitting ? null : _save, child: Text(state.submitting ? 'Saving…' : 'Save')),
      ],
    );
  }
}
