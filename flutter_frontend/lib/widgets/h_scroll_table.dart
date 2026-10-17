import 'package:flutter/material.dart';

import '../screens/theme.dart';

/// A horizontally scrolling sheet whose scrollbar is always visible —
/// mirrors the web's `overflow-x: auto` tables, where the bar under the grid
/// tells the reader more columns sit off to the right.
class HScrollTable extends StatefulWidget {
  final Widget child;

  const HScrollTable({super.key, required this.child});

  @override
  State<HScrollTable> createState() => _HScrollTableState();
}

class _HScrollTableState extends State<HScrollTable> {
  final _controller = ScrollController();

  @override
  void dispose() {
    _controller.dispose();
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
      child: Scrollbar(
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
      ),
    );
  }
}
