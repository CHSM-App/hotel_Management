import 'package:flutter/material.dart';

import '../screens/theme.dart';

/// Drop-in replacement for [showDatePicker] that renders a small, single
/// screen calendar card (month header with prev/next arrows, a weekday row,
/// a day grid) instead of Material's big "Sat, Oct 3" banner dialog — every
/// call site kept its existing `showDatePicker(...)` argument list, so only
/// the function name changed.
///
/// `builder` is accepted only so pre-existing call sites that wrapped the
/// picker in a `Theme(...)` override keep compiling; this dialog draws its
/// own chrome and ignores it.
Future<DateTime?> showAppDatePicker({
  required BuildContext context,
  required DateTime initialDate,
  required DateTime firstDate,
  required DateTime lastDate,
  DateTime? currentDate,
  String? helpText,
  Widget Function(BuildContext, Widget?)? builder,
}) {
  final clampedInitial = initialDate.isBefore(firstDate)
      ? firstDate
      : (initialDate.isAfter(lastDate) ? lastDate : initialDate);
  return showDialog<DateTime>(
    context: context,
    barrierDismissible: true,
    builder: (ctx) => _CompactDatePickerDialog(
      initialDate: DateUtils.dateOnly(clampedInitial),
      firstDate: DateUtils.dateOnly(firstDate),
      lastDate: DateUtils.dateOnly(lastDate),
      helpText: helpText,
    ),
  );
}

/// Drop-in replacement for [showDateRangePicker] using the same compact
/// card — tap a start day, then an end day; the days between them fill with
/// a light band the way the built-in range picker does.
Future<DateTimeRange?> showAppDateRangePicker({
  required BuildContext context,
  DateTimeRange? initialDateRange,
  required DateTime firstDate,
  required DateTime lastDate,
  String? helpText,
}) {
  DateTime clamp(DateTime d) =>
      d.isBefore(firstDate) ? firstDate : (d.isAfter(lastDate) ? lastDate : d);
  final now = DateUtils.dateOnly(DateTime.now());
  final start = clamp(DateUtils.dateOnly(initialDateRange?.start ?? now));
  final end = clamp(DateUtils.dateOnly(initialDateRange?.end ?? start));
  return showDialog<DateTimeRange>(
    context: context,
    barrierDismissible: true,
    builder: (ctx) => _CompactDatePickerDialog(
      initialDate: start,
      firstDate: DateUtils.dateOnly(firstDate),
      lastDate: DateUtils.dateOnly(lastDate),
      helpText: helpText,
      isRange: true,
      initialRangeStart: start,
      initialRangeEnd: end,
    ),
  );
}

class _CompactDatePickerDialog extends StatefulWidget {
  final DateTime initialDate;
  final DateTime firstDate;
  final DateTime lastDate;
  final String? helpText;
  final bool isRange;
  final DateTime? initialRangeStart;
  final DateTime? initialRangeEnd;

  const _CompactDatePickerDialog({
    required this.initialDate,
    required this.firstDate,
    required this.lastDate,
    this.helpText,
    this.isRange = false,
    this.initialRangeStart,
    this.initialRangeEnd,
  });

  @override
  State<_CompactDatePickerDialog> createState() => _CompactDatePickerDialogState();
}

class _CompactDatePickerDialogState extends State<_CompactDatePickerDialog> {
  static const _weekdayLabels = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  static const _monthLabels = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  late DateTime _displayedMonth;
  late DateTime _selected;
  DateTime? _rangeStart;
  DateTime? _rangeEnd;
  bool _showYearGrid = false;
  late final ScrollController _yearScrollController;

  @override
  void initState() {
    super.initState();
    _selected = widget.initialDate;
    _rangeStart = widget.initialRangeStart;
    _rangeEnd = widget.initialRangeEnd;
    _displayedMonth = DateTime(widget.initialDate.year, widget.initialDate.month);
    // Centers the grid roughly on the current year on first open — each row
    // of 3 chips is ~44px tall, so this is an estimate, not an exact scroll.
    final rowOfCurrentYear = (_displayedMonth.year - widget.firstDate.year) ~/ 3;
    _yearScrollController = ScrollController(
      initialScrollOffset: (rowOfCurrentYear - 2).clamp(0, 1 << 30) * 44.0,
    );
  }

  @override
  void dispose() {
    _yearScrollController.dispose();
    super.dispose();
  }

  bool get _canGoPrev {
    final prevMonthEnd = DateTime(_displayedMonth.year, _displayedMonth.month, 0);
    return !prevMonthEnd.isBefore(widget.firstDate);
  }

