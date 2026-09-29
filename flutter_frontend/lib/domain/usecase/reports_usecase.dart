import '../models/report.dart';
import '../repository/reports_repo.dart';

class ReportsUsecase {
  final ReportsRepository repository;

  ReportsUsecase(this.repository);

  Future<BookingsReport> bookingsReport({
    required String fromDate,
    required String toDate,
  }) => repository.bookingsReport(fromDate: fromDate, toDate: toDate);

  Future<OccupancyReport> occupancyReport({
    required String fromDate,
    required String toDate,
  }) => repository.occupancyReport(fromDate: fromDate, toDate: toDate);

  Future<GstSummaryReport> gstSummary({
    required String fromDate,
    required String toDate,
  }) => repository.gstSummary(fromDate: fromDate, toDate: toDate);

  Future<EventsReport> eventsReport({
    required String fromDate,
    required String toDate,
  }) => repository.eventsReport(fromDate: fromDate, toDate: toDate);

  Future<FoodOrdersReport> foodOrdersReport({
    required String fromDate,
    required String toDate,
  }) => repository.foodOrdersReport(fromDate: fromDate, toDate: toDate);

  Future<ProfitLossReport> profitLoss({
    required String fromDate,
    required String toDate,
  }) => repository.profitLoss(fromDate: fromDate, toDate: toDate);

  Future<ProfitLossHistory> profitLossHistory({String granularity = 'year'}) =>
      repository.profitLossHistory(granularity: granularity);
}
