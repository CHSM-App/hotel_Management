library;

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/category.dart';
import '../../domain/models/room.dart';
import '../../domain/models/season.dart';
import '../../domain/models/switchable_charge_listing.dart';
import '../../domain/usecase/rooms_usecase.dart';

/// Rooms & rates: the same four sections the web dashboard's "Rooms & rates"
/// page carries — rooms, categories, booking extras and seasons — loaded
/// together because the room form needs categories and charges before it can
/// offer either.
class RoomsState {
  final bool isLoading;
  final String? error;
  final List<RoomListing> rooms;
  final List<RoomCategory> categories;
  final List<SwitchableChargeListing> switchableCharges;
  final List<Season> seasons;
  final bool submitting;

  const RoomsState({
    this.isLoading = false,
    this.error,
    this.rooms = const [],
    this.categories = const [],
    this.switchableCharges = const [],
    this.seasons = const [],
    this.submitting = false,
  });

  RoomsState copyWith({
    bool? isLoading,
    String? error,
    bool clearError = false,
    List<RoomListing>? rooms,
    List<RoomCategory>? categories,
    List<SwitchableChargeListing>? switchableCharges,
    List<Season>? seasons,
    bool? submitting,
  }) => RoomsState(
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : (error ?? this.error),
    rooms: rooms ?? this.rooms,
    categories: categories ?? this.categories,
    switchableCharges: switchableCharges ?? this.switchableCharges,
    seasons: seasons ?? this.seasons,
    submitting: submitting ?? this.submitting,
  );
}

class RoomsViewModel extends StateNotifier<RoomsState> {
  final RoomsUsecase usecase;

  RoomsViewModel(this.usecase) : super(const RoomsState());

  Future<void> loadAll() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final results = await Future.wait([
        usecase.rooms(),
        usecase.categories(),
        usecase.switchableCharges(),
        usecase.seasons(),
      ]);
      state = state.copyWith(
        isLoading: false,
        rooms: results[0] as List<RoomListing>,
        categories: results[1] as List<RoomCategory>,
        switchableCharges: results[2] as List<SwitchableChargeListing>,
        seasons: results[3] as List<Season>,
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: messageFor(e));
    }
  }

  // ── Rooms ─────────────────────────────────────────────────────────────────

  Future<bool> saveRoom(FormData form, {int? roomId}) async {
    if (state.submitting) return false;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (roomId != null) {
        await usecase.updateRoom(roomId, form);
      } else {
        await usecase.createRoom(form);
      }
      state = state.copyWith(submitting: false);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: messageFor(e));
      return false;
    }
  }

  Future<bool> setRoomActive(int id, bool isActive) async {
    try {
      await usecase.setRoomActive(id, isActive);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(error: messageFor(e));
      return false;
    }
  }

  Future<bool> deleteRoom(int id) async {
    try {
      await usecase.deleteRoom(id);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(error: messageFor(e));
      return false;
    }
  }

  Future<bool> deleteRoomImage(int roomId, int imageId) async {
    try {
      await usecase.deleteRoomImage(roomId, imageId);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(error: messageFor(e));
      return false;
    }
  }

  // ── Categories ────────────────────────────────────────────────────────────

  Future<bool> saveCategory({int? id, required String name, required num basePrice}) async {
    if (state.submitting) return false;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateCategory(id, name: name, basePrice: basePrice);
      } else {
        await usecase.createCategory(name: name, basePrice: basePrice);
      }
      state = state.copyWith(submitting: false);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: messageFor(e));
      return false;
    }
  }

  Future<bool> setCategoryActive(int id, bool isActive) async {
    try {
      await usecase.setCategoryActive(id, isActive);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(error: messageFor(e));
      return false;
    }
  }

  Future<bool> deleteCategory(int id) async {
    try {
      await usecase.deleteCategory(id);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(error: messageFor(e));
      return false;
    }
  }

  // ── Booking extras ───────────────────────────────────────────────────────

  Future<bool> saveSwitchableCharge({
    int? id,
    required String name,
    required num chargePerNight,
  }) async {
    if (state.submitting) return false;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateSwitchableCharge(id, name: name, chargePerNight: chargePerNight);
      } else {
        await usecase.createSwitchableCharge(name: name, chargePerNight: chargePerNight);
      }
      state = state.copyWith(submitting: false);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: messageFor(e));
      return false;
    }
  }

  Future<bool> setSwitchableChargeActive(int id, bool isActive) async {
    try {
      await usecase.setSwitchableChargeActive(id, isActive);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(error: messageFor(e));
      return false;
    }
  }

  Future<bool> deleteSwitchableCharge(int id) async {
    try {
      await usecase.deleteSwitchableCharge(id);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(error: messageFor(e));
      return false;
    }
  }

  // ── Seasons ───────────────────────────────────────────────────────────────

  Future<bool> saveSeason({
    int? id,
    required String name,
    required String startDate,
    required String endDate,
    required num adjustmentPercent,
  }) async {
    if (state.submitting) return false;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateSeason(
          id,
          name: name,
          startDate: startDate,
          endDate: endDate,
          adjustmentPercent: adjustmentPercent,
        );
      } else {
        await usecase.createSeason(
          name: name,
          startDate: startDate,
          endDate: endDate,
          adjustmentPercent: adjustmentPercent,
        );
      }
      state = state.copyWith(submitting: false);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: messageFor(e));
      return false;
    }
  }

  Future<bool> deleteSeason(int id) async {
    try {
      await usecase.deleteSeason(id);
      await loadAll();
      return true;
    } catch (e) {
      state = state.copyWith(error: messageFor(e));
      return false;
    }
  }

  /// The server's own words where it sent any.
  static String messageFor(Object e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map && data['message'] is String) return data['message'];
      switch (e.type) {
        case DioExceptionType.connectionTimeout:
        case DioExceptionType.sendTimeout:
        case DioExceptionType.receiveTimeout:
          return 'The server took too long to answer.';
        case DioExceptionType.connectionError:
          return 'Cannot reach the server. Check the wifi and try again.';
        default:
          return 'Something went wrong. Try again.';
      }
    }
    return 'Something went wrong. Try again.';
  }
}
