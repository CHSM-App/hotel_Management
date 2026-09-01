import '../models/invoice.dart';

abstract class BillingRepository {
  Future<List<BillableStay>> queue();

  Future<BillPreview> preview(int bookingId, {bool includeLateCheckout});

  Future<Invoice> issue(int bookingId, Map<String, dynamic> body);

  Future<List<Invoice>> invoices();

  Future<Invoice> voidInvoice(int id, String reason);
}
