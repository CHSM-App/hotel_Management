import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/report.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../theme.dart';
import 'report_widgets.dart';

const _kPaymentMethodLabel = <String, String>{
  'CASH': 'Cash',
  'UPI': 'UPI',
  'CARD': 'Card',
  'UNRECORDED': 'Other',
};

/// Reports > Overview — the leftmost/default tab on the web, where
/// `AnalyticsOverview` draws cross-stream KPIs and trend charts against
/// `/reports/analytics-overview`. Mirrors that component: the KPI row
/// (revenue billed with a vs.-prior-period delta, occupancy, ADR/RevPAR, not
/// yet billed), the daily revenue trend against the prior period, the
/// revenue mix donut, revenue-by-category/function-type bars, the payment
/// mix, and a short "what needs a look" list.
class OverviewReportPanel extends ConsumerWidget {
  const OverviewReportPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(reportsViewModelProvider);
    final lodge = ref.watch(authViewModelProvider).me?.lodge;
    final bookings = state.bookings?.valueOrNull;
    final occupancy = state.occupancy?.valueOrNull;
    final gst = state.gst?.valueOrNull;
    final events = state.events?.valueOrNull;
    final foodOrders = state.foodOrders?.valueOrNull;
    final analytics = state.analyticsOverview?.valueOrNull;

    final loading = state.bookings is AsyncLoading ||
        state.occupancy is AsyncLoading ||
        state.gst is AsyncLoading ||
        state.analyticsOverview is AsyncLoading;

    if (loading && bookings == null && occupancy == null && gst == null && analytics == null) {
      return const ReportLoading();
    }
    final error = state.bookings is AsyncError
        ? state.bookings
        : state.occupancy is AsyncError
        ? state.occupancy
        : state.analyticsOverview;
    if (bookings == null || occupancy == null || analytics == null) {
      if (error is AsyncError) {
        return ReportError(message: (error as AsyncError).error.toString());
      }
      return const ReportLoading();
    }

    final hasEvents = lodge?.hasEvents ?? events != null;
    final servesFood = lodge?.servesFood ?? foodOrders != null;

    // Revenue actually billed this period, by stream — a cancellation
    // charge is real, settled income on a booking that otherwise
    // contributes nothing here, so it's folded into rooms on its own.
    final stayRevenue = bookings.summary.billedAmount;
    final cancellationChargesKept = bookings.summary.cancellationChargesKept;
    final roomsBilled = stayRevenue + cancellationChargesKept;
    final roomsUnbilled = bookings.summary.unbilledValue;

    num eventsBilled = 0;
    num eventsUnbilled = 0;
    if (hasEvents && events != null) {
      for (final ev in events.events) {
        if (ev.status == 'CANCELLED') continue;
        if (ev.invoiceNumber != null) {
          eventsBilled += ev.totalAmount;
        } else {
          eventsUnbilled += ev.totalAmount;
        }
      }
    }

    final foodBilled = servesFood ? (foodOrders?.summary.billedValue ?? 0) : 0;
    final foodUnbilled = servesFood ? (foodOrders?.summary.unbilledDeliveredValue ?? 0) : 0;

    final totalRevenue = roomsBilled + eventsBilled + foodBilled;
    final totalUnbilled = roomsUnbilled + eventsUnbilled + foodUnbilled;

    final priorTotal = analytics.priorPeriod.dailyTrend.fold<num>(0, (sum, d) => sum + d.totalRevenue);
    final currentTrendTotal = analytics.dailyTrend.fold<num>(0, (sum, d) => sum + d.totalRevenue);

    final adr = bookings.summary.roomNights > 0 ? stayRevenue / bookings.summary.roomNights : 0;
    final periodDays = analytics.dailyTrend.length;
    final revpar = occupancy.totalRooms > 0 && periodDays > 0
        ? stayRevenue / (occupancy.totalRooms * periodDays)
        : 0;

    final revenueMixSlices = [
      DonutSlice(label: 'Rooms', value: roomsBilled, color: AppTheme.accent),
      if (hasEvents) DonutSlice(label: 'Events & functions', value: eventsBilled, color: AppTheme.checkout),
      if (servesFood) DonutSlice(label: 'Food', value: foodBilled, color: AppTheme.vacant),
    ];

    final categoryBars = [
      for (final c in analytics.revenueByRoomCategory) (c.categoryName, c.revenue),
    ];
    final functionTypeBars = [
      for (final f in analytics.revenueByFunctionType) (kEventTypeLabel[f.eventType] ?? f.eventType, f.revenue),
    ];

    const paymentColor = <String, Color>{
      'CASH': AppTheme.vacant,
      'UPI': AppTheme.accent,
      'CARD': AppTheme.checkout,
      'UNRECORDED': AppTheme.muted,
    };
    final paymentSlices = [
      for (final p in analytics.paymentMix)
        PaymentMixSlice(
          label: _kPaymentMethodLabel[p.method] ?? p.method,
          amount: p.amount,
          color: paymentColor[p.method] ?? AppTheme.muted,
        ),
    ];

