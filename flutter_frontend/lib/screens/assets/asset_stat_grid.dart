import 'package:flutter/material.dart';

import '../../widgets/neu.dart';
import '../theme.dart';

/// One summary tile's worth of content — same shape as _Stat in
/// register_screen.dart: a label, a big figure, and an optional caption
/// line underneath it ("2 open work orders", "1 under repair").
class AssetStat {
  final String label;
  final String value;
  final String? note;
  final bool accent;

  const AssetStat({
    required this.label,
    required this.value,
    this.note,
    this.accent = false,
  });
}

/// The summary strip at the top of an Assets & Inventory list — mirrors
/// _CompactStatGrid in register_screen.dart, reused here rather than
/// reinvented so the section reads as part of the same app rather than a
/// bolted-on module: a plain search bar and a bare list was the one thing
/// that made Assets look thinner than Bookings or Reports.
class AssetStatGrid extends StatelessWidget {
  final List<AssetStat> items;

  const AssetStatGrid({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = AppTheme.s8;
        final width = (constraints.maxWidth - gap * 2) / 3;
        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [
            for (final item in items)
              SizedBox(
                width: width,
                child: NeuCard(
                  radius: AppTheme.rSmall,
                  shadow: AppTheme.subtle,
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: AppTheme.s8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        item.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppTheme.muted, fontSize: 10),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        item.value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: item.accent ? AppTheme.accent : AppTheme.heading,
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      if (item.note != null) ...[
                        const SizedBox(height: 2),
                        Text(
                          item.note!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: AppTheme.muted, fontSize: 9),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}
