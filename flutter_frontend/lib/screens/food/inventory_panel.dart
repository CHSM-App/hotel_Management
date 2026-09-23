import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/inventory.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

const _kUnits = ['KG', 'G', 'L', 'ML', 'PCS'];
const _kUnitLabel = {'KG': 'kg', 'G': 'g', 'L': 'L', 'ML': 'ml', 'PCS': 'pcs'};
// Order and labels mirror inventoryUnits.js's CATEGORIES — the order a store
// room is walked (sacks first, little jars last, OTHER meaning "not filed").
const _kCategories = [
  'GRAINS',
  'PRODUCE',
  'PROTEIN',
  'BAKERY',
  'STAPLES',
  'SPICES',
  'BOTTLED',
  'OTHER',
];
const _kCategoryLabel = {
  'GRAINS': 'Grains & Pulses',
  'PRODUCE': 'Vegetables & Fresh',
  'PROTEIN': 'Dairy, Egg & Meat',
  'BAKERY': 'Bakery',
  'STAPLES': 'Oils & Staples',
  'SPICES': 'Spices & Masalas',
  'BOTTLED': 'Sauces & Bottled',
  'OTHER': 'Other',
};
const _kReasonLabel = {
  'OPENING': 'Opening stock',
  'PURCHASE': 'Purchase',
  'ADJUSTMENT': 'Correction',
  'CONSUMPTION': 'Cooked',
  'REVERSAL': 'Reversed',
};

String _fmtQty(num n) =>
    n == n.roundToDouble() ? n.toInt().toString() : n.toStringAsFixed(3);

class _MaterialGroup {
  final String key;
  final String label;
  final List<RawMaterial> materials;
  const _MaterialGroup({
    required this.key,
    required this.label,
    required this.materials,
  });
}

/// Groups a flat material list into _kCategories order, dropping headings
/// nothing landed under — mirrors inventoryUnits.js's groupByCategory.
List<_MaterialGroup> _groupByCategory(List<RawMaterial> materials) {
  return _kCategories
      .map(
        (key) => _MaterialGroup(
          key: key,
          label: _kCategoryLabel[key] ?? key,
          materials: materials
              .where((m) => (m.category.isEmpty ? 'OTHER' : m.category) == key)
              .toList(),
        ),
      )
      .where((g) => g.materials.isNotEmpty)
      .toList();
}

/// Menu & QR codes > Inventory — mirrors InventoryPanel.jsx: the store
/// cupboard, its low-stock and below-zero flags, and the stock ledger behind
/// each material.
class InventoryPanel extends ConsumerStatefulWidget {
  const InventoryPanel({super.key});

  @override
  ConsumerState<InventoryPanel> createState() => _InventoryPanelState();
}

class _InventoryPanelState extends ConsumerState<InventoryPanel> {
  final _search = TextEditingController();
  String _query = '';
  bool _showRetired = false;
  String? _activeCategory;

