import '../models/me.dart';
import '../models/session.dart';

abstract class AuthRepository {
  Future<Session> login(Credentials credentials);
  Future<Me> me();
}
