import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/menu.dart';
import '../../domain/models/room.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/orders_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

/// Taking an order at the counter.
///
/// Mirrors the web's "Take an order" modal (OrdersPanel.jsx) field for field —
/// where it's going (counter, a room, or a table), guest details, search +
/// section filter, a stepper per dish, and a total with Cancel/Place order at
/// the foot — as one scrolling page behind a normal back-arrow app bar, same
/// as every other pushed screen in this app, instead of a dialog with its own
/// fixed head and foot.
///
/// A room only ever shows up here for a login that also holds `rooms.manage`
/// — GET /rooms answers 403 without it, exactly as it does on the web, which
/// makes the same attempt from the same screen. RECEPTION and KITCHEN, the
/// two roles that actually take counter orders, don't hold it, so in practice
/// the room list is empty for them and the picker quietly falls back to
/// Counter/takeaway and tables — not an error, just nothing to offer.
class CounterOrderScreen extends ConsumerStatefulWidget {
  const CounterOrderScreen({super.key});

  @override
  ConsumerState<CounterOrderScreen> createState() => _CounterOrderScreenState();
}

class _CounterOrderScreenState extends ConsumerState<CounterOrderScreen> {
  final _guestName = TextEditingController();
  final _guestPhone = TextEditingController();
  final _note = TextEditingController();
  final _search = TextEditingController();

  List<MenuSection> _sections = const [];
  List<DiningTable> _tables = const [];
  List<RoomListing> _rooms = const [];
  final List<OrderLineDraft> _lines = [];

