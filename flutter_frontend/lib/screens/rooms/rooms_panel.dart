import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/constant.dart';
import '../../domain/models/room.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'add_room_page.dart';
import 'room_form_sheet.dart';

/// The room grid — same cards the web "Rooms" tab shows, minus the photo
/// lightbox (a phone opens one photo full-screen just by tapping it).
///
/// Search is held here rather than in the view model — it never leaves the
/// screen and never touches the server, so state that only this widget's own
/// build reads has no business surviving a rebuild of something else.
class RoomsPanel extends ConsumerStatefulWidget {
  const RoomsPanel({super.key});

  @override
  ConsumerState<RoomsPanel> createState() => _RoomsPanelState();
}

class _RoomsPanelState extends ConsumerState<RoomsPanel> {
  final _search = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  List<RoomListing> _filtered(List<RoomListing> rooms) {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return rooms;
    return rooms.where((r) {
      final hay = '${r.roomNumber} ${r.category.name} ${r.floor ?? ''}'.toLowerCase();
      return hay.contains(q);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(roomsViewModelProvider);
    final allRooms = state.rooms;
    final rooms = _filtered(allRooms);
    final noCategories = state.categories.isEmpty;
    final searching = _query.isNotEmpty;

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(roomsViewModelProvider.notifier).loadAll(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              AppTheme.s16,
              AppTheme.s4,
              AppTheme.s16,
              96,
            ),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              if (noCategories)
                const Padding(
                  padding: EdgeInsets.only(bottom: AppTheme.s12),
                  child: Text(
                    'Set up the price chart before adding rooms.',
                    style: TextStyle(color: AppTheme.muted, fontSize: 12),
                  ),
                ),
              NeuPressed(
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                child: Row(
                  children: [
                    const Icon(Icons.search_rounded, size: 18, color: AppTheme.muted),
                    const SizedBox(width: AppTheme.s8),
                    Expanded(
                      child: TextField(
                        controller: _search,
                        onChanged: (v) => setState(() => _query = v),
                        style: const TextStyle(color: AppTheme.heading, fontSize: 14),
                        decoration: const InputDecoration(
                          hintText: 'Search room, category, floor',
                          hintStyle: TextStyle(color: AppTheme.muted, fontSize: 14),
                          border: InputBorder.none,
                          isDense: true,
                          contentPadding: EdgeInsets.symmetric(vertical: 12),
                        ),
                      ),
                    ),
                    if (_query.isNotEmpty)
                      GestureDetector(
                        onTap: () => setState(() {
                          _search.clear();
                          _query = '';
                        }),
                        child: const Icon(Icons.close_rounded, size: 18, color: AppTheme.muted),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: AppTheme.s12),
              Text(
                searching
                    ? '${rooms.length} of ${allRooms.length} room${allRooms.length == 1 ? '' : 's'}'
                    : '${allRooms.length} room${allRooms.length == 1 ? '' : 's'}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: AppTheme.s12),
              if (allRooms.isEmpty)
                const NeuNotice(
                  icon: Icons.bed_rounded,
                  message: 'No rooms yet. Add your first room to start\n'
                      'filling the chart.',
                )
              else if (rooms.isEmpty)
                const NeuNotice(
                  icon: Icons.search_off_rounded,
                  message: 'Nothing matches that search.',
                )
              else
                for (final room in rooms)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppTheme.s16),
                    child: _RoomCard(room: room),
                  ),
            ],
          ),
        ),
        Positioned(
          right: AppTheme.s16,
          bottom: AppTheme.s16,
          child: FloatingActionButton(
            backgroundColor: AppTheme.accent,
            foregroundColor: Colors.white,
            onPressed: noCategories
                ? null
                : () => showAddRoomPage(context, categories: state.categories),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

class _RoomCard extends ConsumerWidget {
  final RoomListing room;

  const _RoomCard({required this.room});

  String? get _bedSummary {
    if (room.beds.isEmpty) return null;
    const labels = {
      'SINGLE': 'Single',
      'DOUBLE': 'Double',
      'QUEEN': 'Queen',
      'KING': 'King',
    };
    return room.beds.map((b) => '${b.count} ${labels[b.size] ?? b.size}').join(' + ');
  }

  String? get _bathroomLabel => switch (room.bathroomType) {
    'ATTACHED' => 'Attached bathroom',
    'COMMON' => 'Common bathroom',
    _ => null,
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return GestureDetector(
      onTap: () => showRoomFormSheet(
        context,
        categories: ref.read(roomsViewModelProvider).categories,
        room: room,
      ),
      child: NeuCard(
        padding: EdgeInsets.zero,
        radius: AppTheme.rMedium,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _CoverImage(
              room: room,
              size: 64,
              onToggleActive: () => _confirmToggleActive(context, ref),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppTheme.s12,
                  AppTheme.s8,
                  AppTheme.s8,
                  AppTheme.s8,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                'Room ${room.roomNumber}',
                                style: const TextStyle(
                                  color: AppTheme.heading,
                                  fontWeight: FontWeight.w700,
                                  fontSize: 14,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                              Text(
                                room.category.name,
                                style: const TextStyle(
                                  color: AppTheme.accent,
                                  fontWeight: FontWeight.w500,
                                  fontSize: 11.5,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              formatPrice(room.price),
                              style: const TextStyle(
                                color: AppTheme.heading,
                                fontWeight: FontWeight.w700,
                                fontSize: 14,
                              ),
                            ),
                            const Text(
                              'per night',
                              style: TextStyle(color: AppTheme.muted, fontSize: 9.5),
                            ),
                          ],
                        ),
                        NeuRowMenu(
                          onEdit: () => showRoomFormSheet(
                            context,
                            categories: ref.read(roomsViewModelProvider).categories,
                            room: room,
                          ),
                          onDelete: () => _confirmDelete(context, ref),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        if (room.floor != null && room.floor!.isNotEmpty)
                          _Chip(Icons.layers_outlined, 'Floor ${room.floor}'),
                        if (_bedSummary != null) _Chip(Icons.bed_outlined, _bedSummary!),
                        if (_bathroomLabel != null) _Chip(Icons.bathtub_outlined, _bathroomLabel!),
                        if (room.maxOccupancy != null)
                          _Chip(Icons.people_alt_outlined, 'Max ${room.maxOccupancy}'),
                      ],
                    ),
                    const SizedBox(height: 4),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Tapping the Active/Inactive badge on the photo — the same spot the web
  /// room card puts it — asks to flip just that one flag, separately from
  /// the fuller delete sheet which also offers a permanent delete.
  Future<void> _confirmToggleActive(BuildContext context, WidgetRef ref) async {
    final activating = !room.isActive;
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: Text(
          '${activating ? 'Activate' : 'Deactivate'} room ${room.roomNumber}?',
          style: const TextStyle(color: AppTheme.heading),
        ),
        content: Text(
          activating
              ? 'Make it available for new bookings again.'
              : 'Hide it from new bookings, but keep its history.',
          style: const TextStyle(color: AppTheme.text, fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(activating ? 'Activate' : 'Deactivate'),
          ),
        ],
      ),
    );
    if (sure != true || !context.mounted) return;

    final ok = await ref
        .read(roomsViewModelProvider.notifier)
        .setRoomActive(room.id, activating);
    if (!context.mounted) return;
    if (!ok) {
      _say(context, ref.read(roomsViewModelProvider).error ?? 'Could not update this room.');
    }
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppTheme.bg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.rLarge)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: AppTheme.s16),
            Text(
              'Delete room ${room.roomNumber}',
              style: const TextStyle(
                color: AppTheme.heading,
                fontWeight: FontWeight.w500,
                fontSize: 16,
              ),
            ),
            const SizedBox(height: AppTheme.s16),
            ListTile(
              title: Text(room.isActive ? 'Deactivate' : 'Activate'),
              subtitle: Text(
                room.isActive
                    ? 'Hide it from new bookings, but keep its history.'
                    : 'Make it available for new bookings again.',
              ),
              onTap: () => Navigator.pop(context, 'deactivate'),
            ),
            ListTile(
              title: const Text(
                'Permanently delete',
                style: TextStyle(color: AppTheme.danger),
              ),
              subtitle: const Text(
                "Remove it completely. This can't be undone, and only works "
                'if it has no bookings.',
              ),
              onTap: () => Navigator.pop(context, 'delete'),
            ),
            const SizedBox(height: AppTheme.s8),
          ],
        ),
      ),
    );
    if (choice == null || !context.mounted) return;

    final vm = ref.read(roomsViewModelProvider.notifier);
    final ok = choice == 'delete'
        ? await vm.deleteRoom(room.id)
        : await vm.setRoomActive(room.id, !room.isActive);
    if (!context.mounted) return;
    if (!ok) {
      _say(context, ref.read(roomsViewModelProvider).error ?? 'Could not update this room.');
    }
  }

