import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/report.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'report_widgets.dart';

/// Other services register — pool, gaming, guest laundry and anything else
/// sold apart from rooms and food. Mirrors the web's Reports > Other
/// services tab.
class ServicesReportPanel extends ConsumerWidget {
  const ServicesReportPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(reportsViewModelProvider).services;

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
  final ServicesReport report;

  const _Loaded({required this.report});

  @override
  Widget build(BuildContext context) {
    final t = report.totals;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        StatGrid(
          items: [
            StatItem(
              label: 'Uses',
              value: '${t.count}',
            ),
            StatItem(label: 'Billed', value: formatPrice(t.billedValue), accent: true),
            StatItem(label: 'Completed, not billed', value: formatPrice(t.unbilledValue)),
            if (t.voidedCount > 0) StatItem(label: 'Voided bills', value: '${t.voidedCount}'),
          ],
        ),
        const SizedBox(height: AppTheme.s16),
        CollapsibleRegister(
          title: 'By service',
          initiallyExpanded: true,
          child: report.byService.isEmpty
              ? const NeuNotice(
                  icon: Icons.room_service_outlined,
                  message: 'No services used in this period.',
                )
              : ReportDataTable(
                  columns: const [
                    ReportTableColumn('Service', width: 120),
                    ReportTableColumn('Uses', width: 60, align: TextAlign.right),
                    ReportTableColumn('Quantity', width: 90, align: TextAlign.right),
                    ReportTableColumn('Value', width: 90, align: TextAlign.right),
                  ],
                  rows: [
                    for (final s in report.byService)
                      [s.serviceName, '${s.uses}', '${s.quantity}', formatPrice(s.value)],
                  ],
                ),
        ),
        const SizedBox(height: AppTheme.s16),
        CollapsibleRegister(
          title: 'Every use',
          child: report.usages.isEmpty
              ? const NeuNotice(
                  icon: Icons.history_rounded,
                  message: 'Nothing used in this period.',
                )
              : ReportDataTable(
                  columns: const [
                    ReportTableColumn('Started', width: 90),
                    ReportTableColumn('Service', width: 120),
                    ReportTableColumn('Guest', width: 110),
                    ReportTableColumn('Status', width: 90),
                    ReportTableColumn('Bill no.', width: 80),
                    ReportTableColumn('Amount', width: 84, align: TextAlign.right),
                  ],
                  rows: [for (final u in report.usages) _usageRow(u)],
                ),
        ),
      ],
    );
  }

  List<String> _usageRow(ServiceUsageRow u) => [
    formatDateTime(u.startedAt),
    '${u.serviceName} × ${u.quantity}${u.headcount > 1 ? ' × ${u.headcount}' : ''}',
    u.guestName == null
        ? '—'
        : u.roomNumber == null
        ? u.guestName!
        : '${u.guestName} · Room ${u.roomNumber}',
    u.voided
        ? 'Voided'
        : u.status == 'IN_USE'
        ? 'In use'
        : u.status == 'COMPLETED'
        ? 'Completed'
        : 'Cancelled',
    u.invoiceNumber ?? (u.onRoomBill ? 'Room bill' : '—'),
    formatPrice(u.lineTotal),
  ];
}
