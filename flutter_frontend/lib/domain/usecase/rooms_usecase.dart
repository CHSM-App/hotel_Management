import 'package:dio/dio.dart';

import '../models/category.dart';
import '../models/room.dart';
import '../models/season.dart';
import '../models/switchable_charge_listing.dart';
import '../repository/rooms_repo.dart';

class RoomsUsecase {
  final RoomsRepository repository;

  RoomsUsecase(this.repository);

  Future<List<RoomListing>> rooms() => repository.rooms();
  Future<void> createRoom(FormData form) => repository.createRoom(form);
  Future<void> updateRoom(int id, FormData form) => repository.updateRoom(id, form);
  Future<void> setRoomActive(int id, bool isActive) => repository.setRoomActive(id, isActive);
  Future<void> deleteRoom(int id) => repository.deleteRoom(id);
  Future<void> deleteRoomImage(int roomId, int imageId) =>
      repository.deleteRoomImage(roomId, imageId);

  Future<List<RoomCategory>> categories() => repository.categories();
  Future<void> createCategory({required String name, required num basePrice}) =>
      repository.createCategory(name: name, basePrice: basePrice);
  Future<void> updateCategory(int id, {required String name, required num basePrice}) =>
      repository.updateCategory(id, name: name, basePrice: basePrice);
  Future<void> setCategoryActive(int id, bool isActive) =>
      repository.setCategoryActive(id, isActive);
  Future<void> deleteCategory(int id) => repository.deleteCategory(id);

  Future<List<SwitchableChargeListing>> switchableCharges() => repository.switchableCharges();
  Future<void> createSwitchableCharge({required String name, required num chargePerNight}) =>
      repository.createSwitchableCharge(name: name, chargePerNight: chargePerNight);
  Future<void> updateSwitchableCharge(int id, {required String name, required num chargePerNight}) =>
      repository.updateSwitchableCharge(id, name: name, chargePerNight: chargePerNight);
  Future<void> setSwitchableChargeActive(int id, bool isActive) =>
      repository.setSwitchableChargeActive(id, isActive);
  Future<void> deleteSwitchableCharge(int id) => repository.deleteSwitchableCharge(id);

  Future<List<Season>> seasons() => repository.seasons();
  Future<void> createSeason({
    required String name,
    required String startDate,
    required String endDate,
    required num adjustmentPercent,
  }) => repository.createSeason(
    name: name,
    startDate: startDate,
    endDate: endDate,
    adjustmentPercent: adjustmentPercent,
  );
  Future<void> updateSeason(
    int id, {
    required String name,
    required String startDate,
    required String endDate,
    required num adjustmentPercent,
  }) => repository.updateSeason(
    id,
    name: name,
    startDate: startDate,
    endDate: endDate,
    adjustmentPercent: adjustmentPercent,
  );
  Future<void> deleteSeason(int id) => repository.deleteSeason(id);
}
