import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../view_models/auth_viewmodel.dart';
import '../view_models/booking_viewmodel.dart';
import '../view_models/billing_viewmodel.dart';
import '../view_models/events_viewmodel.dart';
import '../view_models/food_settings_viewmodel.dart';
import '../view_models/inventory_viewmodel.dart';
import '../view_models/menu_viewmodel.dart';
import '../view_models/orders_viewmodel.dart';
import '../view_models/reports_viewmodel.dart';
import '../view_models/rooms_viewmodel.dart';
import '../view_models/tables_viewmodel.dart';
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

final roomsViewModelProvider =
    StateNotifierProvider<RoomsViewModel, RoomsState>(
      (ref) => RoomsViewModel(ref.watch(roomsUsecaseProvider)),
    );

/// autoDispose: an owner who leaves Reports should not keep four report
/// queries warm in memory for a section they may not reopen this session.
final reportsViewModelProvider =
    StateNotifierProvider.autoDispose<ReportsViewModel, ReportsState>(
      (ref) => ReportsViewModel(ref.watch(reportsUsecaseProvider)),
    );

/// Menu & QR codes. Four view models sharing one usecase, split the way the
/// web splits it into panels rather than one notifier growing four unrelated
/// shapes of state. All autoDispose: this whole section is behind "More" and
/// gated on servesFood, so a login that never opens it should never carry
/// four extra data sets in memory for the life of the app.
final menuViewModelProvider =
    StateNotifierProvider.autoDispose<MenuViewModel, MenuState>(
      (ref) => MenuViewModel(ref.watch(foodSetupUsecaseProvider)),
    );

final inventoryViewModelProvider =
    StateNotifierProvider.autoDispose<InventoryViewModel, InventoryState>(
      (ref) => InventoryViewModel(ref.watch(foodSetupUsecaseProvider)),
    );

final tablesViewModelProvider =
    StateNotifierProvider.autoDispose<TablesViewModel, TablesState>(
      (ref) => TablesViewModel(ref.watch(foodSetupUsecaseProvider)),
    );

final foodSettingsViewModelProvider =
    StateNotifierProvider.autoDispose<FoodSettingsViewModel, FoodSettingsState>(
      (ref) => FoodSettingsViewModel(ref.watch(foodSetupUsecaseProvider)),
    );

/// Events & functions. Behind "More" and gated on hasEvents, like Menu &
/// QR codes — autoDispose so a login that never opens it never keeps this
/// section's state warm.
final eventsViewModelProvider =
    StateNotifierProvider.autoDispose<EventsViewModel, EventsState>(
      (ref) => EventsViewModel(ref.watch(eventsUsecaseProvider)),
    );
