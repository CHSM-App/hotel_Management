import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/api_service.dart';
import '../../domain/models/json.dart';
import '../../presentation/providers/network_provider.dart';
import '../../presentation/providers/repository_provider.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../network/dio_provider.dart';
import '../network/token_provider.dart';
import 'offline_desk.dart';
import 'outbox_drain.dart';

/// True while a replay of saved actions is in flight; drives the strip.
final syncBusyProvider = StateProvider<bool>((ref) => false);

/// The one replay engine for the session.
final outboxDrainProvider = Provider<OutboxDrain>((ref) {
  return OutboxDrain(
    dio: ref.read(dioProvider),
    store: ref.read(offlineDeskProvider).store,
    onBusy: (busy) => ref.read(syncBusyProvider.notifier).state = busy,
    onSynced: () {
      // The server changed under the screens: reload what they show.
      ref.read(bookingViewModelProvider.notifier).loadChart();
      ref.read(billingViewModelProvider.notifier).load();
    },
  );
});

/// Downloads what the device needs to keep running offline: the rates and rooms
/// (GET /sync/bootstrap), and the booking details of everyone in the house or
/// arriving soon, so they can be checked in and out with no network.
///
/// Best effort and silent — a failure here must never be the thing a desk sees.
class Prefetcher {
  final ApiService api;
  final OfflineDesk desk;
  Prefetcher(this.api, this.desk);

  bool _running = false;

  Future<void> run() async {
    if (_running) return;
    _running = true;
    try {
      final boot = await api.syncBootstrap();
      await desk.saveReference(boot);

      // Warm the HTTP cache with the lodge's own details (a bill prints them).
      try {
        await api.me();
      } catch (_) {}

      final today = boot['today'] as String? ?? DateTime.now().toIso8601String().substring(0, 10);
      final soon = DateTime.parse(today).add(const Duration(days: 3)).toIso8601String().substring(0, 10);
      final chart = (boot['tapeChart'] as Map?) ?? const {};
      var fetched = 0;
      for (final b in (chart['bookings'] as List? ?? const [])) {
        if (fetched >= 80) break;
        final m = b as Map;
        final status = '${m['status']}';
        final checkIn = '${m['checkInDate']}'.substring(0, 10);
        final inHouse = status == 'CHECKED_IN';
        final arriving = status == 'BOOKED' && checkIn.compareTo(soon) <= 0;
        if (!inHouse && !arriving) continue;
        final id = asIntOrNull(m['id']);
        if (id == null) continue;
        try {
          await api.booking(id);
          fetched++;
        } catch (_) {}
      }
    } catch (_) {
      // Offline, signed out, or an older server without /sync/bootstrap.
    } finally {
      _running = false;
    }
  }
}

final prefetcherProvider = Provider<Prefetcher>(
  (ref) => Prefetcher(ref.read(apiServiceProvider), ref.read(offlineDeskProvider)),
);

/// Starts the two background jobs and keeps them going for the app's life:
/// refresh the downloaded data and replay saved actions whenever the server
/// becomes reachable, and again on a timer. Activated once from main().
final offlineControllerProvider = Provider<void>((ref) {
  bool online() => ref.read(networkStatusProvider).valueOrNull == true;
  bool signedIn() => ref.read(tokenProvider).isLoggedIn;

  Future<void> sync() async {
    if (!signedIn() || !online()) return;
    // Replay first: what was done here must reach the server before the
    // refreshed picture of the server is laid over it.
    await ref.read(outboxDrainProvider).run();
    await ref.read(prefetcherProvider).run();
  }

  ref.listen<AsyncValue<bool>>(networkStatusProvider, (prev, next) {
    if (next.valueOrNull == true && prev?.valueOrNull != true) sync();
  });
  ref.listen<TokenState>(tokenProvider, (prev, next) {
    if (next.isLoggedIn && !(prev?.isLoggedIn ?? false)) sync();
  });

  final timer = Timer.periodic(const Duration(seconds: 60), (_) async {
    if (!signedIn() || !online()) return;
    await ref.read(outboxDrainProvider).run();
  });
  final refresh = Timer.periodic(const Duration(minutes: 10), (_) => sync());
  ref.onDispose(() {
    timer.cancel();
    refresh.cancel();
  });

  Future.microtask(sync);
});
