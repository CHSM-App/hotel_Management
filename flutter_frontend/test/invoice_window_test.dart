import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/domain/models/invoice_window.dart';
import 'package:hotel_manager/domain/models/me.dart';
import 'package:hotel_manager/presentation/view_models/booking_viewmodel.dart';
import 'package:hotel_manager/domain/models/draft.dart';

void main() {
  test('edit window parses bounds; null window means no issued invoice', () {
    final w = InvoiceEditWindow.fromResponse({
      'window': {
        'invoiceId': 7,
        'invoiceNumber': 'INV-12',
        'prevNumber': 'INV-11',
        'nextNumber': null,
        'minDate': '2026-11-03',
        'maxDate': null,
      },
    })!;
    expect(w.invoiceNumber, 'INV-12');
    expect(w.minDate, DateTime(2026, 11, 3));
    expect(w.maxDate, isNull);
    expect(w.isOpen, isFalse);
    expect(InvoiceEditWindow.fromResponse({'window': null}), isNull);
  });

  test('past window parses', () {
    final w = PastWindow.fromResponse({
      'window': {
        'billingSide': 'GST',
        'lastNumber': '41',
        'lastStayEnd': '2026-11-10',
        'minDate': '2026-11-10',
      },
    });
    expect(w.billingSide, 'GST');
    expect(w.minDate, DateTime(2026, 11, 10));
  });

  test('Lodge flags default off and read from /me', () {
    expect(
      Lodge.fromJson({'id': 1, 'name': 'L'}).canEditBilledStays,
      isFalse,
    );
    final l = Lodge.fromJson({
      'id': 1,
      'name': 'L',
      'canEditBilledStays': true,
      'canAddPastBookings': true,
    });
    expect(l.canEditBilledStays && l.canAddPastBookings, isTrue);
  });

  test('PastStay form fields carry times, side and only paid lines', () {
    final f = PastStay(
      billingSide: 'NON_GST',
      checkedInAt: '2026-11-18T14:00',
      checkedOutAt: '2026-11-19T11:00',
      roomTimes: [
        {
          'roomId': 3,
          'checkedInAt': '2026-11-18T14:00',
          'checkedOutAt': '2026-11-19T11:00',
        },
      ],
      finalLines: [
        PaymentDraft(method: 'CASH', amount: '1200'),
        PaymentDraft(method: 'UPI', amount: '0'),
      ],
    ).toFormFields();
    expect(f['billingSide'], 'NON_GST');
    expect(f['paymentLines'], '[{"method":"CASH","amount":1200}]');
    expect(f['roomTimes'], contains('"roomId":3'));
  });
}
