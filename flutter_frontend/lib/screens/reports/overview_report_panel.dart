import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../theme.dart';
import 'report_widgets.dart';

/// Reports > Overview — the leftmost/default tab on the web, where
/// `AnalyticsOverview` draws cross-stream KPIs and trend charts against
/// `/reports/analytics-overview`.
///
/// Scoped down here to a stat-grid summary built from the reports this
/// screen already loads (bookings, occupancy, GST, events, food) rather than
/// a new analytics pipeline and chart set — the full trend/comparison charts
/// are a larger follow-up, noted in the Reports task write-up.
class OverviewReportPanel extends ConsumerWidget {
  const OverviewReportPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(reportsViewModelProvider);
    final bookings = state.bookings?.valueOrNull;
    final occupancy = state.occupancy?.valueOrNull;
    final gst = state.gst?.valueOrNull;
    final events = state.events?.valueOrNull;
    final foodOrders = state.foodOrders?.valueOrNull;

    final loading = state.bookings is AsyncLoading ||
        state.occupancy is AsyncLoading ||
        state.gst is AsyncLoading;

    if (loading && bookings == null && occupancy == null && gst == null) {
      return const ReportLoading();
    }

    final totalRevenue = (bookings?.summary.billedAmount ?? 0) +
        (events?.summary.totals.totalAmount ?? 0) +
        (foodOrders?.summary.billedValue ?? 0);

    return ListView(
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        Text('At a glance', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        StatGrid(
          items: [
            StatItem(label: 'Total revenue', value: formatPrice(totalRevenue), accent: true),
            if (bookings != null) StatItem(label: 'Bookings', value: '${bookings.summary.totalBookings}'),
            if (occupancy != null) StatItem(label: 'Occupancy', value: '${occupancy.occupancyPercent}%'),
            if (gst != null)
              StatItem(label: 'Tax collected', value: formatPrice(gst.totals.cgstAmount + gst.totals.sgstAmount)),
            if (events != null) StatItem(label: 'Functions', value: '${events.summary.totalEvents}'),
            if (foodOrders != null) StatItem(label: 'Food orders', value: '${foodOrders.summary.totalOrders}'),
          ],
        ),
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
