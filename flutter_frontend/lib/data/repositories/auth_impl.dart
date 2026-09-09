import '../../domain/models/me.dart';
import '../../domain/models/session.dart';
import '../../domain/repository/auth_repo.dart';
import '../api/api_service.dart';

/// Pure-remote, so failures are rethrown for the ViewModel to surface. There is
/// no local mirror to fall back on: a stale copy of "who am I and what may I
/// reach" is worse than an error, because it would draw a menu of screens the
/// server will refuse.
class AuthImpl implements AuthRepository {
  final ApiService api;

  AuthImpl(this.api);

  @override
  Future<Session> login(Credentials credentials) => api.login(credentials);

  @override
  Future<void> forgotPassword({
    required String identifier,
    required String newPassword,
  }) => api.forgotPassword(identifier: identifier, newPassword: newPassword);

  @override
  Future<Me> me() => api.me();

  @override
  Future<Map<String, dynamic>> sendPasswordOtp(String currentPassword) =>
      api.sendPasswordOtp(currentPassword);

  @override
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
    required String otp,
  }) => api.changePassword(
    currentPassword: currentPassword,
    newPassword: newPassword,
    otp: otp,
  );

  @override
  Future<Me> updateMyLodge(Map<String, dynamic> body) => api.updateMyLodge(body);
}
