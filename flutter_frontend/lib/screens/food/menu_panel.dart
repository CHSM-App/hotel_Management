import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/menu.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'menu_item_form_page.dart';

/// Menu & QR codes > Menu — mirrors MenuPanel.jsx: sections, their dishes, a
/// dish's out-of-stock switch and its sizes. One section on screen at a time
/// via the pill strip, same reasoning as the web's own SectionTabs — a full
/// à la carte menu runs past a hundred dishes.
class MenuPanel extends ConsumerStatefulWidget {
  const MenuPanel({super.key});

  @override
  ConsumerState<MenuPanel> createState() => _MenuPanelState();
}

class _MenuPanelState extends ConsumerState<MenuPanel> {
  int? _activeSectionId;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(menuViewModelProvider.notifier).load());
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(menuViewModelProvider);
    final sections = state.sections;
    final active = sections.any((s) => s.id == _activeSectionId)
        ? sections.firstWhere((s) => s.id == _activeSectionId)
        : (sections.isNotEmpty ? sections.first : null);

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(menuViewModelProvider.notifier).load(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, 96),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${sections.length} sections · '
                      '${sections.fold<int>(0, (n, s) => n + s.items.length)} dishes',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                  TextButton.icon(
                    onPressed: () => _showSectionForm(context, ref),
                    icon: const Icon(Icons.add_rounded, size: 16),
                    label: const Text('Section'),
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.s8),
              if (state.isLoading && sections.isEmpty)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else if (state.error != null && sections.isEmpty)
                NeuNotice(icon: Icons.cloud_off_rounded, message: state.error!)
              else if (sections.isEmpty)
                NeuNotice(
                  icon: Icons.restaurant_menu_rounded,
                  message: 'No menu yet. Add a section like "Thali" or "Tandoor", '
                      'then add a dish to it.',
                  action: NeuButton(onPressed: () => _showSectionForm(context, ref), child: const Text('Add a section')),
                )
              else ...[
                SizedBox(
                  height: 40,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: sections.length,
                    separatorBuilder: (_, __) => const SizedBox(width: AppTheme.s8),
                    itemBuilder: (context, i) {
                      final s = sections[i];
                      final selected = s.id == active?.id;
                      final out = s.items.where((it) => !it.isAvailable).length;
                      return GestureDetector(
                        onTap: () => setState(() => _activeSectionId = s.id),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: selected ? AppTheme.accent : AppTheme.card,
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(color: selected ? AppTheme.accent : AppTheme.border),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                s.name,
                                style: TextStyle(
                                  color: selected ? Colors.white : (s.isActive ? AppTheme.text : AppTheme.muted),
                                  fontWeight: FontWeight.w600,
                                  fontSize: 13,
                                ),
                              ),
                              const SizedBox(width: 4),
                              Text(
                                '${s.items.length}',
                                style: TextStyle(color: selected ? Colors.white70 : AppTheme.muted, fontSize: 11),
                              ),
                              if (out > 0) ...[
                                const SizedBox(width: 4),
                                Icon(Icons.error, size: 12, color: selected ? Colors.white : AppTheme.draft),
                              ],
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
                const SizedBox(height: AppTheme.s12),
                if (active != null) _SectionBody(section: active, allSections: sections),
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
            onPressed: sections.isEmpty
                ? null
                : () => showMenuItemFormPage(context, sections: sections, defaultCategoryId: active?.id),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

class _SectionBody extends ConsumerWidget {
  final MenuSection section;
  final List<MenuSection> allSections;
  const _SectionBody({required this.section, required this.allSections});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(menuViewModelProvider.notifier);
    final allOut = section.items.isNotEmpty && section.items.every((i) => !i.isAvailable);

    // Grouped VEG / EGG / NON-VEG, in that order, the same way the web
    // dashboard's own section card splits a menu that mixes them — a Jain
    // thali counter and a chicken counter shouldn't have to be told apart by
    // reading every mark in one long list.
    final vegItems = section.items.where((i) => (i.foodType ?? 'VEG') == 'VEG').toList();
    final eggItems = section.items.where((i) => i.foodType == 'EGG').toList();
    final nonVegItems = section.items.where((i) => i.foodType == 'NON_VEG').toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    section.name,
                    style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 16),
                  ),
                  if (section.items.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 8,
                      children: [
                        Text('${section.items.length} dish${section.items.length == 1 ? '' : 'es'}',
                            style: Theme.of(context).textTheme.bodySmall),
                        if (vegItems.isNotEmpty) _CountChip(count: vegItems.length, label: 'veg', color: AppTheme.vacant),
                        if (eggItems.isNotEmpty) _CountChip(count: eggItems.length, label: 'egg', color: AppTheme.draft),
                        if (nonVegItems.isNotEmpty) _CountChip(count: nonVegItems.length, label: 'non-veg', color: AppTheme.danger),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            NeuRowMenu(
              onEdit: () => _showSectionForm(context, ref, section: section),
              onDelete: () => _confirmDeleteSection(context, ref),
            ),
          ],
        ),
        const SizedBox(height: 2),
        // A second row for the actions rather than crowding them beside the
        // title: "Mark all out" plus "Add item" beside a long section name
        // wrapped or clipped on a phone-width screen when they all rode the
        // same row as the title.
        Wrap(
          alignment: WrapAlignment.end,
          spacing: AppTheme.s8,
          runSpacing: 4,
          children: [
            if (section.items.isNotEmpty)
              _ChipButton(
                icon: allOut ? Icons.restart_alt_rounded : Icons.block_rounded,
                label: allOut ? 'Bring all back' : 'Mark all out',
                color: allOut ? AppTheme.vacant : AppTheme.danger,
                onTap: () => vm.setSectionAvailability(section.id, allOut),
              ),
            _ChipButton(
              icon: Icons.add_rounded,
              label: 'Add item',
              color: AppTheme.accent,
              filled: true,
              onTap: () => showMenuItemFormPage(context, sections: allSections, defaultCategoryId: section.id),
            ),
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        if (section.items.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppTheme.s16),
            child: Text('Nothing in this section yet.', style: Theme.of(context).textTheme.bodyMedium),
          )
        else ...[
          if (vegItems.isNotEmpty) _FoodTypeGroup(label: 'Veg', color: AppTheme.vacant, items: vegItems, sections: allSections),
          if (eggItems.isNotEmpty) _FoodTypeGroup(label: 'Egg', color: AppTheme.draft, items: eggItems, sections: allSections),
          if (nonVegItems.isNotEmpty)
            _FoodTypeGroup(label: 'Non-veg', color: AppTheme.danger, items: nonVegItems, sections: allSections),
        ],
      ],
    );
  }

  Future<void> _confirmDeleteSection(BuildContext context, WidgetRef ref) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: Text('Delete the "${section.name}" section?', style: const TextStyle(color: AppTheme.heading, fontSize: 15)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete', style: TextStyle(color: AppTheme.danger))),
        ],
      ),
    );
    if (sure != true) return;
    await ref.read(menuViewModelProvider.notifier).deleteSection(section.id);
  }
}

