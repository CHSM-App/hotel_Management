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

/// A day-by-day area/line chart, optionally overlaid with a prior-period
/// line for comparison — the phone equivalent of the web's `TrendChart`,
/// used for "Daily revenue". Scaled to whatever min/max the data actually
/// reaches, never a hardcoded axis.
class ReportTrendChart extends StatelessWidget {
  final String title;
  final List<num> values;
  final List<num>? priorValues;
  final String firstLabel;
  final String midLabel;
  final String lastLabel;
  final String Function(num value) formatValue;
  final bool showComparison;

  const ReportTrendChart({
    super.key,
    required this.title,
    required this.values,
    this.priorValues,
    required this.firstLabel,
    required this.midLabel,
    required this.lastLabel,
    required this.formatValue,
    this.showComparison = false,
  });

  @override
  Widget build(BuildContext context) {
    if (values.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            if (showComparison)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _legendDot(context, AppTheme.accent, 'This period'),
                  const SizedBox(width: AppTheme.s12),
                  _legendDot(context, AppTheme.muted, 'Prior period'),
                ],
              ),
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        NeuCard(
          radius: AppTheme.rMedium,
          shadow: AppTheme.subtle,
          padding: const EdgeInsets.fromLTRB(AppTheme.s8, AppTheme.s16, AppTheme.s16, AppTheme.s8),
          child: SizedBox(
            height: 180,
            child: LayoutBuilder(
              builder: (context, constraints) => CustomPaint(
                size: Size(constraints.maxWidth, constraints.maxHeight),
                painter: _TrendPainter(
                  values: values,
                  priorValues: priorValues,
                  formatValue: formatValue,
                  labelStyle: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppTheme.muted) ??
                      const TextStyle(),
                  firstLabel: firstLabel,
                  midLabel: midLabel,
                  lastLabel: lastLabel,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _legendDot(BuildContext context, Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 4),
        Text(label, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppTheme.muted)),
      ],
    );
  }
}

class _TrendPainter extends CustomPainter {
  final List<num> values;
  final List<num>? priorValues;
  final String Function(num value) formatValue;
  final TextStyle labelStyle;
  final String firstLabel;
  final String midLabel;
  final String lastLabel;

  const _TrendPainter({
    required this.values,
    required this.priorValues,
    required this.formatValue,
    required this.labelStyle,
    required this.firstLabel,
    required this.midLabel,
    required this.lastLabel,
  });

