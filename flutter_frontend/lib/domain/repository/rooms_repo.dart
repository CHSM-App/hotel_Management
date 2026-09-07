import 'package:dio/dio.dart';

import '../models/category.dart';
import '../models/room.dart';
import '../models/season.dart';
import '../models/switchable_charge_listing.dart';

/// Rooms & rates — the setup screen, not the booking-time room picker
/// ([BookingRepository.availableRooms] covers that one).
abstract class RoomsRepository {
  // Rooms
  Future<List<RoomListing>> rooms();
  Future<void> createRoom(FormData form);
  Future<void> updateRoom(int id, FormData form);
  Future<void> setRoomActive(int id, bool isActive);
  Future<void> deleteRoom(int id);
  Future<void> deleteRoomImage(int roomId, int imageId);

  // Categories
  Future<List<RoomCategory>> categories();
  Future<void> createCategory({required String name, required num basePrice});
  Future<void> updateCategory(int id, {required String name, required num basePrice});
  Future<void> setCategoryActive(int id, bool isActive);
  Future<void> deleteCategory(int id);

  // Switchable charges (booking extras)
  Future<List<SwitchableChargeListing>> switchableCharges();
  Future<void> createSwitchableCharge({required String name, required num chargePerNight});
  Future<void> updateSwitchableCharge(int id, {required String name, required num chargePerNight});
  Future<void> setSwitchableChargeActive(int id, bool isActive);
  Future<void> deleteSwitchableCharge(int id);

  // Seasons
  Future<List<Season>> seasons();
  Future<void> createSeason({
    required String name,
    required String startDate,
    required String endDate,
    required num adjustmentPercent,
  });
  Future<void> updateSeason(
    int id, {
    required String name,
    required String startDate,
    required String endDate,
    required num adjustmentPercent,
  });
  Future<void> deleteSeason(int id);
}
