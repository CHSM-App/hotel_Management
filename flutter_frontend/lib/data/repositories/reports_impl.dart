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
  Future<GstSummaryReport> gstSummary({
    required String fromDate,
    required String toDate,
  }) => api.gstSummary(fromDate: fromDate, toDate: toDate);
}
