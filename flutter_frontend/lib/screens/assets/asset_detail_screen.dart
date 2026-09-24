import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../bookings/id_proof_viewer_screen.dart';
import '../theme.dart';
import 'asset_form_sheet.dart';

/// One asset's full record — mirrors AssetDetail in AssetsPanel.jsx:
/// identity, status, coverage history (warranty/AMC), open work orders and
/// the bill photo, each with its own inline action.
class AssetDetailScreen extends ConsumerStatefulWidget {
  final int assetId;
  const AssetDetailScreen({super.key, required this.assetId});

  @override
  ConsumerState<AssetDetailScreen> createState() => _AssetDetailScreenState();
}

class _AssetDetailScreenState extends ConsumerState<AssetDetailScreen> {
  Asset? _asset;
  List<CoveragePeriod> _coverage = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final vm = ref.read(assetsViewModelProvider.notifier);
    final results = await Future.wait([vm.fetchAsset(widget.assetId), vm.coverage(widget.assetId)]);
    if (!mounted) return;
    setState(() {
      _asset = results[0] as Asset?;
      _coverage = results[1] as List<CoveragePeriod>;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final workOrders = ref
        .watch(assetsViewModelProvider)
        .workOrders
        .where((w) => w.assetId == widget.assetId)
        .toList()
      ..sort((a, b) => b.openedAt.compareTo(a.openedAt));

    return Scaffold(
      appBar: AppBar(
        title: Text(_asset?.name ?? 'Asset'),
        actions: [
          if (_asset != null)
            IconButton(
              icon: const Icon(Icons.edit_outlined),
              tooltip: 'Edit',
              onPressed: () async {
                await showAssetFormSheet(context, asset: _asset);
                _load();
              },
            ),
        ],
      ),
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _asset == null
            ? const Center(child: Text('Asset not found.', style: TextStyle(color: AppTheme.muted)))
            : RefreshIndicator(
                onRefresh: _load,
                color: AppTheme.accent,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
                  children: [
                    _IdentityCard(asset: _asset!),
                    const SizedBox(height: AppTheme.s12),
                    _StatusCard(asset: _asset!, onChanged: _load),
                    const SizedBox(height: AppTheme.s12),
                    _CoverageCard(asset: _asset!, coverage: _coverage, onChanged: _load),
                    const SizedBox(height: AppTheme.s12),
                    _WorkOrdersCard(asset: _asset!, workOrders: workOrders),
                  ],
                ),
              ),
      ),
    );
  }
}

class _IdentityCard extends ConsumerWidget {
  final Asset asset;
  const _IdentityCard({required this.asset});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(asset.name, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 17)),
              ),
              if (asset.hasBillDocument)
                IconButton(
                  tooltip: 'View bill',
                  icon: const Icon(Icons.receipt_long_rounded, color: AppTheme.accent),
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => IdProofViewerScreen(
                        title: 'Bill · ${asset.name}',
                        load: () async {
                          final res = await ref.read(assetsViewModelProvider.notifier).usecase.assetBill(asset.id);
                          return (Uint8List.fromList(res.data!), res.headers.value('content-type'));
                        },
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          Text(asset.categoryName, style: const TextStyle(color: AppTheme.muted, fontSize: 13)),
          if (asset.assetTag != null) ...[
            const SizedBox(height: AppTheme.s8),
            _Row('Asset tag', asset.assetTag!),
          ],
          if (asset.brand.isNotEmpty || asset.model.isNotEmpty)
            _Row('Brand / model', [asset.brand, asset.model].where((s) => s.isNotEmpty).join(' · ')),
          if (asset.serialNumber.isNotEmpty) _Row('Serial number', asset.serialNumber),
          if (asset.purchaseDate.isNotEmpty) _Row('Purchased', formatIsoDate(asset.purchaseDate)),
          if (asset.purchaseCost != null) _Row('Purchase cost', formatPrice(asset.purchaseCost)),
          if (asset.vendorName != null) _Row('Vendor', asset.vendorName!),
          if (asset.floor.isNotEmpty || asset.department.isNotEmpty)
            _Row('Location', [if (asset.floor.isNotEmpty) 'Floor ${asset.floor}', asset.department].where((s) => s.isNotEmpty).join(' · ')),
          if (asset.locationNote.isNotEmpty) _Row('Note', asset.locationNote),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final String label;
  final String value;
  const _Row(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 110, child: Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 12.5))),
          Expanded(child: Text(value, style: const TextStyle(color: AppTheme.text, fontSize: 13))),
        ],
      ),
    );
  }
}

class _StatusCard extends ConsumerWidget {
  final Asset asset;
  final VoidCallback onChanged;

