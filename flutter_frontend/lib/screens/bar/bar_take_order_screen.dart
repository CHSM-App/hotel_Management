import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/bar.dart';
import '../../domain/models/menu.dart';
import '../../domain/models/receipt_doc.dart';
import '../printing/thermal_print_action.dart';
import '../../presentation/providers/usecase_provider.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/bar_viewmodel.dart';
import '../../widgets/adaptive_grid.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/pill_tabs.dart';
import '../theme.dart';
import 'bar_common.dart';

/// Take a bar order — drinks and, optionally, restaurant dishes — or add more
/// to an open one ([existing]). Mirrors BarTakeOrder.jsx.
class BarTakeOrderScreen extends ConsumerStatefulWidget {
  final BarOrder? existing;

  const BarTakeOrderScreen({super.key, this.existing});

  @override
  ConsumerState<BarTakeOrderScreen> createState() => _BarTakeOrderScreenState();
}

class _BarTakeOrderScreenState extends ConsumerState<BarTakeOrderScreen> {
  String _source = 'COUNTER';
  int? _tableId;
  BarGuest? _guest;
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _search = TextEditingController();

  bool _food = false;
  int? _category; // null = all
  final Map<int, int> _drinkQty = {}; // size id -> qty
  final Map<String, int> _foodQty = {}; // 'item:portion' -> qty
  List<MenuSection> _sections = const [];
  String? _error;
  bool _busy = false;

  /// Set while the review sheet is open, so a quantity changed inside it
  /// redraws the sheet too (it lives outside this widget's own build).
  VoidCallback? _sheetRefresh;

  void _edit(VoidCallback change) {
    setState(change);
    _sheetRefresh?.call();
  }

