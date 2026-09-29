import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/api_service.dart';
import '../constant.dart';
import 'interceptor.dart';

/// A plain Provider, not a FutureProvider.
///
/// Nothing in this setup is asynchronous, so the blueprint's `FutureProvider` +
/// `.value!` at every call site bought nothing but a force-unwrap that could
/// throw (§15.1). The bare second Dio the blueprint used to avoid a token
/// refresh recursing through its own interceptor still exists — it just lives
/// inside TokenInterceptor itself now, since nothing outside it needs one.
final dioProvider = Provider<Dio>((ref) {
  final dio = Dio(
    BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 30),
      receiveTimeout: const Duration(seconds: 30),
      sendTimeout: const Duration(seconds: 30),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    ),
  );

  // Debug only. This prints Authorization headers and full bodies, which is
  // fine on a developer's machine and is a credential leak in a release build
  // (§14.8).
  if (kDebugMode) {
    dio.interceptors.add(LogInterceptor(requestBody: true, responseBody: true));
  }

  dio.interceptors.add(TokenInterceptor(ref: ref));
  return dio;
});

final apiServiceProvider = Provider<ApiService>(
  (ref) => ApiService(ref.watch(dioProvider)),
);
