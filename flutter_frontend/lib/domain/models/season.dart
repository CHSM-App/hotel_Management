import 'json.dart';

/// A seasonal price adjustment, from GET /seasons — a festival or a weekend
/// painted onto the calendar as a percentage on top of (or off) the base
/// rate for any night that falls inside it.
class Season {
  final int id;
  final String name;
  final String startDate;
  final String endDate;
  final num adjustmentPercent;

  const Season({
    required this.id,
    required this.name,
    required this.startDate,
    required this.endDate,
    required this.adjustmentPercent,
  });

  factory Season.fromJson(Map<String, dynamic> json) => Season(
    id: asInt(json['id']),
    name: json['name']?.toString() ?? '',
    startDate: json['startDate']?.toString() ?? '',
    endDate: json['endDate']?.toString() ?? '',
    adjustmentPercent: asNum(json['adjustmentPercent']),
  );
}
