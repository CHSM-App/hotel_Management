import 'dart:typed_data';

import '../models/invoice.dart';
import '../repository/billing_repo.dart';

class BillingUsecase {
  final BillingRepository repository;

  BillingUsecase(this.repository);

  /// Stays that have checked out and have no bill yet.
  Future<List<BillableStay>> queue() => repository.queue();

  /// What the bill will say.
  Future<BillPreview> preview(
    int bookingId, {
    bool includeLateCheckout = true,
    num discountAmount = 0,
    String? discountReason,
  }) => repository.preview(
    bookingId,
    includeLateCheckout: includeLateCheckout,
    discountAmount: discountAmount,
    discountReason: discountReason,
  );

  /// Cut the bill.
  Future<Invoice> issue(int bookingId, Map<String, dynamic> body) =>
      repository.issue(bookingId, body);

  /// Tables, rooms, and takeaways holding delivered food nobody has paid for.
  Future<List<FoodTab>> foodTabs() => repository.foodTabs();

  /// What a food bill will say.
  Future<FoodBillPreview> previewFoodBill(String tab) =>
      repository.previewFoodBill(tab);

  /// Close one food tab.
  Future<Invoice> issueFoodInvoice(String tab, Map<String, dynamic> body) =>
      repository.issueFoodInvoice(tab, body);

  /// Bills already issued.
  Future<List<Invoice>> invoices() => repository.invoices();

  /// Cancel one that should not have been issued.
  Future<Invoice> voidInvoice(int id, String reason) =>
      repository.voidInvoice(id, reason);

  /// Send an already-built bill PDF to the guest on WhatsApp.
  Future<WhatsAppShareResult> shareInvoiceWhatsApp(
    int invoiceId,
    Uint8List pdfBytes,
    String filename, {
    String? phone,
  }) => repository.shareInvoiceWhatsApp(invoiceId, pdfBytes, filename, phone: phone);

  /// Every advance receipt written against this stay.
  Future<List<AdvanceReceipt>> advanceReceipts(int bookingId) =>
      repository.advanceReceipts(bookingId);

  /// Write one.
  Future<AdvanceReceipt> issueAdvanceReceipt(
    int bookingId,
    Map<String, dynamic> body,
  ) => repository.issueAdvanceReceipt(bookingId, body);

  /// Cancel one that should not have been issued.
  Future<AdvanceReceipt> voidAdvanceReceipt(int id, String reason) =>
      repository.voidAdvanceReceipt(id, reason);

  /// One bill, fetched by its own id.
  Future<Invoice> invoice(int id) => repository.invoice(id);

  /// What a function's bill will say.
  Future<EventBillPreview> previewEventBill(int eventId) =>
      repository.previewEventBill(eventId);

  /// Cut the bill for a function.
  Future<Invoice> issueEventInvoice(int eventId, Map<String, dynamic> body) =>
      repository.issueEventInvoice(eventId, body);

  /// Where the next bill and the next advance receipt continue from.
  Future<Map<String, BillSeries>> billingSeries() => repository.billingSeries();

  /// Sets where one series continues from.
  Future<BillSeries> updateBillingSeries(String series, int nextNumber) =>
      repository.updateBillingSeries(series, nextNumber);
}
