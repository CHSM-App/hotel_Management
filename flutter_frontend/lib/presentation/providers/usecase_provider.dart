import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/usecase/assets_usecase.dart';
import '../../domain/usecase/auth_usecase.dart';
import '../../domain/usecase/booking_usecase.dart';
import '../../domain/usecase/billing_usecase.dart';
import '../../domain/usecase/events_usecase.dart';
import '../../domain/usecase/expenses_usecase.dart';
import '../../domain/usecase/food_setup_usecase.dart';
import '../../domain/usecase/orders_usecase.dart';
import '../../domain/usecase/reports_usecase.dart';
import '../../domain/usecase/rooms_usecase.dart';
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

final ordersUsecaseProvider = Provider<OrdersUsecase>(
  (ref) => OrdersUsecase(ref.watch(ordersRepositoryProvider)),
);

final roomsUsecaseProvider = Provider<RoomsUsecase>(
  (ref) => RoomsUsecase(ref.watch(roomsRepositoryProvider)),
);

final reportsUsecaseProvider = Provider<ReportsUsecase>(
  (ref) => ReportsUsecase(ref.watch(reportsRepositoryProvider)),
);

final foodSetupUsecaseProvider = Provider<FoodSetupUsecase>(
  (ref) => FoodSetupUsecase(ref.watch(foodSetupRepositoryProvider)),
);

final eventsUsecaseProvider = Provider<EventsUsecase>(
  (ref) => EventsUsecase(ref.watch(eventsRepositoryProvider)),
);

final assetsUsecaseProvider = Provider<AssetsUsecase>(
  (ref) => AssetsUsecase(ref.watch(assetsRepositoryProvider)),
);

final expensesUsecaseProvider = Provider<ExpensesUsecase>(
  (ref) => ExpensesUsecase(ref.watch(expensesRepositoryProvider)),
);
