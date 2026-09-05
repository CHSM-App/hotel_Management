import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/draft.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/booking_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/payment_row.dart';
import '../theme.dart';

/// Taking a booking, in the order the desk actually does it: which nights,
/// which room, what it costs, who is staying, and what they paid.
///
/// One scrolling page rather than a wizard. The desk changes its mind halfway
/// through constantly — a different room, one more night, "call it 1,500" —
/// and a wizard makes going back a chore. Every later step simply stays shut
/// until the one before it is answered.
class TakeBookingScreen extends ConsumerStatefulWidget {
  const TakeBookingScreen({super.key});

  @override
  ConsumerState<TakeBookingScreen> createState() => _TakeBookingScreenState();
}

class _TakeBookingScreenState extends ConsumerState<TakeBookingScreen> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  String? _idProofType;
  final _idProofNumber = TextEditingController();

  /// Everybody else in the room. The one named above is the booking's own
  /// guest; these are the rest of the party, each with their own ID, because a
  /// register that records one of four people is not a register.
  final List<GuestDraft> _guests = [];

  /// How the advance arrived. Starts as one row, which is the ordinary case.
  final List<PaymentDraft> _advance = [PaymentDraft()];

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(bookingViewModelProvider.notifier).reset());
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _idProofNumber.dispose();
    super.dispose();
  }

  // ── Dates ─────────────────────────────────────────────────────────────────

  Future<void> _pickDates() async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final state = ref.read(bookingViewModelProvider);

    final range = await showDateRangePicker(
      context: context,
      // A stay taken on paper over the weekend has to be enterable against the
      // nights it actually happened on, so the past is open.
      firstDate: today.subtract(const Duration(days: 365)),
      lastDate: today.add(const Duration(days: 365)),
      initialDateRange: state.datesChosen
          ? DateTimeRange(start: state.checkIn!, end: state.checkOut!)
          : DateTimeRange(start: today, end: today.add(const Duration(days: 1))),
      helpText: 'Which nights?',
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

    if (range == null) return;
    // A range picker can hand back the same day twice; a stay of zero nights
    // is not a stay, so it is read as one night.
    final checkOut = range.end.isAfter(range.start)
        ? range.end
        : range.start.add(const Duration(days: 1));
    await ref
        .read(bookingViewModelProvider.notifier)
        .setDates(range.start, checkOut);
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    final vm = ref.read(bookingViewModelProvider.notifier);

    if (_name.text.trim().isEmpty) return _say("Enter the guest's name.");

    final phone = _phone.text.trim();
    // Said here rather than sent and bounced — the server wants ten digits.
    if (phone.length != 10 || int.tryParse(phone) == null) {
      return _say('A mobile number is 10 digits.');
    }

    for (final g in _guests) {
      if (g.isEmpty) return _say('Enter a name for each additional guest.');
    }

    // A walk-in guest is standing at the desk, so their ID is captured now; a
    // reservation defers it to whenever they actually turn up. The web form
    // draws the same line, and the server records the stay either way — this
    // is the desk's own discipline, not a validation the API imposes.
    final state = ref.read(bookingViewModelProvider);
    if (state.isWalkIn) {
      if (_idProofType == null) return _say('Choose the ID proof type.');
      if (_idProofNumber.text.trim().isEmpty) {
        // No upload on the phone yet, so the number off the card is the way
        // to satisfy this — which is the same escape the web form added for a
        // desk with no scanner.
        return _say("Enter the guest's ID number.");
      }
    }

    // Only rows with money on them count; an untouched row is not a payment.
    final paid = _advance.where((l) => l.value > 0).toList();
    if (paid.isNotEmpty) {
      final problem = paymentLinesError(paid);
      if (problem != null) return _say(problem);
    }

    final booking = await vm.submit(
      guestName: _name.text,
      guestPhone: phone,
      // The party is whoever was named, not a number typed separately and then
      // contradicted.
      numGuests: 1 + _guests.length,
      idProofType: _idProofType,
      idProofNumber: _idProofNumber.text,
      guests: _guests,
      advanceLines: paid,
    );

    if (!mounted) return;
    if (booking == null) {
      return _say(ref.read(bookingViewModelProvider).error ?? 'Could not save.');
    }
    Navigator.of(context).pop(true);
  }

  void _say(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: AppTheme.heading),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(bookingViewModelProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Take a booking')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppTheme.s16,
            AppTheme.s8,
            AppTheme.s16,
            AppTheme.s32,
          ),
          children: [
            // Everything the desk fills in lives on one card — the numbered
            // steps used to be separate cards with headings; a section label
            // plus a hairline divider says the same thing in less height.
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SectionLabel('Nights'),
                  const SizedBox(height: AppTheme.s8),
                  _DatesField(state: state, onTap: _pickDates),
                  if (state.datesChosen) ...[
                    const SizedBox(height: AppTheme.s12),
                    _KindNote(state: state),
                  ],

                  if (state.datesChosen) ...[
                    const _SectionDivider(),
                    const _SectionLabel('Room'),
                    const SizedBox(height: AppTheme.s8),
                    _RoomPicker(state: state),
                  ],

                  if (state.room != null) ...[
                    if (state.room!.switchableCharges.isNotEmpty) ...[
                      const _SectionDivider(),
                      const _SectionLabel('Extras'),
                      const SizedBox(height: AppTheme.s8),
                      _ExtrasCard(state: state),
                    ],

                    const _SectionDivider(),
                    const _SectionLabel('What it costs'),
                    const SizedBox(height: AppTheme.s8),
                    _QuoteCard(state: state),

                    const _SectionDivider(),
                    const _SectionLabel('Guest'),
                    const SizedBox(height: AppTheme.s12),
                    NeuField(controller: _name, label: 'Name'),
                    const SizedBox(height: AppTheme.s16),
                    NeuField(
                      controller: _phone,
                      label: 'Mobile number',
                      hint: '9876543210',
                      keyboardType: TextInputType.phone,
                      maxLength: 10,
                    ),
                    const SizedBox(height: AppTheme.s16),
                    _IdProofFields(
                      type: _idProofType,
                      number: _idProofNumber,
                      // Required on a walk-in, deferred on a reservation.
                      required: state.isWalkIn,
                      onType: (t) => setState(() => _idProofType = t),
                    ),

                    const _SectionDivider(),
                    _SectionLabel(
                      'Others in the room',
                      trailing: _guests.isEmpty ? null : '${_guests.length}',
                    ),
                    const SizedBox(height: AppTheme.s8),
                    _GuestList(
                      guests: _guests,
                      onAdd: () => setState(() => _guests.add(GuestDraft())),
                      onRemove: (i) => setState(() => _guests.removeAt(i)),
                      onChanged: () => setState(() {}),
                    ),

                    const _SectionDivider(),
                    const _SectionLabel('Advance (optional)'),
                    const SizedBox(height: AppTheme.s8),
                    _AdvanceCard(
                      lines: _advance,
                      onAdd: () => setState(() => _advance.add(PaymentDraft())),
                      onRemove: (i) => setState(() => _advance.removeAt(i)),
                      onChanged: () => setState(() {}),
                    ),
                  ],
                ],
              ),
            ),

            if (state.room != null) ...[
              const SizedBox(height: AppTheme.s24),
              NeuButton(
                primary: true,
                expand: true,
                // Held shut while the request is in flight. The server holds a
                // lock that stops two devices booking one room; nothing stops
                // one device asking twice.
                onPressed: state.submitting ? null : _submit,
                child: state.submitting
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Save booking'),
              ),
            ],
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

  const _SectionLabel(this.title, {this.trailing});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
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

