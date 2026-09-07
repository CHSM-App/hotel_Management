import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/menu.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// Taking an order at the counter.
///
/// Goes to a dining table or to nobody in particular — a walk-in paying at the
/// till, which is what the server calls COUNTER.
///
/// Room-service orders are deliberately not offered here, and it is a
/// permission wall rather than an oversight. Attaching an order to a room needs
/// a roomId, and the only way to a roomId is GET /rooms, which requires
/// `rooms.manage`. The seeded RECEPTION role is
/// ["bookings.manage","billing.manage","guests.view","orders.manage"] and
/// KITCHEN is ["orders.manage"] — neither holds it. A room picker here would
/// answer 403 for exactly the two roles that take counter orders. Guests in
/// rooms already order for themselves through the QR flow, which needs no
/// staff screen at all.
class CounterOrderScreen extends ConsumerStatefulWidget {
  const CounterOrderScreen({super.key});

  @override
  ConsumerState<CounterOrderScreen> createState() => _CounterOrderScreenState();
}

class _CounterOrderScreenState extends ConsumerState<CounterOrderScreen> {
  final _guestName = TextEditingController();
  final _note = TextEditingController();
  final _search = TextEditingController();

  List<MenuSection> _sections = const [];
  List<DiningTable> _tables = const [];
  final List<OrderLineDraft> _lines = [];

