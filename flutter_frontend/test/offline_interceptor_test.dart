import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/core/offline/offline_interceptor.dart';
import 'package:hotel_manager/data/db/app_database.dart';

/// Answers from a script; throws like a dead network when [up] is false.
class _Net implements HttpClientAdapter {
  bool up = true;
  int calls = 0;
  int status = 200;
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<List<int>>? s, Future<void>? c) async {
    calls++;
    if (!up) throw DioException(requestOptions: o, type: DioExceptionType.connectionError);
    return ResponseBody.fromString('{"ok":true}', status,
        headers: {Headers.contentTypeHeader: ['application/json']});
  }
  @override
  void close({bool force = false}) {}
}

void main() {
  late Dio dio;
  late _Net net;
  bool offline = false;

  setUpAll(() {
    AppDatabase.pathOverride =
        '${Directory.systemTemp.createTempSync('fd_oi').path}/t.db';
    AppDatabase.init();
  });

  setUp(() async {
    await AppDatabase.clearCache();
    offline = false;
    net = _Net();
    dio = Dio(BaseOptions(baseUrl: 'http://x'))
      ..httpClientAdapter = net
      ..interceptors.add(OfflineInterceptor(isOffline: () => offline, scope: () => '1'));
  });

  test('a GET seen online is served when offline, without touching the network', () async {
    await dio.get('/rooms');
    offline = true;
    net.calls = 0;
    final r = await dio.get('/rooms');
    expect(r.data, {'ok': true});
    expect(r.extra['fromCache'], true);
    expect(net.calls, 0);
  });

  test('a transport failure falls back to the cache', () async {
    await dio.get('/rooms');
    net.up = false;
    expect((await dio.get('/rooms')).data, {'ok': true});
  });

  test('an unseen GET offline fails calmly, not with a raw error', () async {
    offline = true;
    expect(dio.get('/never-seen'), throwsA(isA<OfflineUnavailable>()));
  });

  test('a write offline is refused with OfflineUnavailable and never sent', () async {
    offline = true;
    await expectLater(dio.post('/bookings'), throwsA(isA<OfflineUnavailable>()));
    expect(net.calls, 0);
  });

  test('a 4xx is never cached or masked', () async {
    net.status = 409;
    await expectLater(dio.get('/rooms'), throwsA(isA<DioException>()));
    offline = true;
    expect(dio.get('/rooms'), throwsA(isA<OfflineUnavailable>()));
  });

  test('another lodge never sees this lodge\'s cache', () async {
    await dio.get('/rooms');
    offline = true;
    final other = Dio(BaseOptions(baseUrl: 'http://x'))
      ..httpClientAdapter = net
      ..interceptors.add(OfflineInterceptor(isOffline: () => true, scope: () => '2'));
    expect(other.get('/rooms'), throwsA(isA<OfflineUnavailable>()));
  });
}
