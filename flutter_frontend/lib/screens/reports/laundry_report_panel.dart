import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/report.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'report_widgets.dart';

import 'laundry_report_excel.dart' show kLaundryOrderStatusLabel;

const Map<String, String> _kGuestLaundryStatusLabel = kLaundryOrderStatusLabel;

/// Laundry register — hotel linen through the wash, plus (where the
/// property also takes guest laundry) their orders, shown for information
/// only. Mirrors the web's Reports > Laundry tab.
class LaundryReportPanel extends ConsumerWidget {
  const LaundryReportPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(reportsViewModelProvider).laundry;
    final hasOtherServices = ref.watch(authViewModelProvider).me?.lodge.hasOtherServices ?? false;

    return ListView(
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        switch (async) {
          null || AsyncLoading() => const ReportLoading(),
          AsyncError(:final error) => ReportError(message: error.toString()),
          AsyncData(:final value) => _Loaded(report: value, hasOtherServices: hasOtherServices),
          _ => const SizedBox.shrink(),
        },
      ],
    );
  }
}

class _Loaded extends StatelessWidget {
  final LaundryReport report;
  final bool hasOtherServices;

  const _Loaded({required this.report, required this.hasOtherServices});

  @override
  Widget build(BuildContext context) {
    final linen = report.linen;
    final guest = report.guest;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Hotel laundry in this period', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s8),
        StatGrid(
          items: [
            StatItem(label: 'Sent for washing', value: '${linen.totals.sent}'),
            StatItem(label: 'Received washed', value: '${linen.totals.received}', accent: true),
            StatItem(label: 'Lost', value: '${linen.totals.lost}'),
            StatItem(label: 'Damaged', value: '${linen.totals.damaged}'),
            StatItem(label: 'In wash now', value: '${linen.totals.inWashNow}'),
          ],
        ),
        const SizedBox(height: AppTheme.s16),
        CollapsibleRegister(
          title: 'By linen item',
          initiallyExpanded: true,
          child: linen.byItem.isEmpty
              ? const NeuNotice(
                  icon: Icons.local_laundry_service_outlined,
                  message: 'No linen items yet. Add them under Laundry → Hotel Laundry.',
                )
              : ReportDataTable(
                  columns: const [
                    ReportTableColumn('Item', width: 100),
                    ReportTableColumn('Changed', width: 90, align: TextAlign.right),
                    ReportTableColumn('Sent', width: 60, align: TextAlign.right),
                    ReportTableColumn('Received', width: 90, align: TextAlign.right),
                    ReportTableColumn('Lost', width: 55, align: TextAlign.right),
                    ReportTableColumn('Damaged', width: 90, align: TextAlign.right),
                    ReportTableColumn('Owned', width: 70, align: TextAlign.right),
                    ReportTableColumn('In wash', width: 80, align: TextAlign.right),
                  ],
                  rows: [
                    for (final i in linen.byItem)
                      [
                        i.name,
                        '${i.changed}',
                        '${i.sent}',
                        '${i.received}',
                        '${i.lost}',
                        '${i.damaged}',
                        '${i.owned}',
                        '${i.inWashNow}',
                      ],
                  ],
                ),
        ),
        const SizedBox(height: AppTheme.s16),
        CollapsibleRegister(
          title: 'By who washed it',
          child: linen.byWasher.isEmpty
              ? const NeuNotice(
                  icon: Icons.local_laundry_service_outlined,
                  message: 'Nothing was sent for washing in this period.',
                )
              : ReportDataTable(
                  columns: const [
                    ReportTableColumn('Washed by', width: 110),
                    ReportTableColumn('Sent', width: 60, align: TextAlign.right),
                    ReportTableColumn('Received', width: 90, align: TextAlign.right),
                    ReportTableColumn('Lost', width: 55, align: TextAlign.right),
                    ReportTableColumn('Damaged', width: 90, align: TextAlign.right),
                    ReportTableColumn('Not back', width: 90, align: TextAlign.right),
                    ReportTableColumn('Charged', width: 90, align: TextAlign.right),
                  ],
                  rows: [
                    for (final w in linen.byWasher)
                      [
                        w.washedBy.isEmpty ? 'Not recorded' : w.washedBy,
                        '${w.sent}',
                        '${w.received}',
                        '${w.lost}',
                        '${w.damaged}',
                        '${w.notBack}',
                        w.charge > 0 ? formatPrice(w.charge) : '—',
                      ],
                  ],
                ),
        ),
        if (hasOtherServices) ...[
          const SizedBox(height: AppTheme.s24),
          Text('Guest laundry taken in this period', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: AppTheme.s8),
          StatGrid(
            items: [
              StatItem(label: 'Orders taken in', value: '${guest.totals.takenIn}'),
              StatItem(label: 'Pieces', value: '${guest.totals.pieces}'),
              StatItem(
                label: 'Handed over',
                value: formatPrice(guest.totals.handedOverValue),
                accent: true,
              ),
              StatItem(label: 'Still open', value: formatPrice(guest.totals.openValue)),
              if (guest.totals.vendorCharge > 0)
                StatItem(label: 'Vendor prices', value: formatPrice(guest.totals.vendorCharge)),
              StatItem(label: 'Profit', value: formatPrice(guest.totals.profit), accent: guest.totals.profit >= 0),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          Text(
            'Handed over, Still open and Vendor prices are already counted in Other services and on the bills — '
            'shown here for information only. The vendor price is also logged under the Laundry expense category.',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppTheme.muted),
          ),
          if (guest.orders.isNotEmpty) ...[
            const SizedBox(height: AppTheme.s16),
            ReportDataTable(
              columns: const [
                ReportTableColumn('Tag', width: 70),
                ReportTableColumn('Guest', width: 110),
                ReportTableColumn('Pieces', width: 60, align: TextAlign.right),
                ReportTableColumn('Status', width: 90),
                ReportTableColumn('Taken in', width: 90),
                ReportTableColumn('Handed over', width: 90),
                ReportTableColumn('Amount', width: 84, align: TextAlign.right),
                ReportTableColumn('Profit', width: 84, align: TextAlign.right),
              ],
              rows: [for (final o in guest.orders) _orderRow(o)],
            ),
          ],
        ],
      ],
    );
  }

  List<String> _orderRow(GuestLaundryOrderRow o) => [
    o.tagNumber,
    o.guestName == null
        ? (o.roomNumber == null ? '—' : 'Room ${o.roomNumber}')
        : '${o.guestName} · ${o.roomNumber == null ? 'Walk-in' : 'Room ${o.roomNumber}'}',
    '${o.pieces}',
    _kGuestLaundryStatusLabel[o.status] ?? o.status,
    formatDateTime(o.receivedAt),
    o.deliveredAt == null ? '—' : formatDateTime(o.deliveredAt),
    formatPrice(o.total),
    o.profit == null ? '—' : formatPrice(o.profit!),
  ];
}
