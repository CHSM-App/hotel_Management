import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../domain/models/booking.dart';
import '../../domain/models/draft.dart';
import '../../widgets/format.dart';
import '../../widgets/id_proof_fields.dart';
import '../../widgets/neu.dart';
import '../../widgets/payment_row.dart';
import '../theme.dart';
import 'booking_actions.dart';
import 'check_in_room_status.dart';

/// What reception settled at the door.
class CheckInResult {
  final String? idProofType;
  final String? idProofNumber;
  final XFile? idProofFile;
  final List<PaymentDraft> advanceLines;
  final List<GuestDraft> guests;
  final List<VehicleDraft> vehicles;

  const CheckInResult({
    this.idProofType,
    this.idProofNumber,
    this.idProofFile,
    this.advanceLines = const [],
    this.guests = const [],
    this.vehicles = const [],
  });
}

/// Check a reservation in.
///
/// Returns null if reception backed out. A full page of its own — not a
/// dialog or a bottom sheet — laid out exactly as the web register's own
/// check-in form reads top to bottom: the room's own housekeeping state, the
/// ID proof the reservation arrived without (if any), anything taken at the
/// door on top of the deposit, anyone who showed up but wasn't named on the
/// booking, and their vehicles. Everything past room status is optional — a
/// reservation taken on this app already carries an ID and often the whole
/// advance, so the common case is opening this and confirming.
Future<CheckInResult?> showCheckInSheet(
  BuildContext context,
  Booking booking,
) {
  return Navigator.of(context).push<CheckInResult>(
    MaterialPageRoute(builder: (_) => _CheckInPage(booking: booking)),
  );
}

class _CheckInPage extends StatefulWidget {
  final Booking booking;

  const _CheckInPage({required this.booking});

  @override
  State<_CheckInPage> createState() => _CheckInPageState();
}

class _CheckInPageState extends State<_CheckInPage> {
  final _idNumber = TextEditingController();
  String? _idType;
  XFile? _idFile;

  /// Starts empty. A reservation usually paid its deposit when it was taken,
  /// so an advance row offered by default would invite a second one to be
  /// entered on top of what is already against the stay.
  final List<PaymentDraft> _lines = [];
  final List<GuestDraft> _guests = [];
  final List<VehicleDraft> _vehicles = [];

  /// Whether Confirm check-in has been pressed at least once — the ID proof
  /// fields only show as wrong after that, the same way the web form only
  /// marks them once a submit was tried.
  bool _triedSubmit = false;

  @override
  void dispose() {
    _idNumber.dispose();
    super.dispose();
  }

  /// Wasn't collected when this reservation was taken — required before
  /// check-in. Mirrors the web's own `needsIdProofAtCheckIn`.
  bool get _needsIdProof => widget.booking.idProofType == null;

  num get _extra => sumPayments(_lines);

  /// What is still owed once anything taken at the door is counted.
  num get _remaining {
    final due = widget.booking.balanceDue - _extra;
    return due < 0 ? 0 : due;
  }

  String? get _paymentProblem =>
      _lines.isEmpty ? null : paymentLinesError(_lines);

  int get _partySize => 1 + widget.booking.guests.length + _guests.length;

  String? get _idTypeError =>
      _triedSubmit && _needsIdProof && _idType == null
      ? 'Choose the ID proof type.'
      : null;

  String? get _idNumberError {
    if (!_triedSubmit || !_needsIdProof) return null;
    if (_idFile != null || _idNumber.text.trim().isNotEmpty) return null;
    return 'Upload the ID, or enter the number.';
  }

  bool get _hasEmptyGuestName => _guests.any((g) => g.name.trim().isEmpty);

