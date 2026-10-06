import 'package:flutter/material.dart';

import '../theme.dart';

/// One summary tile's worth of content — same shape as _Stat in
/// register_screen.dart: a label, a big figure, and an optional caption
/// line underneath it ("2 open work orders", "1 under repair"). An [icon]
/// and [color] turn the plain figure into a small dashboard-style tile —
/// a colored glyph and a left accent spine instead of bare text.
class AssetStat {
  final String label;
  final String value;
  final String? note;
  final bool accent;
  final IconData? icon;
  final Color? color;

  const AssetStat({
    required this.label,
    required this.value,
    this.note,
    this.accent = false,
    this.icon,
    this.color,
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
                child: Container(
                  decoration: BoxDecoration(
                    color: AppTheme.card,
                    borderRadius: BorderRadius.circular(AppTheme.rSmall),
                    border: Border.all(color: AppTheme.border),
                    boxShadow: AppTheme.subtle,
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: IntrinsicHeight(
                    child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Container(width: 3.5, color: (item.color ?? AppTheme.accent).withValues(alpha: item.accent ? 1 : 0.35)),
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(AppTheme.s8, AppTheme.s8, AppTheme.s8, AppTheme.s8),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Row(
                                children: [
                                  if (item.icon != null) ...[
                                    Icon(item.icon, size: 13, color: item.color ?? AppTheme.muted),
                                    const SizedBox(width: 4),
                                  ],
                                  Expanded(
                                    child: Text(
                                      item.label,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(color: AppTheme.muted, fontSize: 10, fontWeight: FontWeight.w600),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 3),
                              Text(
                                item.value,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: item.accent ? (item.color ?? AppTheme.accent) : AppTheme.heading,
                                  fontSize: 19,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: -0.3,
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
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}
