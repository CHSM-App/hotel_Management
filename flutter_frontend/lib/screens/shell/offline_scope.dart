import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../presentation/providers/network_provider.dart';
import '../../presentation/providers/repository_provider.dart';
import '../theme.dart';

/// Sections that keep working with no network (see OfflineDesk).
const offlineCapableSections = {'bookings', 'register', 'billing'};

/// When the device last downloaded from the server; null if it never has.
final lastSyncProvider = FutureProvider.autoDispose<DateTime?>((ref) async {
  // Re-read whenever connectivity changes, so the time is current when the
  // note appears.
  ref.watch(networkStatusProvider);
  final ref0 = await ref.read(offlineDeskProvider).store.refGet('bootstrap');
  return DateTime.tryParse('${ref0?['_fetchedAt']}')?.toLocal();
});

/// Wraps a section. While offline, a section that cannot work offline gets a
/// small note on top saying so and when its data was last brought up to date.
class OfflineScope extends ConsumerWidget {
  final String sectionKey;
  final Widget child;

  const OfflineScope({super.key, required this.sectionKey, required this.child});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final offline = ref.watch(networkStatusProvider).valueOrNull == false;
    if (!offline || offlineCapableSections.contains(sectionKey)) return child;

    final at = ref.watch(lastSyncProvider).valueOrNull;
    final when = at == null
        ? 'No saved data on this device.'
        : 'Showing data as of last sync, ${DateFormat('d MMM, h:mm a').format(at)}.';

    return Column(
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 6),
          color: const Color(0xFFB45309).withValues(alpha: 0.10),
          child: Row(
            children: [
              const Icon(Icons.cloud_off_rounded, size: 14, color: Color(0xFFB45309)),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'This section is unavailable offline. $when',
                  style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: Color(0xFFB45309)),
                ),
              ),
            ],
          ),
        ),
        Expanded(child: child),
      ],
    );
  }
}
