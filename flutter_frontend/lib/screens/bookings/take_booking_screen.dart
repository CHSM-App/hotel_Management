import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/draft.dart';
import '../../domain/models/room.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/booking_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/payment_row.dart';
import '../../widgets/photo_source_sheet.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';
import 'advance_receipt_screen.dart';

/// Lets the desk take an ID proof photo with the camera or pull one from the
/// gallery — the same either-or the web form gets from its file input's own
/// camera affordance, offered explicitly here since a phone has both and no
/// single tap picks between them.
Future<XFile?> _pickIdProofPhoto(BuildContext context) async {
  final source = await showPhotoSourceSheet(
    context,
    title: 'Upload ID proof',
    subtitle: 'Take a photo or pick one from your gallery',
  );
  if (source == null) return null;
  return ImagePicker().pickImage(source: source, imageQuality: 85, maxWidth: 1600);
}

/// Taking a booking, in the order the desk actually does it: which nights,
/// which room, what it costs, who is staying, and what they paid.
///
/// One scrolling page rather than a wizard. The desk changes its mind halfway
/// through constantly — a different room, one more night, "call it 1,500" —
/// and a wizard makes going back a chore. Every later step simply stays shut
/// until the one before it is answered.
///
/// The same page also handles correcting a booking that already exists — an
/// edit is a booking whose questions have been answered once already, so it
/// asks them again pre-filled rather than being a form of its own. [editBooking]
/// is what tells the two apart.
class TakeBookingScreen extends ConsumerStatefulWidget {
  /// Where the tape chart was tapped, if it was — a click on a vacant tile
  /// starts the form already on that room and night, the same way the web
  /// tape chart's own click-to-book does.
  final int? presetRoomId;
  final DateTime? presetCheckIn;

  /// The stay this page is correcting, if it is correcting one at all.
  final Booking? editBooking;

  const TakeBookingScreen({
    super.key,
    this.presetRoomId,
    this.presetCheckIn,
    this.editBooking,
  });

  @override
  ConsumerState<TakeBookingScreen> createState() => _TakeBookingScreenState();
}

class _TakeBookingScreenState extends ConsumerState<TakeBookingScreen> {
  final _scrollController = ScrollController();

  // One key per required section, in the order the form asks them — so a
  // failed submit can jump straight to the first thing wrong instead of
  // leaving the desk to scroll around looking for a red line it may not
  // have noticed.
  final _datesKey = GlobalKey();
  final _roomKey = GlobalKey();
  final _nameKey = GlobalKey();
  final _phoneKey = GlobalKey();
  final _idProofKey = GlobalKey();
  final _advanceKey = GlobalKey();

  final _name = TextEditingController();
  final _phone = TextEditingController();
  String? _idProofType;
  final _idProofNumber = TextEditingController();

  /// A photo of the primary guest's document, taken or picked this session —
  /// never pre-filled on an edit, since a stay with one already on file has
  /// nothing here to re-send.
  XFile? _idProofFile;

  /// Everybody else in the room. The one named above is the booking's own
  /// guest; these are the rest of the party, each with their own ID, because a
  /// register that records one of four people is not a register.
  final List<GuestDraft> _guests = [];

  final List<VehicleDraft> _vehicles = [];

  /// How the advance arrived. Starts as one row, which is the ordinary case.
  /// Left untouched during an edit: an edit sets the record straight, it
  /// does not take money — that is what the advance-receipt screen is for.
  final List<PaymentDraft> _advance = [PaymentDraft()];

  /// One remount counter per row in [_advance], bumped only when that row's
  /// amount is set by [_recalcFullPayment] rather than typed — the signal
  /// [PaymentRow] needs (via its key) to pull the new amount into its own
  /// [TextEditingController], since a plain field mutation behind an
  /// already-built controller wouldn't otherwise show up.
  final List<int> _rowVersions = [0];

  /// Mirrors the web form's "Collect full payment now" checkbox: while on,
  /// the advance rows are kept summing to the stay total as it moves.
  bool _collectFull = false;
  num? _fullPaymentTotal;

  /// Re-derives the last advance row so every row sums to [total] — the same
  /// rule fullPaymentLines() applies on web. Earlier rows are left exactly as
  /// typed, so a split the desk already carved up survives a full payment
  /// being toggled on; only the remainder moves.
  void _recalcFullPayment(num total) {
    if (_advance.isEmpty) return;
    final last = _advance.length - 1;
    num others = 0;
    for (var i = 0; i < last; i++) {
      others += _advance[i].value;
    }
    final remainder = ((total - others) * 100).round() / 100;
    final amount = remainder > 0
        ? (remainder == remainder.roundToDouble()
              ? remainder.toStringAsFixed(0)
              : remainder.toString())
        : '0';
    if (_advance[last].amount != amount) {
      _advance[last].amount = amount;
      _rowVersions[last]++;
    }
  }

  bool get _editing => widget.editBooking != null;

  /// Whether Save has been pressed at least once — the same moment the web
  /// form's own `fieldErr()` starts showing anything. A field that has never
  /// been submitted has nothing to be wrong about yet; showing "Enter the
  /// guest's name." under an empty box the desk hasn't reached is a scold,
  /// not a help.
  bool _submitAttempted = false;

  String? get _nameError =>
      _submitAttempted && _name.text.trim().isEmpty
      ? 'Enter the guest name.'
      : null;

  String? get _phoneError {
    if (!_submitAttempted) return null;
    final phone = _phone.text.trim();
    if (phone.isEmpty) return 'Enter the mobile number.';
    if (phone.length != 10 || int.tryParse(phone) == null) {
      return 'A mobile number is 10 digits.';
    }
    return null;
  }

  String? get _datesError {
    if (!_submitAttempted) return null;
    final state = ref.read(bookingViewModelProvider);
    return state.datesChosen ? null : 'Choose the check-in and check-out dates.';
  }

  String? get _roomError {
    if (!_submitAttempted) return null;
    final state = ref.read(bookingViewModelProvider);
    if (!state.datesChosen) return null;
    return state.room == null ? 'Choose a room.' : null;
  }

  // Mirrors the web form's own client-side checks on the advance rows,
  // measured against the quote's payable total — otherwise the desk only
  // learns the advance was too big from the server's generic refusal.
  String? get _advanceError {
    if (!_submitAttempted) return null;
    final paid = _advance.where((l) => l.value > 0).toList();
    if (paid.isEmpty) return null;
    final problem = paymentLinesError(paid);
    if (problem != null) return problem;
    final quoteTotal = ref.read(bookingViewModelProvider).quote?.totalPrice;
    if (quoteTotal == null) return null;
    final total = sumPayments(paid);
    if (_collectFull) {
      if ((total - quoteTotal).abs() > 0.005) {
        return 'A full payment must equal the stay total of ${formatPrice(quoteTotal)}.';
      }
    } else if (total > quoteTotal) {
      return "An advance can't be more than the stay total of ${formatPrice(quoteTotal)}.";
    }
    return null;
  }

