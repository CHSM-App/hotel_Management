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
}
