import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/inventory.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart' show SectionLabel;
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

/// One category's dishes, in display order — see
/// [_RecipesPanelState._group].
class _CategoryGroup {
  final int categoryId;
  final String categoryName;
  final List<RecipeDishSummary> dishes;
  _CategoryGroup({required this.categoryId, required this.categoryName, required this.dishes});
}

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

  /// Groups consecutive same-category dishes under one heading — mirrors
  /// RecipesPanel.jsx's own `grouped`, which relies on the backend already
  /// sorting dishes by category rather than re-sorting on the client.
  List<_CategoryGroup> _group(List<RecipeDishSummary> dishes) {
    final out = <_CategoryGroup>[];
    for (final dish in dishes) {
      if (out.isNotEmpty && out.last.categoryId == dish.categoryId) {
        out.last.dishes.add(dish);
      } else {
        out.add(_CategoryGroup(categoryId: dish.categoryId, categoryName: dish.categoryName, dishes: [dish]));
      }
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(inventoryViewModelProvider);
    final dishes = _filter(state.dishes);
    final groups = _group(dishes);
    final activeDishes = state.dishes.where((d) => d.isActive).toList();
    final missing = activeDishes.where((d) => d.lineCount == 0).length;
    final withRecipe = activeDishes.length - missing;

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
      child: LayoutBuilder(
        builder: (context, constraints) {
          // One column per ~300px of width, so columns grow smoothly with
          // the pane instead of jumping only at the two device breakpoints.
          final columns = (constraints.maxWidth / 300).floor().clamp(1, 4);
          return ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, AppTheme.s24),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              Container(
                height: 44,
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
                      width: 30,
                      height: 30,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: AppTheme.accent.withValues(alpha: 0.10),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.search_rounded,
                        size: 15,
                        color: AppTheme.accent,
                      ),
                    ),
                    const SizedBox(width: AppTheme.s8),
                    Expanded(
                      child: TextField(
                        controller: _search,
                        onChanged: (v) => setState(() => _query = v),
                        style: const TextStyle(color: AppTheme.heading, fontSize: 13.5),
                        decoration: const InputDecoration(
                          hintText: 'Search dishes',
                          hintStyle: TextStyle(color: AppTheme.muted, fontSize: 13.5),
                          border: InputBorder.none,
                          isDense: true,
                          contentPadding: EdgeInsets.symmetric(vertical: 12),
                        ),
                      ),
                    ),
                    if (_query.isNotEmpty)
                      GestureDetector(
                        onTap: () => setState(() {
                          _search.clear();
                          _query = '';
                        }),
                        behavior: HitTestBehavior.opaque,
                        child: Container(
                          width: 26,
                          height: 26,
                          margin: const EdgeInsets.only(right: 2),
                          alignment: Alignment.center,
                          decoration: const BoxDecoration(
                            color: AppTheme.bg,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.close_rounded,
                            size: 14,
                            color: AppTheme.muted,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: AppTheme.s8),
              Row(
                children: [
                  Expanded(
                    child: _StatTile(
                      label: 'Dishes',
                      value: '${state.dishes.length}',
                      color: AppTheme.accent,
                    ),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  Expanded(
                    child: _StatTile(
                      label: 'With recipe',
                      value: '$withRecipe',
                      color: AppTheme.vacant,
                    ),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  Expanded(
                    child: _StatTile(
                      label: 'Missing',
                      value: '$missing',
                      color: AppTheme.draft,
                      selected: _missingOnly,
                      onTap: () => setState(() => _missingOnly = !_missingOnly),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.s8),
              Text(
                'A dish with no recipe still sells — it just doesn\'t take anything '
                'out of the store cupboard when it\'s cooked.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 11.5),
              ),
              const SizedBox(height: AppTheme.s12),
              if (dishes.isEmpty)
                const NeuNotice(icon: Icons.search_off_rounded, message: 'No dish matches that.')
              else
                for (final group in groups)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppTheme.s16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppTheme.s8, left: 2),
                          child: Text(
                            group.categoryName.isEmpty ? 'Other' : group.categoryName,
                            style: const TextStyle(
                              color: AppTheme.heading,
                              fontWeight: FontWeight.w700,
                              fontSize: 13,
                              letterSpacing: 0.2,
                            ),
                          ),
                        ),
                        if (columns == 1)
                          for (final dish in group.dishes)
                            Padding(
                              padding: const EdgeInsets.only(bottom: AppTheme.s8),
                              child: _DishCard(dish: dish),
                            )
                        else
                          GridView.builder(
                            shrinkWrap: true,
                            physics: const NeverScrollableScrollPhysics(),
                            itemCount: group.dishes.length,
                            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: columns,
                              crossAxisSpacing: AppTheme.s8,
                              mainAxisSpacing: AppTheme.s8,
                              mainAxisExtent: 88,
                            ),
                            itemBuilder: (context, i) => _DishCard(dish: group.dishes[i]),
                          ),
                      ],
                    ),
                  ),
            ],
          );
        },
      ),
    );
  }
}

