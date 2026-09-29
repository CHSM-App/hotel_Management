import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../constant.dart';
import 'jwt.dart';
import 'token_provider.dart';

/// Attaches the session to every request, silently renews it before the
/// 8-hour token expires, and drops it when the server stops accepting it.
///
/// Simpler than the blueprint's version: the backend issues a single JWT
/// (auth.service.js) and POST /auth/refresh just trades a still-valid one for
/// a fresh one — there is no separate refresh token, no rotation, and nothing
/// to retry a failed request with. So there is no mutex-protected
/// retry-the-original-request dance here, only "renew ahead of expiry, and let
/// a token that slips past that anyway hit the existing 401 handling below."
class TokenInterceptor extends Interceptor {
  final Ref ref;

  TokenInterceptor({required this.ref});

  // How far ahead of expiry a request triggers a renewal. Comfortably wider
  // than any single request takes, so the app is never mid-request when the
  // token it just attached expires.
  static const _renewBefore = Duration(minutes: 30);

  // Bare Dio, no interceptors: routing the renewal call through the same
  // client that carries this interceptor would re-enter onRequest for every
  // renewal, for no benefit — the renewal doesn't need this interceptor to do
  // anything TokenInterceptor itself doesn't already know to do.
  final Dio _refreshDio = Dio(BaseOptions(baseUrl: baseUrl));
  bool _refreshing = false;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final token = ref.read(tokenProvider).token;
    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
      _maybeRenew(token);
    }
    handler.next(options);
  }

  /// Fires a background renewal when the current token is close to expiring.
  /// Fire-and-forget: the request this token was just attached to goes out
  /// regardless, since the token is still valid right now.
  void _maybeRenew(String token) {
    if (_refreshing) return;

    final expiry = jwtExpiry(token);
    if (expiry == null) return;

    final now = DateTime.now();
    // Already past expiry: too late for a renewal to help — the request about
    // to go out will 401, and the handler below signs out as usual.
    if (now.isAfter(expiry)) return;
    if (now.isBefore(expiry.subtract(_renewBefore))) return;

    _refreshing = true;
    _refreshDio
        .post(
          '/auth/refresh',
          options: Options(headers: {'Authorization': 'Bearer $token'}),
        )
        .then((res) {
          final newToken = (res.data as Map)['token']?.toString();
          if (newToken != null && newToken.isNotEmpty) {
            ref.read(tokenProvider.notifier).updateToken(newToken);
          }
        })
        // A failed renewal isn't fatal: the current token still works until it
        // actually expires, and this same check runs again on the next request.
        .catchError((_) {})
        .whenComplete(() => _refreshing = false);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode != 401) return handler.next(err);

    // Not every 401 is an expired session, and the difference matters:
    //
    //   /auth   — signing in with the wrong password is a 401, and belongs on
    //             the login form as an error. Clearing the session here would
    //             be answering a failed sign-in by signing the user out.
    //   /public — a guest mistyping the food PIN from their check-in slip is
    //             also a 401, and they have no staff session to lose.
    //
    // The web client draws exactly this line (lib/api.js), and the two have to
    // agree or the same request behaves differently on phone and desk.
    final path = err.requestOptions.path;
    if (path.startsWith('/auth') || path.startsWith('/public')) {
      return handler.next(err);
    }

    // Nothing to have expired.
    if (!ref.read(tokenProvider).isLoggedIn) return handler.next(err);

    // Cleared, not navigated. The app shell watches tokenProvider and shows the
    // login screen the moment the session goes, so there is no global navigator
    // key and no BuildContext needed down here — the blueprint recommends this
    // over its own navigatorKey approach in §15.6.
    await ref.read(tokenProvider.notifier).clearSession();
    return handler.next(err);
  }
}