  @override
  Widget build(BuildContext context) {
    final b = widget.booking;
    final statusColor = BookingActions.statusColor(b.status);

    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        title: Text(
          (b.guestName ?? '').trim().isEmpty
                                ? 'Guest'
                                : b.guestName!,
          overflow: TextOverflow.ellipsis,
          maxLines: 1,
        ),
        actions: [
                  Container(
                    margin: const EdgeInsets.only(right: AppTheme.s12),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: statusColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      BookingActions.statusLabel(b.status),
                      style: TextStyle(
                        color: statusColor,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(
            AppTheme.s8,
            AppTheme.s12,
            AppTheme.s8,
            AppTheme.s16,
          ),
          child: Column(
            children: [
              NeuCard(
                radius: AppTheme.rLarge,
                shadow: AppTheme.elevated,
                padding: const EdgeInsets.all(AppTheme.s12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                      CheckInRoomStatus(
                        rooms: [
                          CheckInRoomStatusEntry(
                            roomId: b.roomId ?? 0,
                            roomNumber: b.roomNumber,
                          ),
                        ],
                      ),

                      // ── Guest ID proof ───────────────────────────────────
                      if (_needsIdProof) ...[
                        const _CISectionDivider(),
                        const _CISectionLabel(
                          'Guest ID proof',
                          icon: Icons.badge_rounded,
                        ),
                        const SizedBox(height: AppTheme.s4),
                        Text(
                          "Wasn't collected when this room was reserved — "
                          'required before check-in. Choose a type, then '
                          'give either the number or the document.',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        const SizedBox(height: AppTheme.s12),
                        IdProofFields(
                          type: _idType,
                          number: _idNumber,
                          required: true,
                          errorText: _idTypeError,
                          numberErrorText: _idNumberError,
                          onType: (t) => setState(() => _idType = t),
                          onNumber: (_) => setState(() {}),
                          file: _idFile,
                          onFile: (f) => setState(() => _idFile = f),
                        ),
                      ],

                      // ── Advance payment ──────────────────────────────────
                      const _CISectionDivider(),
                      _CISectionLabel(
                        'Advance payment (optional)',
                        icon: Icons.payments_rounded,
                        trailing: _extra > 0 ? formatPrice(_extra) : null,
                      ),
                      const SizedBox(height: AppTheme.s4),
                      Text(
                        'Stay total: ${formatPrice(b.totalPrice)}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: AppTheme.s12),
                      for (var i = 0; i < _lines.length; i++)
                        Padding(
                          padding: const EdgeInsets.only(
                            bottom: AppTheme.s12,
                          ),
                          child: PaymentRow(
                            key: ValueKey(_lines[i]),
                            line: _lines[i],
                            onRemove: () =>
                                setState(() => _lines.removeAt(i)),
                            onChanged: () => setState(() {}),
                          ),
                        ),
                      NeuButton(
                        expand: true,
                        onPressed: () =>
                            setState(() => _lines.add(PaymentDraft())),
                        soft: true,
                        minHeight: 34,
                        padding: const EdgeInsets.symmetric(
                          vertical: AppTheme.s4,
                        ),
                        child: Text(
                          _lines.isEmpty
                              ? 'Add a payment'
                              : 'Add another payment',
                        ),
                      ),
                      if (_paymentProblem != null) ...[
                        const SizedBox(height: AppTheme.s8),
                        Text(
                          _paymentProblem!,
                          style: const TextStyle(
                            color: AppTheme.danger,
                            fontSize: 12,
                          ),
                        ),
                      ],

                      // ── Guest details ─────────────────────────────────────
                      const _CISectionDivider(),
                      _CISectionLabel(
                        'Add guest details (optional)',
                        icon: Icons.groups_rounded,
                        trailing:
                            '$_partySize guest${_partySize == 1 ? '' : 's'}',
                      ),
                      const SizedBox(height: AppTheme.s4),
                      Text(
                        "For anyone who arrived with the guest but wasn't "
                        "named when the room was booked. The booking's "
                        'guest count is raised to match.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      if (b.numGuests != null && b.numGuests != _partySize)
                        Padding(
                          padding: const EdgeInsets.only(top: AppTheme.s4),
                          child: Text(
                            'Booked for ${b.numGuests}.',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                      const SizedBox(height: AppTheme.s12),
                      for (var i = 0; i < _guests.length; i++)
                        Padding(
                          padding: const EdgeInsets.only(
                            bottom: AppTheme.s12,
                          ),
                          child: _CheckInGuestCard(
                            guest: _guests[i],
                            onRemove: () =>
                                setState(() => _guests.removeAt(i)),
                            onChanged: () => setState(() {}),
                          ),
                        ),
                      NeuButton(
                        expand: true,
                        soft: true,
                        minHeight: 34,
                        padding: const EdgeInsets.symmetric(
                          vertical: AppTheme.s4,
                        ),
                        onPressed: () =>
                            setState(() => _guests.add(GuestDraft())),
                        child: const Text('+ Add guest'),
                      ),

                      // ── Vehicles ──────────────────────────────────────────
                      const _CISectionDivider(),
                      _CISectionLabel(
                        'Add vehicles (optional)',
                        icon: Icons.directions_car_rounded,
                        trailing: _vehicles.isEmpty
                            ? null
                            : '${_vehicles.length}',
                      ),
                      const SizedBox(height: AppTheme.s12),
                      for (var i = 0; i < _vehicles.length; i++)
                        Padding(
                          padding: const EdgeInsets.only(
                            bottom: AppTheme.s12,
                          ),
                          child: _CheckInVehicleCard(
                            vehicle: _vehicles[i],
                            onRemove: () =>
                                setState(() => _vehicles.removeAt(i)),
                            onChanged: () => setState(() {}),
                          ),
                        ),
                      NeuButton(
                        expand: true,
                        soft: true,
                        minHeight: 34,
                        padding: const EdgeInsets.symmetric(
                          vertical: AppTheme.s4,
                        ),
                        onPressed: () =>
                            setState(() => _vehicles.add(VehicleDraft())),
                        child: const Text('+ Add vehicle'),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: AppTheme.s16),

                // ── Still to pay + Back / Confirm check-in ──────────────────
                NeuCard(
                  radius: AppTheme.rLarge,
                  shadow: AppTheme.subtle,
                  padding: const EdgeInsets.all(AppTheme.s16),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Still to pay',
                              style: Theme.of(context).textTheme.bodyMedium,
                            ),
                          ),
                          Text(
                            formatPrice(_remaining),
                            style: Theme.of(context).textTheme.titleMedium
                                ?.copyWith(
                                  color: AppTheme.heading,
                                  fontWeight: FontWeight.w800,
                                ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppTheme.s12),
                      Row(
                        children: [
                          Expanded(
                            child: NeuButton(
                              onPressed: () => Navigator.pop(context),
                              child: const Text('Back'),
                            ),
                          ),
                          const SizedBox(width: AppTheme.s12),
                          Expanded(
                            flex: 2,
                            child: NeuButton(
                              primary: true,
                              onPressed: _submit,
                              child: const Text('Confirm check-in'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      );
  }

  void _submit() {
    setState(() => _triedSubmit = true);
    if (_paymentProblem != null) return;
    if (_needsIdProof &&
        (_idType == null ||
            (_idFile == null && _idNumber.text.trim().isEmpty))) {
      return;
    }
    if (_hasEmptyGuestName) return;

    Navigator.pop(
      context,
      CheckInResult(
        idProofType: _idType,
        idProofNumber: _idNumber.text,
        idProofFile: _idFile,
        // Only the rows that carry money. An empty row left open by a mistaken
        // tap is not a payment of zero.
        advanceLines: _lines.where((l) => l.value > 0).toList(),
        guests: _guests.where((g) => !g.isEmpty).toList(),
        vehicles: _vehicles.where((v) => !v.isEmpty).toList(),
      ),
    );
  }
}

/// A section head matching the booking form's own gradient-badged labels —
/// an icon in a circle, the title, and an optional count pill trailing it.
class _CISectionLabel extends StatelessWidget {
  final String title;
  final IconData icon;
  final String? trailing;

  const _CISectionLabel(this.title, {required this.icon, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 26,
          height: 26,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [AppTheme.accent, Color(0xFF10499A)],
            ),
            shape: BoxShape.circle,
            boxShadow: const [
              BoxShadow(
                color: Color(0x2A1457AD),
                offset: Offset(0, 2),
                blurRadius: 5,
              ),
            ],
          ),
          child: Icon(icon, color: Colors.white, size: 14),
        ),
        const SizedBox(width: AppTheme.s12),
        Expanded(
          child: Text(
            title.toUpperCase(),
            style: const TextStyle(
              color: AppTheme.heading,
              fontSize: 13.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
            ),
          ),
        ),
        if (trailing != null)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppTheme.accent.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              trailing!,
              style: const TextStyle(
                color: AppTheme.accent,
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
      ],
    );
  }
}

/// A hairline fade, the same gradient-to-transparent rule the booking form's
/// own section breaks use, so the two forms read as one visual family.
class _CISectionDivider extends StatelessWidget {
  const _CISectionDivider();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: AppTheme.s12),
      child: SizedBox(
        height: 1.4,
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [AppTheme.border, Colors.transparent],
            ),
          ),
        ),
      ),
    );
  }
}

/// One additional guest, added at check-in — name, type, phone, and the same
/// ID proof trio every guest row in the app offers.
class _CheckInGuestCard extends StatefulWidget {
  final GuestDraft guest;
  final VoidCallback onRemove;
  final VoidCallback onChanged;

  const _CheckInGuestCard({
    required this.guest,
    required this.onRemove,
    required this.onChanged,
  });

  @override
  State<_CheckInGuestCard> createState() => _CheckInGuestCardState();
}

class _CheckInGuestCardState extends State<_CheckInGuestCard> {
  late final _name = TextEditingController(text: widget.guest.name);
  late final _phone = TextEditingController(text: widget.guest.phone);
  late final _number = TextEditingController(
    text: widget.guest.idProofNumber,
  );

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
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          NeuField(
            controller: _name,
            label: 'Name',
            required: true,
            onChanged: (v) => widget.guest.name = v,
            forceCapitalizeWords: true,
            dense: true,
            labelAction: SizedBox(
              height: 20,
              width: 20,
              child: IconButton(
                icon: const Icon(Icons.delete_outline, size: 18),
                color: AppTheme.danger,
                onPressed: widget.onRemove,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ),
          ),
          const SizedBox(height: AppTheme.s8),
          Row(
            children: [
              const Text('Type', style: TextStyle(fontSize: 13)),
              const Spacer(),
              ChoiceChip(
                label: const Text('Adult'),
                selected: !widget.guest.isChild,
                onSelected: (_) {
                  setState(() => widget.guest.isChild = false);
                  widget.onChanged();
                },
              ),
              const SizedBox(width: AppTheme.s8),
              ChoiceChip(
                label: const Text('Child'),
                selected: widget.guest.isChild,
                onSelected: (_) {
                  setState(() => widget.guest.isChild = true);
                  widget.onChanged();
                },
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          NeuField(
            controller: _phone,
            label: 'Mobile (optional)',
            hint: '10-digit mobile',
            keyboardType: TextInputType.phone,
            maxLength: 10,
            onChanged: (v) => widget.guest.phone = v,
            dense: true,
          ),
          const SizedBox(height: AppTheme.s8),
          IdProofFields(
            type: widget.guest.idProofType,
            number: _number,
            onType: (t) {
              setState(() => widget.guest.idProofType = t);
              widget.onChanged();
            },
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

/// One vehicle parked against the stay — number and type, mirroring the
/// edit-booking form's own vehicle card.
class _CheckInVehicleCard extends StatefulWidget {
  final VehicleDraft vehicle;
  final VoidCallback onRemove;
  final VoidCallback onChanged;

  const _CheckInVehicleCard({
    required this.vehicle,
    required this.onRemove,
    required this.onChanged,
  });

  @override
  State<_CheckInVehicleCard> createState() => _CheckInVehicleCardState();
}

class _CheckInVehicleCardState extends State<_CheckInVehicleCard> {
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
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          NeuField(
            controller: _number,
            label: 'Number',
            hint: 'MH07AB1234',
            onChanged: (v) => widget.vehicle.number = v.toUpperCase(),
            dense: true,
            labelAction: SizedBox(
              height: 20,
              width: 20,
              child: IconButton(
                icon: const Icon(Icons.delete_outline, size: 18),
                color: AppTheme.danger,
                onPressed: widget.onRemove,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ),
          ),
          const SizedBox(height: AppTheme.s8),
          SizedBox(
            height: 34,
            child: NeuPressed(
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String?>(
                  value: widget.vehicle.type,
                  isExpanded: true,
                  isDense: true,
                  dropdownColor: AppTheme.bg,
                  hint: const Text(
                    'Type',
                    style: TextStyle(color: AppTheme.muted, fontSize: 14),
                  ),
                  items: [
                    for (final e in kVehicleTypes.entries)
                      DropdownMenuItem<String?>(
                        value: e.key,
                        child: Text(e.value),
                      ),
                  ],
                  onChanged: (t) {
                    setState(() => widget.vehicle.type = t);
                    widget.onChanged();
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
