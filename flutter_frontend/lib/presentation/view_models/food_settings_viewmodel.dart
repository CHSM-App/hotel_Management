library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/menu.dart';
import '../../domain/usecase/food_setup_usecase.dart';

/// Menu & QR codes > Settings — mirroring FoodSettingsPanel.jsx. Edits are
/// held locally until Save, same as the web: the three switches are a single
/// PATCH, not three independent toggles.
class FoodSettingsState {
  final bool isLoading;
  final String? error;
  final FoodSettings? settings;
  final bool saving;
  final bool saved;

  const FoodSettingsState({
    this.isLoading = false,
    this.error,
    this.settings,
    this.saving = false,
    this.saved = false,
  });

  FoodSettingsState copyWith({
    bool? isLoading,
    String? error,
    bool clearError = false,
    FoodSettings? settings,
    bool? saving,
    bool? saved,
  }) => FoodSettingsState(
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : (error ?? this.error),
    settings: settings ?? this.settings,
    saving: saving ?? this.saving,
    saved: saved ?? false,
  );
}

class FoodSettingsViewModel extends StateNotifier<FoodSettingsState> {
  final FoodSetupUsecase usecase;

  FoodSettingsViewModel(this.usecase) : super(const FoodSettingsState());

  Future<void> load() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final settings = await usecase.foodSettings();
      state = state.copyWith(isLoading: false, settings: settings);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
    }
  }

  /// Edits held on screen, not yet sent — see [save].
  void update({bool? servesFood, bool? foodRoomService, bool? foodTableService}) {
    final current = state.settings;
    if (current == null) return;
    state = state.copyWith(
      settings: current.copyWith(
        servesFood: servesFood,
        foodRoomService: foodRoomService,
        foodTableService: foodTableService,
      ),
      saved: false,
    );
  }

  /// Returns the saved settings so the caller can push them into [Me] (the
  /// bottom bar's own gate on the whole feature) without a second /me
  /// round-trip — same as FoodSettingsPanel.jsx's onSaved callback.
  Future<FoodSettings?> save() async {
    final pending = state.settings;
    if (pending == null || state.saving) return null;
    state = state.copyWith(saving: true, clearError: true);
    try {
      final saved = await usecase.updateFoodSettings(pending);
      state = state.copyWith(saving: false, settings: saved, saved: true);
      return saved;
    } catch (e) {
      state = state.copyWith(saving: false, error: apiErrorMessage(e));
      return null;
    }
  }
}
