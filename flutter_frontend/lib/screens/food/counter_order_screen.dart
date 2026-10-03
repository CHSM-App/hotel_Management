import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/food_order.dart';
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
  /// Set to edit that order's items instead of taking a new one — same modal
  /// the web reuses for its "Edit order", just as a pushed screen. The
  /// target (room/table/counter) and guest details aren't sent by
  /// PATCH /orders/:id/items, so this screen shows them read-only rather
  /// than lets them be changed.
  final FoodOrder? editingOrder;

  const CounterOrderScreen({super.key, this.editingOrder});

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

  // Two steps on this screen, same as the web counter form's own flow —
  // where it's going first, the menu second — rather than one long page
  // where the menu (by far the longest part) is buried below the target
  // and guest fields. 0 = target/guest, 1 = menu. Editing skips straight to
  // the menu: the target can't change on an edit, so there is nothing for
  // step 0 to ask.
  int _step = 0;

  // The section strip and the All/Veg/Non-veg strip both pin to the top of
  // the menu step while the dish list scrolls under them — a real sliver
  // header, not a lookalike — the same way a food-delivery app's own
  // category bar stays put. Tapping a tab scrolls to its first anchor;
  // scrolling the list past an anchor swaps the highlighted tab to match.
  final ScrollController _scrollController = ScrollController();
  String _dietTab = 'ALL';

  // Anchors the sticky header's bottom edge against the scroll viewport's
  // own top — a fixed point that doesn't move with scrolling — rather than
  // measuring the pinned header's own RenderBox, which turned out to lag
  // or report stale geometry right when [_onScroll] needed it most.
  final GlobalKey _scrollViewportKey = GlobalKey();
  bool _headerHasSectionTabs = false;
  bool _headerHasDietTabs = false;

  // Every section's own anchor, and every section's own Veg/Non-veg group
  // anchor, keyed by section id (and reused build to build so a GlobalKey
  // never jumps between sections). Every section gets its own diet-group
  // anchors — not just the first one — so scrolling into a later section's
  // Veg or Non-veg group still updates the diet tab instead of freezing on
  // whichever kind the first section happened to end on.
  final Map<int, GlobalKey> _sectionAnchorKeys = {};
  final Map<int, GlobalKey> _vegGroupKeys = {};
  final Map<int, GlobalKey> _nonVegGroupKeys = {};
  List<int> _renderedSectionIds = const [];
  List<(String type, GlobalKey key)> _renderedDietGroups = const [];

  GlobalKey _sectionAnchorKey(int id) =>
      _sectionAnchorKeys.putIfAbsent(id, GlobalKey.new);
  GlobalKey _vegGroupKey(int id) => _vegGroupKeys.putIfAbsent(id, GlobalKey.new);
  GlobalKey _nonVegGroupKey(int id) =>
      _nonVegGroupKeys.putIfAbsent(id, GlobalKey.new);

  // Who is checked into the selected room, so staff can eyeball the register
  // before charging food to somebody's stay. Null while nothing is selected.
  RoomOccupancy? _occupancy;
  bool _occupancyLoading = false;
  bool _occupancyFailed = false;

  @override
  void initState() {
    super.initState();
    if (_editing) _step = 1;
    Future.microtask(_load);
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _guestName.dispose();
    _guestPhone.dispose();
    _note.dispose();
    _search.dispose();
    super.dispose();
  }

  // Used only before the scroll viewport has laid out for the first time —
  // after that, [_thresholdY] gives the real position instead of this guess.
  static const double _scrollAnchorThreshold = 170;

  double? _anchorTop(GlobalKey? key) {
    final renderObject = key?.currentContext?.findRenderObject();
    if (renderObject is! RenderBox || !renderObject.attached) return null;
    return renderObject.localToGlobal(Offset.zero).dy;
  }

  /// The line a dish's heading has to climb above to count as "under the
  /// tabs," and the line [_scrollToAnchor] has to land a target just below
  /// so the pinned header doesn't cover it. Computed as the scroll
  /// viewport's own top — fixed on screen, independent of scroll position —
  /// plus the sticky header's known height, rather than measuring the
  /// pinned header's own RenderBox: that header only exists once the sliver
  /// protocol has actually pinned it, and its reported geometry lagged
  /// behind real scroll position often enough to leave sections and diet
  /// groups stuck on whatever tab was active before.
  double _thresholdY() {
    final renderObject = _scrollViewportKey.currentContext?.findRenderObject();
    final viewportTop = (renderObject is RenderBox && renderObject.attached)
        ? renderObject.localToGlobal(Offset.zero).dy
        : _scrollAnchorThreshold;
    final headerHeight =
        (_headerHasSectionTabs ? _StickyMenuTabsDelegate.sectionRowHeight : 0) +
        (_headerHasDietTabs ? _StickyMenuTabsDelegate.dietRowHeight : 0);
    return viewportTop + headerHeight;
  }

  void _onScroll() {
    final threshold = _thresholdY();

    // The last diet group (in rendered order, across every section) whose
    // heading has climbed past the threshold is the one currently under
    // the tab strip — not just the first section's own Veg/Non-veg split,
    // so scrolling into a later section's groups keeps the tab in sync
    // instead of freezing on whatever the first section ended on.
    String nextDiet = 'ALL';
    for (final (type, key) in _renderedDietGroups) {
      final top = _anchorTop(key);
      if (top != null && top <= threshold) {
        nextDiet = type;
      } else {
        break;
      }
    }

    // Same rule, walked across every section heading instead.
    int? nextSection;
    for (final id in _renderedSectionIds) {
      final top = _anchorTop(_sectionAnchorKeys[id]);
      if (top != null && top <= threshold) {
        nextSection = id;
      } else {
        break;
      }
    }

    final dietChanged = nextDiet != _dietTab;
    final sectionChanged =
        nextSection != null && nextSection != _activeSectionId;
    if (dietChanged || sectionChanged) {
      setState(() {
        if (dietChanged) _dietTab = nextDiet;
        if (sectionChanged) _activeSectionId = nextSection;
      });
    }
  }

  /// Scrolls so [key]'s widget lands just below the pinned header, rather
  /// than [Scrollable.ensureVisible]'s own idea of "visible" — which is
  /// happy to park it right at the very top of the viewport, underneath
  /// the header, where a pinned sliver would hide it.
  void _scrollToAnchor(GlobalKey? key) {
    if (key == null || !_scrollController.hasClients) return;
    final renderObject = key.currentContext?.findRenderObject();
    if (renderObject is! RenderBox || !renderObject.attached) return;
    final targetTop = renderObject.localToGlobal(Offset.zero).dy;
    final delta = targetTop - _thresholdY();
    final position = _scrollController.position;
    final newOffset = (_scrollController.offset + delta).clamp(
      position.minScrollExtent,
      position.maxScrollExtent,
    );
    _scrollController.animateTo(
      newOffset,
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeInOut,
    );
  }

  void _selectDietTab(String tab) {
    setState(() => _dietTab = tab);
    if (tab == 'ALL') {
      _scrollController.animateTo(
        0,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeInOut,
      );
      return;
    }
    // Jumps to the first section that has this kind — later sections' own
    // Veg/Non-veg groups are what the scroll listener picks up once the
    // desk scrolls past them, not where a tap on the tab lands.
    for (final (type, key) in _renderedDietGroups) {
      if (type == tab) {
        _scrollToAnchor(key);
        return;
      }
    }
  }

  void _selectSectionTab(MenuSection section) {
    setState(() => _activeSectionId = section.id);
    _scrollToAnchor(_sectionAnchorKeys[section.id]);
  }

  /// Guest name/phone are only asked for a true counter order, same rule
  /// [_place] already checked inline — pulled out so the "Next" button on
  /// step 0 can run the same check before letting the desk into the menu.
  bool _validateGuestDetails() {
    if (!_isCounter) return true;
    final phone = _guestPhone.text.trim();
    setState(() {
      _guestNameError = _guestName.text.trim().isEmpty
          ? "Add the guest's name for a counter order."
          : null;
      _guestPhoneError = phone.isEmpty
          ? 'Add a phone number for a counter order.'
          : (phone.length != 10 || int.tryParse(phone) == null)
              ? 'Enter a valid 10-digit mobile number.'
              : null;
    });
    return _guestNameError == null && _guestPhoneError == null;
  }

  void _goToMenu() {
    if (!_validateGuestDetails()) return;
    setState(() => _step = 1);
  }

  void _goBack() => setState(() => _step = 0);

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
      _prefillForEdit();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = ref.read(ordersViewModelProvider).error ??
            'Could not load the menu.';
      });
    }
  }

  FoodOrder? get _editingOrder => widget.editingOrder;
  bool get _editing => _editingOrder != null;

  /// Rebuild the cart from the order being edited, once the menu has
  /// loaded — matched by menuItemId/portionId the same way the web's
  /// editOrder modal seeds itself from the order it was opened on. A line
  /// whose dish has since been removed from the menu is left off; its
  /// quantity can no longer be expressed through this picker.
  void _prefillForEdit() {
    final order = _editingOrder;
    if (order == null || _lines.isNotEmpty) return;
    final allItems = _sections.expand((s) => s.items);
    final drafts = <OrderLineDraft>[];
    for (final line in order.items) {
      if (line.menuItemId == null) continue;
      MenuItem? item;
      for (final i in allItems) {
        if (i.id == line.menuItemId) {
          item = i;
          break;
        }
      }
      if (item == null) continue;
      final portion = line.portionId == null
          ? null
          : item.portions.where((p) => p.id == line.portionId).firstOrNull;
      drafts.add(
        OrderLineDraft(item: item, portion: portion, quantity: line.quantity),
      );
    }
    setState(() {
      _lines
        ..clear()
        ..addAll(drafts);
      _note.text = order.note ?? '';
    });
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

  /// Who is checked into [roomId], so staff can eyeball the register before
  /// charging food to somebody's stay. Mirrors the web: resolved server-side
  /// against the live booking rather than read off the room list.
  ///
  /// The room id is captured per-call and checked before the result is
  /// applied — a quick change of selection can land two responses out of
  /// order, and the wrong guest shown next to the wrong room is exactly the
  /// error this guards against.
  Future<void> _loadOccupancy(int roomId) async {
    setState(() {
      _occupancy = null;
      _occupancyFailed = false;
      _occupancyLoading = true;
    });
    final vm = ref.read(ordersViewModelProvider.notifier);
    try {
      final occupancy = await vm.roomOccupancy(roomId);
      if (!mounted || _room?.id != roomId) return;
      setState(() {
        _occupancy = occupancy;
        _occupancyLoading = false;
      });
    } catch (_) {
      // A lookup failure must not block the order — the desk can still take
      // it. Say the check failed rather than asserting the room is empty,
      // which would be a worse lie than saying nothing.
      if (!mounted || _room?.id != roomId) return;
      setState(() {
        _occupancyFailed = true;
        _occupancyLoading = false;
      });
    }
  }

  void _clearOccupancy() {
    _occupancy = null;
    _occupancyFailed = false;
    _occupancyLoading = false;
  }

  /// Neither a room nor a table — a walk-in paying at the till, same as the
  /// web's COUNTER target.
  bool get _isCounter => _table == null && _room == null;

  num get _total => _lines.fold<num>(0, (sum, l) => sum + l.lineTotal);

  List<MenuSection> get _activeSections =>
      _sections.where((s) => s.isActive).toList();

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
            Expanded(
              child: Text(
                _editing
                    ? 'Edit order #${_editingOrder!.orderNumber}'
                    : 'Take an order',
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

    return _step == 0 ? _targetStep() : _menuStep();
  }

  // ── Step 0: where it's going ────────────────────────────────────────────

  Widget _targetStep() {
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              AppTheme.s16,
              AppTheme.s8,
              AppTheme.s16,
              AppTheme.s16,
            ),
            children: [
              Text(
                'Goes straight into the kitchen queue — staff took it, so it '
                'skips the accept step.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: AppTheme.s4),
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
                        _clearOccupancy();
                      }),
                      onSelectRoom: (r) {
                        setState(() {
                          _room = r;
                          _table = null;
                          _clearOccupancy();
                        });
                        if (r != null) _loadOccupancy(r.id);
                      },
                    ),

                    if (_room != null) ...[
                      const SizedBox(height: AppTheme.s8),
                      _OccupancyCard(
                        loading: _occupancyLoading,
                        failed: _occupancyFailed,
                        occupancy: _occupancy,
                      ),
                    ],

                    // Only a true counter order — no room and no table —
                    // asks for these. A room or a table already identifies
                    // who the food is for, so re-typing a name there would
                    // be a second, weaker record of something already
                    // known; a walk-in has nothing else, so it's required
                    // rather than optional, same as the web counter form.
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
                  ],
                ),
              ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.fromLTRB(
            AppTheme.s12,
            AppTheme.s4,
            AppTheme.s12,
            AppTheme.s4,
          ),
          decoration: const BoxDecoration(
            color: AppTheme.card,
            border: Border(top: BorderSide(color: AppTheme.border)),
          ),
          child: Row(
            children: [
              Expanded(
                child: NeuButton(
                  onPressed: () => Navigator.of(context).pop(),
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: const Text('Cancel', style: TextStyle(fontSize: 13)),
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                flex: 2,
                child: NeuButton(
                  primary: true,
                  onPressed: _goToMenu,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: const Text(
                    'Next: Menu',
                    style: TextStyle(fontSize: 13),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ── Step 1: the menu ────────────────────────────────────────────────────

  Widget _menuStep() {
    final visible = _visibleSections();
    final working = ref.watch(ordersViewModelProvider).working;
    final showSectionTabs = _activeSections.length > 1;
    final showDietTabs = visible.isNotEmpty;
    final menuNumber = _editing ? 1 : 2;
    _headerHasSectionTabs = showSectionTabs;
    _headerHasDietTabs = showDietTabs;

    return Column(
      children: [
        Expanded(
          child: CustomScrollView(
            key: _scrollViewportKey,
            controller: _scrollController,
            // Flutter's default cache extent (250px) only mounts widgets
            // near the viewport, so a GlobalKey for a section several
            // screens down has no RenderObject to scroll to until the desk
            // has already scrolled close to it by hand — tapping a distant
            // section's tab would silently do nothing. A menu here tops out
            // at a few hundred dishes, so mounting everything up front is
            // cheap enough to trade for tap-to-scroll actually working.
            cacheExtent: 20000,
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppTheme.s16,
                    AppTheme.s8,
                    AppTheme.s16,
                    AppTheme.s4,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // The target (room/table/counter) isn't sent by
                      // PATCH /orders/:id/items — it can't be changed on an
                      // edit, so it's shown as a fact rather than a field,
                      // same as the web's own editOrder modal. A new order
                      // already confirmed its target on step 0, so nothing
                      // needs repeating here.
                      if (_editing) ...[
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppTheme.s16,
                            vertical: AppTheme.s12,
                          ),
                          decoration: BoxDecoration(
                            color: AppTheme.card,
                            borderRadius: BorderRadius.circular(
                              AppTheme.rSmall,
                            ),
                            border: Border.all(color: AppTheme.border),
                          ),
                          child: Text(
                            '${_editingOrder!.target}'
                            '${(_editingOrder!.guestName ?? '').isNotEmpty ? ' · ${_editingOrder!.guestName}' : ''}',
                            style: const TextStyle(
                              color: AppTheme.heading,
                              fontSize: 15,
                            ),
                          ),
                        ),
                        const SizedBox(height: AppTheme.s12),
                        Text(
                          'Saving replaces this order\'s items wholesale — '
                          'billed or ready-to-bill orders can no longer be '
                          'edited.',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        const SizedBox(height: AppTheme.s8),
                      ],
                      SectionLabel('Menu', number: menuNumber),
                      const SizedBox(height: AppTheme.s8),
                      NeuField(
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
                    ],
                  ),
                ),
              ),
              if (showSectionTabs || showDietTabs)
                SliverPersistentHeader(
                  pinned: true,
                  delegate: _StickyMenuTabsDelegate(
                    sections: _activeSections,
                    selectedSectionId: _activeSectionId,
                    onSelectSection: _selectSectionTab,
                    selectedDiet: _dietTab,
                    onSelectDiet: _selectDietTab,
                    showSectionTabs: showSectionTabs,
                    showDietTabs: showDietTabs,
                  ),
                ),
              if (visible.isEmpty)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppTheme.s16,
                      AppTheme.s12,
                      AppTheme.s16,
                      0,
                    ),
                    child: const NeuNotice(
                      icon: Icons.search_off_rounded,
                      message: 'Nothing on the menu matches.',
                    ),
                  ),
                )
              else
                SliverPadding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppTheme.s16,
                  ),
                  sliver: SliverList(
                    delegate: SliverChildListDelegate(
                      _menuListWidgets(visible),
                    ),
                  ),
                ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppTheme.s16,
                    AppTheme.s4,
                    AppTheme.s16,
                    AppTheme.s24,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
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
                        SectionLabel(
                          'Order (${_lines.length})',
                          number: menuNumber + 1,
                        ),
                        const SizedBox(height: AppTheme.s8),
                        for (final line in _lines)
                          _CartLine(
                            line: line,
                            onRemove: () =>
                                _setQty(line.item, line.portion, 0),
                          ),
                      ],
                    ],
                  ),
                ),
              ),
              // Guarantees every section — including the last one, however
              // short — can still scroll its heading all the way up to the
              // pinned header's bottom edge. Without this, a short trailing
              // section plus a short note/cart block can run out of
              // scrollable distance before that heading ever reaches the
              // threshold [_onScroll] checks, so its tab never highlights.
              SliverToBoxAdapter(
                child: SizedBox(
                  height: MediaQuery.sizeOf(context).height * 0.6,
                ),
              ),
            ],
          ),
        ),
        _OrderBar(
          lines: _lines,
          total: _total,
          working: working,
          editing: _editing,
          cancelLabel: _editing ? 'Cancel' : 'Back',
          onCancel: working
              ? null
              : (_editing ? () => Navigator.of(context).pop() : _goBack),
          onPlace: (working || _lines.isEmpty) ? null : _place,
        ),
      ],
    );
  }

  /// Every active section, narrowed to whatever the search matched — all of
  /// them in one scrollable list, with the pinned section/diet tabs above
  /// as the way to jump straight to one instead of a filter that hides the
  /// rest.
  ///
  /// A dish that is off today stays on the list rather than disappearing, so
  /// the desk can tell a guest it is unavailable instead of that it does not
  /// exist — it simply cannot be added.
  List<MenuSection> _visibleSections() {
    final out = <MenuSection>[];
    for (final section in _activeSections) {
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

  /// Every active section's dishes, stacked one after another and split
  /// into a Veg group and a Non-veg group (egg counted as non-veg for this
  /// split) — the same grouping MenuPanel's own card uses. Each section's
  /// own heading carries the anchor [_SectionTabs] scrolls against, and
  /// each section's own Veg/Non-veg group headings carry the anchors
  /// [_DietTabs] scrolls against — every section's, not just the first, so
  /// scrolling through a later section still updates the right tab. A
  /// section with only one kind gets no heading for the other, same as a
  /// search result that only matched veg dishes.
  List<Widget> _menuListWidgets(List<MenuSection> visible) {
    _renderedSectionIds = visible.map((s) => s.id).toList();
    final dietGroups = <(String, GlobalKey)>[];
    final widgets = <Widget>[];

    for (final section in visible) {
      widgets.add(
        Padding(
          key: _sectionAnchorKey(section.id),
          padding: const EdgeInsets.only(top: AppTheme.s8, bottom: AppTheme.s4),
          child: Text(
            section.name,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
              color: AppTheme.heading,
              fontWeight: FontWeight.w700,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      );

      final vegItems = section.items
          .where((i) => (i.foodType ?? 'VEG') == 'VEG')
          .toList();
      final nonVegItems = section.items
          .where((i) => (i.foodType ?? 'VEG') != 'VEG')
          .toList();

      if (vegItems.isNotEmpty) {
        final key = _vegGroupKey(section.id);
        dietGroups.add(('VEG', key));
        widgets.add(_DietGroupLabel(key: key, label: 'Veg', color: AppTheme.vacant));
        for (final item in vegItems) {
          widgets.add(
            _MenuRow(
              item: item,
              qtyFor: (p) => _qtyFor(item.id, p?.id),
              onQty: (p, q) => _setQty(item, p, q),
            ),
          );
        }
      }

      if (nonVegItems.isNotEmpty) {
        final key = _nonVegGroupKey(section.id);
        dietGroups.add(('NON_VEG', key));
        widgets.add(
          _DietGroupLabel(key: key, label: 'Non-veg', color: AppTheme.danger),
        );
        for (final item in nonVegItems) {
          widgets.add(
            _MenuRow(
              item: item,
              qtyFor: (p) => _qtyFor(item.id, p?.id),
              onQty: (p, q) => _setQty(item, p, q),
            ),
          );
        }
      }

      widgets.add(const SizedBox(height: AppTheme.s4));
    }

    _renderedDietGroups = dietGroups;
    return widgets;
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
    if (_editing) {
      await _saveEdit();
      return;
    }

    // Already checked once by the "Next" button on step 0, but a cart that
    // got here without ever validating — unlikely, but cheap to guard
    // again — shouldn't be able to place an order with a bad guest name.
    if (!_validateGuestDetails()) {
      setState(() => _step = 0);
      return;
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

  Future<void> _saveEdit() async {
    if (_lines.isEmpty) return;
    final vm = ref.read(ordersViewModelProvider.notifier);
    final order = await vm.editOrder(_editingOrder!.id, _lines, _note.text);
    if (!mounted) return;
    if (order == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            ref.read(ordersViewModelProvider).error ??
                'Could not save those changes.',
          ),
          backgroundColor: AppTheme.heading,
        ),
      );
      return;
    }
    Navigator.of(context).pop(true);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Order #${order.orderNumber} updated.'),
        backgroundColor: AppTheme.heading,
      ),
    );
  }
}

