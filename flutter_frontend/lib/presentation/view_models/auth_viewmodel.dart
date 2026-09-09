import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/token_provider.dart';
import '../../domain/models/me.dart';
import '../../domain/usecase/auth_usecase.dart';

class AuthState {
  final bool isLoading;
  final String? error;
  final Me? me;

  const AuthState({this.isLoading = false, this.error, this.me});

  AuthState copyWith({
    bool? isLoading,
    String? error,
    Me? me,
    bool clearError = false,
  }) => AuthState(
    isLoading: isLoading ?? this.isLoading,
    // Explicit rather than `error ?? this.error`, which can never clear one —
    // the blueprint flags this exact trap (§15.3).
    error: clearError ? null : (error ?? this.error),
    me: me ?? this.me,
  );
}

class AuthViewModel extends StateNotifier<AuthState> {
  final AuthUsecase usecase;
  final Ref ref;

  AuthViewModel(this.usecase, this.ref) : super(const AuthState());

  /// Sign in, and keep the session.
  Future<bool> login(String identifier, String password) async {
    if (state.isLoading) return false;
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final session = await usecase.login(identifier, password);
      await ref
          .read(tokenProvider.notifier)
          .saveSession(
            token: session.token,
            role: session.role,
            name: session.name,
            lodgeId: session.lodgeId,
          );
      state = state.copyWith(isLoading: false);
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _message(e));
      return false;
    }
  }

  /// Reset a password with no OTP — the same door the web login's "Forgot
  /// password?" link uses. Throws with [_message] on failure so the form can
  /// show it inline — this does not touch [state].
  Future<void> forgotPassword({
    required String identifier,
    required String newPassword,
  }) async {
    try {
      await usecase.forgotPassword(identifier: identifier, newPassword: newPassword);
    } catch (e) {
      throw _message(e);
    }
  }

  /// Load who is signed in and what the property is.
  Future<void> loadMe() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final me = await usecase.me();
      state = state.copyWith(isLoading: false, me: me);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _message(e));
    }
  }

  Future<void> signOut() async {
    await ref.read(tokenProvider.notifier).clearSession();
    state = const AuthState();
  }

  /// Step 1 of a password change. Throws with [_message] on failure so the
  /// dialog can show it inline — this does not touch [state].
  Future<Map<String, dynamic>> sendPasswordOtp(String currentPassword) async {
    try {
      return await usecase.sendPasswordOtp(currentPassword);
    } catch (e) {
      throw _message(e);
    }
  }

  /// Step 2. Same error handling as [sendPasswordOtp].
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
    required String otp,
  }) async {
    try {
      await usecase.changePassword(
        currentPassword: currentPassword,
        newPassword: newPassword,
        otp: otp,
      );
    } catch (e) {
      throw _message(e);
    }
  }

  /// Owner-only edit of the property's own details. On success the lodge
  /// half of [state.me] is replaced with what the server saved.
  Future<void> updateMyLodge(Map<String, dynamic> body) async {
    try {
      final me = await usecase.updateMyLodge(body);
      state = state.copyWith(me: me);
    } catch (e) {
      throw _message(e);
    }
  }

  /// The server's own words where it sent any, because it says the useful
  /// thing — "That account is locked for 15 minutes" is worth far more to the
  /// desk than "Request failed with status code 429".
  String _message(Object e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map && data['message'] is String) return data['message'];
      if (data is Map && data['error'] is String) return data['error'];
      switch (e.type) {
        case DioExceptionType.connectionTimeout:
        case DioExceptionType.sendTimeout:
        case DioExceptionType.receiveTimeout:
          return 'The server took too long to answer.';
        case DioExceptionType.connectionError:
          return 'Cannot reach the server. Check the wifi and try again.';
        default:
          return 'Something went wrong. Try again.';
      }
    }
    return 'Something went wrong. Try again.';
  }
}
