import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/invoice.dart';
import '../../presentation/providers/usecase_provider.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../billing/bill_pdf.dart';
import '../theme.dart';
import 'advance_receipt_screen.dart';
import 'booking_actions.dart';
import 'id_proof_viewer_screen.dart';
import 'take_booking_screen.dart';

/// One stay, in full.
///
/// Fetched rather than handed down from the register row it was opened from.
/// The list endpoint returns a summary — it has no advancePaymentLines, so a
/// deposit that arrived part cash and part UPI reads on the register as whatever
/// the first tender was. This asks the detail endpoint, which carries the rest.
///
/// Laid out as the same five numbered sections the web tape chart's own stay
/// panel reads in — stay & room, guest details, advance payment, vehicles,
/// charges & discount — so a desk that already knows that screen finds
/// everything in the place it expects it, down to which facts share a card.
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
  bool _busy = false;

  /// Null while it hasn't loaded (or failed to) — the button shows no count
  /// rather than "(0)" either way, the same way the web page's own button
  /// prints nothing before its own fetch answers.
  int? _receiptCount;

  /// True while a "clear lockout" request for the food PIN is in flight.
  bool _clearingLockout = false;

  /// Run a check-in, check-out or cancel and reload this stay's own detail
  /// on success — the same page the desk is already looking at, rather than
  /// leaving it stale once the status it names has changed underneath it.
  Future<void> _run(Future<bool> Function(BookingActions) action) async {
    setState(() => _busy = true);
    final changed = await action(BookingActions(context, ref));
    if (!mounted) return;
    setState(() => _busy = false);
    if (changed) await _load();
  }

  Future<bool> _cancel(BookingActions actions) => actions.cancel(widget.bookingId);

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

    // A side note on the stay, so a failure here is swallowed rather than
    // replacing the booking on screen with an error — the worst case is a
    // button that shows no count.
    ref
        .read(billingUsecaseProvider)
        .advanceReceipts(widget.bookingId)
        .then((receipts) {
          if (mounted) setState(() => _receiptCount = receipts.length);
        })
        .catchError((_) {});
  }

  Future<void> _openAdvanceReceipts() async {
    final booking = _booking;
    if (booking == null) return;
    final changed = await openAdvanceReceiptScreen(context, booking);
    if (changed == true) await _load();
  }

  Future<void> _openEdit() async {
    final booking = _booking;
    if (booking == null) return;
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => TakeBookingScreen(editBooking: booking)),
    );
    if (saved == true) await _load();
  }

  /// A guest who mistypes their room's food PIN five times locks it out of
  /// ordering for fifteen minutes. Reception clears it from here rather than
  /// waiting out the timer.
  Future<void> _clearFoodLockout() async {
    final booking = _booking;
    if (booking == null || booking.roomNumber == null) return;
    setState(() => _clearingLockout = true);
    try {
      await ref
          .read(ordersUsecaseProvider)
          .clearFoodPinLockout(booking.roomNumber!);
      if (!mounted) return;
      await _load();
    } catch (_) {
      // Left as-is: a failed clear leaves the lockout on screen, which is
      // itself the honest answer — the desk can simply try again.
    } finally {
      if (mounted) setState(() => _clearingLockout = false);
    }
  }

  Future<(Uint8List, String?)> _fetchIdProof({int? guestId}) async {
    final usecase = ref.read(bookingUsecaseProvider);
    final res = guestId == null
        ? await usecase.idProof(widget.bookingId)
        : await usecase.guestIdProof(widget.bookingId, guestId);
    final bytes = Uint8List.fromList(res.data ?? const []);
    final contentType = res.headers.value(Headers.contentTypeHeader);
    return (bytes, contentType);
  }

  void _viewIdProof(String title, {int? guestId}) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => IdProofViewerScreen(
          title: title,
          load: () => _fetchIdProof(guestId: guestId),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final booking = _booking;

    return Scaffold(
      backgroundColor: AppTheme.bg,
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : booking == null
            ? Padding(
                padding: const EdgeInsets.all(AppTheme.s16),
                child: NeuNotice(
                  icon: Icons.cloud_off_rounded,
                  message: _error ?? 'Could not open this stay.',
                  action: NeuButton(
                    onPressed: _load,
                    child: const Text('Try again'),
                  ),
                ),
              )
            : RefreshIndicator(
                onRefresh: _load,
                color: AppTheme.accent,
                child: LayoutBuilder(
                  builder: (context, outer) {
                    final wide = outer.maxWidth >= 480;
                    return Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(
                          maxWidth: AppTheme.maxContentWidth,
                        ),
                        child: ListView(
                          padding: const EdgeInsets.fromLTRB(
                            AppTheme.s16,
                            AppTheme.s12,
                            AppTheme.s16,
                            AppTheme.s32,
                          ),
                          physics: const AlwaysScrollableScrollPhysics(
                            parent: BouncingScrollPhysics(),
                          ),
                          children: [
                            _TopBar(booking: booking),
                            const SizedBox(height: AppTheme.s12),
                            _StayRoomSection(
                              booking: booking,
                              clearingLockout: _clearingLockout,
                              onClearLockout: _clearFoodLockout,
                            ),
                            const SizedBox(height: AppTheme.s12),
                            _GuestSection(
                              booking: booking,
                              onViewIdProof: () => _viewIdProof(
                                'ID proof · ${booking.guestName ?? 'Guest'}',
                              ),
                              onViewGuestIdProof: (g) =>
                                  _viewIdProof('ID proof · ${g.name}', guestId: g.id),
                            ),
                            const SizedBox(height: AppTheme.s12),
                            Builder(
                              builder: (context) {
                                // Side by side above a phone's own width, the
                                // way the web panel pairs them — both are
                                // usually short, and stacked they push the
                                // money section further down than either
                                // earns.
                                final advance = _AdvanceSection(booking: booking);
                                final vehicles = _VehiclesSection(booking: booking);
                                return wide
                                    ? Row(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Expanded(child: advance),
                                          const SizedBox(width: AppTheme.s12),
                                          Expanded(child: vehicles),
                                        ],
                                      )
                                    : Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          advance,
                                          const SizedBox(height: AppTheme.s12),
                                          vehicles,
                                        ],
                                      );
                              },
                            ),
                            const SizedBox(height: AppTheme.s12),
                            _ChargesSection(booking: booking),
                            if (booking.invoice != null) ...[
                              const SizedBox(height: AppTheme.s12),
                              _BillSection(invoice: booking.invoice!),
                            ],
                            if (booking.status == 'BOOKED' ||
                                booking.status == 'CHECKED_IN') ...[
                              const SizedBox(height: AppTheme.s24),
                              _actions(booking),
                            ],
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
      ),
    );
  }

  // A uniform 2-column grid — cancel, advance receipt, edit and the status
  // move (check in / check out) all drawn as the same size and shape of
  // button, rather than one plain text link plus a row of two plus a lone
  // full-width one. Order still follows the web page's own footer: cancel
  // first (it is the one irreversible move here), then advance receipt,
  // then edit, then whichever status move applies.
  Widget _actions(Booking booking) {
    final checkInOpen = BookingActions.checkInOpen(booking.checkInDate);
    final reserved = booking.status == 'BOOKED';

    const pairedPadding = EdgeInsets.symmetric(
      horizontal: AppTheme.s12,
      vertical: 13,
    );

    final tiles = <Widget>[
      if (reserved)
        NeuButton(
          padding: pairedPadding,
          expand: true,
          onPressed: _busy ? null : () => _run(_cancel),
          child: const Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.cancel_outlined, size: 16, color: AppTheme.danger),
              SizedBox(width: 6),
              Flexible(
                child: Text(
                  'Cancel booking',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: AppTheme.danger),
                ),
              ),
            ],
          ),
        ),
      NeuButton(
        primary: true,
        expand: true,
        padding: pairedPadding,
        onPressed: _openAdvanceReceipts,
        child: Text(
          _receiptCount != null && _receiptCount! > 0
              ? 'Advance receipt ($_receiptCount)'
              : 'Advance receipt',
        ),
      ),

      // A stay stays editable right up until its own bill is issued — the
      // same window the web page's own "Edit booking" button is offered
      // in. Only offered on a stay that has not been billed: once it has,
      // there is no stay left to move or extend, only the register entry
      // for it.
      if (!booking.hasIssuedInvoice)
        NeuButton(
          expand: true,
          padding: pairedPadding,
          onPressed: _openEdit,
          child: const Text('Edit booking'),
        ),

      if (reserved)
        if (checkInOpen)
          NeuButton(
            primary: true,
            expand: true,
            padding: pairedPadding,
            onPressed: _busy
                ? null
                : () => _run(
                    (a) => a.checkIn(
                      widget.bookingId,
                      guestName: booking.guestName,
                    ),
                  ),
            child: const Text('Check in'),
          )
        else
          NeuButton(
            expand: true,
            padding: pairedPadding,
            onPressed: null,
            child: Text(
              'Opens ${formatIsoDate(booking.checkInDate)}',
              style: const TextStyle(fontSize: 12.5),
            ),
          )
      else
        NeuButton(
          primary: true,
          color: AppTheme.text,
          expand: true,
          padding: pairedPadding,
          onPressed: _busy
              ? null
              : () => _run((a) => a.checkOut(widget.bookingId, booking: booking)),
          child: const Text('Check out'),
        ),
    ];

    return Column(
      children: [
        for (var i = 0; i < tiles.length; i += 2)
          Padding(
            padding: EdgeInsets.only(bottom: i + 2 < tiles.length ? AppTheme.s8 : 0),
            child: Row(
              children: [
                Expanded(child: tiles[i]),
                if (i + 1 < tiles.length) ...[
                  const SizedBox(width: AppTheme.s8),
                  Expanded(child: tiles[i + 1]),
                ],
              ],
            ),
          ),
      ],
    );
  }
}

