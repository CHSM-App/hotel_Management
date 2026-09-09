import '../models/me.dart';
import '../models/session.dart';

abstract class AuthRepository {
  Future<Session> login(Credentials credentials);
  Future<void> forgotPassword({
    required String identifier,
    required String newPassword,
  });
  Future<Me> me();
  Future<Map<String, dynamic>> sendPasswordOtp(String currentPassword);
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
    required String otp,
  });
  Future<Me> updateMyLodge(Map<String, dynamic> body);
}
