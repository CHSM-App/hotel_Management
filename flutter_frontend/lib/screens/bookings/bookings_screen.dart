import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/late_checkout.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/booking_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'take_booking_screen.dart';

/// The register, and the way in to taking a booking.
///
/// This is what stands in for the tape chart. The chart answers one question —
/// "what is free, and when" — by drawing thirty columns of nights across every
/// category, which is unreadable and untappable on a phone. Here the desk says
/// which nights it means and is shown what is free for them, which is the same
/// question asked the other way round.
class BookingsScreen extends ConsumerStatefulWidget {
  const BookingsScreen({super.key});

  @override
  ConsumerState<BookingsScreen> createState() => _BookingsScreenState();
}

class _BookingsScreenState extends ConsumerState<BookingsScreen> {
  static const _filters = {
    'ALL': 'All',
    'BOOKED': 'Reserved',
    'CHECKED_IN': 'Checked in',
    'CHECKED_OUT': 'Stayed',
  };

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  /// Loads everything and filters what came back.
  ///
  /// GET /bookings takes a date range and nothing else — there is no status
  /// parameter, so the one this used to send was quietly ignored and every
  /// chip showed the same list. The web register filters client-side for the
  /// same reason.
  Future<void> _load() =>
      ref.read(bookingViewModelProvider.notifier).loadRegister();

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(bookingViewModelProvider);

    return Stack(
      // Expand rather than the default loose fit, so the list fills the body
      // instead of being asked how tall it would like to be.
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: _load,
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              AppTheme.s16,
              AppTheme.s8,
              AppTheme.s16,
              // Clear of the floating Take a booking button.
              96,
            ),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              _FilterRow(
                filters: _filters,
                selected: state.statusFilter,
                onSelect: ref
                    .read(bookingViewModelProvider.notifier)
                    .setStatusFilter,
              ),
              const SizedBox(height: AppTheme.s16),
              ..._rows(state),
            ],
          ),
        ),
        Positioned(
          left: AppTheme.s16,
          right: AppTheme.s16,
          bottom: AppTheme.s16,
          child: NeuButton(
            primary: true,
            expand: true,
            onPressed: () async {
              final booked = await Navigator.of(context).push<bool>(
                MaterialPageRoute(builder: (_) => const TakeBookingScreen()),
              );
              if (booked == true) _load();
            },
            child: const Text('Take a booking'),
          ),
        ),
      ],
    );
  }

  List<Widget> _rows(BookingState state) {
    return state.register.when(
      loading: () => const [
        SizedBox(height: 120),
        Center(child: CircularProgressIndicator()),
      ],
      error: (e, _) => [
        NeuNotice(
          icon: Icons.cloud_off_rounded,
          message: BookingViewModel.messageFor(e),
          action: NeuButton(onPressed: _load, child: const Text('Try again')),
        ),
      ],
      data: (_) {
        // Filtered here rather than at the server, which has no status
        // parameter to filter on.
        final rows = state.visibleRegister;
        if (rows.isEmpty) {
          return [
            const SizedBox(height: 80),
            NeuNotice(
              icon: Icons.event_available_rounded,
              message: state.statusFilter == 'ALL'
                  ? 'No stays here yet.'
                  // Says which filter is hiding them, so an empty screen is not
                  // mistaken for an empty register.
                  : 'No stays are ${_filters[state.statusFilter]!.toLowerCase()}.',
            ),
          ];
        }
        return [
          for (final b in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s12),
              child: _BookingRow(booking: b, onCheckedOut: _load),
            ),
        ];
      },
    );
  }
}

// ── Filter chips ────────────────────────────────────────────────────────────

class _FilterRow extends StatelessWidget {
  final Map<String, String> filters;
  final String selected;
  final ValueChanged<String> onSelect;

  const _FilterRow({
    required this.filters,
    required this.selected,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final entry in filters.entries) ...[
            GestureDetector(
              onTap: () => onSelect(entry.key),
              child: entry.key == selected
                  ? NeuPressed(
                      radius: 999,
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppTheme.s16,
                        vertical: AppTheme.s8,
                      ),
                      child: Text(
                        entry.value,
                        style: const TextStyle(
                          color: AppTheme.accent,
                          fontWeight: FontWeight.w500,
                          fontSize: 13,
                        ),
                      ),
                    )
                  : NeuCard(
                      radius: 999,
                      shadow: AppTheme.subtle,
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppTheme.s16,
                        vertical: AppTheme.s8,
                      ),
                      child: Text(
                        entry.value,
                        style: const TextStyle(
                          color: AppTheme.text,
                          fontSize: 13,
                        ),
                      ),
                    ),
            ),
            const SizedBox(width: AppTheme.s8),
          ],
        ],
      ),
    );
  }
}

// ── One stay ────────────────────────────────────────────────────────────────

class _BookingRow extends ConsumerWidget {
  final Booking booking;
  final Future<void> Function() onCheckedOut;

  const _BookingRow({required this.booking, required this.onCheckedOut});

  /// The tape chart's own colours, so a stay reads the same on the phone as it
  /// does on the wall screen.
  static Color _statusColor(String? status) {
    switch (status) {
      case 'CHECKED_IN':
        return AppTheme.checkedIn;
      case 'CHECKED_OUT':
        return AppTheme.stayed;
      case 'CANCELLED':
        return AppTheme.muted;
      default:
        return AppTheme.reserved;
    }
  }

