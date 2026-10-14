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
      idProofFile: result.idProofFile,
      advanceLines: result.advanceLines,
      guests: result.guests,
      vehicles: result.vehicles,
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

  /// Checking one room of a multi-room stay out on its own — the same two
  /// steps as [checkOut], scoped to a single room: each keeps its own
  /// deadline and its own last night's rate.
  ///
  /// While other rooms are still checked in, the stay carries on: this
  /// returns true so the caller reloads the same detail screen showing the
  /// rooms as they now stand. Once this was the last room, it behaves like
  /// [checkOut] — off to Billing, same as the whole-stay move.
  Future<bool> checkOutRoom(
    int bookingId,
    int roomId, {
    required Booking booking,
  }) async {
    final vm = ref.read(bookingViewModelProvider.notifier);

    final late = await vm.askRoomLateCheckout(bookingId, roomId);
    if (!context.mounted) return false;
    if (late == null) {
      _say(ref.read(bookingViewModelProvider).error ?? 'Could not check out this room.');
      return false;
    }

    num charge = 0;
    if (late.isChargeable) {
      final decided = await _askLateCharge(late);
      if (decided == null || !context.mounted) return false;
      charge = decided;
    }

    final done = await vm.checkOutRoom(bookingId, roomId, lateCharge: charge);
    if (!context.mounted) return false;
    if (done == null) {
      _say(ref.read(bookingViewModelProvider).error ?? 'Could not check out this room.');
      return false;
    }

    if (done.status != 'CHECKED_OUT') {
      return true;
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
      barrierColor: const Color(0x73151E2E),
      builder: (context) => _LateCheckoutDialog(late: late, controller: controller),
    );
  }

  void _say(String message) => ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(message), backgroundColor: AppTheme.heading),
  );
}

/// The late-checkout question, redesigned to match the web register's own
/// `.late-modal` card: the due time and the policy's arithmetic shown up
/// front, then Back/Waive as plain options beside a brand-gradient primary
/// action — rather than the three flat [TextButton]s an [AlertDialog] gives
/// by default.
class _LateCheckoutDialog extends StatefulWidget {
  final LateCheckout late;
  final TextEditingController controller;

  const _LateCheckoutDialog({required this.late, required this.controller});

  @override
  State<_LateCheckoutDialog> createState() => _LateCheckoutDialogState();
}