// ── Dates ───────────────────────────────────────────────────────────────────

class _DatesField extends StatelessWidget {
  final BookingState state;
  final VoidCallback onTap;

  const _DatesField({required this.state, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
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
              size: 18,
            ),
            const SizedBox(width: AppTheme.s12),
            Expanded(
              child: state.datesChosen
                  ? Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          '${formatDate(state.checkIn)}  →  '
                          '${formatDate(state.checkOut)}',
                          style: const TextStyle(
                            color: AppTheme.heading,
                            fontWeight: FontWeight.w600,
                            fontSize: 13.5,
                          ),
                        ),
                        Text(
                          nightsLabel(state.nights),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    )
                  : const Text(
                      'Choose the nights',
                      style: TextStyle(color: AppTheme.muted, fontSize: 13.5),
                    ),
            ),
            const Icon(Icons.chevron_right, color: AppTheme.muted, size: 20),
          ],
        ),
      ),
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
class _KindNote extends StatelessWidget {
  final BookingState state;

  const _KindNote({required this.state});

  @override
  Widget build(BuildContext context) {
    final walkIn = state.isWalkIn;
    return NeuCard(
      shadow: AppTheme.subtle,
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.s16,
        vertical: AppTheme.s12,
      ),
      child: Row(
        children: [
          Icon(
            walkIn ? Icons.login_rounded : Icons.event_available_rounded,
            size: 18,
            color: walkIn ? AppTheme.checkedIn : AppTheme.reserved,
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Text(
              walkIn
                  ? 'Starts today — the guest will be checked in as soon as '
                        'this is saved, so their ID is needed now.'
                  : 'Starts later — this is a reservation. The ID is taken '
                        'when they arrive.',
              style: const TextStyle(color: AppTheme.text, fontSize: 12),
            ),
          ),
        ],
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
                Switch(
                  value: state.extras.containsKey(charge.id),
                  activeThumbColor: AppTheme.accent,
                  onChanged: (on) => vm.toggleExtra(charge.id, on),
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
          // A concession off the whole stay, not a re-negotiated nightly rate —
          // that is the box on the room line above. Kept beside the total it
          // comes off so the two are read together.
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
      width: 96,
      child: NeuPressed(
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
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

  const _IdProofFields({
    required this.type,
    required this.number,
    required this.onType,
    this.onNumber,
    this.required = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          required ? 'ID proof (required)' : 'ID proof',
          style: Theme.of(context).textTheme.bodySmall,
        ),
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
        if (type != null) ...[
          const SizedBox(height: AppTheme.s12),
          NeuField(
            controller: number,
            label: 'ID number',
            hint: 'As printed on the card',
            maxLength: 40,
            onChanged: onNumber,
          ),
        ],
      ],
    );
  }
}

// ── The rest of the party ───────────────────────────────────────────────────

class _GuestList extends StatelessWidget {
  final List<GuestDraft> guests;
  final VoidCallback onAdd;
  final ValueChanged<int> onRemove;
  final VoidCallback onChanged;

  const _GuestList({
    required this.guests,
    required this.onAdd,
    required this.onRemove,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < guests.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s12),
            child: _GuestCard(
              guest: guests[i],
              index: i,
              onRemove: () => onRemove(i),
              onChanged: onChanged,
            ),
          ),
        NeuButton(
          expand: true,
          onPressed: onAdd,
          padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
          child: const Text('+ Add another guest'),
        ),
      ],
    );
  }
}

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
  late final _number = TextEditingController(text: widget.guest.idProofNumber);

  @override
  void dispose() {
    _name.dispose();
    _number.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      shadow: AppTheme.subtle,
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Guest ${widget.index + 2}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
              // A child shares the room but is not counted the same way on the
              // register, so it is recorded rather than inferred.
              Text(
                'Child',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              Switch(
                value: widget.guest.isChild,
                activeThumbColor: AppTheme.accent,
                onChanged: (v) {
                  widget.guest.isChild = v;
                  widget.onChanged();
                },
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline, size: 20),
                color: AppTheme.danger,
                onPressed: widget.onRemove,
              ),
            ],
          ),
          NeuField(
            controller: _name,
            label: 'Name',
            onChanged: (v) => widget.guest.name = v,
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
          ),
        ],
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
  final VoidCallback onAdd;
  final ValueChanged<int> onRemove;
  final VoidCallback onChanged;

  const _AdvanceCard({
    required this.lines,
    required this.onAdd,
    required this.onRemove,
    required this.onChanged,
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
                line: lines[i],
                // Nothing to remove down to on a single payment, so the bin is
                // dead there rather than gone — the row would jump sideways.
                onRemove: lines.length == 1 ? null : () => onRemove(i),
                onChanged: onChanged,
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

