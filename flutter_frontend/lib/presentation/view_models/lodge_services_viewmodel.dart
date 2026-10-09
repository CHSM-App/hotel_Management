library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/invoice.dart' show InHouseGuest;
import '../../domain/models/lodge_service.dart';
import '../../domain/usecase/lodge_services_usecase.dart';

/// Other services — the catalogue and its usage log in one notifier, the
/// way ServicesPanel.jsx keeps both views' state in one component.
class LodgeServicesState {
  final bool isLoadingServices;
  final bool isLoadingUsages;
  final String? error;
  final List<LodgeService> services;
  final List<ServiceUsage> usages;
  final List<InHouseGuest> inHouseGuests;
  final bool submitting;

  const LodgeServicesState({
    this.isLoadingServices = false,
    this.isLoadingUsages = false,
    this.error,
    this.services = const [],
    this.usages = const [],
    this.inHouseGuests = const [],
    this.submitting = false,
  });

  LodgeServicesState copyWith({
    bool? isLoadingServices,
    bool? isLoadingUsages,
    String? error,
    bool clearError = false,
    List<LodgeService>? services,
    List<ServiceUsage>? usages,
    List<InHouseGuest>? inHouseGuests,
    bool? submitting,
  }) => LodgeServicesState(
    isLoadingServices: isLoadingServices ?? this.isLoadingServices,
    isLoadingUsages: isLoadingUsages ?? this.isLoadingUsages,
    error: clearError ? null : (error ?? this.error),
    services: services ?? this.services,
    usages: usages ?? this.usages,
    inHouseGuests: inHouseGuests ?? this.inHouseGuests,
    submitting: submitting ?? this.submitting,
  );

  List<LodgeService> get activeServices => services.where((s) => s.isActive).toList();
}

class LodgeServicesViewModel extends StateNotifier<LodgeServicesState> {
  final LodgeServicesUsecase usecase;

  LodgeServicesViewModel(this.usecase) : super(const LodgeServicesState());

  Future<void> loadServices() async {
    state = state.copyWith(isLoadingServices: true, clearError: true);
    try {
      final services = await usecase.services(includeInactive: true);
      state = state.copyWith(isLoadingServices: false, services: services);
    } catch (e) {
      state = state.copyWith(isLoadingServices: false, error: apiErrorMessage(e));
    }
  }

  Future<void> loadUsages() async {
    state = state.copyWith(isLoadingUsages: true, clearError: true);
    try {
      final usages = await usecase.usages(status: 'all');
      state = state.copyWith(isLoadingUsages: false, usages: usages);
    } catch (e) {
      state = state.copyWith(isLoadingUsages: false, error: apiErrorMessage(e));
    }
  }

  Future<void> loadInHouseGuests() async {
    try {
      state = state.copyWith(inHouseGuests: await usecase.inHouseGuests());
    } catch (_) {
      // A convenience for the "Start a service" form; a walk-in still works.
    }
  }

  Future<bool> saveService(dynamic body, {int? id}) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateService(id, body);
      } else {
        await usecase.createService(body);
      }
      state = state.copyWith(submitting: false);
      await loadServices();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> toggleActive(LodgeService service) async {
    try {
      await usecase.updateService(service.id, {'isActive': !service.isActive});
      await loadServices();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> startUsage(Map<String, dynamic> body) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await usecase.startUsage(body);
      state = state.copyWith(submitting: false);
      await loadUsages();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> completeUsage(int id) async {
    try {
      await usecase.completeUsage(id);
      await loadUsages();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> cancelUsage(int id) async {
    try {
      await usecase.cancelUsage(id);
      await loadUsages();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  void clearError() => state = state.copyWith(clearError: true);
}
