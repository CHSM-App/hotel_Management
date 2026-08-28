import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/usecase/auth_usecase.dart';
import '../../domain/usecase/booking_usecase.dart';
import '../../domain/usecase/billing_usecase.dart';
import 'repository_provider.dart';

/// repository → usecase.
final authUsecaseProvider = Provider<AuthUsecase>(
  (ref) => AuthUsecase(ref.watch(authRepositoryProvider)),
);

final bookingUsecaseProvider = Provider<BookingUsecase>(
  (ref) => BookingUsecase(ref.watch(bookingRepositoryProvider)),
);

final billingUsecaseProvider = Provider<BillingUsecase>(
  (ref) => BillingUsecase(ref.watch(billingRepositoryProvider)),
);
