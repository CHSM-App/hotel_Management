import 'package:flutter/material.dart';

import '../../domain/models/category.dart';
import '../../domain/models/room.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// Shared building blocks for the two room forms — the edit sheet and the
/// full-page "Add room" screen. Split out once a second screen needed the
/// same category cards, chips and photo tiles rather than a copy of each.

const bedSizes = ['SINGLE', 'DOUBLE', 'QUEEN', 'KING'];
const bedSizeLabel = {
  'SINGLE': 'Single',
  'DOUBLE': 'Double',
  'QUEEN': 'Queen',
  'KING': 'King',
};
const bathroomTypes = ['ATTACHED', 'COMMON'];
const bathroomLabel = {'ATTACHED': 'Attached bathroom', 'COMMON': 'Common bathroom'};
const maxRoomImages = 6;

const dormitoryGenders = ['MALE', 'FEMALE', 'BOTH'];
const dormitoryGenderLabel = {'MALE': 'Male', 'FEMALE': 'Female', 'BOTH': 'Both'};
const dormitoryAcOptions = ['AC', 'NON_AC'];
const dormitoryAcLabel = {'AC': 'AC', 'NON_AC': 'Non-AC'};

class BedDraft {
  String size;
  int count;
  final TextEditingController countController;
  BedDraft({this.size = '', this.count = 1})
      : countController = TextEditingController(text: '$count');
}

// ── Section framing ─────────────────────────────────────────────────────────
//
// The same framing the booking form uses: one card holds every section, and
// a section is a small caption plus a hairline divider rather than a card of
// its own — so the two forms the desk fills in most read as one system.

class SectionLabel extends StatelessWidget {
  final String title;
  final String? trailing;
  final IconData? icon;

  /// The circled step number — the same numbered-step framing the booking
  /// form's own section heads carry — for a form read as a short sequence
  /// rather than a stack of unrelated fields. Shown as plain digits when no
  /// [icon] is given for this step; [icon] takes the badge over when it is.
  final int? number;

  const SectionLabel(this.title, {super.key, this.trailing, this.icon, this.number});

  @override
  Widget build(BuildContext context) {
    final badged = number != null || icon != null;
    return Row(
      children: [
        if (badged) ...[
          Container(
            width: 22,
            height: 22,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [AppTheme.accent, Color(0xFF10499A)],
              ),
              shape: BoxShape.circle,
              boxShadow: const [
                BoxShadow(
                  color: Color(0x2A1457AD),
                  offset: Offset(0, 2),
                  blurRadius: 5,
                ),
              ],
            ),
            child: icon != null
                ? Icon(icon, color: Colors.white, size: 14)
                : Text(
                    '$number',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
          ),
          const SizedBox(width: AppTheme.s12),
        ],
        Expanded(
          child: Text(
            title.toUpperCase(),
            style: TextStyle(
              color: badged ? AppTheme.heading : AppTheme.muted,
              fontSize: badged ? 13.5 : 12,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
            ),
          ),
        ),
        if (trailing != null)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppTheme.accent.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              trailing!,
              style: const TextStyle(
                color: AppTheme.accent,
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
      ],
    );
  }
}

/// A plain field label with the same red asterisk a required [NeuField]
/// carries — for fields (dropdowns, pickers) that aren't a [NeuField] itself.
class RequiredLabel extends StatelessWidget {
  final String label;