  @override
  void initState() {
    super.initState();
    Future.microtask(
      () => ref.read(inventoryViewModelProvider.notifier).load(),
    );
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  List<RawMaterial> _filter(List<RawMaterial> all) {
    final q = _query.trim().toLowerCase();
    return all.where((m) {
      if (!_showRetired && !m.isActive) return false;
      if (q.isNotEmpty && !m.name.toLowerCase().contains(q)) return false;
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(inventoryViewModelProvider);
    final materials = _filter(state.materials);
    final low = state.materials.where((m) => m.isActive && m.isLow).length;
    final negative = state.materials
        .where((m) => m.isActive && m.isNegative)
        .length;
    final searching = _query.trim().isNotEmpty;

    // Every group with something in it, whatever the search says — this is
    // what the pill strip is drawn from, so a heading doesn't vanish
    // mid-typing.
    final allGroups = _groupByCategory(
      state.materials.where((m) => _showRetired || m.isActive).toList(),
    );
    final activeGroup =
        allGroups.where((g) => g.key == _activeCategory).isNotEmpty
        ? allGroups.firstWhere((g) => g.key == _activeCategory)
        : (allGroups.isNotEmpty ? allGroups.first : null);

    // Searching is a question about the whole cupboard, not the group on
    // screen, so it steps over the strip and shows every group with a hit.
    final shownGroups = searching
        ? _groupByCategory(materials)
        : _groupByCategory(
            materials,
          ).where((g) => g.key == activeGroup?.key).toList();

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(inventoryViewModelProvider.notifier).load(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              AppTheme.s16,
              AppTheme.s4,
              AppTheme.s16,
              96,
            ),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              Row(
                children: [
                  Expanded(
                    child: NeuPressed(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppTheme.s12,
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.search_rounded,
                            size: 16,
                            color: AppTheme.muted,
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: TextField(
                              controller: _search,
                              onChanged: (v) => setState(() => _query = v),
                              style: const TextStyle(fontSize: 13),
                              decoration: const InputDecoration(
                                hintText: 'Search materials',
                                hintStyle: TextStyle(fontSize: 13),
                                border: InputBorder.none,
                                isDense: true,
                                contentPadding: EdgeInsets.symmetric(
                                  vertical: 6,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  // A checkbox rather than the FilterChip this used to be —
                  // beside the search bar there's no room for a chip's own
                  // pill outline, and a plain checkbox+label reads just as
                  // clearly at that width.
                  GestureDetector(
                    onTap: () => setState(() => _showRetired = !_showRetired),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SizedBox(
                          width: 20,
                          height: 20,
                          child: Checkbox(
                            value: _showRetired,
                            onChanged: (v) =>
                                setState(() => _showRetired = v ?? false),
                            visualDensity: VisualDensity.compact,
                            materialTapTargetSize:
                                MaterialTapTargetSize.shrinkWrap,
                            activeColor: AppTheme.accent,
                          ),
                        ),
                        const SizedBox(width: 4),
                        const Text(
                          'Retired',
                          style: TextStyle(color: AppTheme.text, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.s8),
              Wrap(
                spacing: AppTheme.s8,
                runSpacing: AppTheme.s8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    '${state.materials.length} materials',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  if (low > 0) _Tag('$low running low', AppTheme.draft),
                  if (negative > 0)
                    _Tag('$negative below zero', AppTheme.danger),
                ],
              ),
              const SizedBox(height: AppTheme.s12),
              if (negative > 0)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppTheme.s12),
                  child: NeuCard(
                    padding: const EdgeInsets.all(AppTheme.s12),
                    child: const Text(
                      'Something has been cooked more than the books say you bought. Open a '
                      'material below zero, choose "Correct to a counted total", and put in '
                      'what is actually on the shelf.',
                      style: TextStyle(color: AppTheme.danger, fontSize: 12.5),
                    ),
                  ),
                ),
              if (state.isLoading && state.materials.isEmpty)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: CircularProgressIndicator(),
                  ),
                )
              else if (state.error != null && state.materials.isEmpty)
                NeuNotice(icon: Icons.cloud_off_rounded, message: state.error!)
              else if (materials.isEmpty)
                NeuNotice(
                  icon: Icons.kitchen_rounded,
                  message: state.materials.isEmpty
                      ? 'Nothing in the store cupboard yet. Add the things you buy — '
                            'rice, oil, paneer — then set what each dish takes out of them '
                            'on the Recipes tab.'
                      : 'No material matches that.',
                )
              else ...[
                // Hidden while searching, when the results decide what's shown.
                if (!searching && allGroups.isNotEmpty) ...[
                  SizedBox(
                    height: 36,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: allGroups.length,
                      separatorBuilder: (_, __) =>
                          const SizedBox(width: AppTheme.s8),
                      itemBuilder: (context, i) {
                        final g = allGroups[i];
                        final selected = g.key == activeGroup?.key;
                        final flagged = g.materials.any(
                          (m) => m.isNegative || m.isLow,
                        );
                        return GestureDetector(
                          onTap: () => setState(() => _activeCategory = g.key),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: AppTheme.s12,
                            ),
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: selected ? AppTheme.accent : AppTheme.card,
                              borderRadius: BorderRadius.circular(999),
                              border: Border.all(
                                color: selected
                                    ? AppTheme.accent
                                    : AppTheme.border,
                              ),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  g.label,
                                  style: TextStyle(
                                    color: selected
                                        ? Colors.white
                                        : AppTheme.text,
                                    fontWeight: FontWeight.w600,
                                    fontSize: 13,
                                  ),
                                ),
                                const SizedBox(width: 4),
                                Text(
                                  '${g.materials.length}',
                                  style: TextStyle(
                                    color: selected
                                        ? Colors.white70
                                        : AppTheme.muted,
                                    fontSize: 11,
                                  ),
                                ),
                                if (flagged) ...[
                                  const SizedBox(width: 4),
                                  Icon(
                                    Icons.error,
                                    size: 12,
                                    color: selected
                                        ? Colors.white
                                        : AppTheme.draft,
                                  ),
                                ],
                              ],
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: AppTheme.s12),
                ],
                for (final g in shownGroups) ...[
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppTheme.s8),
                    child: Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: AppTheme.s8,
                      children: [
                        Text(
                          g.label,
                          style: const TextStyle(
                            color: AppTheme.heading,
                            fontWeight: FontWeight.w700,
                            fontSize: 15,
                          ),
                        ),
                        Text(
                          '${g.materials.length}',
                          style: const TextStyle(
                            color: AppTheme.muted,
                            fontSize: 12,
                          ),
                        ),
                        if (g.materials.any((m) => m.isNegative))
                          _Tag(
                            '${g.materials.where((m) => m.isNegative).length} below zero',
                            AppTheme.danger,
                          ),
                        if (g.materials.any((m) => m.isLow))
                          _Tag(
                            '${g.materials.where((m) => m.isLow).length} low',
                            AppTheme.draft,
                          ),
                      ],
                    ),
                  ),
                  for (final m in g.materials)
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppTheme.s8),
                      child: _MaterialCard(material: m),
                    ),
                ],
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
            onPressed: () => showMaterialForm(context, ref),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

class _Tag extends StatelessWidget {
  final String label;
  final Color color;
  const _Tag(this.label, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _MaterialCard extends ConsumerWidget {
  final RawMaterial material;
  const _MaterialCard({required this.material});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final meta = material.lowStockThreshold > 0
        ? 'Warn at ${_fmtQty(material.lowStockThreshold)} ${_kUnitLabel[material.unit]}'
        : 'No low-stock warning set';
    final metaLine = material.usedByDishes > 0
        ? '$meta · ${material.usedByDishes} dish${material.usedByDishes == 1 ? '' : 'es'}'
        : meta;

    return NeuCard(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.s12,
        vertical: AppTheme.s8,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        material.name,
                        style: const TextStyle(
                          color: AppTheme.heading,
                          fontWeight: FontWeight.w700,
                          fontSize: 13.5,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (!material.isActive) ...[
                      const SizedBox(width: 6),
                      const _Tag('Retired', AppTheme.muted),
                    ] else if (material.isNegative) ...[
                      const SizedBox(width: 6),
                      const _Tag('Below zero', AppTheme.danger),
                    ] else if (material.isLow) ...[
                      const SizedBox(width: 6),
                      const _Tag('Low', AppTheme.draft),
                    ],
                  ],
                ),
                Text(
                  metaLine,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _fmtQty(material.quantity),
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontWeight: FontWeight.w700,
                  fontSize: 14,
                ),
              ),
              Text(
                _kUnitLabel[material.unit] ?? material.unit,
                style: const TextStyle(color: AppTheme.muted, fontSize: 10),
              ),
            ],
          ),
          const SizedBox(width: AppTheme.s8),
          SizedBox(
            height: 30,
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.accent,
                side: const BorderSide(color: AppTheme.accent),
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              onPressed: () => showAdjustStockSheet(context, ref, material),
              child: const Text(
                'Stock',
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
              ),
            ),
          ),
          const SizedBox(width: AppTheme.s4),
          _materialActionsMenu(context, ref),
        ],
      ),
    );
  }

  /// Mirrors the web's "More actions" row menu on each material: History,
  /// Edit, Retire/Restore, Delete — all in one place instead of a separate
  /// history icon plus a two-item edit/delete menu.
  Widget _materialActionsMenu(BuildContext context, WidgetRef ref) {
    return PopupMenuButton<String>(
      padding: EdgeInsets.zero,
      splashRadius: 18,
      icon: const Icon(
        Icons.more_vert_rounded,
        size: 18,
        color: AppTheme.muted,
      ),
      elevation: 3,
      color: AppTheme.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        side: const BorderSide(color: AppTheme.border),
      ),
      onSelected: (v) {
        switch (v) {
          case 'history':
            _showHistory(context, ref);
            break;
          case 'edit':
            showMaterialForm(context, ref, material: material);
            break;
          case 'retire':
            ref
                .read(inventoryViewModelProvider.notifier)
                .setMaterialActive(material.id, !material.isActive);
            break;
          case 'delete':
            _confirmDelete(context, ref);
            break;
        }
      },
      itemBuilder: (context) => [
        const PopupMenuItem(
          value: 'history',
          height: 40,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.history_rounded, size: 17, color: AppTheme.heading),
              SizedBox(width: 10),
              Text(
                'History',
                style: TextStyle(color: AppTheme.heading, fontSize: 13.5),
              ),
            ],
          ),
        ),
        const PopupMenuItem(
          value: 'edit',
          height: 40,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.edit_outlined, size: 17, color: AppTheme.heading),
              SizedBox(width: 10),
              Text(
                'Edit material',
                style: TextStyle(color: AppTheme.heading, fontSize: 13.5),
              ),
            ],
          ),
        ),
        PopupMenuItem(
          value: 'retire',
          height: 40,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                material.isActive
                    ? Icons.archive_outlined
                    : Icons.unarchive_outlined,
                size: 17,
                color: AppTheme.heading,
              ),
              const SizedBox(width: 10),
              Text(
                material.isActive ? 'Retire' : 'Restore',
                style: const TextStyle(color: AppTheme.heading, fontSize: 13.5),
              ),
            ],
          ),
        ),
        const PopupMenuItem(
          value: 'delete',
          height: 40,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.delete_outline_rounded,
                size: 17,
                color: AppTheme.danger,
              ),
              SizedBox(width: 10),
              Text(
                'Delete material',
                style: TextStyle(color: AppTheme.danger, fontSize: 13.5),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _showHistory(BuildContext context, WidgetRef ref) async {
    showDialog(
      context: context,
      builder: (_) => Dialog(
        backgroundColor: AppTheme.bg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.rLarge),
        ),
        child: _MovementsSheet(material: material),
      ),
    );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final canDelete = material.usedByDishes == 0;
    final title = canDelete
        ? 'Delete "${material.name}" and its stock history?'
        : '"${material.name}" is used by ${material.usedByDishes} dish${material.usedByDishes == 1 ? '' : 'es'} and can\'t be deleted.';
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: Text(
          title,
          style: const TextStyle(color: AppTheme.heading, fontSize: 15),
        ),
        content: Text(
          canDelete ? 'Retiring it keeps the history.' : 'Retire it instead?',
          style: const TextStyle(color: AppTheme.text, fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(
              canDelete ? 'Delete' : 'Retire',
              style: TextStyle(
                color: canDelete ? AppTheme.danger : AppTheme.accent,
              ),
            ),
          ),
        ],
      ),
    );
    if (sure != true) return;
    final vm = ref.read(inventoryViewModelProvider.notifier);
    if (canDelete) {
      await vm.deleteMaterial(material.id);
    } else {
      await vm.setMaterialActive(material.id, false);
    }
  }
}

