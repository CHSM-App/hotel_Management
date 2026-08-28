import '../../domain/models/invoice.dart';
import '../../domain/repository/billing_repo.dart';
import '../api/api_service.dart';

/// Pure-remote, and necessarily so.
///
/// Nothing here can be answered from a cache. A bill's total depends on the
/// stay's own snapshot and on GST bands the server applies night by night, and
/// issuing one takes the next serial in a gapless series — a document number
/// cannot be handed out by a phone. Failures rethrow so the desk is told rather
/// than shown a figure that may already be wrong.
class BillingImpl implements BillingRepository {
  final ApiService api;

  BillingImpl(this.api);

  @override
  Future<List<BillableStay>> queue() => api.billingQueue();

  @override
  Future<BillPreview> preview(int bookingId, {bool includeLateCheckout = true}) =>
      api.previewBill(bookingId, includeLateCheckout: includeLateCheckout);

  @override
  Future<Invoice> issue(int bookingId, Map<String, dynamic> body) =>
      api.issueInvoice(bookingId, body);

  @override
  Future<List<Invoice>> invoices() => api.invoices();

  @override
  Future<Invoice> voidInvoice(int id, String reason) =>
      api.voidInvoice(id, reason);
}
