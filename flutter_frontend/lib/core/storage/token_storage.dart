import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The session on disk.
///
/// A static wrapper over FlutterSecureStorage with fixed keys for the session
/// itself, plus a generic key/value escape hatch for the rest of what the
/// server hands back at login (name, lodge id) so it is available app-wide
/// without a network round trip.
///
/// Note there is no refresh token here, unlike the blueprint this project
/// follows: the backend issues one JWT good for eight hours and has no refresh
/// endpoint at all. See TokenInterceptor for what that means on a 401.
class TokenStorage {
  static const _tokenKey = 'ACCESS_TOKEN';
  static const _roleKey = 'ROLE';

  static const FlutterSecureStorage _storage = FlutterSecureStorage();

  /// Save the session handed back by /auth/login.
  static Future<void> saveSession(String token, String role) async {
    await _storage.write(key: _tokenKey, value: token);
    await _storage.write(key: _roleKey, value: role);
  }

  /// The stored session, or null if either half is missing — a token with no
  /// role cannot be routed, and a role with no token cannot call anything.
  static Future<Map<String, String>?> getSession() async {
    final token = await _storage.read(key: _tokenKey);
    final role = await _storage.read(key: _roleKey);
    if (token == null || token.isEmpty || role == null || role.isEmpty) {
      return null;
    }
    return {'token': token, 'role': role};
  }

  /// Everything, on sign out. Nothing about a session outlives it.
  static Future<void> clear() => _storage.deleteAll();

  static Future<void> saveValue(String key, String value) =>
      _storage.write(key: key, value: value);

  static Future<String?> getValue(String key) => _storage.read(key: key);
}