  void _say(BuildContext context, String message) =>
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message), backgroundColor: AppTheme.heading),
      );
}

/// The room's photo as a small square thumbnail alongside the card's details
/// — compact rather than a full-width banner, with a count badge when there
/// is more than one photo. A room with no photo yet gets a placeholder
/// rather than collapsing to a bare text card.
class _CoverImage extends StatelessWidget {
  final RoomListing room;
  final double size;
  final VoidCallback onToggleActive;

  const _CoverImage({
    required this.room,
    required this.size,
    required this.onToggleActive,
  });

  @override
  Widget build(BuildContext context) {
    final hasPhoto = room.images.isNotEmpty;
    return ClipRRect(
      borderRadius: const BorderRadius.horizontal(left: Radius.circular(AppTheme.rMedium)),
      child: SizedBox(
        height: size,
        width: size,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (hasPhoto)
              Image.network(
                '$baseUrl/room-images/${room.images.first.filename}',
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => _CoverPlaceholder(roomNumber: room.roomNumber),
              )
            else
              _CoverPlaceholder(roomNumber: room.roomNumber),

            if (room.images.length > 1)
              Positioned(
                right: 3,
                bottom: 3,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.55),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '${room.images.length}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 9,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),

            // Tappable status badge over the photo — the same spot and the
            // same one-tap toggle the web room card's own "Active"/"Inactive"
            // badge offers, rather than a dot too small to read or hit.
            Positioned(
              left: 2,
              top: 2,
              child: GestureDetector(
                onTap: onToggleActive,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1.5),
                  decoration: BoxDecoration(
                    color: room.isActive ? AppTheme.vacant : AppTheme.muted,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    room.isActive ? 'Active' : 'Inactive',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 7.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CoverPlaceholder extends StatelessWidget {
  final String roomNumber;

  const _CoverPlaceholder({required this.roomNumber});

  @override
  Widget build(BuildContext context) {
    return Container(
      alignment: Alignment.center,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.accent.withValues(alpha: 0.14),
            AppTheme.accent.withValues(alpha: 0.05),
          ],
        ),
      ),
      child: Text(
        roomNumber,
        style: const TextStyle(
          color: AppTheme.accent,
          fontWeight: FontWeight.w700,
          fontSize: 15,
        ),
        overflow: TextOverflow.ellipsis,
        textAlign: TextAlign.center,
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final IconData icon;
  final String label;

  const _Chip(this.icon, this.label);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2.5),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10, color: AppTheme.muted),
          const SizedBox(width: 3),
          Text(label, style: const TextStyle(color: AppTheme.text, fontSize: 9.5)),
        ],
      ),
    );
  }
}

