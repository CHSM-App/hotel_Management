import 'dart:convert';

/// The `exp` claim out of a JWT, or null if the token can't be read as one.
///
/// No signature check here — this app never decides trust based on it, only
/// how soon to ask the server for a fresh token. The server is the one that
/// actually verifies the token on every request.
DateTime? jwtExpiry(String token) {
  final parts = token.split('.');
  if (parts.length != 3) return null;

  try {
    final normalized = base64Url.normalize(parts[1]);
    final payload = jsonDecode(utf8.decode(base64Url.decode(normalized)));
    final exp = payload is Map ? payload['exp'] : null;
    if (exp is! int) return null;
    return DateTime.fromMillisecondsSinceEpoch(exp * 1000);
  } catch (_) {
    return null;
  }
}
