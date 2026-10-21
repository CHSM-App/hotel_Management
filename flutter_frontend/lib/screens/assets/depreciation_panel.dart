import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../rooms/room_form_pieces.dart' show OptionDropdown, SectionLabel;
import '../../widgets/neu.dart';
import '../theme.dart';

/// Assets > Depreciation — mirrors the Depreciation tab in AssetsPanel.jsx:
/// every category and its current rate, tap to edit. A category needs a
/// rate before its assets can appear on the Profit & Loss report.
class DepreciationPanel extends ConsumerWidget {
  const DepreciationPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(assetsViewModelProvider);
    final categories = [...state.categories]..sort((a, b) => a.name.compareTo(b.name));

    return RefreshIndicator(
      onRefresh: () => ref.read(assetsViewModelProvider.notifier).loadCatalogue(),
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s8, AppTheme.s12, 32),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8 + 2),
            margin: const EdgeInsets.only(bottom: AppTheme.s12),
            decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
            child: const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.info_outline_rounded, size: 16, color: AppTheme.accent),
                SizedBox(width: AppTheme.s8),
                Expanded(
                  child: Text(
                    'Every category needs a depreciation rate before its assets can appear on the Profit & Loss '
                    'report — the method and rate on a category apply to every unit filed under it.',
                    style: TextStyle(color: AppTheme.accent, fontSize: 12, fontWeight: FontWeight.w600, height: 1.35),
                  ),
                ),
              ],
            ),
          ),
          if (state.catalogueLoading && categories.isEmpty)
            const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
          else if (categories.isEmpty)
            const NeuNotice(icon: Icons.category_outlined, message: 'No categories yet. Register an asset first to create one.')
          else
            for (final c in categories)
              Padding(
                padding: const EdgeInsets.only(bottom: AppTheme.s8),
                child: _CategoryCard(category: c, onTap: () => _editDepreciation(context, c)),
              ),
        ],
      ),
    );
  }

  Future<void> _editDepreciation(BuildContext context, AssetCategory category) {
    return Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => DepreciationFormScreen(category: category)),
    );
  }
}

class _CategoryCard extends StatelessWidget {
  final AssetCategory category;
  final VoidCallback onTap;

  const _CategoryCard({required this.category, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final rate = category.depreciationRatePercent;
    final isSet = rate != null;
    final meta = isSet
        ? [if (category.depreciationBlock != null) category.depreciationBlock!, category.depreciationMethod == 'SLM' ? 'Straight-line' : 'WDV'].join(' · ')
        : 'No rate set';
    final color = isSet ? AppTheme.vacant : AppTheme.draft;

    return NeuCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8 + 2),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), shape: BoxShape.circle),
            alignment: Alignment.center,
            child: Icon(isSet ? Icons.check_rounded : Icons.priority_high_rounded, size: 17, color: color),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(category.name, style: Theme.of(context).textTheme.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text(
                  meta,
                  style: TextStyle(color: isSet ? AppTheme.muted : color, fontSize: 12, fontWeight: isSet ? FontWeight.w500 : FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          if (isSet) ...[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
              decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(999)),
              child: Text('$rate%', style: const TextStyle(color: AppTheme.accent, fontSize: 12.5, fontWeight: FontWeight.w800)),
            ),
            const SizedBox(width: 6),
          ],
          const Icon(Icons.chevron_right_rounded, color: AppTheme.muted, size: 20),
        ],
      ),
    );
  }
}

/// Edit one category's depreciation block/method/rate — mirrors the
/// depreciation modal in AssetsPanel.jsx.
class DepreciationFormScreen extends ConsumerStatefulWidget {
  final AssetCategory category;
  const DepreciationFormScreen({super.key, required this.category});

  @override
  ConsumerState<DepreciationFormScreen> createState() => _DepreciationFormScreenState();
}

class _DepreciationFormScreenState extends ConsumerState<DepreciationFormScreen> {
  late String _block = widget.category.depreciationBlock ?? '';
  late String _method = widget.category.depreciationMethod;
  late final _rate = TextEditingController(text: widget.category.depreciationRatePercent?.toString() ?? '');
  String? _error;

  @override
  void dispose() {
    _rate.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final body = {
      'depreciationBlock': _block,
      'depreciationMethod': _method,
      'depreciationRatePercent': _rate.text.trim(),
    };
    final ok = await ref.read(assetsViewModelProvider.notifier).saveDepreciation(widget.category.id, body);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(assetsViewModelProvider).error ?? 'Could not save that rate. Try again.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(assetsViewModelProvider).submitting;
    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Depreciation rate',
              overflow: TextOverflow.ellipsis,
              maxLines: 1,
            ),
            Text(
              widget.category.name,
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
                  const SizedBox(height: AppTheme.s8),
                ],
                NeuCard(
                  radius: AppTheme.rLarge,
                  shadow: AppTheme.elevated,
                  padding: const EdgeInsets.all(AppTheme.s12 + 2),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SectionLabel('Rate', number: 1, icon: Icons.percent_rounded),
                      const SizedBox(height: AppTheme.s12),
                      const Text('IT Act block', style: TextStyle(color: AppTheme.muted, fontSize: 12.5)),
                      const SizedBox(height: AppTheme.s4),
                      OptionDropdown(
                        values: ['', ...kItActBlocks.keys],
                        labels: {
                          '': 'Custom / not set',
                          for (final e in kItActBlocks.entries) e.key: '${e.key} (${e.value}%)',
                        },
                        selected: _block,
                        onSelect: (v) => setState(() {
                          _block = v;
                          final preset = kItActBlocks[v];
                          if (preset != null) _rate.text = preset.toString();
                        }),
                      ),
                      const SizedBox(height: AppTheme.s12),
                      const Text('Method', style: TextStyle(color: AppTheme.muted, fontSize: 12.5)),
                      const SizedBox(height: AppTheme.s4),
                      OptionDropdown(
                        values: kDepreciationMethods,
                        labels: kDepreciationMethodLabel,
                        selected: _method,
                        onSelect: (v) => setState(() => _method = v),
                      ),
                      const SizedBox(height: AppTheme.s12),
                      NeuField(
                        dense: true,
                        controller: _rate,
                        label: _method == 'SLM' ? 'Straight-line rate (% of cost per year)' : 'WDV rate (%)',
                        hint: 'e.g. 15',
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppTheme.s16),
                NeuButton(
                  primary: true,
                  expand: true,
                  onPressed: submitting ? null : _save,
                  child: submitting
                      ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Save'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