/// A tappable summary pill used in the stats row — a filled icon badge, a
/// count, and a label underneath, with a toggled-selected outline so the
/// "Missing" tile doubles as the no-recipe filter.
class _StatTile extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final bool selected;
  final VoidCallback? onTap;

  const _StatTile({
    required this.label,
    required this.value,
    required this.color,
    this.selected = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final body = AnimatedContainer(
      duration: const Duration(milliseconds: 150),
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: AppTheme.s8),
      decoration: BoxDecoration(
        color: selected ? color.withValues(alpha: 0.06) : AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        border: Border.all(color: selected ? color : AppTheme.border, width: selected ? 1.4 : 1),
        boxShadow: AppTheme.subtle,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            value,
            style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 15, height: 1.1),
          ),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: selected ? color : AppTheme.muted, fontSize: 10.5, height: 1.2),
          ),
        ],
      ),
    );
    if (onTap == null) return body;
    return GestureDetector(onTap: onTap, child: body);
  }
}

class _DishCard extends ConsumerWidget {
  final RecipeDishSummary dish;
  const _DishCard({required this.dish});

  bool get _missing => dish.lineCount == 0;
  bool get _warn => dish.partialSizes;

  Color get _statusColor {
    if (_missing) return AppTheme.draft;
    if (_warn) return AppTheme.danger;
    return AppTheme.vacant;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statusColor = _statusColor;
    return NeuCard(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
      radius: AppTheme.rSmall,
      shadow: AppTheme.subtle,
      onTap: () => _openEditor(context, ref),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    if (dish.foodType != null) ...[
                      _FoodTypeMark(type: dish.foodType!),
                      const SizedBox(width: 6),
                    ],
                    Expanded(
                      child: Text(
                        dish.name,
                        style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                Wrap(
                  spacing: AppTheme.s4,
                  runSpacing: 2,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    _Badge(
                      color: statusColor,
                      text: _missing
                          ? 'No recipe'
                          : '${dish.lineCount} ingredient${dish.lineCount == 1 ? '' : 's'}',
                    ),
                    if (dish.portionCount > 0)
                      Text(
                        '${dish.portionCount} sizes',
                        style: const TextStyle(color: AppTheme.muted, fontSize: 10.5),
                      ),
                    if (_warn)
                      const _Badge(color: AppTheme.danger, text: 'Sizes missing'),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          NeuButton(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: AppTheme.s4),
            onPressed: () => _openEditor(context, ref),
            primary: _missing,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  _missing ? Icons.add_rounded : Icons.edit_rounded,
                  size: 13,
                  color: _missing ? Colors.white : AppTheme.heading,
                ),
                const SizedBox(width: 3),
                Text(_missing ? 'Add' : 'Edit', style: const TextStyle(fontSize: 12.5)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openEditor(BuildContext context, WidgetRef ref) async {
    final vm = ref.read(inventoryViewModelProvider.notifier);
    final recipe = await vm.openRecipe(dish.itemId);
    if (recipe == null || !context.mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => _RecipeEditorScreen(recipe: recipe)),
    );
  }
}

/// The veg/non-veg mark — a square outline with a dot of the same colour,
/// matching the web menu editor's `.food-mark` (green for VEG, red for
/// NON_VEG) so a dish reads the same way on both clients.
class _FoodTypeMark extends StatelessWidget {
  final String type;
  const _FoodTypeMark({required this.type});

  @override
  Widget build(BuildContext context) {
    final nonVeg = type.toUpperCase() == 'NON_VEG';
    final color = nonVeg ? AppTheme.danger : AppTheme.vacant;
    return Tooltip(
      message: nonVeg ? 'Non-veg' : 'Veg',
      child: Container(
        width: 12,
        height: 12,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          border: Border.all(color: color, width: 1.3),
          borderRadius: BorderRadius.circular(2),
        ),
        child: Container(
          width: 5,
          height: 5,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
      ),
    );
  }
}

/// A small colored pill for a dish card's status line — "No recipe", an
/// ingredient count, or the partial-sizes warning.
class _Badge extends StatelessWidget {
  final Color color;
  final String text;
  const _Badge({required this.color, required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _Row {
  int? materialId;
  String quantity;
  _Row({this.materialId, this.quantity = ''});
}

class _RecipeEditorScreen extends ConsumerStatefulWidget {
  final ItemRecipe recipe;
  const _RecipeEditorScreen({required this.recipe});

  @override
  ConsumerState<_RecipeEditorScreen> createState() => _RecipeEditorScreenState();
}

class _RecipeEditorScreenState extends ConsumerState<_RecipeEditorScreen> {
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

    final ingredientSectionNumber = widget.recipe.portions.isNotEmpty ? 2 : 1;

    return Scaffold(
      appBar: AppBar(title: Text(widget.recipe.name)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s12, AppTheme.s12, AppTheme.s24),
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.info_outline_rounded, size: 14, color: AppTheme.muted),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'What one serving takes out of the store cupboard.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 11.5, height: 1.3),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppTheme.s12),
            if (_error != null) ...[
              _ErrorBanner(_error!),
              const SizedBox(height: AppTheme.s12),
            ],
            if (widget.recipe.portions.isNotEmpty) ...[
              NeuCard(
                padding: const EdgeInsets.all(AppTheme.s12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SectionLabel('Portion size', number: 1),
                    const SizedBox(height: AppTheme.s12),
                    _SegmentedToggle(
                      value: _perSize,
                      leftLabel: 'Same for every size',
                      rightLabel: 'Different per size',
                      onChanged: (perSize) => setState(() {
                        _perSize = perSize;
                        if (perSize) {
                          _scope = widget.recipe.portions.first.id;
                          for (final p in widget.recipe.portions) {
                            _rowsByScope.putIfAbsent(p.id, () => [_Row()]);
                          }
                        } else {
                          _scope = null;
                        }
                      }),
                    ),
                    if (_perSize) ...[
                      const SizedBox(height: AppTheme.s12),
                      Wrap(
                        spacing: AppTheme.s8,
                        runSpacing: AppTheme.s8,
                        children: [
                          for (final p in widget.recipe.portions)
                            _SizeChip(
                              label: p.label,
                              selected: _scope == p.id,
                              onTap: () => setState(() => _scope = p.id),
                            ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: AppTheme.s12),
            ],
            NeuCard(
              padding: const EdgeInsets.all(AppTheme.s12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SectionLabel('Ingredients', number: ingredientSectionNumber),
                  const SizedBox(height: AppTheme.s12),
                  for (var i = 0; i < _rows.length; i++)
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppTheme.s8),
                      child: _ingredientRow(i, materials),
                    ),
                  _AddIngredientButton(onTap: () => setState(() => _rows.add(_Row()))),
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
                  : Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      mainAxisSize: MainAxisSize.min,
                      children: const [
                        Icon(Icons.check_rounded, size: 17, color: Colors.white),
                        SizedBox(width: 6),
                        Text('Save recipe'),
                      ],
                    ),
            ),
          ],
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
    return Container(
      padding: const EdgeInsets.fromLTRB(AppTheme.s8, AppTheme.s4, AppTheme.s4, AppTheme.s4),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.subtle,
      ),
      child: Row(
        children: [
          Container(
            width: 20,
            height: 20,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppTheme.accent.withValues(alpha: 0.08),
              shape: BoxShape.circle,
            ),
            child: Text(
              '${index + 1}',
              style: const TextStyle(color: AppTheme.accent, fontSize: 10.5, fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          Expanded(
            flex: 3,
            child: _MaterialField(
              materials: materials,
              value: row.materialId,
              onChanged: (v) => setState(() => row.materialId = v),
            ),
          ),
          Container(
            width: 1,
            height: 22,
            margin: const EdgeInsets.symmetric(horizontal: AppTheme.s8),
            color: AppTheme.border,
          ),
          SizedBox(
            width: 48,
            child: TextField(
              controller: TextEditingController(text: row.quantity)
                ..selection = TextSelection.collapsed(offset: row.quantity.length),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              textAlign: TextAlign.right,
              style: const TextStyle(color: AppTheme.heading, fontSize: 13, fontWeight: FontWeight.w600),
              decoration: const InputDecoration(
                border: InputBorder.none,
                isDense: true,
                hintText: '0',
                contentPadding: EdgeInsets.zero,
              ),
              onChanged: (v) => row.quantity = v,
            ),
          ),
          if (material != null) ...[
            const SizedBox(width: 3),
            Text(_recipeUnitLabel(material.unit), style: const TextStyle(color: AppTheme.muted, fontSize: 11.5)),
          ],
          const SizedBox(width: AppTheme.s4),
          GestureDetector(
            onTap: () => setState(() => _rows.removeAt(index)),
            behavior: HitTestBehavior.opaque,
            child: Container(
              width: 26,
              height: 26,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppTheme.danger.withValues(alpha: 0.07),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.close_rounded, size: 14, color: AppTheme.danger),
            ),
          ),
        ],
      ),
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

/// A two-way pill toggle for "Same for every size" vs "Different per size" —
/// a single capsule with a sliding fill rather than two separate buttons, so
/// the choice reads as one control instead of a pair of options.
class _SegmentedToggle extends StatelessWidget {
  final bool value;
  final String leftLabel;
  final String rightLabel;
  final ValueChanged<bool> onChanged;

  const _SegmentedToggle({
    required this.value,
    required this.leftLabel,
    required this.rightLabel,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        children: [
          Expanded(child: _segment(leftLabel, !value, () => onChanged(false))),
          Expanded(child: _segment(rightLabel, value, () => onChanged(true))),
        ],
      ),
    );
  }

  Widget _segment(String label, bool selected, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
        decoration: BoxDecoration(
          color: selected ? AppTheme.accent : Colors.transparent,
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          boxShadow: selected ? AppTheme.subtle : null,
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          maxLines: 2,
          softWrap: true,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            height: 1.15,
            color: selected ? Colors.white : AppTheme.muted,
          ),
        ),
      ),
    );
  }
}

/// A compact pill chip for picking which portion size is being edited —
/// matches the status [_Badge] look elsewhere on this panel, with a check
/// mark standing in for the selected outline.
class _SizeChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _SizeChip({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
        decoration: BoxDecoration(
          color: selected ? AppTheme.accent.withValues(alpha: 0.10) : AppTheme.card,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: selected ? AppTheme.accent : AppTheme.border, width: selected ? 1.4 : 1),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (selected) ...[
              const Icon(Icons.check_rounded, size: 13, color: AppTheme.accent),
              const SizedBox(width: 4),
            ],
            Text(
              label,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: selected ? AppTheme.accent : AppTheme.text,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A dashed-style call-to-action for appending an ingredient row — reads as
/// an inline "add" affordance that belongs to the card, rather than a loose
/// [TextButton] floating under the list.
class _AddIngredientButton extends StatelessWidget {
  final VoidCallback onTap;
  const _AddIngredientButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: AppTheme.accent.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          border: Border.all(color: AppTheme.accent.withValues(alpha: 0.3), width: 1.2),
        ),
        child: const Row(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.add_rounded, size: 16, color: AppTheme.accent),
            SizedBox(width: 4),
            Text(
              'Add an ingredient',
              style: TextStyle(color: AppTheme.accent, fontSize: 12.5, fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
    );
  }
}

/// The ingredient row's material picker — a plain tappable field that opens
/// a custom rounded popup instead of Flutter's default [DropdownButton]
/// menu, so the selected row gets an accent tint and a check mark instead of
/// a flat grey highlight.
class _MaterialField extends StatelessWidget {
  final List<RawMaterial> materials;
  final int? value;
  final ValueChanged<int?> onChanged;

  const _MaterialField({required this.materials, required this.value, required this.onChanged});

  RawMaterial? get _selected {
    for (final m in materials) {
      if (m.id == value) return m;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selected;
    return Builder(
      builder: (fieldContext) => GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () async {
          final picked = await _showMaterialPicker(fieldContext, materials, value);
          if (picked != null) onChanged(picked);
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  selected?.name ?? 'Choose a material…',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: selected != null ? AppTheme.heading : AppTheme.muted,
                    fontSize: 13,
                    fontWeight: selected != null ? FontWeight.w500 : FontWeight.w400,
                  ),
                ),
              ),
              const Icon(Icons.expand_more_rounded, size: 18, color: AppTheme.muted),
            ],
          ),
        ),
      ),
    );
  }
}

/// The store cupboard, filtered down as you type — a plain popup stops being
/// usable somewhere past a screenful of materials, and a kitchen's list runs
/// well past that. Mirrors MaterialField on the web: a search box over the
/// list, matching the name or the category.
Future<int?> _showMaterialPicker(BuildContext context, List<RawMaterial> materials, int? current) {
  return showModalBottomSheet<int>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppTheme.bg,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.rLarge)),
    ),
    builder: (sheetContext) => _MaterialPickerSheet(materials: materials, current: current),
  );
}

