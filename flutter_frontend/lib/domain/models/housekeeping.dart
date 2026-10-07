import 'json.dart';

/// Housekeeping — the room cleaning board, and the problems and found items
/// cleaners report while finishing a room. Mirrors HousekeepingPanel.jsx and
/// HousekeepingIssues.jsx field-for-field.

const kRoomStatuses = ['DIRTY', 'CLEANING', 'READY', 'OCCUPIED', 'OUT_OF_ORDER'];

const kRoomStatusLabel = {
  'DIRTY': 'Needs cleaning',
  'CLEANING': 'Being cleaned',
  'READY': 'Ready',
  'OCCUPIED': 'Occupied',
  'OUT_OF_ORDER': 'Out of order',
};

/// One room's cleaning status — mirrors mapRoom-shaped rows from
/// housekeeping.service.js's listRooms. Status is derived server-side, never
/// stored, so it is just read off the room, never computed here.
class HousekeepingRoom {
  final int id;
  final String roomNumber;
  final String categoryName;
  final String? floor;
  final String? guestName;
  final String? guestCheckOut;
  final int guestsIn;
  final bool leavingToday;
  final String? cleanedAt;
  final String? cleanedBy;
  final int openIssues;
  final String status;
  final bool arrivingToday;
  final String? cleaningBy;
  final String? cleaningStartedAt;
  final String? outOfOrderNote;
  final String? lastCleanedAt;
  final String? dirtySince;

  const HousekeepingRoom({
    required this.id,
    this.roomNumber = '',
    this.categoryName = '',
    this.floor,
    this.guestName,
    this.guestCheckOut,
    this.guestsIn = 0,
    this.leavingToday = false,
    this.cleanedAt,
    this.cleanedBy,
    this.openIssues = 0,
    this.status = 'READY',
    this.arrivingToday = false,
    this.cleaningBy,
    this.cleaningStartedAt,
    this.outOfOrderNote,
    this.lastCleanedAt,
    this.dirtySince,
  });

  factory HousekeepingRoom.fromJson(Map<String, dynamic> json) => HousekeepingRoom(
    id: asInt(json['id']),
    roomNumber: asStringOrNull(json['roomNumber']) ?? '',
    categoryName: asStringOrNull(json['categoryName']) ?? '',
    floor: asStringOrNull(json['floor']),
    guestName: asStringOrNull(json['guestName']),
    guestCheckOut: asStringOrNull(json['guestCheckOut']),
    guestsIn: asInt(json['guestsIn']),
    leavingToday: asBool(json['leavingToday']),
    cleanedAt: asStringOrNull(json['cleanedAt']),
    cleanedBy: asStringOrNull(json['cleanedBy']),
    openIssues: asInt(json['openIssues']),
    status: asStringOrNull(json['status']) ?? 'READY',
    arrivingToday: asBool(json['arrivingToday']),
    cleaningBy: asStringOrNull(json['cleaningBy']),
    cleaningStartedAt: asStringOrNull(json['cleaningStartedAt']),
    outOfOrderNote: asStringOrNull(json['outOfOrderNote']),
    lastCleanedAt: asStringOrNull(json['lastCleanedAt']),
    dirtySince: asStringOrNull(json['dirtySince']),
  );

  /// "Room +2 more" — mirrors the `guest` line built in HousekeepingPanel.jsx.
  String get guestLabel => guestName == null || guestName!.isEmpty
      ? ''
      : guestsIn > 1
          ? '$guestName +${guestsIn - 1} more'
          : guestName!;
}

/// Problem or FOUND item, as a flattened kind — mirrors the ISSUE/FOUND
/// splitting of one housekeeping_log row in listIssues.
const kIssueKindLabel = {'ISSUE': 'Problem', 'FOUND': 'Found item'};
const kIssueKindCloseLabel = {'ISSUE': 'Mark fixed', 'FOUND': 'Mark handed over'};
const kIssueKindClosedLabel = {'ISSUE': 'Fixed', 'FOUND': 'Handed over'};
const kIssueKindQuestion = {'ISSUE': 'What was done? (optional)', 'FOUND': 'What happened to it? (optional)'};
const kIssueKindHint = {'ISSUE': 'e.g. plumber changed the tap', 'FOUND': 'e.g. returned to guest, kept at reception'};

class HousekeepingIssue {
  final int logId;
  final int roomId;
  final String roomNumber;
  final String kind; // ISSUE | FOUND
  final String text;
  final String reportedAt;
  final String? reportedBy;
  final String? closedAt;
  final String? closedBy;
  final String? resolution;
  final bool roomBlocked;

  const HousekeepingIssue({
    required this.logId,
    this.roomId = 0,
    this.roomNumber = '',
    this.kind = 'ISSUE',
    this.text = '',
    this.reportedAt = '',
    this.reportedBy,
    this.closedAt,
    this.closedBy,
    this.resolution,
    this.roomBlocked = false,
  });

  factory HousekeepingIssue.fromJson(Map<String, dynamic> json) => HousekeepingIssue(
    logId: asInt(json['logId']),
    roomId: asInt(json['roomId']),
    roomNumber: asStringOrNull(json['roomNumber']) ?? '',
    kind: asStringOrNull(json['kind']) ?? 'ISSUE',
    text: asStringOrNull(json['text']) ?? '',
    reportedAt: json['reportedAt']?.toString() ?? '',
    reportedBy: asStringOrNull(json['reportedBy']),
    closedAt: asStringOrNull(json['closedAt']),
    closedBy: asStringOrNull(json['closedBy']),
    resolution: asStringOrNull(json['resolution']),
    roomBlocked: asBool(json['roomBlocked']),
  );

  bool get isOpen => closedAt == null;
}

/// GET /housekeeping/issues/count — the sidebar's badge. Mirrors
/// openIssueSummary.
class OpenIssueSummary {
  final int count;
  final String? latestKey;
  final String? latestKind;
  final String? latestRoomNumber;
  final String? latestText;

  const OpenIssueSummary({this.count = 0, this.latestKey, this.latestKind, this.latestRoomNumber, this.latestText});

  factory OpenIssueSummary.fromJson(Map<String, dynamic> json) {
    final latest = json['latest'] as Map<String, dynamic>?;
    return OpenIssueSummary(
      count: asInt(json['count']),
      latestKey: asStringOrNull(json['latestKey']),
      latestKind: latest == null ? null : asStringOrNull(latest['kind']),
      latestRoomNumber: latest == null ? null : asStringOrNull(latest['roomNumber']),
      latestText: latest == null ? null : asStringOrNull(latest['text']),
    );
  }
}
