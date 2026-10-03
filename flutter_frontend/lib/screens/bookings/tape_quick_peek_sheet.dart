import 'package:flutter/material.dart';

import '../../domain/models/tape_chart.dart';
import '../../widgets/format.dart';
import '../theme.dart';
import 'booking_actions.dart';

/// A long press's quick peek at a stay — the touch equivalent of the web
/// tape chart's own hover tooltip (see `Bookings.jsx`'s `hoverTile.booking`
/// branch), which on a multi-room booking turns "sticky" so the desk can
/// read every room before deciding which one to look at. Picking a room
/// here never opens anything or refetches the chart — same as the web's
/// `jumpToStay`, it only says which tile to flash and scroll to.
///
/// Returns the room-stay picked (one of [siblings] or [upcoming]), or null
/// if the desk just closed the sheet.
Future<TapeChartBooking?> showTapeQuickPeekSheet(
  BuildContext context, {
  required TapeChartBooking tapped,
  required List<TapeChartBooking> siblings,
  required List<TapeChartBooking> upcoming,
  required TapeChartRoom? Function(int roomId) roomOf,
}) {
  return showDialog<TapeChartBooking>(
    context: context,
    builder: (_) => Dialog(
      backgroundColor: AppTheme.bg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.rLarge),
      ),
      insetPadding: const EdgeInsets.symmetric(
        horizontal: AppTheme.s16,
        vertical: AppTheme.s24,
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420, maxHeight: 560),
        child: _QuickPeekSheet(
          tapped: tapped,
          siblings: siblings,
          upcoming: upcoming,
          roomOf: roomOf,
        ),
      ),
    ),
  );
}

int? _nightsOf(TapeChartBooking b) {
  final inD = DateTime.tryParse(b.checkInDate ?? '');
  final outD = DateTime.tryParse(b.checkOutDate ?? '');
  if (inD == null || outD == null) return null;
  return outD.difference(inD).inDays;
}

class _QuickPeekSheet extends StatelessWidget {
  final TapeChartBooking tapped;
  final List<TapeChartBooking> siblings;
  final List<TapeChartBooking> upcoming;
  final TapeChartRoom? Function(int roomId) roomOf;

  const _QuickPeekSheet({
    required this.tapped,
    required this.siblings,
    required this.upcoming,
    required this.roomOf,
  });

  @override
  Widget build(BuildContext context) {
    final isMultiRoom = siblings.length > 1;
    final statusColor = BookingActions.statusColor(tapped.status);
    final nights = _nightsOf(tapped);
    final room = roomOf(tapped.roomId);

    return Padding(
      padding: const EdgeInsets.all(AppTheme.s16),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
              Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: statusColor,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  Text(
                    BookingActions.statusLabel(tapped.status),
                    style: TextStyle(
                      color: statusColor,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                (tapped.guestName ?? '').trim().isEmpty
                    ? 'Guest'
                    : tapped.guestName!,
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'Room ${room?.roomNumber ?? tapped.roomId}'
                '${room?.categoryName != null ? ' · ${room!.categoryName}' : ''}',
                style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  Text(
                    formatIsoDate(tapped.checkInDate),
                    style: const TextStyle(
                      color: AppTheme.text,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 6),
                    child: Icon(Icons.arrow_forward_rounded, size: 13, color: AppTheme.muted),
                  ),
                  Text(
                    formatIsoDate(tapped.checkOutDate),
                    style: const TextStyle(
                      color: AppTheme.text,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
              Text(
                '${nights != null ? nightsLabel(nights) : ''}'
                '${tapped.guestPhone != null && tapped.guestPhone!.isNotEmpty ? ' · ${tapped.guestPhone}' : ''}',
                style: const TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
              if (isMultiRoom) ...[
                const SizedBox(height: AppTheme.s16),
                Text(
                  '${siblings.length} rooms on this booking — tap one to go to it',
                  style: const TextStyle(
                    color: AppTheme.muted,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: AppTheme.s8),
                for (final sib in siblings) ...[
                  _RoomRow(
                    stay: sib,
                    room: roomOf(sib.roomId),
                    here: sib.roomId == tapped.roomId,
                    onTap: () => Navigator.of(context).pop(sib),
                  ),
                  const SizedBox(height: AppTheme.s8),
                ],
              ],
              if (upcoming.isNotEmpty) ...[
                const SizedBox(height: AppTheme.s8),
                const Text(
                  'Upcoming bookings for this guest',
                  style: TextStyle(
                    color: AppTheme.muted,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: AppTheme.s8),
                for (final up in upcoming.take(4)) ...[
                  _RoomRow(
                    stay: up,
                    room: roomOf(up.roomId),
                    here: false,
                    onTap: () => Navigator.of(context).pop(up),
                  ),
                  const SizedBox(height: AppTheme.s8),
                ],
                if (upcoming.length > 4)
                  Text(
                    '+${upcoming.length - 4} more',
                    style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                  ),
              ],
          ],
        ),
      ),
    );
  }
}

class _RoomRow extends StatelessWidget {
  final TapeChartBooking stay;
  final TapeChartRoom? room;
  final bool here;
  final VoidCallback onTap;

  const _RoomRow({
    required this.stay,
    required this.room,
    required this.here,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppTheme.rSmall),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.s12,
          vertical: AppTheme.s8,
        ),
        decoration: BoxDecoration(
          color: AppTheme.card,
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          border: Border.all(
            color: here ? AppTheme.accent : AppTheme.border,
            width: here ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Room ${room?.roomNumber ?? stay.roomId}',
                    style: const TextStyle(
                      color: AppTheme.heading,
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    '${room?.categoryName != null ? '${room!.categoryName} · ' : ''}'
                    '${formatIsoDate(stay.checkInDate)} → ${formatIsoDate(stay.checkOutDate)}',
                    style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                  ),
                ],
              ),
            ),
            if (here)
              const Icon(Icons.my_location_rounded, color: AppTheme.accent, size: 16),
            const SizedBox(width: AppTheme.s4),
            const Icon(Icons.chevron_right_rounded, color: AppTheme.muted, size: 18),
          ],
        ),
      ),
    );
  }
}
