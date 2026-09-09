import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/domain/models/invoice.dart';
import 'package:hotel_manager/screens/bookings/advance_receipt_pdf.dart';

void main() {
  final receipt = const AdvanceReceipt(
    id: 12,
    receiptNumber: '12',
    documentType: 'RECEIPT_VOUCHER',
    amountReceived: 200,
    stayTotal: 1500,
    balanceDue: 1300,
    paymentMethod: 'CASH',
    guestName: 'shubh',
    guestPhone: '8527419635',
    numGuests: 1,
    roomNumber: '103',
    checkInDate: '2026-09-09',
    checkOutDate: '2026-09-10',
    lodgeName: 'HOTEL CELEBRATION',
    lodgePhone: '9421326295',
    lodgeAddress: 'Near RPD college, Sawantwadi',
    lodgeCity: 'Sawantwadi',
    lodgeState: 'Maharashtra',
  );

  for (final p in ReceiptPaperSize.all) {
    test('builds on ${p.id} without throwing', () async {
      final bytes = await AdvanceReceiptPdf.build(receipt, paperId: p.id);
      expect(bytes.length, greaterThan(500));
    });
  }
}
