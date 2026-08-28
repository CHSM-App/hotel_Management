import 'json.dart';

/// What POST /auth/login hands back.
///
/// One token, no refresh — see TokenInterceptor. `mustResetPassword` is set
/// when the account was created with a temporary password and the desk has to
/// change it before doing anything else.
class Session {
  final String token;
  final String role;
  final String? name;
  final int? lodgeId;
  final bool mustResetPassword;

  const Session({
    required this.token,
    required this.role,
    this.name,
    this.lodgeId,
    this.mustResetPassword = false,
  });

  factory Session.fromJson(Map<String, dynamic> json) => Session(
    token: json['token']?.toString() ?? '',
    role: json['role']?.toString() ?? '',
    name: asStringOrNull(json['name']),
    // lodges.id is a BIGINT, so this arrives as "1" rather than 1. Casting it
    // to num threw on a login that had already succeeded — see json.dart.
    lodgeId: asIntOrNull(json['lodgeId']),
    mustResetPassword: asBool(json['mustResetPassword']),
  );
}

/// The credentials POST /auth/login takes. `identifier` is an email or a phone
/// number — the server matches either, so the field is deliberately not called
/// "email".
class Credentials {
  final String identifier;
  final String password;

  const Credentials({required this.identifier, required this.password});

  Map<String, dynamic> toJson() => {
    'identifier': identifier,
    'password': password,
  };
}
