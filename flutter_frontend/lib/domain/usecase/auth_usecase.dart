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

  /// No OTP — resets the password for whoever's phone or email is given.
  Future<void> forgotPassword({
    required String identifier,
    required String newPassword,
  }) => repository.forgotPassword(
    identifier: identifier.trim(),
    newPassword: newPassword,
  );

  /// Who is signed in, and what this property is.
  Future<Me> me() => repository.me();

  /// Step 1 of a password change: verify the current password and send an
  /// OTP to the account's phone.
  Future<Map<String, dynamic>> sendPasswordOtp(String currentPassword) =>
      repository.sendPasswordOtp(currentPassword);

  /// Step 2: apply the change with the code just received.
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
    required String otp,
  }) => repository.changePassword(
    currentPassword: currentPassword,
    newPassword: newPassword,
    otp: otp,
  );

  /// Owner-only: edit the property's own details.
  Future<Me> updateMyLodge(Map<String, dynamic> body) =>
      repository.updateMyLodge(body);
}