// ── The top bar: who, their status, and the way out ─────────────────────────

class _TopBar extends StatelessWidget {
  final Booking booking;

  const _TopBar({required this.booking});

  @override
  Widget build(BuildContext context) {
    final checkedIn = booking.status == 'CHECKED_IN';
    final statusColor = BookingActions.statusColor(booking.status);

    return NeuCard(
      radius: AppTheme.rMedium,
      shadow: AppTheme.extruded,
      padding: const EdgeInsets.fromLTRB(
        AppTheme.s16,
        AppTheme.s12,
        AppTheme.s8,
        AppTheme.s12,
      ),
      child: Row(
        children: [
          Container(
            width: 4,
            height: 32,
            decoration: BoxDecoration(
              color: statusColor,
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  (booking.guestName ?? '').trim().isEmpty
                      ? 'Guest'
                      : booking.guestName!,
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.2,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  'Room ${booking.roomNumber ?? '—'}'
                  '${booking.categoryName != null ? ' · ${booking.categoryName}' : ''}',
                  style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: checkedIn
                  ? const Color(0xFFE3F6E9)
                  : statusColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              BookingActions.statusLabel(booking.status),
              style: TextStyle(
                color: checkedIn ? const Color(0xFF1E824C) : statusColor,
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          InkResponse(
            onTap: () => Navigator.of(context).pop(),
            radius: 20,
            child: const Padding(
              padding: EdgeInsets.all(6),
              child: Icon(Icons.close_rounded, color: AppTheme.muted, size: 20),
            ),
          ),
        ],
      ),
    );
  }
}

// ── 1 · Stay & room ──────────────────────────────────────────────────────────

class _StayRoomSection extends StatelessWidget {
  final Booking booking;
  final bool clearingLockout;
  final VoidCallback onClearLockout;

  const _StayRoomSection({
    required this.booking,
    required this.clearingLockout,
    required this.onClearLockout,
  });

  @override
  Widget build(BuildContext context) {
    final nights = booking.nights;
    final lateBy = _formatLateBy(booking.lateCheckoutMinutes);

    return _Section(
      number: 1,
      title: 'Stay & room',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _FactBox(
            facts: [
          _Fact(
            label: 'Room',
            value: 'Room ${booking.roomNumber ?? '—'}'
                '${booking.categoryName != null ? ' · ${booking.categoryName}' : ''}'
                '${booking.bedLabel != null ? ' · ${booking.bedLabel}' : ''}',
          ),
          _Fact(
            label: 'Dates',
            value: '${formatIsoDate(booking.checkInDate)} – '
                '${formatIsoDate(booking.checkOutDate)}',
            note: nights == null ? null : nightsLabel(nights),
          ),
          _Fact(
            label: 'Came in',
            value: booking.actualCheckInAt == null
                ? 'Not arrived yet'
                : formatDateTime(booking.actualCheckInAt!),
          ),
          _Fact(
            label: 'Left',
            value: booking.actualCheckOutAt != null
                ? formatDateTime(booking.actualCheckOutAt!)
                : booking.actualCheckInAt != null
                ? 'Still staying'
                : 'Not arrived yet',
          ),
          if (lateBy != null)
            _Fact(
              label: 'Left late by',
              value: lateBy,
              note: booking.lateCheckoutCharge > 0
                  ? '${formatPrice(booking.lateCheckoutCharge)} agreed'
                  : 'no charge taken',
            ),
          if (booking.switchableCharges.isNotEmpty)
            _Fact(
              label: 'Extras',
              value: booking.switchableCharges
                  .map((c) => c.quantity > 1
                      ? '${c.name} ×${c.quantity.toStringAsFixed(0)}'
                      : c.name)
                  .join(' · '),
              wide: true,
            ),
            ],
          ),
          if (booking.status == 'CHECKED_IN' && booking.foodPin != null) ...[
            const SizedBox(height: AppTheme.s8),
            _FoodPinBox(
              booking: booking,
              clearingLockout: clearingLockout,
              onClearLockout: onClearLockout,
            ),
          ],
        ],
      ),
    );
  }

  static String? _formatLateBy(int? minutes) {
    if (minutes == null || minutes <= 0) return null;
    if (minutes < 60) return '$minutes minutes';
    final hours = minutes ~/ 60;
    final mins = minutes % 60;
    return mins == 0 ? '$hours hours' : '${hours}h ${mins}m';
  }
}

/// The PIN a checked-in guest reads out to order food from the room's QR
/// code, and the "Unlock now" the desk reaches for once they've mistyped it
/// too many times.
class _FoodPinBox extends StatelessWidget {
  final Booking booking;
  final bool clearingLockout;
  final VoidCallback onClearLockout;

