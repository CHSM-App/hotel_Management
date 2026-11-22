import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/bar.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/pill_tabs.dart';
import '../theme.dart';
import '../food/tables_panel.dart';
import 'bar_common.dart';

/// "Bar menu & Stock": Stock / Menu / Settings (mirrors BarSetup.jsx).
class BarSetupScreen extends ConsumerStatefulWidget {
  const BarSetupScreen({super.key});

  @override
  ConsumerState<BarSetupScreen> createState() => _BarSetupScreenState();
}

class _BarSetupScreenState extends ConsumerState<BarSetupScreen> {
  String _tab = 'stock';

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(barSetupViewModelProvider.notifier).load());
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(barSetupViewModelProvider);
    return Column(
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(AppTheme.gutter(context), AppTheme.s8, AppTheme.gutter(context), 0),
          child: Align(
            alignment: Alignment.centerLeft,
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: AppTheme.isDesktop(context) ? 560 : double.infinity),
              child: PillTabs(
                selected: _tab,
                onSelect: (k) => setState(() => _tab = k),
                tabs: [
                  PillTab('stock', 'Stock', Icons.inventory_2_rounded, count: s.lowCount == 0 ? null : s.lowCount, countColor: AppTheme.danger),
                  const PillTab('menu', 'Menu', Icons.menu_book_rounded),
                  const PillTab('tables', 'Tables', Icons.table_bar_rounded),
                  const PillTab('settings', 'Settings', Icons.tune_rounded),
                ],
              ),
            ),
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => ref.read(barSetupViewModelProvider.notifier).load(),
            child: s.isLoading && s.menu.products.isEmpty
                ? const Center(child: CircularProgressIndicator())
                : switch (_tab) {
                    'menu' => _MenuTab(menu: s.menu),
                    'tables' => const TablesPanel(area: 'BAR'),
                    'settings' => _SettingsTab(settings: s.menu.settings),
                    _ => _StockTab(menu: s.menu),
                  },
          ),
        ),
      ],
    );
  }
}

// ───────────────────────────── stock ─────────────────────────────

class _StockTab extends ConsumerStatefulWidget {
  final BarMenu menu;

  const _StockTab({required this.menu});

  @override
  ConsumerState<_StockTab> createState() => _StockTabState();
}

class _StockTabState extends ConsumerState<_StockTab> {
  String _q = '';
  bool _lowOnly = false;

  @override
  Widget build(BuildContext context) {
    final products = widget.menu.products
        .where((p) => p.isActive && (!_lowOnly || p.isLow) && (_q.isEmpty || p.name.toLowerCase().contains(_q) || (p.brand ?? '').toLowerCase().contains(_q)))
        .toList();
    return ListView(
      padding: EdgeInsets.all(AppTheme.gutter(context)),
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                decoration: const InputDecoration(prefixIcon: Icon(Icons.search_rounded), hintText: 'Search stock', border: OutlineInputBorder(), isDense: true),
                onChanged: (v) => setState(() => _q = v.trim().toLowerCase()),
              ),
            ),
            const SizedBox(width: 8),
            FilterChip(label: const Text('Low only'), selected: _lowOnly, onSelected: (v) => setState(() => _lowOnly = v)),
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        if (products.isEmpty) const NeuNotice(icon: Icons.inventory_2_rounded, message: 'No products to show.'),
        for (final p in products)
          NeuCard(
            margin: const EdgeInsets.only(bottom: AppTheme.s8),
            onTap: () => _stockSheet(context, p),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(p.name, style: const TextStyle(fontWeight: FontWeight.w800, color: AppTheme.heading)),
                      Text('${p.stockText} · ${p.stockMl} ml${p.brand == null ? '' : ' · ${p.brand}'}', style: const TextStyle(color: AppTheme.muted, fontSize: 12.5)),
                    ],
                  ),
                ),
                if (p.isLow) const BarChip('Low', color: AppTheme.danger) else const BarChip('OK', color: AppTheme.vacant),
                const Icon(Icons.chevron_right_rounded, color: AppTheme.muted),
              ],
            ),
          ),
      ],
    );
  }

  void _stockSheet(BuildContext context, BarProduct p) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: _StockSheet(product: p),
      ),
    );
  }
}

class _StockSheet extends ConsumerStatefulWidget {
  final BarProduct product;

  const _StockSheet({required this.product});

