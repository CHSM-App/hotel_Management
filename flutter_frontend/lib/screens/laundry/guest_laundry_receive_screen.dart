import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/laundry.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'laundry_parts.dart';

/// Receive a guest's clothes back from the wash — mirrors the 'receive'
/// modal in LaundryPanel.jsx's GuestLaundryTab: check the list, confirm who
/// washed it, settle each garment's price, then mark received.
Future<void> showGuestLaundryReceiveScreen(BuildContext context, LaundryOrder order) {
  return Navigator.of(context).push(MaterialPageRoute(builder: (_) => GuestLaundryReceiveScreen(order: order)));
}

class GuestLaundryReceiveScreen extends ConsumerStatefulWidget {
  final LaundryOrder order;
  const GuestLaundryReceiveScreen({super.key, required this.order});

  @override
  ConsumerState<GuestLaundryReceiveScreen> createState() => _GuestLaundryReceiveScreenState();
}

class _GuestLaundryReceiveScreenState extends ConsumerState<GuestLaundryReceiveScreen> {
  String _washer = 'OWN';
  late final _washedBy = TextEditingController();
  late final _phone = TextEditingController();
  late final _price = TextEditingController();
  final Map<int, TextEditingController> _prices = {};
  String? _error;
  String? _nameError;
  String? _phoneError;
  String? _priceError;

  @override
  void initState() {
    super.initState();
    final order = widget.order;
    final own = (order.washedBy ?? '').trim().toLowerCase() == kOwnLaundry.toLowerCase();
    _washer = own ? 'OWN' : 'VENDOR';
    _washedBy.text = own ? '' : (order.washedBy ?? '');
    _phone.text = order.vendorPhone ?? '';
    _price.text = order.washCharge?.toString() ?? '';
    for (final item in order.items) {
      _prices[item.id] = TextEditingController(text: item.unitPrice.toString());
    }
  }

  @override
  void dispose() {
    _washedBy.dispose();
    _phone.dispose();
    _price.dispose();
    for (final c in _prices.values) {
      c.dispose();
    }
    super.dispose();
  }

  num _amountOf(LaundryOrderItem item) => (num.tryParse(_prices[item.id]!.text) ?? 0) * item.quantity;

  num get _total => widget.order.items.fold(0, (n, i) => n + _amountOf(i));

  Future<void> _submit() async {
    final order = widget.order;
    for (final item in order.items) {
      final price = _prices[item.id]!.text;
      if (price.isEmpty || num.tryParse(price) == null || num.parse(price) < 0) {
        setState(() => _error = 'Enter the price for ${item.name}.');
        return;
      }
    }
    final v = WasherValidation.of(washer: _washer, name: _washedBy.text, phone: _phone.text, price: _price.text, needName: true, needPrice: true);
    if (v.hasError) {
      setState(() {
        _nameError = v.name;
        _phoneError = v.phone;
        _priceError = v.price;
        _error = v.name ?? v.phone ?? v.price;
      });
      return;
    }
    setState(() {
      _error = null;
      _nameError = null;
      _phoneError = null;
      _priceError = null;
    });

    final ok = await ref.read(laundryViewModelProvider.notifier).setLaundryStatus(order.id, {
      'status': 'READY',
      'washedBy': _washer == 'OWN' ? kOwnLaundry : _washedBy.text.trim(),
      'vendorPhone': _washer == 'VENDOR' ? _phone.text.trim() : '',
      'charge': _washer == 'VENDOR' ? num.tryParse(_price.text.trim()) : null,
      'items': order.items.map((item) => {'id': item.id, 'price': num.parse(_prices[item.id]!.text)}).toList(),
    });
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(laundryViewModelProvider).error ?? 'Could not mark the order received.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final order = widget.order;
    final state = ref.watch(laundryViewModelProvider);

    return Scaffold(
      appBar: AppBar(title: Text('Receive from wash · tag ${order.tagNumber}')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
          children: [
            if (_error != null) ...[
              ErrorBanner(_error!),
              const SizedBox(height: AppTheme.s16),
            ],
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Order', style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: AppTheme.s8),
                  _Fact('Guest', order.guestName.isEmpty ? '—' : order.guestName),
                  _Fact('Room', order.roomNumber ?? 'Walk-in'),
                  if ((order.note ?? '').isNotEmpty) _Fact('Note', order.note!),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s16),
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Clothes · prices can be changed', style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: AppTheme.s8),
                  for (final item in order.items)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        children: [
                          Expanded(flex: 3, child: Text('${item.name} ×${item.quantity}', style: const TextStyle(color: AppTheme.heading, fontSize: 13))),
                          SizedBox(
                            width: 90,
                            child: TextField(
                              controller: _prices[item.id],
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(isDense: true, prefixText: '₹', border: OutlineInputBorder()),
                              onChanged: (_) => setState(() {}),
                            ),
                          ),
                          const SizedBox(width: AppTheme.s8),
                          SizedBox(width: 70, child: Text(formatPrice(_amountOf(item)), textAlign: TextAlign.right, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 12.5))),
                        ],
                      ),
                    ),
                  const Divider(color: AppTheme.border),
                  Row(
                    children: [
                      const Expanded(child: Text('Guest pays', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13))),
                      Text(formatPrice(_total), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w800, fontSize: 15)),
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
                  Text('Washed by', style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: AppTheme.s12),
                  WasherFields(
                    washer: _washer,
                    onWasherChange: (w) => setState(() => _washer = w),
                    nameController: _washedBy,
                    phoneController: _phone,
                    priceController: _price,
                    priceLabel: 'Vendor’s total price, ₹',
                    needName: true,
                    needPrice: true,
                    nameError: _nameError,
                    phoneError: _phoneError,
                    priceError: _priceError,
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s24),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: state.submitting ? null : _submit,
              child: state.submitting
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Mark received'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  final String label;
  final String value;
  const _Fact(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 60, child: Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 12))),
          Expanded(child: Text(value, style: const TextStyle(color: AppTheme.text, fontSize: 13))),
        ],
      ),
    );
  }
}