  const _FoodPinBox({
    required this.booking,
    required this.clearingLockout,
    required this.onClearLockout,
  });

  @override
  Widget build(BuildContext context) {
    final locked = booking.foodOrderingLockedUntil != null;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: AppTheme.s8,
            runSpacing: 4,
            children: [
              const Text(
                'FOOD PIN',
                style: TextStyle(
                  color: AppTheme.muted,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.3,
                ),
              ),
              Text(
                booking.foodPin!,
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 2,
                ),
              ),
              if (locked)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.danger.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: const Text(
                    'Locked',
                    style: TextStyle(
                      color: AppTheme.danger,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          if (locked)
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Too many wrong PINs — ordering is blocked for this room.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
                TextButton(
                  onPressed: clearingLockout ? null : onClearLockout,
                  child: Text(
                    clearingLockout ? 'Clearing…' : 'Unlock now',
                  ),
                ),
              ],
            )
          else
            Text(
              'Read this out to the guest — they need it to order food from '
              'the QR code.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
        ],
      ),
    );
  }
}

// ── 2 · Guest details ────────────────────────────────────────────────────────

class _GuestSection extends StatelessWidget {
  final Booking booking;
  final VoidCallback onViewIdProof;
  final void Function(GuestInfo guest) onViewGuestIdProof;