  String? get _idProofTypeError {
    if (!_submitAttempted || _editing) return null;
    final state = ref.read(bookingViewModelProvider);
    return (state.isWalkIn && _idProofType == null) ? 'Choose the ID type.' : null;
  }

  // Mirrors the web form: either the number or a photo of the document is
  // enough, and this is the one field in the pair that carries the message.
  String? get _idProofNumberError {
    if (!_submitAttempted || _editing) return null;
    final state = ref.read(bookingViewModelProvider);
    return (state.isWalkIn &&
            _idProofNumber.text.trim().isEmpty &&
            _idProofFile == null)
        ? 'Enter the ID number, or upload the document.'
        : null;
  }

  @override
  void initState() {
    super.initState();
    Future.microtask(_start);
  }

  /// A plain reset for the FAB; a preset room and night for a tape-chart tap;
  /// or, editing an existing stay, everything it was taken with.
  Future<void> _start() async {
    final vm = ref.read(bookingViewModelProvider.notifier);
    final edit = widget.editBooking;

    if (edit != null) {
      _name.text = edit.guestName ?? '';
      _phone.text = edit.guestPhone ?? '';
      _idProofType = edit.idProofType;
      _idProofNumber.text = edit.idProofNumber ?? '';
      _guests
        ..clear()
        ..addAll(
          edit.guests.map(
            (g) => GuestDraft(
              id: g.id,
              name: g.name,
              phone: g.phone ?? '',
              idProofType: g.idProofType,
              idProofNumber: g.idProofNumber ?? '',
              isChild: g.isChild,
            ),
          ),
        );
      _vehicles
        ..clear()
        ..addAll(edit.vehicles.map((v) => VehicleDraft(number: v.number, type: v.type)));
      await vm.startEdit(edit);
      return;
    }

    vm.reset();
    final now = DateTime.now();
    // Today and tomorrow, the same default the web form's own state opens
    // with — a fresh "New booking" is a walk-in for one night until the desk
    // says otherwise, not a blank pair of boxes waiting to be filled first.
    final checkIn = widget.presetCheckIn ?? DateTime(now.year, now.month, now.day);
    final roomId = widget.presetRoomId;

    await vm.setDates(checkIn, checkIn.add(const Duration(days: 1)));
    if (roomId == null || !mounted) return;

    final rooms = ref.read(bookingViewModelProvider).rooms?.valueOrNull;
    final match = rooms?.where((r) => r.id == roomId).firstOrNull;
    if (match != null) await vm.selectRoom(match);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _name.dispose();
    _phone.dispose();
    _idProofNumber.dispose();
    super.dispose();
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  /// Jumps the page to [key]'s section so a failed submit lands the desk on
  /// the very box that stopped it, rather than trusting them to spot a red
  /// line somewhere on the screen.
  void _scrollToError(GlobalKey key) {
    final context = key.currentContext;
    if (context == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Scrollable.ensureVisible(
        context,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
        alignment: 0.1,
      );
    });
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    final vm = ref.read(bookingViewModelProvider.notifier);

    // From here on every required field shows its own message under its own
    // box, the way the web form's fields do — a submit that stops silently
    // (or only says so in a snackbar the desk has to connect back to a box
    // themselves) is the thing this replaced.
    setState(() => _submitAttempted = true);
    // Checked in the order the form asks them, so the scroll lands on
    // whichever one the desk would hit first reading top to bottom.
    if (_datesError != null) {
      _scrollToError(_datesKey);
      return;
    }
    if (_roomError != null) {
      _scrollToError(_roomKey);
      return;
    }
    if (_nameError != null) {
      _scrollToError(_nameKey);
      return;
    }
    if (_phoneError != null) {
      _scrollToError(_phoneKey);
      return;
    }
    if (_idProofTypeError != null || _idProofNumberError != null) {
      _scrollToError(_idProofKey);
      return;
    }
    if (_advanceError != null) {
      _scrollToError(_advanceKey);
      return;
    }

    final phone = _phone.text.trim();

    for (final g in _guests) {
      if (g.isEmpty) return _say('Enter a name for each additional guest.');
    }

    for (final v in _vehicles) {
      if (v.isEmpty) continue;
      if (v.type == null) return _say('Choose a type for each vehicle.');
    }

    final Booking? booking;
    if (_editing) {
      booking = await vm.updateBooking(
        bookingId: widget.editBooking!.id,
        guestName: _name.text,
        guestPhone: phone,
        numGuests: 1 + _guests.length,
        idProofType: _idProofType,
        idProofNumber: _idProofNumber.text,
        idProofFile: _idProofFile,
        guests: _guests,
        vehicles: _vehicles,
      );
    } else {
      // Only rows with money on them count; an untouched row is not a
      // payment.
      final paid = _advance.where((l) => l.value > 0).toList();
      booking = await vm.submit(
        guestName: _name.text,
        guestPhone: phone,
        // The party is whoever was named, not a number typed separately and
        // then contradicted.
        numGuests: 1 + _guests.length,
        idProofType: _idProofType,
        idProofNumber: _idProofNumber.text,
        idProofFile: _idProofFile,
        guests: _guests,
        vehicles: _vehicles,
        advanceLines: paid,
      );
    }

    if (!mounted) return;
    if (booking == null) {
      return _say(ref.read(bookingViewModelProvider).error ?? 'Could not save.');
    }
    // The web form's own "Booking saved" card, offered on a fresh booking
    // only — an edit returns straight to the stay that was being corrected,
    // which already shows what the save produced.
    if (!_editing) {
      await _showBookingSaved(booking);
      return;
    }
    Navigator.of(context).pop(true);
  }