class _LateCheckoutDialogState extends State<_LateCheckoutDialog> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onChange);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onChange);
    super.dispose();
  }

  void _onChange() => setState(() {});

  String _basisLine(LateCheckout late) {
    if (late.band == 'EXTRA_NIGHTS') {
      return 'Stayed ${late.actualNights} night${late.actualNights == 1 ? '' : 's'}, '
          'booked for ${late.plannedNights} · ${late.extraNights} extra × '
          '${formatPrice(late.lastNightRate)}';
    }
    return '${late.bandLabel} · ${late.percent}% of ${formatPrice(late.lastNightRate)}';
  }

  @override
  Widget build(BuildContext context) {
    final late = widget.late;
    final text = widget.controller.text.trim();
    final parsed = num.tryParse(text);
    final valid = text.isNotEmpty && parsed != null && parsed >= 0;
    final dueAt = late.deadline == null
        ? null
        : formatDateTime(late.deadline!.toIso8601String());

    return Dialog(
      backgroundColor: AppTheme.card,
      insetPadding: const EdgeInsets.all(20),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.rLarge),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 440),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(28, 30, 28, 26),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Late checkout',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 19),
              ),
              const SizedBox(height: 10),
              RichText(
                text: TextSpan(
                  style: const TextStyle(fontSize: 14.5, height: 1.5, color: AppTheme.text),
                  children: [
                    const TextSpan(text: 'This stay was due out at '),
                    if (dueAt != null)
                      TextSpan(
                        text: dueAt,
                        style: const TextStyle(fontWeight: FontWeight.w700, color: AppTheme.heading),
                      ),
                    const TextSpan(text: ' — the guest is '),
                    TextSpan(
                      text: late.lateLabel ?? 'late',
                      style: const TextStyle(fontWeight: FontWeight.w700, color: AppTheme.heading),
                    ),
                    const TextSpan(text: '.'),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: AppTheme.bg,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _basisLine(late),
                      style: const TextStyle(fontSize: 13, height: 1.45, color: AppTheme.muted),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'suggests ${formatPrice(late.suggestedCharge)}',
                      style: const TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                        color: AppTheme.heading,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              NeuField(
                controller: widget.controller,
                label: 'Charge the guest',
                keyboardType: const TextInputType.numberWithOptions(decimal: false),
              ),
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text(
                  'Goes on the bill as its own line, taxed with the room. Set it to 0 to waive it.',
                  style: TextStyle(fontSize: 12.5, height: 1.4, color: AppTheme.muted),
                ),
              ),
              const SizedBox(height: 20),
              IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      child: _LateCheckoutGhostButton(
                        label: 'Back',
                        onPressed: () => Navigator.pop(context),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _LateCheckoutGhostButton(
                        label: 'Waive & check out',
                        onPressed: () => Navigator.pop(context, 0),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              _LateCheckoutPrimaryButton(
                label: valid ? 'Charge ${formatPrice(parsed)} & check out' : 'Charge & check out',
                onPressed: valid ? () => Navigator.pop(context, parsed) : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The brand-gradient CTA, matching the web dialog's `.late-modal__btn--primary`
/// (`linear-gradient(135deg, --brand-lift, --brand)`) — the one fill in this
/// dialog saturated enough to say "this is the button to press".
class _LateCheckoutPrimaryButton extends StatefulWidget {
  final String label;
  final VoidCallback? onPressed;

  const _LateCheckoutPrimaryButton({required this.label, required this.onPressed});

  @override
  State<_LateCheckoutPrimaryButton> createState() => _LateCheckoutPrimaryButtonState();
}

class _LateCheckoutPrimaryButtonState extends State<_LateCheckoutPrimaryButton> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null;
    return Opacity(
      opacity: enabled ? 1 : 0.5,
      child: GestureDetector(
        onTapDown: enabled ? (_) => setState(() => _down = true) : null,
        onTapUp: enabled ? (_) => setState(() => _down = false) : null,
        onTapCancel: enabled ? () => setState(() => _down = false) : null,
        onTap: widget.onPressed,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          curve: Curves.easeOut,
          width: double.infinity,
          constraints: const BoxConstraints(minHeight: 50),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: _down
                  ? const [AppTheme.sidebarBrand, AppTheme.sidebarBrandInk]
                  : const [Color(0xFF7C5CE8), AppTheme.sidebarBrand],
            ),
            borderRadius: BorderRadius.circular(AppTheme.rMedium),
            boxShadow: _down
                ? null
                : const [
                    BoxShadow(color: Color(0x4A5B3FD9), offset: Offset(0, 10), blurRadius: 22),
                  ],
          ),
          child: Center(
            child: Text(
              widget.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 15.5,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The plain "Back" / "Waive & check out" options beside the primary button.
///
/// Built rather than reusing [NeuButton]: that widget's label is pinned to a
/// single ellipsized line, which clips "Waive & check out" at phone width —
/// this lets the label wrap onto a second line instead, matching the web
/// button's own natural wrap.
class _LateCheckoutGhostButton extends StatefulWidget {
  final String label;
  final VoidCallback? onPressed;

  const _LateCheckoutGhostButton({required this.label, required this.onPressed});

  @override
  State<_LateCheckoutGhostButton> createState() => _LateCheckoutGhostButtonState();
}

class _LateCheckoutGhostButtonState extends State<_LateCheckoutGhostButton> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null;
    return Opacity(
      opacity: enabled ? (_down ? 0.85 : 1) : 0.5,
      child: GestureDetector(
        onTapDown: enabled ? (_) => setState(() => _down = true) : null,
        onTapUp: enabled ? (_) => setState(() => _down = false) : null,
        onTapCancel: enabled ? () => setState(() => _down = false) : null,
        onTap: widget.onPressed,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          curve: Curves.easeOut,
          width: double.infinity,
          constraints: const BoxConstraints(minHeight: 46),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
          decoration: BoxDecoration(
            color: AppTheme.card,
            borderRadius: BorderRadius.circular(AppTheme.rMedium),
            border: Border.all(color: AppTheme.border),
            boxShadow: _down ? null : AppTheme.subtle,
          ),
          alignment: Alignment.center,
          child: Text(
            widget.label,
            textAlign: TextAlign.center,
            maxLines: 2,
            style: const TextStyle(
              color: AppTheme.heading,
              fontSize: 13.5,
              fontWeight: FontWeight.w600,
              height: 1.2,
            ),
          ),
        ),
      ),
    );
  }
}
