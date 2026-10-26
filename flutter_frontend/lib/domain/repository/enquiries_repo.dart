import '../models/enquiry.dart';

/// Enquiries guests send from the public page (enquiries.manage).
abstract class EnquiriesRepository {
  Future<List<Enquiry>> enquiries();

  /// The NEW ones only, newest first and capped — what the alert bell polls.
  Future<List<EnquiryAlertItem>> newEnquiries();

  Future<Enquiry> updateStatus(int id, String status);

  Future<EnquiryCatalogue> catalogue();
}