  bool get _canGoNext {
    final nextMonthStart = DateTime(_displayedMonth.year, _displayedMonth.month + 1);
    return !nextMonthStart.isAfter(widget.lastDate);
  }

  void _goToMonth(int delta) {
    setState(() {
      _displayedMonth = DateTime(_displayedMonth.year, _displayedMonth.month + delta);
    });
  }

  void _onDayTap(DateTime date) {
    if (!widget.isRange) {
      setState(() => _selected = date);
      return;
    }
    setState(() {
      if (_rangeStart == null || _rangeEnd != null) {
        _rangeStart = date;
        _rangeEnd = null;
      } else if (date.isBefore(_rangeStart!)) {
        _rangeEnd = _rangeStart;
        _rangeStart = date;
      } else {
        _rangeEnd = date;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final today = DateUtils.dateOnly(DateTime.now());
    final daysInMonth = DateUtils.getDaysInMonth(_displayedMonth.year, _displayedMonth.month);
    final firstOfMonth = DateTime(_displayedMonth.year, _displayedMonth.month, 1);
    // DateTime.weekday: Mon=1..Sun=7 — matches the Mo..Su header directly.
    final leadingBlanks = firstOfMonth.weekday - 1;
    final totalCells = leadingBlanks + daysInMonth;
    final rows = (totalCells / 7).ceil();

    return Dialog(
      backgroundColor: AppTheme.card,
      insetPadding: const EdgeInsets.symmetric(horizontal: 40, vertical: 24),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.rLarge),
      ),
      elevation: 8,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 300),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (widget.helpText != null) ...[
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    widget.helpText!,
                    style: const TextStyle(
                      color: AppTheme.muted,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const SizedBox(height: 6),
              ],
              Row(
                children: [
                  Expanded(
                    child: InkWell(
                      borderRadius: BorderRadius.circular(6),
                      onTap: () => setState(() => _showYearGrid = !_showYearGrid),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              '${_monthLabels[_displayedMonth.month - 1]} ${_displayedMonth.year}',
                              style: const TextStyle(
                                color: AppTheme.heading,
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(width: 4),
                            AnimatedRotation(
                              turns: _showYearGrid ? 0.5 : 0,
                              duration: const Duration(milliseconds: 150),
                              child: const Icon(
                                Icons.keyboard_arrow_down,
                                size: 20,
                                color: AppTheme.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  if (!_showYearGrid) ...[
                    _NavButton(
                      icon: Icons.chevron_left,
                      onPressed: _canGoPrev ? () => _goToMonth(-1) : null,
                    ),
                    const SizedBox(width: 6),
                    _NavButton(
                      icon: Icons.chevron_right,
                      onPressed: _canGoNext ? () => _goToMonth(1) : null,
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 10),
              if (_showYearGrid) ...[
                SizedBox(
                  height: 220,
                  child: GridView.builder(
                    controller: _yearScrollController,
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 3,
                      childAspectRatio: 2,
                      mainAxisSpacing: 4,
                      crossAxisSpacing: 4,
                    ),
                    itemCount: widget.lastDate.year - widget.firstDate.year + 1,
                    itemBuilder: (context, index) {
                      final year = widget.firstDate.year + index;
                      final isSelected = year == _displayedMonth.year;
                      return Material(
                        color: isSelected ? AppTheme.accent : Colors.transparent,
                        borderRadius: BorderRadius.circular(8),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(8),
                          onTap: () => setState(() {
                            _displayedMonth = DateTime(year, _displayedMonth.month);
                            _showYearGrid = false;
                          }),
                          child: Center(
                            child: Text(
                              '$year',
                              style: TextStyle(
                                color: isSelected ? Colors.white : AppTheme.text,
                                fontSize: 13,
                                fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                              ),
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ] else ...[
                Row(
                  children: _weekdayLabels
                      .map((d) => Expanded(
                            child: Center(
                              child: Text(
                                d,
                                style: const TextStyle(
                                  color: AppTheme.muted,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ))
                      .toList(),
                ),
                const SizedBox(height: 4),
                for (var row = 0; row < rows; row++)
                  Row(
                    children: List.generate(7, (col) {
                      final cellIndex = row * 7 + col;
                      final day = cellIndex - leadingBlanks + 1;
                      if (day < 1 || day > daysInMonth) {
                        return const Expanded(child: SizedBox(height: 36));
                      }
                      final date = DateTime(_displayedMonth.year, _displayedMonth.month, day);
                      final inBounds = !date.isBefore(widget.firstDate) && !date.isAfter(widget.lastDate);
                      final isToday = DateUtils.isSameDay(date, today);
                      if (widget.isRange) {
                        final start = _rangeStart;
                        final end = _rangeEnd;
                        final isStart = start != null && DateUtils.isSameDay(date, start);
                        final isEnd = end != null && DateUtils.isSameDay(date, end);
                        final isBetween = start != null &&
                            end != null &&
                            date.isAfter(start) &&
                            date.isBefore(end);
                        return Expanded(
                          child: _RangeDayCell(
                            day: day,
                            isStart: isStart,
                            isEnd: isEnd,
                            isBetween: isBetween,
                            today: isToday && !isStart && !isEnd,
                            enabled: inBounds,
                            onTap: inBounds ? () => _onDayTap(date) : null,
                          ),
                        );
                      }
                      final isSelected = DateUtils.isSameDay(date, _selected);
                      return Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 2),
                          child: _DayCell(
                            day: day,
                            selected: isSelected,
                            today: isToday && !isSelected,
                            enabled: inBounds,
                            onTap: inBounds ? () => _onDayTap(date) : null,
                          ),
                        ),
                      );
                    }),
                  ),
              ],
              const SizedBox(height: 4),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    style: TextButton.styleFrom(foregroundColor: AppTheme.muted),
                    child: const Text('Cancel', style: TextStyle(fontWeight: FontWeight.w600)),
                  ),
                  TextButton(
                    onPressed: widget.isRange && _rangeStart == null
                        ? null
                        : () => Navigator.of(context).pop(
                              widget.isRange
                                  ? DateTimeRange(
                                      start: _rangeStart!,
                                      end: _rangeEnd ?? _rangeStart!,
                                    )
                                  : _selected,
                            ),
                    style: TextButton.styleFrom(foregroundColor: AppTheme.accent),
                    child: const Text('OK', style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onPressed;

  const _NavButton({required this.icon, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    return Material(
      color: enabled ? AppTheme.accent : AppTheme.accent.withValues(alpha: 0.3),
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onPressed,
        child: SizedBox(
          width: 26,
          height: 26,
          child: Icon(icon, size: 18, color: Colors.white),
        ),
      ),
    );
  }
}

class _RangeDayCell extends StatelessWidget {
  final int day;
  final bool isStart;
  final bool isEnd;
  final bool isBetween;
  final bool today;
  final bool enabled;
  final VoidCallback? onTap;

  const _RangeDayCell({
    required this.day,
    required this.isStart,
    required this.isEnd,
    required this.isBetween,
    required this.today,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final sameDay = isStart && isEnd;
    final isEndpoint = isStart || isEnd;

    return SizedBox(
      height: 36,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (isBetween || (isEndpoint && !sameDay))
            Row(
              children: [
                Expanded(
                  child: Container(
                    color: isStart && !sameDay ? Colors.transparent : AppTheme.sidebarBrandWash,
                  ),
                ),
                Expanded(
                  child: Container(
                    color: isEnd && !sameDay ? Colors.transparent : AppTheme.sidebarBrandWash,
                  ),
                ),
              ],
            ),
          Material(
            color: isEndpoint
                ? AppTheme.accent
                : (today ? AppTheme.accent.withValues(alpha: 0.1) : Colors.transparent),
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: onTap,
              child: SizedBox(
                width: 36,
                height: 36,
                child: Center(
                  child: Text(
                    '$day',
                    style: TextStyle(
                      color: isEndpoint
                          ? Colors.white
                          : (!enabled ? AppTheme.muted.withValues(alpha: 0.4) : AppTheme.text),
                      fontSize: 13,
                      fontWeight: isEndpoint || today ? FontWeight.w700 : FontWeight.w500,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DayCell extends StatelessWidget {
  final int day;
  final bool selected;
  final bool today;
  final bool enabled;
  final VoidCallback? onTap;

  const _DayCell({
    required this.day,
    required this.selected,
    required this.today,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final bg = selected
        ? AppTheme.accent
        : (today ? AppTheme.accent.withValues(alpha: 0.1) : Colors.transparent);
    final fg = selected
        ? Colors.white
        : (!enabled ? AppTheme.muted.withValues(alpha: 0.4) : AppTheme.text);

    return AspectRatio(
      aspectRatio: 1,
      child: Material(
        color: bg,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: Center(
            child: Text(
              '$day',
              style: TextStyle(
                color: fg,
                fontSize: 13,
                fontWeight: selected || today ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