  @override
  ConsumerState<_StockSheet> createState() => _StockSheetState();
}

class _StockSheetState extends ConsumerState<_StockSheet> {
  String _reason = 'PURCHASE';
  String _direction = 'ADD';
  final _bottles = TextEditingController();
  final _ml = TextEditingController();
  final _note = TextEditingController();
  late final _limit = TextEditingController(text: widget.product.lowStockMl == null ? '' : '${widget.product.lowStockMl}');
  String? _error;
  List<BarMovement>? _moves;

  @override
  void dispose() {
    _bottles.dispose();
    _ml.dispose();
    _note.dispose();
    _limit.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final b = int.tryParse(_bottles.text.trim()) ?? 0;
    final m = int.tryParse(_ml.text.trim()) ?? 0;
    if (b <= 0 && m <= 0) return setState(() => _error = 'Enter bottles or ml.');
    final vm = ref.read(barSetupViewModelProvider.notifier);
    final ok = await vm.adjustStock(widget.product.id, {
      'reason': _reason,
      if (_reason == 'ADJUSTMENT') 'direction': _direction,
      'bottles': b,
      'ml': m,
      if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
    });
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(barSetupViewModelProvider).error);
    }
  }

  Future<void> _saveLimit() async {
    final v = int.tryParse(_limit.text.trim());
    final ok = await ref.read(barSetupViewModelProvider.notifier).updateProduct(widget.product.id, {
      'name': widget.product.name,
      'bottleMl': widget.product.bottleMl,
      'lowStockMl': v,
    });
    if (!mounted) return;
    barSnack(context, ok ? 'Alert limit saved.' : 'Could not save the limit.');
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.product;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AppTheme.s16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(p.name, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
            Text('In stock: ${p.stockText} (${p.stockMl} ml) · bottle ${p.bottleMl} ml', style: const TextStyle(color: AppTheme.muted)),
            const SizedBox(height: AppTheme.s12),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'PURCHASE', label: Text('Receive')),
                ButtonSegment(value: 'WASTAGE', label: Text('Wastage')),
                ButtonSegment(value: 'ADJUSTMENT', label: Text('Adjust')),
              ],
              selected: {_reason},
              onSelectionChanged: (s) => setState(() => _reason = s.first),
            ),
            if (_reason == 'ADJUSTMENT')
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: SegmentedButton<String>(
                  segments: const [ButtonSegment(value: 'ADD', label: Text('Add')), ButtonSegment(value: 'REMOVE', label: Text('Remove'))],
                  selected: {_direction},
                  onSelectionChanged: (s) => setState(() => _direction = s.first),
                ),
              ),
            const SizedBox(height: AppTheme.s8),
            Row(
              children: [
                Expanded(child: NeuField(controller: _bottles, label: 'Bottles', keyboardType: TextInputType.number, dense: true)),
                const SizedBox(width: 8),
                Expanded(child: NeuField(controller: _ml, label: 'ml', keyboardType: TextInputType.number, dense: true)),
              ],
            ),
            const SizedBox(height: 8),
            NeuField(controller: _note, label: 'Note (optional)', dense: true),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(_error!, style: const TextStyle(color: AppTheme.danger))),
            const SizedBox(height: AppTheme.s8),
            NeuButton(primary: true, expand: true, onPressed: _save, child: const Text('Save stock')),
            const Divider(height: 28),
            Row(
              children: [
                Expanded(child: NeuField(controller: _limit, label: 'Low-stock alert (ml)', keyboardType: TextInputType.number, dense: true)),
                const SizedBox(width: 8),
                NeuButton(onPressed: _saveLimit, child: const Text('Save limit')),
              ],
            ),
            TextButton(
              onPressed: () async {
                final m = await ref.read(barSetupViewModelProvider.notifier).movements(p.id);
                if (mounted) setState(() => _moves = m);
              },
              child: const Text('Show stock history'),
            ),
            if (_moves != null)
              for (final m in _moves!.take(30))
                Text('${m.reason} · ${m.changeMl > 0 ? '+' : ''}${m.changeMl} ml → ${m.balanceAfter} ml${(m.note ?? '').isEmpty ? '' : ' · ${m.note}'}', style: const TextStyle(fontSize: 12.5)),
          ],
        ),
      ),
    );
  }
}

// ───────────────────────────── menu ─────────────────────────────

class _MenuTab extends ConsumerWidget {
  final BarMenu menu;

