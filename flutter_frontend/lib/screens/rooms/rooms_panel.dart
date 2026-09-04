import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/constant.dart';
import '../../domain/models/room.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'room_form_sheet.dart';

/// The room grid — same cards the web "Rooms" tab shows, minus the photo
/// lightbox (a phone opens one photo full-screen just by tapping it).
class RoomsPanel extends ConsumerWidget {
  const RoomsPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(roomsViewModelProvider);
    final rooms = state.rooms;
    final noCategories = state.categories.isEmpty;

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
              Text(
                '${rooms.length} room${rooms.length == 1 ? '' : 's'}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: AppTheme.s12),
              if (rooms.isEmpty)
                const NeuNotice(
                  icon: Icons.bed_rounded,
                  message: 'No rooms yet. Add your first room to start\n'
                      'filling the chart.',
                )
              else
                for (final room in rooms)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppTheme.s12),
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
                : () => showRoomFormSheet(context, categories: state.categories),
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

  String? get _coverUrl =>
      room.images.isEmpty ? null : '$baseUrl/room-images/${room.images.first.filename}';

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
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_coverUrl != null)
              ClipRRect(
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(AppTheme.rMedium),
                ),
                child: Image.network(
                  _coverUrl!,
                  height: 140,
                  width: double.infinity,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(AppTheme.s16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Room ${room.roomNumber}',
                          style: Theme.of(context).textTheme.titleMedium,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(
                        formatPrice(room.price),
                        style: const TextStyle(
                          color: AppTheme.heading,
                          fontWeight: FontWeight.w500,
                          fontSize: 15,
                        ),
                      ),
                      const Text(
                        ' /night',
                        style: TextStyle(color: AppTheme.muted, fontSize: 11),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppTheme.s4),
                  Text(
                    room.category.name,
                    style: const TextStyle(color: AppTheme.text, fontSize: 13),
                  ),
                  const SizedBox(height: AppTheme.s8),
                  Wrap(
                    spacing: AppTheme.s8,
                    runSpacing: AppTheme.s4,
                    children: [
                      if (room.floor != null && room.floor!.isNotEmpty)
                        _Chip('Floor ${room.floor}'),
                      if (_bedSummary != null) _Chip(_bedSummary!),
                      if (_bathroomLabel != null) _Chip(_bathroomLabel!),
                      if (room.maxOccupancy != null)
                        _Chip('Max ${room.maxOccupancy} guests'),
                    ],
                  ),
                  const SizedBox(height: AppTheme.s12),
                  Row(
                    children: [
                      GestureDetector(
                        onTap: () => _toggleStatus(context, ref),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: (room.isActive ? AppTheme.vacant : AppTheme.muted)
                                .withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            room.isActive ? 'Active' : 'Inactive',
                            style: TextStyle(
                              color: room.isActive ? AppTheme.vacant : AppTheme.muted,
                              fontSize: 11,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ),
                      const Spacer(),
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        icon: const Icon(Icons.delete_outline_rounded, size: 20),
                        color: AppTheme.danger,
                        onPressed: () => _confirmDelete(context, ref),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _toggleStatus(BuildContext context, WidgetRef ref) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: Text(
          '${room.isActive ? 'Deactivate' : 'Activate'} room ${room.roomNumber}?',
          style: const TextStyle(color: AppTheme.heading),
        ),
        content: Text(
          room.isActive
              ? 'It will be hidden from new bookings, but its history stays intact.'
              : 'It will be available for new bookings again.',
          style: const TextStyle(color: AppTheme.text, fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(room.isActive ? 'Deactivate' : 'Activate'),
          ),
        ],
      ),
    );
    if (sure != true) return;
    final ok = await ref
        .read(roomsViewModelProvider.notifier)
        .setRoomActive(room.id, !room.isActive);
    if (!context.mounted || ok) return;
    _say(context, ref.read(roomsViewModelProvider).error ?? 'Could not update this room.');
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

class _Chip extends StatelessWidget {
  final String label;

  const _Chip(this.label);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppTheme.shadowDark),
      ),
      child: Text(
        label,
        style: const TextStyle(color: AppTheme.text, fontSize: 11),
      ),
    );
  }
}
