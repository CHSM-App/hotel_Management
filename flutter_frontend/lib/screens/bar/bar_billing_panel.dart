import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/bar.dart';
import '../../domain/models/draft.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/payment_row.dart';
import '../theme.dart';
import 'bar_bill_screen.dart';
import 'bar_common.dart';

/// Bill one open tab: receipt lines, customer, split payments — or post it to
/// a room's bill instead.
class BarIssueBillScreen extends ConsumerStatefulWidget {
  final BarTab tab;

  const BarIssueBillScreen({super.key, required this.tab});

  @override
  ConsumerState<BarIssueBillScreen> createState() => _BarIssueBillScreenState();
}

class _BarIssueBillScreenState extends ConsumerState<BarIssueBillScreen> {
  late final _customer = TextEditingController(text: widget.tab.guestName ?? '');
  final _discount = TextEditingController();
  late final List<PaymentDraft> _pay = [PaymentDraft(method: 'CASH', amount: widget.tab.subtotal.toStringAsFixed(2))];
  String? _error;

  @override
  void dispose() {
    _customer.dispose();
    _discount.dispose();
    super.dispose();
  }

  /// What the desk takes off, never more than the bill.
  double get _off => ((num.tryParse(_discount.text.trim()) ?? 0).toDouble()).clamp(0, widget.tab.subtotal).toDouble();
  double get _total => ((widget.tab.subtotal - _off) * 100).round() / 100;

  /// A single payment row follows the new total until the desk edits it.
  void _discountChanged() {
    if (_pay.length == 1) _pay.first.amount = _total.toStringAsFixed(2);
    setState(() {});
  }

  Future<void> _issue() async {
    final bad = paymentLinesError(_pay);
    if (bad != null) return setState(() => _error = bad);
    final paid = sumPayments(_pay);
    if ((paid - _total).abs() > 0.009) {
      return setState(() => _error = 'Payments add up to ${formatPrice(paid)}, but the bill is ${formatPrice(_total)}.');
    }
    setState(() => _error = null);
    final vm = ref.read(barViewModelProvider.notifier);
    final bill = await vm.issueBill(
      orderIds: widget.tab.orderIds,
      customerName: _customer.text,
      discountAmount: _off,
      payments: [
        for (final p in _pay) (method: p.method!, amount: p.value.toDouble(), reference: p.reference.trim().isEmpty ? null : p.reference.trim()),
      ],
    );
    if (!mounted) return;
    if (bill != null) {
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => BarBillScreen(bill: bill)));
    } else {
      setState(() => _error = ref.read(barViewModelProvider).error);
    }
  }

  Future<void> _toRoom() async {
    final vm = ref.read(barViewModelProvider.notifier);
    final t = widget.tab;
    BarGuest? g;
    if (t.source == 'ROOM' && t.roomId != null && t.bookingId != null) {
      g = BarGuest(roomId: t.roomId!, roomNumber: t.label.replaceFirst('Room ', ''), bookingId: t.bookingId!);
    } else {
      await vm.loadTargets();
      if (!mounted) return;
      g = await pickBarRoom(context, ref.read(barViewModelProvider).targets.guests);
    }
    if (g == null || !mounted) return;
    final guest = g;
    final discount = await askBarDiscount(context);
    if (discount == null || !mounted) return;
    final ok = await vm.addToRoom(t.orderIds, guest.bookingId, guest.roomId, discount: discount);
    if (!mounted) return;
    if (ok) {
      await vm.loadTabs();
      if (!mounted) return;
      barSnack(context, 'Added to Room ${guest.roomNumber} bill.');
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(barViewModelProvider).error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.tab;
    final bar = ref.watch(barViewModelProvider);
    final tax = bar.taxPercent;
    // Drinks and food give up the discount in proportion, so tax is on what is left.
    final netDrinks = t.subtotal > 0 ? t.drinksTotal * _total / t.subtotal : 0.0;
    final drinkTax = netDrinks - netDrinks / (1 + tax / 100);
    final paid = sumPayments(_pay);
    final diff = _total - paid;
    Widget line(String l, double v) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(children: [Expanded(child: Text(l)), Text(formatPrice(v), style: const TextStyle(fontWeight: FontWeight.w600))]),
    );
    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(title: Text(t.label)),
      body: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: AppTheme.formMaxWidth(context)),
          child: ListView(
            padding: EdgeInsets.all(AppTheme.gutter(context)),
            children: [
              BarSection(
                title: 'Bill',
                child: Column(
                  children: [
                    for (final i in t.items) line('${i.name} · ${i.size} × ${i.quantity}', i.lineTotal),
                    for (final f in t.foodItems) line('${f.name}${f.portion == null ? '' : ' · ${f.portion}'} × ${f.quantity}', f.lineTotal),
                    const Divider(),
                    if (t.drinksTotal > 0) line('Drinks include tax (${tax.toStringAsFixed(tax % 1 == 0 ? 0 : 2)}%)', drinkTax),
                    if (t.foodTotal > 0) line('Food total (GST added if registered)', t.foodTotal),
                    if (_off > 0) line('Discount', -_off),
                    Row(children: [const Expanded(child: Text('Total', style: TextStyle(fontWeight: FontWeight.w900))), Text(formatPrice(_total), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16))]),
                  ],
                ),
              ),
              const SizedBox(height: AppTheme.s12),
              BarSection(
                title: 'Payment',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    NeuField(controller: _customer, label: 'Customer name (optional)', dense: true),
                    const SizedBox(height: AppTheme.s8),
                    NeuField(controller: _discount, label: 'Discount (optional)', hint: '0', keyboardType: TextInputType.number, dense: true, onChanged: (_) => _discountChanged()),
                    const SizedBox(height: AppTheme.s8),
                    for (var i = 0; i < _pay.length; i++)
                      PaymentRow(
                        key: ObjectKey(_pay[i]),
                        line: _pay[i],
                        compact: true,
                        onRemove: _pay.length > 1 ? () => setState(() => _pay.removeAt(i)) : null,
                        onChanged: () => setState(() {}),
                      ),
                    if (_pay.length < 5) TextButton.icon(onPressed: () => setState(() => _pay.add(PaymentDraft())), icon: const Icon(Icons.add_rounded), label: const Text('Split payment')),
                    if (diff.abs() > 0.009) Text(diff > 0 ? '${formatPrice(diff)} still to collect' : '${formatPrice(-diff)} over the total', style: const TextStyle(color: AppTheme.muted)),
                  ],
                ),
              ),
              if (_error != null) Padding(padding: const EdgeInsets.only(top: AppTheme.s8), child: Text(_error!, style: const TextStyle(color: AppTheme.danger))),
              const SizedBox(height: AppTheme.s16),
              NeuButton(onPressed: bar.submitting ? null : _toRoom, expand: true, child: const Text('Add to room bill instead')),
              const SizedBox(height: AppTheme.s8),
              NeuButton(
                primary: true,
                expand: true,
                onPressed: bar.submitting ? null : _issue,
                child: Text(bar.submitting ? 'Issuing bill…' : 'Issue bill · ${formatPrice(_total)}'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
