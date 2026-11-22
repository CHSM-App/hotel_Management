import 'package:dio/dio.dart';

import '../../domain/models/json.dart';
import '../network/api_error_message.dart';
import 'offline_interceptor.dart';
import 'offline_store.dart';

/// Sends what was done offline to the server, in the order it was done.
///
/// One request at a time, oldest first, so the real invoice numbers the server
/// hands out follow the order the guests were actually billed in. Safe to call
/// as often as you like: only one run is ever in flight.
///
/// What a reply means:
///   2xx                       done — the op is dropped, and once nothing else is
///                             waiting for that stay the local copy is dropped
///                             too and the server's own is the truth again.
///   no network / timeout      stays queued; the run stops and tries again later.
///   409 and similar refusals  the server looked at it and said no — a room sold
///                             twice, a bill that moved. Held for the desk in the
///                             Sync center, never retried blindly, never dropped.
///   401                       the session expired while offline; the existing
///                             sign-in handling takes over and the queue waits.
class OutboxDrain {
  final Dio dio;
  final OfflineStore store;

  /// Told after anything changed on the server, so screens can refresh.
  final void Function() onSynced;

  /// Told when a run starts and stops, for the connection strip.
  final void Function(bool busy)? onBusy;

  OutboxDrain({required this.dio, required this.store, required this.onSynced, this.onBusy});

  bool _busy = false;
  bool get busy => _busy;

  static const _maxRetries = 5;

  Future<void> run() async {
    if (_busy) return;
    _busy = true;
    onBusy?.call(true);
    var changed = false;
    try {
      // An op left "syncing" by an app that was killed mid-send is simply waiting.
      for (final op in await store.ops(statuses: ['syncing'])) {
        await store.setStatus(op.id, 'pending');
      }

      for (final op in await store.ops(statuses: ['pending'])) {
        final outcome = await _send(op);
        if (outcome == _Outcome.stop) break;
        changed = true;
      }
    } finally {
      _busy = false;
      onBusy?.call(false);
      if (changed) onSynced();
    }
  }

  Future<_Outcome> _send(OutboxOp op) async {
    // A booking made here has no server id until its create is accepted.
    var path = op.path;
    final ref = op.bookingRef;
    if (path.contains('{id}')) {
      final id = (ref == null || ref >= 0) ? ref : await store.serverIdFor(ref);
      if (id == null) {
        // Its create did not go through. Nothing to send this to.
        await store.setStatus(op.id, 'blocked', error: 'Waiting for the booking it belongs to.');
        return _Outcome.next;
      }
      path = path.replaceAll('{id}', '$id');
    }

    await store.setStatus(op.id, 'syncing');
    try {
      final data = op.form != null ? await op.form!.rebuild() : op.json;
      final res = await dio.request<dynamic>(
        path,
        data: data,
        // X-Offline-Replay: this already happened at the desk — the server
        // records it and reports oddities as warnings instead of refusing.
        options: Options(method: op.method, headers: {'Idempotency-Key': op.clientUuid, 'X-Offline-Replay': '1'}),
      );
      await _done(op, res.data);
      return _Outcome.next;
    } on DioException catch (e) {
      final status = e.response?.statusCode;

      if (e is OfflineUnavailable || (e.response == null && _transport(e))) {
        await store.setStatus(op.id, 'pending');
        return _Outcome.stop;
      }
      if (status == 401) {
        await store.setStatus(op.id, 'pending');
        return _Outcome.stop;
      }
      // Still being processed from an earlier send: not a conflict, just wait.
      if (status == 409 && '${e.response?.data}'.contains('IN_PROGRESS')) {
        await store.setStatus(op.id, 'pending');
        return _Outcome.stop;
      }
      if (status != null && status >= 500) {
        if (op.retryCount + 1 >= _maxRetries) {
          await store.setStatus(op.id, 'failed', error: apiErrorMessage(e), retry: true);
          await _blockDependents(op);
          return _Outcome.next;
        }
        await store.setStatus(op.id, 'pending', retry: true);
        return _Outcome.stop;
      }
      return _refused(op, path, e);
    } catch (e) {
      // A snapshot that cannot be read back (a file deleted from under us) is
      // not going to fix itself on retry.
      await store.setStatus(op.id, 'failed', error: 'Could not be sent: $e');
      return _Outcome.next;
    }
  }