  const RequiredLabel(this.label, {super.key});

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        text: label,
        style: Theme.of(context).textTheme.bodySmall,
        children: const [
          TextSpan(
            text: ' *',
            style: TextStyle(color: AppTheme.danger, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

/// A compact two-way pill switch — the same "Single / Bulk range" toggle the
/// website puts beside the form title, rather than [ToggleGroup]'s full-width
/// segments which need the whole row to themselves.
class ModeToggle extends StatelessWidget {
  final Map<String, String> options;
  final String selected;
  final ValueChanged<String> onSelect;

  /// Stretches the pill across the full width, each option sharing it equally.
  final bool expanded;

  const ModeToggle({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelect,
    this.expanded = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        mainAxisSize: expanded ? MainAxisSize.max : MainAxisSize.min,
        children: [
          for (final entry in options.entries)
            () {
              final tab = GestureDetector(
                onTap: () => onSelect(entry.key),
                child: Container(
                  alignment: expanded ? Alignment.center : null,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: entry.key == selected ? AppTheme.accent : Colors.transparent,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    entry.value,
                    style: TextStyle(
                      color: entry.key == selected ? Colors.white : AppTheme.text,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              );
              return expanded ? Expanded(child: tab) : tab;
            }(),
        ],
      ),
    );
  }
}

/// A dropdown row for a short fixed set of options — the same footprint as
/// [CategoryDropdown], for fields (bathroom type, bed size) that pick from a
/// small enum rather than a category list.
class OptionDropdown extends StatelessWidget {
  final List<String> values;
  final Map<String, String> labels;
  final String? selected;
  final String hint;
  final ValueChanged<String> onSelect;

  /// Rings the dropdown in [AppTheme.danger] — the same treatment a
  /// required [NeuField] gets — when a submit was tried and nothing was
  /// chosen here.
  final bool hasError;

  /// A small round badge ahead of every row's label, filled solid on the
  /// chosen one — optional, since this picker covers everything from a
  /// room to a payment method and a generic circle icon reads right for
  /// none of them. Left null, a row is just its label and (when chosen) the
  /// check mark, same as before.
  final IconData? itemIcon;

  const OptionDropdown({
    super.key,
    required this.values,
    required this.labels,
    required this.selected,
    required this.onSelect,
    this.hint = 'Choose one',
    this.hasError = false,
    this.itemIcon,
  });

  @override
  Widget build(BuildContext context) {
    return NeuPressed(
      hasError: hasError,
      // The same accent ring a focused field draws — here read as "filled"
      // rather than "being typed into", so a picked option doesn't sit in
      // the same flat grey well as an empty one.
      focused: selected != null,
      radius: AppTheme.rMedium,
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 4),
      child: Theme(
        // The framework paints the open menu's selected row with
        // Theme.focusColor — an accent tint here instead of Material's
        // default grey, so the picked option reads as chosen rather than
        // merely focused.
        data: Theme.of(context).copyWith(
          focusColor: AppTheme.accent.withValues(alpha: 0.1),
          hoverColor: AppTheme.accent.withValues(alpha: 0.06),
        ),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<String>(
            value: selected,
            isExpanded: true,
            // Dense, so the closed box is a fixed 24px line. Otherwise the
            // framework wraps the hint in a 48px-minimum menu-item container,
            // and an empty picker stands far taller than a filled one.
            isDense: true,
            dropdownColor: AppTheme.card,
            borderRadius: BorderRadius.circular(AppTheme.rLarge),
            elevation: 6,
            menuMaxHeight: 340,
            // Null, rather than the framework's 48px floor, so this box
            // matches a dense NeuField's height instead of standing taller
            // than the field right beside it.
            itemHeight: null,
            hint: Text(hint, style: const TextStyle(color: AppTheme.muted, fontSize: 13)),
            // A small tinted circle around the chevron rather than a bare
            // grey arrow — the same touch of colour the date pills and
            // "add another" buttons carry, so a plain picker doesn't read
            // as flatter than everything around it.
            icon: Container(
              width: 22,
              height: 22,
              margin: const EdgeInsets.only(left: 4),
              alignment: Alignment.center,
              decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.12), shape: BoxShape.circle),
              child: const Icon(Icons.keyboard_arrow_down_rounded, color: AppTheme.accent, size: 16),
            ),
            // Without this, the framework reuses each `items` entry's own
            // widget for the closed box too — the picked option's purple
            // pill-and-checkmark row, sized to a list item rather than a
            // compact field. A plain line of text here keeps the closed box
            // the same height as a dense NeuField; the pill-and-checkmark
            // look stays in the open list below, where it's chosen from.
            selectedItemBuilder: (context) => [
              for (final v in values)
                Align(
                  alignment: Alignment.centerLeft,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (itemIcon != null) ...[
                        Icon(itemIcon, size: 15, color: AppTheme.accent),
                        const SizedBox(width: 6),
                      ],
                      Flexible(
                        child: Text(
                          labels[v] ?? v,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: AppTheme.heading, fontSize: 13.5, fontWeight: FontWeight.w700),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
            // Each row as its own inset, rounded card rather than a bare
            // Material list tile — a small round badge ahead of the label
            // (filled solid once chosen) and the sidebar's soft brand wash
            // behind the whole row, so the picked option reads as chosen
            // at a glance from either cue, not just bolder text.
            items: [
              for (final v in values)
                DropdownMenuItem(
                  value: v,
                  child: Container(
                    width: double.infinity,
                    margin: const EdgeInsets.symmetric(vertical: 3),
                    padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 9),
                    decoration: BoxDecoration(
                      color: v == selected ? AppTheme.sidebarBrandWash : Colors.transparent,
                      borderRadius: BorderRadius.circular(AppTheme.rMedium),
                      border: v == selected ? Border.all(color: AppTheme.sidebarBrandWashEdge) : null,
                    ),
                    child: Row(
                      children: [
                        if (itemIcon != null) ...[
                          Container(
                            width: 26,
                            height: 26,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: v == selected ? AppTheme.sidebarBrandInk : AppTheme.bg,
                              shape: BoxShape.circle,
                            ),
                            child: Icon(
                              itemIcon,
                              size: 13,
                              color: v == selected ? Colors.white : AppTheme.muted,
                            ),
                          ),
                          const SizedBox(width: AppTheme.s8),
                        ],
                        Expanded(
                          child: Text(
                            labels[v] ?? v,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                              color: v == selected ? AppTheme.sidebarBrandInk : AppTheme.text,
                              fontWeight: v == selected ? FontWeight.w700 : FontWeight.w500,
                            ),
                          ),
                        ),
                        if (v == selected) ...[
                          const SizedBox(width: AppTheme.s4),
                          const Icon(Icons.check_rounded, color: AppTheme.sidebarBrandInk, size: 17),
                        ],
                      ],
                    ),
                  ),
                ),
            ],
            onChanged: (v) {
              if (v != null) onSelect(v);
            },
          ),
        ),
      ),
    );
  }
}

class SectionDivider extends StatelessWidget {
  const SectionDivider({super.key});

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: AppTheme.s8),
      child: Divider(height: 1, color: AppTheme.border),
    );
  }
}

