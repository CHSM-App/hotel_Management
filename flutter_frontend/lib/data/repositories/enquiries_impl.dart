import '../../domain/models/enquiry.dart';
import '../../domain/repository/enquiries_repo.dart';
import '../api/api_service.dart';

class EnquiriesImpl implements EnquiriesRepository {
  final ApiService api;

  EnquiriesImpl(this.api);

  @override
  Future<List<Enquiry>> enquiries() => api.enquiries();

  @override
  Future<List<EnquiryAlertItem>> newEnquiries() => api.newEnquiries();

  @override
  Future<Enquiry> updateStatus(int id, String status) =>
      api.updateEnquiryStatus(id, status);
}
