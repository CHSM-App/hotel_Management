import '../../domain/models/housekeeping.dart';
import '../../domain/repository/housekeeping_repo.dart';
import '../api/api_service.dart';

class HousekeepingImpl implements HousekeepingRepository {
  final ApiService api;

  HousekeepingImpl(this.api);

  @override
  Future<List<HousekeepingRoom>> rooms() => api.housekeepingRooms();

  @override
  Future<void> startCleaning(int roomId) => api.startCleaning(roomId);

  @override
  Future<void> releaseRoom(int roomId) => api.releaseRoom(roomId);

  @override
  Future<void> finishCleaning(int roomId, Map<String, dynamic> body) => api.finishCleaning(roomId, body);

  @override
  Future<void> markDirty(int roomId) => api.markRoomDirty(roomId);

  @override
  Future<void> setOutOfOrder(int roomId, Map<String, dynamic> body) => api.setRoomOutOfOrder(roomId, body);

  @override
  Future<List<HousekeepingRoom>> venues() => api.housekeepingVenues();

  @override
  Future<void> startVenueCleaning(int venueId) => api.startVenueCleaning(venueId);

  @override
  Future<void> releaseVenue(int venueId) => api.releaseVenue(venueId);

  @override
  Future<void> finishVenueCleaning(int venueId, Map<String, dynamic> body) => api.finishVenueCleaning(venueId, body);

  @override
  Future<void> markVenueDirty(int venueId) => api.markVenueDirty(venueId);

  @override
  Future<void> setVenueOutOfOrder(int venueId, Map<String, dynamic> body) => api.setVenueOutOfOrder(venueId, body);

  @override
  Future<List<HousekeepingIssue>> issues({String scope = 'all'}) => api.housekeepingIssues(scope: scope);

  @override
  Future<OpenIssueSummary> openIssueSummary() => api.openIssueSummary();

  @override
  Future<void> closeIssue(int logId, Map<String, dynamic> body) => api.closeHousekeepingIssue(logId, body);
}