    // Plain-language flags an owner can act on, each naming the number it
    // talks about so it can be checked against the tiles above.
    final insights = <ReportInsight>[];
    if (totalUnbilled > 0) {
      insights.add(
        ReportInsight(
          tone: 'warn',
          title: '${formatPrice(totalUnbilled)} sitting unbilled',
          body: 'Stays, functions or food orders that are complete but have not been converted to a bill yet — '
              'worth clearing before the month closes.',
        ),
      );
    }
    if (priorTotal > 0 && currentTrendTotal > priorTotal) {
      final pct = ((currentTrendTotal - priorTotal) / priorTotal * 100).round();
      insights.add(
        ReportInsight(
          tone: 'good',
          title: 'Revenue up $pct% on the prior period',
          body: '${formatPrice(currentTrendTotal)} billed this period against ${formatPrice(priorTotal)} '
              'in the one before it.',
        ),
      );
    } else if (priorTotal > 0 && currentTrendTotal < priorTotal) {
      final pct = ((priorTotal - currentTrendTotal) / priorTotal * 100).round();
      insights.add(
        ReportInsight(
          tone: 'info',
          title: 'Revenue down $pct% on the prior period',
          body: '${formatPrice(currentTrendTotal)} billed this period against ${formatPrice(priorTotal)} '
              'in the one before it.',
        ),
      );
    }
    if (analytics.topGuests.isNotEmpty) {
      final top = analytics.topGuests.first;
      insights.add(
        ReportInsight(
          tone: 'info',
          title: "${top.guestName ?? 'A guest'} is this period's top guest",
          body: '${formatPrice(top.totalSpend)} across ${top.bookingCount} '
              '${top.bookingCount == 1 ? 'stay' : 'stays'}.',
        ),
      );
    }

    final dailyValues = [for (final d in analytics.dailyTrend) d.totalRevenue];
    final priorValues = [for (final d in analytics.priorPeriod.dailyTrend) d.totalRevenue];
    final dates = analytics.dailyTrend;

    return ListView(
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        KpiRow(
          items: [
            KpiCardData(
              label: 'Revenue billed',
              value: formatPrice(totalRevenue),
              delta: ReportDeltaBadge(current: currentTrendTotal, prior: priorTotal, light: true),
              sub: 'Rooms + functions + food · billed only',
              primary: true,
            ),
            KpiCardData(
              label: 'Occupancy',
              value: '${occupancy.occupancyPercent}%',
              sub: '${occupancy.occupiedRoomNights} of ${occupancy.totalRoomNights} room-nights sold',
            ),
            KpiCardData(
              label: 'Avg. daily rate',
              value: formatPrice(adr),
              sub: 'RevPAR ${formatPrice(revpar)}',
            ),
            KpiCardData(
              label: 'Not yet billed',
              value: formatPrice(totalUnbilled),
              sub: 'Follow up before month close',
            ),
          ],
        ),
        if (dailyValues.isNotEmpty) ...[
          const SizedBox(height: AppTheme.s16),
          ReportTrendChart(
            title: 'Daily revenue',
            values: dailyValues,
            priorValues: priorValues.isEmpty ? null : priorValues,
            showComparison: priorValues.isNotEmpty,
            formatValue: formatPrice,
            firstLabel: dates.isNotEmpty ? formatShortDate(dates.first.date) : '',
            midLabel: dates.isNotEmpty ? formatShortDate(dates[(dates.length - 1) ~/ 2].date) : '',
            lastLabel: dates.isNotEmpty ? formatShortDate(dates.last.date) : '',
            priorCaption: priorValues.isNotEmpty
                ? 'Prior period: ${analytics.priorPeriod.fromDate} to ${analytics.priorPeriod.toDate}, '
                    '${formatPrice(priorTotal)} billed.'
                : null,
          ),
        ],
        if (totalRevenue > 0) ...[
          const SizedBox(height: AppTheme.s16),
          ReportDonut(
            title: 'Revenue mix',
            centerLabel: formatPrice(totalRevenue),
            centerSub: 'this period',
            formatValue: formatPrice,
            slices: revenueMixSlices,
          ),
        ],
        if (categoryBars.isNotEmpty) ...[
          const SizedBox(height: AppTheme.s16),
          ReportBarList(title: 'Revenue by room category', rows: categoryBars, formatValue: formatPrice),
        ],
        if (hasEvents && functionTypeBars.isNotEmpty) ...[
          const SizedBox(height: AppTheme.s16),
          ReportBarList(
            title: 'Top function types',
            rows: functionTypeBars,
            color: AppTheme.checkout,
            formatValue: formatPrice,
          ),
        ],
        if (paymentSlices.isNotEmpty) ...[
          const SizedBox(height: AppTheme.s16),
          ReportPaymentMix(title: 'Payment mix', slices: paymentSlices, formatValue: formatPrice),
        ],
        if (insights.isNotEmpty) ...[
          const SizedBox(height: AppTheme.s16),
          ReportInsightList(title: 'What needs a look', insights: insights),
        ],
        const SizedBox(height: AppTheme.s16),
        Text(
          'For the detailed register, tax filing summary, or a stream\'s own numbers, '
          'switch to that tab above.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}
