import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../view_models/auth_viewmodel.dart';
import '../view_models/booking_viewmodel.dart';
import '../view_models/billing_viewmodel.dart';
import 'usecase_provider.dart';

/// usecase → viewModel.
///
/// The only providers screens import. A screen that reaches past these into a
/// repository or an api service has broken the layering.
final authViewModelProvider =
    StateNotifierProvider<AuthViewModel, AuthState>(
      (ref) => AuthViewModel(ref.watch(authUsecaseProvider), ref),
    );

final bookingViewModelProvider =
    StateNotifierProvider<BookingViewModel, BookingState>(
      (ref) => BookingViewModel(ref.watch(bookingUsecaseProvider)),
    );

final billingViewModelProvider =
    StateNotifierProvider<BillingViewModel, BillingState>(
      (ref) => BillingViewModel(ref.watch(billingUsecaseProvider)),
    );
