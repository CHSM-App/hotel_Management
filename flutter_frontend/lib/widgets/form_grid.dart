import 'package:flutter/material.dart';

import '../screens/theme.dart';
import 'neu.dart';

/// Marks a child of [FormGrid] that must take a whole row (notes, address,
/// anything long). Without it a child takes one column.
class FormSpan extends StatelessWidget {
  final Widget child;
  const FormSpan.full({super.key, required this.child});

  @override
  Widget build(BuildContext context) => child;
}

/// Lays fields out in 1, 2 or 3 columns by the width it is *given* (not the
/// window), so the same code works on a page and inside a dialog. On a phone
/// it is exactly a single column.
class FormGrid extends StatelessWidget {
  final List<Widget> children;
  final int maxColumns;
  final double spacing;
  final double runSpacing;

  const FormGrid({
    super.key,
    required this.children,
    this.maxColumns = 2,
    this.spacing = AppTheme.s16,
    this.runSpacing = AppTheme.s8,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, c) {
        final w = c.maxWidth;
        var cols = !w.isFinite || w < 520 ? 1 : (w < 900 ? 2 : 3);
        if (cols > maxColumns) cols = maxColumns;
        if (cols == 1) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < children.length; i++) ...[
                if (i > 0) SizedBox(height: runSpacing),
                children[i],
              ],
            ],
          );
        }
        final colW = (w - spacing * (cols - 1)) / cols;
        return Wrap(
          spacing: spacing,
          runSpacing: runSpacing,
          children: [
            for (final ch in children)
              SizedBox(width: ch is FormSpan ? w : colW, child: ch),
          ],
        );
      },
    );
  }
}

/// Save / Cancel row: full-width stacked on a phone (as before), right-aligned
/// natural-width buttons from tablet up.
class FormActions extends StatelessWidget {
  final Widget saveChild;
  final VoidCallback? onSave;
  final VoidCallback? onCancel;
  final String cancelLabel;

  const FormActions({
    super.key,
    required this.saveChild,
    required this.onSave,
    this.onCancel,
    this.cancelLabel = 'Cancel',
  });

  @override
  Widget build(BuildContext context) {
    final wide = AppTheme.screenSize(context) != ScreenSize.mobile;
    final save = NeuButton(primary: true, expand: !wide, onPressed: onSave, child: saveChild);
    if (!wide) return save;
    return Row(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        if (onCancel != null) ...[
          NeuButton(onPressed: onCancel, child: Text(cancelLabel)),
          const SizedBox(width: AppTheme.s12),
        ],
        ConstrainedBox(constraints: const BoxConstraints(minWidth: 140), child: save),
      ],
    );
  }
}
