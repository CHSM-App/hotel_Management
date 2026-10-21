import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/quote.dart';
import '../../domain/models/room.dart';
import '../../domain/models/switchable_charge_listing.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/compact_date_picker.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'quotation_pdf.dart';
import 'room_form_pieces.dart';

String _iso(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

DateTime _addDays(DateTime d, int days) => DateUtils.dateOnly(d).add(Duration(days: days));

/// Nights between two dates — the to date is checkout, so it is not itself
/// charged: 13th to 17th is four nights. Same rule the booking form prices
/// on, and the server's /pricing/simulate.
int _nightsBetween(DateTime from, DateTime to) =>
    DateUtils.dateOnly(to).difference(DateUtils.dateOnly(from)).inDays;

String _formatDay(DateTime d) =>
    '${d.day} ${const ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.month - 1]}';

/// An Indian mobile number as the desk would key or paste it — "+91 98765
/// 43210", "098765 43210" — brought down to its ten digits. Anything that is
/// not a digit never reaches the box.
String _toMobileDigits(String value) {
  var digits = value.replaceAll(RegExp(r'\D'), '');
  if (digits.length > 10 && digits.startsWith('91')) {
    digits = digits.substring(2);
  } else if (digits.length > 10 && digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  return digits.length > 10 ? digits.substring(0, 10) : digits;
}

bool _isIndianMobile(String digits) => RegExp(r'^[6-9]\d{9}$').hasMatch(digits);

/// An extra switched on in the simulator, with however many of it is
/// counted — mirrors { id, quantity } in chargeSelections.js (agreedAmount
/// doesn't apply here: the simulator previews the lodge's own rate, it
/// doesn't negotiate one for a real booking).
class _SimCharge {
  final int id;
  final int quantity;
  const _SimCharge(this.id, this.quantity);
}

/// "7:3,8" — mirrors chargesParam in chargeSelections.js.
String _chargesParam(List<_SimCharge> selections) =>
    selections.map((c) => c.quantity > 1 ? '${c.id}:${c.quantity}' : '${c.id}').join(',');

/// One room being priced: which room, for which nights, with which extras,
/// and the server's last answer for exactly that — mirrors newSim() in
/// PriceSimulatorPanel.jsx. Each carries its own dates, so several rooms on
/// different nights can be totted up into one quotation.
class _SimRoom {
  final int key;
  int? roomId;
  DateTime fromDate;
  DateTime toDate;
  List<_SimCharge> charges;
  PriceSimulation? result;
  String? error;
  bool loading;

  _SimRoom({required this.key, required this.fromDate, required this.toDate})
      : charges = [],
        loading = false;

  int get nights => _nightsBetween(fromDate, toDate);
}

/// Price simulator — a line-by-line breakdown for one or more rooms over a
/// stay, with no booking attached, ending in a downloadable guest quotation.
/// Mirrors PriceSimulatorPanel.jsx: pick a room and dates, tick whichever
/// extras apply, and the server's own quote appears below it — never worked
/// out on the phone, the same rule the booking form prices on. Several rooms
/// can be added at once, their totals added up into one PDF.
class PriceSimulatorPanel extends ConsumerStatefulWidget {
  const PriceSimulatorPanel({super.key});

  @override
  ConsumerState<PriceSimulatorPanel> createState() => _PriceSimulatorPanelState();
}

class _PriceSimulatorPanelState extends ConsumerState<PriceSimulatorPanel> {
  int _simKey = 0;
  late List<_SimRoom> _sims;
  final Map<int, int> _seqByKey = {};

  final _guestNameController = TextEditingController();
  final _guestPhoneController = TextEditingController();
  final _guestPhoneFocus = FocusNode();
  bool _preparingPdf = false;
  String? _pdfError;
  // The phone's message waits until the box has been left or Download
  // pressed: "not a valid number" under every keystroke of a number being
  // typed is noise.
  bool _phoneChecked = false;

  bool get _phoneInvalid => _guestPhoneController.text.isNotEmpty && !_isIndianMobile(_guestPhoneController.text);

  @override
  void initState() {
    super.initState();
    final today = DateUtils.dateOnly(DateTime.now());
    _sims = [_SimRoom(key: ++_simKey, fromDate: today, toDate: _addDays(today, 1))];
    _guestPhoneFocus.addListener(() {
      if (!_guestPhoneFocus.hasFocus) setState(() => _phoneChecked = true);
    });
  }

  @override
  void dispose() {
    _guestNameController.dispose();
    _guestPhoneController.dispose();
    _guestPhoneFocus.dispose();
    super.dispose();
  }

  // A small rotating palette so a second, third... room reads as visibly
  // its own card rather than a copy of the first — cycles rather than one
  // color per room id, since rooms being compared are rarely more than a
  // handful at a time.
  static const _roomPalette = [AppTheme.accent, AppTheme.edit, AppTheme.checkout, AppTheme.checkedIn, AppTheme.vacant];
  Color _roomColor(int index) => _roomPalette[index % _roomPalette.length];

  void _addSim() {
    final last = _sims.last;
    setState(() => _sims = [..._sims, _SimRoom(key: ++_simKey, fromDate: last.fromDate, toDate: last.toDate)]);
  }

  void _removeSim(int key) {
    _seqByKey.remove(key);
    setState(() => _sims = _sims.where((s) => s.key != key).toList());
  }

  int? _quantityOf(_SimRoom sim, int chargeId) {
    for (final c in sim.charges) {
      if (c.id == chargeId) return c.quantity;
    }
    return null;
  }

  void _toggleCharge(_SimRoom sim, int chargeId) {
    setState(() {
      final existing = _quantityOf(sim, chargeId);
      sim.charges = existing != null
          ? sim.charges.where((c) => c.id != chargeId).toList()
          : [...sim.charges, _SimCharge(chargeId, 1)];
    });
    _runQuote(sim);
  }

  void _setChargeQuantity(_SimRoom sim, int chargeId, int quantity) {
    setState(() {
      sim.charges = [for (final c in sim.charges) c.id == chargeId ? _SimCharge(chargeId, quantity) : c];
    });
    _runQuote(sim);
  }

  Future<void> _runQuote(_SimRoom sim) async {
    final seq = (_seqByKey[sim.key] = (_seqByKey[sim.key] ?? 0) + 1);
    bool current() => _seqByKey[sim.key] == seq;
    final roomId = sim.roomId;
    if (roomId == null || sim.nights < 1) {
      setState(() {
        sim.result = null;
        sim.loading = false;
        sim.error = null;
      });
      return;
    }
    setState(() {
      sim.loading = true;
      sim.error = null;
    });
    try {
      final chargeIds = _chargesParam(sim.charges);
      final result = await ref.read(roomsViewModelProvider.notifier).simulatePrice(
        roomId: roomId,
        date: _iso(sim.fromDate),
        toDate: _iso(sim.toDate),
        chargeIds: chargeIds.isEmpty ? null : chargeIds,
      );
      if (!current() || !mounted) return;
      setState(() {
        sim.result = result;
        sim.loading = false;
      });
    } catch (e) {
      if (!current() || !mounted) return;
      setState(() {
        sim.result = null;
        sim.loading = false;
        sim.error = 'Could not work out the price.';
      });
    }
  }

  Future<void> _pickDate(_SimRoom sim, {required bool from}) async {
    final earliest = DateTime.now().subtract(const Duration(days: 365));
    final firstDate = from ? earliest : sim.fromDate;
    var initialDate = from ? sim.fromDate : sim.toDate;
    if (initialDate.isBefore(firstDate)) initialDate = firstDate;
    final picked = await showAppDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: firstDate,
      lastDate: DateTime.now().add(const Duration(days: 730)),
    );
    if (picked == null) return;
    setState(() {
      if (from) {
        sim.fromDate = picked;
        if (_nightsBetween(sim.fromDate, sim.toDate) < 1) sim.toDate = _addDays(sim.fromDate, 1);
      } else {
        sim.toDate = picked;
      }
    });
    _runQuote(sim);
  }

  Future<void> _downloadQuotation(List<QuotedRoom> rooms, num total) async {
    // Optional, but a number on the quotation has to be one the guest can
    // be rung on.
    if (_phoneInvalid) {
      setState(() => _phoneChecked = true);
      _guestPhoneFocus.requestFocus();
      return;
    }
    setState(() {
      _pdfError = null;
      _preparingPdf = true;
    });
    try {
      final me = ref.read(authViewModelProvider).me;
      final phone = _guestPhoneController.text;
      await QuotationPdf.download(
        rooms,
        total: total,
        lodge: me?.lodge,
        guestName: _guestNameController.text,
        guestPhone: phone.isEmpty ? phone : '+91 ${phone.substring(0, 5)} ${phone.substring(5)}',
        preparedBy: me?.user.name,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Quotation saved.'), backgroundColor: AppTheme.heading),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _pdfError = 'Could not prepare the quotation. Try again.');
    } finally {
      if (mounted) setState(() => _preparingPdf = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(roomsViewModelProvider);
    final rooms = state.rooms.where((r) => r.isActive).toList();
    final activeCharges = state.switchableCharges.where((c) => c.isActive).toList();
    final many = _sims.length > 1;

    RoomListing? roomOf(_SimRoom sim) {
      if (sim.roomId == null) return null;
      for (final r in rooms) {
        if (r.id == sim.roomId) return r;
      }
      return null;
    }

    final chosen = _sims.where((s) => roomOf(s) != null).toList();
    final priced = _sims.where((s) => s.result != null).toList();
    final grandTotal = priced.fold<num>(0, (sum, s) => sum + s.result!.total);
    final anySimulating = _sims.any((s) => s.loading);
    final canDownload = priced.isNotEmpty && priced.length == chosen.length && !anySimulating;

    Set<int> takenByOthers(_SimRoom sim) =>
        {for (final s in _sims) if (s.key != sim.key && s.roomId != null) s.roomId!};

    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: AppTheme.maxContentWidth),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s8, AppTheme.s12, AppTheme.s24),
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            NeuCard(
              radius: AppTheme.rLarge,
              padding: const EdgeInsets.all(AppTheme.s12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 32,
                        height: 32,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.12), shape: BoxShape.circle),
                        child: const Icon(Icons.calculate_rounded, size: 16, color: AppTheme.accent),
                      ),
                      const SizedBox(width: AppTheme.s8),
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Price simulator',
                              style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14),
                            ),
                            Text(
                              'Line-by-line breakdown for a room and a stay',
                              style: TextStyle(color: AppTheme.muted, fontSize: 10.5),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppTheme.s12),
                  for (final (index, sim) in _sims.indexed)
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppTheme.s12),
                      child: _RoomCard(
                        color: _roomColor(index),
                        child: _simBlock(
                          sim: sim,
                          index: index,
                          many: many,
                          rooms: rooms,
                          activeCharges: activeCharges,
                          taken: takenByOthers(sim),
                          roomOf: roomOf,
                        ),
                      ),
                    ),
                  const SizedBox(height: AppTheme.s8),
                  _AddRoomButton(
                    enabled: _sims.length < rooms.length,
                    onTap: _addSim,
                  ),
                ],
              ),
            ),

            for (final (index, sim) in _sims.indexed)
              if (roomOf(sim) != null) ...[
                const SizedBox(height: AppTheme.s12),
                _roomResultCard(sim: sim, room: roomOf(sim)!, many: many, color: _roomColor(index)),
              ],

            if (priced.isNotEmpty) ...[
              const SizedBox(height: AppTheme.s12),
              _grandTotalCard(priced: priced, grandTotal: grandTotal, stale: anySimulating, many: many),
              const SizedBox(height: AppTheme.s12),
              _quotationCard(
                priced: priced,
                roomOf: roomOf,
                grandTotal: grandTotal,
                canDownload: canDownload,
              ),
            ] else if (chosen.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: AppTheme.s12),
                child: NeuNotice(
                  icon: Icons.calculate_outlined,
                  message: 'Choose a room and the price for the stay appears here.',
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _simBlock({
    required _SimRoom sim,
    required int index,
    required bool many,
    required List<RoomListing> rooms,
    required List<SwitchableChargeListing> activeCharges,
    required Set<int> taken,
    required RoomListing? Function(_SimRoom) roomOf,
  }) {
    final selectedRoom = roomOf(sim);
    final availableRooms = rooms.where((r) => r.id == sim.roomId || !taken.contains(r.id)).toList();
    final color = _roomColor(index);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: AppTheme.s8),
          child: Row(
            children: [
              Container(
                width: 22,
                height: 22,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                child: Text('${index + 1}', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: Text(
                  selectedRoom == null ? 'Room ${index + 1}' : 'Room ${selectedRoom.roomNumber}',
                  style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 13),
                ),
              ),
              if (many)
                TextButton(
                  onPressed: () => _removeSim(sim.key),
                  style: TextButton.styleFrom(foregroundColor: AppTheme.danger, padding: EdgeInsets.zero, minimumSize: Size.zero),
                  child: const Text('Remove', style: TextStyle(fontSize: 12)),
                ),
            ],
          ),
        ),
        if (sim.error != null) ...[
          Text(sim.error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
          const SizedBox(height: AppTheme.s8),
        ],

        const RequiredLabel('Room'),
        const SizedBox(height: AppTheme.s8),
        OptionDropdown(
          values: [for (final r in availableRooms) '${r.id}'],
          labels: {for (final r in availableRooms) '${r.id}': '${r.roomNumber} — ${r.category.name}'},
          selected: sim.roomId != null ? '${sim.roomId}' : null,
          hint: 'Choose a room',
          itemIcon: Icons.meeting_room_rounded,
          onSelect: (v) {
            setState(() => sim.roomId = int.parse(v));
            _runQuote(sim);
          },
        ),
        const SizedBox(height: AppTheme.s12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _DateField(
                label: 'From (check-in)',
                value: _iso(sim.fromDate),
                onTap: () => _pickDate(sim, from: true),
              ),
            ),
            const SizedBox(width: AppTheme.s8),
            Expanded(
              child: _DateField(
                label: 'To (check-out)',
                value: _iso(sim.toDate),
                onTap: () => _pickDate(sim, from: false),
              ),
            ),
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: (sim.nights > 0 ? color : AppTheme.danger).withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                sim.nights > 0 ? '${sim.nights} night${sim.nights == 1 ? '' : 's'}' : 'Check dates',
                style: TextStyle(color: sim.nights > 0 ? color : AppTheme.danger, fontSize: 11, fontWeight: FontWeight.w700),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                sim.nights > 0 ? 'Checkout morning is not charged' : 'The to date must be after the from date.',
                style: const TextStyle(color: AppTheme.muted, fontSize: 11),
              ),
            ),
          ],
        ),

        if (activeCharges.isNotEmpty) ...[
          const SectionDivider(),
          const Text('Extras', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 12.5)),
          const SizedBox(height: AppTheme.s8),
          Wrap(
            spacing: AppTheme.s8,
            runSpacing: AppTheme.s8,
            children: [for (final charge in activeCharges) _chargeChip(sim, charge)],
          ),
        ],

        if (selectedRoom != null) ...[
          const SectionDivider(),
          _roomFacts(selectedRoom),
        ],
      ],
    );
  }

  Widget _chargeChip(_SimRoom sim, SwitchableChargeListing charge) {
    final quantity = _quantityOf(sim, charge.id);
    final selected = quantity != null;
    return GestureDetector(
      onTap: () => _toggleCharge(sim, charge.id),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? AppTheme.accent.withValues(alpha: 0.1) : AppTheme.card,
          borderRadius: BorderRadius.circular(AppTheme.rMedium),
          border: Border.all(color: selected ? AppTheme.accent : AppTheme.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              selected ? Icons.check_box_rounded : Icons.check_box_outline_blank_rounded,
              size: 16,
              color: selected ? AppTheme.accent : AppTheme.muted,
            ),
            const SizedBox(width: 6),
            Text(
              '${charge.name} (${formatPrice(charge.chargePerNight)}/night)',
              style: TextStyle(color: selected ? AppTheme.accent : AppTheme.text, fontSize: 12.5, fontWeight: selected ? FontWeight.w600 : FontWeight.w500),
            ),
            if (selected && charge.isCounter) ...[
              const SizedBox(width: 8),
              _QtyStepper(value: quantity, onChanged: (v) => _setChargeQuantity(sim, charge.id, v)),
            ],
          ],
        ),
      ),
    );
  }

  Widget _roomFacts(RoomListing room) {
    final bedLabel = room.beds.isNotEmpty ? room.beds.map((b) => '${b.count} × ${b.size}').join(', ') : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _factRow('Category', '${room.category.name} · ${formatPrice(room.category.basePrice)}/night'),
        if (bedLabel != null || room.bathroomType != null)
          _factRow('Room', [bedLabel, room.bathroomType].whereType<String>().join(' · ')),
        if (room.maxOccupancy != null)
          _factRow('Max occupancy', '${room.maxOccupancy} guest${room.maxOccupancy == 1 ? '' : 's'}'),
        if (room.description != null && room.description!.isNotEmpty) _factRow('Notes', room.description!),
      ],
    );
  }

  Widget _factRow(String name, String value) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 90, child: Text(name, style: const TextStyle(color: AppTheme.muted, fontSize: 11.5))),
        Expanded(child: Text(value, style: const TextStyle(color: AppTheme.text, fontSize: 11.5))),
      ],
    ),
  );

  Widget _roomResultCard({required _SimRoom sim, required RoomListing room, required bool many, required Color color}) {
    final result = sim.result;
    if (result == null) {
      if (sim.error != null) return const SizedBox.shrink();
      return NeuCard(
        radius: AppTheme.rLarge,
        padding: const EdgeInsets.all(AppTheme.s12),
        child: Text(
          many
              ? 'Room ${room.roomNumber} · ${sim.loading ? 'Working out the price…' : 'Pick a from and a to date to see the price.'}'
              : sim.loading
                  ? 'Working out the price…'
                  : 'Pick a from and a to date to see the price.',
          style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
        ),
      );
    }
    return _ResultCard(
      result: result,
      stale: sim.loading,
      roomLabel: many ? 'Room ${room.roomNumber} · ${room.category.name}' : null,
      color: color,
    );
  }

  Widget _grandTotalCard({required List<_SimRoom> priced, required num grandTotal, required bool stale, required bool many}) {
    return NeuCard(
      radius: AppTheme.rLarge,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Opacity(
        opacity: stale ? 0.55 : 1,
        child: Row(
          children: [
            Expanded(
              child: Text(
                many ? 'Total · ${priced.length} room${priced.length == 1 ? '' : 's'}' : 'Total · ${priced.first.result!.nightCount} night${priced.first.result!.nightCount == 1 ? '' : 's'}',
                style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13.5),
              ),
            ),
            Text(formatPrice(grandTotal), style: const TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w800, fontSize: 16)),
          ],
        ),
      ),
    );
  }

  Widget _quotationCard({
    required List<_SimRoom> priced,
    required RoomListing? Function(_SimRoom) roomOf,
    required num grandTotal,
    required bool canDownload,
  }) {
    final hasGuest = _guestNameController.text.trim().isNotEmpty || _guestPhoneController.text.trim().isNotEmpty;
    return NeuCard(
      radius: AppTheme.rLarge,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 28,
                height: 28,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.14), shape: BoxShape.circle),
                child: const Icon(Icons.description_rounded, size: 16, color: AppTheme.accent),
              ),
              const SizedBox(width: AppTheme.s8),
              const Text('Quotation for', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13.5)),
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: AppTheme.muted.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: const Text('optional', style: TextStyle(color: AppTheme.muted, fontSize: 9.5, fontWeight: FontWeight.w600)),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: NeuField(
                  controller: _guestNameController,
                  label: 'Guest name',
                  maxLength: 80,
                  onChanged: (_) => setState(() {}),
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: NeuField(
                  controller: _guestPhoneController,
                  focusNode: _guestPhoneFocus,
                  label: 'Phone',
                  hint: '10-digit',
                  keyboardType: TextInputType.number,
                  maxLength: 10,
                  errorText: _phoneChecked && _phoneInvalid ? 'Enter 10 digits.' : null,
                  onChanged: (value) {
                    final digits = _toMobileDigits(value);
                    if (digits != value) {
                      _guestPhoneController.value = TextEditingValue(
                        text: digits,
                        selection: TextSelection.collapsed(offset: digits.length),
                      );
                    }
                    setState(() {});
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                hasGuest ? Icons.visibility_rounded : Icons.info_outline_rounded,
                size: 14,
                color: AppTheme.muted,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  hasGuest ? 'Shown on the quotation under "Prepared for".' : 'Left empty, the quotation has no "Prepared for" block.',
                  style: const TextStyle(color: AppTheme.muted, fontSize: 11, height: 1.3),
                ),
              ),
            ],
          ),
          if (_pdfError != null) ...[
            const SizedBox(height: AppTheme.s8),
            Text(_pdfError!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
          ],
          const SizedBox(height: AppTheme.s12),
          SizedBox(
            width: double.infinity,
            height: 44,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: AppTheme.accent,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
                elevation: 0,
                textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
              ),
              onPressed: !canDownload || _preparingPdf
                  ? null
                  : () => _downloadQuotation(
                        [
                          for (final s in priced)
                            QuotedRoom(room: roomOf(s)!, fromDate: _iso(s.fromDate), toDate: _iso(s.toDate), result: s.result!),
                        ],
                        grandTotal,
                      ),
              icon: _preparingPdf
                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.picture_as_pdf_rounded, size: 18),
              label: Text(_preparingPdf ? 'Preparing…' : 'Download quotation'),
            ),
          ),
        ],
      ),
    );
  }
}

