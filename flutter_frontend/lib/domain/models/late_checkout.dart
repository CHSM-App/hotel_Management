import 'json.dart';

/// How far past their deadline a guest is, and what the property's policy says
/// that is worth — GET /bookings/:id/late-checkout.
///
/// Asked before every checkout, because a guest who is on time never sees the
/// question and one who is late must not be charged by a number the phone made
/// up. The policy lives on the property and the arithmetic is the server's.
class LateCheckout {
  final int bookingId;
  final int minutesLate;

  /// "on time", "2 hours late" — the server's own words, so the desk and the
  /// web say the same thing.
  final String? lateLabel;

  final bool isLate;

  /// Whether this is worth charging for. Late inside the grace period is late
  /// but free, so this is not the same question as [isLate].
  final bool isChargeable;

  /// What the policy works out. Reception may take it down or waive it, and
  /// nothing stops them — it is a suggestion with a rule behind it.
  final num suggestedCharge;

  final num lastNightRate;

  /// WITHIN_GRACE, HALF_DAY or FULL_DAY.
  final String? band;
  final num percent;

  const LateCheckout({
    required this.bookingId,
    this.minutesLate = 0,
    this.lateLabel,
    this.isLate = false,
    this.isChargeable = false,
    this.suggestedCharge = 0,
    this.lastNightRate = 0,
    this.band,
    this.percent = 0,
  });

  factory LateCheckout.fromJson(Map<String, dynamic> json) => LateCheckout(
    bookingId: asInt(json['bookingId']),
    minutesLate: asInt(json['minutesLate']),
    lateLabel: asStringOrNull(json['lateLabel']),
    isLate: asBool(json['isLate']),
    isChargeable: asBool(json['isChargeable']),
    suggestedCharge: asNum(json['suggestedCharge']),
    lastNightRate: asNum(json['lastNightRate']),
    band: asStringOrNull(json['band']),
    percent: asNum(json['percent']),
  );

  String get bandLabel {
    switch (band) {
      case 'HALF_DAY':
        return 'Half day';
      case 'FULL_DAY':
        return 'Full day';
      default:
        return 'Within grace';
    }
  }
}