  bool _transport(DioException e) =>
      e.type == DioExceptionType.connectionError ||
      e.type == DioExceptionType.connectionTimeout ||
      e.type == DioExceptionType.receiveTimeout ||
      e.type == DioExceptionType.sendTimeout;

  /// The server answered and declined. Some declines mean "already done" — a
  /// replay of something that did get through before the reply was lost.
  Future<_Outcome> _refused(OutboxOp op, String path, DioException e) async {
    final message = apiErrorMessage(e);
    final status = e.response?.statusCode;

    if (status == 409) {
      if (await _alreadyDone(op, message)) {
        await _done(op, null, alreadyDone: true);
        return _Outcome.next;
      }
      await store.setStatus(op.id, 'conflict', error: message);
      await _blockDependents(op);
      return _Outcome.next;
    }
    await store.setStatus(op.id, 'failed', error: message);
    await _blockDependents(op);
    return _Outcome.next;
  }

  Future<bool> _alreadyDone(OutboxOp op, String message) async {
    final ref = op.bookingRef;
    if (ref == null) return false;
    final id = ref >= 0 ? ref : await store.serverIdFor(ref);
    if (id == null) return false;

    switch (op.feature) {
      case 'booking.checkin':
      case 'booking.settle':
        // The server's own words for a replay of something that went through.
        if (message.contains('already has an issued bill')) return true;
        try {
          final res = await dio.get<dynamic>('/bookings/$id');
          final body = res.data;
          final booking = body is Map ? body['booking'] : null;
          final status = booking is Map ? booking['status']?.toString() : null;
          if (op.feature == 'booking.checkin') return status == 'CHECKED_IN' || status == 'CHECKED_OUT';
          return status == 'CHECKED_OUT' && message.contains('not checked in');
        } catch (_) {
          return false;
        }
      default:
        return false;
    }
  }

  /// Everything that follows a stay whose earlier step was refused cannot go on
  /// without it; held, not lost.
  Future<void> _blockDependents(OutboxOp op) async {
    final ref = op.bookingRef;
    if (ref == null) return;
    for (final later in await store.ops(statuses: ['pending'])) {
      if (later.bookingRef == ref && later.id > op.id) {
        await store.setStatus(later.id, 'blocked', error: 'Waiting for an earlier step on this booking to be sorted out.');
      }
    }
  }

  Future<void> _done(OutboxOp op, dynamic body, {bool alreadyDone = false}) async {
    final ref = op.bookingRef;
    if (body is Map && body['warnings'] is List) {
      final who = op.meta['guestName'];
      await store.addNotices([for (final w in body['warnings'] as List) '${who ?? 'Booking'}: $w']);
    }
    if (op.feature == 'booking.create' && ref != null && !alreadyDone) {
      final map = body is Map ? body : const {};
      final booking = map['booking'] is Map ? map['booking'] as Map : map;
      final serverId = asIntOrNull(booking['id']);
      if (serverId != null) {
        await store.mapId(ref, serverId);
        final stay = await store.stayGet(ref);
        if (stay != null) {
          stay['serverId'] = serverId;
          if (booking['bookingNumber'] != null) stay['bookingNumber'] = booking['bookingNumber'];
          await store.stayPut(ref, stay);
        }
      }
    }
    await store.remove(op);

    // Once nothing else is waiting for this stay, the server's copy is the
    // truth again and ours can go.
    if (ref != null && !await store.hasOpenOps(ref)) {
      await store.stayDelete(ref);
    }
  }

  /// Put a held op back in the queue (the desk fixed what was wrong, or just
  /// wants it tried again) along with anything that was waiting behind it.
  Future<void> retry(OutboxOp op) async {
    await store.setStatus(op.id, 'pending');
    final ref = op.bookingRef;
    for (final other in await store.ops(statuses: ['blocked'])) {
      if (other.bookingRef == ref) await store.setStatus(other.id, 'pending');
    }
  }

  /// Give up on an op. Dropping a booking's create drops everything that
  /// depended on it and the local copy too — said plainly in the Sync center
  /// before this is called.
  Future<void> discard(OutboxOp op) async {
    final ref = op.bookingRef;
    await store.remove(op);
    if (ref == null) return;
    if (op.feature == 'booking.create') {
      for (final other in await store.ops()) {
        if (other.bookingRef == ref) await store.remove(other);
      }
      await store.stayDelete(ref);
    } else if (!await store.hasOpenOps(ref)) {
      await store.stayDelete(ref);
    }
  }
}

enum _Outcome { next, stop }
