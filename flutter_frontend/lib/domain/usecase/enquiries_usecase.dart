import '../models/enquiry.dart';
import '../repository/enquiries_repo.dart';

class EnquiriesUsecase {
  final EnquiriesRepository repository;

  EnquiriesUsecase(this.repository);

  Future<List<Enquiry>> enquiries() => repository.enquiries();

  Future<List<EnquiryAlertItem>> newEnquiries() => repository.newEnquiries();

  Future<Enquiry> updateStatus(int id, String status) =>
      repository.updateStatus(id, status);
}
