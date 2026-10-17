import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import '../screens/theme.dart';

/// A horizontally scrolling sheet whose scrollbar is always visible —
/// mirrors the web's `overflow-x: auto` tables, where the bar under the grid
/// tells the reader more columns sit off to the right.
///
/// With [rowsScrollbar], a [StickyHeaderTable] inside it also gets an
/// always-visible vertical bar for its rows, drawn at the right edge of the
/// visible sheet — the web's own `overflow-y: auto` bar — rather than at the
/// far end of a table that may run off screen to the right.
class HScrollTable extends StatefulWidget {
  final Widget child;
  final bool rowsScrollbar;

  const HScrollTable({
    super.key,
    required this.child,
    this.rowsScrollbar = false,
  });

  /// The controller a [StickyHeaderTable]'s rows should scroll with, when
  /// the [HScrollTable] around it draws their vertical bar.
  static ScrollController? rowsControllerOf(BuildContext context) => context
      .dependOnInheritedWidgetOfExactType<_RowsScroll>()
      ?.controller;

  @override
  State<HScrollTable> createState() => _HScrollTableState();
}

class _HScrollTableState extends State<HScrollTable> {
  final _controller = ScrollController();
  final _rowsController = ScrollController();
  // Measured off the sheet's header row, so the rows' bar starts under it
  // instead of running over the column titles.
  final _headerHeight = ValueNotifier<double>(0);

  @override
  void dispose() {
    _controller.dispose();
    _rowsController.dispose();
    _headerHeight.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ScrollbarTheme(
      data: ScrollbarThemeData(
        thumbColor: WidgetStateProperty.all(
          AppTheme.muted.withValues(alpha: 0.45),
        ),
        trackColor: WidgetStateProperty.all(
          AppTheme.muted.withValues(alpha: 0.08),
        ),
        trackBorderColor: WidgetStateProperty.all(Colors.transparent),
        radius: const Radius.circular(AppTheme.rMedium),
        thickness: WidgetStateProperty.all(6),
      ),
      child: widget.rowsScrollbar
          ? _RowsScroll(
              controller: _rowsController,
              headerHeight: _headerHeight,
              child: ValueListenableBuilder<double>(
                valueListenable: _headerHeight,
                builder: (context, headerHeight, child) {
                  final media = MediaQuery.of(context);
                  // A Scrollbar insets its track by the ambient padding: top
                  // keeps it below the header, bottom clear of the
                  // horizontal bar. The sheet itself gets the real padding
                  // back.
                  return MediaQuery(
                    data: media.copyWith(
                      padding: EdgeInsets.only(top: headerHeight, bottom: 10),
                    ),
                    child: Scrollbar(
                      controller: _rowsController,
                      thumbVisibility: true,
                      trackVisibility: true,
                      // The rows sit one level down, inside the horizontal
                      // scroller, so their notifications aren't at depth 0.
                      notificationPredicate: (n) =>
                          n.metrics.axis == Axis.vertical,
                      // Its own lane on the right, like the web's
                      // `overflow-y` bar, so it never sits on cell text.
                      child: MediaQuery(
                        data: media,
                        child: Padding(
                          padding: const EdgeInsets.only(right: 10),
                          child: child,
                        ),
                      ),
                    ),
                  );
                },
                child: _horizontal(),
              ),
            )
          : _horizontal(),
    );
  }

  Widget _horizontal() => Scrollbar(
    controller: _controller,
    thumbVisibility: true,
    trackVisibility: true,
    child: SingleChildScrollView(
      controller: _controller,
      scrollDirection: Axis.horizontal,
      // Room under the last row so the bar never covers it.
      padding: const EdgeInsets.only(bottom: 10),
      child: widget.child,
    ),
  );
}

class _RowsScroll extends InheritedWidget {
  final ScrollController controller;
  final ValueNotifier<double> headerHeight;

  const _RowsScroll({
    required this.controller,
    required this.headerHeight,
    required super.child,
  });

  @override
  bool updateShouldNotify(_RowsScroll old) =>
      old.controller != controller || old.headerHeight != headerHeight;
}

/// Reports its child's laid-out height into [height] after each layout.
class _ReportHeight extends SingleChildRenderObjectWidget {
  final ValueNotifier<double> height;

  const _ReportHeight({required this.height, required super.child});

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderReportHeight(height);

  @override
  void updateRenderObject(
    BuildContext context,
    _RenderReportHeight renderObject,
  ) => renderObject.height = height;
}

class _RenderReportHeight extends RenderProxyBox {
  ValueNotifier<double> height;

  _RenderReportHeight(this.height);

  @override
  void performLayout() {
    super.performLayout();
    final h = size.height;
    if (h == height.value) return;
    // Not during layout: the notifier rebuilds the Scrollbar above.
    WidgetsBinding.instance.addPostFrameCallback((_) => height.value = h);
  }
}

/// A sheet's column header with its rows scrolling underneath it, so the
/// header never leaves view. Given a bounded height — a screen that hands
/// the table the rest of the page instead of scrolling the page itself — it
/// shrinks to its rows and scrolls only once they outgrow that space. Inside
/// a page that scrolls, it falls back to capping the rows at 60% of the
/// screen.
class StickyHeaderTable extends StatelessWidget {
  final Widget header;
  final List<Widget> rows;

  const StickyHeaderTable({
    super.key,
    required this.header,
    required this.rows,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final bounded = constraints.hasBoundedHeight;
        final body = ListView(
          controller: HScrollTable.rowsControllerOf(context),
          primary: false,
          shrinkWrap: true,
          padding: EdgeInsets.zero,
          children: rows,
        );
        final headerHeight = context
            .dependOnInheritedWidgetOfExactType<_RowsScroll>()
            ?.headerHeight;
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (headerHeight != null)
              _ReportHeight(height: headerHeight, child: header)
            else
              header,
            if (bounded)
              Flexible(child: body)
            else
              ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.sizeOf(context).height * 0.6,
                ),
                child: body,
              ),
          ],
        );
      },
    );
  }
}

/// A list page's body. In card view it scrolls as one page, as before. In
/// table view ([table]) the page itself stops scrolling: everything above
/// the last child — search, filters, summary — stays put, and the last
/// child (the table, or the notice standing in for it) takes the rest of
/// the screen, so only the table's own rows scroll, under a header that
/// never leaves view.
///
/// The fixed part is capped at half the height and scrolls on its own past
/// that, so a short phone screen can't push the table off the bottom.
class TablePageBody extends StatelessWidget {
  final bool table;
  final EdgeInsetsGeometry? padding;
  final List<Widget> children;

  const TablePageBody({
    super.key,
    required this.table,
    this.padding,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    if (!table || children.isEmpty) {
      return ListView(
        padding: padding,
        physics: const AlwaysScrollableScrollPhysics(),
        children: children,
      );
    }
    return Padding(
      padding: padding ?? EdgeInsets.zero,
      child: LayoutBuilder(
        builder: (context, constraints) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ConstrainedBox(
              constraints: BoxConstraints(maxHeight: constraints.maxHeight / 2),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: children.sublist(0, children.length - 1),
                ),
              ),
            ),
            Flexible(child: children.last),
          ],
        ),
      ),
    );
  }
}
