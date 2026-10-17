import 'json.dart';

/// One row in the staff alerts bell — the Flutter mirror of the alert shape
/// every web hook (useCheckinAlerts, useCoverageAlerts, useOpenIssues, …)
/// settles on before handing it to StaffAlertsBell.jsx. `category` is one of
/// checkin | checkout | order | workOrder | coverage | housekeeping | reports
/// — same keys as CATEGORY_META/CATEGORY_ORDER there, so the two clients
/// group and order alerts the same way.
class StaffAlert {
  final String id;
  final String category;
  final String message;
  final bool urgent;

  const StaffAlert({
    required this.id,
    required this.category,
    required this.message,
    this.urgent = false,
  });
}

/// GET /bookings/checkin-alerts and /bookings/checkout-alerts — a room's
/// stay, overdue or not, before it's folded into a [StaffAlert].
class CheckAlert {
  final int bookingRoomId;
  final String message;
  final bool overdue;

  const CheckAlert({
    required this.bookingRoomId,
    required this.message,
    this.overdue = false,
  });

  factory CheckAlert.fromJson(Map<String, dynamic> json) => CheckAlert(
    bookingRoomId: asInt(json['bookingRoomId']),
    message: asStringOrNull(json['message']) ?? '',
    overdue: asBool(json['overdue']),
  );
}
