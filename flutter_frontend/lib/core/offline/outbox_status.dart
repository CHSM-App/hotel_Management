import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/db/app_database.dart';

/// How many saved-on-this-device actions are still waiting to reach the
/// server (pending, being sent, or held for the desk). Drives the connection
/// strip. Failed ones are not counted here: those are the Sync center's.
Future<int> _count(String statuses) async {
  try {
    final db = await AppDatabase.database;
    final rows = await db.rawQuery('SELECT COUNT(*) AS n FROM outbox WHERE status IN ($statuses)');
    return (rows.first['n'] as int?) ?? 0;
  } catch (_) {
    // A strip must never be the thing that breaks a screen.
    return 0;
  }
}

/// Saved here and on their way to the server.
Future<int> pendingOutboxCount() => _count("'pending','syncing'");

/// Held for a person: refused by the server, or waiting on something that was.
Future<int> attentionOutboxCount() => _count("'conflict','failed','blocked'");

/// Polled, not pushed. sqflite has no change stream, and the outbox does not
/// exist as a writer yet; a 3 s poll of one COUNT is cheap and keeps this
/// independent of whoever enqueues.
// ponytail: poll every 3 s, switch to a ChangeNotifier the outbox writes to
// once the drain engine exists, if the poll ever shows up in profiling.
final pendingOutboxCountProvider = _polled(pendingOutboxCount);

final attentionOutboxCountProvider = _polled(attentionOutboxCount);

AutoDisposeStreamProvider<int> _polled(Future<int> Function() read) =>
    StreamProvider.autoDispose<int>((ref) {
  final out = StreamController<int>();
  Future<void> tick() async {
    final n = await read();
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