class _MaterialPickerSheet extends StatefulWidget {
  final List<RawMaterial> materials;
  final int? current;
  const _MaterialPickerSheet({required this.materials, required this.current});

  @override
  State<_MaterialPickerSheet> createState() => _MaterialPickerSheetState();
}

class _MaterialPickerSheetState extends State<_MaterialPickerSheet> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final needle = _search.text.trim().toLowerCase();
    final matches = needle.isEmpty
        ? widget.materials
        : widget.materials.where((m) => m.name.toLowerCase().contains(needle) || m.category.toLowerCase().contains(needle)).toList();

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: AppTheme.s12),
            Container(
              margin: const EdgeInsets.symmetric(horizontal: AppTheme.s16),
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
              decoration: BoxDecoration(
                color: AppTheme.card,
                borderRadius: BorderRadius.circular(AppTheme.rMedium),
                border: Border.all(color: AppTheme.border),
              ),
              child: Row(
                children: [
                  const Icon(Icons.search_rounded, size: 18, color: AppTheme.muted),
                  const SizedBox(width: AppTheme.s8),
                  Expanded(
                    child: TextField(
                      controller: _search,
                      autofocus: true,
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(
                        isDense: true,
                        border: InputBorder.none,
                        hintText: 'Search a material…',
                        hintStyle: TextStyle(color: AppTheme.muted, fontSize: 13.5),
                      ),
                      style: const TextStyle(fontSize: 13.5),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s8),
            ConstrainedBox(
              constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.5),
              child: matches.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.symmetric(vertical: AppTheme.s24),
                      child: Text('No materials match that.', style: TextStyle(color: AppTheme.muted, fontSize: 13)),
                    )
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(AppTheme.s12, 0, AppTheme.s12, AppTheme.s16),
                      shrinkWrap: true,
                      children: [
                        for (final m in matches)
                          InkWell(
                            borderRadius: BorderRadius.circular(AppTheme.rSmall),
                            onTap: () => Navigator.pop(context, m.id),
                            child: _MaterialMenuRow(name: m.name, selected: m.id == widget.current),
                          ),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One row of the material popup — accent-tinted background and a check
/// mark when it's the current selection, a plain row otherwise.
class _MaterialMenuRow extends StatelessWidget {
  final String name;
  final bool selected;
  const _MaterialMenuRow({required this.name, required this.selected});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 9),
      decoration: BoxDecoration(
        color: selected ? AppTheme.accent.withValues(alpha: 0.08) : Colors.transparent,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                color: selected ? AppTheme.accent : AppTheme.heading,
              ),
            ),
          ),
          if (selected) const Icon(Icons.check_rounded, size: 16, color: AppTheme.accent),
        ],
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