  void _say(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: AppTheme.heading),
    );
  }

  Future<void> _showBookingSaved(Booking booking) async {
    final action = await showDialog<String>(
      context: context,
      builder: (dialogContext) => _BookingSavedDialog(
        booking: booking,
        onPrintReceipt: () => Navigator.of(dialogContext).pop('print'),
        onDone: () => Navigator.of(dialogContext).pop('done'),
      ),
    );
    if (!mounted) return;
    if (action == 'print') {
      // Replaces this screen rather than stacking the receipt on top of it —
      // the booking is already saved and done with, so closing the receipt
      // should land back on the list, not on the form that made it.
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => AdvanceReceiptScreen(booking: booking)),
        result: true,
      );
    } else {
      Navigator.of(context).pop(true);
    }
  }

  /// The additional adults — everyone in [_guests] who is not a child. The
  /// primary guest (name/mobile/ID at the top of the form) is index 0 of the
  /// web page's own "adults" array and is not part of this list at all; it
  /// has its own fields already.
  List<int> get _adultIndexes => [
    for (var i = 0; i < _guests.length; i++)
      if (!_guests[i].isChild) i,
  ];

  List<int> get _childIndexes => [
    for (var i = 0; i < _guests.length; i++)
      if (_guests[i].isChild) i,
  ];

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(bookingViewModelProvider);
    // A full payment follows the total it was promised against: dates, the
    // room or an extra can move it after the checkbox is already on, and the
    // rows have to be rebuilt against whatever the total now is.
    final quoteTotal = state.quote?.totalPrice;
    if (_collectFull && quoteTotal != null && quoteTotal != _fullPaymentTotal) {
      _fullPaymentTotal = quoteTotal;
      _recalcFullPayment(quoteTotal);
    }
    final adults = _adultIndexes;
    final children = _childIndexes;
    final vehiclesNumber = _editing ? 3 : 4;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          _editing
              ? 'Edit booking · ${widget.editBooking!.roomNumber ?? ''}'
              : 'New booking',
        ),
      ),
      body: SafeArea(
        child: ListView(
          controller: _scrollController,
          padding: const EdgeInsets.fromLTRB(
            AppTheme.s16,
            AppTheme.s8,
            AppTheme.s16,
            AppTheme.s32,
          ),
          children: [
            // Not a choice the desk makes on an edit — the stay it is
            // correcting already exists, and asking again would be asking
            // about the past.
            if (!_editing) ...[
              _BookingTypeHeader(state: state),
              const SizedBox(height: AppTheme.s16),
            ],

            // Everything the desk fills in lives on one card — the numbered
            // steps used to be separate cards with headings; a section label
            // plus a hairline divider says the same thing in less height.
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SectionLabel('Stay & room', number: 1),
                  const SizedBox(height: AppTheme.s12),
                  KeyedSubtree(
                    key: _datesKey,
                    child: _DatesRow(state: state, required: true),
                  ),
                  if (_datesError != null) ...[
                    const SizedBox(height: AppTheme.s4),
                    Text(
                      _datesError!,
                      style: const TextStyle(color: AppTheme.danger, fontSize: 12),
                    ),
                  ],

                  if (state.datesChosen) ...[
                    const SizedBox(height: AppTheme.s16),
                    _RequiredLabel('Available rooms'),
                    const SizedBox(height: AppTheme.s8),
                    KeyedSubtree(key: _roomKey, child: _RoomPicker(state: state)),
                    if (_roomError != null) ...[
                      const SizedBox(height: AppTheme.s4),
                      Text(
                        _roomError!,
                        style: const TextStyle(color: AppTheme.danger, fontSize: 12),
                      ),
                    ],
                  ],

                  if (state.room != null) ...[
                    const SizedBox(height: AppTheme.s12),
                    _RoomChips(room: state.room!),

                    if (state.room!.switchableCharges.isNotEmpty) ...[
                      const SizedBox(height: AppTheme.s16),
                      const Text(
                        'EXTRAS',
                        style: TextStyle(
                          color: AppTheme.muted,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.4,
                        ),
                      ),
                      const SizedBox(height: AppTheme.s8),
                      _ExtrasCard(state: state),
                    ],

                    const SizedBox(height: AppTheme.s16),
                    _QuoteCard(state: state),

                    const _SectionDivider(),
                    _SectionLabel(
                      'Guest details',
                      number: 2,
                      trailing: '${1 + _guests.length} guest'
                          '${1 + _guests.length == 1 ? '' : 's'}',
                    ),
                    const SizedBox(height: AppTheme.s16),

                    _SectionLabel('Adults', trailing: '${1 + adults.length}'),
                    const SizedBox(height: AppTheme.s8),
                    NeuCard(
                      shadow: AppTheme.subtle,
                      child: Column(
                        children: [
                          KeyedSubtree(
                            key: _nameKey,
                            child: NeuField(
                              controller: _name,
                              label: 'Name (primary guest)',
                              required: true,
                              errorText: _nameError,
                              onChanged: (_) => setState(() {}),
                            ),
                          ),
                          const SizedBox(height: AppTheme.s12),
                          NeuField(
                            key: _phoneKey,
                            controller: _phone,
                            label: 'Mobile',
                            hint: '10-digit mobile',
                            keyboardType: TextInputType.phone,
                            maxLength: 10,
                            required: true,
                            errorText: _phoneError,
                            onChanged: (_) => setState(() {}),
                          ),
                          const SizedBox(height: AppTheme.s12),
                          KeyedSubtree(
                            key: _idProofKey,
                            child: _IdProofFields(
                              type: _idProofType,
                              number: _idProofNumber,
                              // Required on a walk-in, deferred on a
                              // reservation — and never forced open on an
                              // edit, where a stay that has one on file has
                              // nothing to require.
                              required: !_editing && state.isWalkIn,
                              errorText: _idProofTypeError,
                              numberErrorText: _idProofNumberError,
                              onType: (t) => setState(() => _idProofType = t),
                              file: _idProofFile,
                              onFile: (f) => setState(() => _idProofFile = f),
                            ),
                          ),
                        ],
                      ),
                    ),
                    for (final i in adults)
                      Padding(
                        padding: const EdgeInsets.only(top: AppTheme.s12),
                        child: _GuestCard(
                          guest: _guests[i],
                          index: i,
                          onRemove: () => setState(() => _guests.removeAt(i)),
                          onChanged: () => setState(() {}),
                        ),
                      ),
                    const SizedBox(height: AppTheme.s12),
                    NeuButton(
                      expand: true,
                      onPressed: () => setState(
                        () => _guests.add(GuestDraft(isChild: false)),
                      ),
                      padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                      child: const Text('+ Add adult'),
                    ),

                    const SizedBox(height: AppTheme.s16),
                    _SectionLabel(
                      'Children',
                      trailing: children.isEmpty ? null : '${children.length}',
                    ),
                    const SizedBox(height: AppTheme.s8),
                    for (final i in children)
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppTheme.s12),
                        child: _GuestCard(
                          guest: _guests[i],
                          index: i,
                          onRemove: () => setState(() => _guests.removeAt(i)),
                          onChanged: () => setState(() {}),
                        ),
                      ),
                    NeuButton(
                      expand: true,
                      onPressed: () => setState(
                        () => _guests.add(GuestDraft(isChild: true)),
                      ),
                      padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                      child: const Text('+ Add child'),
                    ),

                    if (!_editing && state.isWalkIn) ...[
                      const SizedBox(height: AppTheme.s12),
                      const Text(
                        'A walk-in is checked in as it saves, so the primary '
                        'guest needs an ID — an ID number or a photo of the '
                        'document is enough.',
                        style: TextStyle(color: AppTheme.muted, fontSize: 11),
                      ),
                    ],

                    // Advance first, then vehicles below it — one under the
                    // other rather than sharing a row, so neither is
                    // squeezed down to fit beside the other.
                    if (!_editing) ...[
                      const _SectionDivider(),
                      const _SectionLabel('Advance payment', number: 3),
                      const SizedBox(height: AppTheme.s8),
                      _FullPaymentCheckbox(
                        quoteTotal: state.quote?.totalPrice,
                        value: _collectFull,
                        onChanged: (on) => setState(() {
                          _collectFull = on;
                          final total = state.quote?.totalPrice;
                          if (on && total != null) {
                            _fullPaymentTotal = total;
                            _recalcFullPayment(total);
                          }
                        }),
                      ),
                      const SizedBox(height: AppTheme.s8),
                      KeyedSubtree(
                        key: _advanceKey,
                        child: _AdvanceCard(
                          lines: _advance,
                          rowVersions: _rowVersions,
                          errorText: _advanceError,
                          onAdd: () => setState(() {
                            _advance.add(PaymentDraft());
                            _rowVersions.add(0);
                          }),
                          onRemove: (i) => setState(() {
                            _advance.removeAt(i);
                            _rowVersions.removeAt(i);
                            if (_collectFull && _fullPaymentTotal != null) {
                              _recalcFullPayment(_fullPaymentTotal!);
                            }
                          }),
                          onChanged: () => setState(() {
                            if (_collectFull && _fullPaymentTotal != null) {
                              _recalcFullPayment(_fullPaymentTotal!);
                            }
                          }),
                        ),
                      ),
                    ],

                    const _SectionDivider(),
                    _SectionLabel(
                      'Vehicles',
                      number: vehiclesNumber,
                      trailing: _vehicles.isEmpty ? null : '${_vehicles.length}',
                    ),
                    const SizedBox(height: AppTheme.s8),
                    _VehicleList(
                      vehicles: _vehicles,
                      onAdd: () => setState(() => _vehicles.add(VehicleDraft())),
                      onRemove: (i) => setState(() => _vehicles.removeAt(i)),
                      onChanged: () => setState(() {}),
                    ),
                  ],
                ],
              ),
            ),

            const SizedBox(height: AppTheme.s24),
            Row(
              children: [
                Expanded(
                  child: NeuButton(
                    onPressed: state.submitting
                        ? null
                        : () => Navigator.of(context).pop(false),
                    child: const Text('Close'),
                  ),
                ),
                const SizedBox(width: AppTheme.s12),
                Expanded(
                  flex: 2,
                  child: NeuButton(
                    primary: true,
                    expand: true,
                    // Held shut while the request is in flight, and until
                    // there is a room to save against. The server holds a
                    // lock that stops two devices booking one room; nothing
                    // stops one device asking twice.
                    onPressed: (state.submitting || state.room == null)
                        ? null
                        : _submit,
                    child: state.submitting
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : Text(
                            _editing
                                ? 'Save changes'
                                : state.isWalkIn
                                ? 'Add and check in'
                                : 'Create reservation',
                          ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ── Section framing ─────────────────────────────────────────────────────────
//
// The form used to be a stack of separate cards, each with its own numbered
// heading. It is one card now, so a section only needs a small label — the
// divider between sections is what used to be the gap between cards.

class _SectionLabel extends StatelessWidget {
  final String title;
  final String? trailing;

  /// The circled step number — 1 Stay & room, 2 Guest details, 3 Advance
  /// payment, 4 Vehicles — the same numbering the web form's own section
  /// heads carry. Absent on a subheading inside one of those sections
  /// (Adults, Children), which are not steps of their own.
  final int? number;

  const _SectionLabel(this.title, {this.trailing, this.number});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        if (number != null) ...[
          Container(
            width: 18,
            height: 18,
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
        ],
        Expanded(
          child: Text(
            title.toUpperCase(),
            style: const TextStyle(
              color: AppTheme.muted,
              fontSize: 12,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.4,
            ),
          ),
        ),
        if (trailing != null)
          Text(trailing!, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

/// A plain field label with the same red asterisk a required [NeuField]
/// carries — for the fields (the room dropdown, the date boxes) that aren't
/// a [NeuField] themselves.
class _RequiredLabel extends StatelessWidget {
  final String label;

  const _RequiredLabel(this.label);

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        text: label,
        style: Theme.of(context).textTheme.bodySmall,
        children: const [
          TextSpan(
            text: ' *',
            style: TextStyle(color: AppTheme.danger, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

class _SectionDivider extends StatelessWidget {
  const _SectionDivider();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: AppTheme.s16),
      child: Divider(height: 1, color: AppTheme.border),
    );
  }
}

/// The web form's own "Booking saved" card — what to do next after a fresh
/// booking, right where the desk is already looking, instead of leaving them
/// to find the stay again from the list for the receipt a guest is waiting on.
class _BookingSavedDialog extends StatelessWidget {
  final Booking booking;
  final VoidCallback onPrintReceipt;
  final VoidCallback onDone;

  const _BookingSavedDialog({
    required this.booking,
    required this.onPrintReceipt,
    required this.onDone,
  });

  @override
  Widget build(BuildContext context) {
    final advance = booking.advanceAmount ?? 0;
    final paidInFull =
        booking.totalPrice != null && (booking.totalPrice! - advance).abs() < 0.01;

    return Dialog(
      backgroundColor: AppTheme.bg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.rLarge),
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.s24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: const BoxDecoration(
                color: AppTheme.accent,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.check, color: Colors.white, size: 28),
            ),
            const SizedBox(height: AppTheme.s16),
            Text('Booking saved', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: AppTheme.s8),
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: booking.guestName ?? 'Guest',
                    style: const TextStyle(fontWeight: FontWeight.w700, color: AppTheme.heading),
                  ),
                  TextSpan(
                    text: booking.roomNumber != null
                        ? ' is booked into room ${booking.roomNumber}.'
                        : ' is booked.',
                  ),
                ],
                style: const TextStyle(color: AppTheme.text, fontSize: 14),
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppTheme.s8),
            Text(
              advance > 0
                  ? '${paidInFull ? 'Full payment of' : 'Advance of'} '
                        '${formatPrice(advance)}'
                        '${booking.advancePaymentMethod != null ? ' by ${booking.advancePaymentMethod!.toLowerCase()}' : ''} '
                        'taken — its receipt has been issued automatically.'
                  : 'No advance was taken, so there is nothing to receipt yet.',
              style: const TextStyle(color: AppTheme.muted, fontSize: 12),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppTheme.s24),
            if (advance > 0) ...[
              NeuButton(
                primary: true,
                expand: true,
                onPressed: onPrintReceipt,
                child: const Text('Print advance receipt'),
              ),
              const SizedBox(height: AppTheme.s8),
            ],
            NeuButton(
              expand: true,
              onPressed: onDone,
              child: const Text('Done'),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Dates ───────────────────────────────────────────────────────────────────

/// Check-in and check-out as their own boxes, side by side — the same two
/// fields the web form's own "Stay & room" section opens with, rather than
/// one button that opens a range picker over both at once.
class _DatesRow extends ConsumerWidget {
  final BookingState state;
  final bool required;

  const _DatesRow({required this.state, this.required = false});

  Future<void> _pick(
    BuildContext context,
    WidgetRef ref, {
    required bool isCheckIn,
  }) async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final initial = isCheckIn
        ? (state.checkIn ?? today)
        : (state.checkOut ?? (state.checkIn ?? today).add(const Duration(days: 1)));

    final picked = await showDatePicker(
      context: context,
      // A stay taken on paper over the weekend has to be enterable against
      // the nights it actually happened on, so the past is open.
      firstDate: today.subtract(const Duration(days: 365)),
      lastDate: today.add(const Duration(days: 365)),
      initialDate: initial,
      helpText: isCheckIn ? 'Check-in' : 'Check-out',
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(
            primary: AppTheme.accent,
            onPrimary: Colors.white,
            surface: AppTheme.bg,
            onSurface: AppTheme.heading,
          ),
        ),
        child: child!,
      ),
    );
    if (picked == null) return;

    final vm = ref.read(bookingViewModelProvider.notifier);
    if (isCheckIn) {
      // A check-out on or before the new check-in is not a stay, so it moves
      // along with it rather than being left behind.
      final checkOut = (state.checkOut != null && state.checkOut!.isAfter(picked))
          ? state.checkOut!
          : picked.add(const Duration(days: 1));
      await vm.setDates(picked, checkOut);
    } else {
      final checkIn = state.checkIn ?? today;
      final checkOut = picked.isAfter(checkIn)
          ? picked
          : checkIn.add(const Duration(days: 1));
      await vm.setDates(checkIn, checkOut);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Row(
      children: [
        Expanded(
          child: _DateBox(
            label: 'Check-in',
            required: required,
            value: state.checkIn,
            onTap: () => _pick(context, ref, isCheckIn: true),
          ),
        ),
        const SizedBox(width: AppTheme.s12),
        Expanded(
          child: _DateBox(
            label: 'Check-out',
            required: required,
            value: state.checkOut,
            onTap: () => _pick(context, ref, isCheckIn: false),
          ),
        ),
      ],
    );
  }
}

class _DateBox extends StatelessWidget {
  final String label;
  final DateTime? value;
  final VoidCallback onTap;
  final bool required;

  const _DateBox({
    required this.label,
    required this.value,
    required this.onTap,
    this.required = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        required ? _RequiredLabel(label) : Text(label, style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: AppTheme.s4),
        GestureDetector(
          onTap: onTap,
          child: NeuPressed(
            padding: const EdgeInsets.symmetric(
              horizontal: AppTheme.s12,
              vertical: AppTheme.s4,
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.date_range_rounded,
                  color: AppTheme.accent,
                  size: 16,
                ),
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: Text(
                    value == null ? 'Choose' : formatDate(value),
                    style: TextStyle(
                      color: value == null ? AppTheme.muted : AppTheme.heading,
                      fontWeight: FontWeight.w600,
                      fontSize: 13.5,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

// ── What kind of stay this is ───────────────────────────────────────────────

/// Says whether this will check in now or wait, and why.
///
/// Not a choice. The dates decide it: a stay starting tonight is somebody at
/// the desk, and one starting later is a reservation. Offering a toggle would
/// let the desk pick "walk-in" for next Tuesday, which the server refuses to
/// check in — the web form spent a validation message on exactly that mistake,
/// and the way not to need the message is not to offer the mistake.
/// The Walk-in / Pre-reservation pill pair, and what whichever one is lit
/// means for this stay — the same pair the web form's own header carries,
/// and the same rule: Walk-in never shows for a check-in date later than
/// today, because a walk-in is checked in the moment it is saved.
class _BookingTypeHeader extends ConsumerWidget {
  final BookingState state;

  const _BookingTypeHeader({required this.state});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(bookingViewModelProvider.notifier);
    final walkIn = state.isWalkIn;
    final futureCheckIn = state.isFutureCheckIn;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            if (!futureCheckIn)
              _TogglePill(
                label: 'Walk-in',
                active: walkIn,
                onTap: () => vm.setBookingType('WALK_IN'),
              ),
            if (!futureCheckIn) const SizedBox(width: AppTheme.s8),
            _TogglePill(
              label: 'Pre-reservation',
              active: !walkIn,
              onTap: () => vm.setBookingType('RESERVATION'),
            ),
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        Text(
          futureCheckIn
              ? 'Walk-in isn’t available for a future check-in date — this '
                    'holds the room for a guest arriving later.'
              : walkIn
              ? 'Guest is here now — creates the booking and checks them in '
                    'immediately.'
              : 'Holds the room for a guest arriving later. ID proof can be '
                    'added at check-in.',
          style: const TextStyle(color: AppTheme.text, fontSize: 12),
        ),
      ],
    );
  }
}

class _TogglePill extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;

  const _TogglePill({required this.label, required this.active, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: active ? AppTheme.accent : AppTheme.card,
          border: Border.all(color: active ? AppTheme.accent : AppTheme.border),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: active ? Colors.white : AppTheme.text,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

// ── Rooms ───────────────────────────────────────────────────────────────────
//
// A dropdown rather than a tile per room: the tiles read fine at three or
// four rooms, but a property with a real inventory turned this section into
// most of the form's height. One row, open only while choosing, keeps the
// form the same size whether there are three rooms free or thirty.

class _RoomPicker extends ConsumerWidget {
  final BookingState state;

  const _RoomPicker({required this.state});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rooms = state.rooms;
    if (rooms == null) return const SizedBox.shrink();

    return rooms.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(AppTheme.s24),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (e, _) => NeuNotice(
        icon: Icons.cloud_off_rounded,
        message: BookingViewModel.messageFor(e),
        action: NeuButton(
          onPressed: () =>
              ref.read(bookingViewModelProvider.notifier).loadRooms(),
          child: const Text('Try again'),
        ),
      ),
      data: (list) {
        if (list.isEmpty) {
          return const NeuNotice(
            icon: Icons.bedroom_parent_outlined,
            message: 'Nothing is free across those nights.\n'
                'Try a different range.',
          );
        }
        return NeuPressed(
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<int>(
              value: state.room?.id,
              isExpanded: true,
              dropdownColor: AppTheme.card,
              hint: const Text(
                'Choose a room',
                style: TextStyle(color: AppTheme.muted, fontSize: 13.5),
              ),
              icon: const Icon(
                Icons.keyboard_arrow_down_rounded,
                color: AppTheme.muted,
              ),
              items: [
                for (final room in list)
                  DropdownMenuItem<int>(
                    value: room.id,
                    child: Text(
                      'Room ${room.roomNumber} · ${room.categoryName} · '
                      '${formatPrice(room.categoryBasePrice)}/night',
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppTheme.heading,
                        fontWeight: FontWeight.w600,
                        fontSize: 13.5,
                      ),
                    ),
                  ),
              ],
              onChanged: (id) {
                if (id == null) return;
                final room = list.firstWhere((r) => r.id == id);
                ref.read(bookingViewModelProvider.notifier).selectRoom(room);
              },
            ),
          ),
        );
      },
    );
  }
}

// ── What the picked room actually offers ────────────────────────────────────
//
// Room facts as chips rather than a label/value table — this is reference
// detail being skimmed, not data being entered, matching the web form's own
// row of chips under the room dropdown.

const _kBedSizeLabel = <String, String>{
  'SINGLE': 'Single',
  'DOUBLE': 'Double',
  'QUEEN': 'Queen',
  'KING': 'King',
};

const _kBathroomTypeLabel = <String, String>{
  'ATTACHED': 'Attached bathroom',
  'COMMON': 'Common bathroom',
};

class _RoomChips extends StatelessWidget {
  final Room room;

  const _RoomChips({required this.room});

  @override
  Widget build(BuildContext context) {
    final bedLabel = room.bedSize == null
        ? null
        : '1 ${_kBedSizeLabel[room.bedSize] ?? room.bedSize}';
    final bathroomLabel = room.bathroomType == null
        ? null
        : _kBathroomTypeLabel[room.bathroomType] ?? room.bathroomType;

    return Wrap(
      spacing: AppTheme.s8,
      runSpacing: AppTheme.s8,
      children: [
        _Chip(
          '${formatPrice(room.categoryBasePrice)}/night',
          accent: true,
        ),
        _Chip(room.categoryName),
        if (bedLabel != null) _Chip(bedLabel),
        if (bathroomLabel != null) _Chip(bathroomLabel),
        if (room.maxOccupancy != null) _Chip('Sleeps ${room.maxOccupancy}'),
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final bool accent;

  const _Chip(this.label, {this.accent = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: accent ? AppTheme.accent.withValues(alpha: 0.1) : AppTheme.bg,
        border: accent ? null : Border.all(color: AppTheme.border),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: accent ? AppTheme.accent : AppTheme.text,
          fontSize: 11.5,
          fontWeight: accent ? FontWeight.w700 : FontWeight.w500,
        ),
      ),
    );
  }
}

// ── Extras ──────────────────────────────────────────────────────────────────

class _ExtrasCard extends ConsumerWidget {
  final BookingState state;

  const _ExtrasCard({required this.state});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(bookingViewModelProvider.notifier);
    final charges = state.room!.switchableCharges;

    return NeuCard(
      child: Column(
        children: [
          for (final charge in charges) ...[
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        charge.name,
                        style: const TextStyle(
                          color: AppTheme.heading,
                          fontSize: 14,
                        ),
                      ),
                      Text(
                        '${formatPrice(charge.chargePerNight)}/night',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                if (charge.isCounter && state.extras.containsKey(charge.id))
                  _Stepper(
                    value: state.extras[charge.id]!.quantity,
                    onChanged: (v) => vm.setExtraQuantity(charge.id, v),
                  ),
                Checkbox(
                  value: state.extras.containsKey(charge.id),
                  activeColor: AppTheme.accent,
                  onChanged: (on) => vm.toggleExtra(charge.id, on ?? false),
                ),
              ],
            ),
            if (charge != charges.last) const Divider(height: AppTheme.s24),
          ],
        ],
      ),
    );
  }
}

class _Stepper extends StatelessWidget {
  final int value;
  final ValueChanged<int> onChanged;

  const _Stepper({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          icon: const Icon(Icons.remove_circle_outline, size: 20),
          color: AppTheme.muted,
          onPressed: () => onChanged(value - 1),
        ),
        Text(
          '$value',
          style: const TextStyle(
            color: AppTheme.heading,
            fontWeight: FontWeight.w500,
          ),
        ),
        IconButton(
          icon: const Icon(Icons.add_circle_outline, size: 20),
          color: AppTheme.accent,
          onPressed: () => onChanged(value + 1),
        ),
      ],
    );
  }
}

// ── What it costs ───────────────────────────────────────────────────────────

/// Every line the desk can move is a box.
///
/// Reception negotiates a total far more often than a rate — "call it 1,500 for
/// the two nights" — so the figure typed here is for the whole stay, and it is
/// divided by the nights on the way out. A season uplift stays read-only: it is
/// a percentage of the rate above it, so it follows on its own.
class _QuoteCard extends ConsumerWidget {
  final BookingState state;

  const _QuoteCard({required this.state});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final quote = state.quote;
    final vm = ref.read(bookingViewModelProvider.notifier);

    if (quote == null) {
      return NeuCard(
        child: Center(
          child: state.quoting
              ? const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text(
                  'Pick a room to see the price.',
                  style: TextStyle(color: AppTheme.muted),
                ),
        ),
      );
    }

    return NeuCard(
      child: Column(
        children: [
          // Said once, in words, above the boxes — the pencil inside each one
          // marks which figures are editable, but a pencil alone reads as
          // decoration on a touchscreen that never gets a hover to reveal it.
          const Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'Amounts in boxes can be changed — tap to edit',
              style: TextStyle(
                color: AppTheme.accent,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(height: AppTheme.s12),
          for (final line in quote.charges)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      line.label,
                      style: const TextStyle(
                        color: AppTheme.text,
                        fontSize: 13,
                      ),
                    ),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  if (line.isBase)
                    _AmountBox(
                      // Held as typed, not read back off the quote: the box
                      // would otherwise reformat itself mid-number on every
                      // refetch, which happens on each keystroke.
                      value: state.roomTotal,
                      shown: line.amount,
                      onChanged: vm.setRoomTotal,
                    )
                  else if (line.isExtra)
                    _AmountBox(
                      value: state.extras[line.chargeId!]?.agreedTotal ?? '',
                      shown: line.amount,
                      onChanged: (v) => vm.setExtraTotal(line.chargeId!, v),
                    )
                  else
                    Text(
                      formatPrice(line.amount),
                      style: const TextStyle(
                        color: AppTheme.text,
                        fontSize: 13,
                      ),
                    ),
                ],
              ),
            ),
          // Hidden on a new booking, matching the web form's own state —
          // the plumbing still exists so a stay that already carries a
          // discount from before still opens, prices and saves correctly on
          // an edit; a new booking simply never sets one.
          if (state.editBookingId != null) ...[
            const Divider(height: AppTheme.s16),
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Concession',
                    style: TextStyle(color: AppTheme.text, fontSize: 13),
                  ),
                ),
                const SizedBox(width: AppTheme.s8),
                _AmountBox(
                  value: state.discount,
                  shown: quote.discountAmount,
                  onChanged: vm.setDiscount,
                ),
              ],
            ),
          ],
          const Divider(height: AppTheme.s16),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Stay total · ${nightsLabel(quote.nightCount)}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              if (state.quoting)
                const SizedBox(
                  height: 14,
                  width: 14,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                Text(
                  formatPrice(quote.totalPrice),
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontSize: 18,
                    fontWeight: FontWeight.w500,
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppTheme.s4),
          const Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'Every figure is the server’s. GST is worked out on the bill, '
              'night by night, when it is issued.',
              style: TextStyle(color: AppTheme.muted, fontSize: 11),
            ),
          ),
        ],
      ),
    );
  }
}

