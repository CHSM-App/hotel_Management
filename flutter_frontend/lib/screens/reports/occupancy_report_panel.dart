import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/report.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'report_widgets.dart';

/// Day-by-day occupancy — mirrors the web's Reports > Occupancy tab.
class OccupancyReportPanel extends ConsumerWidget {
  const OccupancyReportPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(reportsViewModelProvider).occupancy;

    return ListView(
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        switch (async) {
          null || AsyncLoading() => const ReportLoading(),
          AsyncError(:final error) => ReportError(message: error.toString()),
          AsyncData(:final value) => _Loaded(report: value),
          _ => const SizedBox.shrink(),
        },
      ],
    );
  }
}

class _Loaded extends StatelessWidget {
  final OccupancyReport report;

  const _Loaded({required this.report});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        StatGrid(
          items: [
            StatItem(label: 'Average occupancy', value: '${report.occupancyPercent}%', accent: true),
            StatItem(
              label: 'Room-nights occupied',
              value: '${report.occupiedRoomNights} / ${report.totalRoomNights}',
            ),
            StatItem(label: 'Active rooms', value: '${report.totalRooms}'),
          ],
        ),
        const SizedBox(height: AppTheme.s16),
        Text('Day by day', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        if (report.totalRooms == 0)
          const NeuNotice(
            icon: Icons.bed_rounded,
            message: 'Add rooms on the Rooms & rates tab to see occupancy.',
          )
        else
          ReportDataTable(
            columns: const [
              ReportTableColumn('Date', width: 110),
              ReportTableColumn('Occupied', width: 90, align: TextAlign.right),
              ReportTableColumn('Total rooms', width: 100, align: TextAlign.right),
              ReportTableColumn('Occupancy', width: 90, align: TextAlign.right),
            ],
            rows: [
              for (final day in report.days)
                [
                  formatIsoDate(day.date),
                  '${day.occupiedRooms}',
                  '${day.totalRooms}',
                  '${day.occupancyPercent}%',
                ],
            ],
            totals: [
              'Total',
              '${report.occupiedRoomNights}',
              '${report.totalRoomNights}',
              '${report.occupancyPercent}%',
            ],
          ),
      ],
    );
  }
}
