import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/inventory.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

const _kUnitLabel = {'KG': 'kg', 'G': 'g', 'L': 'L', 'ML': 'ml', 'PCS': 'pcs'};

/// A dish's own size is edited by the gram, whatever its material is counted
/// in by the kilo — recipeUnitLabel on the web. Grams and millilitres are
/// already the fine unit for their family, so only kg/L step down.
String _recipeUnitLabel(String unit) => switch (unit) {
  'KG' => 'g',
  'L' => 'ml',
  _ => _kUnitLabel[unit] ?? unit,
};

/// Menu & QR codes > Recipes — mirrors RecipesPanel.jsx: which dishes have a
/// recipe and which don't, and what each takes out of the store cupboard.
class RecipesPanel extends ConsumerStatefulWidget {
  const RecipesPanel({super.key});

  @override
  ConsumerState<RecipesPanel> createState() => _RecipesPanelState();
}

class _RecipesPanelState extends ConsumerState<RecipesPanel> {
  final _search = TextEditingController();
  String _query = '';
  bool _missingOnly = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(inventoryViewModelProvider.notifier).load());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  List<RecipeDishSummary> _filter(List<RecipeDishSummary> all) {
    final q = _query.trim().toLowerCase();
    return all.where((d) {
      if (_missingOnly && d.lineCount > 0 && !d.partialSizes) return false;
      if (q.isNotEmpty && !d.name.toLowerCase().contains(q)) return false;
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(inventoryViewModelProvider);
    final dishes = _filter(state.dishes);
    final missing = state.dishes.where((d) => d.isActive && d.lineCount == 0).length;

    if (state.isLoading && state.dishes.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state.materials.isEmpty && !state.isLoading) {
      return const NeuNotice(
        icon: Icons.kitchen_rounded,
        message: 'Add what you buy on the Inventory tab first — rice, oil, '
            'paneer — then come back here to say how much of each a dish takes.',
      );
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(inventoryViewModelProvider.notifier).load(),
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          NeuPressed(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
            child: Row(
              children: [
                const Icon(Icons.search_rounded, size: 18, color: AppTheme.muted),
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: TextField(
                    controller: _search,
                    onChanged: (v) => setState(() => _query = v),
                    decoration: const InputDecoration(
                      hintText: 'Search dishes',
                      border: InputBorder.none,
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppTheme.s12),
          Wrap(
            spacing: AppTheme.s8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text('${state.dishes.length} dishes', style: Theme.of(context).textTheme.bodySmall),
              FilterChip(
                label: Text('$missing with no recipe'),
                selected: _missingOnly,
                onSelected: (v) => setState(() => _missingOnly = v),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          const Text(
            'A dish with no recipe still sells — it just doesn\'t take anything '
            'out of the store cupboard when it\'s cooked.',
            style: TextStyle(color: AppTheme.muted, fontSize: 12),
          ),
          const SizedBox(height: AppTheme.s12),
          if (dishes.isEmpty)
            const NeuNotice(icon: Icons.search_off_rounded, message: 'No dish matches that.')
          else
            for (final dish in dishes)
              Padding(
                padding: const EdgeInsets.only(bottom: AppTheme.s12),
                child: _DishCard(dish: dish),
              ),
        ],
      ),
    );
  }
}

class _DishCard extends ConsumerWidget {
  final RecipeDishSummary dish;
  const _DishCard({required this.dish});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  dish.name,
                  style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14),
                ),
                const SizedBox(height: 2),
                Text(
                  dish.lineCount == 0
                      ? 'No recipe — nothing is deducted'
                      : '${dish.lineCount} ingredient${dish.lineCount == 1 ? '' : 's'}'
                          '${dish.portionCount > 0 ? ' · ${dish.portionCount} sizes' : ''}',
                  style: TextStyle(
                    color: dish.lineCount == 0 ? AppTheme.draft : AppTheme.muted,
                    fontSize: 12,
                  ),
                ),
                if (dish.partialSizes)
                  const Text(
                    'Some sizes have no recipe',
                    style: TextStyle(color: AppTheme.danger, fontSize: 11.5),
                  ),
              ],
            ),
          ),
          NeuButton(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s8),
            onPressed: () => _openEditor(context, ref),
            child: Text(dish.lineCount == 0 ? 'Add recipe' : 'Edit recipe'),
          ),
        ],
      ),
    );
  }

  Future<void> _openEditor(BuildContext context, WidgetRef ref) async {
    final vm = ref.read(inventoryViewModelProvider.notifier);
    final recipe = await vm.openRecipe(dish.itemId);
    if (recipe == null || !context.mounted) return;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.bg,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.rLarge))),
      builder: (_) => _RecipeEditorSheet(recipe: recipe),
    );
  }
}