  const _GuestSection({
    required this.booking,
    required this.onViewIdProof,
    required this.onViewGuestIdProof,
  });

  @override
  Widget build(BuildContext context) {
    final adults = (booking.numGuests ?? 1) - booking.childCount;
    final split = booking.childCount == 0
        ? '$adults ${adults == 1 ? 'adult' : 'adults'}'
        : '$adults ${adults == 1 ? 'adult' : 'adults'} and '
              '${booking.childCount} ${booking.childCount == 1 ? 'child' : 'children'}';

    return _Section(
      number: 2,
      title: 'Guest details',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              horizontal: AppTheme.s12,
              vertical: AppTheme.s12,
            ),
            decoration: BoxDecoration(
              color: const Color(0xFFF3F4F6),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                Text(
                  '${booking.numGuests ?? 1} '
                  '${(booking.numGuests ?? 1) == 1 ? 'guest' : 'guests'}',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: Text(
                    split,
                    style: const TextStyle(
                      color: AppTheme.muted,
                      fontSize: 13,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppTheme.s8),
          _PersonRow(
            name: (booking.guestName ?? '').trim().isEmpty
                ? 'Guest'
                : booking.guestName!,
            role: 'Primary guest',
            meta: [
              if ((booking.guestPhone ?? '').isNotEmpty) booking.guestPhone!,
              if (booking.idProofType != null)
                _idProofLabel(booking.idProofType!),
            ].join(' · '),
            onViewIdProof: booking.hasIdProofDocument ? onViewIdProof : null,
          ),
          for (final g in booking.guests)
            _PersonRow(
              name: g.name,
              role: g.isChild ? 'Child' : null,
              meta: [
                if ((g.phone ?? '').isNotEmpty) g.phone!,
                if (g.idProofType != null) _idProofLabel(g.idProofType!),
              ].join(' · '),
              onViewIdProof: g.hasIdProofDocument
                  ? () => onViewGuestIdProof(g)
                  : null,
            ),
        ],
      ),
    );
  }

