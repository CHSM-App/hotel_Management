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
  return Navigator.of(
    context,
  ).push(MaterialPageRoute(builder: (_) => const GuestLaundryFormScreen()));
}

class _Line {
  int key;
  String name;
  String price;
  int qty;
  _Line({required this.key, this.name = '', this.price = '', this.qty = 1});
}

const _commonGarments = [
  'Shirt',
  'T-shirt',
  'Trousers',
  'Jeans',
  'Saree',
  'Kurta',
  'Towel',
  'Bedsheet',
];

class GuestLaundryFormScreen extends ConsumerStatefulWidget {
  const GuestLaundryFormScreen({super.key});

  @override
  ConsumerState<GuestLaundryFormScreen> createState() =>
      _GuestLaundryFormScreenState();
}

class _GuestLaundryFormScreenState
    extends ConsumerState<GuestLaundryFormScreen> {
  final _scrollController = ScrollController();
  final _guestKey = GlobalKey();

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
  final _price =
      TextEditingController(); // unused for guest laundry — price is per garment
  String? _error;
  String? _nameError;

  /// Whether Send-to-wash has been pressed at least once — a field that
  /// hasn't been submitted yet has nothing to be wrong about, so nothing
  /// turns red until the desk actually tries to save. Mirrors the same
  /// pattern the booking and room forms use: the message sits under the
  /// field it's about instead of a generic banner at the top of the page.
  bool _submitAttempted = false;

  String? get _guestNameError {
    if (!_submitAttempted || _mode != 'walkin') return null;
    return _guestName.text.trim().isEmpty ? 'Enter the customer’s name.' : null;
  }

  String? get _stayError {
    if (!_submitAttempted || _mode != 'stay') return null;
    return _stayKey == null ? 'Choose the guest.' : null;
  }

  @override
  void initState() {
    super.initState();
    final state = ref.read(laundryViewModelProvider);
    _mode = state.inHouseGuests.isNotEmpty ? 'stay' : 'walkin';
    final orders = state.orders
        .where((o) => o.washedBy != null && o.washedBy!.isNotEmpty)
        .toList();
    final last = orders.isNotEmpty ? orders.first : null;
    final own =
        (last?.washedBy ?? '').trim().toLowerCase() ==
        kOwnLaundry.toLowerCase();
    _washer = last == null ? 'OWN' : (own ? 'OWN' : 'VENDOR');
    if (!own) _washedBy.text = last?.washedBy ?? '';
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _guestName.dispose();
    _guestPhone.dispose();
    _note.dispose();
    _washedBy.dispose();
    _phone.dispose();
    _price.dispose();
    super.dispose();
  }

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

  // Tapping a garment adds a row with the price left empty, to be typed for
  // this order. It used to be filled in with whatever that garment cost last
  // time, and a stale price carried onto a new order went unnoticed. Tapping
  // the same one again adds a piece instead of a second row.
  void _addLine(String name) {
    if (name.isNotEmpty) {
      final existing = _lines.where(
        (l) => l.name.toLowerCase() == name.toLowerCase(),
      );
      if (existing.isNotEmpty) {
        setState(() => existing.first.qty += 1);
        return;
      }
    }
    setState(() => _lines.add(_Line(key: _nextKey++, name: name)));
  }

  num get _total =>
      _lines.fold(0, (n, l) => n + (num.tryParse(l.price) ?? 0) * l.qty);
  int get _pieces => _lines.fold(0, (n, l) => n + l.qty);

  Future<void> _submit() async {
    final state = ref.read(laundryViewModelProvider);
    setState(() => _submitAttempted = true);

    // Checked in the order the form asks them — Guest first, then Clothes —
    // so a bad guest field turns red under its own box instead of only
    // being named in a banner floating above everything.
    if (_stayError != null || _guestNameError != null) {
      _scrollToError(_guestKey);
      return;
    }

    final used = _lines
        .where((l) => l.name.trim().isNotEmpty || l.price.isNotEmpty)
        .toList();
    if (used.isEmpty) {
      setState(() => _error = 'Add the garments being handed in.');
      return;
    }
    for (final l in used) {
      if (l.name.trim().isEmpty) {
        setState(() => _error = 'Enter the garment name on every row.');
        return;
      }
      if (l.price.isEmpty ||
          num.tryParse(l.price) == null ||
          num.parse(l.price) < 0) {
        setState(() => _error = 'Enter the price for ${l.name.trim()}.');
        return;
      }
    }
    LaundryGuestStay? stay;
    if (_mode == 'stay') {
      stay = state.inHouseGuests
          .where((g) => '${g.bookingId}:${g.roomId}' == _stayKey)
          .firstOrNull;
    }
    final v = WasherValidation.of(
      washer: _washer,
      name: _washedBy.text,
      phone: _phone.text,
      price: '0',
      needName: true,
    );
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

    final ok = await ref
        .read(laundryViewModelProvider.notifier)
        .createLaundryOrder({
          'bookingId': stay?.bookingId,
          'roomId': stay?.roomId,
          'guestName': stay != null ? '' : _guestName.text.trim(),
          'guestPhone': stay != null ? '' : _guestPhone.text.trim(),
          'note': _note.text.trim(),
          'items': used
              .map(
                (l) => {
                  'name': l.name.trim(),
                  'price': num.parse(l.price),
                  'quantity': l.qty,
                },
              )
              .toList(),
          'washedBy': _washer == 'OWN' ? kOwnLaundry : _washedBy.text.trim(),
          'vendorPhone': _washer == 'VENDOR' ? _phone.text.trim() : '',
          'charge': null,
        });
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(
        () => _error =
            ref.read(laundryViewModelProvider).error ??
            'Could not save the order.',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(laundryViewModelProvider);
    final starters = {
      ..._commonGarments,
      ...state.recentGarments.map((g) => g.name),
    }.take(10).toList();

    return Scaffold(
      appBar: AppBar(
        titleSpacing: AppTheme.s4,
        title: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [AppTheme.accent, Color(0xFF10499A)],
                ),
                borderRadius: BorderRadius.circular(AppTheme.rSmall + 2),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x331457AD),
                    offset: Offset(0, 3),
                    blurRadius: 8,
                  ),
                ],
              ),
              child: const Icon(
                Icons.local_laundry_service_rounded,
                color: Colors.white,
                size: 18,
              ),
            ),
            const SizedBox(width: AppTheme.s12),
            const Expanded(
              child: Text('New laundry', overflow: TextOverflow.ellipsis, maxLines: 1),
            ),
          ],
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(3),
          child: Container(
            height: 3,
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [AppTheme.accent, Color(0x001457AD)],
              ),
            ),
          ),
        ),
      ),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: AppTheme.maxContentWidth),
            child: ListView(
              controller: _scrollController,
              padding: const EdgeInsets.fromLTRB(
                AppTheme.s12,
                AppTheme.s12,
                AppTheme.s12,
                AppTheme.s16,
              ),
              children: [
                if (_error != null) ...[
                  ErrorBanner(_error!),
                  const SizedBox(height: AppTheme.s12),
                ],
                NeuCard(
                  radius: AppTheme.rLarge,
                  shadow: AppTheme.elevated,
                  padding: const EdgeInsets.all(AppTheme.s16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SectionLabel('Guest', number: 1, icon: Icons.person_rounded),
                      const SizedBox(height: AppTheme.s12),
                      if (state.inHouseGuests.isNotEmpty) ...[
                        ToggleGroup(
                          options: const {
                            'stay': 'Staying guest',
                            'walkin': 'Walk-in',
                          },
                          selected: _mode,
                          onSelect: (v) => setState(() => _mode = v),
                        ),
                        const SizedBox(height: AppTheme.s12),
                      ],
                      KeyedSubtree(
                        key: _guestKey,
                        child: _mode == 'stay'
                            ? Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  OptionDropdown(
                                    values: state.inHouseGuests
                                        .map((g) => '${g.bookingId}:${g.roomId}')
                                        .toList(),
                                    labels: {
                                      for (final g in state.inHouseGuests)
                                        '${g.bookingId}:${g.roomId}':
                                            'Room ${g.roomNumber}, ${g.guestName}',
                                    },
                                    selected: _stayKey,
                                    hasError: _stayError != null,
                                    onSelect: (v) => setState(() => _stayKey = v),
                                    hint: 'Choose guest',
                                  ),
                                  if (_stayError != null) ...[
                                    const SizedBox(height: AppTheme.s4),
                                    Text(_stayError!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
                                  ],
                                ],
                              )
                            : Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: NeuField(
                                controller: _guestName,
                                label: 'Name',
                                required: true,
                                errorText: _guestNameError,
                                forceCapitalizeWords: true,
                                onChanged: (_) => setState(() {}),
                                dense: true,
                              ),
                            ),
                            const SizedBox(width: AppTheme.s12),
                            Expanded(
                              child: NeuField(
                                controller: _guestPhone,
                                label: 'Phone',
                                keyboardType: TextInputType.phone,
                                dense: true,
                              ),
                            ),
                          ],
                        ),
                      ),

                      const SectionDivider(),
                      const SectionLabel('Clothes', number: 2, icon: Icons.checkroom_rounded),
                      const SizedBox(height: 2),
                      const Text(
                        'Price per piece, GST included',
                        style: TextStyle(color: AppTheme.muted, fontSize: 11.5),
                      ),
                      const SizedBox(height: AppTheme.s12),
                      Wrap(
                        spacing: AppTheme.s8,
                        runSpacing: AppTheme.s8,
                        children: [
                          for (final n in starters)
                            _GarmentChip(label: n, onTap: () => _addLine(n)),
                          _GarmentChip(label: 'Other', outline: true, onTap: () => _addLine('')),
                        ],
                      ),
                      const SizedBox(height: AppTheme.s12),
                      if (_lines.isEmpty)
                        const Text(
                          'Tap a garment above, or choose Other to type its name.',
                          style: TextStyle(color: AppTheme.muted, fontSize: 12.5),
                        )
                      else
                        for (final l in _lines)
                          _GarmentLineRow(
                            line: l,
                            onChanged: () => setState(() {}),
                            onRemove: () => setState(() => _lines.remove(l)),
                          ),
                      const SizedBox(height: AppTheme.s12),
                      NeuField(
                        controller: _note,
                        label: 'Note (stains, fragile …)',
                        dense: true,
                      ),

                      const SectionDivider(),
                      const SectionLabel('Send to wash', number: 3, icon: Icons.local_shipping_rounded),
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
                          style: const TextStyle(
                            color: AppTheme.muted,
                            fontSize: 11.5,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: AppTheme.s16),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppTheme.s16,
                    vertical: AppTheme.s12,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.sidebarBrandWash,
                    borderRadius: BorderRadius.circular(AppTheme.rMedium),
                    border: Border.all(color: AppTheme.sidebarBrandWashEdge),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.local_laundry_service_rounded,
                        size: 20,
                        color: AppTheme.sidebarBrandInk,
                      ),
                      const SizedBox(width: AppTheme.s8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '$_pieces ${_pieces == 1 ? 'piece' : 'pieces'}',
                              style: const TextStyle(
                                color: AppTheme.sidebarBrandInk,
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            Text(
                              formatPrice(_total),
                              style: const TextStyle(
                                color: AppTheme.heading,
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppTheme.s12),
                NeuButton(
                  primary: true,
                  expand: true,
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
                      : const Text('Send to wash'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A garment pick, as its own small pill button rather than Material's
/// default [ActionChip] — a "+" mark, accent-tinted fill and border for a
/// common garment, a muted dashed-feeling outline for "Other", so the row
/// reads as a set of quick-add buttons instead of a stock chip list.
class _GarmentChip extends StatelessWidget {
  final String label;
  final bool outline;
  final VoidCallback onTap;

  const _GarmentChip({required this.label, this.outline = false, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: outline ? AppTheme.bg : AppTheme.accent.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: outline ? AppTheme.border : AppTheme.accent.withValues(alpha: 0.35),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.add_rounded,
                size: 15,
                color: outline ? AppTheme.muted : AppTheme.accent,
              ),
              const SizedBox(width: 3),
              Text(
                label,
                style: TextStyle(
                  color: outline ? AppTheme.text : AppTheme.accent,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _GarmentLineRow extends StatelessWidget {
  final _Line line;
  final VoidCallback onChanged;
  final VoidCallback onRemove;

  const _GarmentLineRow({
    required this.line,
    required this.onChanged,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    final nameController = TextEditingController(text: line.name)
      ..selection = TextSelection.collapsed(offset: line.name.length);
    final priceController = TextEditingController(text: line.price)
      ..selection = TextSelection.collapsed(offset: line.price.length);
    return Container(
      margin: const EdgeInsets.only(bottom: AppTheme.s8),
      padding: const EdgeInsets.all(AppTheme.s8),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // The garment name on its own full-width line — cramming it
          // alongside the price, stepper and close button left it clipped
          // to a few letters ("Kur…") on a phone-width screen.
          Row(
            children: [
              Expanded(
                child: NeuPressed(
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                  child: TextField(
                    controller: nameController,
                    style: const TextStyle(color: AppTheme.heading, fontSize: 14),
                    decoration: const InputDecoration(
                      isDense: true,
                      border: InputBorder.none,
                      hintText: 'Garment',
                      hintStyle: TextStyle(color: AppTheme.muted, fontSize: 13),
                      contentPadding: EdgeInsets.symmetric(vertical: AppTheme.s8),
                    ),
                    onChanged: (v) {
                      line.name = v;
                      onChanged();
                    },
                  ),
                ),
              ),
              IconButton(
                icon: const Icon(
                  Icons.close_rounded,
                  size: 18,
                  color: AppTheme.muted,
                ),
                onPressed: onRemove,
                splashRadius: 18,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          // Price and quantity on their own line, each with room to actually
          // read — an empty price box with nothing but a lone ₹ gave no clue
          // whether it had been filled in or not.
          Row(
            children: [
              SizedBox(
                width: 110,
                child: NeuPressed(
                  padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                  child: TextField(
                    controller: priceController,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: AppTheme.heading, fontSize: 14, fontWeight: FontWeight.w600),
                    decoration: const InputDecoration(
                      isDense: true,
                      border: InputBorder.none,
                      prefixText: '₹ ',
                      prefixStyle: TextStyle(color: AppTheme.muted, fontSize: 13, fontWeight: FontWeight.w600),
                      hintText: 'Price',
                      hintStyle: TextStyle(color: AppTheme.muted, fontSize: 13),
                      contentPadding: EdgeInsets.symmetric(vertical: AppTheme.s8),
                    ),
                    onChanged: (v) {
                      line.price = v;
                      onChanged();
                    },
                  ),
                ),
              ),
              const Spacer(),
              CountStepper(
                value: line.qty,
                onChange: (n) {
                  if (n <= 0) {
                    onRemove();
                  } else {
                    line.qty = n;
                    onChanged();
                  }
                },
              ),
            ],
          ),
        ],
      ),
    );
  }
}
