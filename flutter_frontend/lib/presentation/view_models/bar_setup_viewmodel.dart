library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/bar.dart';
import '../../domain/usecase/bar_usecase.dart';

/// Bar menu, stock and settings — the managing side of the bar.
class BarSetupState {
  final bool isLoading;
  final bool submitting;
  final String? error;
  final BarMenu menu;

  const BarSetupState({
    this.isLoading = false,
    this.submitting = false,
    this.error,
    this.menu = const BarMenu(),
  });

  BarSetupState copyWith({
    bool? isLoading,
    bool? submitting,
    String? error,
    bool clearError = false,
    BarMenu? menu,
  }) => BarSetupState(
    isLoading: isLoading ?? this.isLoading,
    submitting: submitting ?? this.submitting,
    error: clearError ? null : (error ?? this.error),
    menu: menu ?? this.menu,
  );

  int get lowCount => menu.products.where((p) => p.isActive && p.isLow).length;
}

class BarSetupViewModel extends StateNotifier<BarSetupState> {
  final BarUsecase usecase;

  BarSetupViewModel(this.usecase) : super(const BarSetupState());

  Future<void> load() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      state = state.copyWith(isLoading: false, menu: await usecase.menu());
    } catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
    }
  }

  Future<bool> _run(Future<void> Function() action) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await action();
      state = state.copyWith(submitting: false, menu: await usecase.menu());
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> saveCategory(String name, {int? id, bool? isActive}) =>
      _run(() => usecase.saveCategory(id, {'name': name.trim(), if (isActive != null) 'isActive': isActive}));

  Future<bool> deleteCategory(int id) => _run(() => usecase.deleteCategory(id));

  Future<bool> createProduct(Map<String, dynamic> body) => _run(() => usecase.createProduct(body));

  Future<bool> updateProduct(int id, Map<String, dynamic> body) => _run(() => usecase.updateProduct(id, body));

  Future<bool> addSize(int productId, Map<String, dynamic> body) => _run(() => usecase.addSize(productId, body));

  Future<bool> updateSize(int sizeId, Map<String, dynamic> body) => _run(() => usecase.updateSize(sizeId, body));

  Future<bool> adjustStock(int productId, Map<String, dynamic> body) =>
      _run(() => usecase.adjustStock(productId, body));

  Future<List<BarMovement>> movements(int productId) async {
    try {
      return await usecase.movements(productId);
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return const [];
    }
  }

  /// Tax % and default alert limit. The tax also lives on the lodge, so the
  /// caller refreshes Me after a save.
  Future<bool> saveSettings({double? taxPercent, int? defaultLowStockMl}) => _run(
    () => usecase.updateSettings({
      if (taxPercent != null) 'taxPercent': taxPercent,
      'defaultLowStockMl': defaultLowStockMl,
    }),
  );
}
