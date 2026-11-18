import 'package:flutter/material.dart';

import '../screens/theme.dart';

/// A run of cards that is one column on a phone and as many columns as fit on
/// a wide window — the desktop answer to a `ListView` of full-width cards.
///
/// Cards keep their own height (no forced equal rows), so mixed cards line up
/// at the top of each row. Below two columns it is just a [Column], so a
/// phone lays out exactly as before.
class AdaptiveGrid extends StatelessWidget {
  final List<Widget> children;

  /// The narrowest a card may get before the grid drops a column.
  final double minTileWidth;
  final double spacing;

  const AdaptiveGrid({
    super.key,
    required this.children,
    this.minTileWidth = 400,
    this.spacing = AppTheme.s12,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final w = constraints.maxWidth;
        final cols = w.isFinite
            ? ((w + spacing) / (minTileWidth + spacing)).floor().clamp(1, 6)
            : 1;
        if (cols <= 1) {
          return Column(
            crossAxisAlignment: w.isFinite
                ? CrossAxisAlignment.stretch
                : CrossAxisAlignment.start,
            children: [
              for (final c in children)
                Padding(padding: EdgeInsets.only(bottom: spacing), child: c),
            ],
          );
        }
        return Column(
          children: [
            for (var i = 0; i < children.length; i += cols)
              Padding(
                padding: EdgeInsets.only(bottom: spacing),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (var j = 0; j < cols; j++) ...[
                      if (j > 0) SizedBox(width: spacing),
                      Expanded(
                        child: i + j < children.length
                            ? children[i + j]
                            : const SizedBox.shrink(),
                      ),
                    ],
                  ],
                ),
              ),
          ],
        );
      },
    );
  }
}