class ToggleGroup extends StatelessWidget {
  final Map<String, String> options;
  final String selected;
  final ValueChanged<String> onSelect;

  const ToggleGroup({super.key, required this.options, required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (final entry in options.entries) ...[
          Expanded(
            child: _ToggleSegment(
              label: entry.value,
              selected: entry.key == selected,
              onTap: () => onSelect(entry.key),
            ),
          ),
          if (entry.key != options.keys.last) const SizedBox(width: AppTheme.s8),
        ],
      ],
    );
  }
}

/// One segment of [ToggleGroup] — a solid accent-gradient fill with white
/// text and a check mark when picked, a plain bordered card otherwise. The
/// two used to differ only by a faint border/text-color change, easy to miss
/// at a glance; this is the same unmistakable selected-vs-not contrast the
/// Single/Bulk range toggle and the category cards use elsewhere.
class _ToggleSegment extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _ToggleSegment({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
        decoration: BoxDecoration(
          gradient: selected
              ? const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [AppTheme.accent, Color(0xFF10499A)],
                )
              : null,
          color: selected ? null : AppTheme.bg,
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          border: Border.all(color: selected ? Colors.transparent : AppTheme.border),
          boxShadow: selected
              ? const [
                  BoxShadow(
                    color: Color(0x331457AD),
                    offset: Offset(0, 3),
                    blurRadius: 8,
                  ),
                ]
              : null,
        ),
        child: Center(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: TextStyle(
                  color: selected ? Colors.white : AppTheme.text,
                  fontSize: 13,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
              if (selected) ...[
                const SizedBox(width: 6),
                const Icon(Icons.check_rounded, color: Colors.white, size: 15),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// A label with a small accent icon — the same framing the section headers
/// on the booking form use, brought here so both room forms read the same way.
class FieldLabel extends StatelessWidget {
  final String text;
  final IconData icon;

  const FieldLabel(this.text, this.icon, {super.key});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 14, color: AppTheme.accent),
        const SizedBox(width: AppTheme.s8),
        Text(text, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

/// One category per card, rate included — a category and its price are one
/// decision at the desk ("the AC double, at 1800"), so showing them apart in
/// a chip plus a caption below made it two.
class CategoryPicker extends StatelessWidget {
  final List<RoomCategory> categories;
  final int? selectedId;
  final ValueChanged<int> onSelect;

  const CategoryPicker({super.key, required this.categories, required this.selectedId, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (final c in categories.where((c) => c.isActive || c.id == selectedId))
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s8),
            child: CategoryCard(
              category: c,
              selected: selectedId == c.id,
              onTap: () => onSelect(c.id),
            ),
          ),
      ],
    );
  }
}

/// The same choice as [CategoryPicker], as one dropdown row instead of a
/// card per category — for a form that already reads as a stack of dropdown
/// fields, one more card list breaks the rhythm.
class CategoryDropdown extends StatelessWidget {
  final List<RoomCategory> categories;
  final int? selectedId;
  final ValueChanged<int> onSelect;

  /// Rings the dropdown in [AppTheme.danger] when a submit was tried and no
  /// category was chosen — the same cue a required [NeuField] gets.
  final bool hasError;

  const CategoryDropdown({
    super.key,
    required this.categories,
    required this.selectedId,
    required this.onSelect,
    this.hasError = false,
  });

  @override
  Widget build(BuildContext context) {
    final options = categories.where((c) => c.isActive || c.id == selectedId).toList();
    return NeuPressed(
      hasError: hasError,
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 3),
      child: Theme(
        data: Theme.of(context).copyWith(
          focusColor: AppTheme.accent.withValues(alpha: 0.1),
          hoverColor: AppTheme.accent.withValues(alpha: 0.06),
        ),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<int>(
            value: selectedId,
            isExpanded: true,
            itemHeight: null,
            dropdownColor: AppTheme.card,
            borderRadius: BorderRadius.circular(AppTheme.rMedium),
            elevation: 3,
            hint: const Text(
              'Choose a category',
              style: TextStyle(color: AppTheme.muted, fontSize: 13.5),
            ),
            icon: const Icon(Icons.keyboard_arrow_down_rounded, color: AppTheme.muted),
            items: [
              for (final c in options)
                DropdownMenuItem<int>(
                  value: c.id,
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${c.name} · ${formatPrice(c.basePrice)}/night',
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            color: c.id == selectedId ? AppTheme.accent : AppTheme.text,
                            fontWeight: c.id == selectedId ? FontWeight.w700 : FontWeight.w400,
                          ),
                        ),
                      ),
                      if (c.id == selectedId)
                        const Icon(Icons.check_rounded, color: AppTheme.accent, size: 16),
                    ],
                  ),
                ),
            ],
            onChanged: (id) {
              if (id != null) onSelect(id);
            },
          ),
        ),
      ),
    );
  }
}

