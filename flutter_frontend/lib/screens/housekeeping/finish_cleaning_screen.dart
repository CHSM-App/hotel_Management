import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/housekeeping.dart';
import '../../domain/models/laundry.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../laundry/laundry_parts.dart';
import '../theme.dart';
import 'housekeeping_parts.dart';

/// Finish cleaning a room — mirrors the 'finish' modal in
/// HousekeepingPanel.jsx's RoomsTab: count the linen changed (where Laundry
/// is on), note anything to report, then mark the room clean.
Future<void> showFinishCleaningScreen(BuildContext context, HousekeepingRoom room) {
  return Navigator.of(context).push(MaterialPageRoute(builder: (_) => FinishCleaningScreen(room: room)));
}

class FinishCleaningScreen extends ConsumerStatefulWidget {
  final HousekeepingRoom room;
  const FinishCleaningScreen({super.key, required this.room});

  @override
  ConsumerState<FinishCleaningScreen> createState() => _FinishCleaningScreenState();
}

class _FinishCleaningScreenState extends ConsumerState<FinishCleaningScreen> {
  final Map<int, int> _counts = {};
  final _issues = TextEditingController();
  final _lostFound = TextEditingController();
  bool _blockRoom = false;
  String? _error;

  bool get _hasLaundry => ref.read(authViewModelProvider).me?.lodge.hasLaundry ?? false;
  bool get _isVenue => widget.room.isVenue;

  @override
  void initState() {
    super.initState();
    if (_hasLaundry) {
      Future.microtask(() => ref.read(laundryViewModelProvider.notifier).loadBoard());
    }
  }

  @override
  void dispose() {
    _issues.dispose();
    _lostFound.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final lines = _counts.entries
        .where((e) => e.value > 0)
        .map((e) => {'linenItemId': e.key, 'quantity': e.value})
        .toList();
    final body = {
      'linen': lines,
      'issues': _issues.text.trim(),
      'lostFound': _lostFound.text.trim(),
      'blockRoom': _issues.text.trim().isNotEmpty && _blockRoom,
    };
    final notifier = ref.read(housekeepingViewModelProvider.notifier);
    final ok = _isVenue ? await notifier.finishVenueCleaning(widget.room.id, body) : await notifier.finishCleaning(widget.room.id, body);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(housekeepingViewModelProvider).error ?? 'Could not update the ${_isVenue ? 'venue' : 'room'}.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final hkState = ref.watch(housekeepingViewModelProvider);
    final hasLaundry = _hasLaundry;
    final linen = hasLaundry ? ref.watch(laundryViewModelProvider).activeItems : const <LinenItem>[];
    final pieces = _counts.values.fold(0, (n, v) => n + v);

    final place = _isVenue ? widget.room.roomNumber : 'Room ${widget.room.roomNumber}';

    return Scaffold(
      appBar: AppBar(title: Text('Finish cleaning · $place')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
          children: [
            if (_error != null) ...[
              HkErrorBanner(_error!),
              const SizedBox(height: AppTheme.s16),
            ],
            Text(
              hasLaundry ? 'Count the linen you replaced, then mark the ${_isVenue ? 'venue' : 'room'} clean.' : 'Note anything wrong, then mark the ${_isVenue ? 'venue' : 'room'} clean.',
              style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
            ),
            const SizedBox(height: AppTheme.s16),
            if (hasLaundry)
              NeuCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(child: Text('Linen changed', style: Theme.of(context).textTheme.titleSmall)),
                        Text(
                          pieces > 0 ? '$pieces ${pieces == 1 ? 'piece' : 'pieces'}' : 'Tap + for each piece',
                          style: TextStyle(color: pieces > 0 ? AppTheme.accent : AppTheme.muted, fontSize: 11.5, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppTheme.s8),
                    if (linen.isEmpty)
                      const Text('Add linen items under Laundry → Hotel linen to count what you change in each room.', style: TextStyle(color: AppTheme.muted, fontSize: 12))
                    else
                      for (final i in linen)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  i.name,
                                  style: TextStyle(color: (_counts[i.id] ?? 0) > 0 ? AppTheme.accent : AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13),
                                ),
                              ),
                              CountStepper(value: _counts[i.id] ?? 0, onChange: (n) => setState(() => _counts[i.id] = n)),
                            ],
                          ),
                        ),
                  ],
                ),
              ),
            if (hasLaundry) const SizedBox(height: AppTheme.s16),
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(child: Text('Anything to report?', style: Theme.of(context).textTheme.titleSmall)),
                      const Text('Optional · reception is told', style: TextStyle(color: AppTheme.muted, fontSize: 11)),
                    ],
                  ),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _issues,
                    label: _isVenue ? 'Problem in the venue' : 'Problem in the room',
                    hint: _isVenue ? 'e.g. AC not cooling, broken chair, stained table cloth' : 'e.g. tap leaking, bulb not working, stained sheet',
                    onChanged: (_) => setState(() {}),
                  ),
                  if (_issues.text.trim().isNotEmpty) ...[
                    const SizedBox(height: AppTheme.s8),
                    CheckboxListTile(
                      value: _blockRoom,
                      onChanged: (v) => setState(() => _blockRoom = v ?? false),
                      controlAffinity: ListTileControlAffinity.leading,
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      title: Text(_isVenue ? 'Venue cannot be used for functions' : 'Room cannot be given to guests', style: const TextStyle(color: AppTheme.heading, fontSize: 13, fontWeight: FontWeight.w600)),
                      subtitle: const Text('It stays under repair until the problem is marked fixed.', style: TextStyle(color: AppTheme.muted, fontSize: 11.5)),
                    ),
                  ],
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _lostFound,
                    label: _isVenue ? 'Something left behind after the function' : 'Guest left something behind',
                    hint: _isVenue ? 'e.g. gift box, bag, phone charger' : 'e.g. phone charger, watch',
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s24),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: hkState.submitting ? null : _submit,
              child: hkState.submitting
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text('Mark ${_isVenue ? 'venue' : 'room'} clean'),
            ),
          ],
        ),
      ),
    );
  }
}
