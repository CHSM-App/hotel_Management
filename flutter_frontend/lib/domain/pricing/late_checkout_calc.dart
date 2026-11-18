import 'stay_pricing.dart' show round2;

/// When a stay is actually over, and what it costs to run past that — worked
/// out on the device. A port of the server's `lateCheckout.js` plus the
/// composition in `bookings.service.getLateCheckout`, so reception can be told
/// "3h 20m late, suggested ₹800" with no network.
///
/// Every property is in India, and the server may not be, so the property's
/// wall clock is pinned to IST rather than to wherever the process runs. The
/// device is held to the same rule: a phone set to another timezone must not
/// read "09:00" as some other hour and charge, or forgive, a whole night by it.

const _istOffsetMinutes = 330;

/// `HH:MM[:SS]` on a plain `YYYY-MM-DD`, as a real instant (UTC).
DateTime atLocalTime(String isoDate, String? timeOfDay) {
  final d = isoDate.substring(0, 10).split('-').map(int.parse).toList();
  final t = (timeOfDay ?? '11:00:00').split(':').map((p) => int.tryParse(p) ?? 0).toList();
  final ms = DateTime.utc(d[0], d[1], d[2], t[0], t.length > 1 ? t[1] : 0, t.length > 2 ? t[2] : 0);
  return ms.subtract(const Duration(minutes: _istOffsetMinutes));
}

String isoDateInLodgeZone(DateTime instant) =>
    instant.toUtc().add(const Duration(minutes: _istOffsetMinutes)).toIso8601String().substring(0, 10);

int _clockToMinutes(String clock) {
  final p = clock.split(':').map((x) => int.tryParse(x) ?? 0).toList();
  return p[0] * 60 + (p.length > 1 ? p[1] : 0);
}

int _minutesIntoLodgeDay(DateTime instant) {
  final s = instant.toUtc().add(const Duration(minutes: _istOffsetMinutes));
  return s.hour * 60 + s.minute;
}

int nightsBetween(String checkIn, String checkOut) {
  DateTime p(String s) => DateTime.utc(int.parse(s.substring(0, 4)), int.parse(s.substring(5, 7)), int.parse(s.substring(8, 10)));
  final days = ((p(checkOut).millisecondsSinceEpoch - p(checkIn).millisecondsSinceEpoch) / 86400000).round();
  return days < 1 ? 1 : days;
}

bool isEarlyArrival({DateTime? actualCheckInAt, String? checkInTime, String? earlyArrivalFrom}) {
  if (actualCheckInAt == null || checkInTime == null) return false;
  final arrived = _minutesIntoLodgeDay(actualCheckInAt);
  final from = earlyArrivalFrom == null ? 0 : _clockToMinutes(earlyArrivalFrom);
  return arrived >= from && arrived < _clockToMinutes(checkInTime);
}

DateTime checkoutDeadline({
  required String? checkinMode,
  required String checkOutTime,
  String? checkInTime,
  String? earlyArrivalFrom,
  required String checkInDate,
  required String checkOutDate,
  DateTime? actualCheckInAt,
}) {
  final byHours = (checkinMode == 'HOUR_24' && actualCheckInAt != null) ||
      (checkinMode == 'HYBRID' &&
          isEarlyArrival(
            actualCheckInAt: actualCheckInAt,
            checkInTime: checkInTime,
            earlyArrivalFrom: earlyArrivalFrom,
          ));
  if (byHours) {
    return actualCheckInAt!.add(Duration(hours: 24 * nightsBetween(checkInDate, checkOutDate)));
  }
  return atLocalTime(checkOutDate, checkOutTime);
}

/// The CYCLE rule: a stay costs one night for every checkout-time boundary it
/// crosses, minimum one.
int cycleNights({
  required String checkOutTime,
  required DateTime actualCheckInAt,
  required DateTime at,
  int graceMinutes = 0,
}) {
  var boundary = atLocalTime(isoDateInLodgeZone(actualCheckInAt), checkOutTime);
  if (!boundary.isAfter(actualCheckInAt)) boundary = boundary.add(const Duration(days: 1));
  final grace = Duration(minutes: graceMinutes < 0 ? 0 : graceMinutes);
  var nights = 1;
  while (at.isAfter(boundary.add(grace)) && nights < 400) {
    nights += 1;
    boundary = boundary.add(const Duration(days: 1));
  }
  return nights;
}

int overdueMinutes(DateTime deadline, DateTime at) {
  final m = (at.millisecondsSinceEpoch - deadline.millisecondsSinceEpoch) / 60000;
  return m < 0 ? 0 : m.floor();
}

