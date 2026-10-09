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

/// Price simulator — a line-by-line breakdown for a room and a stay, with no
/// booking attached. Mirrors PriceSimulatorPanel.jsx: pick a room and dates,
/// tick whichever extras apply, and the server's own quote appears below —
/// never worked out on the phone, the same rule the booking form prices on.
class PriceSimulatorPanel extends ConsumerStatefulWidget {
  const PriceSimulatorPanel({super.key});

  @override
  ConsumerState<PriceSimulatorPanel> createState() => _PriceSimulatorPanelState();
}

class _PriceSimulatorPanelState extends ConsumerState<PriceSimulatorPanel> {
  int? _roomId;
  DateTime _fromDate = DateUtils.dateOnly(DateTime.now());
  DateTime _toDate = _addDays(DateUtils.dateOnly(DateTime.now()), 1);
  final List<_SimCharge> _charges = [];

  PriceSimulation? _result;
  String? _error;
  bool _loading = false;
  int _seq = 0;

  int get _nights => _nightsBetween(_fromDate, _toDate);

  int? _quantityOf(int chargeId) {
    for (final c in _charges) {
      if (c.id == chargeId) return c.quantity;
    }
    return null;
  }

  void _toggleCharge(int chargeId) {
    setState(() {
      final existing = _quantityOf(chargeId);
      if (existing != null) {
        _charges.removeWhere((c) => c.id == chargeId);
      } else {
        _charges.add(_SimCharge(chargeId, 1));
      }
    });
    _runQuote();
  }

  void _setChargeQuantity(int chargeId, int quantity) {
    setState(() {
      final i = _charges.indexWhere((c) => c.id == chargeId);
      if (i != -1) _charges[i] = _SimCharge(chargeId, quantity);
    });
    _runQuote();
  }

  Future<void> _runQuote() async {
    final seq = ++_seq;
    setState(() => _error = null);
    final roomId = _roomId;
    if (roomId == null || _nights < 1) {
      setState(() {
        _result = null;
        _loading = false;
      });
      return;
    }
    setState(() => _loading = true);
    try {
      final result = await ref.read(roomsViewModelProvider.notifier).simulatePrice(
        roomId: roomId,
        date: _iso(_fromDate),
        toDate: _iso(_toDate),
        chargeIds: _chargesParam(_charges).isEmpty ? null : _chargesParam(_charges),
      );
      if (seq != _seq || !mounted) return;
      setState(() {
        _result = result;
        _loading = false;
      });
    } catch (e) {
      if (seq != _seq || !mounted) return;
      setState(() {
        _result = null;
        _loading = false;
        _error = 'Could not work out the price.';
      });
    }
  }

  Future<void> _pickDate({required bool from}) async {
    final earliest = DateTime.now().subtract(const Duration(days: 365));
    final firstDate = from ? earliest : _fromDate;
    var initialDate = from ? _fromDate : _toDate;
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
        _fromDate = picked;
        if (_nightsBetween(_fromDate, _toDate) < 1) _toDate = _addDays(_fromDate, 1);
      } else {
        _toDate = picked;
      }
    });
    _runQuote();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(roomsViewModelProvider);
    final rooms = state.rooms.where((r) => r.isActive).toList();
    final activeCharges = state.switchableCharges.where((c) => c.isActive).toList();
    final selectedRoom = _roomId == null ? null : rooms.where((r) => r.id == _roomId).firstOrNull;

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
                  const Text(
                    'Price simulator',
                    style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14),
                  ),
                  const Text(
                    'Line-by-line breakdown for a room and a stay',
                    style: TextStyle(color: AppTheme.muted, fontSize: 10.5),
                  ),
                  const SizedBox(height: AppTheme.s12),
                  if (_error != null) ...[
                    Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
                    const SizedBox(height: AppTheme.s8),
                  ],

                  const RequiredLabel('Room'),
                  const SizedBox(height: AppTheme.s8),
                  OptionDropdown(
                    values: [for (final r in rooms) '${r.id}'],
                    labels: {for (final r in rooms) '${r.id}': '${r.roomNumber} — ${r.category.name}'},
                    selected: _roomId != null ? '$_roomId' : null,
                    hint: 'Choose a room',
                    onSelect: (v) {
                      setState(() => _roomId = int.parse(v));
                      _runQuote();
                    },
                  ),
                  const SizedBox(height: AppTheme.s12),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: _DateField(
                          label: 'From (check-in)',
                          value: _iso(_fromDate),
                          onTap: () => _pickDate(from: true),
                        ),
                      ),
                      const SizedBox(width: AppTheme.s8),
                      Expanded(
                        child: _DateField(
                          label: 'To (check-out)',
                          value: _iso(_toDate),
                          onTap: () => _pickDate(from: false),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppTheme.s8),
                  Text(
                    _nights > 0
                        ? '$_nights night${_nights == 1 ? '' : 's'} — checkout morning is not charged'
                        : 'The to date must be after the from date.',
                    style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                  ),

                  if (activeCharges.isNotEmpty) ...[
                    const SectionDivider(),
                    const Text('Extras', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 12.5)),
                    const SizedBox(height: AppTheme.s8),
                    Wrap(
                      spacing: AppTheme.s8,
                      runSpacing: AppTheme.s8,
                      children: [
                        for (final charge in activeCharges) _chargeChip(charge),
                      ],
                    ),
                  ],

                  if (selectedRoom != null) ...[
                    const SectionDivider(),
                    _roomFacts(selectedRoom),
                  ],
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s12),
            if (_result == null && _roomId == null)
              NeuNotice(
                icon: Icons.calculate_outlined,
                message: 'Choose a room and the price for the stay appears here.',
              )
            else if (_result != null)
              _ResultCard(result: _result!, stale: _loading),
          ],
        ),
      ),
    );
  }

  Widget _chargeChip(SwitchableChargeListing charge) {
    final quantity = _quantityOf(charge.id);
    final selected = quantity != null;
    return GestureDetector(
      onTap: () => _toggleCharge(charge.id),
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
              _QtyStepper(
                value: quantity,
                onChanged: (v) => _setChargeQuantity(charge.id, v),
              ),
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
}

extension<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}

class _DateField extends StatelessWidget {
  final String label;
  final String value;
  final VoidCallback onTap;

  const _DateField({required this.label, required this.value, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 10.5)),
        const SizedBox(height: 4),
        GestureDetector(
          onTap: onTap,
          child: NeuPressed(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
            child: Text(value, style: const TextStyle(color: AppTheme.text, fontSize: 13)),
          ),
        ),
      ],
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

  const _ResultCard({required this.result, required this.stale});

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      radius: AppTheme.rLarge,
      padding: const EdgeInsets.all(AppTheme.s12),
      // Dimmed while a newer answer is on its way, so a total about to
      // change is never read off as the price — mirrors sim-result--stale.
      child: Opacity(
        opacity: stale ? 0.55 : 1,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final line in result.lines)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        result.nightCount > 1 ? '${line.label}  ×${line.quantity ?? result.nightCount} night${result.nightCount == 1 ? '' : 's'}' : line.label,
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