  DiningTable? _table;
  RoomListing? _room;
  int? _activeSectionId;
  bool _loading = true;
  String? _loadError;
  String _query = '';
  String? _guestNameError;
  String? _guestPhoneError;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _guestName.dispose();
    _guestPhone.dispose();
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
    final lodge = ref.read(authViewModelProvider).me?.lodge;
    final servesTables = lodge?.foodTableService ?? false;
    final servesRooms = (lodge?.hasRooms ?? false) && (lodge?.foodRoomService ?? false);
    try {
      final sections = await vm.menu();
      // Only asked for where the property actually seats people. A lodge that
      // only does room service has no tables, and the request would be a round
      // trip for an empty list.
      final tables = servesTables ? await vm.tables() : const <DiningTable>[];
      // Same attempt the web makes, and the same shrug if it 403s: a room
      // only means anything here to a login that also holds `rooms.manage`,
      // which the counter-order roles don't — so a denied request is read as
      // "nothing to offer," not a reason to fail the whole screen.
      final rooms = servesRooms ? await _loadRooms(vm) : const <RoomListing>[];
      if (!mounted) return;
      final active = sections.where((s) => s.isActive).toList();
      setState(() {
        _sections = sections;
        _tables = tables.where((t) => t.isActive).toList();
        _rooms = rooms.where((r) => r.isActive && r.isOccupied).toList();
        if (active.isNotEmpty && !active.any((s) => s.id == _activeSectionId)) {
          _activeSectionId = active.first.id;
        }
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

  /// Rooms for the target picker, or nothing if this login can't reach
  /// `/rooms` — a 403 here means "not this role," not "the menu failed to
  /// load," so it's swallowed rather than surfaced as [_loadError].
  Future<List<RoomListing>> _loadRooms(OrdersViewModel vm) async {
    try {
      return await vm.roomsForOrder();
    } catch (_) {
      return const <RoomListing>[];
    }
  }

  /// Neither a room nor a table — a walk-in paying at the till, same as the
  /// web's COUNTER target.
  bool get _isCounter => _table == null && _room == null;

  num get _total => _lines.fold<num>(0, (sum, l) => sum + l.lineTotal);

  List<MenuSection> get _activeSections =>
      _sections.where((s) => s.isActive).toList();

  MenuSection? get _currentSection {
    final list = _activeSections;
    if (list.isEmpty) return null;
    return list.firstWhere(
      (s) => s.id == _activeSectionId,
      orElse: () => list.first,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.bg,
      // Same gradient icon-badge + accent underline the new-booking screen's
      // app bar carries, so the two full-page forms this desk fills in most
      // read as one system rather than two different styles.
      appBar: AppBar(
        backgroundColor: AppTheme.bg,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        foregroundColor: AppTheme.heading,
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
                  colors: [AppTheme.accent, Color(0xFF434FC1)],
                ),
                borderRadius: BorderRadius.circular(AppTheme.rSmall + 2),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x335A67D8),
                    offset: Offset(0, 3),
                    blurRadius: 8,
                  ),
                ],
              ),
              child: const Icon(
                Icons.restaurant_menu_rounded,
                color: Colors.white,
                size: 18,
              ),
            ),
            const SizedBox(width: AppTheme.s12),
            const Expanded(
              child: Text(
                'Take an order',
                overflow: TextOverflow.ellipsis,
                maxLines: 1,
              ),
            ),
          ],
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(3),
          child: Container(
            height: 3,
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [AppTheme.accent, Color(0x005A67D8)],
              ),
            ),
          ),
        ),
      ),
      body: SafeArea(child: _body()),
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
    final searching = _query.isNotEmpty;
    final working = ref.watch(ordersViewModelProvider).working;

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppTheme.s16,
        AppTheme.s12,
        AppTheme.s16,
        AppTheme.s24,
      ),
      children: [
        Text(
          'Goes straight into the kitchen queue — staff took it, so it '
          'skips the accept step.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: AppTheme.s8),

        // Every step on one card, same as the new-booking form — a section
        // is a small caption plus a hairline divider rather than a card of
        // its own, so three separate cards' worth of borders, shadows and
        // padding collapse into one compact surface.
        NeuCard(
          radius: AppTheme.rLarge,
          shadow: AppTheme.elevated,
          padding: const EdgeInsets.all(AppTheme.s12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SectionLabel("Where's it going", number: 1),
              const SizedBox(height: AppTheme.s8),
              _TargetField(
                tables: _tables,
                rooms: _rooms,
                selectedTable: _table,
                selectedRoom: _room,
                onSelectTable: (t) => setState(() {
                  _table = t;
                  _room = null;
                }),
                onSelectRoom: (r) => setState(() {
                  _room = r;
                  _table = null;
                }),
              ),

              // Only a true counter order — no room and no table — asks for
              // these. A room or a table already identifies who the food is
              // for, so re-typing a name there would be a second, weaker
              // record of something already known; a walk-in has nothing
              // else, so it's required rather than optional, same as the web
              // counter form.
              if (_isCounter) ...[
                const SizedBox(height: AppTheme.s8),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: NeuField(
                        controller: _guestName,
                        label: 'Guest name',
                        hint: "Who's collecting",
                        required: true,
                        errorText: _guestNameError,
                        maxLength: 200,
                        onChanged: (_) {
                          if (_guestNameError != null) {
                            setState(() => _guestNameError = null);
                          }
                        },
                        forceCapitalizeWords: true,
                      ),
                    ),
                    const SizedBox(width: AppTheme.s12),
                    Expanded(
                      child: NeuField(
                        controller: _guestPhone,
                        label: 'Phone',
                        hint: '10-digit mobile',
                        required: true,
                        errorText: _guestPhoneError,
                        keyboardType: TextInputType.phone,
                        maxLength: 10,
                        onChanged: (_) {
                          if (_guestPhoneError != null) {
                            setState(() => _guestPhoneError = null);
                          }
                        },
                      ),
                    ),
                  ],
                ),
              ],

              const SectionDivider(),
              const SectionLabel('Menu', number: 2),
              const SizedBox(height: AppTheme.s8),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: NeuField(
                      controller: _search,
                      hint: 'Search every section…',
                      label: '',
                      suffix: const Padding(
                        padding: EdgeInsets.only(right: AppTheme.s12),
                        child: Icon(
                          Icons.search_rounded,
                          size: 18,
                          color: AppTheme.muted,
                        ),
                      ),
                      onChanged: (v) =>
                          setState(() => _query = v.trim().toLowerCase()),
                    ),
                  ),
                  if (!searching && _activeSections.length > 1) ...[
                    const SizedBox(width: AppTheme.s8),
                    _SectionField(
                      sections: _activeSections,
                      selected: _currentSection,
                      onSelect: (s) => setState(() => _activeSectionId = s.id),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: AppTheme.s8),

              if (visible.isEmpty)
                const NeuNotice(
                  icon: Icons.search_off_rounded,
                  message: 'Nothing on the menu matches.',
                )
              else
                for (final section in visible) ...[
                  if (searching) ...[
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppTheme.s8),
                      child: Text(
                        section.name,
                        style: Theme.of(context).textTheme.labelMedium?.copyWith(color: AppTheme.muted),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                  for (final item in section.items)
                    _MenuRow(
                      item: item,
                      qtyFor: (p) => _qtyFor(item.id, p?.id),
                      onQty: (p, q) => _setQty(item, p, q),
                    ),
                  const SizedBox(height: AppTheme.s8),
                ],

              const SizedBox(height: AppTheme.s4),
              NeuField(
                controller: _note,
                label: 'Note for the kitchen',
                hint: 'Less spicy, no onion',
                labelAction: Text(
                  'optional',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),

              if (_lines.isNotEmpty) ...[
                const SectionDivider(),
                SectionLabel('Order (${_lines.length})', number: 3),
                const SizedBox(height: AppTheme.s8),
                for (final line in _lines)
                  _CartLine(
                    line: line,
                    onRemove: () => _setQty(line.item, line.portion, 0),
                  ),
              ],
            ],
          ),
        ),
        const SizedBox(height: AppTheme.s12),

        _OrderBar(
          lines: _lines,
          total: _total,
          working: working,
          onCancel: working ? null : () => Navigator.of(context).pop(),
          onPlace: (working || _lines.isEmpty) ? null : _place,
        ),
      ],
    );
  }

  /// The menu as the search has narrowed it, or just the chosen section when
  /// there's nothing typed — same split the web counter form makes.
  ///
  /// A dish that is off today stays on the list rather than disappearing, so
  /// the desk can tell a guest it is unavailable instead of that it does not
  /// exist — it simply cannot be added.
  List<MenuSection> _visibleSections() {
    final searching = _query.isNotEmpty;
    final source = searching
        ? _activeSections
        : (_currentSection == null ? const <MenuSection>[] : [_currentSection!]);

    final out = <MenuSection>[];
    for (final section in source) {
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

  int _qtyFor(int itemId, int? portionId) {
    final idx = _lines.indexWhere(
      (l) => l.item.id == itemId && l.portion?.id == portionId,
    );
    return idx >= 0 ? _lines[idx].quantity : 0;
  }

  void _setQty(MenuItem item, MenuPortion? portion, int quantity) {
    setState(() {
      final idx = _lines.indexWhere(
        (l) => l.item.id == item.id && l.portion?.id == portion?.id,
      );
      if (quantity <= 0) {
        if (idx >= 0) _lines.removeAt(idx);
      } else if (idx >= 0) {
        _lines[idx].quantity = quantity;
      } else {
        _lines.add(OrderLineDraft(item: item, portion: portion, quantity: quantity));
      }
    });
  }

  Future<void> _place() async {
    // Checked in the order the fields sit on the form, same as the web
    // counter form: guest details before anything else, so the first thing
    // reported is the first thing the eye reaches scrolling down.
    if (_isCounter) {
      final phone = _guestPhone.text.trim();
      setState(() {
        _guestNameError = _guestName.text.trim().isEmpty
            ? "Add the guest's name for a counter order."
            : null;
        // Same 10-digit mobile rule the new-booking form checks — a landline
        // or a mistyped number isn't something the kitchen can call back.
        _guestPhoneError = phone.isEmpty
            ? 'Add a phone number for a counter order.'
            : (phone.length != 10 || int.tryParse(phone) == null)
                ? 'Enter a valid 10-digit mobile number.'
                : null;
      });
      if (_guestNameError != null || _guestPhoneError != null) return;
    }

    if (_lines.isEmpty) return;

    final vm = ref.read(ordersViewModelProvider.notifier);
    final order = await vm.placeCounterOrder(
      roomId: _room?.id,
      tableId: _table?.id,
      guestName: _guestName.text,
      guestPhone: _guestPhone.text,
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

class _TargetField extends StatelessWidget {
  final List<DiningTable> tables;
  final List<RoomListing> rooms;
  final DiningTable? selectedTable;
  final RoomListing? selectedRoom;
  final ValueChanged<DiningTable?> onSelectTable;
  final ValueChanged<RoomListing?> onSelectRoom;

  const _TargetField({
    required this.tables,
    required this.rooms,
    required this.selectedTable,
    required this.selectedRoom,
    required this.onSelectTable,
    required this.onSelectRoom,
  });

  // Same shape the web's own <select> keys its options with —
  // "${kind}:${id}" — so a room and a table can never collide even though
  // both count up from 1 in their own tables.
  static const _counterKey = 'C';

  @override
  Widget build(BuildContext context) {
    final value = selectedRoom != null
        ? 'R:${selectedRoom!.id}'
        : selectedTable != null
        ? 'T:${selectedTable!.id}'
        : _counterKey;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        border: Border.all(color: AppTheme.border),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: value,
          isExpanded: true,
          isDense: false,
          icon: const Icon(
            Icons.keyboard_arrow_down_rounded,
            color: AppTheme.muted,
            size: 20,
          ),
          dropdownColor: AppTheme.card,
          borderRadius: BorderRadius.circular(AppTheme.rMedium),
          style: const TextStyle(color: AppTheme.heading, fontSize: 15),
          items: [
            const DropdownMenuItem(
              value: _counterKey,
              child: Text('Counter / takeaway'),
            ),
            for (final room in rooms)
              DropdownMenuItem(
                value: 'R:${room.id}',
                child: Text('Room ${room.roomNumber}'),
              ),
            for (final table in tables)
              DropdownMenuItem(value: 'T:${table.id}', child: Text(table.label)),
          ],
          onChanged: (key) {
            if (key == null || key == _counterKey) {
              onSelectRoom(null);
              onSelectTable(null);
              return;
            }
            final id = int.parse(key.substring(2));
            if (key.startsWith('R:')) {
              onSelectRoom(rooms.firstWhere((r) => r.id == id));
            } else {
              onSelectTable(tables.firstWhere((t) => t.id == id));
            }
          },
        ),
      ),
    );
  }
}

// ── Which section the search is narrowed to ─────────────────────────────────

class _SectionField extends StatelessWidget {
  final List<MenuSection> sections;
  final MenuSection? selected;
  final ValueChanged<MenuSection> onSelect;

  const _SectionField({
    required this.sections,
    required this.selected,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final current = selected;
    if (current == null) return const SizedBox.shrink();

    return PopupMenuButton<MenuSection>(
      initialValue: current,
      onSelected: onSelect,
      offset: const Offset(0, 8),
      color: AppTheme.card,
      elevation: 6,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        side: const BorderSide(color: AppTheme.border),
      ),
      constraints: const BoxConstraints(minWidth: 220, maxWidth: 280),
      itemBuilder: (context) => [
        for (final section in sections)
          PopupMenuItem<MenuSection>(
            value: section,
            height: 44,
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '${section.name} (${section.items.length})',
                    style: Theme.of(context).textTheme.bodyMedium,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (section.id == current.id)
                  const Icon(Icons.check_rounded, color: AppTheme.accent, size: 18),
              ],
            ),
          ),
      ],
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.s12,
          vertical: 14,
        ),
        decoration: BoxDecoration(
          color: AppTheme.card,
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          border: Border.all(color: AppTheme.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 140),
              child: Text(
                '${current.name} (${current.items.length})',
                style: Theme.of(context).textTheme.bodyMedium,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: AppTheme.s4),
            const Icon(
              Icons.keyboard_arrow_down_rounded,
              size: 18,
              color: AppTheme.muted,
            ),
          ],
        ),
      ),
    );
  }
}

