import '../models/me.dart';
import '../models/session.dart';
import '../repository/auth_repo.dart';

class AuthUsecase {
  final AuthRepository repository;

  AuthUsecase(this.repository);

  /// Sign in with an email or phone number and a password.
  Future<Session> login(String identifier, String password) =>
      repository.login(
        Credentials(identifier: identifier.trim(), password: password),
      );

  /// Who is signed in, and what this property is.
  Future<Me> me() => repository.me();
}
