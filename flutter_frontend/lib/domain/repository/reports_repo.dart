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

  Future<RoomsAnalytics> roomsAnalytics({
    required String fromDate,
    required String toDate,
  });

  Future<GstSummaryReport> gstSummary({
    required String fromDate,
    required String toDate,
  });

  Future<EventsReport> eventsReport({
    required String fromDate,
    required String toDate,
  });

  Future<FoodOrdersReport> foodOrdersReport({
    required String fromDate,
    required String toDate,
  });

  Future<AnalyticsOverview> analyticsOverview({
    required String fromDate,
    required String toDate,
    String compareMode = 'previous_period',
  });

  Future<ProfitLossReport> profitLoss({
    required String fromDate,
    required String toDate,
  });

  Future<ProfitLossHistory> profitLossHistory({String granularity = 'year'});
}
