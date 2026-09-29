import '../../domain/models/report.dart';
import '../../domain/repository/reports_repo.dart';
import '../api/api_service.dart';

class ReportsImpl implements ReportsRepository {
  final ApiService api;

  ReportsImpl(this.api);

  @override
  Future<BookingsReport> bookingsReport({
    required String fromDate,
    required String toDate,
  }) => api.bookingsReport(fromDate: fromDate, toDate: toDate);

  @override
  Future<OccupancyReport> occupancyReport({
    required String fromDate,
    required String toDate,
  }) => api.occupancyReport(fromDate: fromDate, toDate: toDate);

  @override
  Future<RoomsAnalytics> roomsAnalytics({
    required String fromDate,
    required String toDate,
  }) => api.roomsAnalytics(fromDate: fromDate, toDate: toDate);

  @override
  Future<GstSummaryReport> gstSummary({
    required String fromDate,
    required String toDate,
  }) => api.gstSummary(fromDate: fromDate, toDate: toDate);

  @override
  Future<EventsReport> eventsReport({
    required String fromDate,
    required String toDate,
  }) => api.eventsReport(fromDate: fromDate, toDate: toDate);

  @override
  Future<FoodOrdersReport> foodOrdersReport({
    required String fromDate,
    required String toDate,
  }) => api.foodOrdersReport(fromDate: fromDate, toDate: toDate);

  @override
  Future<AnalyticsOverview> analyticsOverview({
    required String fromDate,
    required String toDate,
    String compareMode = 'previous_period',
  }) => api.analyticsOverview(fromDate: fromDate, toDate: toDate, compareMode: compareMode);

  @override
  Future<ProfitLossReport> profitLoss({
    required String fromDate,
    required String toDate,
  }) => api.profitLoss(fromDate: fromDate, toDate: toDate);

  @override
  Future<ProfitLossHistory> profitLossHistory({String granularity = 'year'}) =>
      api.profitLossHistory(granularity: granularity);
}
