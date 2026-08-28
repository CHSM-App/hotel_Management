import '../models/invoice.dart';
import '../repository/billing_repo.dart';

class BillingUsecase {
  final BillingRepository repository;

  BillingUsecase(this.repository);

  /// Stays that have checked out and have no bill yet.
  Future<List<BillableStay>> queue() => repository.queue();

  /// What the bill will say.
  Future<BillPreview> preview(int bookingId, {bool includeLateCheckout = true}) =>
      repository.preview(bookingId, includeLateCheckout: includeLateCheckout);

  /// Cut the bill.
  Future<Invoice> issue(int bookingId, Map<String, dynamic> body) =>
      repository.issue(bookingId, body);

  /// Bills already issued.
  Future<List<Invoice>> invoices() => repository.invoices();

  /// Cancel one that should not have been issued.
  Future<Invoice> voidInvoice(int id, String reason) =>
      repository.voidInvoice(id, reason);
}
