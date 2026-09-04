import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/booking.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// One stay, in full.
///
/// Fetched rather than handed down from the register row it was opened from.
/// The list endpoint returns a summary — it has no advancePaymentLines, so a
/// deposit that arrived part cash and part UPI reads on the register as whatever
/// the first tender was. This asks the detail endpoint, which carries the rest.
class BookingDetailScreen extends ConsumerStatefulWidget {
  final int bookingId;

  const BookingDetailScreen({super.key, required this.bookingId});

  @override
  ConsumerState<BookingDetailScreen> createState() =>
      _BookingDetailScreenState();
}

class _BookingDetailScreenState extends ConsumerState<BookingDetailScreen> {
  Booking? _booking;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final booking = await ref
        .read(bookingViewModelProvider.notifier)
        .loadBooking(widget.bookingId);
    if (!mounted) return;
    setState(() {
      _booking = booking;
      _loading = false;
      _error = booking == null
          ? (ref.read(bookingViewModelProvider).error ??
                'Could not open this stay.')
          : null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        backgroundColor: AppTheme.bg,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        foregroundColor: AppTheme.heading,
        title: const Text('Stay'),
      ),
      body: SafeArea(child: _body()),
    );
  }

  Widget _body() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    final booking = _booking;
    if (booking == null) {
      return Padding(
        padding: const EdgeInsets.all(AppTheme.s16),
        child: NeuNotice(
          icon: Icons.cloud_off_rounded,
          message: _error ?? 'Could not open this stay.',
          action: NeuButton(onPressed: _load, child: const Text('Try again')),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.all(AppTheme.s16),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          _GuestCard(booking: booking),
          const SizedBox(height: AppTheme.s12),
          _StayCard(booking: booking),
          const SizedBox(height: AppTheme.s12),
          _MoneyCard(booking: booking),
        ],
      ),
    );
  }
}

// ── Who ─────────────────────────────────────────────────────────────────────

class _GuestCard extends StatelessWidget {
  final Booking booking;

  const _GuestCard({required this.booking});

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  booking.guestName ?? 'Guest',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
              ),
              _StatusTag(status: booking.status),
            ],
          ),
          if ((booking.guestPhone ?? '').isNotEmpty) ...[
            const SizedBox(height: AppTheme.s8),
            _Line(label: 'Phone', value: booking.guestPhone!),
          ],
          if (booking.numGuests != null)
            _Line(
              label: 'Party',
              value: '${booking.numGuests} '
                  '${booking.numGuests == 1 ? 'guest' : 'guests'}',
            ),
        ],
      ),
    );
  }
}

// ── Which nights, which room ────────────────────────────────────────────────

class _StayCard extends StatelessWidget {
  final Booking booking;

  const _StayCard({required this.booking});

  @override
  Widget build(BuildContext context) {
    final nights = _nights;

    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Stay', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: AppTheme.s12),
          _Line(
            label: 'Room',
            value: 'Room ${booking.roomNumber ?? '—'}'
                '${booking.categoryName != null ? ' · ${booking.categoryName}' : ''}',
          ),
          _Line(label: 'Arrives', value: formatIsoDate(booking.checkInDate)),
          _Line(label: 'Leaves', value: formatIsoDate(booking.checkOutDate)),
          if (nights != null) _Line(label: 'Nights', value: nightsLabel(nights)),
          if (booking.basePriceOverride != null)
            _Line(
              label: 'Agreed rate',
              // Flagged as agreed rather than shown as a plain figure: it is
              // the one number on the stay that somebody chose by hand, and
              // the reason the total does not match the category's own price.
              value: '${formatPrice(booking.basePriceOverride)} a night',
            ),
        ],
      ),
    );
  }

  int? get _nights {
    final a = DateTime.tryParse(booking.checkInDate ?? '');
    final b = DateTime.tryParse(booking.checkOutDate ?? '');
    if (a == null || b == null) return null;
    return b.difference(a).inDays;
  }
}

// ── What it comes to ────────────────────────────────────────────────────────

class _MoneyCard extends StatelessWidget {
  final Booking booking;

  const _MoneyCard({required this.booking});

  @override
  Widget build(BuildContext context) {
    final lines = booking.advancePaymentLines ?? const [];

    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Money', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: AppTheme.s12),
          _Line(label: 'Stay total', value: formatPrice(booking.totalPrice)),
          if ((booking.discountAmount ?? 0) > 0)
            _Line(
              label: 'Concession',
              value: '− ${formatPrice(booking.discountAmount)}',
            ),
          _Line(label: 'Advance', value: formatPrice(booking.advanceAmount)),

          // Every tender, not just the first. This is the whole reason the
          // detail endpoint is worth fetching: the register row can only ever
          // name one method, and a split deposit shown as its first tender is
          // something the guest who paid it can see is wrong.
          if (lines.length > 1) ...[
            const SizedBox(height: AppTheme.s8),
            for (final line in lines)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Row(
                  children: [
                    const SizedBox(width: AppTheme.s12),
                    Expanded(
                      child: Text(
                        line.reference == null || line.reference!.isEmpty
                            ? line.method
                            : '${line.method} · ${line.reference}',
                        style: const TextStyle(
                          color: AppTheme.muted,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    Text(
                      formatPrice(line.amount),
                      style: const TextStyle(
                        color: AppTheme.muted,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
          ] else if (booking.advanceDescription.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(left: AppTheme.s12),
              child: Text(
                booking.advanceDescription,
                style: const TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
            ),

          const Divider(height: AppTheme.s24),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Still to pay',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              Text(
                formatPrice(booking.balanceDue),
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 18,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ── Bits ────────────────────────────────────────────────────────────────────

class _Line extends StatelessWidget {
  final String label;
  final String value;

  const _Line({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.s8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: const TextStyle(color: AppTheme.muted, fontSize: 13),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(color: AppTheme.text, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusTag extends StatelessWidget {
  final String? status;

  const _StatusTag({required this.status});

  @override
  Widget build(BuildContext context) {
    final (label, colour) = switch (status) {
      'CHECKED_IN' => ('Checked in', AppTheme.checkedIn),
      'CHECKED_OUT' => ('Stayed', AppTheme.stayed),
      'CANCELLED' => ('Cancelled', AppTheme.muted),
      _ => ('Reserved', AppTheme.reserved),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: colour.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: colour,
          fontSize: 11,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}