  static String _idProofLabel(String type) {
    if (type.isEmpty) return type;
    final lower = type.substring(1).toLowerCase().replaceAll('_', ' ');
    return '${type[0]}$lower';
  }
}

class _PersonRow extends StatelessWidget {
  final String name;
  final String? role;
  final String meta;

  /// Only offered when a document is actually on file — the same gate the
  /// web page's own "View ID proof" link is drawn behind.
  final VoidCallback? onViewIdProof;

  const _PersonRow({
    required this.name,
    this.role,
    required this.meta,
    this.onViewIdProof,
  });

  String get _initials {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
    final letters = parts.take(2).map((p) => p[0].toUpperCase());
    return letters.isEmpty ? '?' : letters.join();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: AppTheme.s8),
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.s12,
        vertical: AppTheme.s12,
      ),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppTheme.accent.withValues(alpha: 0.14),
              shape: BoxShape.circle,
            ),
            child: Text(
              _initials,
              style: const TextStyle(
                color: AppTheme.accent,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Flexible(
                            child: Text(
                              name,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.titleSmall,
                            ),
                          ),
                          if (role != null) ...[
                            const SizedBox(width: AppTheme.s8),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: AppTheme.accent.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Text(
                                role!.toUpperCase(),
                                style: const TextStyle(
                                  color: AppTheme.accent,
                                  fontSize: 9,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 0.3,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (onViewIdProof != null)
                      InkResponse(
                        onTap: onViewIdProof,
                        radius: 18,
                        child: const Padding(
                          padding: EdgeInsets.all(2),
                          child: Icon(
                            Icons.visibility_outlined,
                            color: AppTheme.accent,
                            size: 18,
                          ),
                        ),
                      ),
                  ],
                ),
                if (meta.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    meta,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── 3 · Advance payment ──────────────────────────────────────────────────────

class _AdvanceSection extends StatelessWidget {
  final Booking booking;

  const _AdvanceSection({required this.booking});

  @override
  Widget build(BuildContext context) {
    final cancelled = booking.status == 'CANCELLED';

    return _Section(
      number: 3,
      title: booking.paidInFull ? 'Payment' : 'Advance payment',
      child: booking.advanceAmount == null
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _EmptyBox(message: 'No advance taken.'),
                if (cancelled &&
                    (booking.cancelReason != null ||
                        (booking.cancellationCharge ?? 0) > 0)) ...[
                  const SizedBox(height: AppTheme.s8),
                  _FactBox(
                    facts: [
                      if ((booking.cancellationCharge ?? 0) > 0)
                        _Fact(
                          label: 'Cancellation charge',
                          value: formatPrice(booking.cancellationCharge),
                          note: booking.cancellationChargePaymentMethod,
                        ),
                      if (booking.cancelReason != null)
                        _Fact(
                          label: 'Cancelled because',
                          value: booking.cancelReason!,
                          wide: true,
                        ),
                    ],
                  ),
                ],
              ],
            )
          : _FactBox(
              facts: [
                _Fact(
                  label: booking.paidInFull ? 'Paid in full' : 'Taken',
                  value: formatPrice(booking.advanceAmount),
                  note: booking.advanceDescription,
                  wide: true,
                ),
                if ((booking.advanceReference ?? '').isNotEmpty)
                  _Fact(
                    label: 'Transaction no.',
                    value: booking.advanceReference!,
                    wide: true,
                  ),
                if (cancelled && booking.refundAmount != null) ...[
                  _Fact(
                    label: 'Refunded',
                    value: formatPrice(booking.refundAmount),
                    note: booking.refundPaymentMethod,
                  ),
                  _Fact(
                    label: 'Cancellation charge',
                    value: formatPrice(booking.cancellationCharge ?? 0),
                  ),
                ],
                if (cancelled && booking.cancelReason != null)
                  _Fact(
                    label: 'Cancelled because',
                    value: booking.cancelReason!,
                    wide: true,
                  ),
              ],
            ),
    );
  }
}

// ── 4 · Vehicles ─────────────────────────────────────────────────────────────

class _VehiclesSection extends StatelessWidget {
  final Booking booking;

  const _VehiclesSection({required this.booking});

  static const _typeLabel = {
    'TWO_WHEELER': 'Two wheeler',
    'FOUR_WHEELER': 'Four wheeler',
    'TRAVELLER': 'Traveller',
    'BUS': 'Bus',
  };

  @override
  Widget build(BuildContext context) {
    return _Section(
      number: 4,
      title: 'Vehicles',
      child: booking.vehicles.isEmpty
          ? const _EmptyBox(message: 'None on file.')
          : Column(
              children: [
                for (final v in booking.vehicles)
                  _PersonRow(
                    name: v.number,
                    meta: v.type != null
                        ? (_typeLabel[v.type] ?? v.type!)
                        : 'Type not recorded',
                  ),
              ],
            ),
    );
  }
}

// ── 5 · Charges & discount ───────────────────────────────────────────────────

class _ChargesSection extends StatelessWidget {
  final Booking booking;

  const _ChargesSection({required this.booking});

  @override
  Widget build(BuildContext context) {
    return _Section(
      number: 5,
      title: 'Charges & discount',
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppTheme.s16),
        decoration: BoxDecoration(
          color: const Color(0xFFF3F4F6),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final line in booking.roomCharges)
              _MoneyLine(
                label: line.nights > 1 && line.amount > 0
                    ? '${line.label}  ×${line.nights} nights'
                    : line.label,
                value: formatPrice(line.amount),
              ),
            const Divider(height: AppTheme.s16),
            _MoneyLine(
              label: 'Room charge for '
                  '${(booking.nights ?? 0) == 1 ? 'the night' : 'all nights'}',
              value: formatPrice(booking.totalPrice),
              strong: true,
            ),
            if (booking.lateCheckoutCharge > 0)
              _MoneyLine(
                label: 'Agreed for leaving late',
                value: formatPrice(booking.lateCheckoutCharge),
              ),
            if (booking.advanceAmount != null)
              _MoneyLine(
                label: booking.paidInFull
                    ? 'Paid in full at booking'
                    : 'Advance already paid',
                note: booking.advanceDescription,
                value: '− ${formatPrice(booking.advanceAmount)}',
              ),
            const Divider(height: AppTheme.s16),
            _MoneyLine(
              label: 'Still to collect',
              value: formatPrice(booking.outstandingBeforeTax),
              strong: true,
            ),
          ],
        ),
      ),
    );
  }
}

