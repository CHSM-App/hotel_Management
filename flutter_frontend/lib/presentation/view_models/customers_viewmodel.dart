library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/customer.dart';
import '../../domain/usecase/customers_usecase.dart';

/// Customers this property has done business with — mirrors Customers.jsx:
/// one list+stats load, a search box and an opted-in checkbox filtering it
/// client-side, and a detail+history fetch per profile opened.
class CustomersState {
  final bool isLoading;
  final String? error;
  final String? errorField;
  final List<Customer> customers;
  final CustomersStats stats;
  final String search;
  final bool optedInOnly;
  final bool submitting;
  final CustomerDetail? selected;
  final bool detailLoading;

  const CustomersState({
    this.isLoading = false,
    this.error,
    this.errorField,
    this.customers = const [],
    this.stats = const CustomersStats(),
    this.search = '',
    this.optedInOnly = false,
    this.submitting = false,
    this.selected,
    this.detailLoading = false,
  });

  /// Same client-side match the web does: name/phone/email/tags contains the
  /// search text, case-insensitively, plus the opted-in checkbox.
  List<Customer> get filtered {
    final q = search.trim().toLowerCase();
    return customers.where((c) {
      if (optedInOnly && !c.marketingOptIn) return false;
      if (q.isEmpty) return true;
      return c.name.toLowerCase().contains(q) ||
          c.phone.toLowerCase().contains(q) ||
          (c.email ?? '').toLowerCase().contains(q) ||
          (c.tags ?? '').toLowerCase().contains(q);
    }).toList();
  }

  CustomersState copyWith({
    bool? isLoading,
    String? error,
    String? errorField,
    bool clearError = false,
    List<Customer>? customers,
    CustomersStats? stats,
    String? search,
    bool? optedInOnly,
    bool? submitting,
    CustomerDetail? selected,
    bool clearSelected = false,
    bool? detailLoading,
  }) => CustomersState(
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : (error ?? this.error),
    errorField: clearError ? null : (errorField ?? this.errorField),
    customers: customers ?? this.customers,
    stats: stats ?? this.stats,
    search: search ?? this.search,
    optedInOnly: optedInOnly ?? this.optedInOnly,
    submitting: submitting ?? this.submitting,
    selected: clearSelected ? null : (selected ?? this.selected),
    detailLoading: detailLoading ?? this.detailLoading,
  );
}

class CustomersViewModel extends StateNotifier<CustomersState> {
  final CustomersUsecase usecase;

  CustomersViewModel(this.usecase) : super(const CustomersState());

  Future<void> loadAll() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final result = await usecase.customers();
      state = state.copyWith(
        isLoading: false,
        customers: result.customers,
        stats: result.stats,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: apiErrorMessage(e),
        errorField: apiErrorField(e),
      );
    }
  }

  void setSearch(String value) => state = state.copyWith(search: value);

  void setOptedInOnly(bool value) => state = state.copyWith(optedInOnly: value);

  Future<void> loadDetail(int id) async {
    state = state.copyWith(detailLoading: true, clearSelected: true, clearError: true);
    try {
      final detail = await usecase.customer(id);
      state = state.copyWith(detailLoading: false, selected: detail);
    } catch (e) {
      state = state.copyWith(
        detailLoading: false,
        error: apiErrorMessage(e),
        errorField: apiErrorField(e),
      );
    }
  }

  Future<bool> saveCustomer(Map<String, dynamic> body, {int? id}) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateCustomer(id, body);
      } else {
        await usecase.createCustomer(body);
      }
      state = state.copyWith(submitting: false);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(
        submitting: false,
        error: apiErrorMessage(e),
        errorField: apiErrorField(e),
      );
      return false;
    }
  }

  void clearError() => state = state.copyWith(clearError: true);
}
