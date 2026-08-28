import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/dio_provider.dart';
import '../../data/repositories/auth_impl.dart';
import '../../data/repositories/booking_impl.dart';
import '../../data/repositories/billing_impl.dart';
import '../../domain/repository/auth_repo.dart';
import '../../domain/repository/booking_repo.dart';
import '../../domain/repository/billing_repo.dart';

/// api → repository.
///
/// The one place the concrete data/ layer is bound to a domain contract.
/// Nothing above domain/ imports data/, which is what keeps the dependency
/// direction the blueprint insists on.
///
/// Every repository shares one ApiService rather than building its own, which
/// the blueprint lists as a defect in the project it came from (§14.10).
final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthImpl(ref.watch(apiServiceProvider)),
);

final bookingRepositoryProvider = Provider<BookingRepository>(
  (ref) => BookingImpl(ref.watch(apiServiceProvider)),
);

final billingRepositoryProvider = Provider<BillingRepository>(
  (ref) => BillingImpl(ref.watch(apiServiceProvider)),
);
