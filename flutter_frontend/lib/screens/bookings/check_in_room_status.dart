import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/housekeeping.dart';
import '../../presentation/providers/usecase_provider.dart';
import '../housekeeping/housekeeping_parts.dart';
import '../theme.dart';

/// One room (or venue) this panel reports on — just enough to look it up on
/// the housekeeping board and, failing that, still show a label.
class CheckInRoomStatusEntry {
  final int roomId;
  final String? roomNumber;
  const CheckInRoomStatusEntry({required this.roomId, this.roomNumber});
}

/// The housekeeping status of the rooms about to be checked in, at the top
/// of the check-in/take-booking form — mirrors CheckInRoomStatus.jsx. It
/// informs and never blocks: the desk may know something the board does
/// not. Shows nothing for a property without Housekeeping, where the
/// request is simply refused, or where none of [rooms] has anything to say.
///
/// [venues] turns it to event venues instead, for the function booking
/// form: the same list (ids under roomId), read from the venue half of the
/// board.
class CheckInRoomStatus extends ConsumerStatefulWidget {
  final List<CheckInRoomStatusEntry> rooms;
  final bool venues;

  const CheckInRoomStatus({super.key, required this.rooms, this.venues = false});

  @override
  ConsumerState<CheckInRoomStatus> createState() => _CheckInRoomStatusState();
}

class _CheckInRoomStatusState extends ConsumerState<CheckInRoomStatus> {
  Map<int, HousekeepingRoom>? _byId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant CheckInRoomStatus oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.venues != widget.venues) _load();
  }

  Future<void> _load() async {
    try {
      final usecase = ref.read(housekeepingUsecaseProvider);
      final rooms = widget.venues ? await usecase.venues() : await usecase.rooms();
      if (!mounted) return;
      setState(() => _byId = {for (final r in rooms) r.id: r});
    } catch (_) {
      // Silent, same as the web: a property without Housekeeping simply
      // shows nothing extra here.
    }
  }

  @override
  Widget build(BuildContext context) {
    final byId = _byId;
    if (byId == null) return const SizedBox.shrink();
    final rows = widget.rooms.map((r) => (r, byId[r.roomId])).where((e) => e.$2 != null).toList();
    if (rows.isEmpty) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.only(top: AppTheme.s8),
      padding: const EdgeInsets.all(AppTheme.s8),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            widget.venues ? 'Venue status' : 'Room status',
            style: const TextStyle(color: AppTheme.muted, fontSize: 10.5, fontWeight: FontWeight.w700, letterSpacing: 0.3),
          ),
          const SizedBox(height: 6),
          for (final (entry, hk) in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    child: Text(
                      widget.venues ? hk!.roomNumber : 'Room ${entry.roomNumber ?? hk!.roomNumber}',
                      style: const TextStyle(color: AppTheme.heading, fontSize: 12.5, fontWeight: FontWeight.w600),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 6),
                  // A venue with a function in it is "In use"; "Occupied" is a
                  // room's word — mirrors the web's own relabel.
                  StatusPill(
                    label: widget.venues && hk!.status == 'OCCUPIED' ? 'In use now' : (kRoomStatusLabel[hk!.status] ?? hk.status),
                    color: kRoomStatusTone[hk.status] ?? AppTheme.muted,
                  ),
                  if (hk.status == 'OUT_OF_ORDER' && (hk.outOfOrderNote ?? '').isNotEmpty) ...[
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        hk.outOfOrderNote!,
                        style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}
