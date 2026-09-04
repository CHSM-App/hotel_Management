import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../view_models/auth_viewmodel.dart';
import '../view_models/booking_viewmodel.dart';
import '../view_models/billing_viewmodel.dart';
import '../view_models/orders_viewmodel.dart';
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

/// The kitchen queue.
///
/// autoDispose because it owns a polling timer: left alive after the desk
/// moves to another section it would keep asking the server for tickets
/// nobody is looking at, on a device that is usually on mobile data.
final ordersViewModelProvider =
    StateNotifierProvider.autoDispose<OrdersViewModel, OrdersState>(
      (ref) => OrdersViewModel(ref.watch(ordersUsecaseProvider)),
    );