/// "2 veg" / "1 non-veg" in the section's stats line — a small colored mark
/// standing in for the veg/egg/non-veg dot every dish already carries, so the
/// count reads as belonging to that mark rather than as a plain number.
class _CountChip extends StatelessWidget {
  final int count;
  final String label;
  final Color color;
  const _CountChip({required this.count, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 4),
        Text('$count $label', style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

/// One food-type band inside a section — a heading naming the group and its
/// count, then that group's dishes. Mirrors the web section card's VEG /
/// NON-VEG split.
class _FoodTypeGroup extends StatelessWidget {
  final String label;
  final Color color;
  final List<MenuItem> items;
  final List<MenuSection> sections;
  const _FoodTypeGroup({required this.label, required this.color, required this.items, required this.sections});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(width: 7, height: 7, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                const SizedBox(width: 6),
                Text(
                  label.toUpperCase(),
                  style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 11, letterSpacing: 0.4),
                ),
                const SizedBox(width: 6),
                Text('${items.length}', style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
          const SizedBox(height: AppTheme.s8),
          // Responsive: a single column on a phone, a two-up grid once the
          // screen is wide enough (a tablet, or a folded-out phone) that one
          // card per row would leave half the width empty.
          LayoutBuilder(
            builder: (context, constraints) {
              final columns = constraints.maxWidth >= 640 ? 2 : 1;
              final itemWidth =
                  columns == 1 ? constraints.maxWidth : (constraints.maxWidth - AppTheme.s12) / 2;
              return Wrap(
                spacing: AppTheme.s8,
                runSpacing: AppTheme.s8,
                children: [
                  for (final item in items)
                    SizedBox(width: itemWidth, child: _DishCard(item: item, sections: sections)),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

/// A small pill button — icon plus label, either filled (the primary "Add
/// item" action) or outlined in its own color (the state-changing "Mark all
/// out"/"Bring all back"). Replaces the plain [TextButton]s these used to be,
/// which read as flat blue links rather than as things you press.
class _ChipButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final bool filled;
  final VoidCallback onTap;
  const _ChipButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
    this.filled = false,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: filled ? color : color.withValues(alpha: 0.1),
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 5),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 13, color: filled ? Colors.white : color),
              const SizedBox(width: 3),
              Text(
                label,
                style: TextStyle(color: filled ? Colors.white : color, fontSize: 11.5, fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DishCard extends ConsumerWidget {
  final MenuItem item;
  final List<MenuSection> sections;
  const _DishCard({required this.item, required this.sections});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(menuViewModelProvider.notifier);

    final dimmed = !item.isAvailable || !item.isActive;

    return NeuCard(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              _FoodTypeMark(type: item.foodType),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: Row(
                  children: [
                    Flexible(
                      child: Text(
                        item.name,
                        style: TextStyle(
                          color: dimmed ? AppTheme.muted : AppTheme.heading,
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (!item.isAvailable) ...[
                      const SizedBox(width: 6),
                      const _Badge('Out', AppTheme.danger),
                    ],
                    if (!item.isActive) ...[
                      const SizedBox(width: 6),
                      const _Badge('Hidden', AppTheme.muted),
                    ],
                  ],
                ),
              ),
              // Mark out/Back in rides the same line as the kebab menu — both
              // are actions on this one dish, and stacking them one above the
              // other just made the card taller for no reason.
              const SizedBox(width: 4),
              _ChipButton(
                icon: item.isAvailable ? Icons.block_rounded : Icons.restart_alt_rounded,
                label: item.isAvailable ? 'Mark out' : 'Back in',
                color: item.isAvailable ? AppTheme.danger : AppTheme.vacant,
                onTap: () => vm.setItemAvailability(item.id, !item.isAvailable),
              ),
              NeuRowMenu(
                onEdit: () => showMenuItemFormPage(context, sections: sections, item: item),
                onDelete: () => _confirmDelete(context, ref),
              ),
            ],
          ),
          if ((item.description ?? '').isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2, left: 20),
              child: Text(
                item.description!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(top: 4, left: 20),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: AppTheme.accent.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                item.portions.isNotEmpty
                    ? item.portions.map((p) => '${p.label} ${formatPrice(p.price)}').join(' · ')
                    : formatPrice(item.price),
                style: const TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w700, fontSize: 12),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: Text('Remove "${item.name}" from the menu?', style: const TextStyle(color: AppTheme.heading, fontSize: 15)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete', style: TextStyle(color: AppTheme.danger))),
        ],
      ),
    );
    if (sure != true) return;
    await ref.read(menuViewModelProvider.notifier).deleteItem(item.id);
  }
}

class _FoodTypeMark extends StatelessWidget {
  final String? type;
  const _FoodTypeMark({this.type});

  @override
  Widget build(BuildContext context) {
    final isVeg = type != 'NON_VEG';
    return Container(
      width: 12,
      height: 12,
      decoration: BoxDecoration(
        border: Border.all(color: isVeg ? AppTheme.vacant : AppTheme.danger, width: 1.5),
        borderRadius: BorderRadius.circular(2),
      ),
      alignment: Alignment.center,
      child: Container(
        width: 6,
        height: 6,
        decoration: BoxDecoration(color: isVeg ? AppTheme.vacant : AppTheme.danger, shape: BoxShape.circle),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String label;
  final Color color;
  const _Badge(this.label, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(999)),
      child: Text(label, style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w600)),
    );
  }
}

// ── Section add/edit sheet ────────────────────────────────────────────────

// Suggestions, not a fixed set: a lodge with a bar or a Jain counter types its
// own, and nothing here prevents that. Same list and order as the web
// dashboard's MenuPanel.jsx, so a menu built on one client reads the same
// heading order as one built on the other.
const _kSectionSuggestions = [
  'Starters',
  'Soups',
  'Main Course – Indian',
  'Rice & Biryani',
  'Indian Breads',
  'Chinese',
  'Snacks & Fast Food',
  'Desserts',
  'Beverages',
];

Future<void> _showSectionForm(BuildContext context, WidgetRef ref, {MenuSection? section}) {
  // A centered dialog, not a bottom sheet: this mirrors the web dashboard's
  // own "New section" modal, and it's a short, two-field form with nothing
  // that benefits from the sheet's drag-to-dismiss handle.
  return showDialog(
    context: context,
    builder: (_) => _SectionFormDialog(section: section),
  );
}

class _SectionFormDialog extends ConsumerStatefulWidget {
  final MenuSection? section;
  const _SectionFormDialog({this.section});

  @override
  ConsumerState<_SectionFormDialog> createState() => _SectionFormDialogState();
}

class _SectionFormDialogState extends ConsumerState<_SectionFormDialog> {
  late final _name = TextEditingController(text: widget.section?.name ?? '');
  late final _sortOrder = TextEditingController(text: widget.section?.sortOrder.toString() ?? '');
  final _nameFocus = FocusNode();
  String? _error;
  bool _suggestionsOpen = false;

  @override
  void initState() {
    super.initState();
    _nameFocus.addListener(() {
      setState(() => _suggestionsOpen = _nameFocus.hasFocus);
    });
  }

  @override
  void dispose() {
    _name.dispose();
    _sortOrder.dispose();
    _nameFocus.dispose();
    super.dispose();
  }

  // Offered only while adding, and only for headings this menu doesn't
  // already have — suggesting "Starters" to a lodge that has one just walks
  // them into the duplicate-name error. Narrows as they type, so it doubles
  // as a "did you mean" for a half-typed name.
  List<String> get _suggestions {
    if (widget.section != null) return const [];
    final taken = ref
        .read(menuViewModelProvider)
        .sections
        .map((s) => s.name.trim().toLowerCase())
        .toSet();
    final typed = _name.text.trim().toLowerCase();
    return _kSectionSuggestions
        .where((name) => !taken.contains(name.toLowerCase()) && (typed.isEmpty || name.toLowerCase().contains(typed)))
        .toList();
  }

  void _pickSuggestion(String name) {
    setState(() {
      _name.text = name;
      if (_sortOrder.text.trim().isEmpty) {
        _sortOrder.text = (_kSectionSuggestions.indexOf(name) + 1).toString();
      }
    });
    _nameFocus.unfocus();
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(menuViewModelProvider).submitting;
    final isEdit = widget.section != null;

    return Dialog(
      backgroundColor: AppTheme.card,
      insetPadding: const EdgeInsets.all(AppTheme.s16),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppTheme.s24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      isEdit ? 'Edit section' : 'New section',
                      style: const TextStyle(color: AppTheme.heading, fontSize: 18, fontWeight: FontWeight.w700),
                    ),
                  ),
                  InkWell(
                    onTap: submitting ? null : () => Navigator.pop(context),
                    borderRadius: BorderRadius.circular(AppTheme.rSmall),
                    child: const Padding(
                      padding: EdgeInsets.all(4),
                      child: Icon(Icons.close_rounded, color: AppTheme.muted, size: 20),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              const Text(
                'A heading on the menu — Starters, Breads, Desserts. Dishes are filed under it.',
                style: TextStyle(color: AppTheme.accent, fontSize: 12),
              ),
              const SizedBox(height: AppTheme.s24),
              if (_error != null) ...[
                Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 13)),
                const SizedBox(height: AppTheme.s12),
              ],
              NeuField(
                controller: _name,
                focusNode: _nameFocus,
                label: 'Section name',
                hint: 'Thali',
                required: true,
                onChanged: (_) => setState(() {}),
                forceCapitalizeWords: true,
              ),
              if (_suggestionsOpen && _suggestions.isNotEmpty)
                Container(
                  margin: const EdgeInsets.only(top: 4),
                  constraints: const BoxConstraints(maxHeight: 220),
                  decoration: BoxDecoration(
                    color: AppTheme.bg,
                    borderRadius: BorderRadius.circular(AppTheme.rSmall),
                    border: Border.all(color: AppTheme.border),
                  ),
                  child: Scrollbar(
                    child: ListView(
                      shrinkWrap: true,
                      padding: EdgeInsets.zero,
                      children: [
                        for (final name in _suggestions)
                          InkWell(
                            // mousedown-equivalent isn't a thing on touch, but
                            // onTap still fires before the field's focus loss
                            // finishes tearing this list down, same as the
                            // web's onMouseDown does for the mouse.
                            onTap: () => _pickSuggestion(name),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: AppTheme.s16,
                                vertical: AppTheme.s12,
                              ),
                              child: Text(name, style: const TextStyle(color: AppTheme.heading, fontSize: 14)),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: AppTheme.s16),
              NeuField(
                controller: _sortOrder,
                label: 'Order on the menu',
                hint: '0',
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: AppTheme.s24),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: submitting ? null : () => Navigator.pop(context),
                    child: const Text('Cancel'),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  NeuButton(
                    primary: true,
                    onPressed: submitting ? null : _submit,
                    child: submitting
                        ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Save'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _submit() async {
    setState(() => _error = null);
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Section name is required.');
      return;
    }
    final sortOrder = int.tryParse(_sortOrder.text.trim()) ?? 0;
    final vm = ref.read(menuViewModelProvider.notifier);
    final ok = await vm.saveSection(id: widget.section?.id, name: _name.text.trim(), sortOrder: sortOrder);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(menuViewModelProvider).error ?? 'Could not save the section.');
    }
  }
}
