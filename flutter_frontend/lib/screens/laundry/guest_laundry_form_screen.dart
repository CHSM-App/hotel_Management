import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/laundry.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';
import 'laundry_parts.dart';

/// Take in a guest's laundry — mirrors the 'form' modal in
/// LaundryPanel.jsx's GuestLaundryTab: choose the guest, add garments with
/// their own price each, then send to wash.
Future<void> showGuestLaundryFormScreen(BuildContext context) {
  return Navigator.of(context).push(MaterialPageRoute(builder: (_) => const GuestLaundryFormScreen()));
}

class _Line {
  int key;
  String name;
  String price;
  int qty;
  _Line({required this.key, this.name = '', this.price = '', this.qty = 1});
}

const _commonGarments = ['Shirt', 'T-shirt', 'Trousers', 'Jeans', 'Saree', 'Kurta', 'Towel', 'Bedsheet'];

class GuestLaundryFormScreen extends ConsumerStatefulWidget {
  const GuestLaundryFormScreen({super.key});

  @override
  ConsumerState<GuestLaundryFormScreen> createState() => _GuestLaundryFormScreenState();
}

class _GuestLaundryFormScreenState extends ConsumerState<GuestLaundryFormScreen> {
  String _mode = 'walkin';
  String? _stayKey;
  final _guestName = TextEditingController();
  final _guestPhone = TextEditingController();
  final _note = TextEditingController();
  final List<_Line> _lines = [];
  int _nextKey = 1;
  String _washer = 'OWN';
  final _washedBy = TextEditingController();
  final _phone = TextEditingController();
  final _price = TextEditingController(); // unused for guest laundry — price is per garment
  String? _error;
  String? _nameError;

  @override
  void initState() {
    super.initState();
    final state = ref.read(laundryViewModelProvider);
    _mode = state.inHouseGuests.isNotEmpty ? 'stay' : 'walkin';
    final orders = state.orders.where((o) => o.washedBy != null && o.washedBy!.isNotEmpty).toList();
    final last = orders.isNotEmpty ? orders.first : null;
    final own = (last?.washedBy ?? '').trim().toLowerCase() == kOwnLaundry.toLowerCase();
    _washer = last == null ? 'OWN' : (own ? 'OWN' : 'VENDOR');
    if (!own) _washedBy.text = last?.washedBy ?? '';
  }

  @override
  void dispose() {
    _guestName.dispose();
    _guestPhone.dispose();
    _note.dispose();
    _washedBy.dispose();
    _phone.dispose();
    _price.dispose();
    super.dispose();
  }

  void _addLine(String name) {
    if (name.isNotEmpty) {
      final existing = _lines.where((l) => l.name.toLowerCase() == name.toLowerCase());
      if (existing.isNotEmpty) {
        setState(() => existing.first.qty += 1);
        return;
      }
    }
    final state = ref.read(laundryViewModelProvider);
    final price = name.isEmpty
        ? ''
        : state.recentGarments.where((g) => g.name.toLowerCase() == name.toLowerCase()).map((g) => g.price.toString()).firstOrNull ?? '';
    setState(() => _lines.add(_Line(key: _nextKey++, name: name, price: price)));
  }

  num get _total => _lines.fold(0, (n, l) => n + (num.tryParse(l.price) ?? 0) * l.qty);
  int get _pieces => _lines.fold(0, (n, l) => n + l.qty);

