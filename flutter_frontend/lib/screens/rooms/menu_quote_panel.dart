import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/dio_provider.dart';
import '../../presentation/view_models/rooms_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'quotation_send.dart';
import 'quote_common.dart';

/// One thing that can go on a food / bar quotation: a dish (or one size of
/// it) or one bar size. [payload] is what the server wants for that line,
/// minus the quantity.
class _Entry {
  final String key;
  final String group;
  final String name;
  final num price;
  final Map<String, dynamic> payload;

  const _Entry(this.key, this.group, this.name, this.price, this.payload);
}

/// New FOOD or BAR quotation: pick items and quantities, optionally a
/// discount. Prices shown are the menu's today; the server prices the lines
/// again on save, so what is stored is its answer.
class MenuQuotePanel extends ConsumerStatefulWidget {
  /// 'FOOD' or 'BAR'.
  final String kind;
  final VoidCallback? onSaved;

  const MenuQuotePanel({super.key, required this.kind, this.onSaved});

  @override
  ConsumerState<MenuQuotePanel> createState() => _MenuQuotePanelState();
}

class _MenuQuotePanelState extends ConsumerState<MenuQuotePanel> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _search = TextEditingController();
  final _discount = TextEditingController();
  final _note = TextEditingController();

  List<_Entry>? _entries;
  final Map<String, int> _qty = {};
  String? _loadError;
  String? _error;
  bool _saving = false;
  bool _phoneChecked = false;

  bool get _isBar => widget.kind == 'BAR';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in [_name, _phone, _search, _discount, _note]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    final api = ref.read(apiServiceProvider);
    try {
      final entries = <_Entry>[];
      if (_isBar) {
        final menu = await api.barMenu();
        final cats = {for (final c in menu.categories) c.id: c.name};
        for (final p in menu.products.where((p) => p.isActive)) {
          for (final s in p.sizes.where((s) => s.isActive && s.isAvailable)) {
            entries.add(_Entry('b${s.id}', cats[p.categoryId] ?? 'Bar', '${p.name} ${s.label}', s.price, {'menuItemId': s.id}));
          }
        }
      } else {
        for (final sec in await api.menu()) {
          if (!sec.isActive) continue;
          for (final i in sec.items.where((i) => i.isActive && i.isAvailable)) {
            if (i.portions.isEmpty) {
              entries.add(_Entry('f${i.id}', sec.name, i.name, i.price, {'itemId': i.id}));
            } else {
              for (final pt in i.portions.where((pt) => pt.isAvailable)) {
                entries.add(_Entry('f${i.id}p${pt.id}', sec.name, '${i.name} · ${pt.label}', pt.price, {'itemId': i.id, 'portionId': pt.id}));
              }
            }
          }
        }
      }
      if (mounted) setState(() => _entries = entries);
    } catch (e) {
      if (mounted) setState(() => _loadError = RoomsViewModel.messageFor(e));
    }
  }

  num get _subtotal => (_entries ?? const <_Entry>[]).fold<num>(0, (sum, e) => sum + e.price * (_qty[e.key] ?? 0));
  num get _discountAmount => (num.tryParse(_discount.text.trim()) ?? 0).clamp(0, _subtotal);

  void _bump(String key, int by) => setState(() {
    final next = (_qty[key] ?? 0) + by;
    if (next <= 0) {
      _qty.remove(key);
    } else {
      _qty[key] = next.clamp(1, 999);
    }
  });

  Future<void> _save({bool whatsApp = false}) async {
    if (phoneInvalid(_phone.text)) {
      setState(() => _phoneChecked = true);
      return;
    }
    final picked = [for (final e in _entries!) if ((_qty[e.key] ?? 0) > 0) {...e.payload, 'quantity': _qty[e.key]}];
    if (picked.isEmpty) {
      setState(() => _error = 'Add at least one item.');
      return;
    }
    setState(() {
      _error = null;
      _saving = true;
    });
    try {
      final saved = await ref.read(apiServiceProvider).saveKindQuotation({
        'kind': widget.kind,
        if (_name.text.trim().isNotEmpty) 'guestName': _name.text.trim(),
        if (digitsOnly(_phone.text).isNotEmpty) 'guestPhone': digitsOnly(_phone.text),
        'items': picked,
        if (_discount.text.trim().isNotEmpty) 'discountAmount': num.tryParse(_discount.text.trim()) ?? 0,
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Quotation saved.'), backgroundColor: AppTheme.heading),
      );
      // Send before leaving this form: the list that follows would dispose it.
      if (whatsApp) {
        await sendSavedQuotation(ref, saved, (m) {
          if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m), backgroundColor: AppTheme.heading));
        });
      }
      widget.onSaved?.call();
    } catch (e) {
      if (mounted) setState(() => _error = RoomsViewModel.messageFor(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final entries = _entries;
    if (_loadError != null) return NeuNotice(icon: Icons.cloud_off_rounded, message: _loadError!);
    if (entries == null) return const Center(child: CircularProgressIndicator());

    final needle = _search.text.trim().toLowerCase();
    final shown = [for (final e in entries) if (needle.isEmpty || e.name.toLowerCase().contains(needle) || e.group.toLowerCase().contains(needle)) e];
    final total = _subtotal - _discountAmount;
    final count = _qty.values.fold<int>(0, (a, b) => a + b);

    final main = <Widget>[
              QuoteSection(
                icon: _isBar ? Icons.local_bar_rounded : Icons.restaurant_menu_rounded,
                title: _isBar ? 'Bar items' : 'Menu items',
                hint: count == 0 ? 'Tap + to add.' : '$count item${count == 1 ? '' : 's'} added.',
                children: [
                  NeuField(controller: _search, label: '', hint: _isBar ? 'Search bar items' : 'Search the menu', dense: true, onChanged: (_) => setState(() {})),
                  const SizedBox(height: AppTheme.s8),
                  if (shown.isEmpty)
                    const NeuNotice(icon: Icons.search_off_rounded, message: 'Nothing matches.')
                  else
                    for (var i = 0; i < shown.length; i++) ...[
                      if (i > 0) const Divider(height: 1, color: AppTheme.sidebarBorder),
                      _itemRow(shown[i]),
                    ],
                ],
              ),
    ];
    final side = <Widget>[
              QuoteSection(
                icon: Icons.person_outline_rounded,
                title: 'Customer',
                hint: 'Shown under "Prepared for" on the quotation. Both are optional.',
                children: [QuoteGuestFields(name: _name, phone: _phone, showPhoneError: _phoneChecked)],
              ),
              const SizedBox(height: AppTheme.s12),
              QuoteSection(
                icon: Icons.receipt_long_rounded,
                title: 'Summary',
                children: [
                  QuoteRow([
                    NeuField(controller: _discount, label: 'Discount (₹)', hint: 'Optional', keyboardType: TextInputType.number, dense: true, onChanged: (_) => setState(() {})),
                    NeuField(controller: _note, label: 'Note', hint: 'Printed on the quotation', dense: true),
                  ]),
                  const Divider(height: AppTheme.s24, color: AppTheme.sidebarBorder),
                  if (_discountAmount > 0) ...[
                    Row(
                      children: [
                        const Expanded(child: Text('Subtotal', style: TextStyle(fontSize: 13.5, color: AppTheme.text))),
                        Text(formatPrice(_subtotal), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        const Expanded(child: Text('Discount', style: TextStyle(fontSize: 13.5, color: AppTheme.text))),
                        Text('− ${formatPrice(_discountAmount)}', style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
                      ],
                    ),
                    const SizedBox(height: AppTheme.s8),
                  ],
                  Row(
                    children: [
                      const Expanded(child: Text('Total', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: AppTheme.heading))),
                      Text(formatPrice(total), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20, color: AppTheme.sidebarBrand)),
                    ],
                  ),
                  if (_isBar) const Text('Prices include tax.', style: TextStyle(color: AppTheme.muted, fontSize: 11.5)),
                ],
              ),
              if (_error != null) ...[
                const SizedBox(height: AppTheme.s8),
                Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12.5)),
              ],
              const SizedBox(height: AppTheme.s16),
              QuoteSaveButton(saving: _saving, onPressed: _qty.isEmpty ? null : _save),
              const SizedBox(height: AppTheme.s8),
              QuoteWhatsAppButton(busy: _saving, onPressed: _qty.isEmpty ? null : () => _save(whatsApp: true)),
    ];
    return QuoteTwoColumn(main: main, side: side);
  }

  Widget _itemRow(_Entry e) {
    final n = _qty[e.key] ?? 0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(e.name, style: TextStyle(fontWeight: n > 0 ? FontWeight.w800 : FontWeight.w600, fontSize: 14, color: AppTheme.heading)),
                Text('${e.group} · ${formatPrice(e.price)}', style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
              ],
            ),
          ),
          if (n > 0) ...[
            IconButton(visualDensity: VisualDensity.compact, onPressed: () => _bump(e.key, -1), icon: const Icon(Icons.remove_circle_outline_rounded)),
            SizedBox(width: 28, child: Text('$n', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
          ],
          IconButton(visualDensity: VisualDensity.compact, onPressed: () => _bump(e.key, 1), icon: const Icon(Icons.add_circle_rounded, color: AppTheme.sidebarBrand)),
        ],
      ),
    );
  }
}