// ── Where it goes ───────────────────────────────────────────────────────────

/// What the picker sheet hands back when the desk taps a row — a kind and,
/// for a room or table, which one. Resolved against the live [rooms] /
/// [tables] lists by [_TargetField._open] rather than carrying the object
/// itself, so the sheet only ever needs an id.
enum _TargetKind { counter, room, table }

class _TargetChoice {
  final _TargetKind kind;
  final int? id;
  const _TargetChoice(this.kind, this.id);
}

/// Opens a styled dropdown panel anchored right under the field — not a
/// sheet taking over the screen — with Counter, then every room, then every
/// table as grouped rows behind icons, instead of the plain system dropdown
/// this replaces. The field itself shows the current choice as an icon +
/// name, same shape as the rest of this screen's fields, so it doesn't look
/// like a different kind of control.
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

  bool get _isCounter => selectedRoom == null && selectedTable == null;

  IconData get _icon => selectedRoom != null
      ? Icons.bed_rounded
      : selectedTable != null
      ? Icons.table_restaurant_rounded
      : Icons.point_of_sale_rounded;

  String get _label => selectedRoom != null
      ? 'Room ${selectedRoom!.roomNumber}'
      : selectedTable != null
      ? selectedTable!.label
      : 'Counter / takeaway';

  PopupMenuEntry<_TargetChoice> _groupLabel(String label) {
    return PopupMenuItem<_TargetChoice>(
      enabled: false,
      height: 28,
      padding: const EdgeInsets.fromLTRB(AppTheme.s8, AppTheme.s12, AppTheme.s8, 0),
      child: Text(
        label,
        style: const TextStyle(
          color: AppTheme.muted,
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.6,
        ),
      ),
    );
  }

  // Each row is its own bordered tile with a gap under it, rather than a
  // packed list where one row's text sits flush against the next — on a
  // phone a thumb covers several cramped rows at once, and nothing short of
  // guessing says which one actually got the tap. A boxed tile with daylight
  // around it is an unambiguous target, and the selected one keeps its
  // accent border and check after the menu closes and reopens, so the field
  // above and the list agree at a glance on what's chosen.
  PopupMenuEntry<_TargetChoice> _row({
    required _TargetChoice choice,
    required IconData icon,
    required String label,
    required bool selected,
  }) {
    return PopupMenuItem<_TargetChoice>(
      value: choice,
      height: 54,
      padding: const EdgeInsets.fromLTRB(AppTheme.s8, 4, AppTheme.s8, 4),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.s12,
          vertical: AppTheme.s8,
        ),
        decoration: BoxDecoration(
          color: selected ? AppTheme.accent.withValues(alpha: 0.08) : AppTheme.bg,
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          border: Border.all(
            color: selected ? AppTheme.accent : AppTheme.border,
            width: selected ? 1.4 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(
              icon,
              size: 17,
              color: selected ? AppTheme.accent : AppTheme.muted,
            ),
            const SizedBox(width: AppTheme.s12),
            Expanded(
              child: Text(
                label,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: selected ? AppTheme.accent : AppTheme.heading,
                  fontSize: 14.5,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ),
            if (selected)
              const Icon(
                Icons.check_circle_rounded,
                size: 19,
                color: AppTheme.accent,
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _open(BuildContext context) async {
    final RenderBox button = context.findRenderObject() as RenderBox;
    final RenderBox overlay =
        Overlay.of(context).context.findRenderObject() as RenderBox;
    final RelativeRect position = RelativeRect.fromRect(
      Rect.fromPoints(
        button.localToGlobal(Offset.zero, ancestor: overlay),
        button.localToGlobal(button.size.bottomRight(Offset.zero), ancestor: overlay),
      ),
      Offset.zero & overlay.size,
    );

    final choice = await showMenu<_TargetChoice>(
      context: context,
      position: position,
      color: AppTheme.card,
      elevation: 6,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        side: const BorderSide(color: AppTheme.border),
      ),
      constraints: BoxConstraints(
        minWidth: button.size.width,
        maxWidth: button.size.width,
        maxHeight: 400,
      ),
      items: [
        _row(
          choice: const _TargetChoice(_TargetKind.counter, null),
          icon: Icons.point_of_sale_rounded,
          label: 'Counter / takeaway',
          selected: _isCounter,
        ),
        if (rooms.isNotEmpty) ...[
          _groupLabel('ROOMS'),
          for (final room in rooms)
            _row(
              choice: _TargetChoice(_TargetKind.room, room.id),
              icon: Icons.bed_rounded,
              label: 'Room ${room.roomNumber}',
              selected: selectedRoom?.id == room.id,
            ),
        ],
        if (tables.isNotEmpty) ...[
          _groupLabel('TABLES'),
          for (final table in tables)
            _row(
              choice: _TargetChoice(_TargetKind.table, table.id),
              icon: Icons.table_restaurant_rounded,
              label: table.label,
              selected: selectedTable?.id == table.id,
            ),
        ],
      ],
    );
    if (choice == null) return;
    switch (choice.kind) {
      case _TargetKind.counter:
        onSelectRoom(null);
        onSelectTable(null);
        break;
      case _TargetKind.room:
        onSelectTable(null);
        onSelectRoom(rooms.firstWhere((r) => r.id == choice.id));
        break;
      case _TargetKind.table:
        onSelectRoom(null);
        onSelectTable(tables.firstWhere((t) => t.id == choice.id));
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(AppTheme.rMedium),
      onTap: () => _open(context),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.s12,
          vertical: AppTheme.s12,
        ),
        decoration: BoxDecoration(
          color: AppTheme.bg,
          borderRadius: BorderRadius.circular(AppTheme.rMedium),
          border: Border.all(color: AppTheme.border),
        ),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                gradient: _isCounter
                    ? null
                    : const LinearGradient(
                        colors: [AppTheme.accent, Color(0xFF434FC1)],
                      ),
                color: _isCounter ? AppTheme.card : null,
                border: _isCounter ? Border.all(color: AppTheme.border) : null,
                borderRadius: BorderRadius.circular(AppTheme.rSmall),
              ),
              child: Icon(
                _icon,
                color: _isCounter ? AppTheme.muted : Colors.white,
                size: 17,
              ),
            ),
            const SizedBox(width: AppTheme.s12),
            Expanded(
              child: Text(
                _label,
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const Icon(
              Icons.unfold_more_rounded,
              color: AppTheme.muted,
              size: 20,
            ),
          ],
        ),
      ),
    );
  }
}

