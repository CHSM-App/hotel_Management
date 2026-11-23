import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/repository_provider.dart';

/// How many saved-on-this-device actions are still waiting to reach the
/// server (pending, being sent, or held for the desk). Drives the connection
/// strip. Failed ones are not counted here: those are the Sync center's.
///
/// Counted through the store, so only the signed-in lodge's own rows: the
/// Sync center lists by that scope too, and the two must agree. Counting every
/// row on the device made the strip say "1 thing needs your attention" for a
/// stale item left by another login/server while the Sync center — rightly —
/// showed nothing.
Future<int> _count(Ref ref, List<String> statuses) async {
  try {
    final ops = await ref.read(offlineDeskProvider).store.ops(statuses: statuses);
    return ops.length;
  } catch (_) {
    // A strip must never be the thing that breaks a screen.
    return 0;
  }
}

/// Saved here and on their way to the server.
final pendingOutboxCountProvider = _polled(['pending', 'syncing']);

/// Held for a person: refused by the server, or waiting on something that was.
final attentionOutboxCountProvider = _polled(['conflict', 'failed', 'blocked']);

/// Polled, not pushed. sqflite has no change stream, and the outbox does not
/// exist as a writer yet; a 3 s poll of one COUNT is cheap and keeps this
/// independent of whoever enqueues.
// ponytail: poll every 3 s, switch to a ChangeNotifier the outbox writes to
// once the drain engine exists, if the poll ever shows up in profiling.
AutoDisposeStreamProvider<int> _polled(List<String> statuses) =>
    StreamProvider.autoDispose<int>((ref) {
  final out = StreamController<int>();
  Future<void> tick() async {
    final n = await _count(ref, statuses);
    if (!out.isClosed) out.add(n);
  }

  tick();
  // Cancelled with the provider, so a widget test that unmounts the shell is
  // not left with a pending timer.
  final timer = Timer.periodic(const Duration(seconds: 3), (_) => tick());
  ref.onDispose(() {
    timer.cancel();
    out.close();
  });
  return out.stream;
});