  @override
  void paint(Canvas canvas, Size size) {
    const padLeft = 4.0;
    const padBottom = 18.0;
    const padTop = 4.0;
    final plotW = size.width - padLeft;
    final plotH = size.height - padTop - padBottom;
    if (plotW <= 0 || plotH <= 0) return;

    final allValues = [...values, ...?priorValues];
    final maxValue = allValues.fold<num>(1, (a, b) => b > a ? b : a);

    Offset pointAt(int i, int count, num value) {
      final x = padLeft + (count <= 1 ? 0 : (i / (count - 1)) * plotW);
      final y = padTop + plotH - (value / maxValue) * plotH;
      return Offset(x, y);
    }

    // Gridlines.
    final gridPaint = Paint()
      ..color = AppTheme.border
      ..strokeWidth = 1;
    for (final frac in [0.0, 0.5, 1.0]) {
      final y = padTop + plotH * frac;
      canvas.drawLine(Offset(padLeft, y), Offset(size.width, y), gridPaint);
    }

    if (priorValues != null && priorValues!.isNotEmpty) {
      final priorPath = Path();
      for (var i = 0; i < priorValues!.length; i++) {
        final p = pointAt(i, priorValues!.length, priorValues![i]);
        if (i == 0) {
          priorPath.moveTo(p.dx, p.dy);
        } else {
          priorPath.lineTo(p.dx, p.dy);
        }
      }
      canvas.drawPath(
        priorPath,
        Paint()
          ..color = AppTheme.muted
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5,
      );
    }

    if (values.isNotEmpty) {
      final linePath = Path();
      final areaPath = Path();
      for (var i = 0; i < values.length; i++) {
        final p = pointAt(i, values.length, values[i]);
        if (i == 0) {
          linePath.moveTo(p.dx, p.dy);
          areaPath.moveTo(p.dx, padTop + plotH);
          areaPath.lineTo(p.dx, p.dy);
        } else {
          linePath.lineTo(p.dx, p.dy);
          areaPath.lineTo(p.dx, p.dy);
        }
      }
      final last = pointAt(values.length - 1, values.length, values[values.length - 1]);
      areaPath.lineTo(last.dx, padTop + plotH);
      areaPath.close();

      canvas.drawPath(areaPath, Paint()..color = AppTheme.accent.withValues(alpha: 0.12));
      canvas.drawPath(
        linePath,
        Paint()
          ..color = AppTheme.accent
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2,
      );
      canvas.drawCircle(last, 3, Paint()..color = AppTheme.accent);

      final lastValuePainter = TextPainter(
        text: TextSpan(
          text: formatValue(values.last),
          style: labelStyle.copyWith(color: AppTheme.heading, fontWeight: FontWeight.w600),
        ),
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: size.width);
      final labelX = (last.dx - lastValuePainter.width).clamp(0, size.width - lastValuePainter.width).toDouble();
      final labelY = (last.dy - lastValuePainter.height - 4).clamp(0, size.height).toDouble();
      lastValuePainter.paint(canvas, Offset(labelX, labelY));
    }

    void drawLabel(String text, double x, TextAlign align) {
      if (text.isEmpty) return;
      final painter = TextPainter(
        text: TextSpan(text: text, style: labelStyle),
        textAlign: align,
        textDirection: TextDirection.ltr,
      )..layout();
      final dx = switch (align) {
        TextAlign.left => x,
        TextAlign.right => x - painter.width,
        _ => x - painter.width / 2,
      };
      painter.paint(canvas, Offset(dx, size.height - padBottom + 4));
    }

    drawLabel(firstLabel, padLeft, TextAlign.left);
    drawLabel(midLabel, padLeft + plotW / 2, TextAlign.center);
    drawLabel(lastLabel, size.width, TextAlign.right);
  }

  @override
  bool shouldRepaint(covariant _TrendPainter oldDelegate) =>
      oldDelegate.values != values || oldDelegate.priorValues != priorValues;
}

/// "1 Sept" from an ISO date string — the trend chart's axis labels.
String formatShortDate(String iso) {
  final parsed = DateTime.tryParse(iso);
  if (parsed == null) return iso;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return '${parsed.day} ${months[parsed.month - 1]}';
}

/// A "vs. prior period" badge — up/down arrow and percent, flat, or "no
/// prior data" when there's nothing to compare against. The phone
/// equivalent of the web's `DeltaBadge`.
class ReportDeltaBadge extends StatelessWidget {
  final num? current;
  final num? prior;
  final String suffix;
  final bool light;

  const ReportDeltaBadge({
    super.key,
    required this.current,
    required this.prior,
    this.suffix = 'vs. prior period',
    this.light = false,
  });

  @override
  Widget build(BuildContext context) {
    final mutedColor = light ? Colors.white70 : AppTheme.muted;
    if (prior == null || prior == 0 || current == null) {
      return Text('No prior data', style: TextStyle(fontSize: 11, color: mutedColor));
    }
    final delta = ((current! - prior!) / prior!) * 100;
    final rounded = (delta.abs() * 10).round() / 10;
    if (rounded < 0.1) {
      return Text('Flat $suffix', style: TextStyle(fontSize: 11, color: mutedColor));
    }
    final up = delta > 0;
    final color = light ? Colors.white : (up ? AppTheme.vacant : AppTheme.danger);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(up ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded, size: 12, color: color),
        const SizedBox(width: 2),
        Text(
          '$rounded% $suffix',
          style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w600),
        ),
      ],
    );
  }
}