/// A money box on a quote line.
///
/// Shows what the server priced until somebody types, then shows what they
/// typed. Selecting on focus because the box always holds a figure already and
/// the desk is replacing it, never appending.
class _AmountBox extends StatefulWidget {
  final String value;
  final num shown;
  final ValueChanged<String> onChanged;

  const _AmountBox({
    required this.value,
    required this.shown,
    required this.onChanged,
  });

  @override
  State<_AmountBox> createState() => _AmountBoxState();
}

class _AmountBoxState extends State<_AmountBox> {
  late final TextEditingController _c = TextEditingController(
    text: widget.value.isEmpty ? '${widget.shown}' : widget.value,
  );

  @override
  void didUpdateWidget(_AmountBox old) {
    super.didUpdateWidget(old);
    // Only follow the server while the desk has not overridden this line —
    // otherwise a refetch would overwrite what is being typed.
    if (widget.value.isEmpty && old.shown != widget.shown) {
      _c.text = '${widget.shown}';
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 112,
      child: Container(
        padding: const EdgeInsets.only(left: AppTheme.s12, right: AppTheme.s4),
        decoration: BoxDecoration(
          color: AppTheme.accent.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          border: Border.all(color: AppTheme.accent.withValues(alpha: 0.35)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Expanded(
              child: TextField(
                controller: _c,
                keyboardType: TextInputType.number,
                textAlign: TextAlign.right,
                onTap: () => _c.selection = TextSelection(
                  baseOffset: 0,
                  extentOffset: _c.text.length,
                ),
                onChanged: widget.onChanged,
                style: const TextStyle(color: AppTheme.heading, fontSize: 13),
                decoration: const InputDecoration(
                  border: InputBorder.none,
                  isDense: true,
                  contentPadding: EdgeInsets.symmetric(vertical: 10),
                ),
              ),
            ),
            const Icon(Icons.edit_rounded, size: 13, color: AppTheme.accent),
          ],
        ),
      ),
    );
  }
}