  const _StatusCard({required this.asset, required this.onChanged});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Status', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 15)),
          const SizedBox(height: AppTheme.s8),
          Wrap(
            spacing: AppTheme.s8,
            runSpacing: AppTheme.s8,
            children: [
              for (final s in kAssetStatuses)
                ChoiceChip(
                  label: Text(kAssetStatusLabel[s]!),
                  selected: asset.status == s,
                  onSelected: (_) async {
                    if (asset.status == s) return;
                    final ok = await ref.read(assetsViewModelProvider.notifier).setStatus(asset.id, s);
                    if (ok) onChanged();
                  },
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CoverageCard extends ConsumerWidget {
  final Asset asset;
  final List<CoveragePeriod> coverage;
  final VoidCallback onChanged;

  const _CoverageCard({required this.asset, required this.coverage, required this.onChanged});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sorted = [...coverage]..sort((a, b) => b.endDate.compareTo(a.endDate));
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text('Warranty & AMC', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 15)),
              ),
              IconButton(
                icon: const Icon(Icons.add_circle_outline_rounded, color: AppTheme.accent),
                tooltip: 'Add coverage',
                onPressed: () async {
                  final saved = await showDialog<bool>(
                    context: context,
                    builder: (_) => _CoverageDialog(assetId: asset.id),
                  );
                  if (saved == true) onChanged();
                },
              ),
            ],
          ),
          if (sorted.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: AppTheme.s8),
              child: Text('No coverage on file yet.', style: TextStyle(color: AppTheme.muted, fontSize: 13)),
            )
          else
            for (final c in sorted)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${c.coverageType == 'WARRANTY' ? 'Warranty' : 'AMC'} · until ${formatIsoDate(c.endDate)}',
                            style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w500, fontSize: 13.5),
                          ),
                          if (c.vendorName != null || c.cost != null)
                            Text(
                              [if (c.vendorName != null) c.vendorName!, if (c.cost != null) formatPrice(c.cost)].join(' · '),
                              style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                            ),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.delete_outline_rounded, size: 18, color: AppTheme.danger),
                      onPressed: () async {
                        final ok = await ref.read(assetsViewModelProvider.notifier).deleteCoverage(asset.id, c.id);
                        if (ok) onChanged();
                      },
                    ),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}

class _CoverageDialog extends ConsumerStatefulWidget {
  final int assetId;
  const _CoverageDialog({required this.assetId});

  @override
  ConsumerState<_CoverageDialog> createState() => _CoverageDialogState();
}

class _CoverageDialogState extends ConsumerState<_CoverageDialog> {
  String _type = 'WARRANTY';
  final _endDate = TextEditingController();
  final _cost = TextEditingController();
  final _note = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _endDate.dispose();
    _cost.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 15),
      initialDate: now,
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(primary: AppTheme.accent, onPrimary: Colors.white, surface: AppTheme.bg, onSurface: AppTheme.heading),
        ),
        child: child!,
      ),
    );
    if (picked == null) return;
    setState(() {
      _endDate.text = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    });
  }

  Future<void> _save() async {
    if (_endDate.text.trim().isEmpty) {
      setState(() => _error = 'Enter when this coverage ends.');
      return;
    }
    final ok = await ref.read(assetsViewModelProvider.notifier).addCoverage(widget.assetId, {
      'coverageType': _type,
      'endDate': _endDate.text.trim(),
      'cost': num.tryParse(_cost.text.trim()),
      'coverageNote': _note.text.trim(),
    });
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context, true);
    } else {
      setState(() => _error = ref.read(assetsViewModelProvider).error ?? 'Could not add coverage.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(assetsViewModelProvider).submitting;
    return AlertDialog(
      backgroundColor: AppTheme.bg,
      title: const Text('Add coverage', style: TextStyle(color: AppTheme.heading)),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
              const SizedBox(height: AppTheme.s8),
            ],
            Wrap(
              spacing: AppTheme.s8,
              children: [
                ChoiceChip(label: const Text('Warranty'), selected: _type == 'WARRANTY', onSelected: (_) => setState(() => _type = 'WARRANTY')),
                ChoiceChip(label: const Text('AMC'), selected: _type == 'AMC', onSelected: (_) => setState(() => _type = 'AMC')),
              ],
            ),
            const SizedBox(height: AppTheme.s8),
            NeuField(controller: _endDate, label: 'Ends on', hint: 'Tap to pick', readOnly: true, onTap: _pickDate, required: true),
            const SizedBox(height: AppTheme.s8),
            NeuField(controller: _cost, label: 'Cost (optional)', keyboardType: TextInputType.number),
            const SizedBox(height: AppTheme.s8),
            NeuField(controller: _note, label: 'Note (optional)'),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: submitting ? null : () => Navigator.pop(context), child: const Text('Cancel')),
        TextButton(onPressed: submitting ? null : _save, child: Text(submitting ? 'Saving…' : 'Save')),
      ],
    );
  }
}

class _WorkOrdersCard extends StatelessWidget {
  final Asset asset;
  final List<WorkOrder> workOrders;

  const _WorkOrdersCard({required this.asset, required this.workOrders});

  Color _statusColor(String status) => switch (status) {
    'OPEN' => AppTheme.danger,
    'IN_PROGRESS' => AppTheme.draft,
    _ => AppTheme.vacant,
  };

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Work orders', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 15)),
          if (workOrders.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: AppTheme.s8),
              child: Text('No work orders for this asset. Report one from the Work orders tab.', style: TextStyle(color: AppTheme.muted, fontSize: 13)),
            )
          else
            for (final w in workOrders)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      margin: const EdgeInsets.only(top: 3),
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(color: _statusColor(w.status).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                      child: Text(kWorkOrderStatusLabel[w.status] ?? w.status, style: TextStyle(color: _statusColor(w.status), fontSize: 10.5, fontWeight: FontWeight.w700)),
                    ),
                    const SizedBox(width: AppTheme.s8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(w.description, style: const TextStyle(color: AppTheme.heading, fontSize: 13.5)),
                          Text(formatDateTime(w.openedAt), style: const TextStyle(color: AppTheme.muted, fontSize: 11.5)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}
