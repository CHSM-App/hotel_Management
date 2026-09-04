import 'package:dio/dio.dart';

import '../../domain/models/category.dart';
import '../../domain/models/room.dart';
import '../../domain/models/season.dart';
import '../../domain/models/switchable_charge_listing.dart';
import '../../domain/repository/rooms_repo.dart';
import '../api/api_service.dart';

class RoomsImpl implements RoomsRepository {
  final ApiService api;

  RoomsImpl(this.api);

  @override
  Future<List<RoomListing>> rooms() => api.rooms();

  @override
  Future<void> createRoom(FormData form) => api.createRoom(form);

  @override
  Future<void> updateRoom(int id, FormData form) => api.updateRoom(id, form);

  @override
  Future<void> setRoomActive(int id, bool isActive) => api.setRoomActive(id, isActive);

  @override
  Future<void> deleteRoom(int id) => api.deleteRoom(id);

  @override
  Future<void> deleteRoomImage(int roomId, int imageId) => api.deleteRoomImage(roomId, imageId);

  @override
  Future<List<RoomCategory>> categories() => api.categories();

  @override
  Future<void> createCategory({required String name, required num basePrice}) =>
      api.createCategory(name: name, basePrice: basePrice);

  @override
  Future<void> updateCategory(int id, {required String name, required num basePrice}) =>
      api.updateCategory(id, name: name, basePrice: basePrice);

  @override
  Future<void> setCategoryActive(int id, bool isActive) => api.setCategoryActive(id, isActive);

  @override
  Future<void> deleteCategory(int id) => api.deleteCategory(id);

  @override
  Future<List<SwitchableChargeListing>> switchableCharges() => api.switchableCharges();

  @override
  Future<void> createSwitchableCharge({required String name, required num chargePerNight}) =>
      api.createSwitchableCharge(name: name, chargePerNight: chargePerNight);

  @override
  Future<void> updateSwitchableCharge(int id, {required String name, required num chargePerNight}) =>
      api.updateSwitchableCharge(id, name: name, chargePerNight: chargePerNight);

  @override
  Future<void> setSwitchableChargeActive(int id, bool isActive) =>
      api.setSwitchableChargeActive(id, isActive);

  @override
  Future<void> deleteSwitchableCharge(int id) => api.deleteSwitchableCharge(id);

  @override
  Future<List<Season>> seasons() => api.seasons();

  @override
  Future<void> createSeason({
    required String name,
    required String startDate,
    required String endDate,
    required num adjustmentPercent,
  }) => api.createSeason(
    name: name,
    startDate: startDate,
    endDate: endDate,
    adjustmentPercent: adjustmentPercent,
  );

  @override
  Future<void> updateSeason(
    int id, {
    required String name,
    required String startDate,
    required String endDate,
    required num adjustmentPercent,
  }) => api.updateSeason(
    id,
    name: name,
    startDate: startDate,
    endDate: endDate,
    adjustmentPercent: adjustmentPercent,
  );

  @override
  Future<void> deleteSeason(int id) => api.deleteSeason(id);
}