class _Row {
  int? materialId;
  String quantity;
  _Row({this.materialId, this.quantity = ''});
}

class _RecipeEditorSheet extends ConsumerStatefulWidget {
  final ItemRecipe recipe;
  const _RecipeEditorSheet({required this.recipe});

  @override
  ConsumerState<_RecipeEditorSheet> createState() => _RecipeEditorSheetState();
}

class _RecipeEditorSheetState extends ConsumerState<_RecipeEditorSheet> {
  bool _perSize = false;
  int? _scope; // null == 'ALL'
  late Map<int?, List<_Row>> _rowsByScope;
  String? _error;

  @override
  void initState() {
    super.initState();
    final sized = widget.recipe.lines.any((l) => l.portionId != null);
    _perSize = sized;
    _rowsByScope = {};

    if (sized) {
      for (final portion in widget.recipe.portions) {
        final rows = widget.recipe.lines
            .where((l) => l.portionId == portion.id)
            .map((l) => _Row(materialId: l.materialId, quantity: _fmt(l.quantity)))
            .toList();
        _rowsByScope[portion.id] = rows.isEmpty ? [_Row()] : rows;
      }
      _scope = widget.recipe.portions.isNotEmpty ? widget.recipe.portions.first.id : null;
    }

    final shared = widget.recipe.lines
        .where((l) => l.portionId == null)
        .map((l) => _Row(materialId: l.materialId, quantity: _fmt(l.quantity)))
        .toList();
    _rowsByScope[null] = shared.isEmpty ? [_Row()] : shared;
    if (!sized) _scope = null;
  }

  String _fmt(num n) => n == n.roundToDouble() ? n.toInt().toString() : n.toString();

  List<_Row> get _rows => _rowsByScope[_scope] ?? [];