// ── Who's checked into the selected room ────────────────────────────────────

/// Mirrors the web's occupancy panel below the target picker: a muted line
/// while the lookup is in flight, the guest's name and phone once it lands,
/// or a loud warning when the room turns out to be empty.
class _OccupancyCard extends StatelessWidget {
  final bool loading;
  final bool failed;
  final RoomOccupancy? occupancy;

  const _OccupancyCard({
    required this.loading,
    required this.failed,
    required this.occupancy,
  });

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Text(
        "Checking who's in this room…",
        style: TextStyle(color: AppTheme.muted, fontSize: 13),
      );
    }

    if (failed) {
      return const Text(
        "Couldn't check the register just now — confirm the guest at the desk.",
        style: TextStyle(color: AppTheme.muted, fontSize: 13),
      );
    }

    final occ = occupancy;
    if (occ == null) return const SizedBox.shrink();

    if (!occ.occupied) {
      return Container(
        padding: const EdgeInsets.all(AppTheme.s12),
        decoration: BoxDecoration(
          color: AppTheme.danger.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          border: Border.all(color: AppTheme.danger.withValues(alpha: 0.3)),
        ),
        child: const Text(
          'Nobody is checked in to this room. Select a different room, or '
          'the counter, to place this order.',
          style: TextStyle(color: AppTheme.danger, fontSize: 13),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'CHECKED IN TO THIS ROOM',
            style: TextStyle(
              color: AppTheme.muted,
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.4,
            ),
          ),
          const SizedBox(height: AppTheme.s4),
          Text(
            occ.guestName?.isNotEmpty == true
                ? occ.guestName!
                : 'Name not on the booking',
            style: const TextStyle(
              color: AppTheme.heading,
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
          if (occ.guestPhone?.isNotEmpty == true) ...[
            const SizedBox(height: AppTheme.s4),
            Text(
              occ.guestPhone!,
              style: const TextStyle(color: AppTheme.text, fontSize: 13),
            ),
          ],
          const SizedBox(height: AppTheme.s4),
          const Text(
            'Check this matches the guest ordering before you charge it to '
            'the room.',
            style: TextStyle(color: AppTheme.muted, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

// ── The pinned tab header above the dish list ───────────────────────────────

/// Pins the section strip and the All/Veg/Non-veg strip to the top of the
/// menu step's scroll view — a real sliver header that stays on screen
/// while the dish list scrolls under it, the same way a food-delivery
/// app's own category bar stays put, rather than a row that merely sits
/// near the top of a plain list. [sectionRowHeight] and [dietRowHeight] are
/// also what [CounterOrderScreen._thresholdY] adds to the scroll
/// viewport's own top to know exactly where this header's bottom edge
/// lands, without having to measure this header's own RenderBox.
class _StickyMenuTabsDelegate extends SliverPersistentHeaderDelegate {
  final List<MenuSection> sections;
  final int? selectedSectionId;
  final ValueChanged<MenuSection> onSelectSection;
  final String selectedDiet;
  final ValueChanged<String> onSelectDiet;
  final bool showSectionTabs;
  final bool showDietTabs;

  _StickyMenuTabsDelegate({
    required this.sections,
    required this.selectedSectionId,
    required this.onSelectSection,
    required this.selectedDiet,
    required this.onSelectDiet,
    required this.showSectionTabs,
    required this.showDietTabs,
  });

  static const double sectionRowHeight = 44;
  static const double dietRowHeight = 46;

  double get _height =>
      (showSectionTabs ? sectionRowHeight : 0) +
      (showDietTabs ? dietRowHeight : 0);

  @override
  double get minExtent => _height;
  @override
  double get maxExtent => _height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        boxShadow: overlapsContent
            ? [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.06),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ]
            : null,
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (showSectionTabs)
            SizedBox(
              height: sectionRowHeight,
              child: Center(
                child: _SectionTabs(
                  sections: sections,
                  selectedId: selectedSectionId,
                  onSelect: onSelectSection,
                ),
              ),
            ),
          if (showDietTabs)
            SizedBox(
              height: dietRowHeight,
              child: Center(
                child: _DietTabs(selected: selectedDiet, onSelect: onSelectDiet),
              ),
            ),
        ],
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _StickyMenuTabsDelegate oldDelegate) => true;
}

// ── All / Veg / Non-veg scroll-synced tabs ──────────────────────────────────

/// The row above the dish list that doubles as a scroll position indicator:
/// tapping a tab scrolls to its first group ([CounterOrderScreen._selectDietTab]
/// uses the Veg/Non-veg anchor keys for that), and scrolling the list past a
/// group's heading swaps the highlighted tab to match ([CounterOrderScreen._onScroll]).
/// Same content-sized, gradient-filled pill-chip look the section strip
/// above it uses, so the two tab rows read as one system rather than two
/// different controls.
class _DietTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _DietTabs({required this.selected, required this.onSelect});

  static const _tabs = [
    ('ALL', 'All', null),
    ('VEG', 'Veg', Color(0xFF2E7D32)),
    ('NON_VEG', 'Non-veg', Color(0xFFC62828)),
  ];

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 32,
      child: Row(
        children: [
          for (var i = 0; i < _tabs.length; i++) ...[
            if (i > 0) const SizedBox(width: AppTheme.s8),
            _DietTab(
              label: _tabs[i].$2,
              dot: _tabs[i].$3,
              selected: selected == _tabs[i].$1,
              onTap: () => onSelect(_tabs[i].$1),
            ),
          ],
        ],
      ),
    );
  }
}