/// One room's own boxed card — a tinted border in that room's colour (see
/// [_PriceSimulatorPanelState._roomColor]) so a second or third room added
/// to the quote reads as a visibly separate card rather than more fields
/// appended to the first, however many are on screen.
class _RoomCard extends StatelessWidget {
  final Color color;
  final Widget child;

  const _RoomCard({required this.color, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.03),
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: color.withValues(alpha: 0.35), width: 1.2),
      ),
      child: child,
    );
  }
}

/// A From/To pill — the same shape events' and rooms' own date filters use
/// ([_EventDateField]/RegisterScreen's `_DateField`), so the simulator reads
/// as one design with the rest of the app rather than a plain labelled box.
class _DateField extends StatelessWidget {
  final String label;
  final String value;
  final VoidCallback onTap;

  const _DateField({required this.label, required this.value, required this.onTap});

  static const _months = [
    '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  @override
  Widget build(BuildContext context) {
    final parsed = DateTime.tryParse(value);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        highlightColor: AppTheme.accent.withValues(alpha: 0.05),
        splashColor: AppTheme.accent.withValues(alpha: 0.08),
        // No fixed height: the box grows with the text (and the phone's
        // font scale) instead of overflowing by a fraction of a pixel.
        child: Container(
          constraints: const BoxConstraints(minHeight: 52),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: AppTheme.accent.withValues(alpha: 0.05),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppTheme.accent.withValues(alpha: 0.35)),
          ),
          child: Row(
            children: [
              const Icon(Icons.calendar_today_rounded, size: 15, color: AppTheme.accent),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppTheme.muted, fontSize: 9.5, fontWeight: FontWeight.w600, height: 1.2),
                    ),
                    const SizedBox(height: 1),
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(
                        parsed == null ? value : '${parsed.day} ${_months[parsed.month]} ${parsed.year}',
                        maxLines: 1,
                        style: const TextStyle(color: AppTheme.heading, fontSize: 12.5, fontWeight: FontWeight.w700, height: 1.2),
                      ),
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
}

/// "+ Add another room" — the same accent-tinted pill the booking form's
/// own "Add another payment" row uses, so every "add one more of these"
/// control in the app looks and behaves alike.
class _AddRoomButton extends StatelessWidget {
  final bool enabled;
  final VoidCallback onTap;