  Future<void> _submit() async {
    final state = ref.read(laundryViewModelProvider);
    final used = _lines.where((l) => l.name.trim().isNotEmpty || l.price.isNotEmpty).toList();
    if (used.isEmpty) {
      setState(() => _error = 'Add the garments being handed in.');
      return;
    }
    for (final l in used) {
      if (l.name.trim().isEmpty) {
        setState(() => _error = 'Enter the garment name on every row.');
        return;
      }
      if (l.price.isEmpty || num.tryParse(l.price) == null || num.parse(l.price) < 0) {
        setState(() => _error = 'Enter the price for ${l.name.trim()}.');
        return;
      }
    }
    LaundryGuestStay? stay;
    if (_mode == 'stay') {
      stay = state.inHouseGuests.where((g) => '${g.bookingId}:${g.roomId}' == _stayKey).firstOrNull;
      if (stay == null) {
        setState(() => _error = 'Choose the guest.');
        return;
      }
    } else if (_guestName.text.trim().isEmpty) {
      setState(() => _error = 'Enter the customer’s name.');
      return;
    }
    final v = WasherValidation.of(washer: _washer, name: _washedBy.text, phone: _phone.text, price: '0', needName: true);
    if (v.hasError) {
      setState(() {
        _nameError = v.name;
        _error = v.name ?? v.phone;
      });
      return;
    }
    setState(() {
      _error = null;
      _nameError = null;
    });

    final ok = await ref.read(laundryViewModelProvider.notifier).createLaundryOrder({
      'bookingId': stay?.bookingId,
      'roomId': stay?.roomId,
      'guestName': stay != null ? '' : _guestName.text.trim(),
      'guestPhone': stay != null ? '' : _guestPhone.text.trim(),
      'note': _note.text.trim(),
      'items': used.map((l) => {'name': l.name.trim(), 'price': num.parse(l.price), 'quantity': l.qty}).toList(),
      'washedBy': _washer == 'OWN' ? kOwnLaundry : _washedBy.text.trim(),
      'vendorPhone': _washer == 'VENDOR' ? _phone.text.trim() : '',
      'charge': null,
    });
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(laundryViewModelProvider).error ?? 'Could not save the order.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(laundryViewModelProvider);
    final starters = {..._commonGarments, ...state.recentGarments.map((g) => g.name)}.take(10).toList();

    return Scaffold(
      appBar: AppBar(title: const Text('New laundry')),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s16),
                children: [
                  if (_error != null) ...[
                    ErrorBanner(_error!),
                    const SizedBox(height: AppTheme.s16),
                  ],
                  NeuCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SectionLabel('Guest', number: 1),
                        const SizedBox(height: AppTheme.s12),
                        if (state.inHouseGuests.isNotEmpty) ...[
                          ToggleGroup(
                            options: const {'stay': 'Staying guest', 'walkin': 'Walk-in'},
                            selected: _mode,
                            onSelect: (v) => setState(() => _mode = v),
                          ),
                          const SizedBox(height: AppTheme.s12),
                        ],
                        if (_mode == 'stay')
                          OptionDropdown(
                            values: state.inHouseGuests.map((g) => '${g.bookingId}:${g.roomId}').toList(),
                            labels: {for (final g in state.inHouseGuests) '${g.bookingId}:${g.roomId}': 'Room ${g.roomNumber}, ${g.guestName}'},
                            selected: _stayKey,
                            onSelect: (v) => setState(() => _stayKey = v),
                            hint: 'Choose guest',
                          )
                        else
                          Row(
                            children: [
                              Expanded(child: NeuField(controller: _guestName, label: 'Name', forceCapitalizeWords: true)),
                              const SizedBox(width: AppTheme.s12),
                              Expanded(child: NeuField(controller: _guestPhone, label: 'Phone', keyboardType: TextInputType.phone)),
                            ],
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppTheme.s16),
                  NeuCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SectionLabel('Clothes', number: 2, trailing: 'Price per piece, GST included'),
                        const SizedBox(height: AppTheme.s12),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            for (final n in starters) ActionChip(label: Text('+ $n'), onPressed: () => _addLine(n)),
                            ActionChip(label: const Text('+ Other'), onPressed: () => _addLine('')),
                          ],
                        ),
                        const SizedBox(height: AppTheme.s12),
                        if (_lines.isEmpty)
                          const Text('Tap a garment above, or choose Other to type its name.', style: TextStyle(color: AppTheme.muted, fontSize: 12.5))
                        else
                          for (final l in _lines) _GarmentLineRow(line: l, onChanged: () => setState(() {}), onRemove: () => setState(() => _lines.remove(l))),
                        const SizedBox(height: AppTheme.s12),
                        NeuField(controller: _note, label: 'Note (stains, fragile …)'),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppTheme.s16),
                  NeuCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SectionLabel('Send to wash', number: 3),
                        const SizedBox(height: AppTheme.s12),
                        WasherFields(
                          washer: _washer,
                          onWasherChange: (w) => setState(() => _washer = w),
                          nameController: _washedBy,
                          phoneController: _phone,
                          priceController: _price,
                          priceLabel: 'Vendor’s total price, ₹',
                          needName: true,
                          nameError: _nameError,
                        ),
                        if (_washer == 'VENDOR') ...[
                          const SizedBox(height: AppTheme.s8),
                          Text(
                            'The vendor’s price is what the lodge pays, and can be filled in when the clothes come back. The guest pays ${formatPrice(_total)}.',
                            style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
            SafeArea(
              top: false,
              child: Container(
                padding: const EdgeInsets.all(AppTheme.s16),
                decoration: const BoxDecoration(color: AppTheme.card, border: Border(top: BorderSide(color: AppTheme.border))),
                child: Row(
                  children: [
                    Text('$_pieces ${_pieces == 1 ? 'piece' : 'pieces'}, ${formatPrice(_total)}', style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13)),
                    const Spacer(),
                    NeuButton(
                      primary: true,
                      onPressed: state.submitting ? null : _submit,
                      child: state.submitting
                          ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Text('Send to wash'),
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

class _GarmentLineRow extends StatelessWidget {
  final _Line line;
  final VoidCallback onChanged;
  final VoidCallback onRemove;

  const _GarmentLineRow({required this.line, required this.onChanged, required this.onRemove});

  @override
  Widget build(BuildContext context) {
    final nameController = TextEditingController(text: line.name)..selection = TextSelection.collapsed(offset: line.name.length);
    final priceController = TextEditingController(text: line.price)..selection = TextSelection.collapsed(offset: line.price.length);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            flex: 3,
            child: TextField(
              controller: nameController,
              decoration: const InputDecoration(isDense: true, hintText: 'Garment', border: OutlineInputBorder()),
              onChanged: (v) {
                line.name = v;
                onChanged();
              },
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            flex: 2,
            child: TextField(
              controller: priceController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(isDense: true, prefixText: '₹', hintText: 'Price', border: OutlineInputBorder()),
              onChanged: (v) {
                line.price = v;
                onChanged();
              },
            ),
          ),
          const SizedBox(width: 6),
          CountStepper(value: line.qty, onChange: (n) {
            if (n <= 0) {
              onRemove();
            } else {
              line.qty = n;
              onChanged();
            }
          }),
          IconButton(icon: const Icon(Icons.close_rounded, size: 18, color: AppTheme.muted), onPressed: onRemove),
        ],
      ),
    );
  }
}