// ── One dish on the menu ────────────────────────────────────────────────────

class _MenuRow extends StatelessWidget {
  final MenuItem item;
  final int Function(MenuPortion?) qtyFor;
  final void Function(MenuPortion?, int) onQty;

  const _MenuRow({required this.item, required this.qtyFor, required this.onQty});

  @override
  Widget build(BuildContext context) {
    final off = !item.orderable;

    final nameRow = Row(
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
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: off ? AppTheme.muted : null,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (off)
                Text(
                  'Off today',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppTheme.danger),
                ),
            ],
          ),
        ),
      ],
    );

    if (!item.hasPortions) {
      return Padding(
        padding: const EdgeInsets.only(bottom: AppTheme.s12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: nameRow),
            const SizedBox(width: AppTheme.s8),
            SizedBox(
              width: 56,
              child: Text(
                formatPrice(item.price),
                textAlign: TextAlign.right,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppTheme.muted),
              ),
            ),
            const SizedBox(width: AppTheme.s8),
            _Stepper(
              qty: qtyFor(null),
              enabled: !off,
              onChanged: (q) => onQty(null, q),
            ),
          ],
        ),
      );
    }

    // Each size gets its own stepper: the server refuses a line that names a
    // dish with sizes but no size, so there is nothing sensible to add
    // without choosing one.
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          nameRow,
          const SizedBox(height: AppTheme.s8),
          for (final portion in item.portions)
            Padding(
              padding: EdgeInsets.only(
                left: item.foodType != null ? 20 : 0,
                bottom: AppTheme.s8,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      portion.label,
                      style: Theme.of(context).textTheme.bodySmall,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  SizedBox(
                    width: 56,
                    child: Text(
                      formatPrice(portion.price),
                      textAlign: TextAlign.right,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppTheme.muted),
                    ),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  _Stepper(
                    qty: qtyFor(portion),
                    enabled: !off && portion.isAvailable,
                    onChanged: (q) => onQty(portion, q),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// The +/- quantity control sitting beside each dish, replacing a separate
/// "add" tap and cart-only stepper with the one control the web form's own
/// per-line `Stepper` gives — the count is set right where the price is.
class _Stepper extends StatelessWidget {
  final int qty;
  final bool enabled;
  final ValueChanged<int> onChanged;

  const _Stepper({
    required this.qty,
    required this.onChanged,
    this.enabled = true,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 32,
      decoration: BoxDecoration(
        border: Border.all(color: AppTheme.border),
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _btn(Icons.remove_rounded, enabled && qty > 0 ? () => onChanged(qty - 1) : null),
          Container(
            width: 26,
            height: 32,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              border: Border(
                left: BorderSide(color: AppTheme.border),
                right: BorderSide(color: AppTheme.border),
              ),
            ),
            child: Text(
              '$qty',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppTheme.heading,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          _btn(Icons.add_rounded, enabled ? () => onChanged(qty + 1) : null),
        ],
      ),
    );
  }

  Widget _btn(IconData icon, VoidCallback? onTap) {
    return InkWell(
      onTap: onTap,
      child: SizedBox(
        width: 28,
        height: 30,
        child: Icon(
          icon,
          size: 16,
          color: onTap == null ? AppTheme.border : AppTheme.text,
        ),
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

// ── The total + Cancel / Place order row ────────────────────────────────────

/// Same layout the new-booking form's own closing row uses: the total sits
/// on its own line, then Cancel and the primary action each take an
/// [Expanded] share of full width below it — full-size buttons that read
/// clearly at any screen width, rather than a [FittedBox] shrinking both
/// down to fit beside a total chip.
class _OrderBar extends StatelessWidget {
  final List<OrderLineDraft> lines;
  final num total;
  final bool working;
  final VoidCallback? onCancel;
  final VoidCallback? onPlace;

  const _OrderBar({
    required this.lines,
    required this.total,
    required this.working,
    required this.onCancel,
    required this.onPlace,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppTheme.s16,
        AppTheme.s12,
        AppTheme.s16,
        AppTheme.s12,
      ),
      decoration: const BoxDecoration(
        color: AppTheme.card,
        border: Border(top: BorderSide(color: AppTheme.border)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Text(
                lines.isEmpty
                    ? 'Total'
                    : '${lines.length} item${lines.length == 1 ? '' : 's'}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const Spacer(),
              Text(
                formatPrice(total),
                style: const TextStyle(
                  color: AppTheme.accent,
                  fontWeight: FontWeight.w800,
                  fontSize: 18,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          Row(
            children: [
              Expanded(
                child: NeuButton(
                  onPressed: onCancel,
                  padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                  child: const Text('Cancel'),
                ),
              ),
              const SizedBox(width: AppTheme.s12),
              Expanded(
                flex: 2,
                child: NeuButton(
                  primary: true,
                  onPressed: onPlace,
                  padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                  child: working
                      ? const SizedBox(
                          height: 16,
                          width: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Place order'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ── One line on the ticket so far ───────────────────────────────────────────

class _CartLine extends StatelessWidget {
  final OrderLineDraft line;
  final VoidCallback onRemove;

  const _CartLine({required this.line, required this.onRemove});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.s8),
      child: Row(
        children: [
          Text(
            '${line.quantity}×',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppTheme.muted),
          ),
          const SizedBox(width: AppTheme.s8),
          Expanded(
            child: Text(
              line.label,
              style: Theme.of(context).textTheme.bodyMedium,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          Text(
            formatPrice(line.lineTotal),
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          SizedBox(
            width: 32,
            height: 32,
            child: IconButton(
              padding: EdgeInsets.zero,
              icon: const Icon(Icons.close_rounded, size: 16),
              color: AppTheme.muted,
              onPressed: onRemove,
            ),
          ),
        ],
      ),
    );
  }
}