  static String _statusLabel(String? status) {
    switch (status) {
      case 'CHECKED_IN':
        return 'Checked in';
      case 'CHECKED_OUT':
        return 'Stayed';
      case 'CANCELLED':
        return 'Cancelled';
      default:
        return 'Reserved';
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colour = _statusColor(booking.status);

    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  booking.guestName ?? 'Guest',
                  style: Theme.of(context).textTheme.titleMedium,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              _StatusTag(label: _statusLabel(booking.status), colour: colour),
            ],
          ),
          const SizedBox(height: AppTheme.s4),
          Text(
            'Room ${booking.roomNumber ?? '—'}'
            '${booking.categoryName != null ? ' · ${booking.categoryName}' : ''}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: AppTheme.s12),
          Row(
            children: [
              const Icon(
                Icons.calendar_today_rounded,
                size: 14,
                color: AppTheme.muted,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '${formatIsoDate(booking.checkInDate)}'
                  '  →  ${formatIsoDate(booking.checkOutDate)}',
                  style: const TextStyle(
                    color: AppTheme.text,
                    fontSize: 13,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          Row(
            children: [
              _Money(label: 'Stay', value: booking.totalPrice),
              const SizedBox(width: AppTheme.s24),
              if ((booking.advanceAmount ?? 0) > 0)
                _Money(
                  label: 'Advance',
                  value: booking.advanceAmount,
                  // Says how it arrived, and names every method on a split —
                  // "CASH" alone against ₹200 cash and ₹100 UPI is something
                  // the guest can see is wrong.
                  note: booking.advanceDescription,
                ),
              const Spacer(),
              _Money(label: 'Due', value: booking.balanceDue, strong: true),
            ],
          ),
          // Only a guest who is actually in the room can leave it.
          if (booking.status == 'CHECKED_IN') ...[
            const SizedBox(height: AppTheme.s12),
            NeuButton(
              expand: true,
              padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
              onPressed: () => _checkOut(context, ref),
              child: const Text('Check out'),
            ),
          ],
        ],
      ),
    );
  }

  /// Checking out, in the web's two steps.
  ///
  /// Ask the server how late the guest is and what the policy says that is
  /// worth; a guest who is on time never sees the question and goes straight
  /// through. The charge reception settles on is sent with the checkout, and
  /// the stay lands in the billing queue — which is the next act, because the
  /// stay is over and the money has not been taken yet.
  Future<void> _checkOut(BuildContext context, WidgetRef ref) async {
    final vm = ref.read(bookingViewModelProvider.notifier);

    final late = await vm.askLateCheckout(booking.id);
    if (!context.mounted) return;
    if (late == null) {
      _say(context, ref.read(bookingViewModelProvider).error ?? 'Could not check out.');
      return;
    }

    num charge = 0;
    if (late.isChargeable) {
      final decided = await _askLateCharge(context, late);
      if (decided == null || !context.mounted) return;
      charge = decided;
    }

    final done = await vm.checkOut(booking.id, lateCharge: charge);
    if (!context.mounted) return;
    if (done == null) {
      _say(context, ref.read(bookingViewModelProvider).error ?? 'Could not check out.');
      return;
    }
    await onCheckedOut();
    if (!context.mounted) return;
    _say(context, 'Checked out. The stay is now waiting in Billing.');
  }

  /// What to charge for the overstay. The policy's figure is offered and
  /// reception can take it down or waive it — it is a suggestion with a rule
  /// behind it, not a decision the software makes.
  Future<num?> _askLateCharge(BuildContext context, LateCheckout late) {
    final controller = TextEditingController(text: '${late.suggestedCharge}');
    return showDialog<num>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text(
          'Late checkout',
          style: TextStyle(color: AppTheme.heading),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'This guest is ${late.lateLabel ?? 'late'}. '
              'The policy suggests ${late.bandLabel.toLowerCase()} at '
              '${late.percent}% of ${formatPrice(late.lastNightRate)}.',
              style: const TextStyle(color: AppTheme.text, fontSize: 13),
            ),
            const SizedBox(height: AppTheme.s16),
            NeuField(
              controller: controller,
              label: 'Charge',
              keyboardType: TextInputType.number,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, 0),
            child: const Text('Waive it'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(
              context,
              num.tryParse(controller.text.trim()) ?? 0,
            ),
            child: const Text('Check out'),
          ),
        ],
      ),
    );
  }

  void _say(BuildContext context, String message) =>
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message), backgroundColor: AppTheme.heading),
      );
}

class _StatusTag extends StatelessWidget {
  final String label;
  final Color colour;

  const _StatusTag({required this.label, required this.colour});

  @override
  Widget build(BuildContext context) {
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

class _Money extends StatelessWidget {
  final String label;
  final num? value;
  final String? note;
  final bool strong;

  const _Money({
    required this.label,
    required this.value,
    this.note,
    this.strong = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label, style: Theme.of(context).textTheme.bodySmall),
        Text(
          formatPrice(value),
          style: TextStyle(
            color: strong ? AppTheme.heading : AppTheme.text,
            fontSize: strong ? 16 : 14,
            fontWeight: strong ? FontWeight.w500 : FontWeight.w400,
          ),
        ),
        if (note != null && note!.isNotEmpty)
          Text(
            note!,
            style: const TextStyle(color: AppTheme.muted, fontSize: 11),
          ),
      ],
    );
  }
}