// ── Add / edit material sheet ────────────────────────────────────────────

Future<void> showMaterialForm(
  BuildContext context,
  WidgetRef ref, {
  RawMaterial? material,
}) {
  // A full page, not a sheet — the same call the dish form made: this is a
  // short but real form (name, group, unit, opening stock, a warning level),
  // not a quick pick, and the website's own "New raw material" is a modal of
  // its own rather than a drawer.
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => _MaterialFormPage(material: material)),
  );
}

class _MaterialFormPage extends ConsumerStatefulWidget {
  final RawMaterial? material;
  const _MaterialFormPage({this.material});

  @override
  ConsumerState<_MaterialFormPage> createState() => _MaterialFormPageState();
}

class _MaterialFormPageState extends ConsumerState<_MaterialFormPage> {
  late final _name = TextEditingController(text: widget.material?.name ?? '');
  late final _quantity = TextEditingController();
  late final _threshold = TextEditingController(
    text: widget.material != null && widget.material!.lowStockThreshold > 0
        ? _fmtQty(widget.material!.lowStockThreshold)
        : '',
  );
  late String _unit = widget.material?.unit ?? 'KG';
  late String _category = widget.material?.category ?? 'OTHER';
  String? _error;
  bool _submitAttempted = false;

  bool get _editing => widget.material != null;