class CategoryCard extends StatelessWidget {
  final RoomCategory category;
  final bool selected;
  final VoidCallback onTap;

  const CategoryCard({super.key, required this.category, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: NeuCard(
        radius: AppTheme.rSmall,
        shadow: selected ? AppTheme.extruded : AppTheme.subtle,
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s12),
        child: Row(
          children: [
            Container(
              width: 4,
              height: 32,
              decoration: BoxDecoration(
                color: selected ? AppTheme.accent : AppTheme.border,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
            const SizedBox(width: AppTheme.s12),
            Expanded(
              child: Text(
                category.name,
                style: TextStyle(
                  color: selected ? AppTheme.heading : AppTheme.text,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                  fontSize: 14,
                ),
              ),
            ),
            Text(
              '${formatPrice(category.basePrice)} /night',
              style: TextStyle(
                color: selected ? AppTheme.accent : AppTheme.muted,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                fontSize: 13,
              ),
            ),
            if (selected) ...[
              const SizedBox(width: AppTheme.s8),
              const Icon(Icons.check_circle_rounded, color: AppTheme.accent, size: 18),
            ],
          ],
        ),
      ),
    );
  }
}

class RoomChoiceChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const RoomChoiceChip({super.key, required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final text = Text(
      label,
      style: TextStyle(
        color: selected ? AppTheme.accent : AppTheme.text,
        fontWeight: selected ? FontWeight.w500 : FontWeight.w400,
        fontSize: 13,
      ),
    );
    return GestureDetector(
      onTap: onTap,
      child: selected
          ? NeuPressed(
              radius: 999,
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s8),
              child: text,
            )
          : NeuCard(
              radius: 999,
              shadow: AppTheme.subtle,
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s8),
              child: text,
            ),
    );
  }
}