class LateSuggestion {
  final double amount;
  final String band;
  final num percent;
  const LateSuggestion(this.amount, this.band, this.percent);
}

class LatePolicy {
  final int lateGraceMinutes;
  final num lateHalfDayPercent;
  final int lateFullDayAfterMinutes;
  final num lateFullDayPercent;
  const LatePolicy({
    this.lateGraceMinutes = 0,
    this.lateHalfDayPercent = 50,
    this.lateFullDayAfterMinutes = 360,
    this.lateFullDayPercent = 100,
  });
}

LateSuggestion suggestLateCharge(LatePolicy policy, int minutesLate, num lastNightRate) {
  if (minutesLate <= policy.lateGraceMinutes) return const LateSuggestion(0, 'WITHIN_GRACE', 0);
  final full = minutesLate > policy.lateFullDayAfterMinutes;
  final band = full ? 'FULL_DAY' : 'HALF_DAY';
  final percent = full ? policy.lateFullDayPercent : policy.lateHalfDayPercent;
  return LateSuggestion(round2(lastNightRate * (percent / 100)), band, percent);
}

LateSuggestion suggestCycleCharge(int extraNights, num lastNightRate) {
  final nights = extraNights < 0 ? 0 : extraNights;
  if (nights == 0) return const LateSuggestion(0, 'WITHIN_GRACE', 0);
  return LateSuggestion(round2(lastNightRate * nights), 'EXTRA_NIGHTS', 100 * nights);
}

String lateLabel(int minutesLate) {
  if (minutesLate <= 0) return 'on time';
  if (minutesLate < 60) return '$minutesLate min late';
  final h = minutesLate ~/ 60;
  final m = minutesLate % 60;
  return m == 0 ? '${h}h late' : '${h}h ${m}m late';
}

/// The answer reception is shown at check-out, in the shape of the server's
/// GET /bookings/:id/late-checkout response.
Map<String, dynamic> lateCheckoutAnswer({
  required int bookingId,
  required String checkinMode,
  required String checkInDate,
  required String checkOutDate,
  required String checkOutTime,
  String? checkInTime,
  String? earlyArrivalFrom,
  DateTime? actualCheckInAt,
  required DateTime at,
  required LatePolicy policy,
  required num lastNightRate,
  int? roomId,
  String? roomNumber,
  String status = 'CHECKED_IN',
  num appliedCharge = 0,
}) {
  final deadline = checkoutDeadline(
    checkinMode: checkinMode,
    checkOutTime: checkOutTime,
    checkInTime: checkInTime,
    earlyArrivalFrom: earlyArrivalFrom,
    checkInDate: checkInDate,
    checkOutDate: checkOutDate,
    actualCheckInAt: actualCheckInAt,
  );
  final minutesLate = overdueMinutes(deadline, at);
  final planned = nightsBetween(checkInDate, checkOutDate);

  // CYCLE prices the overstay in whole nights; the other modes keep their
  // percentage bands. A CYCLE booking with no arrival on record can't be
  // counted, so it falls back to the bands too.
  final isCycle = checkinMode == 'CYCLE' && actualCheckInAt != null;
  final actualNights = isCycle
      ? cycleNights(
          checkOutTime: checkOutTime,
          actualCheckInAt: actualCheckInAt,
          at: at,
          graceMinutes: policy.lateGraceMinutes,
        )
      : planned;
  final extra = actualNights - planned < 0 ? 0 : actualNights - planned;
  final s = isCycle ? suggestCycleCharge(extra, lastNightRate) : suggestLateCharge(policy, minutesLate, lastNightRate);

  return {
    'plannedNights': planned,
    'actualNights': actualNights,
    'extraNights': extra,
    'checkInTime': checkInTime,
    'checkOutTime': checkOutTime,
    'bookingId': bookingId,
    'roomId': roomId,
    'roomNumber': roomNumber,
    'status': status,
    'checkinMode': checkinMode,
    'deadline': deadline.toIso8601String(),
    'minutesLate': minutesLate,
    'lateLabel': lateLabel(minutesLate),
    'isLate': minutesLate > 0,
    'isChargeable': s.amount > 0,
    'lastNightRate': lastNightRate,
    'suggestedCharge': s.amount,
    'band': s.band,
    'percent': s.percent,
    'policy': {
      'lateGraceMinutes': policy.lateGraceMinutes,
      'lateHalfDayPercent': policy.lateHalfDayPercent,
      'lateFullDayAfterMinutes': policy.lateFullDayAfterMinutes,
      'lateFullDayPercent': policy.lateFullDayPercent,
    },
    'appliedCharge': appliedCharge,
  };
}