// ── ID proof ────────────────────────────────────────────────────────────────

class _IdProofFields extends StatelessWidget {
  final String? type;
  final TextEditingController number;
  final ValueChanged<String?> onType;

  /// Only the additional guests need this: their number lives on a draft
  /// object rather than being read off a controller at submit time.
  final ValueChanged<String>? onNumber;

  /// True on a walk-in, where the guest is at the desk and the ID is taken now.
  final bool required;

  /// Shown under the dropdown once a submit was tried and no type was
  /// chosen — the web form marks the type itself required (not the number:
  /// either the number or a document is enough), so this is the one field
  /// in the pair that carries a message.
  final String? errorText;

  /// Shown under the ID number box itself, once a submit was tried and a
  /// walk-in was left without one — the same place every other required
  /// field's message lands, rather than a snackbar the desk has to connect
  /// back to the box themselves.
  final String? numberErrorText;

  /// A photo of the document, taken or picked this session. Either this or
  /// [number] is enough — the same "one is enough, both is better" rule the
  /// web form's own pair of fields carries.
  final XFile? file;
  final ValueChanged<XFile?>? onFile;

  const _IdProofFields({
    required this.type,
    required this.number,
    required this.onType,
    this.onNumber,
    this.required = false,
    this.errorText,
    this.numberErrorText,
    this.file,
    this.onFile,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        required
            ? const _RequiredLabel('ID proof')
            : Text('ID proof', style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: AppTheme.s8),
        NeuPressed(
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String?>(
              value: type,
              isExpanded: true,
              dropdownColor: AppTheme.bg,
              hint: Text(
                required ? 'Choose one' : 'Not recorded',
                style: const TextStyle(color: AppTheme.muted, fontSize: 14),
              ),
              items: [
                // "Not recorded" is not on offer where an ID is required —
                // a walk-in has to carry one.
                if (!required)
                  const DropdownMenuItem<String?>(child: Text('Not recorded')),
                for (final e in kIdProofTypes.entries)
                  DropdownMenuItem<String?>(value: e.key, child: Text(e.value)),
              ],
              onChanged: onType,
            ),
          ),
        ),
        if (errorText != null) ...[
          const SizedBox(height: AppTheme.s4),
          Text(
            errorText!,
            style: const TextStyle(color: AppTheme.danger, fontSize: 12),
          ),
        ],
        if (type != null) ...[
          const SizedBox(height: AppTheme.s12),
          NeuField(
            controller: number,
            label: 'ID number',
            required: required,
            errorText: numberErrorText,
            maxLength: 40,
            onChanged: onNumber,
          ),
          if (!required && numberErrorText == null) ...[
            const SizedBox(height: AppTheme.s4),
            const Text(
              'Not required',
              style: TextStyle(color: AppTheme.muted, fontSize: 12),
            ),
          ],
          if (onFile != null) ...[
            const SizedBox(height: AppTheme.s12),
            Text(
              'Document photo (optional)',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: AppTheme.s8),
            if (file != null)
              PhotoThumb(
                imageProvider: FileImage(File(file!.path)),
                onRemove: () => onFile!(null),
              )
            else
              AddPhotoTile(
                onTap: () async {
                  final picked = await _pickIdProofPhoto(context);
                  if (picked != null) onFile!(picked);
                },
              ),
          ],
        ],
      ],
    );
  }
}

