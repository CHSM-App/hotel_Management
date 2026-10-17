import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/housekeeping.dart';
import '../../domain/models/laundry.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../laundry/laundry_parts.dart';
import '../rooms/room_form_pieces.dart';
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
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        titleSpacing: AppTheme.s4,
        title: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [AppTheme.accent, Color(0xFF10499A)],
                ),
                borderRadius: BorderRadius.circular(AppTheme.rSmall + 2),
                boxShadow: const [BoxShadow(color: Color(0x331457AD), offset: Offset(0, 3), blurRadius: 8)],
              ),
              child: Icon(_isVenue ? Icons.celebration_rounded : Icons.cleaning_services_rounded, color: Colors.white, size: 18),
            ),
            const SizedBox(width: AppTheme.s12),
            Expanded(child: Text('Finish cleaning · $place', overflow: TextOverflow.ellipsis, maxLines: 1)),
          ],
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(3),
          child: Container(
            height: 3,
            decoration: const BoxDecoration(
              gradient: LinearGradient(colors: [AppTheme.accent, Color(0x001457AD)]),
            ),
          ),
        ),
      ),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: AppTheme.maxContentWidth),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s12, AppTheme.s12, AppTheme.s16),
              children: [
                if (_error != null) ...[
                  HkErrorBanner(_error!),
                  const SizedBox(height: AppTheme.s12),
                ],
                NeuCard(
                  radius: AppTheme.rLarge,
                  shadow: AppTheme.elevated,
                  padding: const EdgeInsets.all(AppTheme.s16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        hasLaundry ? 'Count the linen you replaced, then mark it clean.' : 'Note anything wrong, then mark it clean.',
                        style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                      ),
                      const SizedBox(height: AppTheme.s12),

                      // ── Linen ──────────────────────────────────────────
                      if (hasLaundry) ...[
                        SectionLabel(
                          'Linen changed',
                          number: 1,
                          icon: Icons.local_laundry_service_rounded,
                          trailing: pieces > 0 ? '$pieces ${pieces == 1 ? 'piece' : 'pieces'}' : 'Tap + for each piece',
                        ),
                        const SizedBox(height: AppTheme.s12),
                        if (linen.isEmpty)
                          const Text(
                            'Add linen items under Laundry → Hotel linen to count what you change in each room.',
                            style: TextStyle(color: AppTheme.muted, fontSize: 12),
                          )
                        else
                          for (var i = 0; i < linen.length; i++) ...[
                            _LinenRow(
                              item: linen[i],
                              count: _counts[linen[i].id] ?? 0,
                              onChange: (n) => setState(() => _counts[linen[i].id] = n),
                            ),
                            if (i != linen.length - 1) const Divider(height: AppTheme.s16, color: AppTheme.border),
                          ],
                        const SectionDivider(),
                      ],

                      // ── Report ─────────────────────────────────────────
                      SectionLabel(
                        'Anything to report?',
                        number: hasLaundry ? 2 : 1,
                        icon: Icons.flag_outlined,
                        trailing: 'Optional',
                      ),
                      const SizedBox(height: AppTheme.s12),
                      NeuField(
                        controller: _issues,
                        label: _isVenue ? 'Problem in the venue' : 'Problem in the room',
                        hint: _isVenue ? 'e.g. AC not cooling, broken chair, stained table cloth' : 'e.g. tap leaking, bulb not working, stained sheet',
                        onChanged: (_) => setState(() {}),
                        dense: true,
                      ),
                      if (_issues.text.trim().isNotEmpty) ...[
                        const SizedBox(height: AppTheme.s8),
                        Container(
                          decoration: BoxDecoration(color: AppTheme.danger.withValues(alpha: 0.05), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
                          child: CheckboxListTile(
                            value: _blockRoom,
                            onChanged: (v) => setState(() => _blockRoom = v ?? false),
                            controlAffinity: ListTileControlAffinity.leading,
                            contentPadding: const EdgeInsets.symmetric(horizontal: AppTheme.s8),
                            dense: true,
                            activeColor: AppTheme.danger,
                            title: Text(_isVenue ? 'Venue cannot be used for functions' : 'Room cannot be given to guests', style: const TextStyle(color: AppTheme.heading, fontSize: 13, fontWeight: FontWeight.w600)),
                            subtitle: const Text('It stays under repair until the problem is marked fixed.', style: TextStyle(color: AppTheme.muted, fontSize: 11.5)),
                          ),
                        ),
                      ],
                      const SizedBox(height: AppTheme.s12),
                      NeuField(
                        controller: _lostFound,
                        label: _isVenue ? 'Something left behind after the function' : 'Guest left something behind',
                        hint: _isVenue ? 'e.g. gift box, bag, phone charger' : 'e.g. phone charger, watch',
                        dense: true,
                      ),
                      const SizedBox(height: AppTheme.s4),
                      const Text('Reception is told as soon as you submit.', style: TextStyle(color: AppTheme.muted, fontSize: 11)),
                    ],
                  ),
                ),
                const SizedBox(height: AppTheme.s16),
                Row(
                  children: [
                    Expanded(
                      child: NeuButton(
                        onPressed: hkState.submitting ? null : () => Navigator.of(context).pop(),
                        padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                        child: const Text('Cancel'),
                      ),
                    ),
                    const SizedBox(width: AppTheme.s12),
                    Expanded(
                      flex: 2,
                      child: NeuButton(
                        primary: true,
                        onPressed: hkState.submitting ? null : _submit,
                        padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                        child: hkState.submitting
                            ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(Icons.check_circle_rounded, size: 18, color: Colors.white),
                                    const SizedBox(width: 4),
                                    Text('Mark ${_isVenue ? 'venue' : 'room'} clean'),
                                  ],
                                ),
                              ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One linen item's row: name on the left (tinted once counted), the
/// stepper on the right — same construction as a compact list row elsewhere
/// in the app, now with a bit more breathing room than the plain `Row` it
/// replaces.
class _LinenRow extends StatelessWidget {
  final LinenItem item;
  final int count;
  final ValueChanged<int> onChange;

  const _LinenRow({required this.item, required this.count, required this.onChange});

  @override
  Widget build(BuildContext context) {
    final active = count > 0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Container(
            width: 6,
            height: 6,
            margin: const EdgeInsets.only(right: AppTheme.s8),
            decoration: BoxDecoration(color: active ? AppTheme.accent : AppTheme.border, shape: BoxShape.circle),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.name,
                  style: TextStyle(color: active ? AppTheme.accent : AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13.5),
                ),
                Text(
                  '${item.clean} clean in store',
                  style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                ),
              ],
            ),
          ),
          CountStepper(value: count, onChange: onChange, max: item.clean),
        ],
      ),
    );
  }
}