/// One card of a [KpiRow].
class KpiCardData {
  final String label;
  final String value;
  final String sub;
  final Widget? delta;
  final bool primary;

  const KpiCardData({
    required this.label,
    required this.value,
    required this.sub,
    this.delta,
    this.primary = false,
  });
}

/// A row of headline KPI cards, the first optionally filled solid as the
/// primary figure — the phone equivalent of the web's `.kpi-row`.
class KpiRow extends StatelessWidget {
  final List<KpiCardData> items;

  const KpiRow({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppTheme.s8,
      runSpacing: AppTheme.s8,
      children: [
        for (final item in items)
          SizedBox(
            width: (MediaQuery.sizeOf(context).width - AppTheme.s16 * 2 - AppTheme.s8) / 2,
            child: Container(
              padding: const EdgeInsets.all(AppTheme.s12),
              decoration: BoxDecoration(
                color: item.primary ? AppTheme.accent : AppTheme.card,
                borderRadius: BorderRadius.circular(AppTheme.rMedium),
                boxShadow: AppTheme.subtle,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.label.toUpperCase(),
                    style: TextStyle(
                      fontSize: 10,
                      letterSpacing: 0.4,
                      fontWeight: FontWeight.w600,
                      color: item.primary ? Colors.white70 : AppTheme.muted,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    item.value,
                    style: TextStyle(
                      fontSize: 19,
                      fontWeight: FontWeight.w700,
                      color: item.primary ? Colors.white : AppTheme.heading,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (item.delta != null) ...[const SizedBox(height: 2), item.delta!],
                  const SizedBox(height: 2),
                  Text(
                    item.sub,
                    style: TextStyle(
                      fontSize: 10.5,
                      color: item.primary ? Colors.white70 : AppTheme.muted,
                    ),
                    overflow: TextOverflow.ellipsis,
                    maxLines: 2,
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// One method's slice of a [ReportPaymentMix].
class PaymentMixSlice {
  final String label;
  final num amount;
  final Color color;

  const PaymentMixSlice({required this.label, required this.amount, required this.color});
}

/// A single stacked bar split by payment method, with a legend beneath —
/// the phone equivalent of the web's inline payment-mix bar, used for
/// "Payment mix".
class ReportPaymentMix extends StatelessWidget {
  final String title;
  final List<PaymentMixSlice> slices;
  final String Function(num value) formatValue;

  const ReportPaymentMix({
    super.key,
    required this.title,
    required this.slices,
    required this.formatValue,
  });

  @override
  Widget build(BuildContext context) {
    final live = slices.where((s) => s.amount > 0).toList();
    if (live.isEmpty) return const SizedBox.shrink();
    final total = live.fold<num>(0, (sum, s) => sum + s.amount);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        NeuCard(
          radius: AppTheme.rMedium,
          shadow: AppTheme.subtle,
          padding: const EdgeInsets.all(AppTheme.s12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(AppTheme.rSmall),
                child: SizedBox(
                  height: 18,
                  child: Row(
                    children: [
                      for (final s in live)
                        Expanded(flex: (s.amount * 1000 / total).round().clamp(1, 100000), child: Container(color: s.color)),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppTheme.s12),
              for (final s in live)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      Container(width: 10, height: 10, decoration: BoxDecoration(color: s.color, shape: BoxShape.circle)),
                      const SizedBox(width: AppTheme.s8),
                      Expanded(
                        child: Text(
                          s.label,
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.text),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(
                        formatValue(s.amount),
                        style: Theme.of(
                          context,
                        ).textTheme.labelSmall?.copyWith(color: AppTheme.heading, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        '${(s.amount / total * 100).round()}%',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppTheme.muted),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// One flagged item of a [ReportInsightList] — a plain-language note an
/// owner can act on.
class ReportInsight {
  final String tone;
  final String title;
  final String body;

  const ReportInsight({required this.tone, required this.title, required this.body});
}

/// A short list of plain-language flags derived from the figures already on
/// the page — the phone equivalent of the web's "What needs a look" list.
class ReportInsightList extends StatelessWidget {
  final String title;
  final List<ReportInsight> insights;

  const ReportInsightList({super.key, required this.title, required this.insights});

  @override
  Widget build(BuildContext context) {
    if (insights.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        NeuCard(
          radius: AppTheme.rMedium,
          shadow: AppTheme.subtle,
          padding: const EdgeInsets.all(AppTheme.s4),
          child: Column(
            children: [
              for (var i = 0; i < insights.length; i++)
                Container(
                  padding: const EdgeInsets.all(AppTheme.s12),
                  decoration: BoxDecoration(
                    border: i < insights.length - 1
                        ? const Border(bottom: BorderSide(color: AppTheme.border))
                        : null,
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(_icon(insights[i].tone), size: 18, color: _color(insights[i].tone)),
                      const SizedBox(width: AppTheme.s12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              insights[i].title,
                              style: Theme.of(
                                context,
                              ).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600, color: AppTheme.heading),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              insights[i].body,
                              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.muted),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  IconData _icon(String tone) => switch (tone) {
    'warn' => Icons.warning_amber_rounded,
    'good' => Icons.check_circle_outline_rounded,
    _ => Icons.info_outline_rounded,
  };

  Color _color(String tone) => switch (tone) {
    'warn' => AppTheme.draft,
    'good' => AppTheme.vacant,
    _ => AppTheme.accent,
  };
}

/// A local From/To date filter for tabs that load their full history once
/// and filter it client-side (Expenses, Other Income, Assets) — same look
/// and behaviour as the shared server-side range picker the date-ranged
/// tabs use (_RangePicker/_DateField in reports_screen.dart), just wired to
/// filter the already-loaded list instead of re-fetching.
class ReportDateRangeFilter extends StatelessWidget {
  final String fromDate;
  final String toDate;
  final ValueChanged<String> onFromChanged;
  final ValueChanged<String> onToChanged;

  const ReportDateRangeFilter({
    super.key,
    required this.fromDate,
    required this.toDate,
    required this.onFromChanged,
    required this.onToChanged,
  });

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Row(
        children: [
          Expanded(
            child: _DateFilterField(label: 'From', value: fromDate, onPick: onFromChanged),
          ),
          const SizedBox(width: AppTheme.s8),
          Expanded(
            child: _DateFilterField(
              label: 'To',
              value: toDate,
              minDate: fromDate,
              onPick: onToChanged,
            ),
          ),
        ],
      ),
    );
  }
}

class _DateFilterField extends StatelessWidget {
  final String label;
  final String value;
  final String? minDate;
  final ValueChanged<String> onPick;

  const _DateFilterField({
    required this.label,
    required this.value,
    required this.onPick,
    this.minDate,
  });

  @override
  Widget build(BuildContext context) {
    final parsed = DateTime.tryParse(value);
    return GestureDetector(
      onTap: () async {
        final now = DateTime.now();
        final min = minDate != null ? DateTime.tryParse(minDate!) : null;
        final picked = await showDatePicker(
          context: context,
          initialDate: parsed ?? now,
          firstDate: min ?? DateTime(now.year - 10),
          lastDate: DateTime(now.year + 1),
        );
        if (picked == null) return;
        final iso =
            '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
        onPick(iso);
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w400)),
          const SizedBox(height: 2),
          NeuPressed(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 10),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.event_rounded, size: 14, color: AppTheme.muted),
                const SizedBox(width: AppTheme.s8),
                Flexible(
                  child: Text(
                    parsed == null ? value : '${parsed.day} ${_monthShort(parsed.month)} ${parsed.year}',
                    style: const TextStyle(color: AppTheme.heading, fontSize: 13),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _monthShort(int month) => const [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ][month - 1];
}

/// One wedge of a [ReportDonut].
class DonutSlice {
  final String label;
  final num value;
  final Color color;

  const DonutSlice({required this.label, required this.value, required this.color});
}

/// A ring chart with a centered total and a legend beneath it — the phone
/// equivalent of the web's `Donut`, used for "Revenue mix".
class ReportDonut extends StatelessWidget {
  final String title;
  final List<DonutSlice> slices;
  final String centerLabel;
  final String? centerSub;
  final String Function(num value)? formatValue;

  const ReportDonut({
    super.key,
    required this.title,
    required this.slices,
    required this.centerLabel,
    this.centerSub,
    this.formatValue,
  });

  @override
  Widget build(BuildContext context) {
    final live = slices.where((s) => s.value > 0).toList();
    if (live.isEmpty) return const SizedBox.shrink();
    final total = live.fold<num>(0, (sum, s) => sum + s.value);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        NeuCard(
          radius: AppTheme.rMedium,
          shadow: AppTheme.subtle,
          padding: const EdgeInsets.all(AppTheme.s16),
          child: Column(
            children: [
              SizedBox(
                width: 160,
                height: 160,
                child: CustomPaint(
                  painter: _DonutPainter(slices: live),
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          centerLabel,
                          style: Theme.of(
                            context,
                          ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                          textAlign: TextAlign.center,
                        ),
                        if (centerSub != null)
                          Text(
                            centerSub!,
                            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppTheme.muted),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: AppTheme.s16),
              Column(
                children: [
                  for (final s in live)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        children: [
                          Container(
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(color: s.color, shape: BoxShape.circle),
                          ),
                          const SizedBox(width: AppTheme.s8),
                          Expanded(
                            child: Text(
                              s.label,
                              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.text),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          if (formatValue != null) ...[
                            Text(
                              formatValue!(s.value),
                              style: Theme.of(
                                context,
                              ).textTheme.labelSmall?.copyWith(color: AppTheme.heading, fontWeight: FontWeight.w600),
                            ),
                            const SizedBox(width: 6),
                          ],
                          Text(
                            '${(total > 0 ? s.value / total * 100 : 0).round()}%',
                            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppTheme.muted),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _DonutPainter extends CustomPainter {
  final List<DonutSlice> slices;

  const _DonutPainter({required this.slices});

  @override
  void paint(Canvas canvas, Size size) {
    final total = slices.fold<num>(0, (sum, s) => sum + s.value);
    if (total <= 0) return;
    final strokeWidth = size.shortestSide * 0.16;
    final rect = Rect.fromLTWH(
      strokeWidth / 2,
      strokeWidth / 2,
      size.width - strokeWidth,
      size.height - strokeWidth,
    );
    var startAngle = -3.14159265 / 2;
    for (final s in slices) {
      final sweep = (s.value / total) * 2 * 3.14159265;
      final paint = Paint()
        ..color = s.color
        ..style = PaintingStyle.stroke
        ..strokeWidth = strokeWidth
        ..strokeCap = StrokeCap.butt;
      canvas.drawArc(rect, startAngle, sweep, false, paint);
      startAngle += sweep;
    }
  }

  @override
  bool shouldRepaint(covariant _DonutPainter oldDelegate) => oldDelegate.slices != slices;
}

/// A horizontal bar per row, each fill sized relative to the largest value
/// in the set (so the top row is always full width) — the phone equivalent
/// of the web's `BarList`, used for "Occupancy by room category" and
/// "Venue utilisation".
class ReportBarList extends StatelessWidget {
  final String title;
  final List<(String label, num value)> rows;
  final String Function(num value) formatValue;
  final Color color;

  const ReportBarList({
    super.key,
    required this.title,
    required this.rows,
    this.formatValue = _defaultFormatValue,
    this.color = AppTheme.accent,
  });

  static String _defaultFormatValue(num value) => '${value.round()}%';

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return const SizedBox.shrink();
    final max = rows.map((r) => r.$2).fold<num>(1, (a, b) => b > a ? b : a);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        NeuCard(
          radius: AppTheme.rMedium,
          shadow: AppTheme.subtle,
          padding: const EdgeInsets.all(AppTheme.s12),
          child: Column(
            children: [
              for (var i = 0; i < rows.length; i++) ...[
                if (i > 0) const SizedBox(height: AppTheme.s12),
                _bar(context, rows[i].$1, rows[i].$2, max),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _bar(BuildContext context, String label, num value, num max) {
    final fraction = (value / max).clamp(0, 1).toDouble();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Text(
                label,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.text),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            Text(
              formatValue(value),
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: AppTheme.heading, fontWeight: FontWeight.w600),
            ),
          ],
        ),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          child: LinearProgressIndicator(
            value: fraction,
            minHeight: 8,
            backgroundColor: AppTheme.border,
            valueColor: AlwaysStoppedAnimation(color),
          ),
        ),
      ],
    );
  }
}

/// A numbered ranked list — position, name, an optional secondary line, and
/// a right-aligned value. The phone equivalent of the web's `RankList`, used
/// for "What's selling".
class ReportRankList extends StatelessWidget {
  final String title;
  final List<(String label, String? sub, String value)> rows;

  const ReportRankList({super.key, required this.title, required this.rows});

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        NeuCard(
          radius: AppTheme.rMedium,
          shadow: AppTheme.subtle,
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
          child: Column(
            children: [
              for (var i = 0; i < rows.length; i++)
                Container(
                  padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                  decoration: BoxDecoration(
                    border: i < rows.length - 1
                        ? const Border(bottom: BorderSide(color: AppTheme.border))
                        : null,
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                        width: 20,
                        child: Text(
                          '${i + 1}',
                          style: Theme.of(
                            context,
                          ).textTheme.labelSmall?.copyWith(color: AppTheme.accent, fontWeight: FontWeight.w700),
                        ),
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              rows[i].$1,
                              style: Theme.of(
                                context,
                              ).textTheme.bodyMedium?.copyWith(color: AppTheme.heading, fontWeight: FontWeight.w600),
                              overflow: TextOverflow.ellipsis,
                            ),
                            if (rows[i].$2 != null) ...[
                              const SizedBox(height: 2),
                              Text(
                                rows[i].$2!,
                                style: Theme.of(
                                  context,
                                ).textTheme.labelSmall?.copyWith(color: AppTheme.muted),
                              ),
                            ],
                          ],
                        ),
                      ),
                      Text(
                        rows[i].$3,
                        style: Theme.of(
                          context,
                        ).textTheme.bodyMedium?.copyWith(color: AppTheme.heading, fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// A register/list section that starts collapsed, with its title on the
/// left and a "View list"/"Hide list" toggle (arrow + label) on the right —
/// so a long table doesn't dominate the tab on first open.
class CollapsibleRegister extends StatefulWidget {
  final String title;
  final Widget child;
  final bool initiallyExpanded;

  const CollapsibleRegister({
    super.key,
    required this.title,
    required this.child,
    this.initiallyExpanded = false,
  });

  @override
  State<CollapsibleRegister> createState() => _CollapsibleRegisterState();
}

class _CollapsibleRegisterState extends State<CollapsibleRegister> {
  late bool _expanded = widget.initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(widget.title, style: Theme.of(context).textTheme.titleMedium),
            TextButton.icon(
              onPressed: () => setState(() => _expanded = !_expanded),
              icon: Icon(_expanded ? Icons.expand_less_rounded : Icons.expand_more_rounded),
              label: Text(_expanded ? 'Hide list' : 'View list'),
            ),
          ],
        ),
        if (_expanded) ...[
          const SizedBox(height: AppTheme.s8),
          widget.child,
        ],
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
