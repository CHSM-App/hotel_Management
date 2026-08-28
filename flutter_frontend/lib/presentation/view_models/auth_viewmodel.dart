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

  /// The server's own words where it sent any, because it says the useful
  /// thing — "That account is locked for 15 minutes" is worth far more to the
  /// desk than "Request failed with status code 429".
  String _message(Object e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map && data['message'] is String) return data['message'];
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