  String? get _nameError => (_submitAttempted && _name.text.trim().isEmpty)
      ? 'Material name is required.'
      : null;

  @override
  void dispose() {
    _name.dispose();
    _quantity.dispose();
    _threshold.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(inventoryViewModelProvider).submitting;

    return Scaffold(
      appBar: AppBar(
        title: Text(_editing ? 'Edit material' : 'New raw material'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppTheme.s12,
            AppTheme.s8,
            AppTheme.s12,
            AppTheme.s12,
          ),
          children: [
            if (_error != null) ...[
              Container(
                padding: const EdgeInsets.all(AppTheme.s8),
                decoration: BoxDecoration(
                  color: AppTheme.danger.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(AppTheme.rSmall),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.error_outline,
                      color: AppTheme.danger,
                      size: 18,
                    ),
                    const SizedBox(width: AppTheme.s8),
                    Expanded(
                      child: Text(
                        _error!,
                        style: const TextStyle(
                          color: AppTheme.danger,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppTheme.s8),
            ],
            NeuCard(
              padding: const EdgeInsets.all(AppTheme.s8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionLabel('Material', number: 1),
                  const SizedBox(height: AppTheme.s8),
                  NeuField(
                    controller: _name,
                    label: 'Material name',
                    hint: 'Basmati rice',
                    required: true,
                    errorText: _nameError,
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: AppTheme.s8),
                  const Text(
                    'Group',
                    style: TextStyle(color: AppTheme.muted, fontSize: 13),
                  ),
                  const SizedBox(height: 4),
                  OptionDropdown(
                    values: _kCategories,
                    labels: _kCategoryLabel,
                    selected: _category,
                    onSelect: (v) => setState(() => _category = v),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s8),
            NeuCard(
              padding: const EdgeInsets.all(AppTheme.s8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionLabel('Stock & unit', number: 2),
                  const SizedBox(height: AppTheme.s8),
                  if (_editing)
                    Text(
                      'Counted in ${_kUnitLabel[widget.material!.unit]}. The unit can\'t be changed '
                      'once stock has been recorded — retire this and add a new material instead.',
                      style: const TextStyle(
                        color: AppTheme.muted,
                        fontSize: 12,
                      ),
                    )
                  else ...[
                    const Text(
                      'Counted in',
                      style: TextStyle(color: AppTheme.muted, fontSize: 13),
                    ),
                    const SizedBox(height: 4),
                    OptionDropdown(
                      values: _kUnits,
                      labels: _kUnitLabel,
                      selected: _unit,
                      onSelect: (v) => setState(() => _unit = v),
                    ),
                    const SizedBox(height: AppTheme.s8),
                    NeuField(
                      controller: _quantity,
                      label: 'Stock on hand (optional)',
                      hint: '0',
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                    ),
                  ],
                  const SizedBox(height: AppTheme.s8),
                  NeuField(
                    controller: _threshold,
                    label: 'Warn me below (optional)',
                    hint: '0',
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s8),
            Align(
              alignment: Alignment.centerRight,
              child: FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerRight,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    NeuButton(
                      onPressed: submitting
                          ? null
                          : () => Navigator.of(context).pop(),
                      child: const Text('Cancel'),
                    ),
                    const SizedBox(width: AppTheme.s12),
                    NeuButton(
                      primary: true,
                      onPressed: submitting ? null : _submit,
                      child: submitting
                          ? const SizedBox(
                              height: 18,
                              width: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Text('Save'),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    setState(() {
      _error = null;
      _submitAttempted = true;
    });
    if (_name.text.trim().isEmpty) return;
    final threshold = num.tryParse(_threshold.text.trim()) ?? 0;
    final quantity = num.tryParse(_quantity.text.trim()) ?? 0;

    final vm = ref.read(inventoryViewModelProvider.notifier);
    final ok = await vm.saveMaterial(
      id: widget.material?.id,
      name: _name.text.trim(),
      unit: _unit,
      category: _category,
      quantity: quantity,
      lowStockThreshold: threshold,
    );
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(
        () => _error =
            ref.read(inventoryViewModelProvider).error ??
            'Could not save that material.',
      );
    }
  }
}

// ── Adjust stock sheet ────────────────────────────────────────────────────

Future<void> showAdjustStockSheet(
  BuildContext context,
  WidgetRef ref,
  RawMaterial material,
) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppTheme.bg,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(
        top: Radius.circular(AppTheme.rLarge),
      ),
    ),
    builder: (_) => _AdjustStockSheet(material: material),
  );
}

class _AdjustStockSheet extends ConsumerStatefulWidget {
  final RawMaterial material;
  const _AdjustStockSheet({required this.material});

  @override
  ConsumerState<_AdjustStockSheet> createState() => _AdjustStockSheetState();
}

class _AdjustStockSheetState extends ConsumerState<_AdjustStockSheet> {
  String _mode = 'ADD';
  final _quantity = TextEditingController();
  final _note = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _quantity.dispose();
    _note.dispose();
    super.dispose();
  }

  num? get _preview {
    final n = num.tryParse(_quantity.text.trim());
    if (n == null) return null;
    return _mode == 'ADD' ? widget.material.quantity + n : n;
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(inventoryViewModelProvider).submitting;
    final unit = _kUnitLabel[widget.material.unit] ?? widget.material.unit;

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(
          left: AppTheme.s16,
          right: AppTheme.s16,
          top: AppTheme.s16,
          bottom: AppTheme.s16 + MediaQuery.of(context).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.material.name,
              style: Theme.of(context).textTheme.titleMedium,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            Text(
              '${_fmtQty(widget.material.quantity)} $unit on the books.',
              style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
            ),
            const SizedBox(height: AppTheme.s16),
            if (_error != null) ...[
              Text(
                _error!,
                style: const TextStyle(color: AppTheme.danger, fontSize: 13),
              ),
              const SizedBox(height: AppTheme.s12),
            ],
            Row(
              children: [
                Expanded(
                  child: NeuButton(
                    onPressed: () => setState(() => _mode = 'ADD'),
                    primary: _mode == 'ADD',
                    child: const Text('Stock came in'),
                  ),
                ),
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: NeuButton(
                    onPressed: () => setState(() => _mode = 'SET'),
                    primary: _mode == 'SET',
                    child: const Text('Correct count'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppTheme.s16),
            NeuField(
              controller: _quantity,
              label: _mode == 'ADD'
                  ? 'How much came in ($unit)'
                  : 'Counted on the shelf ($unit)',
              hint: '0',
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
                signed: true,
              ),
              onChanged: (_) => setState(() {}),
              required: true,
            ),
            const SizedBox(height: AppTheme.s16),
            NeuField(
              controller: _note,
              label: 'Note (optional)',
              hint: 'Monday delivery',
            ),
            const SizedBox(height: AppTheme.s16),
            Text(
              '${_mode == 'ADD' ? 'Stock after this' : 'Corrected to'}: '
              '${_preview == null ? '—' : '${_fmtQty(_preview!)} $unit'}',
              style: const TextStyle(
                color: AppTheme.heading,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: AppTheme.s16),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: submitting ? null : _submit,
              child: submitting
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('Record'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    setState(() => _error = null);
    final n = num.tryParse(_quantity.text.trim());
    if (n == null) {
      setState(() => _error = 'Enter a quantity.');
      return;
    }
    final vm = ref.read(inventoryViewModelProvider.notifier);
    final ok = await vm.adjustStock(
      widget.material.id,
      mode: _mode,
      quantity: n,
      note: _note.text.trim(),
    );
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(
        () => _error =
            ref.read(inventoryViewModelProvider).error ??
            'Could not record that.',
      );
    }
  }
}

// ── Movement history ──────────────────────────────────────────────────────

class _MovementsSheet extends ConsumerStatefulWidget {
  final RawMaterial material;
  const _MovementsSheet({required this.material});

  @override
  ConsumerState<_MovementsSheet> createState() => _MovementsSheetState();
}

class _MovementsSheetState extends ConsumerState<_MovementsSheet> {
  List<StockMovement>? _movements;

  @override
  void initState() {
    super.initState();
    ref
        .read(inventoryViewModelProvider.notifier)
        .movements(widget.material.id)
        .then((m) {
          if (mounted) setState(() => _movements = m ?? []);
        });
  }

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: BoxConstraints(
        maxWidth: 440,
        maxHeight: MediaQuery.of(context).size.height * 0.7,
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.s16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.material.name,
                        style: Theme.of(context).textTheme.titleMedium,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const Text(
                        'Every movement, newest first',
                        style: TextStyle(color: AppTheme.muted, fontSize: 12),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close_rounded, color: AppTheme.muted),
                  splashRadius: 18,
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: AppTheme.s12),
            Flexible(
              child: _movements == null
                  ? const Padding(
                      padding: EdgeInsets.all(AppTheme.s16),
                      child: Center(child: CircularProgressIndicator()),
                    )
                  : _movements!.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.all(AppTheme.s16),
                      child: Center(
                        child: Text(
                          'Nothing has moved yet.',
                          style: TextStyle(color: AppTheme.muted),
                        ),
                      ),
                    )
                  // shrinkWrap so a short history doesn't force the
                  // dialog to the full maxHeight — it only grows to fill
                  // the window (and starts scrolling, with a thumb to
                  // show there's more) once the list is long enough to
                  // hit that cap.
                  : ScrollbarTheme(
                      data: ScrollbarThemeData(
                        thumbColor: WidgetStateProperty.all(
                          AppTheme.muted.withValues(alpha: 0.35),
                        ),
                        trackColor: WidgetStateProperty.all(Colors.transparent),
                        trackBorderColor: WidgetStateProperty.all(
                          Colors.transparent,
                        ),
                        radius: const Radius.circular(AppTheme.rMedium),
                        thickness: WidgetStateProperty.all(4),
                      ),
                      child: Scrollbar(
                        thumbVisibility: true,
                        child: ListView.separated(
                          shrinkWrap: true,
                          padding: const EdgeInsets.only(right: AppTheme.s12),
                          itemCount: _movements!.length,
                          separatorBuilder: (_, __) => const Divider(
                            height: AppTheme.s16,
                            color: AppTheme.border,
                          ),
                          itemBuilder: (context, i) {
                            final m = _movements![i];
                            final out = m.changeQty < 0;
                            return Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        _kReasonLabel[m.reason] ?? m.reason,
                                        style: const TextStyle(
                                          color: AppTheme.heading,
                                          fontWeight: FontWeight.w600,
                                          fontSize: 13,
                                        ),
                                      ),
                                      Text(
                                        m.orderNumber != null
                                            ? 'Order #${m.orderNumber}${m.itemName != null ? ' · ${m.itemName}' : ''}'
                                            : (m.note?.isNotEmpty == true
                                                  ? m.note!
                                                  : (m.byName ?? '—')),
                                        style: const TextStyle(
                                          color: AppTheme.muted,
                                          fontSize: 11.5,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                Text(
                                  '${m.changeQty > 0 ? '+' : ''}${_fmtQty(m.changeQty)}',
                                  style: TextStyle(
                                    color: out
                                        ? AppTheme.danger
                                        : AppTheme.vacant,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            );
                          },
                        ),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