  DiningTable? _table;
  bool _loading = true;
  String? _loadError;
  String _query = '';

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _guestName.dispose();
    _note.dispose();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    final vm = ref.read(ordersViewModelProvider.notifier);
    final servesTables =
        ref.read(authViewModelProvider).me?.lodge.foodTableService ?? false;
    try {
      final sections = await vm.menu();
      // Only asked for where the property actually seats people. A lodge that
      // only does room service has no tables, and the request would be a round
      // trip for an empty list.
      final tables = servesTables ? await vm.tables() : const <DiningTable>[];
      if (!mounted) return;
      setState(() {
        _sections = sections;
        _tables = tables.where((t) => t.isActive).toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = ref.read(ordersViewModelProvider).error ??
            'Could not load the menu.';
      });
    }
  }

  num get _total => _lines.fold<num>(0, (sum, l) => sum + l.lineTotal);

  @override
  Widget build(BuildContext context) {
    final working = ref.watch(ordersViewModelProvider).working;

    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        backgroundColor: AppTheme.bg,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        foregroundColor: AppTheme.heading,
        title: const Text('Take an order'),
      ),
      body: SafeArea(child: _body()),
      bottomNavigationBar: _lines.isEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(AppTheme.s16),
                child: NeuButton(
                  primary: true,
                  expand: true,
                  onPressed: working ? null : _place,
                  child: Text(
                    working
                        ? 'Sending…'
                        : 'Send ${_lines.length} '
                              '${_lines.length == 1 ? 'item' : 'items'} · '
                              '${formatPrice(_total)}',
                  ),
                ),
              ),
            ),
    );
  }

  Widget _body() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_loadError != null) {
      return Padding(
        padding: const EdgeInsets.all(AppTheme.s16),
        child: NeuNotice(
          icon: Icons.cloud_off_rounded,
          message: _loadError!,
          action: NeuButton(onPressed: _load, child: const Text('Try again')),
        ),
      );
    }

    final visible = _visibleSections();

    return ListView(
      padding: const EdgeInsets.all(AppTheme.s16),
      children: [
        if (_tables.isNotEmpty) ...[
          Text('Where', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: AppTheme.s12),
          _TablePicker(
            tables: _tables,
            selected: _table,
            onSelect: (t) => setState(() => _table = t),
          ),
          const SizedBox(height: AppTheme.s24),
        ],

        if (_lines.isNotEmpty) ...[
          Text('On the ticket', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: AppTheme.s12),
          for (var i = 0; i < _lines.length; i++)
            _CartLine(
              line: _lines[i],
              onLess: () => setState(() {
                if (_lines[i].quantity > 1) {
                  _lines[i].quantity--;
                } else {
                  _lines.removeAt(i);
                }
              }),
              onMore: () => setState(() => _lines[i].quantity++),
            ),
          const SizedBox(height: AppTheme.s24),
        ],

        Text('Menu', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s12),
        NeuField(
          controller: _search,
          label: 'Search',
          hint: 'Dish name',
          onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
        ),
        const SizedBox(height: AppTheme.s16),

        if (visible.isEmpty)
          const NeuNotice(
            icon: Icons.search_off_rounded,
            message: 'Nothing on the menu matches.',
          )
        else
          for (final section in visible) ...[
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s8),
              child: Text(
                section.name,
                style: const TextStyle(
                  color: AppTheme.muted,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            for (final item in section.items)
              _MenuRow(item: item, onAdd: (portion) => _add(item, portion)),
            const SizedBox(height: AppTheme.s16),
          ],

        const SizedBox(height: AppTheme.s8),
        Text('Who', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppTheme.s12),
        NeuField(
          controller: _guestName,
          label: 'Guest name (optional)',
          maxLength: 200,
        ),
        const SizedBox(height: AppTheme.s12),
        NeuField(
          controller: _note,
          label: 'Note for the kitchen (optional)',
          maxLength: 300,
        ),
        const SizedBox(height: AppTheme.s24),
      ],
    );
  }

  /// The menu as the search has narrowed it.
  ///
  /// A dish that is off today stays on the list rather than disappearing, so
  /// the desk can tell a guest it is unavailable instead of that it does not
  /// exist — it simply cannot be added.
  List<MenuSection> _visibleSections() {
    final out = <MenuSection>[];
    for (final section in _sections) {
      if (!section.isActive) continue;
      final items = section.items.where((i) {
        if (!i.isActive) return false;
        if (_query.isEmpty) return true;
        return i.name.toLowerCase().contains(_query);
      }).toList();
      if (items.isEmpty) continue;
      out.add(
        MenuSection(
          id: section.id,
          name: section.name,
          isActive: section.isActive,
          items: items,
        ),
      );
    }
    return out;
  }

  void _add(MenuItem item, MenuPortion? portion) {
    setState(() {
      // Same dish at the same size is one line with a bigger count, not two
      // lines the kitchen has to add up itself.
      final existing = _lines.indexWhere(
        (l) => l.item.id == item.id && l.portion?.id == portion?.id,
      );
      if (existing >= 0) {
        _lines[existing].quantity++;
      } else {
        _lines.add(OrderLineDraft(item: item, portion: portion));
      }
    });
  }

  Future<void> _place() async {
    final vm = ref.read(ordersViewModelProvider.notifier);
    final order = await vm.placeCounterOrder(
      tableId: _table?.id,
      guestName: _guestName.text,
      note: _note.text,
      lines: _lines,
    );
    if (!mounted) return;
    if (order == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            ref.read(ordersViewModelProvider).error ??
                'Could not send that order.',
          ),
          backgroundColor: AppTheme.heading,
        ),
      );
      return;
    }
    Navigator.of(context).pop(true);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Order #${order.orderNumber} is with the kitchen.'),
        backgroundColor: AppTheme.heading,
      ),
    );
  }
}

// ── Where it goes ───────────────────────────────────────────────────────────

class _TablePicker extends StatelessWidget {
  final List<DiningTable> tables;
  final DiningTable? selected;
  final ValueChanged<DiningTable?> onSelect;

  const _TablePicker({
    required this.tables,
    required this.selected,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppTheme.s8,
      runSpacing: AppTheme.s8,
      children: [
        // No table is a real answer, not the absence of one: a walk-in paying
        // at the till is an order attached to nothing.
        _chip(context, 'Counter', selected == null, () => onSelect(null)),
        for (final table in tables)
          _chip(
            context,
            table.label,
            selected?.id == table.id,
            () => onSelect(table),
          ),
      ],
    );
  }

