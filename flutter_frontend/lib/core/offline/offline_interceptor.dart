import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:sqflite/sqflite.dart' show ConflictAlgorithm;

import '../../data/db/app_database.dart';

/// What a call that cannot be served offline fails with.
///
/// A connectionError DioException on purpose: every screen already has a path
/// for "the network is gone", and this rides it. [apiErrorMessage] gives it the
/// neutral wording instead of a red "something went wrong".
class OfflineUnavailable extends DioException {
  /// What to tell the desk. Null is the generic "needs a connection".
  final String? reason;

  OfflineUnavailable(RequestOptions options, {this.reason})
    : super(
        requestOptions: options,
        type: DioExceptionType.connectionError,
        message: reason ?? 'Not available offline',
      );

  /// Raised from the on-device engine, where there is no request: the thing
  /// asked for is outside what the desk can do offline, said in plain words.
  OfflineUnavailable.because(String reason) : this(RequestOptions(path: ''), reason: reason);
}

/// Keeps the last good answer to every GET and serves it when the server
/// cannot be reached, so a screen the desk has opened before still opens with
/// the network gone.
///
/// Registered first, ahead of the token interceptor: an offline request
/// should not wait out a 30 s timeout or be mistaken for an expired session.
/// Only transport failures fall back to the cache. A 4xx/5xx is a real answer
/// from the server and passes through untouched — never cached, never masked.
class OfflineInterceptor extends Interceptor {
  /// Reads the connectivity verdict at call time (a closure, so this file does
  /// not depend on Riverpod or the presentation layer).
  final bool Function() isOffline;

  /// The lodge the session belongs to. A shared device must never serve one
  /// lodge's cache to another.
  final String Function() scope;

  OfflineInterceptor({required this.isOffline, required this.scope});

  // Paths whose whole value is being true right now.
  static const _neverCache = [
    '/orders/queue',
    // Live bar queues: a cached ticket is an order nobody is serving.
    '/bar/orders',
    '/bar/tabs',
    '/bar/targets',
    '/bookings/checkin-alerts',
    '/bookings/checkout-alerts',
    // Answered on the device when there is no network (lib/domain/pricing):
    // a cached copy is right only for the exact request that was cached, and
    // the whole point is the desk changing dates, extras and discounts.
    '/bookings/price-quote',
    '/bookings/available-rooms',
    '/bookings/available-beds',
    // Invoice-numbering bounds: a stale copy would let a date through that
    // the server then rejects (or worse, hide one it would accept).
    '/bookings/past-window',
    // Kept in its own table (ref_store), not duplicated in the HTTP cache.
    '/sync/bootstrap',
  ];

  // Per-booking answers that depend on the moment or the parameters.
  static final _volatile = RegExp(
    r'^/(bookings/\d+/(late-checkout|available-rooms|edit-window)|bookings/\d+/rooms/\d+/late-checkout|billing/bookings/\d+/preview)',
  );

  bool _cacheable(RequestOptions o) =>
      o.method == 'GET' &&
      o.responseType != ResponseType.bytes &&
      !_neverCache.any(o.path.startsWith) &&
      !_volatile.hasMatch(o.path);

  String _key(RequestOptions o) => o.uri.toString().replaceFirst(
    RegExp(r'^https?://[^/]+'),
    '',
  );

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    if (!isOffline()) return handler.next(options);
    if (!_cacheable(options)) {
      // Writes reach the outbox in a later phase; until then say so calmly.
      return handler.reject(OfflineUnavailable(options));
    }
    final hit = await _read(options);
    handler.resolveOrReject(hit, options);
  }

  @override
  Future<void> onResponse(
    Response response,
    ResponseInterceptorHandler handler,
  ) async {
    final o = response.requestOptions;
    if (_cacheable(o) &&
        response.statusCode == 200 &&
        response.extra['fromCache'] != true) {
      try {
        final db = await AppDatabase.database;
        await db.insert('http_cache', {
          'scope': scope(),
          'url': _key(o),
          'body': jsonEncode(response.data),
          'fetched_at': DateTime.now().toIso8601String(),
        }, conflictAlgorithm: ConflictAlgorithm.replace);
      } catch (_) {
        // A cache that cannot be written must never break a live response.
      }
    }
    handler.next(response);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final transport = err.response == null &&
        (err.type == DioExceptionType.connectionError ||
            err.type == DioExceptionType.connectionTimeout ||
            err.type == DioExceptionType.receiveTimeout ||
            err.type == DioExceptionType.sendTimeout);
    if (!transport || err is OfflineUnavailable) return handler.next(err);

    if (!_cacheable(err.requestOptions)) {
      return handler.next(OfflineUnavailable(err.requestOptions));
    }
    final hit = await _read(err.requestOptions);
    if (hit == null) return handler.next(OfflineUnavailable(err.requestOptions));
    handler.resolve(hit);
  }

  Future<Response?> _read(RequestOptions o) async {
    try {
      final db = await AppDatabase.database;
      final rows = await db.query(
        'http_cache',
        where: 'scope = ? AND url = ?',
        whereArgs: [scope(), _key(o)],
        limit: 1,
      );
      if (rows.isEmpty) return null;
      return Response(
        requestOptions: o,
        statusCode: 200,
        data: jsonDecode(rows.first['body'] as String),
        extra: {'fromCache': true, 'fetchedAt': rows.first['fetched_at']},
      );
    } catch (_) {
      return null;
    }
  }
}

extension on RequestInterceptorHandler {
  void resolveOrReject(Response? hit, RequestOptions o) =>
      hit != null ? resolve(hit) : reject(OfflineUnavailable(o));
}