  @override
  Widget build(BuildContext context) {
    final materials = ref
        .watch(inventoryViewModelProvider)
        .materials
        .where((m) => m.isActive)
        .toList();
    final submitting = ref.watch(inventoryViewModelProvider).submitting;

    return SafeArea(
      top: false,
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.85,
        child: Padding(
          padding: EdgeInsets.only(
            left: AppTheme.s16,
            right: AppTheme.s16,
            top: AppTheme.s16,
            bottom: AppTheme.s16 + MediaQuery.of(context).viewInsets.bottom,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(widget.recipe.name, style: Theme.of(context).textTheme.titleMedium),
              const Text(
                'What one serving takes out of the store cupboard.',
                style: TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
              const SizedBox(height: AppTheme.s12),
              if (_error != null) ...[
                Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 13)),
                const SizedBox(height: AppTheme.s8),
              ],
              if (widget.recipe.portions.isNotEmpty) ...[
                Row(
                  children: [
                    Expanded(
                      child: NeuButton(
                        onPressed: () => setState(() {
                          _perSize = false;
                          _scope = null;
                        }),
                        primary: !_perSize,
                        child: const Text('Same for every size'),
                      ),
                    ),
                    const SizedBox(width: AppTheme.s8),
                    Expanded(
                      child: NeuButton(
                        onPressed: () => setState(() {
                          _perSize = true;
                          _scope = widget.recipe.portions.first.id;
                          for (final p in widget.recipe.portions) {
                            _rowsByScope.putIfAbsent(p.id, () => [_Row()]);
                          }
                        }),
                        primary: _perSize,
                        child: const Text('Different per size'),
                      ),
                    ),
                  ],
                ),
                if (_perSize) ...[
                  const SizedBox(height: AppTheme.s8),
                  Wrap(
                    spacing: AppTheme.s8,
                    children: [
                      for (final p in widget.recipe.portions)
                        ChoiceChip(
                          label: Text(p.label),
                          selected: _scope == p.id,
                          onSelected: (_) => setState(() => _scope = p.id),
                        ),
                    ],
                  ),
                ],
                const SizedBox(height: AppTheme.s12),
              ],
              Expanded(
                child: ListView(
                  children: [
                    for (var i = 0; i < _rows.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppTheme.s8),
                        child: _ingredientRow(i, materials),
                      ),
                    TextButton.icon(
                      onPressed: () => setState(() => _rows.add(_Row())),
                      icon: const Icon(Icons.add_rounded, size: 18),
                      label: const Text('Add an ingredient'),
                    ),
                  ],
                ),
              ),
              NeuButton(
                primary: true,
                expand: true,
                onPressed: submitting ? null : _save,
                child: submitting
                    ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('Save recipe'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _ingredientRow(int index, List<RawMaterial> materials) {
    final row = _rows[index];
    RawMaterial? material;
    for (final m in materials) {
      if (m.id == row.materialId) {
        material = m;
        break;
      }
    }
    return Row(
      children: [
        Expanded(
          flex: 3,
          child: NeuPressed(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<int>(
                isExpanded: true,
                value: row.materialId,
                hint: const Text('Choose a material…', style: TextStyle(color: AppTheme.muted, fontSize: 13)),
                dropdownColor: AppTheme.card,
                items: [
                  for (final m in materials)
                    DropdownMenuItem(value: m.id, child: Text(m.name)),
                ],
                onChanged: (v) => setState(() => row.materialId = v),
              ),
            ),
          ),
        ),
        const SizedBox(width: AppTheme.s8),
        Expanded(
          flex: 2,
          child: NeuPressed(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
            child: TextField(
              controller: TextEditingController(text: row.quantity)
                ..selection = TextSelection.collapsed(offset: row.quantity.length),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                border: InputBorder.none,
                isDense: true,
                hintText: material != null ? _recipeUnitLabel(material.unit) : '0',
              ),
              onChanged: (v) => row.quantity = v,
            ),
          ),
        ),
        IconButton(
          icon: const Icon(Icons.close_rounded, size: 18, color: AppTheme.muted),
          onPressed: () => setState(() => _rows.removeAt(index)),
        ),
      ],
    );
  }

  Future<void> _save() async {
    setState(() => _error = null);
    final lines = <Map<String, dynamic>>[];
    final scopes = _perSize ? widget.recipe.portions.map((p) => p.id).toList() : [null];

    for (final scopeId in scopes) {
      final seen = <int>{};
      for (final row in _rowsByScope[scopeId] ?? const <_Row>[]) {
        if (row.materialId == null && row.quantity.trim().isEmpty) continue;
        if (row.materialId == null) {
          setState(() => _error = 'Choose a raw material for every ingredient, or clear the row.');
          return;
        }
        final value = num.tryParse(row.quantity.trim());
        if (value == null || value <= 0) {
          setState(() => _error = 'Quantities have to be above zero.');
          return;
        }
        if (seen.contains(row.materialId)) {
          setState(() => _error = 'A material is listed twice for the same size.');
          return;
        }
        seen.add(row.materialId!);
        lines.add({'portionId': scopeId, 'materialId': row.materialId, 'quantity': value});
      }
    }

    final vm = ref.read(inventoryViewModelProvider.notifier);
    final ok = await vm.saveRecipe(widget.recipe.itemId, lines);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(inventoryViewModelProvider).error ?? 'Could not save that recipe.');
    }
  }
}