/// The first tile in the photo grid — same footprint as a thumbnail, so the
/// grid does not jump around as photos are added, and it stays the way in
/// once at least one photo is already there.
class AddPhotoTile extends StatelessWidget {
  final VoidCallback onTap;

  const AddPhotoTile({super.key, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 72,
        height: 72,
        decoration: BoxDecoration(
          color: AppTheme.accent.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          border: Border.all(color: AppTheme.accent.withValues(alpha: 0.4)),
        ),
        child: const Icon(Icons.add_a_photo_outlined, color: AppTheme.accent, size: 22),
      ),
    );
  }
}

class PhotoThumb extends StatelessWidget {
  final ImageProvider imageProvider;
  final VoidCallback onRemove;

  const PhotoThumb({super.key, required this.imageProvider, required this.onRemove});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          child: Image(
            image: imageProvider,
            width: 72,
            height: 72,
            fit: BoxFit.cover,
            // A missing or unreachable file (e.g. a 404) otherwise paints its
            // raw exception text, which overflows the tile.
            errorBuilder: (_, _, _) => Container(
              width: 72,
              height: 72,
              color: AppTheme.bg,
              child: const Icon(Icons.broken_image_outlined, color: AppTheme.muted, size: 22),
            ),
          ),
        ),
        Positioned(
          top: -6,
          right: -6,
          child: GestureDetector(
            onTap: onRemove,
            child: Container(
              padding: const EdgeInsets.all(2),
              decoration: const BoxDecoration(color: AppTheme.danger, shape: BoxShape.circle),
              child: const Icon(Icons.close_rounded, size: 14, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }
}

String jsonEncodeBeds(List<Map<String, dynamic>> beds) {
  final parts = beds.map((b) => '{"size":"${b['size']}","count":${b['count']}}');
  return '[${parts.join(',')}]';
}

/// A dormitory's own headcount control — the only place its beds are added or
/// removed, one call to `PUT /rooms/:id/beds/count` at a time rather than a
/// per-bed add/remove UI. Only meaningful once the room already exists: a
/// dormitory being created for the first time has no id yet for this to call
/// against, so this only ever appears on the edit screen.
class DormitoryBedCountField extends StatelessWidget {
  final List<DormitoryBed> beds;
  final int count;
  final ValueChanged<int> onChanged;

  const DormitoryBedCountField({
    super.key,
    required this.beds,
    required this.count,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const RequiredLabel('Beds'),
        const SizedBox(height: AppTheme.s8),
        Row(
          children: [
            IconButton(
              icon: const Icon(Icons.remove_circle_outline_rounded),
              color: AppTheme.muted,
              onPressed: count <= 0 ? null : () => onChanged(count - 1),
            ),
            SizedBox(
              width: 48,
              child: Text(
                '$count',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontWeight: FontWeight.w700,
                  fontSize: 16,
                ),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.add_circle_outline_rounded),
              color: AppTheme.accent,
              onPressed: count >= 60 ? null : () => onChanged(count + 1),
            ),
          ],
        ),
        if (beds.isNotEmpty) ...[
          const SizedBox(height: AppTheme.s8),
          Wrap(
            spacing: AppTheme.s8,
            runSpacing: AppTheme.s8,
            children: [
              for (final bed in beds)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 4),
                  decoration: BoxDecoration(
                    color: bed.isActive ? AppTheme.accent.withValues(alpha: 0.08) : AppTheme.bg,
                    border: bed.isActive ? null : Border.all(color: AppTheme.border),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    bed.bedLabel,
                    style: TextStyle(
                      color: bed.isActive ? AppTheme.accent : AppTheme.muted,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ],
    );
  }
}