  Widget _chip(
    BuildContext context,
    String label,
    bool isSelected,
    VoidCallback onTap,
  ) {
    final text = Text(
      label,
      style: TextStyle(
        color: isSelected ? AppTheme.accent : AppTheme.text,
        fontWeight: isSelected ? FontWeight.w500 : FontWeight.w400,
        fontSize: 13,
      ),
    );

    return GestureDetector(
      onTap: onTap,
      child: isSelected
          ? NeuPressed(
              radius: 999,
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.s16,
                vertical: AppTheme.s8,
              ),
              child: text,
            )
          : NeuCard(
              radius: 999,
              shadow: AppTheme.subtle,
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.s16,
                vertical: AppTheme.s8,
              ),
              child: text,
            ),
    );
  }
}

// ── The ticket so far ───────────────────────────────────────────────────────

class _CartLine extends StatelessWidget {
  final OrderLineDraft line;
  final VoidCallback onLess;
  final VoidCallback onMore;

  const _CartLine({
    required this.line,
    required this.onLess,
    required this.onMore,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.s8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              line.label,
              style: const TextStyle(color: AppTheme.text, fontSize: 13),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.remove_circle_outline, size: 20),
            color: AppTheme.muted,
            onPressed: onLess,
          ),
          Text(
            '${line.quantity}',
            style: const TextStyle(color: AppTheme.heading, fontSize: 14),
          ),
          IconButton(
            icon: const Icon(Icons.add_circle_outline, size: 20),
            color: AppTheme.accent,
            onPressed: onMore,
          ),
          SizedBox(
            width: 68,
            child: Text(
              formatPrice(line.lineTotal),
              textAlign: TextAlign.right,
              style: const TextStyle(color: AppTheme.text, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

// ── One dish on the menu ────────────────────────────────────────────────────

class _MenuRow extends StatelessWidget {
  final MenuItem item;
  final ValueChanged<MenuPortion?> onAdd;

  const _MenuRow({required this.item, required this.onAdd});

  @override
  Widget build(BuildContext context) {
    final off = !item.orderable;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.s12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (item.foodType != null)
            Padding(
              padding: const EdgeInsets.only(top: 3, right: AppTheme.s8),
              child: _DietMark(foodType: item.foodType!),
            ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.name,
                  style: TextStyle(
                    color: off ? AppTheme.muted : AppTheme.text,
                    fontSize: 13,
                  ),
                ),
                if (off)
                  const Text(
                    'Off today',
                    style: TextStyle(color: AppTheme.danger, fontSize: 11),
                  ),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          if (item.hasPortions)
            // Each size is its own button: the server refuses a line that
            // names a dish with sizes but no size, so there is nothing
            // sensible to add without choosing one.
            Wrap(
              spacing: AppTheme.s8,
              children: [
                for (final portion in item.portions)
                  NeuButton(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppTheme.s12,
                      vertical: AppTheme.s8,
                    ),
                    onPressed: off || !portion.isAvailable
                        ? null
                        : () => onAdd(portion),
                    child: Text(
                      '${portion.label} ${formatPrice(portion.price)}',
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
              ],
            )
          else
            NeuButton(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.s12,
                vertical: AppTheme.s8,
              ),
              onPressed: off ? null : () => onAdd(null),
              child: Text(
                formatPrice(item.price),
                style: const TextStyle(fontSize: 12),
              ),
            ),
        ],
      ),
    );
  }
}

/// The veg / non-veg mark, drawn rather than spelled out — it is the same
/// square-in-a-square every menu in India carries.
class _DietMark extends StatelessWidget {
  final String foodType;

  const _DietMark({required this.foodType});

  @override
  Widget build(BuildContext context) {
    final colour = switch (foodType) {
      'VEG' => const Color(0xFF2E7D32),
      'NON_VEG' => const Color(0xFFC62828),
      'EGG' => const Color(0xFFF9A825),
      _ => AppTheme.muted,
    };

    return Container(
      width: 12,
      height: 12,
      decoration: BoxDecoration(
        border: Border.all(color: colour, width: 1.5),
        borderRadius: BorderRadius.circular(2),
      ),
      child: Center(
        child: Container(
          width: 6,
          height: 6,
          decoration: BoxDecoration(color: colour, shape: BoxShape.circle),
        ),
      ),
    );
  }
}
