import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/housekeeping.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../theme.dart';

/// Close a room for repair — mirrors the 'ooo' modal in
/// HousekeepingPanel.jsx's RoomsTab: a single "what is wrong?" note.
Future<void> showOutOfOrderDialog(BuildContext context, HousekeepingRoom room) {
  return showDialog(
    context: context,
    builder: (_) => _OutOfOrderDialog(room: room),
  );
}

class _OutOfOrderDialog extends ConsumerStatefulWidget {
  final HousekeepingRoom room;
  const _OutOfOrderDialog({required this.room});

  @override
  ConsumerState<_OutOfOrderDialog> createState() => _OutOfOrderDialogState();
}

class _OutOfOrderDialogState extends ConsumerState<_OutOfOrderDialog> {
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final busy = ref.watch(housekeepingViewModelProvider.select((s) => s.submitting));
    final isVenue = widget.room.isVenue;
    final place = isVenue ? widget.room.roomNumber : 'Room ${widget.room.roomNumber}';
    return AlertDialog(
      backgroundColor: AppTheme.bg,
      title: Text('$place — ${isVenue ? 'under repair' : 'out of order'}', style: const TextStyle(color: AppTheme.heading)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('It stays off the cleaning list until it is back in service.', style: TextStyle(color: AppTheme.text, fontSize: 12.5)),
          const SizedBox(height: AppTheme.s12),
          TextField(
            controller: _note,
            autofocus: true,
            decoration: const InputDecoration(labelText: 'What is wrong?', border: OutlineInputBorder()),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: busy ? null : () => Navigator.pop(context), child: const Text('Cancel')),
        TextButton(
          onPressed: busy
              ? null
              : () async {
                  final notifier = ref.read(housekeepingViewModelProvider.notifier);
                  final body = {'outOfOrder': true, 'note': _note.text.trim()};
                  final ok = isVenue ? await notifier.setVenueOutOfOrder(widget.room.id, body) : await notifier.setOutOfOrder(widget.room.id, body);
                  if (ok && context.mounted) Navigator.pop(context);
                },
          child: const Text('Close for repair'),
        ),
      ],
    );
  }
}
