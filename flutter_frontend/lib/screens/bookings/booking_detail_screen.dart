import 'dart:typed_data';
import 'dart:ui' show FontFeature;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
import 'receipt_download.dart';
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

  /// A read-only record of the stay (the billing queue's "View"): no cancel,
  /// advance, edit, check-in or check-out, and no adding food to the room
  /// bill — reading what a figure is made of should not need a way to change
  /// it.
  final bool readOnly;

  /// Offered with [readOnly] when the record was opened from the billing
  /// queue: an "Issue bill" button beside Close, so a desk that has read what
  /// the figures are made of can go straight on to billing it.
  final VoidCallback? onIssueBill;

  const BookingDetailScreen({
    super.key,
    required this.bookingId,
    this.readOnly = false,
    this.onIssueBill,
  });

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

  Future<void> _checkOutRoom(int roomId) {
    final booking = _booking;
    if (booking == null) return Future.value();
    return _run(
      (a) => a.checkOutRoom(widget.bookingId, roomId, booking: booking),
    );
  }

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

  // This page is light, but the shell it was pushed over sets white status-bar
  // icons for its dark navbar — so the clock, wifi and signal vanished here.
  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
      ),
      child: _buildScaffold(context),
    );
  }

  Widget _buildScaffold(BuildContext context) {
    final booking = _booking;

    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        title: Text(
          '${widget.readOnly ? 'Stay summary' : 'Guest stay'}'
          '${booking?.bookingNumber != null ? ' · ${booking!.bookingNumber}' : ''}',
        ),
      ),
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
                            AppTheme.s12,
                            AppTheme.s4,
                            AppTheme.s12,
                            AppTheme.s24,
                          ),
                          physics: const AlwaysScrollableScrollPhysics(
                            parent: BouncingScrollPhysics(),
                          ),
                          children: [
                            _TopBar(booking: booking),
                            const SizedBox(height: AppTheme.s8),
                            _StayRoomSection(
                              booking: booking,
                              clearingLockout: _clearingLockout,
                              onClearLockout: _clearFoodLockout,
                              busy: _busy,
                              onCheckOutRoom: _checkOutRoom,
                            ),
                            const SizedBox(height: AppTheme.s8),
                            _GuestSection(
                              booking: booking,
                              onViewIdProof: () => _viewIdProof(
                                'ID proof · ${booking.guestName ?? 'Guest'}',
                              ),
                              onViewGuestIdProof: (g) =>
                                  _viewIdProof('ID proof · ${g.name}', guestId: g.id),
                            ),
                            const SizedBox(height: AppTheme.s8),
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
                                          const SizedBox(height: AppTheme.s8),
                                          vehicles,
                                        ],
                                      );
                              },
                            ),
                            const SizedBox(height: AppTheme.s8),
                            _ChargesSection(booking: booking),
                            if (booking.foodOrders.isNotEmpty) ...[
                              const SizedBox(height: AppTheme.s8),
                              _FoodOrdersSection(
                                orders: booking.foodOrders,
                                canAdd:
                                    !widget.readOnly &&
                                    booking.invoice == null &&
                                    booking.status != 'CANCELLED',
                                onAdded: _load,
                                bookingId: widget.bookingId,
                              ),
                            ],
                            if (booking.serviceUsages.isNotEmpty) ...[
                              const SizedBox(height: AppTheme.s8),
                              _ServicesSection(usages: booking.serviceUsages),
                            ],
                            if (booking.invoice != null) ...[
                              const SizedBox(height: AppTheme.s8),
                              _BillSection(invoice: booking.invoice!),
                            ],
                            if (widget.readOnly && widget.onIssueBill != null) ...[
                              const SizedBox(height: AppTheme.s12),
                              Row(
                                children: [
                                  Expanded(
                                    child: NeuButton(
                                      expand: true,
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: AppTheme.s12,
                                        vertical: 13,
                                      ),
                                      onPressed: () =>
                                          Navigator.of(context).pop(),
                                      child: const Text('Close'),
                                    ),
                                  ),
                                  const SizedBox(width: AppTheme.s8),
                                  Expanded(
                                    child: NeuButton(
                                      primary: true,
                                      expand: true,
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: AppTheme.s12,
                                        vertical: 13,
                                      ),
                                      onPressed: widget.onIssueBill,
                                      child: const Text('Issue bill'),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                            if (!widget.readOnly &&
                                (booking.status == 'BOOKED' ||
                                    booking.status == 'CHECKED_IN')) ...[
                              const SizedBox(height: AppTheme.s12),
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
          primary: true,
          color: AppTheme.sidebarBrand,
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
          // A multi-room stay checks out every room still due in one call —
          // the server fans it out when no specific room is named — so the
          // one button already covers "check out all rooms". Named for how
          // many rooms are actually still checked in, not the stay's total
          // room count — once only one remains (the rest already checked
          // out room by room), this reads as a plain "Check out", same as
          // Bookings.jsx's own button label.
          child: Text(
            booking.rooms.where((r) => r.status == 'CHECKED_IN').length > 1
                ? 'Check out all rooms'
                : 'Check out',
          ),
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

  String get _name =>
      (booking.guestName ?? '').trim().isEmpty ? 'Guest' : booking.guestName!;

  String get _initials {
    final parts = _name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
    final letters = parts.take(2).map((p) => p[0].toUpperCase());
    return letters.isEmpty ? '?' : letters.join();
  }

  @override
  Widget build(BuildContext context) {
    final statusColor = BookingActions.statusColor(booking.status);
    final nights = booking.nights;
    final room = booking.isMultiRoom
        ? '${booking.roomCount} rooms · ${booking.roomNumbers ?? booking.roomNumber ?? '—'}'
        : 'Room ${booking.roomNumber ?? '—'}'
              '${booking.categoryName != null ? ' · ${booking.categoryName}' : ''}';

    return Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppTheme.navbar, AppTheme.accent],
        ),
        borderRadius: BorderRadius.circular(AppTheme.rMedium + 4),
        boxShadow: [
          BoxShadow(
            color: AppTheme.navbar.withValues(alpha: 0.25),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s4),
            child: Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.16),
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.35),
                    ),
                  ),
                  child: Text(
                    _initials,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: AppTheme.s12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 19,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.3,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        [
                          room,
                          if ((booking.guestPhone ?? '').isNotEmpty)
                            booking.guestPhone!,
                        ].join(' · '),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppTheme.s8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 6,
                        height: 6,
                        decoration: BoxDecoration(
                          color: statusColor,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        BookingActions.statusLabel(booking.status),
                        style: TextStyle(
                          color: statusColor,
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(vertical: 8),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppTheme.rMedium),
            ),
            child: IntrinsicHeight(
              child: Row(
                children: [
                  _HeroStat(
                    label: 'CHECK-IN',
                    value: formatIsoDate(booking.checkInDate),
                  ),
                  const _HeroDivider(),
                  _HeroStat(
                    label: 'CHECK-OUT',
                    value: formatIsoDate(booking.checkOutDate),
                  ),
                  const _HeroDivider(),
                  _HeroStat(
                    label: 'NIGHTS',
                    value: nights == null ? '—' : '$nights',
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroStat extends StatelessWidget {
  final String label;
  final String value;

  const _HeroStat({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: Colors.white60,
              fontSize: 9.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 13.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroDivider extends StatelessWidget {
  const _HeroDivider();

  @override
  Widget build(BuildContext context) =>
      Container(width: 1, color: Colors.white.withValues(alpha: 0.2));
}

// ── 1 · Stay & room ──────────────────────────────────────────────────────────

class _StayRoomSection extends StatelessWidget {
  final Booking booking;
  final bool clearingLockout;
  final VoidCallback onClearLockout;
  final bool busy;
  final ValueChanged<int> onCheckOutRoom;

  const _StayRoomSection({
    required this.booking,
    required this.clearingLockout,
    required this.onClearLockout,
    required this.busy,
    required this.onCheckOutRoom,
  });

  @override
  Widget build(BuildContext context) {
    final nights = booking.nights;
    final lateBy = _formatLateBy(booking.lateCheckoutMinutes);

    return _Section(
      number: 1,
      icon: Icons.meeting_room_rounded,
      title: 'Stay & room',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (booking.isMultiRoom) ...[
            _MultiRoomBreakdown(
              rooms: booking.rooms,
              busy: busy,
              onCheckOut: onCheckOutRoom,
            ),
            const SizedBox(height: AppTheme.s8),
          ],
          _FactBox(
            facts: [
          _Fact(
            label: 'Room',
            value: booking.isMultiRoom
                ? '${booking.roomCount} rooms · ${booking.roomNumbers ?? booking.roomNumber ?? '—'}'
                : 'Room ${booking.roomNumber ?? '—'}'
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

/// The itemized rooms of a multi-room stay — one card per [BookingRoom],
/// shown above the usual fact grid (which switches to a "N rooms · ..."
/// summary line once this is showing). A room still checked in carries its
/// own "Check out" button, the same per-room move the web's stay panel
/// offers, alongside [_actions]'s whole-stay "Check out all rooms".
class _MultiRoomBreakdown extends StatelessWidget {
  final List<BookingRoom> rooms;
  final bool busy;
  final ValueChanged<int> onCheckOut;

  const _MultiRoomBreakdown({
    required this.rooms,
    required this.busy,
    required this.onCheckOut,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final room in rooms) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(AppTheme.s12),
            margin: const EdgeInsets.only(bottom: AppTheme.s8),
            decoration: BoxDecoration(
              color: AppTheme.bg,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Room ${room.roomNumber}'
                        '${room.categoryName != null ? ' · ${room.categoryName}' : ''}',
                        style: const TextStyle(
                          color: AppTheme.heading,
                          fontWeight: FontWeight.w700,
                          fontSize: 13,
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: BookingActions.statusColor(
                          room.status,
                        ).withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        BookingActions.statusLabel(room.status),
                        style: TextStyle(
                          color: BookingActions.statusColor(room.status),
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    if (room.status == 'CHECKED_IN') ...[
                      const SizedBox(width: AppTheme.s8),
                      NeuButton(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppTheme.s12,
                          vertical: 6,
                        ),
                        onPressed: busy ? null : () => onCheckOut(room.roomId),
                        child: const Text(
                          'Check out',
                          style: TextStyle(fontSize: 12),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  '${formatIsoDate(room.checkInDate)} – ${formatIsoDate(room.checkOutDate)}'
                  '${room.bedLabels.isNotEmpty ? ' · ${room.bedLabels.join(', ')}' : ''}'
                  '${room.totalPrice != null ? ' · ${formatPrice(room.totalPrice!)}' : ''}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                if (room.switchableCharges.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      room.switchableCharges
                          .map(
                            (c) => c.quantity > 1
                                ? '${c.name} ×${c.quantity.toStringAsFixed(0)}'
                                : c.name,
                          )
                          .join(' · '),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                if (room.foodPin != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Food PIN ${room.foodPin}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ],
            ),
          ),
        ],
      ],
    );
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
        color: AppTheme.bg,
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
      icon: Icons.people_alt_rounded,
      title: 'Guest details',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              horizontal: AppTheme.s12,
              vertical: 8,
            ),
            decoration: BoxDecoration(
              color: AppTheme.bg,
              borderRadius: BorderRadius.circular(10),
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
          _PersonRow(
            name: (booking.guestName ?? '').trim().isEmpty
                ? 'Guest'
                : booking.guestName!,
            role: 'Primary guest',
            details: _details(
              phone: booking.guestPhone,
              idType: booking.idProofType,
              idNumber: booking.idProofNumber,
              hasDocument: booking.hasIdProofDocument,
            ),
            onViewIdProof: booking.hasIdProofDocument ? onViewIdProof : null,
          ),
          for (final g in booking.guests)
            _PersonRow(
              name: g.name,
              role: g.isChild ? 'Child' : 'Adult',
              details: _details(
                phone: g.phone,
                idType: g.idProofType,
                idNumber: g.idProofNumber,
                hasDocument: g.hasIdProofDocument,
              ),
              onViewIdProof: g.hasIdProofDocument
                  ? () => onViewGuestIdProof(g)
                  : null,
            ),
        ],
      ),
    );
  }

  /// Every detail that was entered for one person, each on its own labelled
  /// line — a missing value says so rather than being left out.
  static List<(String, String)> _details({
    String? phone,
    String? idType,
    String? idNumber,
    required bool hasDocument,
  }) => [
    ('Phone', (phone ?? '').isEmpty ? '—' : phone!),
    ('ID type', (idType ?? '').isEmpty ? '—' : _idProofLabel(idType!)),
    ('ID number', (idNumber ?? '').isEmpty ? '—' : idNumber!),
    ('ID document', hasDocument ? 'Uploaded' : '—'),
  ];

  static String _idProofLabel(String type) {
    if (type.isEmpty) return type;
    final lower = type.substring(1).toLowerCase().replaceAll('_', ' ');
    return '${type[0]}$lower';
  }
}

class _PersonRow extends StatelessWidget {
  final String name;
  final String? role;

  /// A single muted line under the name (a vehicle's type) …
  final String meta;

  /// … or one labelled line per detail, for a guest.
  final List<(String, String)> details;

  /// Only offered when a document is actually on file — the same gate the
  /// web page's own "View ID proof" link is drawn behind.
  final VoidCallback? onViewIdProof;

  const _PersonRow({
    required this.name,
    this.role,
    this.meta = '',
    this.details = const [],
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
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.s12,
        vertical: 10,
      ),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 30,
            height: 30,
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
                if (details.isNotEmpty) const SizedBox(height: 4),
                for (final d in details)
                  Padding(
                    padding: const EdgeInsets.only(top: 1),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          width: 84,
                          child: Text(
                            d.$1,
                            style: const TextStyle(
                              color: AppTheme.muted,
                              fontSize: 11.5,
                            ),
                          ),
                        ),
                        Expanded(
                          child: Text(
                            d.$2,
                            style: TextStyle(
                              color: d.$2 == '—' ? AppTheme.muted : AppTheme.text,
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
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
      icon: Icons.payments_rounded,
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
      icon: Icons.directions_car_filled_rounded,
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

  Widget _group(IconData icon, String title, List<Widget> rows, Widget total) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: AppTheme.s8),
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 13, color: AppTheme.muted),
              const SizedBox(width: 6),
              Text(
                title.toUpperCase(),
                style: const TextStyle(
                  color: AppTheme.muted,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.6,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          ...rows,
          const Divider(height: 12, color: AppTheme.border),
          total,
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final foodOpen = booking.foodOrdersOpen;
    final servicesOpen = booking.servicesOpen;
    final due = booking.outstandingBeforeTax +
        booking.foodOpenTotal +
        booking.servicesOpenTotal;
    final advance = booking.advanceAmount ?? 0;
    final grand = due + advance;
    final paidShare = grand > 0 ? (advance / grand).clamp(0.0, 1.0) : 0.0;

    return _Section(
      number: 5,
      icon: Icons.receipt_long_rounded,
      title: 'Price breakdown',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _group(
            Icons.bed_rounded,
            'Room',
            [
              for (final line in booking.roomCharges)
                _MoneyLine(
                  label: line.label,
                  note: line.nights > 1 && line.amount > 0
                      ? '${line.nights} nights'
                      : null,
                  value: formatPrice(line.amount),
                ),
              if (booking.lateCheckoutCharge > 0)
                _MoneyLine(
                  label: 'Agreed for leaving late',
                  value: formatPrice(booking.lateCheckoutCharge),
                ),
            ],
            _MoneyLine(
              label: 'Room charge for '
                  '${(booking.nights ?? 0) == 1 ? 'the night' : 'all nights'}',
              value: formatPrice(booking.totalPrice),
              strong: true,
            ),
          ),
          // Orders still being cooked count too, and say so, because they
          // will be on the bill — same as StayDetails.jsx's foodOpen block.
          if (foodOpen.isNotEmpty)
            _group(
              Icons.restaurant_rounded,
              'Food',
              [
                for (final o in foodOpen)
                  _MoneyLine(
                    label: 'Order #${o.orderNumber}',
                    note: o.origin == 'ROOM_SERVICE'
                        ? 'room service'
                        : 'from ${o.placedFrom ?? 'restaurant'}'
                              '${o.status != 'DELIVERED' ? ' · in progress' : ''}',
                    value: formatPrice(o.subtotal),
                  ),
              ],
              _MoneyLine(
                label: 'Food ordered',
                value: formatPrice(booking.foodOpenTotal),
                strong: true,
              ),
            ),
          if (servicesOpen.isNotEmpty)
            _group(
              Icons.spa_rounded,
              'Services',
              [
                for (final u in servicesOpen)
                  _MoneyLine(
                    label: u.name,
                    note:
                        '${formatPrice(u.unitPrice ?? u.amount / u.quantity)} per ${u.unitLabel} × ${u.quantity}${u.headcount > 1 ? ' × ${u.headcount} people' : ''}'
                        '${u.gstRatePercent > 0 ? ' · incl. ${u.gstRatePercent}% GST' : ''}',
                    value: formatPrice(u.amount),
                  ),
              ],
              _MoneyLine(
                label:
                    'Services used · ${servicesOpen.length} '
                    '${servicesOpen.length == 1 ? 'item' : 'items'}',
                value: formatPrice(booking.servicesOpenTotal),
                strong: true,
              ),
            ),
          if (booking.advanceAmount != null)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: AppTheme.s8),
              padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
              decoration: BoxDecoration(
                color: AppTheme.vacant.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(
                children: [
                  _MoneyLine(
                    label: booking.paidInFull
                        ? 'Paid in full at booking'
                        : 'Advance already paid',
                    note: booking.advanceDescription,
                    value: '− ${formatPrice(booking.advanceAmount)}',
                  ),
                  if (booking.invoice == null && grand > 0)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(999),
                        child: LinearProgressIndicator(
                          value: paidShare.toDouble(),
                          minHeight: 5,
                          backgroundColor: AppTheme.vacant.withValues(
                            alpha: 0.15,
                          ),
                          valueColor: const AlwaysStoppedAnimation(
                            AppTheme.vacant,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          // Only while the stay is still unbilled. Once a bill exists it is
          // the answer to "what is owed", and a pre-tax guess sitting beside
          // it would be a second, wrong one.
          if (booking.invoice == null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.s12,
                vertical: 10,
              ),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppTheme.navbar, AppTheme.accent],
                ),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Still to collect',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 13.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Text(
                          'Room'
                          '${booking.lateCheckoutCharge > 0 ? ' + late checkout' : ''}'
                          '${foodOpen.isNotEmpty ? ' + food' : ''}'
                          '${servicesOpen.isNotEmpty ? ' + services' : ''}'
                          ' − advance',
                          style: const TextStyle(
                            color: Colors.white70,
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    formatPrice(due),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.3,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

// ── Food ordered ──────────────────────────────────────────────────────────

/// Every ticket this stay has run up — room service, and table food the desk
/// moved onto the room — billed or not, each with its own dishes. Mirrors
/// Bookings.jsx's own RoomFoodSection on the web guest register, which is
/// where this list was visible and the app's own stay screen was not
/// showing it.
class _FoodOrdersSection extends ConsumerStatefulWidget {
  final List<BookingFoodOrder> orders;
  final int bookingId;

  /// Whether the desk may still add food to this stay's bill — false once
  /// the stay is billed or cancelled, same gate Bookings.jsx's own
  /// RoomFoodSection applies.
  final bool canAdd;

  /// Reloads the booking once an add succeeds, so the screen reflects which
  /// orders are now on the bill.
  final Future<void> Function() onAdded;

  const _FoodOrdersSection({
    required this.orders,
    required this.bookingId,
    required this.canAdd,
    required this.onAdded,
  });

  @override
  ConsumerState<_FoodOrdersSection> createState() => _FoodOrdersSectionState();
}

class _FoodOrdersSectionState extends ConsumerState<_FoodOrdersSection> {
  static const _statusLabel = {
    'PENDING': 'Waiting',
    'QUEUED': 'Queued',
    'PREPARING': 'Preparing',
    'READY': 'Ready',
    'DELIVERED': 'Delivered',
  };

  bool _adding = false;
  String? _error;

  /// Delivered orders the desk hasn't yet put on the bill — the only ones
  /// "Add to room bill" moves, same filter the web's own `addable` applies.
  List<BookingFoodOrder> get _addable => widget.orders
      .where((o) => !o.onRoomBill && !o.billed && o.status == 'DELIVERED')
      .toList();

  Future<void> _addToRoomBill() async {
    setState(() {
      _adding = true;
      _error = null;
    });
    try {
      await ref
          .read(billingUsecaseProvider)
          .addFoodTabToRoom('room-booking-${widget.bookingId}', widget.bookingId);
      if (!mounted) return;
      await widget.onAdded();
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not add the food to the room bill.');
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final orders = widget.orders;
    final total = orders.fold<num>(0, (sum, o) => sum + o.subtotal);
    final onBill = orders
        .where((o) => o.onRoomBill && !o.billed)
        .fold<num>(0, (sum, o) => sum + o.subtotal);
    final addable = _addable;

    return NeuCard(
      radius: AppTheme.rMedium,
      shadow: AppTheme.extruded,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.restaurant_rounded,
                color: AppTheme.accent,
                size: 18,
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Food ordered',
                      style: TextStyle(
                        color: AppTheme.heading,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      '${orders.length} order${orders.length == 1 ? '' : 's'} · '
                      'on the room bill only once added',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          for (final o in orders) ...[
            _FoodOrderTicket(order: o, statusLabel: _statusLabel),
            const SizedBox(height: AppTheme.s8),
          ],
          const Divider(height: AppTheme.s16),
          _MoneyLine(label: 'Food total', value: formatPrice(total), strong: true),
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              '${formatPrice(onBill)} of this is on the room bill'
              '${onBill == total ? '' : ' · ${formatPrice(total - onBill)} is not'}.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                _error!,
                style: const TextStyle(color: AppTheme.danger, fontSize: 12),
              ),
            ),
          if (widget.canAdd && addable.isNotEmpty) ...[
            const SizedBox(height: AppTheme.s8),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: _adding ? null : _addToRoomBill,
              child: Text(
                _adding
                    ? 'Adding…'
                    : 'Add ${addable.length} delivered order${addable.length == 1 ? '' : 's'} to the room bill',
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _FoodOrderTicket extends StatelessWidget {
  final BookingFoodOrder order;
  final Map<String, String> statusLabel;

  const _FoodOrderTicket({required this.order, required this.statusLabel});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.bg,
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
              Text(
                '#${order.orderNumber}',
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(
                order.origin == 'ROOM_SERVICE'
                    ? 'Room service'
                    : 'From ${order.placedFrom ?? 'restaurant'}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              Text(
                formatDateTime(order.placedAt),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: (order.billed ? AppTheme.text : AppTheme.accent)
                      .withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  order.billed
                      ? 'Billed'
                      : statusLabel[order.status] ?? order.status,
                  style: TextStyle(
                    color: order.billed ? AppTheme.text : AppTheme.accent,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              if (!order.billed)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: (order.onRoomBill ? AppTheme.vacant : AppTheme.muted)
                        .withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    order.onRoomBill ? 'On room bill' : 'Not on room bill',
                    style: TextStyle(
                      color: order.onRoomBill ? AppTheme.vacant : AppTheme.muted,
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              Text(
                formatPrice(order.subtotal),
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          if (order.items.isNotEmpty) ...[
            const SizedBox(height: AppTheme.s8),
            for (final item in order.items)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Row(
                  children: [
                    Text(
                      '${item.quantity}×  ',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    Expanded(
                      child: Text(
                        item.name,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                    Text(
                      formatPrice(item.lineTotal),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }
}

// ── Services used ─────────────────────────────────────────────────────────

/// Every service this stay has used — spa, pool, laundry, whatever the lodge
/// sells beyond the room and food — billed or not. Mirrors Bookings.jsx's own
/// RoomServicesSection on the web guest register.
class _ServicesSection extends StatelessWidget {
  final List<BookingServiceUsage> usages;

  const _ServicesSection({required this.usages});

  @override
  Widget build(BuildContext context) {
    final total = usages.fold<num>(0, (sum, u) => sum + u.amount);
    final onBill = usages
        .where((u) => u.onRoomBill && !u.billed)
        .fold<num>(0, (sum, u) => sum + u.amount);

    return NeuCard(
      radius: AppTheme.rMedium,
      shadow: AppTheme.extruded,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.spa_rounded, color: AppTheme.accent, size: 18),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Services used',
                      style: TextStyle(
                        color: AppTheme.heading,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      '${usages.length} service${usages.length == 1 ? '' : 's'} · '
                      'on the room bill only once added',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          for (final u in usages) ...[
            _ServiceUsageTile(usage: u),
            const SizedBox(height: AppTheme.s8),
          ],
          const Divider(height: AppTheme.s16),
          _MoneyLine(label: 'Services total', value: formatPrice(total), strong: true),
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              '${formatPrice(onBill)} of this is on the room bill'
              '${onBill == total ? '' : ' · ${formatPrice(total - onBill)} is not'}.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }
}

class _ServiceUsageTile extends StatelessWidget {
  final BookingServiceUsage usage;

  const _ServiceUsageTile({required this.usage});

  @override
  Widget build(BuildContext context) {
    final started = DateTime.tryParse(usage.startedAt ?? '');
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: AppTheme.s8,
        runSpacing: 4,
        children: [
          Text(
            usage.name,
            style: const TextStyle(
              color: AppTheme.heading,
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
            ),
          ),
          Text(
            '${usage.quantity} ${usage.unitLabel}${usage.headcount > 1 ? ' × ${usage.headcount} people' : ''}'
            '${started != null ? ' · ${_formatDateTime(started)}' : ''}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          _StatusChip(
            label: usage.billed
                ? 'Billed'
                : usage.status == 'COMPLETED'
                ? 'Completed'
                : 'In use',
            color: usage.billed
                ? AppTheme.heading
                : usage.status == 'COMPLETED'
                ? AppTheme.vacant
                : AppTheme.accent,
          ),
          if (!usage.billed)
            _StatusChip(
              label: usage.onRoomBill ? 'On room bill' : 'Not on room bill',
              color: usage.onRoomBill ? AppTheme.vacant : AppTheme.muted,
            ),
          Text(
            formatPrice(usage.amount),
            style: const TextStyle(
              color: AppTheme.heading,
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

String _formatDateTime(DateTime dt) {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  final hour12 = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
  final minute = dt.minute.toString().padLeft(2, '0');
  final ampm = dt.hour < 12 ? 'AM' : 'PM';
  return '${dt.day} ${months[dt.month - 1]}, $hour12:$minute $ampm';
}

class _StatusChip extends StatelessWidget {
  final String label;
  final Color color;

  const _StatusChip({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600),
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
            color: AppTheme.bg,
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
                      content: const Text('PDF saved.'),
                      backgroundColor: AppTheme.heading,
                      action: canOpenSavedFile
                          ? SnackBarAction(
                              label: 'Open',
                              textColor: Colors.white,
                              onPressed: () => openSavedFile(where, 'bill.pdf'),
                            )
                          : null,
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
    final deduction = value.startsWith('−') || value.startsWith('-');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    color: AppTheme.heading,
                    fontSize: strong ? 14 : 12.5,
                    fontWeight: strong ? FontWeight.w700 : FontWeight.w500,
                    height: 1.25,
                  ),
                ),
                if (note != null && note!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 1),
                    child: Text(
                      note!,
                      style: const TextStyle(
                        color: AppTheme.muted,
                        fontSize: 11,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s12),
          Text(
            value,
            style: TextStyle(
              color: deduction ? AppTheme.vacant : AppTheme.heading,
              fontSize: strong ? 14.5 : 13,
              fontWeight: strong || deduction
                  ? FontWeight.w700
                  : FontWeight.w600,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Shared shells ─────────────────────────────────────────────────────────

/// A numbered header — a gradient icon badge, caps title and a muted number
/// chip every section on the web panel opens with — over whatever that
/// section's own body is. Mirrors the same icon-badge language the billing
/// screens' own stay-details and itemised cards use, so the whole app reads
/// as one design rather than a different header style per screen.
class _Section extends StatelessWidget {
  final int number;
  final IconData icon;
  final String title;
  final Widget child;

  const _Section({
    required this.number,
    required this.icon,
    required this.title,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(
        AppTheme.s12,
        10,
        AppTheme.s12,
        AppTheme.s12,
      ),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium + 2),
        border: Border.all(color: AppTheme.border),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A16212E),
            blurRadius: 10,
            offset: Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 24,
                height: 24,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppTheme.sidebarBrandWash,
                  borderRadius: BorderRadius.circular(7),
                ),
                child: Icon(icon, size: 14, color: AppTheme.accent),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: Text(
                  title.toUpperCase(),
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.6,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
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
    return SizedBox(
      width: double.infinity,
      child: LayoutBuilder(
        builder: (context, c) {
          const gap = AppTheme.s12;
          final half = (c.maxWidth - gap) / 2;
          return Wrap(
            spacing: gap,
            runSpacing: 8,
            children: [
              for (final f in facts)
                SizedBox(width: f.wide ? c.maxWidth : half, child: f),
            ],
          );
        },
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  final String label;
  final String value;
  final String? note;

  /// Takes the whole row rather than sharing it — a long value like a list
  /// of extras would otherwise be squeezed into half the width.
  final bool wide;

  const _Fact({
    required this.label,
    required this.value,
    this.note,
    this.wide = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label.toUpperCase(),
          style: const TextStyle(
            color: AppTheme.muted,
            fontSize: 9.5,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.5,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: const TextStyle(
            color: AppTheme.heading,
            fontSize: 13,
            fontWeight: FontWeight.w600,
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

class _EmptyBox extends StatelessWidget {
  final String message;

  const _EmptyBox({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.s12,
        vertical: 10,
      ),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        message,
        style: const TextStyle(color: AppTheme.muted, fontSize: 13),
      ),
    );
  }
}