// ── The rest of the party ───────────────────────────────────────────────────

class _GuestCard extends StatefulWidget {
  final GuestDraft guest;
  final int index;
  final VoidCallback onRemove;
  final VoidCallback onChanged;

  const _GuestCard({
    required this.guest,
    required this.index,
    required this.onRemove,
    required this.onChanged,
  });

  @override
  State<_GuestCard> createState() => _GuestCardState();
}

class _GuestCardState extends State<_GuestCard> {
  late final _name = TextEditingController(text: widget.guest.name);
  late final _phone = TextEditingController(text: widget.guest.phone);
  late final _number = TextEditingController(text: widget.guest.idProofNumber);

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _number.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      shadow: AppTheme.subtle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          IconButton(
            icon: const Icon(Icons.delete_outline, size: 20),
            color: AppTheme.danger,
            onPressed: widget.onRemove,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
            visualDensity: VisualDensity.compact,
          ),
          const SizedBox(height: AppTheme.s4),
          NeuField(
            controller: _name,
            label: 'Name',
            onChanged: (v) => widget.guest.name = v,
          ),
          const SizedBox(height: AppTheme.s12),
          NeuField(
            controller: _phone,
            label: 'Mobile (optional)',
            hint: '10-digit mobile',
            keyboardType: TextInputType.phone,
            maxLength: 10,
            onChanged: (v) => widget.guest.phone = v,
          ),
          const SizedBox(height: AppTheme.s12),
          _IdProofFields(
            type: widget.guest.idProofType,
            number: _number,
            onType: (t) {
              setState(() => widget.guest.idProofType = t);
              widget.onChanged();
            },
            // Straight onto the draft as it is typed. This used to be a
            // listener registered inside build(), which re-registered on every
            // rebuild and was never removed.
            onNumber: (v) => widget.guest.idProofNumber = v,
            file: widget.guest.idProofFile,
            onFile: (f) {
              setState(() => widget.guest.idProofFile = f);
              widget.onChanged();
            },
          ),
        ],
      ),
    );
  }
}