  bool get _adding => widget.existing != null;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(barSetupViewModelProvider.notifier).load();
      if (!_adding) ref.read(barViewModelProvider.notifier).loadTargets();
      ref.read(barUsecaseProvider).foodMenu().then((s) {
        if (mounted) setState(() => _sections = s);
      }).catchError((_) {
        // Dishes are optional; the Food switch simply stays empty.
      });
    });
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _search.dispose();
    super.dispose();
  }

  Map<int, (BarProduct, BarSize)> _sizeIndex(BarMenu menu) => {
    for (final p in menu.products)
      for (final s in p.sizes) s.id: (p, s),
  };

  double _total(BarMenu menu) {
    final idx = _sizeIndex(menu);
    var t = 0.0;
    _drinkQty.forEach((id, q) => t += (idx[id]?.$2.price ?? 0) * q);
    for (final sec in _sections) {
      for (final i in sec.items) {
        if (i.hasPortions) {
          for (final p in i.portions) {
            t += (_foodQty['${i.id}:${p.id}'] ?? 0) * p.price;
          }
        } else {
          t += (_foodQty['${i.id}:0'] ?? 0) * i.price;
        }
      }
    }
    return t;
  }

  int get _lines => _drinkQty.values.where((q) => q > 0).length + _foodQty.values.where((q) => q > 0).length;

  Future<void> _submit() async {
    if (_lines == 0) return setState(() => _error = 'Add at least one item.');
    if (!_adding && _source == 'TABLE' && _tableId == null) return setState(() => _error = 'Choose a table.');
    if (!_adding && _source == 'ROOM' && _guest == null) return setState(() => _error = 'Choose a room.');
    final phone = barCleanPhone(_phone.text);
    if (phone.isNotEmpty && phone.length != 10) return setState(() => _error = 'Enter a 10-digit mobile number.');
    final items = [
      for (final e in _drinkQty.entries)
        if (e.value > 0) {'menuItemId': e.key, 'quantity': e.value},
    ];
    final foodItems = [
      for (final e in _foodQty.entries)
        if (e.value > 0)
          {
            'itemId': int.parse(e.key.split(':')[0]),
            if (e.key.split(':')[1] != '0') 'portionId': int.parse(e.key.split(':')[1]),
            'quantity': e.value,
          },
    ];
    setState(() {
      _busy = true;
      _error = null;
    });
    final vm = ref.read(barViewModelProvider.notifier);
    final ok = _adding
        ? await vm.addItems(widget.existing!.id, {'items': items, 'foodItems': foodItems})
        : await vm.placeOrder({
            'source': _source == 'PARCEL' ? 'COUNTER' : _source,
            if (_source == 'PARCEL') 'isParcel': true,
            if (_source == 'TABLE') 'tableId': _tableId,
            if (_source == 'ROOM') ...{'roomId': _guest!.roomId, 'bookingId': _guest!.bookingId},
            if (_name.text.trim().isNotEmpty) 'guestName': _name.text.trim(),
            if (_source == 'TABLE' && _name.text.trim().isNotEmpty) 'customerTag': _name.text.trim(),
            if (phone.isNotEmpty) 'guestPhone': phone,
            'items': items,
            'foodItems': foodItems,
          });
    if (!mounted) return;
    if (ok) {
      {
        final bar = ref.read(barViewModelProvider);
        final setup = ref.read(barSetupViewModelProvider);
        final idx = _sizeIndex(setup.menu);
        final names = <({String name, int qty})>[
          for (final e in _drinkQty.entries)
            if (e.value > 0 && idx[e.key] != null) (name: '${idx[e.key]!.$1.name} ${idx[e.key]!.$2.label}', qty: e.value),
          for (final sec in _sections)
            for (final i in sec.items)
              for (final p in (i.hasPortions ? i.portions : <MenuPortion?>[null]))
                if ((_foodQty['${i.id}:${p?.id ?? 0}'] ?? 0) > 0)
                  (name: '${i.name}${p == null ? '' : ' ${p.label}'}', qty: _foodQty['${i.id}:${p?.id ?? 0}']!),
        ];
        final where = _adding
            ? 'Bar - ${widget.existing!.tableLabel != null ? 'Table ${widget.existing!.tableLabel}' : widget.existing!.roomNumber != null ? 'Room ${widget.existing!.roomNumber}' : 'Counter'}'
            : _source == 'TABLE'
                ? 'Bar - ${bar.targets.tables.where((t) => t.id == _tableId).map((t) => t.label).firstOrNull ?? 'Table'}'
                : _source == 'ROOM'
                    ? 'Bar - Room ${_guest?.roomNumber ?? ''}'
                    : _source == 'PARCEL'
                        ? 'Bar - Parcel'
                        : 'Bar - Counter';
        await offerKot(
          context,
          ref,
          ReceiptDocs.kot(
            lodgeName: ref.read(authViewModelProvider).me?.lodge.name ?? '',
            where: where,
            items: names,
            guest: _name.text,
            title: _adding ? 'KOT - ADD-ON' : 'KOT',
          ),
          message: _adding ? 'Items added.' : 'Bar order placed.',
        );
        if (!mounted) return;
      }
      Navigator.pop(context, true);
    } else {
      setState(() {
        _busy = false;
        _error = ref.read(barViewModelProvider).error ?? 'Could not save the order.';
      });
    }
  }

  Widget _target(BarState bar) {
    if (_adding) {
      return NeuCard(child: Text('Adding to ${widget.existing!.label} · #${widget.existing!.orderNumber}', style: const TextStyle(fontWeight: FontWeight.w700)));
    }
    return BarSection(
      title: 'Order for',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Seg<String>(
            value: _source,
            onChanged: (v) => setState(() => _source = v),
            items: const [
              ('COUNTER', 'Counter', Icons.storefront_rounded),
              ('PARCEL', 'Parcel', Icons.takeout_dining_rounded),
              ('TABLE', 'Table', Icons.table_restaurant_rounded),
              ('ROOM', 'Room', Icons.bed_rounded),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          if (_source == 'TABLE')
            DropdownButtonFormField<int>(
              initialValue: _tableId,
              decoration: const InputDecoration(labelText: 'Table', border: OutlineInputBorder()),
              items: [for (final t in bar.targets.tables) DropdownMenuItem(value: t.id, child: Text(t.label))],
              onChanged: (v) => setState(() => _tableId = v),
            ),
          if (_source == 'ROOM')
            DropdownButtonFormField<BarGuest>(
              initialValue: _guest,
              decoration: InputDecoration(
                labelText: bar.targets.guests.isEmpty ? 'No guests checked in' : 'Room',
                border: const OutlineInputBorder(),
              ),
              items: [
                for (final g in bar.targets.guests)
                  DropdownMenuItem(value: g, child: Text('${g.roomNumber} · ${g.guestName}')),
              ],
              onChanged: (v) => setState(() => _guest = v),
            ),
          if (_source != 'ROOM') ...[
            const SizedBox(height: AppTheme.s12),
            Row(
              children: [
                Expanded(child: NeuField(controller: _name, label: _source == 'TABLE' ? 'Customer (billed separately)' : 'Name (optional)', dense: true)),
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: NeuField(
                    controller: _phone,
                    label: 'Mobile (optional)',
                    keyboardType: TextInputType.phone,
                    maxLength: 14,
                    dense: true,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  // -- Shared look: flat white cards on the page grey, hairline borders, navy for
  // selection, amber for counts (the web's chrome palette).

  InputDecoration _searchDecoration(String hint) => InputDecoration(
    prefixIcon: const Icon(Icons.search_rounded, color: AppTheme.muted),
    hintText: hint,
    isDense: true,
    filled: true,
    fillColor: AppTheme.card,
    contentPadding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 12),
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppTheme.rMedium), borderSide: const BorderSide(color: AppTheme.border)),
    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(AppTheme.rMedium), borderSide: const BorderSide(color: AppTheme.border)),
    focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(AppTheme.rMedium), borderSide: const BorderSide(color: AppTheme.accent, width: 1.5)),
  );

  Widget _catChip(String label, bool selected, VoidCallback onTap) => Padding(
    padding: const EdgeInsets.only(right: AppTheme.s8),
    child: Semantics(
      button: true,
      selected: selected,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(
            color: selected ? AppTheme.accent : AppTheme.card,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: selected ? AppTheme.accent : AppTheme.border),
          ),
          child: Text(
            label,
            style: TextStyle(color: selected ? Colors.white : AppTheme.text, fontWeight: FontWeight.w700, fontSize: 13),
          ),
        ),
      ),
    ),
  );

  Widget _menuCard({required Widget child, EdgeInsets margin = EdgeInsets.zero}) => Container(
    margin: margin,
    decoration: BoxDecoration(
      color: AppTheme.card,
      borderRadius: BorderRadius.circular(AppTheme.rMedium),
      border: Border.all(color: AppTheme.border),
    ),
    clipBehavior: Clip.antiAlias,
    child: child,
  );

  Widget _cardHeader(String title, {Widget? badge}) => Container(
    width: double.infinity,
    padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s12, AppTheme.s12, AppTheme.s8),
    child: Row(
      children: [
        Expanded(
          child: Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w800, fontSize: 15),
          ),
        ),
        if (badge != null) badge,
      ],
    ),
  );

  /// One orderable line: label, price, stepper. Lit with the brand wash once
  /// something is on it.
  Widget _row(String label, num price, int qty, ValueChanged<int>? onChanged, {String? note}) {
    final on = qty > 0;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 8),
      decoration: BoxDecoration(
        color: on ? AppTheme.sidebarBrandWash : null,
        border: const Border(top: BorderSide(color: AppTheme.border)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: onChanged == null ? AppTheme.muted : AppTheme.text, fontWeight: FontWeight.w600),
            ),
          ),
          Text(
            note ?? formatPrice(price),
            style: TextStyle(
              color: onChanged == null ? AppTheme.muted : (on ? AppTheme.accent : AppTheme.heading),
              fontWeight: FontWeight.w800,
              fontSize: note == null ? 14 : 12,
            ),
          ),
          const SizedBox(width: AppTheme.s12),
          BarQty(compact: true, value: qty, onChanged: onChanged ?? (_) {}),
        ],
      ),
    );
  }

  Widget _productCard(BarProduct p, {EdgeInsets margin = EdgeInsets.zero}) => _menuCard(
    margin: margin,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _cardHeader(p.name, badge: p.isLow ? const _LowStock() : null),
        for (final s in p.sizes.where((s) => s.isActive))
          _row(
            s.label,
            s.price,
            _drinkQty[s.id] ?? 0,
            s.isAvailable ? (v) => setState(() => _drinkQty[s.id] = v) : null,
            note: s.isAvailable ? null : '${formatPrice(s.price)} · out today',
          ),
      ],
    ),
  );

  /// [grid] lays the products out as a wrapping grid of cards (desktop);
  /// otherwise a single column (phone).
  Widget _drinks(BarMenu menu, {bool grid = false}) {
    final q = _search.text.trim().toLowerCase();
    final products = menu.products.where((p) {
      if (!p.isActive || p.sizes.where((s) => s.isActive).isEmpty) return false;
      if (_category != null && p.categoryId != _category) return false;
      return q.isEmpty || p.name.toLowerCase().contains(q) || (p.brand ?? '').toLowerCase().contains(q);
    }).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              _catChip('All', _category == null, () => setState(() => _category = null)),
              for (final c in menu.categories.where((c) => c.isActive))
                _catChip(c.name, _category == c.id, () => setState(() => _category = c.id)),
            ],
          ),
        ),
        const SizedBox(height: AppTheme.s12),
        if (products.isEmpty) const Padding(padding: EdgeInsets.all(AppTheme.s16), child: Text('No drinks match.')),
        if (grid)
          AdaptiveGrid(minTileWidth: 320, children: [for (final p in products) _productCard(p)])
        else
          for (final p in products) _productCard(p, margin: const EdgeInsets.only(bottom: AppTheme.s8)),
      ],
    );
  }

  Widget _dishes({bool grid = false}) {
    final q = _search.text.trim().toLowerCase();
    final tiles = <Widget>[];
    for (final sec in _sections.where((s) => s.isActive)) {
      for (final i in sec.items.where((i) => i.orderable && (q.isEmpty || i.name.toLowerCase().contains(q)))) {
        final portions = i.hasPortions ? i.portions.where((p) => p.isAvailable).toList() : <MenuPortion?>[null];
        tiles.add(
          _menuCard(
            margin: grid ? EdgeInsets.zero : const EdgeInsets.only(bottom: AppTheme.s8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _cardHeader(i.name),
                for (final p in portions)
                  Builder(
                    builder: (_) {
                      final key = '${i.id}:${p?.id ?? 0}';
                      return _row(p?.label ?? 'Regular', i.priceFor(p), _foodQty[key] ?? 0, (v) => setState(() => _foodQty[key] = v));
                    },
                  ),
              ],
            ),
          ),
        );
      }
    }
    if (tiles.isEmpty) return const Padding(padding: EdgeInsets.all(AppTheme.s16), child: Text('No dishes found.'));
    return grid ? AdaptiveGrid(minTileWidth: 320, children: tiles) : Column(children: tiles);
  }

  /// The error line, total and Place-order button — the bottom bar on a phone,
  /// the foot of the order panel on desktop.
  Widget _checkout(double total, {required bool wide, VoidCallback? onReview}) => Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (_error != null)
        Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: const TextStyle(color: AppTheme.danger, fontWeight: FontWeight.w600))),
      Row(
        children: [
          Expanded(
            child: wide
                ? const Text('Total', style: TextStyle(color: AppTheme.muted, fontWeight: FontWeight.w700, fontSize: 15))
                : InkWell(
                    onTap: onReview,
                    borderRadius: BorderRadius.circular(8),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        children: [
                          Flexible(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '$_lines item${_lines == 1 ? '' : 's'} · ${formatPrice(total)}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                                ),
                                const Text('Tap to review order', style: TextStyle(color: AppTheme.accent, fontSize: 12, fontWeight: FontWeight.w700)),
                              ],
                            ),
                          ),
                          const SizedBox(width: 4),
                          const Icon(Icons.keyboard_arrow_up_rounded, color: AppTheme.accent),
                        ],
                      ),
                    ),
                  ),
          ),
          if (wide) Text(formatPrice(total), style: const TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w900, fontSize: 26)),
          if (!wide)
            NeuButton(
              primary: true,
              onPressed: _busy ? null : _submit,
              child: Text(_busy ? 'Saving…' : _adding ? 'Add items' : 'Place order'),
            ),
        ],
      ),
      if (wide) ...[
        const SizedBox(height: AppTheme.s12),
        NeuButton(
          primary: true,
          expand: true,
          onPressed: _busy ? null : _submit,
          child: Text(_busy ? 'Saving…' : _adding ? 'Add items' : 'Place order'),
        ),
      ],
    ],
  );

  /// What has been added so far, one editable line each (desktop order panel).
  List<Widget> _orderLines(BarMenu menu) {
    Widget line(String key, String label, num price, int qty, ValueChanged<int> set) => Container(
      key: ValueKey(key),
      padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: AppTheme.border))),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700)),
                Text('${formatPrice(price)} each', style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
              ],
            ),
          ),
          BarQty(compact: true, value: qty, onChanged: set),
          SizedBox(
            width: 72,
            child: Text(formatPrice(price * qty), textAlign: TextAlign.right, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );

    final idx = _sizeIndex(menu);
    final out = <Widget>[];
    _drinkQty.forEach((id, q) {
      final e = idx[id];
      if (q > 0 && e != null) {
        out.add(line('d$id', '${e.$1.name} · ${e.$2.label}', e.$2.price, q, (v) => _edit(() => _drinkQty[id] = v)));
      }
    });
    for (final sec in _sections) {
      for (final i in sec.items) {
        final portions = i.hasPortions ? i.portions : <MenuPortion?>[null];
        for (final p in portions) {
          final key = '${i.id}:${p?.id ?? 0}';
          final q = _foodQty[key] ?? 0;
          if (q > 0) {
            out.add(line('f$key', '${i.name}${p == null ? '' : ' · ${p.label}'}', i.priceFor(p), q, (v) => _edit(() => _foodQty[key] = v)));
          }
        }
      }
    }
    return out;
  }

  /// Phone: what has been added, editable, with the total and Place order —
  /// opened from the bottom bar.
  Future<void> _review(BarMenu menu) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: AppTheme.card,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) {
          _sheetRefresh = () => setSheet(() {});
          final lines = _orderLines(menu);
          final total = _total(menu);
          return SafeArea(
            child: ConstrainedBox(
              constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.8),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(AppTheme.s16, 0, AppTheme.s16, AppTheme.s8),
                    child: Row(
                      children: [
                        const Icon(Icons.receipt_long_rounded, color: AppTheme.accent, size: 20),
                        const SizedBox(width: AppTheme.s8),
                        const Expanded(
                          child: Text('Review order', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w800, fontSize: 17)),
                        ),
                        Text('$_lines item${_lines == 1 ? '' : 's'}', style: const TextStyle(color: AppTheme.muted, fontWeight: FontWeight.w700)),
                      ],
                    ),
                  ),
                  Flexible(
                    child: lines.isEmpty
                        ? const Padding(
                            padding: EdgeInsets.symmetric(vertical: AppTheme.s32),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.shopping_basket_outlined, color: AppTheme.muted, size: 36),
                                SizedBox(height: AppTheme.s8),
                                Text('Nothing added yet', style: TextStyle(color: AppTheme.muted, fontWeight: FontWeight.w600)),
                              ],
                            ),
                          )
                        : ListView(
                            shrinkWrap: true,
                            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16),
                            children: lines,
                          ),
                  ),
                  Container(
                    padding: const EdgeInsets.all(AppTheme.s16),
                    decoration: const BoxDecoration(color: AppTheme.bg, border: Border(top: BorderSide(color: AppTheme.border))),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Total', style: TextStyle(color: AppTheme.muted, fontWeight: FontWeight.w700)),
                              Text(formatPrice(total), style: const TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w900, fontSize: 22)),
                            ],
                          ),
                        ),
                        NeuButton(
                          primary: true,
                          onPressed: (_busy || lines.isEmpty)
                              ? null
                              : () {
                                  Navigator.pop(ctx);
                                  _submit();
                                },
                          child: Text(_adding ? 'Add items' : 'Place order'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
    _sheetRefresh = null;
  }

  Widget _modeSwitch() => _Seg<bool>(
    value: _food,
    onChanged: (v) => setState(() => _food = v),
    items: const [(false, 'Drinks', Icons.local_bar_rounded), (true, 'Food', Icons.restaurant_rounded)],
  );

  /// Desktop: full width, no side margins — the menu fills the left, the
  /// order being built sits in a fixed panel against the right edge.
  Widget _wideBody(BarState bar, BarMenu menu, bool loading, double total) {
    final lines = _orderLines(menu);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s12),
                decoration: const BoxDecoration(color: AppTheme.card, border: Border(bottom: BorderSide(color: AppTheme.border))),
                child: Row(
                  children: [
                    SizedBox(width: 240, child: _modeSwitch()),
                    const SizedBox(width: AppTheme.s16),
                    Expanded(
                      child: TextField(
                        controller: _search,
                        decoration: _searchDecoration('Search drinks or dishes'),
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(AppTheme.s16),
                  children: [
                    if (loading && menu.products.isEmpty)
                      const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()))
                    else
                      _food ? _dishes(grid: true) : _drinks(menu, grid: true),
                  ],
                ),
              ),
            ],
          ),
        ),
        Container(
          width: 400,
          decoration: const BoxDecoration(color: AppTheme.card, border: Border(left: BorderSide(color: AppTheme.border))),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: 14),
                color: AppTheme.accent,
                child: Row(
                  children: [
                    const Icon(Icons.receipt_long_rounded, color: Colors.white, size: 20),
                    const SizedBox(width: AppTheme.s8),
                    Expanded(
                      child: Text(
                        _adding ? 'Add to order' : 'Current order',
                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                      decoration: BoxDecoration(color: PillTab.countBg, borderRadius: BorderRadius.circular(20)),
                      child: Text(
                        '$_lines item${_lines == 1 ? '' : 's'}',
                        style: const TextStyle(color: PillTab.countInk, fontSize: 12, fontWeight: FontWeight.w800),
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(AppTheme.s16),
                  children: [
                    _target(bar),
                    const SizedBox(height: AppTheme.s16),
                    if (lines.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: AppTheme.s32),
                        child: Column(
                          children: [
                            Icon(Icons.shopping_basket_outlined, color: AppTheme.muted, size: 36),
                            SizedBox(height: AppTheme.s8),
                            Text('Nothing added yet', style: TextStyle(color: AppTheme.muted, fontWeight: FontWeight.w600)),
                            SizedBox(height: 2),
                            Text('Use + on any drink or dish', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                          ],
                        ),
                      )
                    else
                      ...lines,
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.all(AppTheme.s16),
                decoration: const BoxDecoration(color: AppTheme.bg, border: Border(top: BorderSide(color: AppTheme.border))),
                child: _checkout(total, wide: true),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _narrowBody(BarState bar, BarMenu menu, bool loading) {
    final maxW = AppTheme.formMaxWidth(context);
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxW),
        child: ListView(
          padding: EdgeInsets.all(AppTheme.gutter(context)),
          children: [
            _target(bar),
            const SizedBox(height: AppTheme.s12),
            _modeSwitch(),
            const SizedBox(height: AppTheme.s8),
            TextField(
              controller: _search,
              decoration: _searchDecoration('Search'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: AppTheme.s12),
            if (loading && menu.products.isEmpty)
              const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()))
            else
              _food ? _dishes() : _drinks(menu),
            const SizedBox(height: 96),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bar = ref.watch(barViewModelProvider);
    final setup = ref.watch(barSetupViewModelProvider);
    final total = _total(setup.menu);
    return LayoutBuilder(
      builder: (context, c) {
        final wide = c.maxWidth >= 900;
        return Scaffold(
          backgroundColor: AppTheme.bg,
          appBar: AppBar(title: Text(_adding ? 'Add to order' : 'Take order')),
          body: wide ? _wideBody(bar, setup.menu, setup.isLoading, total) : _narrowBody(bar, setup.menu, setup.isLoading),
          bottomNavigationBar: wide
              ? null
              : SafeArea(
                  child: Container(
                    padding: const EdgeInsets.all(AppTheme.s12),
                    decoration: const BoxDecoration(color: AppTheme.card, border: Border(top: BorderSide(color: AppTheme.border))),
                    child: _checkout(total, wide: false, onReview: () => _review(setup.menu)),
                  ),
                ),
        );
      },
    );
  }
}

/// Amber "Low stock" tag — a warning, not an error, so not red.
class _LowStock extends StatelessWidget {
  const _LowStock();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(color: AppTheme.warningWash, borderRadius: BorderRadius.circular(20)),
    child: const Text('Low stock', style: TextStyle(color: AppTheme.warningInk, fontSize: 11, fontWeight: FontWeight.w800)),
  );
}

/// Two-or-three way switch: a recessed track with the chosen option raised in
/// brand navy.
class _Seg<T> extends StatelessWidget {
  final List<(T, String, IconData)> items;
  final T value;
  final ValueChanged<T> onChanged;

  const _Seg({required this.items, required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(3),
    decoration: BoxDecoration(
      color: AppTheme.bg,
      borderRadius: BorderRadius.circular(AppTheme.rMedium),
      border: Border.all(color: AppTheme.border),
    ),
    child: Row(
      children: [
        for (final (v, label, icon) in items)
          Expanded(
            child: Semantics(
              button: true,
              selected: v == value,
              child: InkWell(
                onTap: () => onChanged(v),
                borderRadius: BorderRadius.circular(9),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 160),
                  height: 38,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: v == value ? AppTheme.accent : Colors.transparent,
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(icon, size: 16, color: v == value ? Colors.white : AppTheme.muted),
                      const SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: v == value ? Colors.white : AppTheme.text, fontWeight: FontWeight.w700, fontSize: 13.5),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    ),
  );
}
