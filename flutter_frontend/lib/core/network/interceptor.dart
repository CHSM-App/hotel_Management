import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'token_provider.dart';

/// Attaches the session to every request, and drops it when the server stops
/// accepting it.
///
/// This is deliberately much smaller than the blueprint's version, because the
/// backend it talks to is different: it issues a single JWT good for eight
/// hours (auth.service.js) and has no refresh endpoint. There is nothing to
/// refresh, so the whole refresh/retry/mutex apparatus — and the recursion and
/// concurrent-refresh bugs the blueprint warns about in §14.3 — does not exist
/// here. Copying it would have meant writing a retry loop against an endpoint
/// that isn't there.
///
/// What is left is the one thing that still matters: an expired session must
/// not leave the desk staring at screens that will never load.
class TokenInterceptor extends Interceptor {
  final Ref ref;

  TokenInterceptor({required this.ref});

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final token = ref.read(tokenProvider).token;
    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
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
