import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/report.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'report_widgets.dart';

/// The booking register: the same stat grid and table the web dashboard's
/// Reports > Bookings tab shows, laid out as cards instead of a wide table —
/// a phone has no room for fifteen columns.
class BookingsReportPanel extends ConsumerWidget {
  const BookingsReportPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(reportsViewModelProvider).bookings;

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
  final BookingsReport report;

  const _Loaded({required this.report});

  @override
  Widget build(BuildContext context) {
    final s = report.summary;
    final cancelled = s.statusCount('CANCELLED');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        StatGrid(
          items: [
            StatItem(label: 'Bookings', value: '${s.totalBookings}'),
            StatItem(label: 'Checked out', value: '${s.statusCount('CHECKED_OUT')}'),
            StatItem(label: 'Cancelled', value: '$cancelled'),
            StatItem(label: 'Room nights', value: '${s.roomNights}'),
            StatItem(label: 'Billed', value: formatPrice(s.billedAmount), accent: true),
            if (s.cancellationChargesKept > 0)
              StatItem(
                label: 'Cancellation charges',
                value: formatPrice(s.cancellationChargesKept),
              ),
          ],
        ),
        const SizedBox(height: AppTheme.s16),
        if (report.bookings.isEmpty)
          const NeuNotice(
            icon: Icons.receipt_long_rounded,
            message: 'No bookings arrived in this period.',
          )
        else
          for (final b in report.bookings)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s12),
              child: _BookingCard(booking: b),
            ),
      ],
    );
  }
}

class _BookingCard extends StatelessWidget {
  final ReportBooking booking;

  const _BookingCard({required this.booking});

  @override
  Widget build(BuildContext context) {
    final b = booking;
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  b.guestName ?? 'Guest',
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontWeight: FontWeight.w600,
                    fontSize: 15,
                  ),
                ),
              ),
              StatusBadge(status: b.status, label: kBookingStatusLabel[b.status] ?? b.status),
            ],
          ),
          if (b.guestPhone != null) ...[
            const SizedBox(height: 2),
            Text(b.guestPhone!, style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
          ],
          const SizedBox(height: AppTheme.s12),
          Row(
            children: [
              Expanded(
                child: _Field(
                  label: 'Room',
                  value: '${b.roomNumber ?? '—'}${b.categoryName != null ? ' · ${b.categoryName}' : ''}',
                ),
              ),
              Expanded(
                child: _Field(label: 'Nights', value: '${b.nights}'),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          Row(
            children: [
              Expanded(
                child: _Field(
                  label: 'Check-in',
                  value: formatIsoDate(b.checkInDate),
                  sub: b.actualCheckInAt != null ? 'Arrived' : 'Not arrived',
                ),
              ),
              Expanded(
                child: _Field(
                  label: 'Check-out',
                  value: formatIsoDate(b.checkOutDate),
                  sub: b.actualCheckOutAt != null ? 'Departed' : 'Not checked out',
                ),
              ),
            ],
          ),
          const Divider(height: AppTheme.s24, color: AppTheme.border),
          Row(
            children: [
              Expanded(
                child: _Field(
                  label: 'Advance',
                  value: b.advanceAmount > 0 ? formatPrice(b.advanceAmount) : '—',
                  sub: b.advanceTenders.isNotEmpty
                      ? tendersLabel(b.advanceTenders, formatPrice)
                      : null,
                ),
              ),
              Expanded(
                child: _Field(
                  label: 'Balance',
                  value: (b.balanceCollected ?? 0) > 0 ? formatPrice(b.balanceCollected) : '—',
                  sub: b.balanceTenders.isNotEmpty
                      ? tendersLabel(b.balanceTenders, formatPrice)
                      : null,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          Row(
            children: [
              Expanded(
                child: _Field(
                  label: 'Billed',
                  value: b.isBilled ? formatPrice(b.billedAmount) : '—',
                  sub: b.isBilled
                      ? kDocumentTypeLabel[b.documentType] ?? b.documentType
                      : 'Not billed · booked ${formatPrice(b.totalPrice)}',
                ),
              ),
              if (b.isBilled)
                Expanded(
                  child: _Field(label: 'Bill no.', value: b.invoiceNumber ?? '—'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Field extends StatelessWidget {
  final String label;
  final String value;
  final String? sub;

  const _Field({required this.label, required this.value, this.sub});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 11)),
        const SizedBox(height: 2),
        Text(value, style: const TextStyle(color: AppTheme.heading, fontSize: 13, fontWeight: FontWeight.w500)),
        if (sub != null) ...[
          const SizedBox(height: 1),
          Text(sub!, style: const TextStyle(color: AppTheme.muted, fontSize: 11)),
        ],
      ],
    );
  }
}
