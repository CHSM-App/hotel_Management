import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/invoice.dart';
import '../../domain/models/late_checkout.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../billing/issue_bill_screen.dart';
import '../theme.dart';
import 'cancel_booking_sheet.dart';
import 'check_in_sheet.dart';

/// Check in, check out, or cancel a stay — the three moves the register and
/// the tape chart both offer on a booking, kept in one place so a dialog's
/// wording and a late-checkout's arithmetic exist exactly once.
///
/// Takes an id and the few display fields a dialog needs rather than a
/// [Booking] itself, because the tape chart's own rows are the lean
/// GET /bookings/tape-chart shape — no advance, no balance — and asking it to
/// carry fields it was never sent would mean faking them. Where a real figure
/// is required (check-in's balance due) this asks the server for the full
/// booking first, the same way every other money figure in this app is
/// trusted from the server rather than worked out from a summary row.
class BookingActions {
  final BuildContext context;
  final WidgetRef ref;

  const BookingActions(this.context, this.ref);

  static Color statusColor(String? status) {
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

  static String statusLabel(String? status) {
    switch (status) {
      case 'CHECKED_IN':
        return 'Checked in';
      case 'CHECKED_OUT':
        return 'Checked out';
      case 'CANCELLED':
        return 'Cancelled';
      default:
        return 'Booked';
    }
  }

  /// Whether the reserved date has arrived — the server opens check-in from
  /// that date onward and answers 409 before it.
  static bool checkInOpen(String? checkInDate) {
    if (checkInDate == null) return false;
    final start = DateTime.tryParse(checkInDate);
    if (start == null) return false;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    return !DateTime(start.year, start.month, start.day).isAfter(today);
  }

  /// Check a reservation in at the door. Fetches the booking in full first —
  /// the sheet shows what is left to collect, and only the server's own
  /// figures for the total and the advance already on file can be trusted.
  Future<bool> checkIn(int bookingId, {String? guestName}) async {
    final vm = ref.read(bookingViewModelProvider.notifier);
    final full = await vm.loadBooking(bookingId);
    if (!context.mounted) return false;
    if (full == null) {
      _say(ref.read(bookingViewModelProvider).error ?? 'Could not open this stay.');
      return false;
    }

    final result = await showCheckInSheet(context, full);
    if (result == null || !context.mounted) return false;

    final done = await vm.checkInReservation(
      bookingId,
      idProofType: result.idProofType,
      idProofNumber: result.idProofNumber,
      advanceLines: result.advanceLines,
    );
    if (!context.mounted) return false;
    if (done == null) {
      _say(ref.read(bookingViewModelProvider).error ?? 'Could not check in.');
      return false;
    }
    _say('${guestName ?? 'The guest'} is checked in.');
    return true;
  }

  /// Call off a reservation, once reception has settled whatever advance is
  /// on file. Fetches the booking in full first, the same reason [checkIn]
  /// does — the settlement sheet has to state a real advance and a real
  /// stay total, and only the server's own figures for those can be trusted.
  Future<bool> cancel(int bookingId) async {
    final vm = ref.read(bookingViewModelProvider.notifier);
    final full = await vm.loadBooking(bookingId);
    if (!context.mounted) return false;
    if (full == null) {
      _say(ref.read(bookingViewModelProvider).error ?? 'Could not open this stay.');
      return false;
    }

    final settlement = await showCancelBookingSheet(context, full);
    if (settlement == null || !context.mounted) return false;

    final done = await vm.cancelBooking(
      bookingId,
      reason: settlement.reason,
      refundAmount: settlement.refundAmount,
      refundMethod: settlement.refundMethod,
      cancellationCharge: settlement.cancellationCharge,
      chargeMethod: settlement.chargeMethod,
    );
    if (!context.mounted) return false;
    if (done == null) {
      _say(ref.read(bookingViewModelProvider).error ?? 'Could not cancel.');
      return false;
    }
    _say('Booking cancelled.');
    return true;
  }

  /// Checking out, in the web's two steps: ask how late the guest is, then —
  /// only if that is chargeable — let reception settle what it is worth.
  ///
  /// On success this hands off to Billing directly, the way the web page's
  /// own `onBillStay` does: the stay panel closes — there is nothing left on
  /// it to look at, the stay is over — and the bill for it opens in its
  /// place, already loaded, rather than leaving the desk to find it again in
  /// the billing queue.
  Future<bool> checkOut(int bookingId, {required Booking booking}) async {
    final vm = ref.read(bookingViewModelProvider.notifier);

    final late = await vm.askLateCheckout(bookingId);
    if (!context.mounted) return false;
    if (late == null) {
      _say(ref.read(bookingViewModelProvider).error ?? 'Could not check out.');
      return false;
    }

    num charge = 0;
    if (late.isChargeable) {
      final decided = await _askLateCharge(late);
      if (decided == null || !context.mounted) return false;
      charge = decided;
    }

    final done = await vm.checkOut(bookingId, lateCharge: charge);
    if (!context.mounted) return false;
    if (done == null) {
      _say(ref.read(bookingViewModelProvider).error ?? 'Could not check out.');
      return false;
    }

    final navigator = Navigator.of(context);
    await ref.read(billingViewModelProvider.notifier).open(
      BillableStay(
        id: bookingId,
        guestName: done.guestName ?? booking.guestName,
        guestPhone: done.guestPhone ?? booking.guestPhone,
        roomNumber: done.roomNumber ?? booking.roomNumber,
        categoryName: booking.categoryName,
        checkInDate: done.checkInDate ?? booking.checkInDate,
        checkOutDate: done.checkOutDate ?? booking.checkOutDate,
        totalPrice: done.totalPrice ?? booking.totalPrice,
        advanceAmount: done.advanceAmount ?? booking.advanceAmount,
        actualCheckOutAt: done.actualCheckOutAt,
      ),
    );
    navigator.pop();
    navigator.push(MaterialPageRoute(builder: (_) => const IssueBillScreen()));
    return false;
  }

  Future<num?> _askLateCharge(LateCheckout late) {
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

  void _say(String message) => ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(message), backgroundColor: AppTheme.heading),
  );
}
