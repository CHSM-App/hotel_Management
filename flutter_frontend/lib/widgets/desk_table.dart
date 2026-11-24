import 'package:flutter/material.dart';

import '../screens/theme.dart';
import 'h_scroll_table.dart';
import 'neu.dart';

/// One column of a [DeskTable]: header text and its base width (columns grow
/// together to fill a wide window, see [TableSheet]).
class DeskColumn {
  final String label;
  final double width;
  final TextAlign align;

  /// A low-priority column is dropped on a tablet or laptop (see
  /// [AppTheme.showLowPriorityColumns]).
  final bool lowPriority;
  const DeskColumn(
    this.label,
    this.width, {
    this.align = TextAlign.left,
    this.lowPriority = false,
  });
}

/// One row: a cell per column (in order), an optional trailing actions cell,
/// and what a click on the row does.
class DeskRow {
  final List<Widget> cells;
  final Widget? actions;
  final VoidCallback? onTap;
  const DeskRow({required this.cells, this.actions, this.onTap});
}

/// The desktop list: header on top, striped rows with hover, actions on the
/// right. Same look as the Expenses table, packaged so a screen only supplies
/// columns and cells. Give it a bounded height (e.g. as the last child of
/// [TablePageBody]) and only the rows scroll.
class DeskTable extends StatelessWidget {
  final List<DeskColumn> columns;
  final List<DeskRow> rows;

  /// Width reserved for the trailing actions cell; 0 hides it.
  final double actionsWidth;

  const DeskTable({
    super.key,
    required this.columns,
    required this.rows,
    this.actionsWidth = 0,
  });

  static const _cellPad = EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10);

  @override
  Widget build(BuildContext context) {
    final showAll = AppTheme.showLowPriorityColumns(context);
    // Indices of the columns this tier shows; rows' cells are picked by index.
    final shown = [
      for (var i = 0; i < this.columns.length; i++)
        if (showAll || !this.columns[i].lowPriority) i,
    ];
    final columns = [for (final i in shown) this.columns[i]];
    final width = columns.fold<double>(0, (s, c) => s + c.width) + actionsWidth + AppTheme.s8;
    return NeuCard(
      padding: EdgeInsets.zero,
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        child: HScrollTable(
          rowsScrollbar: true,
          child: TableSheet(
            width: width,
            child: StickyHeaderTable(
              header: Container(
                decoration: const BoxDecoration(
                  color: AppTheme.sidebarBrandWash,
                  border: Border(bottom: BorderSide(color: AppTheme.sidebarBrandWashEdge, width: 0.8)),
                ),
                child: Row(
                  children: [
                    const SizedBox(width: AppTheme.s8),
                    for (final c in columns)
                      TableCol(
                        width: c.width,
                        child: Padding(
                          padding: _cellPad,
                          child: Text(
                            c.label.toUpperCase(),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: c.align,
                            style: const TextStyle(
                              color: AppTheme.heading,
                              fontSize: 10.5,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.3,
                            ),
                          ),
                        ),
                      ),
                    if (actionsWidth > 0) TableCol(width: actionsWidth),
                  ],
                ),
              ),
              rows: [
                for (var i = 0; i < rows.length; i++) _row(rows[i], shown, shaded: i.isOdd),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _row(DeskRow r, List<int> shown, {required bool shaded}) {
    return Container(
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppTheme.border, width: 0.8)),
      ),
      child: Material(
        color: shaded ? AppTheme.border.withValues(alpha: 0.25) : AppTheme.card,
        child: InkWell(
          onTap: r.onTap,
          hoverColor: AppTheme.accent.withValues(alpha: 0.06),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              const SizedBox(width: AppTheme.s8),
              for (final i in shown)
                TableCol(
                  width: columns[i].width,
                  child: Padding(
                    padding: _cellPad,
                    child: Align(
                      alignment: switch (columns[i].align) {
                        TextAlign.right || TextAlign.end => Alignment.centerRight,
                        TextAlign.center => Alignment.center,
                        _ => Alignment.centerLeft,
                      },
                      child: r.cells[i],
                    ),
                  ),
                ),
              if (actionsWidth > 0)
                TableCol(
                  width: actionsWidth,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 6),
                    child: Align(alignment: Alignment.centerRight, child: r.actions),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A single-line text cell in the table's standard style.
class DeskText extends StatelessWidget {
  final String text;
  final bool bold;
  final Color? color;
  const DeskText(this.text, {super.key, this.bold = false, this.color});

  @override
  Widget build(BuildContext context) => Text(
    text.isEmpty ? '—' : text,
    maxLines: 1,
    overflow: TextOverflow.ellipsis,
    style: TextStyle(
      color: color ?? (text.isEmpty ? AppTheme.muted : AppTheme.heading),
      fontSize: 12.5,
      fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
    ),
  );
}