// ── Vehicles, on an edit only ────────────────────────────────────────────────

class _VehicleList extends StatelessWidget {
  final List<VehicleDraft> vehicles;
  final VoidCallback onAdd;
  final ValueChanged<int> onRemove;
  final VoidCallback onChanged;

  const _VehicleList({
    required this.vehicles,
    required this.onAdd,
    required this.onRemove,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < vehicles.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s12),
            child: _VehicleCard(
              vehicle: vehicles[i],
              onRemove: () => onRemove(i),
              onChanged: onChanged,
            ),
          ),
        NeuButton(
          expand: true,
          onPressed: onAdd,
          padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
          child: const Text('+ Add a vehicle'),
        ),
      ],
    );
  }
}

class _VehicleCard extends StatefulWidget {
  final VehicleDraft vehicle;
  final VoidCallback onRemove;
  final VoidCallback onChanged;

  const _VehicleCard({
    required this.vehicle,
    required this.onRemove,
    required this.onChanged,
  });

  @override
  State<_VehicleCard> createState() => _VehicleCardState();
}

class _VehicleCardState extends State<_VehicleCard> {
  late final _number = TextEditingController(text: widget.vehicle.number);

  @override
  void dispose() {
    _number.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      shadow: AppTheme.subtle,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                NeuField(
                  controller: _number,
                  label: 'Number',
                  onChanged: (v) => widget.vehicle.number = v,
                ),
                const SizedBox(height: AppTheme.s12),
                NeuPressed(
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String?>(
                      value: widget.vehicle.type,
                      isExpanded: true,
                      dropdownColor: AppTheme.bg,
                      hint: const Text(
                        'Type',
                        style: TextStyle(color: AppTheme.muted, fontSize: 14),
                      ),
                      items: [
                        for (final e in kVehicleTypes.entries)
                          DropdownMenuItem<String?>(value: e.key, child: Text(e.value)),
                      ],
                      onChanged: (t) {
                        setState(() => widget.vehicle.type = t);
                        widget.onChanged();
                      },
                    ),
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline, size: 20),
            color: AppTheme.danger,
            onPressed: widget.onRemove,
          ),
        ],
      ),
    );
  }
}