class _DietTab extends StatelessWidget {
  final String label;
  final Color? dot;
  final bool selected;
  final VoidCallback onTap;

  const _DietTab({
    required this.label,
    required this.dot,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(999),
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          gradient: selected
              ? const LinearGradient(
                  colors: [AppTheme.accent, Color(0xFF434FC1)],
                )
              : null,
          color: selected ? null : AppTheme.card,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: selected ? Colors.transparent : AppTheme.border,
          ),
          boxShadow: selected
              ? const [
                  BoxShadow(
                    color: Color(0x335A67D8),
                    offset: Offset(0, 3),
                    blurRadius: 8,
                  ),
                ]
              : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (dot != null) ...[
              Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(
                  color: selected ? Colors.white : dot,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 6),
            ],
            Text(
              label,
              style: TextStyle(
                color: selected ? Colors.white : AppTheme.text,
                fontWeight: FontWeight.w700,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A Veg/Non-veg group heading inside the dish list — same pill look
/// MenuPanel's own food-type band uses. The first one of each kind in the
/// list carries the [key] the diet tabs scroll against; every later one
/// (a second section's own Veg group, say) gets none, so [Scrollable.ensureVisible]
/// and the scroll listener both only ever look at the first.
class _DietGroupLabel extends StatelessWidget {
  final String label;
  final Color color;

  const _DietGroupLabel({super.key, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppTheme.s4),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 6),
            Text(
              label.toUpperCase(),
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.w700,
                fontSize: 11,
                letterSpacing: 0.4,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The section picker, as a one-row scrollable strip of pills — Snacks,
/// Starters, Desserts… — instead of the plain dropdown this replaces. Same
/// selected-pill-filled-with-accent look MenuPanel's own section strip
/// uses, so the two "pick a menu heading" controls in this app read as one
/// design rather than two.
class _SectionTabs extends StatelessWidget {
  final List<MenuSection> sections;
  final int? selectedId;
  final ValueChanged<MenuSection> onSelect;

  const _SectionTabs({
    required this.sections,
    required this.selectedId,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 32,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: sections.length,
        separatorBuilder: (_, _) => const SizedBox(width: AppTheme.s8),
        itemBuilder: (context, i) {
          final section = sections[i];
          final selected = section.id == selectedId;
          return InkWell(
            borderRadius: BorderRadius.circular(999),
            onTap: () => onSelect(section),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                gradient: selected
                    ? const LinearGradient(
                        colors: [AppTheme.accent, Color(0xFF434FC1)],
                      )
                    : null,
                color: selected ? null : AppTheme.card,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: selected ? Colors.transparent : AppTheme.border,
                ),
                boxShadow: selected
                    ? const [
                        BoxShadow(
                          color: Color(0x335A67D8),
                          offset: Offset(0, 3),
                          blurRadius: 8,
                        ),
                      ]
                    : null,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    section.name,
                    style: TextStyle(
                      color: selected ? Colors.white : AppTheme.text,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    '${section.items.length}',
                    style: TextStyle(
                      color: selected ? Colors.white70 : AppTheme.muted,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
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
        padding: const EdgeInsets.only(bottom: AppTheme.s8),
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
      padding: const EdgeInsets.only(bottom: AppTheme.s8),
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
  final bool editing;
  final String cancelLabel;
  final VoidCallback? onCancel;
  final VoidCallback? onPlace;

  const _OrderBar({
    required this.lines,
    required this.total,
    required this.working,
    this.editing = false,
    this.cancelLabel = 'Cancel',
    required this.onCancel,
    required this.onPlace,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppTheme.s12,
        AppTheme.s4,
        AppTheme.s12,
        AppTheme.s4,
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
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(fontSize: 11),
              ),
              const Spacer(),
              Text(
                formatPrice(total),
                style: const TextStyle(
                  color: AppTheme.accent,
                  fontWeight: FontWeight.w800,
                  fontSize: 15,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s4),
          Row(
            children: [
              Expanded(
                child: NeuButton(
                  onPressed: onCancel,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text(cancelLabel, style: const TextStyle(fontSize: 13)),
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                flex: 2,
                child: NeuButton(
                  primary: true,
                  onPressed: onPlace,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: working
                      ? const SizedBox(
                          height: 14,
                          width: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : Text(
                          editing ? 'Save changes' : 'Place order',
                          style: const TextStyle(fontSize: 13),
                        ),
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
