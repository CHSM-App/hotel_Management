import 'package:flutter/material.dart';

import '../../domain/models/asset.dart' show Vendor;
import '../theme.dart';

/// A text field that suggests as you type and lets you pick or keep typing a
/// new value — mirrors CategoryField in ExpensesPanel.jsx (a styled
/// stand-in for a native `<datalist>`). A category only exists once it has
/// been typed or picked here and used to save an expense; there is no
/// separate "manage categories" screen, so this is the only place one gets
/// named.
class CategoryComboField extends StatelessWidget {
  final TextEditingController controller;
  final List<String> options;
  final String label;
  final bool required;

  const CategoryComboField({
    super.key,
    required this.controller,
    required this.options,
    this.label = 'Category',
    this.required = true,
  });

  @override
  Widget build(BuildContext context) {
    return RawAutocomplete<String>(
      textEditingController: controller,
      focusNode: FocusNode(),
      optionsBuilder: (value) {
        final needle = value.text.trim().toLowerCase();
        if (needle.isEmpty) return options;
        return options.where((o) => o.toLowerCase().contains(needle));
      },
      fieldViewBuilder: (context, fieldController, focusNode, onSubmit) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text.rich(
              TextSpan(
                text: label,
                style: Theme.of(context).textTheme.bodySmall,
                children: required
                    ? const [TextSpan(text: ' *', style: TextStyle(color: AppTheme.danger, fontWeight: FontWeight.w700))]
                    : null,
              ),
            ),
            const SizedBox(height: AppTheme.s8),
            _ComboWell(controller: fieldController, focusNode: focusNode, hint: 'Utilities, Repairs, Salaries…'),
          ],
        );
      },
      optionsViewBuilder: (context, onSelected, values) => _OptionsCard(
        values: values.toList(),
        onSelected: onSelected,
        labelOf: (s) => s,
      ),
    );
  }
}

/// Same shape as [CategoryComboField], but matches across name/phone/email
/// and hands back the whole [Vendor] on pick — mirrors VendorField in
/// ExpensesPanel.jsx.
class VendorComboField extends StatelessWidget {
  final TextEditingController controller;
  final List<Vendor> vendors;
  final String label;

  const VendorComboField({
    super.key,
    required this.controller,
    required this.vendors,
    this.label = 'Vendor',
  });

  @override
  Widget build(BuildContext context) {
    return RawAutocomplete<Vendor>(
      textEditingController: controller,
      focusNode: FocusNode(),
      displayStringForOption: (v) => v.name,
      optionsBuilder: (value) {
        final needle = value.text.trim().toLowerCase();
        if (needle.isEmpty) return vendors;
        return vendors.where((v) =>
            v.name.toLowerCase().contains(needle) ||
            v.phone.toLowerCase().contains(needle) ||
            v.email.toLowerCase().contains(needle));
      },
      fieldViewBuilder: (context, fieldController, focusNode, onSubmit) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: AppTheme.s8),
            _ComboWell(controller: fieldController, focusNode: focusNode, hint: 'Vendor name or phone…'),
          ],
        );
      },
      optionsViewBuilder: (context, onSelected, values) => _OptionsCard(
        values: values.toList(),
        onSelected: onSelected,
        labelOf: (v) => v.name,
        metaOf: (v) => [v.phone, v.specialty].where((s) => s.isNotEmpty).join(' · '),
      ),
    );
  }
}

class _ComboWell extends StatelessWidget {
  final TextEditingController controller;
  final FocusNode focusNode;
  final String hint;

  const _ComboWell({required this.controller, required this.focusNode, required this.hint});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: focusNode,
      builder: (context, _) => Container(
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16),
        decoration: BoxDecoration(
          color: AppTheme.bg,
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          border: Border.all(color: focusNode.hasFocus ? AppTheme.accent : AppTheme.border, width: focusNode.hasFocus ? 1.6 : 1),
        ),
        child: TextField(
          controller: controller,
          focusNode: focusNode,
          style: const TextStyle(color: AppTheme.heading, fontSize: 15),
          cursorColor: AppTheme.accent,
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: const TextStyle(color: AppTheme.muted),
            border: InputBorder.none,
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(vertical: 14),
          ),
        ),
      ),
    );
  }
}

class _OptionsCard<T extends Object> extends StatelessWidget {
  final List<T> values;
  final AutocompleteOnSelected<T> onSelected;
  final String Function(T) labelOf;
  final String Function(T)? metaOf;

  const _OptionsCard({required this.values, required this.onSelected, required this.labelOf, this.metaOf});

  @override
  Widget build(BuildContext context) {
    if (values.isEmpty) return const SizedBox.shrink();
    return Align(
      alignment: Alignment.topLeft,
      child: Material(
        elevation: 4,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        color: AppTheme.card,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 220, minWidth: 260),
          child: ListView.builder(
            padding: const EdgeInsets.symmetric(vertical: 4),
            shrinkWrap: true,
            itemCount: values.length,
            itemBuilder: (context, i) {
              final v = values[i];
              final meta = metaOf?.call(v) ?? '';
              return InkWell(
                onTap: () => onSelected(v),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
                  child: Row(
                    children: [
                      Expanded(child: Text(labelOf(v), style: const TextStyle(color: AppTheme.heading, fontSize: 13.5))),
                      if (meta.isNotEmpty)
                        Text(meta, style: const TextStyle(color: AppTheme.muted, fontSize: 11.5)),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
