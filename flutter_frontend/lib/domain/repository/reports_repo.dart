import '../models/report.dart';

/// Reports — the same three the web dashboard's Reports tab offers: the
/// booking register, occupancy, and the GST filing summary. Owner-only
/// (reports.view), and only where the property actually has rooms.
abstract class ReportsRepository {
  Future<BookingsReport> bookingsReport({
    required String fromDate,
    required String toDate,
  });

  Future<OccupancyReport> occupancyReport({
    required String fromDate,
    required String toDate,
  });

  Future<GstSummaryReport> gstSummary({
    required String fromDate,
    required String toDate,
  });
}
