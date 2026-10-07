import '../models/housekeeping.dart';

/// Housekeeping — the room cleaning board and its issues log. Mirrors
/// HousekeepingPanel.jsx / HousekeepingIssues.jsx.
abstract class HousekeepingRepository {
  Future<List<HousekeepingRoom>> rooms();

  Future<void> startCleaning(int roomId);

  Future<void> releaseRoom(int roomId);

  Future<void> finishCleaning(int roomId, Map<String, dynamic> body);

  Future<void> markDirty(int roomId);

  Future<void> setOutOfOrder(int roomId, Map<String, dynamic> body);

  Future<List<HousekeepingIssue>> issues({String scope = 'all'});

  Future<OpenIssueSummary> openIssueSummary();

  Future<void> closeIssue(int logId, Map<String, dynamic> body);
}
