import 'dart:typed_data';

import '../models/invoice.dart';

abstract class BillingRepository {
  Future<List<BillableStay>> queue();

  Future<BillPreview> preview(
    int bookingId, {
    bool includeLateCheckout,
    num discountAmount,
    String? discountReason,
  });

  Future<Invoice> issue(int bookingId, Map<String, dynamic> body);

  /// Tables, rooms, and takeaways holding delivered food nobody has paid for.
  Future<List<FoodTab>> foodTabs();

  Future<FoodBillPreview> previewFoodBill(String tab);

  Future<Invoice> issueFoodInvoice(String tab, Map<String, dynamic> body);

  Future<List<Invoice>> invoices();

  Future<Invoice> voidInvoice(int id, String reason);

  Future<WhatsAppShareResult> shareInvoiceWhatsApp(
    int invoiceId,
    Uint8List pdfBytes,
    String filename, {
    String? phone,
  });

  Future<List<AdvanceReceipt>> advanceReceipts(int bookingId);

  Future<AdvanceReceipt> issueAdvanceReceipt(
    int bookingId,
    Map<String, dynamic> body,
  );

  Future<AdvanceReceipt> voidAdvanceReceipt(int id, String reason);
}
