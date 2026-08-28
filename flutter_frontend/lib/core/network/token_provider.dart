import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../storage/token_storage.dart';

/// The session, in memory.
///
/// Secure storage is the source of truth on disk; this is the synchronous read
/// cache the interceptor uses, because an interceptor cannot await storage on
/// every request.
class TokenState {
  final String? token;
  final String? role;
  final String? name;
  final int? lodgeId;

  /// True until the first hydrate finishes, so the splash gate can tell
  /// "not signed in" apart from "not looked yet" — routing on the second as
  /// though it were the first bounces a signed-in user to the login screen.
  final bool isLoading;

  const TokenState({
    this.token,
    this.role,
    this.name,
    this.lodgeId,
    this.isLoading = true,
  });

  /// Both halves present and non-empty. Written out rather than as `!= null`
  /// checks: an empty string is not a session, and the blueprint's version of
  /// this getter let one through (§14.4).
  bool get isLoggedIn =>
      (token?.isNotEmpty ?? false) && (role?.isNotEmpty ?? false);

  TokenState copyWith({
    String? token,
    String? role,
    String? name,
    int? lodgeId,
    bool? isLoading,
    bool clearSession = false,
  }) {
    if (clearSession) {
      return const TokenState(isLoading: false);
    }
    return TokenState(
      token: token ?? this.token,
      role: role ?? this.role,
      name: name ?? this.name,
      lodgeId: lodgeId ?? this.lodgeId,
      isLoading: isLoading ?? this.isLoading,
    );
  }
}

class TokenNotifier extends StateNotifier<TokenState> {
  TokenNotifier() : super(const TokenState());

  /// Read the session back off disk at boot.
  Future<void> loadSession() async {
    final stored = await TokenStorage.getSession();
    if (stored == null) {
      state = const TokenState(isLoading: false);
      return;
    }
    final name = await TokenStorage.getValue('NAME');
    final lodgeId = await TokenStorage.getValue('LODGE_ID');
    state = TokenState(
      token: stored['token'],
      role: stored['role'],
      name: name,
      lodgeId: lodgeId == null ? null : int.tryParse(lodgeId),
      isLoading: false,
    );
  }

  /// Keep the session that /auth/login just handed back.
  Future<void> saveSession({
    required String token,
    required String role,
    String? name,
    int? lodgeId,
  }) async {
    await TokenStorage.saveSession(token, role);
    if (name != null) await TokenStorage.saveValue('NAME', name);
    if (lodgeId != null) {
      await TokenStorage.saveValue('LODGE_ID', lodgeId.toString());
    }
    state = TokenState(
      token: token,
      role: role,
      name: name,
      lodgeId: lodgeId,
      isLoading: false,
    );
  }

  /// Sign out, or a session the server has stopped accepting.
  Future<void> clearSession() async {
    await TokenStorage.clear();
    state = state.copyWith(clearSession: true);
  }
}

final tokenProvider = StateNotifierProvider<TokenNotifier, TokenState>(
  (ref) => TokenNotifier(),
);
