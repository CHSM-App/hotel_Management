import 'package:flutter/material.dart';

import '../../widgets/neu.dart';
import '../theme.dart';

/// Shared bits across the three report panels — the stat grid, the loading
/// and error states, and the booking-status pill.

class ReportLoading extends StatelessWidget {
  const ReportLoading({super.key});

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: AppTheme.s48),
      child: Center(child: CircularProgressIndicator()),
    );
  }
}

class ReportError extends StatelessWidget {
  final String message;

  const ReportError({super.key, required this.message});

  @override
  Widget build(BuildContext context) {
    return NeuNotice(icon: Icons.cloud_off_rounded, message: message);
  }
}

class StatItem {
  final String label;
  final String value;
  final bool accent;

  const StatItem({required this.label, required this.value, this.accent = false});
}

/// A wrapping grid of stat tiles, the phone equivalent of the web's
/// `.reports-panel__stat-grid`.
class StatGrid extends StatelessWidget {
  final List<StatItem> items;

  const StatGrid({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppTheme.s8,
      runSpacing: AppTheme.s8,
      children: [
        for (final item in items)
          SizedBox(
            width: (MediaQuery.sizeOf(context).width - AppTheme.s16 * 2 - AppTheme.s8) / 2,
            child: NeuCard(
              radius: AppTheme.rMedium,
              shadow: AppTheme.subtle,
              padding: const EdgeInsets.all(AppTheme.s12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.label,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w400),
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    item.value,
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      color: item.accent ? AppTheme.accent : AppTheme.heading,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// One column of a [ReportDataTable] — a fixed pixel width (rather than a
/// flex) because the table scrolls horizontally instead of squeezing to fit,
/// the same trade-off the web's `.dash-table-scroll` makes.
class ReportTableColumn {
  final String label;
  final double width;
  final TextAlign align;

  const ReportTableColumn(this.label, {this.width = 90, this.align = TextAlign.left});
}

/// A real data grid for a report register — the phone equivalent of the
/// web's `.dash-table` inside `.dash-table-scroll`: an uppercase muted
/// header on a tinted band, light zebra striping, right-aligned money
/// columns, and horizontal scroll instead of wrapping or stacking, so the
/// column set matches the PDF register exactly rather than inventing a
/// second layout for the same data.
class ReportDataTable extends StatelessWidget {
  final List<ReportTableColumn> columns;
  final List<List<String>> rows;
  final List<String>? totals;

  const ReportDataTable({
    super.key,
    required this.columns,
    required this.rows,
    this.totals,
  });

  double get _width => columns.fold(0, (sum, c) => sum + c.width);

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      padding: EdgeInsets.zero,
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: _width,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _row(
                  context,
                  columns.map((c) => c.label.toUpperCase()).toList(),
                  columns.map((c) => c.align).toList(),
                  header: true,
                ),
                for (var i = 0; i < rows.length; i++)
                  _row(
                    context,
                    rows[i],
                    columns.map((c) => c.align).toList(),
                    shaded: i.isOdd,
                  ),
                if (totals != null)
                  _row(
                    context,
                    totals!,
                    columns.map((c) => c.align).toList(),
                    bold: true,
                    border: true,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _row(
    BuildContext context,
    List<String> cells,
    List<TextAlign> aligns, {
    bool header = false,
    bool shaded = false,
    bool bold = false,
    bool border = false,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: header
            ? AppTheme.bg
            : shaded
            ? AppTheme.border.withValues(alpha: 0.4)
            : AppTheme.card,
        border: Border(
          bottom: BorderSide(
            color: AppTheme.border,
            width: border ? 1.4 : 0.8,
          ),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          for (var i = 0; i < columns.length; i++)
            SizedBox(
              width: columns[i].width,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
                child: Text(
                  i < cells.length ? cells[i] : '',
                  textAlign: aligns[i],
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: header
                      ? Theme.of(context).textTheme.labelSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.3,
                        )
                      : Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: AppTheme.text,
                          fontWeight: bold ? FontWeight.w700 : FontWeight.w400,
                          fontSize: 12.5,
                        ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The booking-status pill — green for anything live, grey for cancelled,
/// matching the web's `badge--on` / `badge--off`.
class StatusBadge extends StatelessWidget {
  final String status;
  final String label;

  const StatusBadge({super.key, required this.status, required this.label});

  @override
  Widget build(BuildContext context) {
    final off = status == 'CANCELLED';
    final color = off ? AppTheme.muted : AppTheme.vacant;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          color: color,
          fontWeight: FontWeight.w600,
        ),
        overflow: TextOverflow.ellipsis,
      ),
    );
  }
}
