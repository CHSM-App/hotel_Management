import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/housekeeping.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'finish_cleaning_screen.dart';
import 'housekeeping_parts.dart';
import 'out_of_order_sheet.dart';

/// The room cleaning board — mirrors HousekeepingPanel.jsx's RoomsTab: a
/// "Show" filter (to clean first), cards or a spreadsheet-style table, each
/// room with the one action it needs and a "⋯" menu for the rest.
class RoomsTab extends ConsumerStatefulWidget {
  const RoomsTab({super.key});

  @override
  ConsumerState<RoomsTab> createState() => _RoomsTabState();
}

class _RoomsTabState extends ConsumerState<RoomsTab> {
  String _filter = 'TODO';
  String _view = 'table';
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(housekeepingViewModelProvider.notifier).loadRooms());
    // Kept fresh without a refresh button: a checkout at the desk shows up
    // here, same as RoomsTab in HousekeepingPanel.jsx.
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => ref.read(housekeepingViewModelProvider.notifier).loadRooms());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  bool _inFilter(HousekeepingRoom r, String key) => switch (key) {
    'ALL' => true,
    'TODO' => r.status == 'DIRTY' || r.status == 'CLEANING',
    _ => r.status == key,
  };

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(housekeepingViewModelProvider);
    final rooms = state.rooms;
    final shown = rooms.where((r) => _inFilter(r, _filter)).toList();
    final now = DateTime.now();

    final filters = [
      FilterOption('TODO', 'To clean', rooms.where((r) => _inFilter(r, 'TODO')).length),
      FilterOption('READY', 'Ready', rooms.where((r) => r.status == 'READY').length),
      FilterOption('OCCUPIED', 'Occupied', rooms.where((r) => r.status == 'OCCUPIED').length),
      FilterOption('OUT_OF_ORDER', 'Under repair', rooms.where((r) => r.status == 'OUT_OF_ORDER').length),
      FilterOption('ALL', 'All', rooms.length),
    ];

    if (state.roomsLoading && rooms.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(housekeepingViewModelProvider.notifier).loadRooms(),
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          if (state.error != null) ...[
            HkErrorBanner(state.error!),
            const SizedBox(height: AppTheme.s12),
          ],
          Row(
            children: [
              FilterDropdownButton(options: filters, selected: _filter, onSelect: (v) => setState(() => _filter = v)),
              const Spacer(),
              HkViewToggle(view: _view, onSelect: (v) => setState(() => _view = v)),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          if (rooms.isNotEmpty && shown.isEmpty)
            NeuNotice(
              icon: Icons.cleaning_services_outlined,
              message: _filter == 'TODO'
                  ? 'Every room is clean. New check-outs appear here on their own.'
                  : _filter == 'ALL'
                      ? 'Add rooms under Rooms & rates to see them here.'
                      : 'No rooms in this view. Choose another option above to see the rest.',
            )
          else if (_view == 'table')
            _RoomsTable(
              rooms: shown,
              now: now,
              onFinish: (r) => showFinishCleaningScreen(context, r),
              onStart: (r) => ref.read(housekeepingViewModelProvider.notifier).startCleaning(r.id),
              onBackInService: (r) => ref.read(housekeepingViewModelProvider.notifier).setOutOfOrder(r.id, {'outOfOrder': false}),
              onRelease: (r) => ref.read(housekeepingViewModelProvider.notifier).releaseRoom(r.id),
              onMarkDirty: (r) => ref.read(housekeepingViewModelProvider.notifier).markDirty(r.id),
              onCloseForRepair: (r) => showOutOfOrderDialog(context, r),
            )
          else
            for (final r in shown)
              _RoomCard(
                room: r,
                now: now,
                busy: state.submitting,
                onStart: () => ref.read(housekeepingViewModelProvider.notifier).startCleaning(r.id),
                onFinish: () => showFinishCleaningScreen(context, r),
                onRelease: () => ref.read(housekeepingViewModelProvider.notifier).releaseRoom(r.id),
                onBackInService: () => ref.read(housekeepingViewModelProvider.notifier).setOutOfOrder(r.id, {'outOfOrder': false}),
                onMarkDirty: () => ref.read(housekeepingViewModelProvider.notifier).markDirty(r.id),
                onCloseForRepair: () => showOutOfOrderDialog(context, r),
              ),
        ],
      ),
    );
  }
}

