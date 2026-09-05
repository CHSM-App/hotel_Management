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
        if (report.totalRooms == 0)
          const NeuNotice(
            icon: Icons.bed_rounded,
            message: 'Add rooms on the Rooms & rates tab to see occupancy.',
          )
        else
          NeuCard(
            padding: const EdgeInsets.all(AppTheme.s16),
            child: Column(
              children: [
                for (final day in report.days) ...[
                  _DayRow(day: day),
                  if (day != report.days.last)
                    const Divider(height: AppTheme.s16, color: AppTheme.border),
                ],
              ],
            ),
          ),
      ],
    );
  }
}

class _DayRow extends StatelessWidget {
  final OccupancyDay day;

  const _DayRow({required this.day});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          flex: 2,
          child: Text(
            formatIsoDate(day.date),
            style: const TextStyle(color: AppTheme.heading, fontSize: 13, fontWeight: FontWeight.w500),
          ),
        ),
        Expanded(
          child: Text(
            '${day.occupiedRooms} / ${day.totalRooms}',
            style: const TextStyle(color: AppTheme.text, fontSize: 13),
          ),
        ),
        SizedBox(
          width: 56,
          child: Text(
            '${day.occupancyPercent}%',
            textAlign: TextAlign.right,
            style: const TextStyle(color: AppTheme.accent, fontSize: 13, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }
}
