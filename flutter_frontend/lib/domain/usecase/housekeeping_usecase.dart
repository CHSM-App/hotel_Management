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

  Future<List<HousekeepingIssue>> issues({String scope = 'all'}) => repository.issues(scope: scope);

  Future<OpenIssueSummary> openIssueSummary() => repository.openIssueSummary();

  Future<void> closeIssue(int logId, Map<String, dynamic> body) => repository.closeIssue(logId, body);
}
