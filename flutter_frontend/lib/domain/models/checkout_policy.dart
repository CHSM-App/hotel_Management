import 'json.dart';

/// When a stay is due to end here, and what reception should charge a guest
/// who stays past it — GET/PATCH /rooms/checkout-policy. Mirrors the web
/// dashboard's CheckoutPolicyPanel.jsx against the same lodge-level fields.
class CheckoutPolicy {
  /// Set once at registration and read-only here — changing it mid-life
  /// would restate what every open stay is owed.
  final String checkinMode;
  final String checkInTime;
  final String checkOutTime;

  /// HYBRID only: the earliest arrival that still counts as "early" (and so
  /// gets 24 hours from arrival). Null means any time before [checkInTime].
  final String? earlyArrivalFrom;
  final int lateGraceMinutes;
  final num lateHalfDayPercent;
  final int lateFullDayAfterMinutes;
  final num lateFullDayPercent;

  const CheckoutPolicy({
    required this.checkinMode,
    required this.checkInTime,
    required this.checkOutTime,
    this.earlyArrivalFrom,
    required this.lateGraceMinutes,
    required this.lateHalfDayPercent,
    required this.lateFullDayAfterMinutes,
    required this.lateFullDayPercent,
  });

  factory CheckoutPolicy.fromJson(Map<String, dynamic> json) => CheckoutPolicy(
    checkinMode: json['checkinMode']?.toString() ?? 'NIGHT_BASED',
    checkInTime: json['checkInTime']?.toString() ?? '11:00',
    checkOutTime: json['checkOutTime']?.toString() ?? '11:00',
    earlyArrivalFrom: asStringOrNull(json['earlyArrivalFrom']),
    lateGraceMinutes: asInt(json['lateGraceMinutes']),
    lateHalfDayPercent: asNum(json['lateHalfDayPercent']),
    lateFullDayAfterMinutes: asInt(json['lateFullDayAfterMinutes']),
    lateFullDayPercent: asNum(json['lateFullDayPercent']),
  );

  CheckoutPolicy copyWith({
    String? checkInTime,
    String? checkOutTime,
    String? earlyArrivalFrom,
    bool clearEarlyArrivalFrom = false,
    int? lateGraceMinutes,
    num? lateHalfDayPercent,
    int? lateFullDayAfterMinutes,
    num? lateFullDayPercent,
  }) => CheckoutPolicy(
    checkinMode: checkinMode,
    checkInTime: checkInTime ?? this.checkInTime,
    checkOutTime: checkOutTime ?? this.checkOutTime,
    earlyArrivalFrom: clearEarlyArrivalFrom
        ? null
        : (earlyArrivalFrom ?? this.earlyArrivalFrom),
    lateGraceMinutes: lateGraceMinutes ?? this.lateGraceMinutes,
    lateHalfDayPercent: lateHalfDayPercent ?? this.lateHalfDayPercent,
    lateFullDayAfterMinutes: lateFullDayAfterMinutes ?? this.lateFullDayAfterMinutes,
    lateFullDayPercent: lateFullDayPercent ?? this.lateFullDayPercent,
  );
}
