import 'dart:typed_data';

import '../../domain/models/event_booking.dart';
import '../../domain/models/invoice.dart';
import '../../domain/models/lodge_service.dart' show ServiceUsage;
import '../../domain/repository/billing_repo.dart';
import '../../core/offline/offline_desk.dart';
import '../../core/offline/offline_interceptor.dart';
import '../../core/offline/offline_store.dart';
import '../api/api_service.dart';

/// The server first; a guest's check-out and bill can also be done on the
/// device when the network is down.
///
/// A bill's total depends on the stay's own nightly snapshot and the GST bands
/// the server applies night by night; [OfflineDesk] ports that arithmetic and is
/// held to the server's own figures by test/pricing_golden_test.dart. What it
/// cannot do is hand out an invoice number — the gapless series is the
/// server's — so an offline bill is PROVISIONAL and carries a number of the
/// device's own until the settlement reaches the server and the real one is
/// issued. Everything else still needs the server.
class BillingImpl implements BillingRepository {
  final ApiService api;
  final OfflineDesk? desk;

  BillingImpl(this.api, [this.desk]);

  Future<Map<String, dynamic>?> _cachedRaw(int id) async {
    final raw = await desk?.store.cachedGet('/bookings/$id');
    final b = raw is Map ? raw['booking'] : null;
    return b is Map ? b.cast<String, dynamic>() : null;
  }

  @override
  Future<List<BillableStay>> queue() => api.billingQueue();

  @override
  Future<List<EventBooking>> queueEvents() => api.eventBillingQueue();

  @override
  Future<BillPreview> preview(
    int bookingId, {
    bool includeLateCheckout = true,
    num discountAmount = 0,
    String? discountReason,
    BillSettle? settle,
  }) async {
    // A booking made on this device has no server record to ask about.
    if (bookingId >= 0) {
      try {
        return await api.previewBill(
          bookingId,
          includeLateCheckout: includeLateCheckout,
          discountAmount: discountAmount,
          discountReason: discountReason,
          settle: settle,
        );
      } on OfflineUnavailable {
        if (desk == null) rethrow;
      }
    }
    return desk!.previewBill(
      bookingId,
      includeLateCheckout: includeLateCheckout,
      discountAmount: discountAmount,
      discountReason: discountReason,
      settle: settle,
      cachedRaw: await _cachedRaw(bookingId),
    );
  }

  @override
  Future<Invoice> issue(int bookingId, Map<String, dynamic> body) =>
      api.issueInvoice(bookingId, body);

  @override
  Future<SettleResult> settle(
    int bookingId,
    Map<String, dynamic> body, {
    int? roomId,
  }) async {
    final local = desk == null ? null : await desk!.store.stayGet(bookingId);
    // Already checked out on this device and waiting to sync: do not do it twice.
    // One key for the attempt now and the copy saved for later, so the server
    // can tell a replay from a new bill (see middleware/idempotency.js).
    final key = newUuid();
    if (bookingId >= 0 && local == null) {
      try {
        return await api.settleCheckout(bookingId, body, roomId: roomId, idempotencyKey: key);
      } on OfflineUnavailable {
        if (desk == null) rethrow;
      }
    }
    return desk!.settle(bookingId, body, roomId: roomId, cachedRaw: await _cachedRaw(bookingId), key: key);
  }

  @override
  Future<List<FoodTab>> foodTabs() => api.foodTabs();

  @override
  Future<FoodBillPreview> previewFoodBill(String tab) =>
      api.previewFoodBill(tab);

  @override
  Future<Invoice> issueFoodInvoice(String tab, Map<String, dynamic> body) =>
      api.issueFoodInvoice(tab, body);

  @override
  Future<List<InHouseGuest>> inHouseGuests() => api.inHouseGuests();

  @override
  Future<void> addFoodTabToRoom(String tab, int bookingId) =>
      api.addFoodTabToRoom(tab, bookingId);

  @override
  Future<List<Invoice>> invoices() => api.invoices();

  @override
  Future<Invoice> voidInvoice(int id, String reason) =>
      api.voidInvoice(id, reason);

  @override
  Future<WhatsAppShareResult> shareInvoiceWhatsApp(
    int invoiceId,
    Uint8List pdfBytes,
    String filename, {
    String? phone,
  }) => api.shareInvoiceWhatsApp(invoiceId, pdfBytes, filename, phone: phone);

  @override
  Future<List<AdvanceReceipt>> advanceReceipts(int bookingId) async {
    if (bookingId < 0) return desk?.advanceReceipts(bookingId) ?? const [];
    return api.advanceReceipts(bookingId);
  }

  @override
  Future<List<AdvanceReceipt>> allAdvanceReceipts() => api.allAdvanceReceipts();

  @override
  Future<AdvanceReceipt> issueAdvanceReceipt(
    int bookingId,
    Map<String, dynamic> body,
  ) => api.issueAdvanceReceipt(bookingId, body);

  @override
  Future<AdvanceReceipt> voidAdvanceReceipt(int id, String reason) =>
      api.voidAdvanceReceipt(id, reason);

  @override
  Future<Invoice> invoice(int id) => api.invoice(id);

  @override
  Future<EventBillPreview> previewEventBill(
    int eventId, {
    num discountAmount = 0,
    String? discountReason,
  }) => api.previewEventBill(
    eventId,
    discountAmount: discountAmount,
    discountReason: discountReason,
  );

  @override
  Future<Invoice> issueEventInvoice(int eventId, Map<String, dynamic> body) =>
      api.issueEventInvoice(eventId, body);

  @override
  Future<Map<String, BillSeries>> billingSeries() => api.billingSeries();

  @override
  Future<BillSeries> updateBillingSeries(String series, int nextNumber) =>
      api.updateBillingSeries(series, nextNumber);

  @override
  Future<List<ServiceUsage>> billableServiceUsages() =>
      api.serviceUsages(status: 'tobill');

  @override
  Future<ServiceBillPreview> previewServiceBill(List<int> usageIds) =>
      api.previewServiceBill(usageIds);

  @override
  Future<Invoice> issueServiceInvoice(
    List<int> usageIds,
    Map<String, dynamic> body,
  ) => api.issueServiceInvoice(usageIds, body);

  @override
  Future<void> addServicesToRoom(List<int> usageIds, int bookingId) =>
      api.addServicesToRoom(usageIds, bookingId);
}