  const _MenuTab({required this.menu});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(barSetupViewModelProvider.notifier);
    String catName(int? id) => menu.categories.where((c) => c.id == id).map((c) => c.name).firstOrNull ?? 'No category';

    Future<void> nameDialog({BarCategory? cat}) async {
      final c = TextEditingController(text: cat?.name ?? '');
      final name = await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(cat == null ? 'New category' : 'Rename category'),
          content: TextField(controller: c, autofocus: true, decoration: const InputDecoration(labelText: 'Name')),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')), TextButton(onPressed: () => Navigator.pop(ctx, c.text.trim()), child: const Text('Save'))],
        ),
      );
      if (name == null || name.isEmpty) return;
      final ok = await vm.saveCategory(name, id: cat?.id, isActive: cat?.isActive);
      if (context.mounted && !ok) barSnack(context, ref.read(barSetupViewModelProvider).error ?? 'Could not save.');
    }

    return ListView(
      padding: EdgeInsets.all(AppTheme.gutter(context)),
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            for (final c in menu.categories)
              InputChip(
                label: Text(c.name),
                onPressed: () => nameDialog(cat: c),
                onDeleted: () async {
                  if (await barConfirm(context, title: 'Delete ${c.name}?', message: 'Its products move to “No category”.', confirmLabel: 'Delete')) {
                    await vm.deleteCategory(c.id);
                  }
                },
              ),
            ActionChip(avatar: const Icon(Icons.add_rounded, size: 18), label: const Text('Category'), onPressed: () => nameDialog()),
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        NeuButton(primary: true, onPressed: () => _productDialog(context, ref, menu), child: const Text('Add product')),
        const SizedBox(height: AppTheme.s8),
        for (final p in menu.products)
          NeuCard(
            margin: const EdgeInsets.only(bottom: AppTheme.s8),
            padding: const EdgeInsets.all(AppTheme.s12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(child: Text(p.name, style: TextStyle(fontWeight: FontWeight.w800, color: p.isActive ? AppTheme.heading : AppTheme.muted))),
                    Text(catName(p.categoryId), style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
                    IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.edit_rounded, size: 18), onPressed: () => _productDialog(context, ref, menu, product: p)),
                  ],
                ),
                for (final s in p.sizes)
                  Row(
                    children: [
                      Expanded(child: Text('${s.label} · ${s.ml} ml · ${formatPrice(s.price)}${s.isActive ? '' : ' · removed'}', style: TextStyle(fontSize: 13, color: s.isActive ? AppTheme.text : AppTheme.muted))),
                      Tooltip(
                        message: 'Out today',
                        child: Switch(value: s.isAvailable, onChanged: s.isActive ? (v) => vm.updateSize(s.id, {'isAvailable': v}) : null),
                      ),
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        icon: const Icon(Icons.payments_outlined, size: 18),
                        onPressed: () async {
                          final c = TextEditingController(text: s.price.toStringAsFixed(0));
                          final v = await showDialog<double>(
                            context: context,
                            builder: (ctx) => AlertDialog(
                              title: Text('${p.name} · ${s.label} price'),
                              content: TextField(controller: c, autofocus: true, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Price')),
                              actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')), TextButton(onPressed: () => Navigator.pop(ctx, double.tryParse(c.text.trim())), child: const Text('Save'))],
                            ),
                          );
                          if (v != null) await vm.updateSize(s.id, {'price': v});
                        },
                      ),
                    ],
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

/// New product (with sizes and opening stock) or edit one's details.
Future<void> _productDialog(BuildContext context, WidgetRef ref, BarMenu menu, {BarProduct? product}) async {
  final name = TextEditingController(text: product?.name ?? '');
  final brand = TextEditingController(text: product?.brand ?? '');
  final bottle = TextEditingController(text: '${product?.bottleMl ?? 750}');
  final opening = TextEditingController();
  final low = TextEditingController(text: product?.lowStockMl == null ? '' : '${product!.lowStockMl}');
  int? cat = product?.categoryId;
  bool active = product?.isActive ?? true;
  // Quick-add sizes for a new product: ml -> price text.
  final sizes = <int, TextEditingController>{};
  String? error;

  await showDialog<void>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setS) => AlertDialog(
        title: Text(product == null ? 'Add product' : 'Edit product'),
        content: SizedBox(
          width: 420,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(controller: name, decoration: const InputDecoration(labelText: 'Name')),
                TextField(controller: brand, decoration: const InputDecoration(labelText: 'Brand (optional)')),
                DropdownButtonFormField<int?>(
                  initialValue: cat,
                  decoration: const InputDecoration(labelText: 'Category'),
                  items: [const DropdownMenuItem(value: null, child: Text('No category')), for (final c in menu.categories) DropdownMenuItem(value: c.id, child: Text(c.name))],
                  onChanged: (v) => setS(() => cat = v),
                ),
                TextField(controller: bottle, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Bottle size (ml)')),
                TextField(controller: low, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Low-stock alert (ml, optional)')),
                if (product == null) ...[
                  TextField(controller: opening, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Opening bottles')),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    children: [
                      for (final ml in const [30, 60, 90, 180])
                        FilterChip(
                          label: Text('$ml ml'),
                          selected: sizes.containsKey(ml),
                          onSelected: (v) => setS(() => v ? sizes[ml] = TextEditingController() : sizes.remove(ml)),
                        ),
                    ],
                  ),
                  for (final e in sizes.entries)
                    TextField(controller: e.value, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: 'Price for ${e.key} ml')),
                ] else
                  SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Active'), value: active, onChanged: (v) => setS(() => active = v)),
                if (error != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(error!, style: const TextStyle(color: AppTheme.danger))),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(
            onPressed: () async {
              final b = int.tryParse(bottle.text.trim());
              if (name.text.trim().isEmpty || b == null || b <= 0) return setS(() => error = 'Name and bottle size are required.');
              final body = <String, dynamic>{
                'name': name.text.trim(),
                'brand': brand.text.trim().isEmpty ? null : brand.text.trim(),
                'categoryId': cat,
                'bottleMl': b,
                'lowStockMl': int.tryParse(low.text.trim()),
                if (product != null) 'isActive': active,
                if (product == null) ...{
                  'openingBottles': int.tryParse(opening.text.trim()) ?? 0,
                  'sizes': [
                    for (final e in sizes.entries)
                      if (double.tryParse(e.value.text.trim()) != null) {'label': '${e.key} ml', 'ml': e.key, 'price': double.parse(e.value.text.trim())},
                  ],
                },
              };
              final vm = ref.read(barSetupViewModelProvider.notifier);
              final ok = product == null ? await vm.createProduct(body) : await vm.updateProduct(product.id, body);
              if (!ctx.mounted) return;
              if (ok) {
                Navigator.pop(ctx);
              } else {
                setS(() => error = ref.read(barSetupViewModelProvider).error);
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    ),
  );
}

// ───────────────────────────── settings ─────────────────────────────

class _SettingsTab extends ConsumerStatefulWidget {
  final BarSettings settings;

  const _SettingsTab({required this.settings});

  @override
  ConsumerState<_SettingsTab> createState() => _SettingsTabState();
}

class _SettingsTabState extends ConsumerState<_SettingsTab> {
  late final _tax = TextEditingController(text: widget.settings.taxPercent.toString());
  late final _low = TextEditingController(text: widget.settings.defaultLowStockMl?.toString() ?? '');

  @override
  void dispose() {
    _tax.dispose();
    _low.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final tax = double.tryParse(_tax.text.trim());
    if (tax == null || tax < 0 || tax > 100) return barSnack(context, 'Tax must be between 0 and 100.');
    final ok = await ref.read(barSetupViewModelProvider.notifier).saveSettings(taxPercent: tax, defaultLowStockMl: int.tryParse(_low.text.trim()));
    if (!mounted) return;
    barSnack(context, ok ? 'Settings saved.' : (ref.read(barSetupViewModelProvider).error ?? 'Could not save.'));
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: EdgeInsets.all(AppTheme.gutter(context)),
    children: [
      BarSection(
        title: 'Bar settings',
        child: Column(
          children: [
            NeuField(controller: _tax, label: 'Bar tax % (included in drink prices)', keyboardType: const TextInputType.numberWithOptions(decimal: true), dense: true),
            const SizedBox(height: 8),
            NeuField(controller: _low, label: 'Default low-stock alert (ml)', keyboardType: TextInputType.number, dense: true),
            const SizedBox(height: AppTheme.s12),
            NeuButton(primary: true, expand: true, onPressed: _save, child: const Text('Save settings')),
          ],
        ),
      ),
    ],
  );
}