// ── Collect it all now ──────────────────────────────────────────────────────

/// The same "Collect full payment now" chip the web form shows above its
/// advance rows — checking it takes the whole stay total as the advance
/// instead of a partial deposit. Disabled until there's a quote to promise
/// against, the same as web.
class _FullPaymentCheckbox extends StatelessWidget {
  final num? quoteTotal;
  final bool value;
  final ValueChanged<bool> onChanged;

  const _FullPaymentCheckbox({
    required this.quoteTotal,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = quoteTotal != null;
    return InkWell(
      onTap: enabled ? () => onChanged(!value) : null,
      borderRadius: BorderRadius.circular(AppTheme.rSmall),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.s12,
          vertical: 10,
        ),
        decoration: BoxDecoration(
          color: AppTheme.bg,
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          border: Border.all(color: AppTheme.border),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 20,
              height: 20,
              child: Checkbox(
                value: value,
                onChanged: enabled ? (v) => onChanged(v ?? false) : null,
                activeColor: AppTheme.accent,
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
            const SizedBox(width: AppTheme.s12),
            Expanded(
              child: RichText(
                text: TextSpan(
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                  children: [
                    const TextSpan(text: 'Collect full payment now'),
                    TextSpan(
                      text: enabled
                          ? ' · ${formatPrice(quoteTotal!)}'
                          : ' · choose a room and dates first',
                      style: const TextStyle(
                        color: AppTheme.muted,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── The advance ─────────────────────────────────────────────────────────────

/// One row per way the money came in.
///
/// One row is the ordinary case and is all the desk ever sees until it needs
/// more. "+ Add another payment" is what turns a deposit into a split — part
/// cash, part UPI is the normal shape of one, and recording a single method
/// files the other half under a method it never used.
class _AdvanceCard extends StatelessWidget {
  final List<PaymentDraft> lines;
  final List<int> rowVersions;
  final VoidCallback onAdd;
  final ValueChanged<int> onRemove;
  final VoidCallback onChanged;
  final String? errorText;

  const _AdvanceCard({
    required this.lines,
    required this.rowVersions,
    required this.onAdd,
    required this.onRemove,
    required this.onChanged,
    this.errorText,
  });

  @override
  Widget build(BuildContext context) {
    final total = sumPayments(lines.where((l) => l.value > 0).toList());

    return NeuCard(
      child: Column(
        children: [
          for (var i = 0; i < lines.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s12),
              child: PaymentRow(
                // A "collect full payment" recalc mutates a row's amount
                // behind an already-built TextEditingController, which
                // wouldn't otherwise pick it up — bumping the key remounts
                // just that row so its field re-reads the new amount.
                key: ValueKey('advance-$i-${rowVersions[i]}'),
                line: lines[i],
                // Nothing to remove down to on a single payment, so the bin is
                // dead there rather than gone — the row would jump sideways.
                onRemove: lines.length == 1 ? null : () => onRemove(i),
                onChanged: onChanged,
              ),
            ),
          if (errorText != null)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s12),
              child: Text(
                errorText!,
                style: const TextStyle(color: AppTheme.danger, fontSize: 12),
              ),
            ),
          if (lines.length < 5)
            NeuButton(
              expand: true,
              onPressed: onAdd,
              padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
              child: const Text('+ Add another payment'),
            ),
          if (total > 0) ...[
            const Divider(height: AppTheme.s24),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Advance taken',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                Text(
                  formatPrice(total),
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