  const _AddRoomButton({required this.enabled, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: enabled ? 1 : 0.45,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(999),
          highlightColor: AppTheme.accent.withValues(alpha: 0.05),
          splashColor: AppTheme.accent.withValues(alpha: 0.08),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
            decoration: BoxDecoration(
              color: AppTheme.accent.withValues(alpha: 0.07),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: AppTheme.accent.withValues(alpha: 0.3)),
            ),
            child: const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.add_rounded, color: AppTheme.accent, size: 17),
                SizedBox(width: 5),
                Text(
                  'Add another room',
                  style: TextStyle(color: AppTheme.accent, fontSize: 12.5, fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The "how many" control beside a counted extra: minus, the count, plus —
/// mirrors QtyStepper.jsx. Held as an int here rather than a typed string:
/// the phone has no bare text box beside it to clear mid-edit, so there is
/// nothing for a string form to buy over a plain count.
class _QtyStepper extends StatelessWidget {
  final int value;
  final ValueChanged<int> onChanged;
  final int min;

  const _QtyStepper({required this.value, required this.onChanged, this.min = 1});

  @override
  Widget build(BuildContext context) {
    Widget button(IconData icon, VoidCallback? onTap) => GestureDetector(
      onTap: onTap,
      child: Container(
        width: 22,
        height: 22,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: onTap == null ? AppTheme.border.withValues(alpha: 0.3) : AppTheme.bg,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: AppTheme.border),
        ),
        child: Icon(icon, size: 14, color: onTap == null ? AppTheme.muted : AppTheme.heading),
      ),
    );

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        button(Icons.remove_rounded, value > min ? () => onChanged(value - 1) : null),
        SizedBox(
          width: 26,
          child: Text('$value', textAlign: TextAlign.center, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
        ),
        button(Icons.add_rounded, () => onChanged(value + 1)),
      ],
    );
  }
}

class _ResultCard extends StatelessWidget {
  final PriceSimulation result;
  final bool stale;
  final String? roomLabel;
  final Color? color;

