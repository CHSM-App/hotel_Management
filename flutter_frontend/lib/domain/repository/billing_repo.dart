import 'dart:typed_data';

import '../models/event_booking.dart';
import '../models/invoice.dart';
import '../models/lodge_service.dart' show ServiceUsage;

abstract class BillingRepository {
  Future<List<BillableStay>> queue();

  /// Functions that are over (or marked complete) and have no bill yet.
  Future<List<EventBooking>> queueEvents();

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

  /// Everyone checked in right now — the destination list for adding a
  /// table/takeaway tab to a room bill.
  Future<List<InHouseGuest>> inHouseGuests();

  /// Moves a table or takeaway tab's delivered, unbilled food onto a stay's
  /// bill.
  Future<void> addFoodTabToRoom(String tab, int bookingId);

  Future<List<Invoice>> invoices();

  Future<Invoice> voidInvoice(int id, String reason);

  Future<WhatsAppShareResult> shareInvoiceWhatsApp(
    int invoiceId,
    Uint8List pdfBytes,
    String filename, {
    String? phone,
  });

  Future<List<AdvanceReceipt>> advanceReceipts(int bookingId);

  /// Every advance receipt on file for the lodge, for the Bills list.
  Future<List<AdvanceReceipt>> allAdvanceReceipts();

  Future<AdvanceReceipt> issueAdvanceReceipt(
    int bookingId,
    Map<String, dynamic> body,
  );

  Future<AdvanceReceipt> voidAdvanceReceipt(int id, String reason);

  /// One bill, fetched by its own id — used to open "View bill" from a
  /// function that only carries the invoice's id/number on it.
  Future<Invoice> invoice(int id);

  /// What a function's bill will say.
  Future<EventBillPreview> previewEventBill(
    int eventId, {
    num discountAmount,
    String? discountReason,
  });

  /// Cut the bill for a function.
  Future<Invoice> issueEventInvoice(int eventId, Map<String, dynamic> body);

  /// Where the next bill and the next advance receipt continue from.
  Future<Map<String, BillSeries>> billingSeries();

  /// Sets where one series continues from.
  Future<BillSeries> updateBillingSeries(String series, int nextNumber);

  /// Completed, unbilled services (laundry, pool, gaming ...) waiting on
  /// their own document or on a guest's room bill.
  Future<List<ServiceUsage>> billableServiceUsages();

  /// What a standalone service bill will say.
  Future<ServiceBillPreview> previewServiceBill(List<int> usageIds);

  /// Bill the selected uses on their own document.
  Future<Invoice> issueServiceInvoice(
    List<int> usageIds,
    Map<String, dynamic> body,
  );

  /// Charges the selected, completed services to a guest's room bill instead
  /// of billing them on their own.
  Future<void> addServicesToRoom(List<int> usageIds, int bookingId);
}