/// "Waiting 2 h", "In progress · Asha" — the one quiet detail line a room's
/// status carries, shared by the card and table views.
String _detailOf(HousekeepingRoom room, DateTime now) => switch (room.status) {
  'DIRTY' => room.dirtySince != null ? 'Waiting ${ago(room.dirtySince, now)}' : 'Marked for cleaning',
  'CLEANING' => '${room.cleaningStartedAt != null ? ago(room.cleaningStartedAt, now) : 'In progress'}${room.cleaningBy != null ? ' · ${room.cleaningBy}' : ''}',
  'OUT_OF_ORDER' => room.outOfOrderNote ?? '',
  _ => '',
};

List<(String, VoidCallback)> _menuOf(
  HousekeepingRoom room, {
  required VoidCallback onRelease,
  required VoidCallback onMarkDirty,
  required VoidCallback onCloseForRepair,
}) => [
  if (room.status == 'CLEANING') ('Stop without finishing', onRelease),
  if (room.status == 'READY') ('Needs cleaning', onMarkDirty),
  if (room.status == 'DIRTY' || room.status == 'READY') ('Close for repair', onCloseForRepair),
];

/// A professional, elevated card: a tone-tinted left stripe, the room number
/// in a status-colored badge, category/floor/flags as small tags, and the
/// one action the room needs on the right.
class _RoomCard extends StatelessWidget {
  final HousekeepingRoom room;
  final DateTime now;
  final bool busy;
  final VoidCallback onStart;
  final VoidCallback onFinish;
  final VoidCallback onRelease;
  final VoidCallback onBackInService;
  final VoidCallback onMarkDirty;
  final VoidCallback onCloseForRepair;

  const _RoomCard({
    required this.room,
    required this.now,
    required this.busy,
    required this.onStart,
    required this.onFinish,
    required this.onRelease,
    required this.onBackInService,
    required this.onMarkDirty,
    required this.onCloseForRepair,
  });