  const _ResultCard({required this.result, required this.stale, this.roomLabel, this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rLarge),
        boxShadow: AppTheme.subtle,
        // The same room colour its input card carries, continued here so
        // the two visibly belong to each other once there's more than one.
        border: color == null ? null : Border(left: BorderSide(color: color!, width: 3)),
      ),
      padding: const EdgeInsets.all(AppTheme.s12),
      // Dimmed while a newer answer is on its way, so a total about to
      // change is never read off as the price — mirrors sim-result--stale.
      child: Opacity(
        opacity: stale ? 0.55 : 1,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (roomLabel != null) ...[
              Text(roomLabel!, style: TextStyle(color: color ?? AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 12.5)),
              const SizedBox(height: AppTheme.s8),
            ],
            for (final line in result.lines)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        result.nightCount > 1 ? '${line.label}  ×${line.nights ?? result.nightCount} night${(line.nights ?? result.nightCount) == 1 ? '' : 's'}' : line.label,
                        style: const TextStyle(color: AppTheme.text, fontSize: 12.5),
                      ),
                    ),
                    Text(formatPrice(line.amount), style: const TextStyle(color: AppTheme.heading, fontSize: 12.5, fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
            const Divider(height: AppTheme.s12, color: AppTheme.border),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Total · ${result.nightCount} night${result.nightCount == 1 ? '' : 's'}',
                    style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13.5),
                  ),
                ),
                Text(formatPrice(result.total), style: const TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w800, fontSize: 15)),
              ],
            ),
            if (result.nightCount > 1) ...[
              const SizedBox(height: AppTheme.s12),
              const Text('Night by night', style: TextStyle(color: AppTheme.muted, fontWeight: FontWeight.w600, fontSize: 11.5)),
              const SizedBox(height: AppTheme.s8),
              for (final night in result.nights)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          _formatDay(DateTime.tryParse(night.date) ?? DateTime.now()),
                          style: const TextStyle(color: AppTheme.text, fontSize: 11.5),
                        ),
                      ),
                      Text(formatPrice(night.total), style: const TextStyle(color: AppTheme.text, fontSize: 11.5)),
                    ],
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