// ── The bill, once one has been issued ──────────────────────────────────────

/// A summary of the printed document first — invoice number, the tax it
/// carries, what was collected — then the document itself, drawn the way
/// the printed pad draws it, the same way the web tape chart's own stay
/// panel shows the bill under `Bill <number>`. "Extras are locked" once a
/// bill exists, the same rule that gates the edit button above it.
class _BillSection extends StatefulWidget {
  final Invoice invoice;

  const _BillSection({required this.invoice});

  @override
  State<_BillSection> createState() => _BillSectionState();
}

class _BillSectionState extends State<_BillSection> {
  bool _pdfBusy = false;
  String? _pdfError;

  Invoice get _invoice => widget.invoice;

  /// What is left once the advance and whatever was taken at checkout are
  /// both off the total — 0 on a bill fully settled at the desk, negative on
  /// one that took a refund.
  num get _net =>
      _invoice.totalAmount - _invoice.advancePaid - _invoice.balanceCollected;

  Future<void> _runPdfAction(Future<void> Function() action) async {
    setState(() {
      _pdfBusy = true;
      _pdfError = null;
    });
    try {
      await action();
    } catch (_) {
      if (!mounted) return;
      setState(() => _pdfError = 'Could not prepare the bill PDF.');
    } finally {
      if (mounted) setState(() => _pdfBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final invoice = _invoice;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.receipt_long_rounded, color: AppTheme.accent, size: 18),
            const SizedBox(width: 6),
            Text(
              '${kDocumentLabels[invoice.documentType] ?? 'Bill'} '
              '${invoice.invoiceNumber ?? ''}',
              style: const TextStyle(
                color: AppTheme.heading,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
            if (invoice.isVoid) ...[
              const SizedBox(width: AppTheme.s8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: AppTheme.danger.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: const Text(
                  'VOID',
                  style: TextStyle(
                    color: AppTheme.danger,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(AppTheme.s16),
          decoration: BoxDecoration(
            color: const Color(0xFFF3F4F6),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (invoice.discountAmount > 0)
                _MoneyLine(
                  label: 'Discount',
                  value: '− ${formatPrice(invoice.discountAmount)}',
                ),
              if (invoice.cgstAmount > 0)
                _MoneyLine(
                  label: 'CGST (${invoice.cgstRatePercent}%)',
                  value: formatPrice(invoice.cgstAmount),
                  note: 'included in total',
                ),
              if (invoice.sgstAmount > 0)
                _MoneyLine(
                  label: 'SGST (${invoice.sgstRatePercent}%)',
                  value: formatPrice(invoice.sgstAmount),
                  note: 'included in total',
                ),
              const Divider(height: AppTheme.s16),
              _MoneyLine(
                label: 'Grand total',
                value: formatPrice(invoice.totalAmount),
                strong: true,
              ),
              if (invoice.advancePaid > 0)
                _MoneyLine(
                  label: 'Advance already paid',
                  value: '− ${formatPrice(invoice.advancePaid)}',
                ),
              if (invoice.balanceCollected > 0)
                _MoneyLine(
                  label: 'Collected at checkout',
                  note: invoice.tenders.length > 1
                      ? invoice.tenders.map((l) => l.method).join(' · ')
                      : invoice.balancePaymentMethod,
                  value: '− ${formatPrice(invoice.balanceCollected)}',
                ),
              const Divider(height: AppTheme.s16),
              _MoneyLine(
                label: _net < 0 ? 'Net refund' : 'Net payment',
                value: formatPrice(_net.abs()),
                strong: true,
              ),
            ],
          ),
        ),

        const SizedBox(height: AppTheme.s12),
        Container(
          height: 480,
          decoration: BoxDecoration(
            border: Border.all(color: AppTheme.border),
            borderRadius: BorderRadius.circular(12),
          ),
          clipBehavior: Clip.antiAlias,
          child: PdfPreview(
            key: ValueKey(invoice.id),
            build: (format) => BillPdf.build(invoice),
            canChangePageFormat: false,
            canChangeOrientation: false,
            canDebug: false,
            useActions: false,
            pdfFileName: '${invoice.invoiceNumber ?? invoice.id}.pdf',
          ),
        ),

        const SizedBox(height: AppTheme.s12),
        Row(
          children: [
            Expanded(
              child: _PdfActionButton(
                icon: Icons.download_rounded,
                label: 'Download',
                primary: true,
                busy: _pdfBusy,
                onPressed: () => _runPdfAction(() async {
                  final messenger = ScaffoldMessenger.of(context);
                  final where = await BillPdf.download(invoice);
                  if (!mounted) return;
                  messenger.showSnackBar(
                    SnackBar(
                      content: Text('Saved to $where'),
                      backgroundColor: AppTheme.heading,
                    ),
                  );
                }),
              ),
            ),
            const SizedBox(width: AppTheme.s8),
            Expanded(
              child: _PdfActionButton(
                icon: Icons.share_rounded,
                label: 'Share',
                busy: _pdfBusy,
                onPressed: () => _runPdfAction(() => BillPdf.share(invoice)),
              ),
            ),
          ],
        ),
        if (_pdfError != null)
          Center(
            child: Text(
              _pdfError!,
              style: const TextStyle(color: AppTheme.danger, fontSize: 12),
            ),
          ),

        const SizedBox(height: AppTheme.s8),
        Text(
          'This stay has been billed — extras are locked.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}

/// A compact, labelled pill for the bill's own download/share pair — same
/// height and shape as the primary/secondary [NeuButton]s below it, so the
/// two rows of actions on this page read as one family instead of two
/// different button languages.
class _PdfActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool primary;
  final bool busy;
  final VoidCallback onPressed;

  const _PdfActionButton({
    required this.icon,
    required this.label,
    required this.busy,
    required this.onPressed,
    this.primary = false,
  });

  @override
  Widget build(BuildContext context) {
    return NeuButton(
      primary: primary,
      expand: true,
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.s12,
        vertical: AppTheme.s12,
      ),
      onPressed: busy ? null : onPressed,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: primary ? Colors.white : AppTheme.heading),
          const SizedBox(width: 6),
          Text(label),
        ],
      ),
    );
  }
}

class _MoneyLine extends StatelessWidget {
  final String label;
  final String? note;
  final String value;
  final bool strong;

  const _MoneyLine({
    required this.label,
    this.note,
    required this.value,
    this.strong = false,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: RichText(
              text: TextSpan(
                style: TextStyle(
                  color: AppTheme.heading,
                  fontSize: strong ? 14 : 13,
                  fontWeight: strong ? FontWeight.w700 : FontWeight.w400,
                ),
                children: [
                  TextSpan(text: label),
                  if (note != null && note!.isNotEmpty)
                    TextSpan(
                      text: '  · $note',
                      style: const TextStyle(
                        color: AppTheme.muted,
                        fontSize: 12,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                ],
              ),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: AppTheme.heading,
              fontSize: strong ? 14 : 13,
              fontWeight: strong ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

// ── Shared shells ─────────────────────────────────────────────────────────

/// A numbered header — the small purple badge and caps title every section
/// on the web panel opens with — over whatever that section's own body is.
class _Section extends StatelessWidget {
  final int number;
  final String title;
  final Widget child;

  const _Section({required this.number, required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      radius: AppTheme.rMedium,
      shadow: AppTheme.extruded,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 20,
                height: 20,
                alignment: Alignment.center,
                decoration: const BoxDecoration(
                  color: AppTheme.accent,
                  shape: BoxShape.circle,
                ),
                child: Text(
                  '$number',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Text(
                title.toUpperCase(),
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          child,
        ],
      ),
    );
  }
}

/// The light grey rounded card a section's own facts sit in — label in small
/// caps above a bold value, wrapped so a narrow phone stacks what a tablet
/// lays out in a row.
class _FactBox extends StatelessWidget {
  final List<_Fact> facts;

  const _FactBox({required this.facts});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppTheme.s16),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Wrap(
        spacing: AppTheme.s24,
        runSpacing: AppTheme.s16,
        children: [for (final f in facts) f],
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  final String label;
  final String value;
  final String? note;

  /// Takes the whole row rather than sharing it — a long value like a list
  /// of extras would otherwise be squeezed into whatever width the wrap left
  /// over.
  final bool wide;

  const _Fact({
    required this.label,
    required this.value,
    this.note,
    this.wide = false,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: wide ? double.infinity : 150,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              color: AppTheme.muted,
              fontSize: 10,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.3,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: Theme.of(context).textTheme.titleSmall,
          ),
          if (note != null && note!.isNotEmpty)
            Text(
              note!,
              style: Theme.of(context).textTheme.bodySmall,
            ),
        ],
      ),
    );
  }
}

class _EmptyBox extends StatelessWidget {
  final String message;

  const _EmptyBox({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.s12,
        vertical: AppTheme.s16,
      ),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        message,
        style: const TextStyle(color: AppTheme.muted, fontSize: 13),
      ),
    );
  }
}
