import 'package:flutter/material.dart';

import '../../domain/models/category.dart';
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
  /// rather than a stack of unrelated fields. Takes precedence over [icon]
  /// when both are given.
  final int? number;

  const SectionLabel(this.title, {super.key, this.trailing, this.icon, this.number});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        if (number != null) ...[
          Container(
            width: 18,
            height: 18,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              color: AppTheme.accent,
              shape: BoxShape.circle,
            ),
            child: Text(
              '$number',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: AppTheme.s8),
        ] else if (icon != null) ...[
          Icon(icon, size: 14, color: AppTheme.accent),
          const SizedBox(width: AppTheme.s8),
        ],
        Expanded(
          child: Text(
            title.toUpperCase(),
            style: const TextStyle(
              color: AppTheme.muted,
              fontSize: 12,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.4,
            ),
          ),
        ),
        if (trailing != null)
          Text(trailing!, style: Theme.of(context).textTheme.bodySmall),
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

  const ModeToggle({super.key, required this.options, required this.selected, required this.onSelect});

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
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final entry in options.entries)
            GestureDetector(
              onTap: () => onSelect(entry.key),
              child: Container(
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
            ),
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

  const OptionDropdown({
    super.key,
    required this.values,
    required this.labels,
    required this.selected,
    required this.onSelect,
    this.hint = 'Choose one',
  });

  @override
  Widget build(BuildContext context) {
    return NeuPressed(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: selected,
          isExpanded: true,
          dropdownColor: AppTheme.card,
          hint: Text(hint, style: const TextStyle(color: AppTheme.muted, fontSize: 13.5)),
          icon: const Icon(Icons.keyboard_arrow_down_rounded, color: AppTheme.muted),
          items: [
            for (final v in values)
              DropdownMenuItem(
                value: v,
                child: Text(
                  labels[v] ?? v,
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontWeight: FontWeight.w600,
                    fontSize: 13.5,
                  ),
                ),
              ),
          ],
          onChanged: (v) {
            if (v != null) onSelect(v);
          },
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
      padding: EdgeInsets.symmetric(vertical: AppTheme.s16),
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
            child: GestureDetector(
              onTap: () => onSelect(entry.key),
              child: entry.key == selected
                  ? NeuPressed(
                      padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
                      child: Center(
                        child: Text(
                          entry.value,
                          style: const TextStyle(color: AppTheme.accent, fontSize: 13, fontWeight: FontWeight.w500),
                        ),
                      ),
                    )
                  : NeuCard(
                      shadow: AppTheme.subtle,
                      padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
                      child: Center(
                        child: Text(entry.value, style: const TextStyle(color: AppTheme.text, fontSize: 13)),
                      ),
                    ),
            ),
          ),
          if (entry.key != options.keys.last) const SizedBox(width: AppTheme.s8),
        ],
      ],
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

  const CategoryDropdown({super.key, required this.categories, required this.selectedId, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    final options = categories.where((c) => c.isActive || c.id == selectedId).toList();
    return NeuPressed(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<int>(
          value: selectedId,
          isExpanded: true,
          dropdownColor: AppTheme.card,
          hint: const Text(
            'Choose a category',
            style: TextStyle(color: AppTheme.muted, fontSize: 13.5),
          ),
          icon: const Icon(Icons.keyboard_arrow_down_rounded, color: AppTheme.muted),
          items: [
            for (final c in options)
              DropdownMenuItem<int>(
                value: c.id,
                child: Text(
                  '${c.name} · ${formatPrice(c.basePrice)}/night',
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontWeight: FontWeight.w600,
                    fontSize: 13.5,
                  ),
                ),
              ),
          ],
          onChanged: (id) {
            if (id != null) onSelect(id);
          },
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
          child: Image(image: imageProvider, width: 72, height: 72, fit: BoxFit.cover),
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
