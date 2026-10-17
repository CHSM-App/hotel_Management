import '../models/housekeeping.dart';
import '../repository/housekeeping_repo.dart';

class HousekeepingUsecase {
  final HousekeepingRepository repository;

  HousekeepingUsecase(this.repository);

  Future<List<HousekeepingRoom>> rooms() => repository.rooms();

  Future<void> startCleaning(int roomId) => repository.startCleaning(roomId);

  Future<void> releaseRoom(int roomId) => repository.releaseRoom(roomId);

  Future<void> finishCleaning(int roomId, Map<String, dynamic> body) => repository.finishCleaning(roomId, body);

  Future<void> markDirty(int roomId) => repository.markDirty(roomId);

  Future<void> setOutOfOrder(int roomId, Map<String, dynamic> body) => repository.setOutOfOrder(roomId, body);

  Future<List<HousekeepingRoom>> venues() => repository.venues();

  Future<void> startVenueCleaning(int venueId) => repository.startVenueCleaning(venueId);

  Future<void> releaseVenue(int venueId) => repository.releaseVenue(venueId);

  Future<void> finishVenueCleaning(int venueId, Map<String, dynamic> body) => repository.finishVenueCleaning(venueId, body);

  Future<void> markVenueDirty(int venueId) => repository.markVenueDirty(venueId);

  Future<void> setVenueOutOfOrder(int venueId, Map<String, dynamic> body) => repository.setVenueOutOfOrder(venueId, body);

  Future<List<HousekeepingIssue>> issues({String scope = 'all'}) => repository.issues(scope: scope);

  Future<OpenIssueSummary> openIssueSummary() => repository.openIssueSummary();

  Future<void> closeIssue(int logId, Map<String, dynamic> body) => repository.closeIssue(logId, body);
}
