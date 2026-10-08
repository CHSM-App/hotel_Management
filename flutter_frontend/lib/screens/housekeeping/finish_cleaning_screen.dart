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
      backgroundColor: AppTheme.bg,
      appBar: AppBar(title: const Text('Finish cleaning')),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: AppTheme.maxContentWidth),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, AppTheme.s32),
              children: [
                if (_error != null) ...[
                  HkErrorBanner(_error!),
                  const SizedBox(height: AppTheme.s16),
                ],

                // ── Place banner ────────────────────────────────────────
                Container(
                  padding: const EdgeInsets.all(AppTheme.s16),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [AppTheme.accent.withValues(alpha: 0.10), AppTheme.accent.withValues(alpha: 0.02)],
                    ),
                    borderRadius: BorderRadius.circular(AppTheme.rMedium),
                    border: Border.all(color: AppTheme.accent.withValues(alpha: 0.18)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 46,
                        height: 46,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(color: AppTheme.card, shape: BoxShape.circle, boxShadow: AppTheme.subtle),
                        child: Icon(_isVenue ? Icons.celebration_rounded : Icons.bed_rounded, color: AppTheme.accent, size: 22),
                      ),
                      const SizedBox(width: AppTheme.s12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(place, style: Theme.of(context).textTheme.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                            const SizedBox(height: 2),
                            Text(
                              hasLaundry ? 'Count the linen you replaced, then mark it clean.' : 'Note anything wrong, then mark it clean.',
                              style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppTheme.s16),

                // ── Linen ────────────────────────────────────────────────
                if (hasLaundry) ...[
                  _SectionCard(
                    icon: Icons.local_laundry_service_rounded,
                    title: 'Linen changed',
                    trailing: pieces > 0
                        ? Container(
                            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                            decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                            child: Text('$pieces ${pieces == 1 ? 'piece' : 'pieces'}', style: const TextStyle(color: AppTheme.accent, fontSize: 11.5, fontWeight: FontWeight.w800)),
                          )
                        : const Text('Tap + for each piece', style: TextStyle(color: AppTheme.muted, fontSize: 11.5, fontWeight: FontWeight.w500)),
                    child: linen.isEmpty
                        ? const Text('Add linen items under Laundry → Hotel linen to count what you change in each room.', style: TextStyle(color: AppTheme.muted, fontSize: 12))
                        : Column(
                            children: [
                              for (var i = 0; i < linen.length; i++) ...[
                                _LinenRow(
                                  item: linen[i],
                                  count: _counts[linen[i].id] ?? 0,
                                  onChange: (n) => setState(() => _counts[linen[i].id] = n),
                                ),
                                if (i != linen.length - 1) const Divider(height: AppTheme.s16, color: AppTheme.border),
                              ],
                            ],
                          ),
                  ),
                  const SizedBox(height: AppTheme.s16),
                ],

                // ── Report ───────────────────────────────────────────────
                _SectionCard(
                  icon: Icons.flag_outlined,
                  title: 'Anything to report?',
                  trailing: const Text('Optional', style: TextStyle(color: AppTheme.muted, fontSize: 11.5, fontWeight: FontWeight.w500)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      NeuField(
                        controller: _issues,
                        label: _isVenue ? 'Problem in the venue' : 'Problem in the room',
                        hint: _isVenue ? 'e.g. AC not cooling, broken chair, stained table cloth' : 'e.g. tap leaking, bulb not working, stained sheet',
                        onChanged: (_) => setState(() {}),
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
                      const SizedBox(height: AppTheme.s16),
                      NeuField(
                        controller: _lostFound,
                        label: _isVenue ? 'Something left behind after the function' : 'Guest left something behind',
                        hint: _isVenue ? 'e.g. gift box, bag, phone charger' : 'e.g. phone charger, watch',
                      ),
                      const SizedBox(height: AppTheme.s4),
                      const Text('Reception is told as soon as you submit.', style: TextStyle(color: AppTheme.muted, fontSize: 11)),
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
                      : Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.check_circle_rounded, size: 18, color: Colors.white),
                            const SizedBox(width: AppTheme.s8),
                            Text('Mark ${_isVenue ? 'venue' : 'room'} clean'),
                          ],
                        ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A rounded card with an icon-led title row (and an optional trailing badge
/// or hint) above its content — shared shape for the Linen and Report
/// sections so the page reads as two clearly separated, evenly styled steps.
class _SectionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final Widget? trailing;
  final Widget child;

  const _SectionCard({required this.icon, required this.title, this.trailing, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTheme.s16),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.subtle,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 28,
                height: 28,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.10), shape: BoxShape.circle),
                child: Icon(icon, size: 15, color: AppTheme.accent),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(child: Text(title, style: Theme.of(context).textTheme.titleSmall)),
              if (trailing != null) trailing!,
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          child,
        ],
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
            child: Text(
              item.name,
              style: TextStyle(color: active ? AppTheme.accent : AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13.5),
            ),
          ),
          CountStepper(value: count, onChange: onChange),
        ],
      ),
    );
  }
}