  @override
  Widget build(BuildContext context) {
    final tone = kRoomStatusTone[room.status] ?? AppTheme.muted;
    final guest = room.guestLabel;
    final leaves = room.guestName != null && room.guestCheckOut != null
        ? (room.leavingToday ? 'Leaves today' : 'Leaves ${dayLabel(room.guestCheckOut!)}')
        : '';
    final cleaned = room.cleanedAt != null ? '${ago(room.cleanedAt, now)} ago${room.cleanedBy != null ? ' · ${room.cleanedBy}' : ''}' : '';
    final issuesLabel = room.openIssues > 0 ? '${room.openIssues} open ${room.openIssues == 1 ? 'issue' : 'issues'}' : '';
    final detail = _detailOf(room, now);
    final extra = guest.isNotEmpty
        ? [guest, room.leavingToday ? '' : leaves].where((s) => s.isNotEmpty).join(' · ')
        : (room.status == 'READY' && cleaned.isNotEmpty ? 'Cleaned $cleaned' : '');
    final menu = _menuOf(room, onRelease: onRelease, onMarkDirty: onMarkDirty, onCloseForRepair: onCloseForRepair);

    final actionLabel = switch (room.status) {
      'DIRTY' => 'Start cleaning',
      'CLEANING' => 'Finish',
      'OUT_OF_ORDER' => 'Back in service',
      _ => null,
    };
    final actionTap = switch (room.status) {
      'DIRTY' => busy ? null : onStart,
      'CLEANING' => busy ? null : onFinish,
      'OUT_OF_ORDER' => busy ? null : onBackInService,
      _ => null,
    };

    return Container(
      margin: const EdgeInsets.only(bottom: AppTheme.s8),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.extruded,
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(AppTheme.s8, AppTheme.s8, AppTheme.s8, AppTheme.s8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 36,
                  height: 36,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: tone.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
                  child: Text(room.roomNumber, style: TextStyle(color: tone, fontWeight: FontWeight.w800, fontSize: 12.5)),
                ),
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              [room.categoryName, floorLabel(room.floor)].where((s) => s.isNotEmpty).join(' · '),
                              style: const TextStyle(color: AppTheme.text, fontSize: 12.5, fontWeight: FontWeight.w600),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          StatusPill(label: kRoomStatusLabel[room.status] ?? room.status, color: tone),
                        ],
                      ),
                      if (room.arrivingToday && room.status != 'OCCUPIED' || (guest.isNotEmpty && room.leavingToday) || issuesLabel.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Wrap(
                          spacing: 5,
                          runSpacing: 4,
                          children: [
                            if (room.arrivingToday && room.status != 'OCCUPIED') const StatusPill(label: 'Guest arriving today', color: AppTheme.checkedIn),
                            if (guest.isNotEmpty && room.leavingToday) const StatusPill(label: 'Leaves today', color: AppTheme.checkout),
                            if (issuesLabel.isNotEmpty) StatusPill(label: issuesLabel, color: AppTheme.danger),
                          ],
                        ),
                      ],
                      if (detail.isNotEmpty || extra.isNotEmpty) ...[
                        const SizedBox(height: 3),
                        Text(
                          [detail, extra].where((s) => s.isNotEmpty).join(' · '),
                          style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (actionLabel != null || menu.isNotEmpty) ...[
            const Divider(height: 1, color: AppTheme.border),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: AppTheme.s4),
              child: Row(
                children: [
                  if (actionLabel != null)
                    Expanded(
                      child: CompactActionButton(
                        label: actionLabel,
                        color: room.status == 'CLEANING' ? AppTheme.accent : tone,
                        primary: room.status == 'CLEANING',
                        expand: true,
                        onTap: actionTap,
                      ),
                    )
                  else
                    const Spacer(),
                  if (menu.isNotEmpty)
                    PopupMenuButton<int>(
                      padding: EdgeInsets.zero,
                      icon: const Icon(Icons.more_vert_rounded, size: 18, color: AppTheme.muted),
                      onSelected: (i) => menu[i].$2(),
                      elevation: 10,
                      color: AppTheme.card,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rMedium), side: const BorderSide(color: AppTheme.border)),
                      itemBuilder: (context) => [
                        for (var i = 0; i < menu.length; i++) PopupMenuItem(value: i, child: Text(menu[i].$1, style: const TextStyle(fontSize: 13))),
                      ],
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The spreadsheet-style view — every shown room's room/type/status/guest/
/// last-cleaned/notes in one scrollable grid, mirroring ROOM_COLUMNS in
/// HousekeepingPanel.jsx and _ExpenseTable in expenses_list_panel.dart.
class _RoomsTable extends StatelessWidget {
  final List<HousekeepingRoom> rooms;
  final DateTime now;
  final ValueChanged<HousekeepingRoom> onStart;
  final ValueChanged<HousekeepingRoom> onFinish;
  final ValueChanged<HousekeepingRoom> onBackInService;
  final ValueChanged<HousekeepingRoom> onRelease;
  final ValueChanged<HousekeepingRoom> onMarkDirty;
  final ValueChanged<HousekeepingRoom> onCloseForRepair;

  const _RoomsTable({
    required this.rooms,
    required this.now,
    required this.onStart,
    required this.onFinish,
    required this.onBackInService,
    required this.onRelease,
    required this.onMarkDirty,
    required this.onCloseForRepair,
  });

  static const _columns = [
    (label: 'Room', width: 70.0),
    (label: 'Type', width: 120.0),
    (label: 'Status', width: 140.0),
    (label: 'Guest', width: 150.0),
    (label: 'Last cleaned', width: 120.0),
    (label: 'Notes', width: 160.0),
  ];

  static const _actionsWidth = 200.0;

  @override
  Widget build(BuildContext context) {
    final width = _columns.fold<double>(0, (sum, c) => sum + c.width) + _actionsWidth;

    return NeuCard(
      padding: EdgeInsets.zero,
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: width,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  decoration: const BoxDecoration(
                    color: AppTheme.sidebarBrandWash,
                    border: Border(bottom: BorderSide(color: AppTheme.sidebarBrandWashEdge, width: 0.8)),
                  ),
                  child: Row(
                    children: [
                      for (final c in _columns) SizedBox(width: c.width, child: HkTableHeaderCell(c.label)),
                      const SizedBox(width: _actionsWidth, child: HkTableHeaderCell('Action')),
                    ],
                  ),
                ),
                for (var i = 0; i < rooms.length; i++)
                  _RoomTableRow(
                    room: rooms[i],
                    now: now,
                    shaded: i.isOdd,
                    onStart: () => onStart(rooms[i]),
                    onFinish: () => onFinish(rooms[i]),
                    onBackInService: () => onBackInService(rooms[i]),
                    menu: _menuOf(rooms[i], onRelease: () => onRelease(rooms[i]), onMarkDirty: () => onMarkDirty(rooms[i]), onCloseForRepair: () => onCloseForRepair(rooms[i])),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RoomTableRow extends StatelessWidget {
  final HousekeepingRoom room;
  final DateTime now;
  final bool shaded;
  final VoidCallback onStart;
  final VoidCallback onFinish;
  final VoidCallback onBackInService;
  final List<(String, VoidCallback)> menu;

  const _RoomTableRow({
    required this.room,
    required this.now,
    required this.shaded,
    required this.onStart,
    required this.onFinish,
    required this.onBackInService,
    required this.menu,
  });

  @override
  Widget build(BuildContext context) {
    final tone = kRoomStatusTone[room.status] ?? AppTheme.muted;
    final guest = room.guestLabel;
    final cleaned = room.cleanedAt != null ? '${ago(room.cleanedAt, now)} ago' : '—';
    final detail = _detailOf(room, now);
    final notes = [detail, room.openIssues > 0 ? '${room.openIssues} open ${room.openIssues == 1 ? 'issue' : 'issues'}' : ''].where((s) => s.isNotEmpty).join(' · ');

    Widget cell(double width, Widget child) => SizedBox(width: width, child: Padding(padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10), child: child));
    Widget text(String s, {Color color = AppTheme.text, FontWeight weight = FontWeight.w400}) =>
        Text(s.isEmpty ? '—' : s, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: s.isEmpty ? AppTheme.muted : color, fontSize: 12.5, fontWeight: weight));

    return Container(
      decoration: BoxDecoration(
        color: shaded ? AppTheme.border.withValues(alpha: 0.25) : AppTheme.card,
        border: const Border(bottom: BorderSide(color: AppTheme.border, width: 0.8)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          cell(70, text(room.roomNumber, color: AppTheme.heading, weight: FontWeight.w700)),
          cell(120, text([room.categoryName, floorLabel(room.floor)].where((s) => s.isNotEmpty).join(', '))),
          cell(140, Align(alignment: Alignment.centerLeft, child: StatusPill(label: kRoomStatusLabel[room.status] ?? room.status, color: tone))),
          cell(150, text(guest)),
          cell(120, text(room.status == 'READY' ? cleaned : '—')),
          cell(160, text(notes)),
          SizedBox(
            width: _RoomsTable._actionsWidth,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 6),
              // Scales the row down rather than overflowing if a long label
              // ("Back in service") plus the ⋯ menu can't both fit at full size.
              child: FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerRight,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (room.status == 'DIRTY')
                      CompactActionButton(label: 'Start cleaning', color: tone, onTap: onStart)
                    else if (room.status == 'CLEANING')
                      CompactActionButton(label: 'Finish', color: AppTheme.accent, primary: true, onTap: onFinish)
                    else if (room.status == 'OUT_OF_ORDER')
                      CompactActionButton(label: 'Back in service', color: tone, onTap: onBackInService),
                    if (menu.isNotEmpty)
                      PopupMenuButton<int>(
                        padding: EdgeInsets.zero,
                        icon: const Icon(Icons.more_vert_rounded, size: 18, color: AppTheme.muted),
                        onSelected: (i) => menu[i].$2(),
                        elevation: 10,
                        color: AppTheme.card,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rMedium), side: const BorderSide(color: AppTheme.border)),
                        itemBuilder: (context) => [
                          for (var i = 0; i < menu.length; i++) PopupMenuItem(value: i, child: Text(menu[i].$1, style: const TextStyle(fontSize: 13))),
                        ],
                      ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

