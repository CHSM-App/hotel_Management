import 'package:dio/dio.dart';

/// Turns any caught error into a message safe to show a user.
///
/// Prefers the server's own words when it sent any — "This room is already
/// booked for part of that date range" or "That account is locked for 15
/// minutes" is worth far more than "Request failed with status code 429" —
/// but never surfaces raw exception text (stack traces, type names, file
/// paths) for anything the backend didn't already sanitize itself.
String apiErrorMessage(Object e) {
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

/// The backend's own name for the field a validation/conflict error is
/// about (errorHandler.js sets `field` alongside `error` for exactly this),
/// e.g. "name" for "A vendor with that name already exists." Null for
/// errors that aren't about one field (a 500, a network failure, a plain
/// "Not allowed"). Forms use this to focus the exact field the error names
/// instead of leaving the user to re-read a banner with no idea where to
/// look.
String? apiErrorField(Object e) {
  if (e is DioException) {
    final data = e.response?.data;
    if (data is Map && data['field'] is String) return data['field'] as String;
  }
  return null;
}
